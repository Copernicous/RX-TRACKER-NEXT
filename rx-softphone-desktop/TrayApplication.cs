using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Hosting;

namespace RxSoftphone;

public sealed class TrayApplication : IDisposable
{
    private readonly string _webUrl;
    private readonly string _version;
    private readonly SipPhoneService _phone;
    private readonly SoftphoneRelayService _relay;
    private readonly SoftphoneClientOptions _options;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly object _stateLock = new();
    private Thread? _thread;
    private TrayContext? _context;
    private bool _disposed;

    public TrayApplication(
        string webUrl,
        string version,
        SipPhoneService phone,
        SoftphoneRelayService relay,
        SoftphoneClientOptions options,
        IHostApplicationLifetime lifetime)
    {
        _webUrl = webUrl;
        _version = version;
        _phone = phone;
        _relay = relay;
        _options = options;
        _lifetime = lifetime;
    }

    public void Start()
    {
        lock (_stateLock)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_thread is not null) return;

            _thread = new Thread(RunTray)
            {
                IsBackground = true,
                Name = "RX Softphone tray"
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }
    }

    public void OpenControlPanel() => OpenUrl(_webUrl);

    private void RunTray()
    {
        System.Windows.Forms.Application.EnableVisualStyles();
        System.Windows.Forms.Application.SetCompatibleTextRenderingDefault(false);

        using var context = new TrayContext(
            _webUrl,
            _version,
            _phone,
            _relay,
            _options,
            _lifetime);
        lock (_stateLock)
        {
            if (_disposed)
            {
                return;
            }
            _context = context;
        }

        System.Windows.Forms.Application.Run(context);

        lock (_stateLock) _context = null;
    }

    public void Dispose()
    {
        Thread? thread;
        TrayContext? context;
        lock (_stateLock)
        {
            if (_disposed) return;
            _disposed = true;
            thread = _thread;
            context = _context;
        }

        context?.RequestExit();
        if (thread is not null && thread != Thread.CurrentThread)
        {
            thread.Join(TimeSpan.FromSeconds(5));
        }
    }

    public static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            // The tray remains available if Windows has no default browser.
        }
    }

    private sealed class TrayContext : System.Windows.Forms.ApplicationContext
    {
        private static readonly HashSet<string> ActiveCallStates = new(StringComparer.OrdinalIgnoreCase)
        {
            "dialing", "trying", "ringing", "answering", "connected", "incoming"
        };

        private readonly string _webUrl;
        private readonly SipPhoneService _phone;
        private readonly SoftphoneRelayService _relay;
        private readonly SoftphoneClientOptions _options;
        private readonly IHostApplicationLifetime _lifetime;
        private readonly TrayIconSet _icons = new();
        private readonly System.Windows.Forms.Control _dispatcher = new();
        private readonly System.Windows.Forms.NotifyIcon _notifyIcon;
        private readonly System.Windows.Forms.ToolStripMenuItem _registrationItem;
        private readonly System.Windows.Forms.ToolStripMenuItem _callItem;
        private readonly System.Windows.Forms.ToolStripMenuItem _relayItem;
        private readonly System.Windows.Forms.ToolStripMenuItem _lastCallItem;
        private readonly System.Windows.Forms.ToolStripMenuItem _hangupItem;
        private readonly System.Windows.Forms.ToolStripMenuItem _enableItem;
        private readonly System.Windows.Forms.ToolStripMenuItem _unpairItem;
        private readonly System.Windows.Forms.Timer _timer;
        private bool _exitRequested;

        public TrayContext(
            string webUrl,
            string version,
            SipPhoneService phone,
            SoftphoneRelayService relay,
            SoftphoneClientOptions options,
            IHostApplicationLifetime lifetime)
        {
            _webUrl = webUrl;
            _phone = phone;
            _relay = relay;
            _options = options;
            _lifetime = lifetime;

            _dispatcher.CreateControl();
            _ = _dispatcher.Handle;

            var menu = new System.Windows.Forms.ContextMenuStrip();
            menu.Items.Add(new System.Windows.Forms.ToolStripMenuItem($"RX Softphone {version}") { Enabled = false });
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());

            _registrationItem = new System.Windows.Forms.ToolStripMenuItem("Registration: Starting…") { Enabled = false };
            _callItem = new System.Windows.Forms.ToolStripMenuItem("Call: No active call") { Enabled = false };
            _relayItem = new System.Windows.Forms.ToolStripMenuItem("Relay: Checking…") { Enabled = false };
            _lastCallItem = new System.Windows.Forms.ToolStripMenuItem("Last call: None") { Enabled = false };
            menu.Items.AddRange([_registrationItem, _callItem, _relayItem, _lastCallItem]);
            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());

            var openItem = new System.Windows.Forms.ToolStripMenuItem("Open RX Softphone");
            openItem.Click += (_, _) => OpenUrl(_webUrl);
            menu.Items.Add(openItem);

            _hangupItem = new System.Windows.Forms.ToolStripMenuItem("Hang up") { Enabled = false };
            _hangupItem.Click += async (_, _) => await HangupAsync();
            menu.Items.Add(_hangupItem);

            _enableItem = new System.Windows.Forms.ToolStripMenuItem("Disable phone");
            _enableItem.Click += async (_, _) => await TogglePhoneAsync();
            menu.Items.Add(_enableItem);

            _unpairItem = new System.Windows.Forms.ToolStripMenuItem();
            _unpairItem.Click += async (_, _) => await UnpairAsync();
            menu.Items.Add(_unpairItem);

            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
            var exitItem = new System.Windows.Forms.ToolStripMenuItem("Exit RX Softphone");
            exitItem.Click += (_, _) => ExitFromTray();
            menu.Items.Add(exitItem);

            _notifyIcon = new System.Windows.Forms.NotifyIcon
            {
                ContextMenuStrip = menu,
                Icon = _icons.Offline,
                Text = "RX Softphone — starting",
                Visible = true
            };
            _notifyIcon.DoubleClick += (_, _) => OpenUrl(_webUrl);

            _timer = new System.Windows.Forms.Timer { Interval = 750 };
            _timer.Tick += (_, _) => RefreshStatus();
            _timer.Start();
            RefreshStatus();

            _notifyIcon.BalloonTipTitle = $"RX Softphone {version}";
            _notifyIcon.BalloonTipText = "Running in the Windows tray. Double-click the icon to open the phone.";
            _notifyIcon.ShowBalloonTip(3500);
        }

        public void RequestExit()
        {
            if (_dispatcher.IsDisposed) return;
            if (_dispatcher.InvokeRequired)
            {
                try
                {
                    _dispatcher.BeginInvoke((Action)RequestExit);
                }
                catch (InvalidOperationException)
                {
                    // The message loop is already closing.
                }
                return;
            }

            _timer.Stop();
            _notifyIcon.Visible = false;
            ExitThread();
        }

        protected override void ExitThreadCore()
        {
            _timer.Stop();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _timer.Dispose();
            _dispatcher.Dispose();
            _icons.Dispose();
            base.ExitThreadCore();
        }

        private void RefreshStatus()
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                var phone = _phone.GetSnapshot();
                var relay = _relay.GetStatus();
                var phoneEnabled = _relay.PhoneEnabled;
                var callActive = ActiveCallStates.Contains(phone.Call);

                _registrationItem.Text = phoneEnabled
                    ? $"Registration: {FriendlyRegistration(phone.Registration)}"
                    : "Registration: Disabled";
                _callItem.Text = $"Call: {FriendlyCall(phone, now)}";
                _relayItem.Text = relay.Configured
                    ? $"Relay: {(relay.Connected ? "Online" : "Offline")}"
                    : "Relay: Not paired";
                _lastCallItem.Text = $"Last call: {LastCall(phone)}";
                _lastCallItem.ToolTipText = _lastCallItem.Text;

                _hangupItem.Enabled = callActive;
                _enableItem.Enabled = relay.Configured && !callActive;
                _enableItem.Text = phoneEnabled ? "Disable phone" : "Enable phone";
                _unpairItem.Text = _options.ManagedMode
                    ? "Unpair workstation (Administrator required)"
                    : "Unpair workstation";
                _unpairItem.Enabled = !_options.ManagedMode && relay.Configured && !callActive;

                _notifyIcon.Icon = callActive
                    ? _icons.InCall
                    : phoneEnabled && phone.Registration == "registered"
                        ? _icons.Ready
                        : _icons.Offline;
                SetToolTip(callActive
                    ? $"RX Softphone — {FriendlyCall(phone, now)}"
                    : phoneEnabled && phone.Registration == "registered"
                        ? "RX Softphone — registered, no active call"
                        : phoneEnabled
                            ? $"RX Softphone — {FriendlyRegistration(phone.Registration)}"
                            : "RX Softphone — disabled");
            }
            catch
            {
                _notifyIcon.Icon = _icons.Offline;
                SetToolTip("RX Softphone — status unavailable");
            }
        }

        private async Task HangupAsync()
        {
            try
            {
                await _phone.HangupAsync();
            }
            catch (Exception ex)
            {
                ShowError("Could not hang up the call.", ex);
            }
            RefreshStatus();
        }

        private async Task TogglePhoneAsync()
        {
            try
            {
                var enable = !_relay.PhoneEnabled;
                await _relay.SetPhoneEnabledAsync(enable);
            }
            catch (Exception ex)
            {
                ShowError("Could not change the phone state.", ex);
            }
            RefreshStatus();
        }

        private async Task UnpairAsync()
        {
            if (_options.ManagedMode) return;
            var answer = System.Windows.Forms.MessageBox.Show(
                "Remove this workstation pairing and unregister the phone?",
                "RX Softphone",
                System.Windows.Forms.MessageBoxButtons.YesNo,
                System.Windows.Forms.MessageBoxIcon.Warning,
                System.Windows.Forms.MessageBoxDefaultButton.Button2);
            if (answer != System.Windows.Forms.DialogResult.Yes) return;

            try
            {
                if (_phone.GetSnapshot().Registration != "offline")
                {
                    await _phone.UnregisterAsync();
                }
                _relay.Disconnect();
            }
            catch (Exception ex)
            {
                ShowError("Could not remove the workstation pairing.", ex);
            }
            RefreshStatus();
        }

        private void ExitFromTray()
        {
            var phone = _phone.GetSnapshot();
            if (ActiveCallStates.Contains(phone.Call))
            {
                var answer = System.Windows.Forms.MessageBox.Show(
                    "A call is active. Hang up and exit RX Softphone?",
                    "RX Softphone",
                    System.Windows.Forms.MessageBoxButtons.YesNo,
                    System.Windows.Forms.MessageBoxIcon.Warning,
                    System.Windows.Forms.MessageBoxDefaultButton.Button2);
                if (answer != System.Windows.Forms.DialogResult.Yes) return;
            }

            if (_exitRequested) return;
            _exitRequested = true;
            _notifyIcon.Visible = false;
            _lifetime.StopApplication();
        }

        private static string FriendlyRegistration(string value) => value switch
        {
            "registered" => "Registered",
            "registering" => "Registering",
            "failed" => "Registration failed",
            _ => "Offline"
        };

        private static string FriendlyCall(PhoneSnapshot phone, DateTimeOffset now)
        {
            if (phone.Call == "connected")
            {
                var duration = now - (phone.ConnectedAt ?? now);
                return $"In call {FormatDuration(duration)}";
            }

            return phone.Call switch
            {
                "dialing" or "trying" => "Dialing",
                "ringing" => "Ringing",
                "answering" => "Answering",
                "incoming" => "Incoming call",
                _ => "No active call"
            };
        }

        private static string LastCall(PhoneSnapshot phone)
        {
            if (phone.DialedAt is null || string.IsNullOrWhiteSpace(phone.Peer)) return "None";

            var end = phone.EndedAt ?? (phone.Call == "ended" ? DateTimeOffset.UtcNow : null);
            var start = phone.ConnectedAt ?? phone.DialedAt;
            var duration = end.HasValue ? $" · {FormatDuration(end.Value - start.Value)}" : string.Empty;
            var outcome = string.IsNullOrWhiteSpace(phone.Outcome) ? phone.Call : phone.Outcome;
            return $"{phone.Peer} · {FriendlyOutcome(outcome)}{duration}";
        }

        private static string FriendlyOutcome(string? value) => value switch
        {
            "answered" => "Answered",
            "no_answer" => "No answer",
            "busy" => "Busy",
            "rejected" => "Rejected",
            "unavailable" => "Unavailable",
            "cancelled" => "Cancelled",
            "failed" => "Failed",
            _ => "In progress"
        };

        private static string FormatDuration(TimeSpan value)
        {
            if (value < TimeSpan.Zero) value = TimeSpan.Zero;
            return value.TotalHours >= 1
                ? $"{(int)value.TotalHours}:{value.Minutes:00}:{value.Seconds:00}"
                : $"{(int)value.TotalMinutes}:{value.Seconds:00}";
        }

        private void SetToolTip(string value)
        {
            _notifyIcon.Text = value.Length <= 63 ? value : value[..63];
        }

        private static void ShowError(string title, Exception ex)
        {
            var detail = ex.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
            if (detail.Length > 200) detail = detail[..200];
            System.Windows.Forms.MessageBox.Show(
                $"{title}{Environment.NewLine}{Environment.NewLine}{detail}",
                "RX Softphone",
                System.Windows.Forms.MessageBoxButtons.OK,
                System.Windows.Forms.MessageBoxIcon.Error);
        }
    }

    private sealed class TrayIconSet : IDisposable
    {
        public Icon Ready { get; } = Create(Color.FromArgb(25, 150, 90));
        public Icon InCall { get; } = Create(Color.FromArgb(28, 120, 210));
        public Icon Offline { get; } = Create(Color.FromArgb(190, 65, 65));

        public void Dispose()
        {
            Ready.Dispose();
            InCall.Dispose();
            Offline.Dispose();
        }

        private static Icon Create(Color color)
        {
            using var bitmap = new Bitmap(32, 32);
            using var graphics = Graphics.FromImage(bitmap);
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.Clear(Color.Transparent);
            using var background = new SolidBrush(color);
            graphics.FillEllipse(background, 1, 1, 30, 30);
            using var pen = new Pen(Color.White, 3.2f)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round
            };
            graphics.DrawArc(pen, 8, 7, 16, 17, 30, 120);
            graphics.DrawLine(pen, 9, 12, 7, 8);
            graphics.DrawLine(pen, 23, 20, 25, 24);

            var handle = bitmap.GetHicon();
            try
            {
                return (Icon)Icon.FromHandle(handle).Clone();
            }
            finally
            {
                DestroyIcon(handle);
            }
        }

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DestroyIcon(IntPtr handle);
    }
}
