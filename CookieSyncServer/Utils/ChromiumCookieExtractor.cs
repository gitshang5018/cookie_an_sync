using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Org.BouncyCastle.Crypto.Engines;
using Org.BouncyCastle.Crypto.Modes;
using Org.BouncyCastle.Crypto.Parameters;

namespace CookieSyncServer.Utils
{
    public class ChromiumCookieExtractor
    {
        public class CookieItem
        {
            public string domain { get; set; } = string.Empty;
            public string name { get; set; } = string.Empty;
            public string value { get; set; } = string.Empty;
            public string path { get; set; } = "/";
            public double expirationDate { get; set; }
            public bool secure { get; set; }
            public bool httpOnly { get; set; }
            public string sameSite { get; set; } = "unspecified";
            public bool session { get; set; }
        }

        private static readonly (string Name, string ProcessName, string LocalStateSub, string CookieSub)[] Browsers =
        {
            ("Edge", "msedge",
             @"Microsoft\Edge\User Data\Local State",
             @"Microsoft\Edge\User Data\Default\Network\Cookies"),
            ("Chrome", "chrome",
             @"Google\Chrome\User Data\Local State",
             @"Google\Chrome\User Data\Default\Network\Cookies")
        };

        /// <summary>
        /// 从本机浏览器提取指定域名的 Cookie。
        /// 如果浏览器正在运行且文件被锁，会先关闭浏览器，拷贝后自动重启。
        /// </summary>
        public static List<CookieItem> GetCookies(string domainKeyword, Action<string>? onLog = null)
        {
            var cookies = new List<CookieItem>();
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            foreach (var browser in Browsers)
            {
                var localStatePath = Path.Combine(localAppData, browser.LocalStateSub);
                var cookieDbPath = Path.Combine(localAppData, browser.CookieSub);

                if (!File.Exists(localStatePath) || !File.Exists(cookieDbPath))
                {
                    onLog?.Invoke($"⏭️ {browser.Name}: 未安装，跳过");
                    continue;
                }

                try
                {
                    onLog?.Invoke($"🔍 正在从 {browser.Name} 提取...");

                    // 1. 解密主密钥
                    string masterKeyB64 = GetMasterKey(localStatePath);
                    if (string.IsNullOrEmpty(masterKeyB64))
                    {
                        onLog?.Invoke($"⚠️ {browser.Name}: 无法获取主密钥");
                        continue;
                    }

                    // 2. 尝试拷贝 Cookie 数据库
                    string tempDb = Path.Combine(Path.GetTempPath(), $"cookie_sync_{browser.ProcessName}_{Guid.NewGuid():N}.db");
                    bool copied = TryCopyCookieDb(cookieDbPath, tempDb, browser.Name, browser.ProcessName, onLog);

                    if (!copied)
                    {
                        onLog?.Invoke($"❌ {browser.Name}: 无法获取 Cookie 数据库");
                        continue;
                    }

                    // 3. 读取数据库
                    var browserCookies = ReadCookieDb(tempDb, domainKeyword, masterKeyB64);
                    onLog?.Invoke($"📦 {browser.Name}: 找到 {browserCookies.Count} 个匹配 Cookie");
                    cookies.AddRange(browserCookies);

                    // 清理临时文件
                    try { File.Delete(tempDb); } catch { }
                }
                catch (Exception ex)
                {
                    onLog?.Invoke($"❌ {browser.Name} 提取失败: {ex.Message}");
                }
            }

            return cookies;
        }

        /// <summary>
        /// 尝试拷贝 Cookie 数据库文件。
        /// 先尝试直接拷贝（浏览器未运行时可行），
        /// 失败后自动关闭浏览器、拷贝、重启。
        /// </summary>
        private static bool TryCopyCookieDb(string source, string dest, string browserName, string processName, Action<string>? onLog)
        {
            // 方案1：直接拷贝（浏览器未运行时有效）
            try
            {
                File.Copy(source, dest, true);
                onLog?.Invoke($"📂 {browserName}: 直接拷贝成功");
                return true;
            }
            catch { }

            // 方案2：关闭浏览器 → 拷贝 → 重启
            onLog?.Invoke($"🔒 {browserName} 正在锁定文件，需要暂时关闭...");

            var processes = Process.GetProcessesByName(processName);
            if (processes.Length == 0)
            {
                onLog?.Invoke($"⚠️ {browserName} 未运行但文件仍被锁定");
                return false;
            }

            // 记住浏览器可执行文件路径
            string? exePath = null;
            try { exePath = processes[0].MainModule?.FileName; } catch { }
            if (string.IsNullOrEmpty(exePath))
            {
                exePath = processName == "msedge" ? "msedge.exe" : "chrome.exe";
            }

            // 关闭浏览器
            onLog?.Invoke($"⏳ 正在关闭 {browserName} ({processes.Length} 个进程)...");
            foreach (var p in processes)
            {
                try { p.Kill(); } catch { }
            }

            // 等待进程完全退出
            int waitMs = 0;
            while (waitMs < 5000)
            {
                System.Threading.Thread.Sleep(200);
                waitMs += 200;
                if (Process.GetProcessesByName(processName).Length == 0) break;
            }
            System.Threading.Thread.Sleep(500); // 额外等待释放文件锁

            // 拷贝
            bool success = false;
            try
            {
                File.Copy(source, dest, true);
                onLog?.Invoke($"📂 {browserName}: 拷贝成功");
                success = true;
            }
            catch (Exception ex)
            {
                onLog?.Invoke($"❌ 拷贝仍然失败: {ex.Message}");
            }

            // 立即重启浏览器
            onLog?.Invoke($"🔄 正在重启 {browserName}...");
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = exePath,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                onLog?.Invoke($"⚠️ 重启 {browserName} 失败: {ex.Message}");
            }

