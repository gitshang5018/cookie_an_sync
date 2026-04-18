// Cookie Sync (Sender 版) - 背景脚本
// 核心逻辑：响应 Popup 的 SYNC_NOW 指令，抓取并 POST 到中转站

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SYNC_NOW') {
        handleSync(message.payload).then(sendResponse);
        return true; // 保持通道异步
    }
});

async function handleSync(data) {
    try {
        const { serverUrl, targetDomain } = data;
        let fullUrl = serverUrl;
        if (!fullUrl.startsWith('http')) fullUrl = 'http://' + fullUrl;

        // 整理域名列表
        const domains = targetDomain.split(',').map(d => d.trim()).filter(d => d);
        
        // 抓取逻辑
        const cookiesToSync = [];
        for (const domain of domains) {
            const cookies = await chrome.cookies.getAll({ domain });
            cookiesToSync.push(...cookies);
        }

        if (cookiesToSync.length === 0) {
            return { success: false, error: '未找到相关 Cookie' };
        }

        // 推送
        const response = await fetch(`${fullUrl}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                domain: domains.join(', '),
                cookies: cookiesToSync
            })
        });

        if (response.ok) {
            return { success: true };
        } else {
            return { success: false, error: `服务器返回: ${response.status}` };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}
