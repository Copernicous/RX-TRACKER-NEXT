namespace RxSoftphone;

public sealed record SoftphoneClientOptions(bool ManagedMode, bool AllowManualDialing, string Version);
public sealed record SoftphoneClientStatus(bool ManagedMode, bool AllowManualDialing, string Version);

public sealed record RegisterRequest(
    string Server,
    int Port,
    string Username,
    string Password,
    string? DisplayName,
    int? LocalSipPort);

public sealed record DialRequest(string Destination, string? CorrelationId);
public sealed record MuteRequest(bool Muted);
public sealed record DtmfRequest(string Tone);
public sealed record ApiError(string Error);

public sealed record PhoneEvent(
    long Sequence,
    DateTimeOffset Timestamp,
    string Level,
    string Message);

public sealed record PhoneSnapshot(
    string Registration,
    string Call,
    string? Peer,
    bool Incoming,
    bool Muted,
    string? CallId,
    DateTimeOffset? DialedAt,
    DateTimeOffset? RingingAt,
    DateTimeOffset? ConnectedAt,
    DateTimeOffset? EndedAt,
    string? Outcome,
    int? SipResponseCode,
    string? SipReason,
    string Server,
    int Port,
    string Username,
    int LocalSipPort,
    IReadOnlyList<PhoneEvent> Events);

public sealed class PhoneOperationException(string message) : Exception(message);
