using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using RxSoftphone;

var executableVersion = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.4.3";
var versionOnly = args.Any(x =>
    string.Equals(x, "--version", StringComparison.OrdinalIgnoreCase) ||
    string.Equals(x, "--v", StringComparison.OrdinalIgnoreCase) ||
    string.Equals(x, "-v", StringComparison.OrdinalIgnoreCase));
if (versionOnly)
{
    Console.WriteLine($"RX Softphone {executableVersion}");
    return;
}

var noBrowser = args.Any(x => string.Equals(x, "--no-browser", StringComparison.OrdinalIgnoreCase));
var testRingtone = args.Any(x => string.Equals(x, "--test-ringtone", StringComparison.OrdinalIgnoreCase));
var hostArgs = args.Where(x =>
    !string.Equals(x, "--no-browser", StringComparison.OrdinalIgnoreCase) &&
    !string.Equals(x, "--test-ringtone", StringComparison.OrdinalIgnoreCase)).ToArray();

if (testRingtone)
{
    using var ringTone = new LocalRingTone();
    Console.WriteLine("Playing the local RX Softphone ringtone on the default Windows speaker...");
    ringTone.Start();
    await Task.Delay(TimeSpan.FromSeconds(3));
    Console.WriteLine("Ringtone test completed.");
    return;
}

var builder = WebApplication.CreateBuilder(hostArgs);
var webUrl = builder.Configuration["Softphone:WebUrl"] ?? "http://127.0.0.1:5188";
var clientVersion = executableVersion;
var managedMode = builder.Configuration.GetValue("Softphone:ManagedMode", true);
var allowManualDialing = builder.Configuration.GetValue("Softphone:AllowManualDialing", true);
var clientOptions = new SoftphoneClientOptions(managedMode, allowManualDialing, clientVersion);
var allowedOrigins = builder.Configuration
    .GetSection("Softphone:AllowedOrigins")
    .GetChildren()
    .Select(entry => NormalizeOrigin(entry.Value))
    .Where(origin => origin is not null)
    .Cast<string>()
    .ToHashSet(StringComparer.OrdinalIgnoreCase);
var localControlOrigin = NormalizeOrigin(webUrl);
if (localControlOrigin is not null)
{
    allowedOrigins.Add(localControlOrigin);
}
builder.WebHost.UseUrls(webUrl);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddSingleton<SipPhoneService>();
builder.Services.AddSingleton(clientOptions);
builder.Services.AddSingleton<RelaySettingsStore>();
builder.Services.AddSingleton<SoftphoneRelayService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<SoftphoneRelayService>());

var app = builder.Build();

app.Use(async (context, next) =>
{
    if (!context.Request.Path.StartsWithSegments("/api"))
    {
        await next();
        return;
    }

    if (context.Connection.RemoteIpAddress is null || !IPAddress.IsLoopback(context.Connection.RemoteIpAddress))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new ApiError("The softphone API is available only from this computer."));
        return;
    }

    var requestOrigin = context.Request.Headers.Origin.ToString();
    if (!string.IsNullOrWhiteSpace(requestOrigin))
    {
        var normalizedRequestOrigin = NormalizeOrigin(requestOrigin);
        if (normalizedRequestOrigin is null || !allowedOrigins.Contains(normalizedRequestOrigin))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new ApiError("Untrusted request origin."));
            return;
        }

        context.Response.Headers.AccessControlAllowOrigin = requestOrigin;
        context.Response.Headers.Append("Vary", "Origin");
        context.Response.Headers.AccessControlAllowMethods = "GET, POST, DELETE, OPTIONS";
        context.Response.Headers.AccessControlAllowHeaders = "Content-Type";
        context.Response.Headers.AccessControlMaxAge = "600";
        // Kept for browsers that still implement the earlier Private Network Access preflight.
        context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";

        if (HttpMethods.IsOptions(context.Request.Method))
        {
            context.Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }
    }

    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/status", (SipPhoneService phone) => phone.GetSnapshot());
app.MapGet("/api/client", (SoftphoneClientOptions options) =>
    new SoftphoneClientStatus(options.ManagedMode, options.AllowManualDialing, options.Version));

app.MapPost("/api/register", async (RegisterRequest request, SipPhoneService phone, SoftphoneClientOptions options) =>
{
    if (options.ManagedMode) return Results.Conflict(new ApiError("Phone registration is managed by RX Tracker. Ask an Administrator to change the assigned account."));
    return await RunPhoneOperation(() => phone.RegisterAsync(request));
});

