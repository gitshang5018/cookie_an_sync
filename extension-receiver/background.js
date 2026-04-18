// Cookie Sync (Receiver 版) - 背景脚本
// 核心逻辑：建立 WebSocket 长连接，接收更新并写入本地 Cookie

let socket = null;
let reconnectTimer = null;
let lastProcessedTime = null; // 记录最后一次处理的时间戳标识

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'START_LISTENING') {
        connectWebSocket(msg.serverUrl);
    }
});

// 保活机制
chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'heartbeat' && !socket) {
        chrome.storage.local.get(['serverUrl', 'isListening'], (data) => {
            if (data.isListening && data.serverUrl) {
                connectWebSocket(data.serverUrl);
            }
        });
    }
});

async function connectWebSocket(url) {
    if (socket) socket.close();
    
    let wsUrl = url.includes('://') ? url.replace('http', 'ws') : `ws://${url}`;
    if (!wsUrl.includes('/live')) wsUrl = wsUrl.endsWith('/') ? wsUrl + 'live' : wsUrl + '/live';

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WS Connected');
        chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', connected: true });
    };

    socket.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'UPDATE_COOKIES' || data.type === 'INIT_COOKIES') {
                // 1. 时间戳前置拦截：如果推送时间没变，则不执行任何同步操作
                if (data.time && data.time === lastProcessedTime) {
                    console.log(`[Version Gate] Skipping duplicate sync for time: ${data.time}`);
                    return;
                }

                // 2. 执行内容差分同步
                const changed = await applyCookies(data.cookies);
                
                // 3. 只有检测到数据有效变化才触发通知
                if (changed) {
                    lastProcessedTime = data.time; // 更新最后处理的时间戳标识
                    const time = new Date().toLocaleTimeString();
                    chrome.storage.local.set({ lastSyncTime: time });
                    chrome.runtime.sendMessage({ action: 'SYNC_READY', time });
                    
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon128.png',
                        title: 'Cookie 同步成功',
                        message: `检测到 ${data.domain} 的数据变化，已更新`
                    });
                } else {
                    console.log(`[Sync] Skipped redundant update for ${data.domain}`);
                }
            }
        } catch (e) { console.error('WS Data Error', e); }
    };

    socket.onclose = () => {
        socket = null;
        chrome.runtime.sendMessage({ action: 'STATUS_UPDATE', connected: false });
        // 5秒后尝试重连
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            chrome.storage.local.get(['isListening', 'serverUrl'], (data) => {
                if (data.isListening) connectWebSocket(data.serverUrl);
            });
        }, 5000);
    };
}

async function applyCookies(incomingCookies) {
    let changeCount = 0;
    
    for (const cookie of incomingCookies) {
        const { hostOnly, session, ...cleanCookie } = cookie;
        const protocol = cleanCookie.secure ? 'https://' : 'http://';
        const domain = cleanCookie.domain.startsWith('.') ? cleanCookie.domain.substring(1) : cleanCookie.domain;
        const url = protocol + domain + cleanCookie.path;
        cleanCookie.url = url;
        
        try {
            // 1. 获取当前浏览器中的同名 Cookie
            const existing = await chrome.cookies.get({
                url: url,
                name: cleanCookie.name,
                storeId: cleanCookie.storeId
            });

            // 2. 只有当值发生变化时才写入
            if (!existing || existing.value !== cleanCookie.value) {
                await chrome.cookies.set(cleanCookie);
                changeCount++;
                console.log(`[Sync] Updated cookie: ${cleanCookie.name}`);
            }
        } catch (e) {
            console.warn('Cookie comparison/set error:', e.message, url);
        }
    }

    return changeCount > 0;
}
