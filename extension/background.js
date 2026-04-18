let socket = null;
let status = {
    connected: false,
    lastSync: null
};

// 1. 消息中心：处理来自 Popup 的指令
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'SYNC_NOW':
            handleSyncNow(message.payload, sendResponse);
            return true; // 异步响应
        case 'START_LISTEN':
            startWebSocket();
            sendResponse({ success: true });
            break;
        case 'STOP_LISTEN':
            stopWebSocket();
            sendResponse({ success: true });
            break;
        case 'GET_STATUS':
            // 实时判断连接状态
            const isConnected = socket && socket.readyState === WebSocket.OPEN;
            sendResponse({
                connected: isConnected,
                lastSync: status.lastSync
            });
            break;
    }
});

// 2. 发送逻辑：抓取并推送
async function handleSyncNow(payload, sendResponse) {
    try {
        let { serverUrl, targetDomain } = payload;
        if (!serverUrl || !targetDomain) throw new Error('配置缺失');

        // 自动补全端口：如果地址不包含 ':'，则加上默认端口 :3000
        if (!serverUrl.includes(':')) serverUrl += ':3000';

        const domains = targetDomain.split(',').map(d => d.trim().replace(/^https?:\/\//, ''));
        let allCookiesMap = new Map();

        for (const domain of domains) {
            const cookies = await chrome.cookies.getAll({ domain });
            const dotCookies = await chrome.cookies.getAll({ domain: '.' + domain });
            [...cookies, ...dotCookies].forEach(c => allCookiesMap.set(`${c.name}|${c.domain}`, c));
        }

        const uniqueCookies = Array.from(allCookiesMap.values());
        const endpoint = `http://${serverUrl.replace(/\/$/, '')}/update`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: targetDomain, cookies: uniqueCookies }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) sendResponse({ success: true });
        else throw new Error(`服务器返回 ${response.status}`);
    } catch (err) {
        sendResponse({ success: false, error: err.name === 'AbortError' ? '连接超时(3000端口?)' : err.message });
    }
}

// 3. 接收逻辑：WebSocket 客户端
let heartbeatInterval = null;

async function checkConnection() {
    const { isListening, serverUrl } = await chrome.storage.local.get(['isListening', 'serverUrl']);
    if (isListening && serverUrl && (!socket || socket.readyState !== WebSocket.OPEN)) {
        startWebSocket();
    }
}

// 使用 Alarms 定时唤醒 (需要 manifest 权限)
if (chrome.alarms) {
    chrome.alarms.create('keep-alive', { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'keep-alive') checkConnection();
    });
}

function startWebSocket() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    if (socket) socket.close();
    
    chrome.storage.local.get(['serverUrl'], (config) => {
        let url = config.serverUrl;
        if (!url) return;
        
        // 自动补全端口
        if (!url.includes(':')) url += ':3000';
        const wsUrl = (url.includes('://') ? url : `ws://${url}`).replace(/\/$/, '') + '/live';
        
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('Connected to relay server');
            status.connected = true;
            chrome.storage.local.set({ isListening: true });
            
            heartbeatInterval = setInterval(() => {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send('ping');
                }
            }, 25000);
        };

        socket.onmessage = async (event) => {
            if (event.data === 'pong' || event.data === 'ping') return;
            
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'UPDATE_COOKIES' || data.type === 'INIT_COOKIES') {
                    console.log('Received cookies for domain:', data.domain);
                    await applyCookies(data.cookies);
                    status.lastSync = new Date().toLocaleTimeString();
                    
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon48.png',
                        title: 'Cookie 自动同步成功',
                        message: `站点 [${data.domain}] 的会话已同步。`
                    });
                }
            } catch (err) {
                console.error('Invalid message format:', err);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket closed');
            status.connected = false;
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            
            chrome.storage.local.get(['isListening'], (res) => {
                if (res.isListening) {
                    setTimeout(startWebSocket, 5000);
                }
            });
        };

        socket.onerror = (err) => {
            status.connected = false;
        };
    });
}

function stopWebSocket() {
    chrome.storage.local.set({ isListening: false });
    if (socket) socket.close();
    socket = null;
    status.connected = false;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
}

// 4. 初始化
chrome.runtime.onStartup.addListener(checkConnection);
chrome.runtime.onInstalled.addListener(checkConnection);
checkConnection(); // 脚本加载时执行

// 5. 应用 Cookie 到浏览器
async function applyCookies(cookies) {
    for (const cookie of cookies) {
        const protocol = cookie.secure ? 'https:' : 'http:';
        const domain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
        const url = `${protocol}//${domain}${cookie.path}`;

        try {
            const details = {
                url: url,
                name: cookie.name,
                value: cookie.value,
                path: cookie.path,
                domain: cookie.domain,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                sameSite: cookie.sameSite,
                storeId: cookie.storeId
            };
            
            if (!cookie.session) {
                details.expirationDate = cookie.expirationDate;
            }

            await chrome.cookies.set(details);
        } catch (err) {
            console.error(`Failed to set cookie: ${cookie.name}`, err);
        }
    }
}
