using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;

namespace CookieSyncServer
{
    public partial class MainWindow : Window
    {
        private RelayServer? _server;
        private bool _isRunning = false;
        private System.Windows.Forms.NotifyIcon? _notifyIcon;
        private bool _isExplicitClose = false;

        public MainWindow()
        {
            InitializeComponent();
            InitTray();
            SyncAutoStartUI();
            
            this.Loaded += (s, e) => {
                var args = System.Environment.GetCommandLineArgs();
                if (args.Contains("--autostart")) {
                    ToggleServer(); // 自动启动服务
                    this.Hide();    // 自动隐藏到托盘
                }
            };
        }

        private void SyncAutoStartUI()
        {
            try {
                using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
                ChkAutoStart.IsChecked = key?.GetValue("CookieSyncServer") != null;
            } catch { }
        }

        private void AutoStart_Click(object sender, RoutedEventArgs e)
        {
            const string path = @"Software\Microsoft\Windows\CurrentVersion\Run";
            try {
                using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(path, true);
                if (key == null) return;

                if (ChkAutoStart.IsChecked == true) {
                    var exePath = System.Environment.ProcessPath;
                    if (exePath != null) key.SetValue("CookieSyncServer", $"\"{exePath}\" --autostart");
                } else {
                    key.DeleteValue("CookieSyncServer", false);
                }
            } catch (Exception ex) {
                AddLog($"❌ 设置自启失败: {ex.Message}");
            }
        }

        private void InitTray()
        {
            _notifyIcon = new System.Windows.Forms.NotifyIcon();
            _notifyIcon.Text = "Cookie Sync Ultimate";
            
            // 修复：从嵌入资源加载图标，确保单文件 EXE 正常运行
            try {
                var iconUri = new Uri("pack://application:,,,/icon.ico", UriKind.RelativeOrAbsolute);
                var iconStream = System.Windows.Application.GetResourceStream(iconUri)?.Stream;
                if (iconStream != null) _notifyIcon.Icon = new System.Drawing.Icon(iconStream);
            } catch { /* 备选方案或静默处理 */ }

            _notifyIcon.Visible = true;

            // 托盘右键菜单
            var contextMenu = new System.Windows.Forms.ContextMenuStrip();
            contextMenu.Items.Add("显示主窗口", null, (s, e) => ShowWindow());
            contextMenu.Items.Add("退出程序", null, (s, e) => {
                _isExplicitClose = true;
                System.Windows.Application.Current.Shutdown();
            });
            _notifyIcon.ContextMenuStrip = contextMenu;

            // 双击托盘恢复
            _notifyIcon.DoubleClick += (s, e) => ShowWindow();
        }

        private void ShowWindow()
        {
            this.Show();
            this.WindowState = WindowState.Normal;
            this.Activate();
        }

        protected override void OnStateChanged(EventArgs e)
        {
            if (this.WindowState == WindowState.Minimized)
            {
                this.Hide();
            }
            base.OnStateChanged(e);
        }

        private void Close_Click(object sender, RoutedEventArgs e) 
        {
            // 点击右上角关闭默认最小化到托盘，不退出
            this.Hide();
        }

        private void Minimize_Click(object sender, RoutedEventArgs e) => this.WindowState = WindowState.Minimized;
        
        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            if (!_isExplicitClose)
            {
                e.Cancel = true;
                this.Hide();
            }
            else
            {
                _notifyIcon?.Dispose();
                _server?.StopAsync().Wait();
            }
            base.OnClosing(e);
        }

        private void ToggleServer_Click(object sender, RoutedEventArgs e) => ToggleServer();

        private void ToggleServer()
        {
            if (!_isRunning)
            {
                if (!int.TryParse(InputPort.Text, out int port))
                {
                    AddLog("❌ 端口号无效");
                    return;
                }

                _server = new RelayServer();
                _server.OnLog += msg => Dispatcher.Invoke(() => AddLog(msg));
                _server.OnSyncReceived += (domain, time) => Dispatcher.Invoke(() => 
                {
                    TxtDomain.Text = $"最后同步站点: {domain}";
                    TxtTime.Text = $"同步时间: {time}";
                });

                try
                {
                    _isRunning = true;
                    BtnToggle.Content = "关闭服务";
                    BtnToggle.Background = System.Windows.Media.Brushes.Crimson;
                    TxtPort.Text = $"监听端口: {port}";
                    AddLog($"🚀 服务启动在端口: {port}");
                    
                    _ = Task.Run(async () => {
                        try {
                            await _server.StartAsync(port);
                        } catch (Exception ex) {
                            Dispatcher.Invoke(() => {
                                AddLog($"❌ 服务崩溃: {ex.Message}");
                                StopService();
                            });
                        }
                    });
                }
                catch (Exception ex)
                {
                    AddLog($"❌ 启动失败: {ex.Message}");
                    StopService();
                }
            }
            else { StopService(); }
        }

        private async void StopService()
        {
            if (_server != null) { await _server.StopAsync(); _server = null; }
            _isRunning = false;
            BtnToggle.Content = "启动中转服务";
            BtnToggle.Background = (System.Windows.Media.Brush)new System.Windows.Media.BrushConverter().ConvertFrom("#6366f1")!;
            TxtPort.Text = "监听端口: ---";
            AddLog("🛑 服务已停止");
        }

        private void AddLog(string msg)
        {
            var time = DateTime.Now.ToString("HH:mm:ss");
            LogList.Items.Insert(0, $"[{time}] {msg}");
            while (LogList.Items.Count > 50) LogList.Items.RemoveAt(LogList.Items.Count - 1);
        }


        // 允许托拽标题栏区域 (WindowChrome 覆盖了标题栏)
        protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e) {
            base.OnMouseLeftButtonDown(e);
            // 只有当鼠标在标题栏高度内时才允许拖动 (CaptionHeight=42)
            if (e.GetPosition(this).Y < 42) this.DragMove();
        }
    }
}