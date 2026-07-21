using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net;

namespace RxSoftphone;

public sealed class SoftphoneRelayService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(800);
    private static readonly TimeSpan MaximumFailureDelay = TimeSpan.FromSeconds(5);
    private readonly SipPhoneService _phone;
    private readonly RelaySettingsStore _store;
    private readonly SoftphoneClientOptions _clientOptions;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private readonly object _stateLock = new();
    private readonly SemaphoreSlim _pairGate = new(1, 1);
    private readonly List<RelayCommandResult> _completed = [];
    private string? _trackerUrl;
    private string? _deviceName;
    private string? _token;
    private string? _accountUpdatedAt;
    private RegisterRequest? _pendingRegistration;
    private string? _pendingAccountUpdatedAt;
    private RelayCommand? _pendingCommand;
    private ManagedDevicePolicy? _policy;
    private bool _connected;
    private DateTimeOffset? _lastConnectedAt;
    private string? _error;
    private int _consecutiveFailures;

    public SoftphoneRelayService(SipPhoneService phone, RelaySettingsStore store, SoftphoneClientOptions clientOptions)
    {
        _phone = phone;
        _store = store;
        _clientOptions = clientOptions;
        var saved = store.Load();
        if (saved is not null)
        {
            _trackerUrl = saved.Value.TrackerUrl;
            _deviceName = saved.Value.DeviceName;
            _token = saved.Value.Token;
        }
    }

    public RelayStatus GetStatus()
    {
        lock (_stateLock)
        {
            return new RelayStatus(
                !string.IsNullOrWhiteSpace(_trackerUrl) && !string.IsNullOrWhiteSpace(_token),
                _connected,
                _trackerUrl,
                _deviceName,
                _lastConnectedAt,
                _error,
                _clientOptions.Version,
                _clientOptions.ManagedMode,
                _clientOptions.AllowManualDialing,
                _policy);
        }
    }

    public async Task<RelayPairResult> PairAsync(RelayPairRequest request, CancellationToken cancellationToken = default)
    {
        await _pairGate.WaitAsync(cancellationToken);
        try
        {
            lock (_stateLock)
            {
                if (!string.IsNullOrWhiteSpace(_token))
                {
                    throw new PhoneOperationException("This workstation is already paired. An Administrator must revoke the current pairing before it can be replaced.");
                }
            }
            var trackerUrl = NormalizeTrackerUrl(request.TrackerUrl);
            var pairingCode = new string((request.PairingCode ?? string.Empty).Where(char.IsDigit).ToArray());
            if (pairingCode.Length != 8) throw new ArgumentException("Enter the 8-digit pairing code shown in RX Tracker.");
            var deviceName = $"{Environment.MachineName} RX Softphone";
            using var response = await _http.PostAsJsonAsync(
                ApiUrl(trackerUrl, "api/softphone-relay/device/pair"),
                new RelayPairPayload(pairingCode, deviceName, ClientInfo()),
                cancellationToken);
            var body = await response.Content.ReadFromJsonAsync<RelayPairResponse>(cancellationToken: cancellationToken);
            if (!response.IsSuccessStatusCode || body is null || string.IsNullOrWhiteSpace(body.DeviceToken))
            {
                throw new PhoneOperationException(await ReadErrorAsync(response, "Pairing was rejected.", cancellationToken));
            }

            _store.Save(trackerUrl, deviceName, body.DeviceToken);
            lock (_stateLock)
            {
                _trackerUrl = trackerUrl;
                _deviceName = deviceName;
                _token = body.DeviceToken;
                _accountUpdatedAt = null;
                _pendingRegistration = null;
                _pendingAccountUpdatedAt = null;
                _pendingCommand = null;
                _policy = body.Policy;
                _connected = false;
                _error = null;
                _consecutiveFailures = 0;
            }
            return new RelayPairResult(true, trackerUrl, deviceName);
        }
        finally
        {
            _pairGate.Release();
        }
    }

    public void Disconnect()
    {
        _store.Clear();
        lock (_stateLock)
        {
            _trackerUrl = null;
            _deviceName = null;
            _token = null;
            _accountUpdatedAt = null;
            _pendingRegistration = null;
            _pendingAccountUpdatedAt = null;
            _pendingCommand = null;
            _policy = null;
            _connected = false;
            _lastConnectedAt = null;
            _error = null;
            _completed.Clear();
            _consecutiveFailures = 0;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = PollInterval;
            try
            {
                await PollOnceAsync(stoppingToken);
                lock (_stateLock) _consecutiveFailures = 0;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                lock (_stateLock)
                {
                    _connected = false;
                    _error = SafeError(ex);
                    _consecutiveFailures = Math.Min(_consecutiveFailures + 1, 8);
                    var milliseconds = Math.Min(
                        MaximumFailureDelay.TotalMilliseconds,
                        PollInterval.TotalMilliseconds * Math.Pow(1.65, _consecutiveFailures));
                    delay = TimeSpan.FromMilliseconds(milliseconds);
                }
            }

            await Task.Delay(delay, stoppingToken);
        }
    }

    private async Task PollOnceAsync(CancellationToken cancellationToken)
    {
        string? trackerUrl;
        string? token;
        string? accountUpdatedAt;
        List<RelayCommandResult> completed;
        lock (_stateLock)
        {
            trackerUrl = _trackerUrl;
            token = _token;
            accountUpdatedAt = _accountUpdatedAt;
            completed = [.. _completed];
        }
        if (string.IsNullOrWhiteSpace(trackerUrl) || string.IsNullOrWhiteSpace(token)) return;

        var request = new HttpRequestMessage(HttpMethod.Post, ApiUrl(trackerUrl, "api/softphone-relay/device/poll"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Content = JsonContent.Create(new RelayPollPayload(_phone.GetSnapshot(), accountUpdatedAt, completed, ClientInfo()));
        using var response = await _http.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            await InvalidatePairingAsync("RX Tracker revoked or replaced this workstation pairing. Generate a new pairing code to reconnect.");
            return;
        }
        if (!response.IsSuccessStatusCode)
        {
            throw new PhoneOperationException(await ReadErrorAsync(response, "Relay connection was rejected.", cancellationToken));
        }
        var poll = await response.Content.ReadFromJsonAsync<RelayPollResponse>(cancellationToken: cancellationToken)
            ?? throw new PhoneOperationException("Relay returned an invalid response.");

        lock (_stateLock)
        {
            if (completed.Count > 0) _completed.RemoveAll(item => completed.Any(sent => sent.CommandId == item.CommandId));
            _connected = true;
            _lastConnectedAt = DateTimeOffset.UtcNow;
            _error = null;
            _policy = poll.Policy;
        }

        if (poll.Registration is not null)
        {
            lock (_stateLock)
            {
                _pendingRegistration = poll.Registration;
                _pendingAccountUpdatedAt = poll.AccountUpdatedAt;
            }
        }
        else if (poll.Policy is { AccountAssigned: false })
        {
            var snapshot = _phone.GetSnapshot();
            if (snapshot.Registration != "offline" || !string.IsNullOrWhiteSpace(accountUpdatedAt))
            {
                await _phone.UnregisterAsync();
            }
            lock (_stateLock)
            {
                _accountUpdatedAt = null;
                _pendingRegistration = null;
                _pendingAccountUpdatedAt = null;
            }
        }

        if (poll.Command is not null)
        {
            lock (_stateLock)
            {
                if (_pendingCommand is null)
                {
                    _pendingCommand = poll.Command;
                }
                else if (_pendingCommand.Id != poll.Command.Id)
                {
                    _completed.Add(new RelayCommandResult(poll.Command.Id, false, "Another relay command is still pending."));
                }
            }
        }

        await ApplyPendingRegistrationAsync();
        await ExecutePendingCommandAsync();
    }

    private async Task ApplyPendingRegistrationAsync()
    {
        RegisterRequest? registration;
        string? accountUpdatedAt;
        lock (_stateLock)
        {
            registration = _pendingRegistration;
            accountUpdatedAt = _pendingAccountUpdatedAt;
        }
        if (registration is null) return;

        var snapshot = _phone.GetSnapshot();
        if (IsCallBusy(snapshot.Call)) return;

        try
        {
            await _phone.RegisterAsync(registration);
        }
        finally
        {
            lock (_stateLock)
            {
                if (ReferenceEquals(_pendingRegistration, registration))
                {
                    _pendingRegistration = null;
                    _pendingAccountUpdatedAt = null;
                    _accountUpdatedAt = accountUpdatedAt;
                }
            }
        }
    }

    private async Task ExecutePendingCommandAsync()
    {
        RelayCommand? command;
        lock (_stateLock) command = _pendingCommand;
        if (command is null) return;
        if (command.Type.Equals("dial", StringComparison.OrdinalIgnoreCase)
            && _phone.GetSnapshot().Registration != "registered")
        {
            if (command.ExpiresAt > DateTimeOffset.UtcNow) return;
        }
        await ExecuteCommandAsync(command);
        lock (_stateLock)
        {
            if (_pendingCommand?.Id == command.Id) _pendingCommand = null;
        }
    }

    private async Task ExecuteCommandAsync(RelayCommand command)
    {
        RelayCommandResult result;
        try
        {
            if (command.ExpiresAt <= DateTimeOffset.UtcNow) throw new PhoneOperationException("Relay command expired before delivery.");
            switch (command.Type.ToLowerInvariant())
            {
                case "dial":
                    if (string.IsNullOrWhiteSpace(command.Payload.Destination)) throw new PhoneOperationException("Relay dial command has no destination.");
                    await _phone.DialAsync(command.Payload.Destination, command.Payload.CorrelationId);
                    break;
                case "hangup":
                    await _phone.HangupAsync();
                    break;
                default:
                    throw new PhoneOperationException("Unsupported relay command.");
            }
            result = new RelayCommandResult(command.Id, true, null);
        }
        catch (Exception ex)
        {
            result = new RelayCommandResult(command.Id, false, SafeError(ex));
        }
        lock (_stateLock) _completed.Add(result);
    }

    private async Task InvalidatePairingAsync(string message)
    {
        _store.Clear();
        var snapshot = _phone.GetSnapshot();
        if (snapshot.Registration != "offline")
        {
            await _phone.UnregisterAsync();
        }
        lock (_stateLock)
        {
            _token = null;
            _accountUpdatedAt = null;
            _pendingRegistration = null;
            _pendingAccountUpdatedAt = null;
            _pendingCommand = null;
            _policy = null;
            _connected = false;
            _lastConnectedAt = null;
            _error = message;
            _completed.Clear();
        }
    }

    private RelayClientInfo ClientInfo() => new(
        _clientOptions.Version,
        _clientOptions.ManagedMode,
        _clientOptions.AllowManualDialing);

    private static bool IsCallBusy(string? call) =>
        call is "dialing" or "trying" or "ringing" or "answering" or "connected" or "incoming";

    private static string NormalizeTrackerUrl(string? value)
    {
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme is not "http" and not "https"
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new ArgumentException("Enter the RX Tracker address beginning with http:// or https://.");
        }
        if (uri.Scheme == "http" && !IsPrivateHost(uri.Host))
        {
            throw new ArgumentException("A public RX Tracker relay address must use HTTPS. HTTP is allowed only for localhost or a private LAN address.");
        }
        return uri.GetLeftPart(UriPartial.Path).TrimEnd('/');
    }

    private static bool IsPrivateHost(string host)
    {
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (!IPAddress.TryParse(host, out var address)) return false;
        if (IPAddress.IsLoopback(address)) return true;
        var bytes = address.GetAddressBytes();
        return address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && (
            bytes[0] == 10
            || bytes[0] == 192 && bytes[1] == 168
            || bytes[0] == 172 && bytes[1] is >= 16 and <= 31);
    }

    private static Uri ApiUrl(string trackerUrl, string path) => new($"{trackerUrl.TrimEnd('/')}/{path.TrimStart('/')}");

    private static async Task<string> ReadErrorAsync(HttpResponseMessage response, string fallback, CancellationToken cancellationToken)
    {
        try
        {
            var error = await response.Content.ReadFromJsonAsync<ApiError>(cancellationToken: cancellationToken);
            return string.IsNullOrWhiteSpace(error?.Error) ? $"{fallback} ({(int)response.StatusCode})" : error.Error;
        }
        catch
        {
            return $"{fallback} ({(int)response.StatusCode})";
        }
    }

    private static string SafeError(Exception ex)
    {
        var message = ex.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return message.Length <= 240 ? message : message[..240];
    }

    public override void Dispose()
    {
        _http.Dispose();
        _pairGate.Dispose();
        base.Dispose();
    }
}