app.MapPost("/api/unregister", async (SipPhoneService phone, SoftphoneClientOptions options) =>
{
    if (options.ManagedMode) return Results.Conflict(new ApiError("Phone registration is managed by RX Tracker. An Administrator can revoke the workstation pairing."));
    return await RunPhoneOperation(phone.UnregisterAsync);
});

app.MapPost("/api/calls", async (DialRequest request, SipPhoneService phone, SoftphoneClientOptions options) =>
{
    if (options.ManagedMode && !options.AllowManualDialing) {
        return Results.Conflict(new ApiError("Manual dialing is disabled. Start the call from RX Tracker."));
    }
    return await RunPhoneOperation(() => phone.DialAsync(request.Destination, request.CorrelationId));
});

app.MapPost("/api/calls/answer", async (SipPhoneService phone) =>
    await RunPhoneOperation(phone.AnswerAsync));

app.MapPost("/api/calls/reject", async (SipPhoneService phone) =>
    await RunPhoneOperation(phone.RejectAsync));

app.MapDelete("/api/calls/current", async (SipPhoneService phone) =>
    await RunPhoneOperation(phone.HangupAsync));

app.MapPost("/api/calls/mute", async (MuteRequest request, SipPhoneService phone) =>
    await RunPhoneOperation(() => phone.SetMutedAsync(request.Muted)));

app.MapPost("/api/calls/dtmf", async (DtmfRequest request, SipPhoneService phone) =>
    await RunPhoneOperation(() => phone.SendDtmfAsync(request.Tone)));

app.MapGet("/api/relay/status", (SoftphoneRelayService relay) => relay.GetStatus());

app.MapPost("/api/relay/pair", async (RelayPairRequest request, SoftphoneRelayService relay, CancellationToken cancellationToken) =>
    await RunRelayOperation(() => relay.PairAsync(request, cancellationToken)));

app.MapDelete("/api/relay/pairing", (SoftphoneRelayService relay, SoftphoneClientOptions options) =>
{
    if (options.ManagedMode) {
        return Results.Conflict(new ApiError("This managed pairing can be revoked only from RX Tracker Administration > Phone Devices."));
    }
    relay.Disconnect();
    return Results.Ok(relay.GetStatus());
});

app.MapFallbackToFile("index.html");

var phoneService = app.Services.GetRequiredService<SipPhoneService>();
app.Lifetime.ApplicationStopping.Register(() => phoneService.DisposeAsync().AsTask().GetAwaiter().GetResult());

if (!noBrowser)
{
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        try
        {
            Process.Start(new ProcessStartInfo(webUrl) { UseShellExecute = true });
        }
        catch
        {
            // The URL is also shown in the console if no default browser is available.
        }
    });
}

await app.RunAsync();

static string? NormalizeOrigin(string? value)
{
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
        uri.Scheme is not "http" and not "https" ||
        !string.IsNullOrEmpty(uri.PathAndQuery) && uri.PathAndQuery != "/" ||
        !string.IsNullOrEmpty(uri.Fragment) ||
        !string.IsNullOrEmpty(uri.UserInfo))
    {
        return null;
    }

    return uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
}

static async Task<IResult> RunPhoneOperation(Func<Task<PhoneSnapshot>> operation)
{
    try
    {
        return Results.Ok(await operation());
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new ApiError(ex.Message));
    }
    catch (PhoneOperationException ex)
    {
        return Results.Conflict(new ApiError(ex.Message));
    }
    catch (Exception)
    {
        return Results.Problem(
            title: "Softphone operation failed",
            detail: "Check the softphone event log for details.",
            statusCode: StatusCodes.Status500InternalServerError);
    }
}

static async Task<IResult> RunRelayOperation(Func<Task<RelayPairResult>> operation)
{
    try
    {
        return Results.Ok(await operation());
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new ApiError(ex.Message));
    }
    catch (PhoneOperationException ex)
    {
        return Results.Conflict(new ApiError(ex.Message));
    }
    catch (Exception)
    {
        return Results.Problem(
            title: "Relay operation failed",
            detail: "The Windows softphone could not complete the relay operation.",
            statusCode: StatusCodes.Status500InternalServerError);
    }
}
