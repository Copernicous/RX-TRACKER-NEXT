using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using SIPSorcery.Media;
using SIPSorcery.Net;
using SIPSorcery.SIP;
using SIPSorcery.SIP.App;
using SIPSorceryMedia.Windows;

namespace RxSoftphone;

public sealed partial class SipPhoneService : IAsyncDisposable
{
    private const int RegistrationExpirySeconds = 300;
    private const int KeepAliveSeconds = 15;
    private const int MaxEvents = 80;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _stateLock = new();
    private readonly List<PhoneEvent> _events = [];
    private readonly LocalRingTone _ringTone = new();

    private SIPTransport? _transport;
    private SIPUDPChannel? _udpChannel;
    private SIPRegistrationUserAgent? _registrationAgent;
    private SIPUserAgent? _userAgent;
    private SIPServerUserAgent? _pendingIncomingCall;
    private VoIPMediaSession? _mediaSession;
    private WindowsAudioEndPoint? _audioEndPoint;
    private CancellationTokenSource? _keepAliveCancellation;
    private Task? _keepAliveTask;

    private string _registration = "offline";
    private string _call = "idle";
    private string? _peer;
    private bool _incoming;
    private bool _muted;
    private string? _callId;
    private DateTimeOffset? _dialedAt;
    private DateTimeOffset? _ringingAt;
    private DateTimeOffset? _connectedAt;
    private DateTimeOffset? _endedAt;
    private string? _outcome;
    private int? _sipResponseCode;
    private string? _sipReason;
    private long _eventSequence;

    private string _server = string.Empty;
    private int _port = 5060;
    private string _username = string.Empty;
    private string _authId = string.Empty;
    private string _password = string.Empty;
    private string? _displayName;
    private int _localSipPort;
    private bool _registrationPermanentlyFailed;
    private bool _disposed;

    public SipPhoneService()
    {
        AddEvent("info", "Native SIP engine ready. Enter the password and register to the PBX.");
    }

    public PhoneSnapshot GetSnapshot()
    {
        lock (_stateLock)
        {
            return new PhoneSnapshot(
                _registration,
                _call,
                _peer,
                _incoming,
                _muted,
                _callId,
                _dialedAt,
                _ringingAt,
                _connectedAt,
                _endedAt,
                _outcome,
                _sipResponseCode,
                _sipReason,
                _server,
                _port,
                _username,
                _localSipPort,
                _events.ToArray());
        }
    }

