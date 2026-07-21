using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RxSoftphone;

public sealed class RelaySettingsStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("rx-softphone-relay-v1");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string _settingsPath;

    public RelaySettingsStore()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RX Softphone");
        Directory.CreateDirectory(directory);
        _settingsPath = Path.Combine(directory, "relay.json");
    }

    public (string TrackerUrl, string DeviceName, string Token)? Load()
    {
        try
        {
            if (!File.Exists(_settingsPath)) return null;
            var settings = JsonSerializer.Deserialize<StoredRelaySettings>(File.ReadAllText(_settingsPath), JsonOptions);
            if (settings is null) return null;
            var encrypted = Convert.FromBase64String(settings.ProtectedToken);
            var clear = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            return (settings.TrackerUrl, settings.DeviceName, Encoding.UTF8.GetString(clear));
        }
        catch
        {
            return null;
        }
    }

    public void Save(string trackerUrl, string deviceName, string token)
    {
        var clear = Encoding.UTF8.GetBytes(token);
        try
        {
            var encrypted = ProtectedData.Protect(clear, Entropy, DataProtectionScope.CurrentUser);
            var settings = new StoredRelaySettings(trackerUrl, deviceName, Convert.ToBase64String(encrypted));
            File.WriteAllText(_settingsPath, JsonSerializer.Serialize(settings, JsonOptions));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(clear);
        }
    }

    public void Clear()
    {
        if (File.Exists(_settingsPath)) File.Delete(_settingsPath);
    }
}
