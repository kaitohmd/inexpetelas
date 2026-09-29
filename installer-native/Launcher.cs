using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class LauncherProgram
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LauncherForm());
    }
}

internal sealed class LauncherForm : Form
{
    private const string RepositoryOwner = "kaitohmd";
    private const string Repository = "inexpetelas";
    private static readonly Color Background = Color.FromArgb(15, 12, 14);
    private static readonly Color Surface = Color.FromArgb(25, 17, 20);
    private static readonly Color Accent = Color.FromArgb(224, 45, 65);
    private static readonly HttpClient Http = CreateHttpClient();

    private readonly Label title;
    private readonly Label message;
    private readonly Label version;
    private readonly ProgressBar progress;
    private readonly Button installButton;
    private readonly LinkLabel releasesLink;
    private readonly System.Windows.Forms.Timer launchTimer;
    private CancellationTokenSource cancellation;
    private Process launching;
    private string installedExe;
    private string temporarySetup;
    private DateTime launchStarted;
    private bool busy;

    private static HttpClient CreateHttpClient()
    {
        // The launcher targets .NET Framework 4.x, whose default TLS policy can
        // negotiate TLS 1.0 on older Windows installs. GitHub requires TLS 1.2+.
        ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;
        var client = new HttpClient();
        client.Timeout = TimeSpan.FromSeconds(20);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("INEXPETELAS-Launcher/1.2");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public LauncherForm()
    {
        Text = "INEXPETELAS";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(456, 510);
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Background;
        ForeColor = Color.White;
        DoubleBuffered = true;
        ShowInTaskbar = true;
        Icon = LoadIcon();

        var top = new Panel { Dock = DockStyle.Top, Height = 48, BackColor = Surface };
        top.MouseDown += DragWindow;
        var appIcon = new PictureBox { Image = Icon.ToBitmap(), Size = new Size(24, 24), Location = new Point(16, 12), SizeMode = PictureBoxSizeMode.Zoom };
        var brand = new Label { Text = "INEXPETELAS", AutoSize = true, Location = new Point(48, 16), Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Color.White };
        brand.MouseDown += DragWindow;
        var close = new Button { Text = "×", FlatStyle = FlatStyle.Flat, ForeColor = Color.FromArgb(188, 176, 180), BackColor = Color.Transparent, Size = new Size(46, 46), Location = new Point(ClientSize.Width - 46, 1), Anchor = AnchorStyles.Top | AnchorStyles.Right, Font = new Font("Segoe UI", 17, FontStyle.Regular), Cursor = Cursors.Hand };
        close.FlatAppearance.BorderSize = 0;
        close.FlatAppearance.MouseOverBackColor = Color.FromArgb(116, 35, 48);
        close.Click += delegate { Close(); };
        top.Controls.Add(appIcon);
        top.Controls.Add(brand);
        top.Controls.Add(close);
        Controls.Add(top);

        var mark = new PictureBox { Image = Icon.ToBitmap(), Size = new Size(76, 76), Location = new Point((ClientSize.Width - 76) / 2, 93), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Transparent };
        Controls.Add(mark);

        title = new Label { Text = "Abrindo o INEXPETELAS", AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(36, 193, 384, 32), Font = new Font("Segoe UI", 16, FontStyle.Bold), ForeColor = Color.White };
        message = new Label { Text = "Só um instante…", AutoSize = false, TextAlign = ContentAlignment.TopCenter, Bounds = new Rectangle(50, 235, 356, 46), Font = new Font("Segoe UI", 9, FontStyle.Regular), ForeColor = Color.FromArgb(186, 174, 178) };
        progress = new ProgressBar { Bounds = new Rectangle(58, 298, 340, 7), Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 24, Visible = false };
        installButton = MakeButton("Instalar e abrir", 324);
        installButton.Visible = false;
        installButton.Click += async delegate { await InstallLatestAsync(); };
        releasesLink = new LinkLabel { Text = "Ver versões", AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(80, 378, 296, 32), Font = new Font("Segoe UI", 9), LinkColor = Color.FromArgb(235, 167, 176), ActiveLinkColor = Color.White, VisitedLinkColor = Color.FromArgb(235, 167, 176) };
        releasesLink.LinkClicked += delegate { Process.Start(new ProcessStartInfo("https://github.com/" + RepositoryOwner + "/" + Repository + "/releases/latest") { UseShellExecute = true }); };
        version = new Label { Text = "Instalação por usuário · sem pedir administrador", AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Bounds = new Rectangle(25, 464, 406, 24), Font = new Font("Segoe UI", 8), ForeColor = Color.FromArgb(119, 105, 110) };
        Controls.Add(title);
        Controls.Add(message);
        Controls.Add(progress);
        Controls.Add(installButton);
        Controls.Add(releasesLink);
        Controls.Add(version);

        launchTimer = new System.Windows.Forms.Timer { Interval = 250 };
        launchTimer.Tick += PollLaunch;
        Shown += async delegate { await StartAsync(); };
        FormClosed += delegate
        {
            launchTimer.Stop();
            if (cancellation != null) cancellation.Cancel();
            // A janela pode ser fechada durante a execução do instalador; não apague o arquivo
            // enquanto o Windows ainda pode estar lendo-o.
            if (Icon != null) Icon.Dispose();
        };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using (var brush = new LinearGradientBrush(ClientRectangle, Background, Color.FromArgb(33, 12, 18), 40f))
            e.Graphics.FillRectangle(brush, ClientRectangle);
        using (var pen = new Pen(Color.FromArgb(69, 36, 43)))
            e.Graphics.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        using (var brush = new LinearGradientBrush(new Rectangle(1, 47, ClientSize.Width - 2, 2), Accent, Color.FromArgb(124, 26, 42), 0f))
            e.Graphics.FillRectangle(brush, 1, 47, ClientSize.Width - 2, 2);
    }

    private static Icon LoadIcon()
    {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("App.ico"))
            return stream == null ? SystemIcons.Application : new Icon(stream);
    }

