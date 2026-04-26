// Cookie Sync (Receiver 版) - 全自动静默发现背景脚本
let socket = null;
let currentUrl = ''; 
let isConnected = false;
let isScanning = false;
let lastSyncTime = null;
let lastProcessedTime = null;

// 1. 初始化启动 - 立即尝试连接，不等待
async function init() {
  // 立即尝试连接之前保存的服务器
  const data = await new Promise(resolve => chrome.storage.local.get(['serverUrl'], resolve));
  if (data.serverUrl) {
    currentUrl = data.serverUrl;
    connectWebSocket(currentUrl);
  } else {
    startSilentDiscovery();
  }
  // 创建周期性 alarm 以保持 Service Worker 活跃（使用较短周期）
  chrome.alarms.create('keep-alive', { periodInMinutes: 0.5, delayInMinutes: 0.1 });
}
init();

// 2. 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_STATUS') {
        sendResponse({ connected: isConnected, url: currentUrl, lastSync: lastSyncTime, scanning: isScanning });
        return true; 
    }
    if (message.action === 'UPDATE_URL') {
        currentUrl = message.serverUrl;
        chrome.storage.local.set({ serverUrl: currentUrl });
        connectWebSocket(currentUrl);
        sendResponse({ success: true });
        return true;
    }
});

// 2.5 Alarm 监听器 - 用于唤醒休眠的 Service Worker
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keep-alive') {
        if (!isConnected && !isScanning) {
            if (currentUrl) {
                connectWebSocket(currentUrl);
            } else {
                startSilentDiscovery();
            }
        }
    }
});

// 3. 全自动静默发现引擎
async function startSilentDiscovery() {
    if (isScanning || isConnected) return;
    isScanning = true;
    console.log('Receiver starting silent discovery...');

    const subnets = ['127.0.0.1', '192.168.0', '192.168.1', '192.168.31', '192.168.2', '10.0.0'];
    const port = '3000';

    for (const subnet of subnets) {
        if (isConnected) break;
        let batchSize = 20;
        for (let i = 1; i <= 255; i += batchSize) {
            if (isConnected) break;
            const promises = [];
            for (let j = i; j < i + batchSize && j <= 255; j++) {
                const ip = subnet === '127.0.0.1' ? subnet : `${subnet}.${j}`;
                promises.push(checkServer(ip, port));
                if (subnet === '127.0.0.1') break; 
            }
            await Promise.all(promises);
        }
    }
    
    isScanning = false;
    if (!isConnected) {
        setTimeout(startSilentDiscovery, 5 * 60 * 1000);
    }
}

async function checkServer(ip, port) {
    if (isConnected) return;
    const url = `${ip}:${port}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 800);
        const resp = await fetch(`http://${url}/ping`, { signal: controller.signal });
        const data = await resp.json();
        if (data && data.app === 'CookieSyncServer') {
            currentUrl = url;
            chrome.storage.local.set({ serverUrl: url });
            connectWebSocket(url);
        }
        clearTimeout(timeoutId);
    } catch (e) {}
}

function connectWebSocket(url) {
    if (socket) socket.close();
    if (!url) return;
    
    let wsUrl = url.includes('://') ? url.replace('http', 'ws') : `ws://${url}`;
    if (!wsUrl.includes('/live')) wsUrl = wsUrl.endsWith('/') ? wsUrl + 'live' : wsUrl + '/live';

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        isConnected = true;
        isScanning = false;
        const hb = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send('ping');
            } else {
                clearInterval(hb);
            }
        }, 25000);
    };

    socket.onmessage = async (event) => {
        if (event.data === 'pong') return;
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'UPDATE_COOKIES' || data.type === 'INIT_COOKIES') {
                if (data.time && data.time === lastProcessedTime) return;
                const changed = await applyCookies(data.cookies);
                lastSyncTime = new Date().toLocaleTimeString();
                if (changed) {
                    lastProcessedTime = data.time; 
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon128.png',
                        title: 'Cookie 同步成功',
                        message: `站点 ${data.domain} 已自动同步更新`
                    });
                }
            }
        } catch (e) {}
    };

    socket.onclose = () => {
        isConnected = false;
        setTimeout(() => {
            if (currentUrl) connectWebSocket(currentUrl);
            else startSilentDiscovery();
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
            const existing = await chrome.cookies.get({ url: url, name: cleanCookie.name, storeId: cleanCookie.storeId });
            if (!existing || existing.value !== cleanCookie.value) {
                await chrome.cookies.set(cleanCookie);
                changeCount++;
            }
        } catch (e) {}
    }
    return changeCount > 0;
}