    public async Task<PhoneSnapshot> RegisterAsync(RegisterRequest request)
    {
        var server = ValidateServer(request.Server);
        var port = ValidatePort(request.Port, nameof(request.Port));
        var username = ValidateRequired(request.Username, "SIP username", 128);
        var authId = string.IsNullOrWhiteSpace(request.AuthId)
            ? username
            : ValidateRequired(request.AuthId, "SIP Auth ID", 128);
        var password = ValidateRequired(request.Password, "SIP password", 256);
        var localPort = request.LocalSipPort is null or 0
            ? 0
            : ValidatePort(request.LocalSipPort.Value, nameof(request.LocalSipPort));

        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            await StopInternalAsync(clearAccount: true);

            _server = server;
            _port = port;
            _username = username;
            _authId = authId;
            _password = password;
            _displayName = string.IsNullOrWhiteSpace(request.DisplayName) ? username : request.DisplayName.Trim();
            _registrationPermanentlyFailed = false;
            _registration = "registering";
            AddEvent("info", $"Registering extension {username} to {server}:{port} over SIP/UDP.");

            try
            {
                _transport = new SIPTransport();
                _udpChannel = new SIPUDPChannel(new IPEndPoint(IPAddress.Any, localPort));
                _transport.AddSIPChannel(_udpChannel);
                _localSipPort = _udpChannel.Port;
                _transport.SIPTransportRequestReceived += OnSipRequestReceived;

                _userAgent = new SIPUserAgent(_transport, null);
                WireUserAgent(_userAgent);

                var registrar = $"sip:{server}:{port};transport=udp";
                var accountAor = SIPURI.ParseSIPURI($"sip:{username}@{server}");
                var contactUri = new SIPURI(accountAor.Scheme, IPAddress.Any, _localSipPort)
                {
                    User = username
                };
                _registrationAgent = new SIPRegistrationUserAgent(
                    _transport,
                    null,
                    accountAor,
                    authId,
                    password,
                    null,
                    registrar,
                    contactUri,
                    RegistrationExpirySeconds,
                    null);
                _registrationAgent.UserDisplayName = _displayName;

                _registrationAgent.RegistrationSuccessful += (_, _) =>
                {
                    _registrationPermanentlyFailed = false;
                    SetRegistration("registered");
                    AddEvent("success", $"Extension {username} is registered.");
                };
                _registrationAgent.RegistrationTemporaryFailure += (_, response, message) =>
                {
                    SetRegistration("retrying");
                    AddEvent("warning", SafeSipFailure("Registration will retry", response, message));
                };
                _registrationAgent.RegistrationFailed += (_, response, message) =>
                {
                    _registrationPermanentlyFailed = true;
                    SetRegistration("failed");
                    AddEvent("error", SafeSipFailure("Registration failed", response, message));
                    AddEvent("warning", "Automatic registration stopped. Correct the assigned phone account in RX Tracker before trying again.");
                    _password = string.Empty;
                    _registrationAgent?.Stop();
                };
                _registrationAgent.RegistrationRemoved += (_, _) =>
                {
                    if (_registrationPermanentlyFailed) return;
                    SetRegistration("offline");
                    AddEvent("info", "PBX registration removed.");
                };

                _registrationAgent.Start();
                StartKeepAlive();
                AddEvent("info", $"Local SIP socket opened on UDP port {_localSipPort}.");
                AddEvent("info", $"Registration refresh is {RegistrationExpirySeconds}s; UDP keep-alive is {KeepAliveSeconds}s.");
            }
            catch (Exception ex)
            {
                SetRegistration("failed");
                AddEvent("error", $"Could not start SIP registration: {SafeMessage(ex)}");
                await StopInternalAsync(clearAccount: true);
                throw new PhoneOperationException("Could not start the native SIP registration. See the event log.");
            }

            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> UnregisterAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            await StopInternalAsync(clearAccount: true);
            AddEvent("info", "Softphone unregistered; the in-memory password was cleared.");
            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> DialAsync(string destination, string? correlationId = null)
    {
        var normalized = NormalizeDestination(destination);

        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            EnsureRegistered();

            if (_userAgent is null || _userAgent.IsCallActive || _call is not "idle" and not "ended" and not "failed")
            {
                throw new PhoneOperationException("Another call is already in progress.");
            }

            ResetCallTelemetry(normalized, correlationId, incoming: false);
            StopLocalRingTone();
            SetCall("dialing");
            AddEvent("info", $"Calling {normalized} through {_server}:{_port}.");

            var destinationUri = $"sip:{normalized}@{_server}:{_port};transport=udp";
            var media = CreateMediaSession();
            _ = PlaceCallAsync(destinationUri, media);

            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> AnswerAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            if (_userAgent is null || _pendingIncomingCall is null)
            {
                throw new PhoneOperationException("There is no incoming call to answer.");
            }

            var pending = _pendingIncomingCall;
            StopLocalRingTone();
            _mediaSession = CreateMediaSession();
            SetCall("answering");
            AddEvent("info", $"Answering incoming call from {_peer ?? "unknown"}.");

            var answered = await _userAgent.Answer(pending, _mediaSession);
            if (!answered)
            {
                CleanupCall("failed", "failed");
                throw new PhoneOperationException("The incoming call could not be answered.");
            }

            _pendingIncomingCall = null;
            MarkConnected(null);
            SetCall("connected");
            AddEvent("success", "Call connected.");
            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> RejectAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            if (_pendingIncomingCall is null)
            {
                throw new PhoneOperationException("There is no incoming call to reject.");
            }

            _pendingIncomingCall.Reject(SIPResponseStatusCodesEnum.BusyHere, null, null);
            AddEvent("info", $"Incoming call from {_peer ?? "unknown"} was rejected.");
            CleanupCall("ended", "rejected");
            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> HangupAsync()
    {
        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            var finalOutcome = _connectedAt.HasValue ? "answered" : (_incoming ? "rejected" : "cancelled");
            // SIPSorcery raises ClientCallFailed synchronously when Cancel is
            // used before answer. Preserve the user's explicit local hangup
            // intent before that callback can classify it as a generic failure.
            lock (_stateLock)
            {
                _outcome = finalOutcome;
            }
            if (_pendingIncomingCall is not null)
            {
                _pendingIncomingCall.Reject(SIPResponseStatusCodesEnum.BusyHere, null, null);
            }
            else if (_userAgent?.IsCallActive == true)
            {
                _userAgent.Hangup();
            }
            else
            {
                _userAgent?.Cancel();
            }

            AddEvent("info", "Call ended locally.");
            CleanupCall("ended", finalOutcome);
            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> SetMutedAsync(bool muted)
    {
        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            if (_audioEndPoint is null || _call != "connected")
            {
                throw new PhoneOperationException("Mute is available only during a connected call.");
            }

            if (muted)
            {
                await _audioEndPoint.PauseAudio();
            }
            else
            {
                await _audioEndPoint.ResumeAudio();
            }

            _muted = muted;
            AddEvent("info", muted ? "Microphone muted." : "Microphone unmuted.");
            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<PhoneSnapshot> SendDtmfAsync(string tone)
    {
        var value = ParseDtmf(tone);
        await _gate.WaitAsync();
        try
        {
            ThrowIfDisposed();
            if (_userAgent is null || _call != "connected")
            {
                throw new PhoneOperationException("DTMF is available only during a connected call.");
            }

            await _userAgent.SendDtmf(value);
            AddEvent("info", $"DTMF {tone.Trim()} sent.");
            return GetSnapshot();
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task PlaceCallAsync(string destinationUri, VoIPMediaSession media)
    {
        try
        {
            var userAgent = _userAgent;
            if (userAgent is null)
            {
                return;
            }

            var fromUri = $"sip:{_username}@{_server}";
            var callDescriptor = new SIPCallDescriptor(
                _username,
                _password,
                destinationUri,
                fromUri,
                destinationUri,
                null,
                null,
                _authId,
                SIPCallDirection.Out,
                null,
                null,
                null);
            var ok = await userAgent.Call(callDescriptor, media);
            if (!ok && _call is not "ended")
            {
                AddEvent("error", "The PBX did not establish the call.");
                CleanupCall("failed", _outcome ?? "failed");
            }
        }
        catch (Exception ex)
        {
            AddEvent("error", $"Call failed: {SafeMessage(ex)}");
            CleanupCall("failed", ClassifySipFailure(null, ex.Message));
        }
    }

    private VoIPMediaSession CreateMediaSession()
    {
        _audioEndPoint = new WindowsAudioEndPoint(new AudioEncoder());
        _mediaSession = new VoIPMediaSession(_audioEndPoint.ToMediaEndPoints())
        {
            AcceptRtpFromAny = true
        };
        return _mediaSession;
    }

    private void WireUserAgent(SIPUserAgent userAgent)
    {
        userAgent.ClientCallTrying += (_, response) =>
        {
            CaptureSipResponse(response);
            SetCall("trying");
            AddEvent("info", $"PBX is processing the call ({response.StatusCode}).");
        };
        userAgent.ClientCallRinging += (_, response) =>
        {
            MarkRinging(response);
            SetCall("ringing");
            StartLocalRingTone("Local ringback");
            AddEvent("info", $"Remote phone is ringing ({response.StatusCode}).");
        };
        userAgent.ClientCallAnswered += (_, response) =>
        {
            StopLocalRingTone();
            MarkConnected(response);
            SetCall("connected");
            AddEvent("success", $"Call answered ({response.StatusCode}).");
        };
        userAgent.ClientCallFailed += (_, message, response) =>
        {
            AddEvent("error", SafeSipFailure("Call failed", response, message));
            CleanupCall("failed", ClassifySipFailure(response, message), response);
        };
        userAgent.OnCallHungup += _ =>
        {
            AddEvent("info", "The remote party ended the call.");
            CleanupCall("ended", _connectedAt.HasValue ? "answered" : "no_answer");
        };
        userAgent.ServerCallCancelled += (_, _) =>
        {
            AddEvent("info", "Incoming call was cancelled.");
            CleanupCall("ended", "cancelled");
        };
        userAgent.OnDtmfTone += (tone, duration) =>
            AddEvent("info", $"Received DTMF {tone} ({duration} ms).");
    }

    private Task OnSipRequestReceived(SIPEndPoint local, SIPEndPoint remote, SIPRequest request)
    {
        if (request.Method == SIPMethodsEnum.OPTIONS)
        {
            var ok = SIPResponse.GetResponse(request, SIPResponseStatusCodesEnum.Ok, null);
            return _transport!.SendResponseAsync(ok);
        }

        if (request.Header.From?.FromTag is not null && request.Header.To?.ToTag is not null)
        {
            // In-dialog requests are handled by SIPUserAgent.
            return Task.CompletedTask;
        }

        if (request.Method == SIPMethodsEnum.INVITE &&
            request.Header.From?.FromTag is not null &&
            request.Header.To?.ToTag is null)
        {
            if (_userAgent is null || _userAgent.IsCallActive || _pendingIncomingCall is not null)
            {
                var transaction = new UASInviteTransaction(_transport!, request, null);
                var busy = SIPResponse.GetResponse(request, SIPResponseStatusCodesEnum.BusyHere, null);
                transaction.SendFinalResponse(busy);
                return Task.CompletedTask;
            }

            _pendingIncomingCall = _userAgent.AcceptCall(request);
            ResetCallTelemetry(request.Header.From?.FromURI?.User ?? "unknown", null, incoming: true);
            SetCall("incoming");
            StartLocalRingTone("Incoming ringtone");
            AddEvent("warning", $"Incoming call from {_peer}.");
            return Task.CompletedTask;
        }

        if (request.Method == SIPMethodsEnum.ACK)
        {
            return Task.CompletedTask;
        }

        var notAllowed = SIPResponse.GetResponse(request, SIPResponseStatusCodesEnum.MethodNotAllowed, null);
        return _transport!.SendResponseAsync(notAllowed);
    }

    private async Task StopInternalAsync(bool clearAccount)
    {
        _keepAliveCancellation?.Cancel();
        if (_keepAliveTask is not null)
        {
            try
            {
                await _keepAliveTask.WaitAsync(TimeSpan.FromSeconds(1));
            }
            catch (OperationCanceledException)
            {
                // Expected when unregistering or exiting.
            }
            catch (TimeoutException)
            {
                // Do not delay SIP shutdown for a DNS lookup or socket send.
            }
        }
        _keepAliveCancellation?.Dispose();
        _keepAliveCancellation = null;
        _keepAliveTask = null;

        try
        {
            if (_userAgent?.IsCallActive == true)
            {
                _userAgent.Hangup();
            }
            else
            {
                _userAgent?.Cancel();
            }
        }
        catch
        {
            // Continue shutdown even if the call has already ended.
        }

        _pendingIncomingCall = null;
        _registrationAgent?.Stop();
        if (_registrationAgent is not null)
        {
            await Task.Delay(750);
        }

        _transport?.Shutdown();
        _registrationAgent = null;
        _userAgent = null;
        _transport = null;
        _udpChannel = null;
        _registrationPermanentlyFailed = false;
        CleanupCall("idle");
        SetRegistration("offline");
        _localSipPort = 0;

        if (clearAccount)
        {
            _authId = string.Empty;
            _password = string.Empty;
        }
    }

    private void CleanupCall(string finalState, string? outcome = null, SIPResponse? response = null)
    {
        StopLocalRingTone();
        try
        {
            _mediaSession?.Close("call finished");
        }
        catch
        {
            // Media may already have been closed by the SIP stack.
        }

        _pendingIncomingCall = null;
        _mediaSession = null;
        _audioEndPoint = null;
        _incoming = false;
        _muted = false;
        lock (_stateLock)
        {
            if (response is not null)
            {
                _sipResponseCode = (int)response.Status;
                _sipReason = SafeText(response.ReasonPhrase);
            }
            if (_callId is not null && finalState is "ended" or "failed" or "idle")
            {
                _endedAt ??= DateTimeOffset.UtcNow;
                _outcome = _connectedAt.HasValue ? "answered" : (_outcome ?? outcome ?? (finalState == "failed" ? "failed" : "cancelled"));
            }
        }
        SetCall(finalState);
    }

    private void StartLocalRingTone(string label)
    {
        try
        {
            if (_ringTone.Start())
            {
                AddEvent("info", $"{label} started on the default Windows speaker.");
            }
        }
        catch (Exception ex)
        {
            AddEvent("warning", $"{label} could not start: {SafeMessage(ex)}");
        }
    }

    private void StopLocalRingTone()
    {
        try
        {
            _ringTone.Stop();
        }
        catch (Exception ex)
        {
            AddEvent("warning", $"Local ringing audio could not stop cleanly: {SafeMessage(ex)}");
        }
    }

    private void ResetCallTelemetry(string peer, string? correlationId, bool incoming)
    {
        lock (_stateLock)
        {
            _peer = peer;
            _incoming = incoming;
            _muted = false;
            _callId = NormalizeCorrelationId(correlationId);
            _dialedAt = DateTimeOffset.UtcNow;
            _ringingAt = null;
            _connectedAt = null;
            _endedAt = null;
            _outcome = null;
            _sipResponseCode = null;
            _sipReason = null;
        }
    }

    private void CaptureSipResponse(SIPResponse? response)
    {
        if (response is null) return;
        lock (_stateLock)
        {
            _sipResponseCode = (int)response.Status;
            _sipReason = SafeText(response.ReasonPhrase);
        }
    }

    private void MarkRinging(SIPResponse? response)
    {
        CaptureSipResponse(response);
        lock (_stateLock)
        {
            _ringingAt ??= DateTimeOffset.UtcNow;
        }
    }

    private void MarkConnected(SIPResponse? response)
    {
        CaptureSipResponse(response);
        lock (_stateLock)
        {
            _connectedAt ??= DateTimeOffset.UtcNow;
            _outcome = "answered";
        }
    }

    private void StartKeepAlive()
    {
        _keepAliveCancellation?.Cancel();
        _keepAliveCancellation?.Dispose();
        _keepAliveCancellation = new CancellationTokenSource();
        _keepAliveTask = RunKeepAliveAsync(_keepAliveCancellation.Token);
    }

    private async Task RunKeepAliveAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(KeepAliveSeconds));
        var failureReported = false;

        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                string registration;
                lock (_stateLock)
                {
                    registration = _registration;
                }

                var transport = _transport;
                var udpChannel = _udpChannel;
                if (registration != "registered" || transport is null || udpChannel is null)
                {
                    continue;
                }

                try
                {
                    var address = await ResolveServerAddressAsync(_server, cancellationToken);
                    var remote = new SIPEndPoint(
                        SIPProtocolsEnum.udp,
                        new IPEndPoint(address, _port));
                    var result = await transport.SendRawAsync(
                        udpChannel.ListeningSIPEndPoint,
                        remote,
                        [0x0d, 0x0a]);

                    if (result != SocketError.Success)
                    {
                        if (!failureReported)
                        {
                            AddEvent("warning", $"SIP keep-alive send failed: {result}.");
                            failureReported = true;
                        }
                    }
                    else
                    {
                        failureReported = false;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    if (!failureReported)
                    {
                        AddEvent("warning", $"SIP keep-alive failed: {SafeMessage(ex)}");
                        failureReported = true;
                    }
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Expected when unregistering or exiting.
        }
    }

    private static async Task<IPAddress> ResolveServerAddressAsync(
        string server,
        CancellationToken cancellationToken)
    {
        if (IPAddress.TryParse(server, out var parsed))
        {
            return parsed;
        }

        var addresses = await Dns.GetHostAddressesAsync(server, cancellationToken);
        return addresses.FirstOrDefault(address => address.AddressFamily == AddressFamily.InterNetwork)
            ?? throw new InvalidOperationException("The PBX host did not resolve to an IPv4 address.");
    }

    private void EnsureRegistered()
    {
        if (_registration != "registered" || _transport is null || _userAgent is null || string.IsNullOrEmpty(_password))
        {
            throw new PhoneOperationException("Register to the PBX before placing a call.");
        }
    }

    private void SetRegistration(string value)
    {
        lock (_stateLock)
        {
            _registration = value;
        }
    }

    private void SetCall(string value)
    {
        lock (_stateLock)
        {
            _call = value;
        }
    }

    private void AddEvent(string level, string message)
    {
        lock (_stateLock)
        {
            _events.Add(new PhoneEvent(++_eventSequence, DateTimeOffset.UtcNow, level, message));
            if (_events.Count > MaxEvents)
            {
                _events.RemoveRange(0, _events.Count - MaxEvents);
            }
        }
    }

    private static string ValidateServer(string value)
    {
        var server = ValidateRequired(value, "PBX server", 253);
        if (!HostNameRegex().IsMatch(server))
        {
            throw new ArgumentException("PBX server must be an IP address or host name without a URL scheme.");
        }
        return server;
    }

    private static int ValidatePort(int value, string name)
    {
        if (value is < 1 or > 65535)
        {
            throw new ArgumentException($"{name} must be between 1 and 65535.");
        }
        return value;
    }

    private static string ValidateRequired(string? value, string label, int maxLength)
    {
        var clean = value?.Trim() ?? string.Empty;
        if (clean.Length == 0 || clean.Length > maxLength || clean.Any(char.IsControl))
        {
            throw new ArgumentException($"{label} is required and must be {maxLength} characters or fewer.");
        }
        return clean;
    }

    private static string NormalizeDestination(string value)
    {
        var clean = ValidateRequired(value, "Destination", 64)
            .Replace(" ", string.Empty)
            .Replace("-", string.Empty)
            .Replace("(", string.Empty)
            .Replace(")", string.Empty);

        if (!DialStringRegex().IsMatch(clean))
        {
            throw new ArgumentException("Destination may contain digits, +, *, and # only.");
        }
        return clean;
    }

    private static string NormalizeCorrelationId(string? value)
    {
        return Guid.TryParse(value, out var parsed) ? parsed.ToString("D") : Guid.NewGuid().ToString("D");
    }

    private static byte ParseDtmf(string value)
    {
        var tone = value?.Trim().ToUpperInvariant();
        return tone switch
        {
            "0" => 0, "1" => 1, "2" => 2, "3" => 3, "4" => 4,
            "5" => 5, "6" => 6, "7" => 7, "8" => 8, "9" => 9,
            "*" => 10, "#" => 11, "A" => 12, "B" => 13, "C" => 14, "D" => 15,
            _ => throw new ArgumentException("DTMF must be 0-9, *, #, or A-D.")
        };
    }

    private static string SafeSipFailure(string prefix, SIPResponse? response, string? message)
    {
        if (response is not null)
        {
            return $"{prefix}: {(int)response.Status} {response.ReasonPhrase}.";
        }
        return $"{prefix}: {SafeText(message)}";
    }

    private static string ClassifySipFailure(SIPResponse? response, string? message)
    {
        var code = response is null ? 0 : (int)response.Status;
        if (code is 486 or 600) return "busy";
        if (code is 401 or 403 or 603) return "rejected";
        if (code is 404 or 410 or 480 or 484) return "unavailable";
        if (code is 408) return "no_answer";
        if (code is 487) return "cancelled";

        var lower = String.IsNullOrWhiteSpace(message) ? String.Empty : message.ToLowerInvariant();
        if (lower.Contains("cancel")) return "cancelled";
        if (lower.Contains("busy")) return "busy";
        if (lower.Contains("timeout") || lower.Contains("timed out") || lower.Contains("no answer")) return "no_answer";
        if (lower.Contains("unavailable") || lower.Contains("not found")) return "unavailable";
        if (lower.Contains("reject") || lower.Contains("declin") || lower.Contains("forbidden")) return "rejected";
        return "failed";
    }

    private static string SafeMessage(Exception exception) => SafeText(exception.Message);

    private static string SafeText(string? message)
    {
        var safe = string.IsNullOrWhiteSpace(message) ? "No response from the SIP server." : message.Trim();
        return safe.Length > 240 ? safe[..240] : safe;
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        await _gate.WaitAsync();
        try
        {
            if (!_disposed)
            {
                await StopInternalAsync(clearAccount: true);
                _ringTone.Dispose();
                _disposed = true;
            }
        }
        finally
        {
            _gate.Release();
            _gate.Dispose();
        }
    }

    [GeneratedRegex(@"^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$")]
    private static partial Regex HostNameRegex();

    [GeneratedRegex(@"^[0-9+*#]+$")]
    private static partial Regex DialStringRegex();
}