            return success;
        }

        private static List<CookieItem> ReadCookieDb(string dbPath, string targetDomain, string masterKeyB64)
        {
            var result = new List<CookieItem>();
            byte[] masterKey = Convert.FromBase64String(masterKeyB64);

            using var connection = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
            connection.Open();
            var command = connection.CreateCommand();
            command.CommandText = "SELECT host_key, name, path, encrypted_value, is_secure, is_httponly, samesite, expires_utc FROM cookies WHERE host_key LIKE $domain";
            command.Parameters.AddWithValue("$domain", $"%{targetDomain}%");

            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                string hostKey = reader.GetString(0);
                string name = reader.GetString(1);
                string path = reader.GetString(2);
                byte[] encryptedValue = (byte[])reader["encrypted_value"];
                bool isSecure = reader.GetInt32(4) > 0;
                bool isHttpOnly = reader.GetInt32(5) > 0;
                int sameSiteVal = reader.GetInt32(6);
                long expiresUtc = reader.GetInt64(7);

                string decryptedValue = DecryptCookie(encryptedValue, masterKey);

                string sameSiteStr = sameSiteVal switch { 1 => "lax", 2 => "strict", _ => "unspecified" };

                double expirationSeconds = 0;
                bool session = true;
                if (expiresUtc > 0)
                {
                    long unixMicro = expiresUtc - 11644473600000000;
                    expirationSeconds = Math.Floor((double)unixMicro / 1000000);
                    session = false;
                }

                result.Add(new CookieItem
                {
                    domain = hostKey,
                    name = name,
                    value = decryptedValue,
                    path = path,
                    secure = isSecure,
                    httpOnly = isHttpOnly,
                    sameSite = sameSiteStr,
                    expirationDate = expirationSeconds,
                    session = session
                });
            }

            return result;
        }

        private static string GetMasterKey(string localStatePath)
        {
            try
            {
                string content = File.ReadAllText(localStatePath);
                using var doc = System.Text.Json.JsonDocument.Parse(content);
                if (doc.RootElement.TryGetProperty("os_crypt", out var osCrypt) &&
                    osCrypt.TryGetProperty("encrypted_key", out var keyProp))
                {
                    byte[] encKey = Convert.FromBase64String(keyProp.GetString() ?? "");
                    // 去除 "DPAPI" 前缀（前 5 字节）
                    byte[] raw = new byte[encKey.Length - 5];
                    Array.Copy(encKey, 5, raw, 0, raw.Length);
                    byte[] masterKey = ProtectedData.Unprotect(raw, null, DataProtectionScope.CurrentUser);
                    return Convert.ToBase64String(masterKey);
                }
            }
            catch { }
            return "";
        }

        private static string DecryptCookie(byte[] encrypted, byte[] masterKey)
        {
            if (encrypted == null || encrypted.Length == 0) return "";
            try
            {
                if (encrypted.Length > 3 && encrypted[0] == 'v' && encrypted[1] == '1' &&
                    (encrypted[2] == '0' || encrypted[2] == '1'))
                {
                    byte[] nonce = new byte[12];
                    Array.Copy(encrypted, 3, nonce, 0, 12);
                    byte[] cipher = new byte[encrypted.Length - 15];
                    Array.Copy(encrypted, 15, cipher, 0, cipher.Length);

                    var gcm = new GcmBlockCipher(new AesEngine());
                    gcm.Init(false, new AeadParameters(new KeyParameter(masterKey), 128, nonce, null));
                    byte[] plain = new byte[gcm.GetOutputSize(cipher.Length)];
                    int len = gcm.ProcessBytes(cipher, 0, cipher.Length, plain, 0);
                    gcm.DoFinal(plain, len);
                    return Encoding.UTF8.GetString(plain);
                }
                else
                {
                    return Encoding.UTF8.GetString(
                        ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser));
                }
            }
            catch { return ""; }
        }
    }
}
