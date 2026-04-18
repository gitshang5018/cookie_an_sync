using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace CookieSyncServer
{
    public class RelayServer
    {
        private static ConcurrentDictionary<string, WebSocket> _clients = new();
        private static string? _latestData = null;
        private static readonly string _cachePath;
        private IHost? _host;

        public event Action<string>? OnLog;
        public event Action<string, string>? OnSyncReceived;

        static RelayServer()
        {
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppDomain.CurrentDomain.BaseDirectory;
            _cachePath = Path.Combine(exeDir, "sync_cache.json");
            try {
                if (File.Exists(_cachePath)) _latestData = File.ReadAllText(_cachePath);
            } catch { }
        }

        private static void SaveCache(string data)
        {
            try { File.WriteAllText(_cachePath, data); } catch { }
        }

        public async Task StartAsync(int port)
        {
            if (_latestData != null) OnLog?.Invoke("📂 已从本地缓存恢复同步数据");

            var builder = WebApplication.CreateEmptyBuilder(new WebApplicationOptions());
            builder.Services.AddRouting(); // 注入路由服务，修复启动崩溃
            builder.WebHost.UseKestrel(options =>
            {
                options.ListenAnyIP(port);
            });

            var app = builder.Build();
            app.UseWebSockets();

            app.MapPost("/update", async (HttpContext context) =>
            {
                using var reader = new StreamReader(context.Request.Body);
                var json = await reader.ReadToEndAsync();
                
                _latestData = json;
                SaveCache(json); // 实时存档到本地文件

                using var doc = JsonDocument.Parse(json);
                var domain = doc.RootElement.GetProperty("domain").GetString() ?? "Unknown";
                var time = DateTime.Now.ToString("HH:mm:ss.fff");

                OnLog?.Invoke($"收到同步推送: [{domain}]");
                OnSyncReceived?.Invoke(domain, time);

                // 精准修复：提取 cookies 数组部分进行广播
                var cookiesArray = doc.RootElement.GetProperty("cookies");

                var broadcastObj = new
                {
                    type = "UPDATE_COOKIES",
                    domain = domain,
                    time = time,
                    cookies = cookiesArray
                };
                var broadcastJson = JsonSerializer.Serialize(broadcastObj);

                await BroadcastAsync(broadcastJson);
                return Results.Ok(new { status = "success" });
            });

            app.Map("/live", async (HttpContext context) =>
            {
                if (context.WebSockets.IsWebSocketRequest)
                {
                    var id = Guid.NewGuid().ToString();
                    using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
                    
                    _clients.TryAdd(id, webSocket);
                    OnLog?.Invoke($"客户端嵌入 (ID: {id.Substring(0, 8)})");

                    if (_latestData != null)
                    {
                        // 包装初始握手包
                        using var initDoc = JsonDocument.Parse(_latestData);
                        var iDomain = initDoc.RootElement.TryGetProperty("domain", out var p) ? p.GetString() : "Unknown";
                        var iCookies = initDoc.RootElement.GetProperty("cookies"); // 精准提取数组
                        
                        var initPayloadObj = new { 
                            type = "INIT_COOKIES", 
                            domain = iDomain, 
                            cookies = iCookies 
                        };
                        var initJson = JsonSerializer.Serialize(initPayloadObj);
                        var payload = Encoding.UTF8.GetBytes(initJson);
                        await webSocket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, CancellationToken.None);
                    }

                    await HandleWebSocket(webSocket, id);
                }
                else
                {
                    context.Response.StatusCode = 400;
                }
            });

            _host = app;
            await app.RunAsync();
        }

        private async Task HandleWebSocket(WebSocket socket, string id)
        {
            var buffer = new byte[1024 * 4];
            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                    }
                    else if (result.MessageType == WebSocketMessageType.Text)
                    {
                        var msg = Encoding.UTF8.GetString(buffer, 0, result.Count);
                        if (msg == "ping")
                        {
                            await socket.SendAsync(Encoding.UTF8.GetBytes("pong"), WebSocketMessageType.Text, true, CancellationToken.None);
                        }
                    }
                }
            }
            catch { }
            finally
            {
                _clients.TryRemove(id, out _);
                OnLog?.Invoke($"客户端断开 (ID: {id.Substring(0, 8)})");
            }
        }

        private async Task BroadcastAsync(string message)
        {
            var payload = Encoding.UTF8.GetBytes(message);
            foreach (var client in _clients.Values)
            {
                if (client.State == WebSocketState.Open)
                {
                    await client.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, CancellationToken.None);
                }
            }
        }

        public async Task StopAsync()
        {
            if (_host != null)
            {
                await _host.StopAsync();
                _host.Dispose();
                _host = null;
            }
        }
    }
}
