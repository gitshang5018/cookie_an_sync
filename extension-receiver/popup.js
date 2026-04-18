document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        serverUrl: document.getElementById('server-url'),
        btnListen: document.getElementById('btn-listen'),
        statusBadge: document.getElementById('status-badge'),
        lastSyncTime: document.getElementById('last-sync-time'),
        messageArea: document.getElementById('message-area')
    };

    // 1. 加载配置
    const config = await chrome.storage.local.get(['serverUrl', 'lastSyncTime', 'isListening']);
    elements.serverUrl.value = config.serverUrl || '192.168.2.2:3000';
    if (config.lastSyncTime) elements.lastSyncTime.textContent = config.lastSyncTime;
    
    // 2. 初始化状态
    updateUI(config.isListening);

    // 3. 实时更新状态
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'STATUS_UPDATE') {
            updateUI(msg.connected);
        } else if (msg.action === 'SYNC_READY') {
            elements.lastSyncTime.textContent = msg.time;
            showMessage('收到同步！', 'success');
        }
    });

    // 4. 监听动作
    elements.btnListen.addEventListener('click', () => {
        const url = elements.serverUrl.value.trim();
        if (!url) {
            showMessage('请填写服务器地址', 'error');
            return;
        }

        chrome.storage.local.set({ serverUrl: url, isListening: true });
        chrome.runtime.sendMessage({ action: 'START_LISTENING', serverUrl: url });
        updateUI(true);
    });

    function updateUI(connected) {
        if (connected) {
            elements.statusBadge.textContent = '已连接';
            elements.statusBadge.className = 'badge connected';
            elements.btnListen.disabled = true;
            elements.btnListen.textContent = '正在监听中...';
        } else {
            elements.statusBadge.textContent = '未连接';
            elements.statusBadge.className = 'badge disconnected';
            elements.btnListen.disabled = false;
            elements.btnListen.textContent = '开始监听更新';
        }
    }

    const showMessage = (msg, type) => {
        elements.messageArea.textContent = msg;
        elements.messageArea.style.color = type === 'error' ? '#ef4444' : '#10b981';
        setTimeout(() => { elements.messageArea.textContent = ''; }, 3000);
    };
});
