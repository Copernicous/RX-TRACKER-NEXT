using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RxSoftphone;

public sealed class SoftphoneWindow : System.Windows.Forms.Form
{
    private const string RuntimeInformationUrl = "https://developer.microsoft.com/microsoft-edge/webview2/";
    private readonly Uri _controlUri;
    private readonly WebView2 _webView;
    private readonly System.Windows.Forms.Panel _errorPanel;
    private readonly System.Windows.Forms.Label _errorDetail;
    private bool _initializing;
    private bool _allowClose;

    public SoftphoneWindow(string webUrl, string version, Icon icon)
    {
        _controlUri = new Uri(webUrl, UriKind.Absolute);

        Text = $"RX Softphone {version}";
        Icon = icon;
        StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 650);
        Size = new Size(1180, 820);
        BackColor = Color.FromArgb(237, 247, 243);
        KeyPreview = true;

        _webView = new WebView2
        {
            Dock = System.Windows.Forms.DockStyle.Fill,
            DefaultBackgroundColor = BackColor
        };

        _errorDetail = new System.Windows.Forms.Label
        {
            AutoSize = true,
            MaximumSize = new Size(650, 0),
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.FromArgb(79, 89, 86),
            Margin = new System.Windows.Forms.Padding(0, 8, 0, 24)
        };
        _errorPanel = BuildErrorPanel();
        _errorPanel.Visible = false;

        Controls.Add(_webView);
        Controls.Add(_errorPanel);

        Shown += async (_, _) => await InitializeWebViewAsync();
        FormClosing += OnWindowClosing;
        KeyDown += (_, eventArgs) =>
        {
            if (eventArgs.KeyCode != System.Windows.Forms.Keys.Escape) return;
            eventArgs.Handled = true;
            Hide();
        };
    }

    public void ShowAndActivate()
    {
        if (WindowState == System.Windows.Forms.FormWindowState.Minimized)
        {
            WindowState = System.Windows.Forms.FormWindowState.Normal;
        }
        if (!Visible) Show();
        BringToFront();
        Activate();
    }

    public void CloseForExit()
    {
        _allowClose = true;
        Close();
    }

    private async Task InitializeWebViewAsync()
    {
        if (_initializing) return;
        if (_webView.CoreWebView2 is not null)
        {
            _errorPanel.Visible = false;
            _webView.Visible = true;
            _webView.Reload();
            return;
        }
        _initializing = true;
        _errorPanel.Visible = false;
        _webView.Visible = true;

        try
        {
            var profileRoot = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(profileRoot)) profileRoot = Path.GetTempPath();
            var userDataFolder = Path.Combine(profileRoot, "RX Tracker", "RX Softphone", "WebView2");
            Directory.CreateDirectory(userDataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: userDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);

            var core = _webView.CoreWebView2
                ?? throw new InvalidOperationException("The embedded phone window did not initialize.");
            var settings = core.Settings;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.IsPasswordAutosaveEnabled = false;
            settings.IsGeneralAutofillEnabled = false;

            core.NavigationStarting += (_, eventArgs) =>
            {
                if (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var target) ||
                    !IsLocalControlUri(target))
                {
                    eventArgs.Cancel = true;
                }
            };
            core.NewWindowRequested += (_, eventArgs) =>
            {
                eventArgs.Handled = true;
            };
            core.ProcessFailed += (_, _) =>
            {
                if (IsDisposed || Disposing || !IsHandleCreated) return;
                try
                {
                    BeginInvoke((Action)(() =>
                    {
                        if (!IsDisposed && !Disposing)
                        {
                            ShowWebViewError(
                                "The embedded phone window stopped unexpectedly. Select Retry to reload it.");
                        }
                    }));
                }
                catch (InvalidOperationException)
                {
                    // The form is closing while WebView2 reports the failure.
                }
            };

            _webView.Source = _controlUri;
        }
        catch (Exception exception)
        {
            ShowWebViewError(
                "The Microsoft Edge WebView2 Runtime is unavailable or could not start. " +
                "Install the Evergreen WebView2 Runtime, then select Retry." +
                Environment.NewLine + Environment.NewLine +
                SafeMessage(exception));
        }
        finally
        {
            _initializing = false;
        }
    }

    private bool IsLocalControlUri(Uri target) =>
        string.Equals(target.Scheme, _controlUri.Scheme, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(target.Host, _controlUri.Host, StringComparison.OrdinalIgnoreCase) &&
        target.Port == _controlUri.Port;

    private System.Windows.Forms.Panel BuildErrorPanel()
    {
        var panel = new System.Windows.Forms.Panel
        {
            Dock = System.Windows.Forms.DockStyle.Fill,
            BackColor = BackColor
        };
        var layout = new System.Windows.Forms.TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = System.Windows.Forms.AutoSizeMode.GrowAndShrink,
            ColumnCount = 1,
            RowCount = 4,
            Anchor = System.Windows.Forms.AnchorStyles.None
        };
        var messageFont = SystemFonts.MessageBoxFont ?? SystemFonts.DefaultFont;
        var title = new System.Windows.Forms.Label
        {
            AutoSize = true,
            Text = "RX Softphone window unavailable",
            Font = new Font(messageFont.FontFamily, 18, FontStyle.Bold),
            ForeColor = Color.FromArgb(33, 58, 54),
            TextAlign = ContentAlignment.MiddleCenter,
            Anchor = System.Windows.Forms.AnchorStyles.None
        };
        var retry = new System.Windows.Forms.Button
        {
            AutoSize = true,
            Text = "Retry",
            Anchor = System.Windows.Forms.AnchorStyles.None,
            Margin = new System.Windows.Forms.Padding(0, 0, 0, 8)
        };
        retry.Click += async (_, _) => await InitializeWebViewAsync();
        var runtimeHelp = new System.Windows.Forms.Button
        {
            AutoSize = true,
            Text = "WebView2 Runtime information",
            Anchor = System.Windows.Forms.AnchorStyles.None
        };
        runtimeHelp.Click += (_, _) => OpenExternal(RuntimeInformationUrl);

        layout.Controls.Add(title, 0, 0);
        layout.Controls.Add(_errorDetail, 0, 1);
        layout.Controls.Add(retry, 0, 2);
        layout.Controls.Add(runtimeHelp, 0, 3);
        panel.Controls.Add(layout);
        panel.Resize += (_, _) =>
        {
            layout.Left = Math.Max(0, (panel.ClientSize.Width - layout.Width) / 2);
            layout.Top = Math.Max(0, (panel.ClientSize.Height - layout.Height) / 2);
        };
        return panel;
    }

    private void ShowWebViewError(string message)
    {
        _webView.Visible = false;
        _errorDetail.Text = message;
        _errorPanel.Visible = true;
        _errorPanel.BringToFront();
    }

    private void OnWindowClosing(object? sender, System.Windows.Forms.FormClosingEventArgs eventArgs)
    {
        if (_allowClose ||
            eventArgs.CloseReason == System.Windows.Forms.CloseReason.WindowsShutDown ||
            eventArgs.CloseReason == System.Windows.Forms.CloseReason.TaskManagerClosing)
        {
            return;
        }

        eventArgs.Cancel = true;
        Hide();
    }

    private static string SafeMessage(Exception exception)
    {
        var message = exception.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return message.Length <= 240 ? message : message[..240];
    }

    private static void OpenExternal(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch
        {
            // The explanatory URL is optional; the tray and SIP engine remain available.
        }
    }
}
