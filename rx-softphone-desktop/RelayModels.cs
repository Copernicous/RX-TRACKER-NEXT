namespace RxSoftphone;

public sealed record RelayPairRequest(string TrackerUrl, string PairingCode);
public sealed record RelayPairResult(bool Paired, string TrackerUrl, string DeviceName);
public sealed record RelayStatus(
    bool Configured,
    bool Connected,
    string? TrackerUrl,
    string? DeviceName,
    DateTimeOffset? LastConnectedAt,
    string? Error);

internal sealed record RelayPairPayload(string PairingCode, string DeviceName);
internal sealed record RelayPairResponse(string DeviceToken, string DeviceKey, int UserId);
internal sealed record RelayPollPayload(
    PhoneSnapshot Snapshot,
    string? AccountUpdatedAt,
    IReadOnlyList<RelayCommandResult> CompletedCommands);
internal sealed record RelayCommandResult(int CommandId, bool Success, string? Error);
internal sealed record RelayPollResponse(
    string ServerTime,
    string? AccountUpdatedAt,
    RegisterRequest? Registration,
    RelayCommand? Command);
internal sealed record RelayCommand(int Id, string Type, RelayCommandPayload Payload, DateTimeOffset ExpiresAt);
internal sealed record RelayCommandPayload(string? Destination, string? CorrelationId);

internal sealed record StoredRelaySettings(string TrackerUrl, string DeviceName, string ProtectedToken);
