using Microsoft.Win32;

namespace RxSoftphone;

public sealed class WindowsStartupManager
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "RXSoftphone";
    private readonly string? _executablePath;

    public WindowsStartupManager() : this(Environment.ProcessPath)
    {
    }

    internal WindowsStartupManager(string? processPath)
    {
        if (!string.IsNullOrWhiteSpace(processPath) &&
            string.Equals(Path.GetFileName(processPath), "RxSoftphone.exe", StringComparison.OrdinalIgnoreCase) &&
            File.Exists(processPath))
        {
            _executablePath = Path.GetFullPath(processPath);
        }
    }

    public bool CanConfigure => _executablePath is not null;

    public bool IsEnabled
    {
        get
        {
            if (_executablePath is null) return false;
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
            var configured = key?.GetValue(ValueName) as string;
            return string.Equals(configured, StartupCommand(), StringComparison.OrdinalIgnoreCase);
        }
    }

    public void Enable()
    {
        if (_executablePath is null)
        {
            throw new InvalidOperationException("Start with Windows is available only from the packaged RX Softphone executable.");
        }

        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("Windows did not open the current user's startup settings.");
        key.SetValue(ValueName, StartupCommand(), RegistryValueKind.String);
    }

    public void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }

    private string StartupCommand() => $"\"{_executablePath}\" --startup";
}
