document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        serverUrl: document.getElementById('server-url'),
        targetDomain: document.getElementById('target-domain'),
        btnSyncNow: document.getElementById('btn-sync-now'),
        messageArea: document.getElementById('message-area')
    };

    // 1. 加载配置
    const config = await chrome.storage.local.get(['serverUrl', 'targetDomain']);
    elements.serverUrl.value = config.serverUrl || '192.168.2.2:3000';
    elements.targetDomain.value = config.targetDomain || '';

    // 2. 保存配置
    const saveConfig = () => {
        chrome.storage.local.set({
            serverUrl: elements.serverUrl.value.trim(),
            targetDomain: elements.targetDomain.value.trim()
        });
    };
    elements.serverUrl.addEventListener('input', saveConfig);
    elements.targetDomain.addEventListener('input', saveConfig);

    // 3. 推送动作
    elements.btnSyncNow.addEventListener('click', () => {
        saveConfig();
        const url = elements.serverUrl.value.trim();
        const domains = elements.targetDomain.value.trim();
        
        if (!url || !domains) {
            showMessage('请填写地址和域名', 'error');
            return;
        }

        elements.btnSyncNow.disabled = true;
        elements.btnSyncNow.textContent = '同步中...';

        chrome.runtime.sendMessage({ 
            action: 'SYNC_NOW',
            payload: { serverUrl: url, targetDomain: domains }
        }, (response) => {
            elements.btnSyncNow.disabled = false;
            elements.btnSyncNow.textContent = '立即推送同步';
            if (response && response.success) {
                showMessage('同步成功！', 'success');
            } else {
                showMessage('同步失败: ' + (response?.error || '请求超时'), 'error');
            }
        });
    });

    const showMessage = (msg, type) => {
        elements.messageArea.textContent = msg;
        elements.messageArea.style.color = type === 'error' ? '#ef4444' : '#10b981';
        setTimeout(() => { elements.messageArea.textContent = ''; }, 3000);
    };
});
