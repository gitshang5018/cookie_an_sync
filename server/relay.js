import http from 'http';
import { WebSocketServer } from 'ws';

/**
 * 局域网 Cookie 同步中转服务器
 * 
 * 逻辑：
 * 1. 接收来自“发送插件”的 POST /update 请求，存储最新的 Cookie。
 * 2. 维持与“接收插件”的 WebSocket 长连接。
 * 3. 一旦收到更新，立即将数据广播给所有连接的客户端。
 */

const PORT = 3000;
let latestCookies = null;
let lastUpdateTime = null;

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
    // 设置 CORS，允许插件跨域请求
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/update') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                latestCookies = data.cookies;
                const domain = data.domain;
                lastUpdateTime = new Date().toLocaleTimeString();

                console.log(`[${lastUpdateTime}] 收到更新: 域名 [${domain}]，共 ${latestCookies.length} 个 Cookie`);

                // 广播给所有 WebSocket 客户端
                broadcast({
                    type: 'UPDATE_COOKIES',
                    domain: domain,
                    cookies: latestCookies,
                    timestamp: lastUpdateTime
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', message: 'Cookies updated and broadcasted' }));
            } catch (err) {
                console.error('解析失败:', err);
                res.writeHead(400);
                res.end('Invalid JSON');
            }
        });
    } else if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'running', 
            lastUpdate: lastUpdateTime,
            domain: latestCookies ? latestCookies[0]?.domain : 'none'
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// 初始化 WebSocket 服务
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('(+) 客户端已连接');
    
    // 如果已有缓存数据，连上就推一次
    if (latestCookies) {
        ws.send(JSON.stringify({
            type: 'INIT_COOKIES',
            domain: 'previously_synced_site',
            cookies: latestCookies,
            timestamp: lastUpdateTime
        }));
    }

    ws.on('close', () => console.log('(-) 客户端已断开'));
});

function broadcast(message) {
    const payload = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(payload);
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('==========================================');
    console.log('   Cookie 同步中转站已启动');
    console.log(`   监听端口: ${PORT}`);
    console.log(`   运行地址: http://localhost:${PORT}`);
    console.log('==========================================');
});
