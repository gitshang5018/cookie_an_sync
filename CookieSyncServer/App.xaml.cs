using System;
using System.Windows;

namespace CookieSyncServer
{
    public partial class App : System.Windows.Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // 全局未处理异常捕获
            AppDomain.CurrentDomain.UnhandledException += (s, ev) => {
                LogException(ev.ExceptionObject as Exception);
            };

            this.DispatcherUnhandledException += (s, ev) => {
                LogException(ev.Exception);
                ev.Handled = true;
            };
        }

        private void LogException(Exception? ex)
        {
            if (ex == null) return;
            string msg = $"抱歉，程序发生致命错误并即将退出：\n\n{ex.Message}\n\n{ex.StackTrace}";
            System.Windows.MessageBox.Show(msg, "致命错误", MessageBoxButton.OK, MessageBoxImage.Error);
            Environment.Exit(1);
        }
    }
}