    private Button MakeButton(string text, int y)
    {
        var button = new Button { Text = text, Bounds = new Rectangle(48, y, 360, 46), FlatStyle = FlatStyle.Flat, BackColor = Accent, ForeColor = Color.White, Font = new Font("Segoe UI", 9, FontStyle.Bold), Cursor = Cursors.Hand };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(246, 59, 78);
        return button;
    }

    private void DragWindow(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left) return;
        ReleaseCapture();
        SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
    }

    private async Task StartAsync()
    {
        installedExe = FindInstalledExe();
        if (String.IsNullOrEmpty(installedExe))
        {
            title.Text = "Instale para começar";
            message.Text = "Vamos instalar a versão mais recente do INEXPETELAS neste computador.";
            installButton.Visible = true;
            return;
        }
        await CheckAndOpenAsync();
    }

    private async Task CheckAndOpenAsync()
    {
        SetBusy("Verificando atualizações", "Conferindo se há uma versão nova para este computador…", true);
        try
        {
            ReleaseInfo release = await GetLatestReleaseAsync(CancellationToken.None);
            Version local = ReadInstalledVersion(installedExe);
            if (local != null && release.Version.CompareTo(local) > 0)
            {
                await DownloadAndInstallAsync(release, CancellationToken.None);
                installedExe = FindInstalledExe();
            }
            BeginLaunch();
        }
        catch
        {
            // A rede pode estar offline ou o GitHub indisponível. O app instalado continua
            // abrindo e também mantém a própria checagem automática de atualizações.
            if (File.Exists(installedExe)) BeginLaunch("Não consegui conferir atualizações agora. Abrindo o app instalado…");
            else ShowInstallError("Não consegui buscar a versão atual. Confira sua internet e tente novamente.");
        }
    }

    private async Task InstallLatestAsync()
    {
        if (busy) return;
        cancellation = new CancellationTokenSource();
        try
        {
            SetBusy("Preparando a instalação", "Baixando a versão mais recente com segurança…", true);
            ReleaseInfo release = await GetLatestReleaseAsync(cancellation.Token);
            await DownloadAndInstallAsync(release, cancellation.Token);
            installedExe = FindInstalledExe();
            if (String.IsNullOrEmpty(installedExe) || !File.Exists(installedExe)) throw new InvalidOperationException("A instalação terminou, mas não encontrei o aplicativo.");
            BeginLaunch("Instalação concluída. Abrindo o INEXPETELAS…");
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { ShowInstallError(error.GetBaseException().Message); }
        finally { busy = false; }
    }

    private async Task<ReleaseInfo> GetLatestReleaseAsync(CancellationToken token)
    {
        var url = "https://api.github.com/repos/" + RepositoryOwner + "/" + Repository + "/releases/latest";
        using (var response = await Http.GetAsync(url, HttpCompletionOption.ResponseContentRead, token))
        {
            response.EnsureSuccessStatusCode();
            string json = await response.Content.ReadAsStringAsync();
            var serializer = new JavaScriptSerializer();
            var release = serializer.DeserializeObject(json) as Dictionary<string, object>;
            if (release == null) throw new InvalidOperationException("A resposta de versões veio incompleta.");
            var tag = Convert.ToString(release["tag_name"]);
            Version parsed;
            if (!Version.TryParse(Regex.Replace(tag.TrimStart('v', 'V'), @"[^0-9.].*$", ""), out parsed))
                throw new InvalidOperationException("A versão publicada não tem um número válido.");
            var assets = release["assets"] as object[];
            if (assets == null) throw new InvalidOperationException("Não encontrei o instalador da versão atual.");
            foreach (object item in assets)
            {
                var asset = item as Dictionary<string, object>;
                if (asset == null) continue;
                var name = Convert.ToString(asset["name"]);
                if (!Regex.IsMatch(name, @"^INEXPETELAS-Setup-[\w.-]+\.exe$")) continue;
                return new ReleaseInfo { Version = parsed, Tag = tag, Name = name, Url = Convert.ToString(asset["browser_download_url"]) };
            }
            throw new InvalidOperationException("O instalador ainda não está disponível nesta versão.");
        }
    }

    private async Task DownloadAndInstallAsync(ReleaseInfo release, CancellationToken token)
    {
        string tempPath = Path.Combine(Path.GetTempPath(), "INEXPETELAS-Setup-" + release.Tag + ".exe");
        temporarySetup = tempPath;
        using (var response = await Http.GetAsync(release.Url, HttpCompletionOption.ResponseHeadersRead, token))
        {
            response.EnsureSuccessStatusCode();
            long total = response.Content.Headers.ContentLength ?? 0;
            using (var input = await response.Content.ReadAsStreamAsync())
            using (var output = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None, 65536, true))
            {
                var buffer = new byte[65536];
                long received = 0;
                int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length, token)) > 0)
                {
                    await output.WriteAsync(buffer, 0, count, token);
                    received += count;
                    if (total > 0) SetProgress((int)Math.Min(100, received * 100 / total), "Baixando INEXPETELAS " + release.Version + "…");
                }
                await output.FlushAsync(token);
            }
        }

        SetBusy("Instalando", "Aplicando a atualização sem abrir o instalador do Windows…", true);
        var start = new ProcessStartInfo(tempPath, "/S") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetTempPath() };
        using (var installer = Process.Start(start))
        {
            if (installer == null) throw new InvalidOperationException("Não consegui iniciar a instalação.");
            await Task.Run(delegate { installer.WaitForExit(); }, token);
            if (installer.ExitCode != 0) throw new InvalidOperationException("A instalação foi interrompida. Tente de novo.");
        }
        TryDelete(tempPath);
        temporarySetup = null;
    }

    private void BeginLaunch(string status = null)
    {
        if (String.IsNullOrEmpty(installedExe) || !File.Exists(installedExe))
        {
            ShowInstallError("Não encontrei o app instalado neste computador.");
            return;
        }
        try
        {
            if (launching != null) { try { if (!launching.HasExited) return; } catch { } }
            launching = Process.Start(new ProcessStartInfo(installedExe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(installedExe) });
            if (launching == null) throw new InvalidOperationException("O Windows não iniciou o app.");
            launchStarted = DateTime.UtcNow;
            SetBusy("Abrindo o INEXPETELAS", status ?? "Seu app está iniciando. Esta janela fica aqui enquanto ele abre…", true);
            launchTimer.Start();
        }
        catch (Exception error) { ShowInstallError("Não consegui abrir o app: " + error.Message); }
    }

    private void PollLaunch(object sender, EventArgs e)
    {
        try
        {
            launching.Refresh();
            if (launching.HasExited)
            {
                launchTimer.Stop();
                ShowInstallError("O app fechou antes de mostrar a janela. Você pode tentar abrir de novo pelo menu Iniciar.");
                return;
            }
            if (launching.MainWindowHandle != IntPtr.Zero)
            {
                launchTimer.Stop();
                Close();
                return;
            }
            if ((DateTime.UtcNow - launchStarted).TotalSeconds > 12)
                message.Text = "Ainda iniciando… esta janela confirma que o launcher continua funcionando.";
        }
        catch (Exception error)
        {
            launchTimer.Stop();
            ShowInstallError("Não consegui confirmar a abertura: " + error.Message);
        }
    }

    private static string FindInstalledExe()
    {
        var uninstall = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall");
        if (uninstall != null)
        {
            foreach (string keyName in uninstall.GetSubKeyNames())
            {
                using (var key = uninstall.OpenSubKey(keyName))
                {
                    if (key == null || !Convert.ToString(key.GetValue("DisplayName", "")).Contains("INEXPETELAS")) continue;
                    string folder = Convert.ToString(key.GetValue("InstallLocation", ""));
                    string candidate = Path.Combine(folder, "INEXPETELAS.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }
        }
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string expected = Path.Combine(local, "Programs", "INEXPETELAS", "INEXPETELAS.exe");
        return File.Exists(expected) ? expected : null;
    }

    private static Version ReadInstalledVersion(string path)
    {
        try
        {
            string raw = FileVersionInfo.GetVersionInfo(path).ProductVersion;
            Version parsed;
            return Version.TryParse(Regex.Replace(raw ?? "", @"[^0-9.].*$", ""), out parsed) ? parsed : null;
        }
        catch { return null; }
    }

    private void SetBusy(string heading, string details, bool marquee)
    {
        if (InvokeRequired) { BeginInvoke(new Action(delegate { SetBusy(heading, details, marquee); })); return; }
        busy = true;
        title.Text = heading;
        message.Text = details;
        installButton.Visible = false;
        progress.Visible = true;
        progress.Style = marquee ? ProgressBarStyle.Marquee : ProgressBarStyle.Continuous;
        releasesLink.Visible = false;
        version.Text = "INEXPETELAS · Inicialização e atualizações";
    }

    private void SetProgress(int percent, string heading)
    {
        if (InvokeRequired) { BeginInvoke(new Action(delegate { SetProgress(percent, heading); })); return; }
        title.Text = heading;
        progress.Style = ProgressBarStyle.Continuous;
        progress.Value = Math.Max(0, Math.Min(100, percent));
    }

    private void ShowInstallError(string details)
    {
        if (InvokeRequired) { BeginInvoke(new Action(delegate { ShowInstallError(details); })); return; }
        busy = false;
        launchTimer.Stop();
        title.Text = "Não foi possível abrir";
        message.Text = details;
        progress.Visible = false;
        installButton.Visible = true;
        installButton.Enabled = true;
        installButton.Text = File.Exists(installedExe ?? "") ? "Tentar abrir de novo" : "Tentar instalar novamente";
        releasesLink.Visible = true;
        version.Text = "INEXPETELAS";
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ReleaseCapture();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int message, IntPtr wParam, IntPtr lParam);

    private sealed class ReleaseInfo
    {
        public Version Version;
        public string Tag;
        public string Name;
        public string Url;
    }
}
