document.addEventListener('DOMContentLoaded', async () => {
    const elements = {
        btnProvider: document.getElementById('btn-provider'),
        btnConsumer: document.getElementById('btn-consumer'),
        providerPanel: document.getElementById('provider-panel'),
        consumerPanel: document.getElementById('consumer-panel'),
        serverUrl: document.getElementById('server-url'),
        targetDomain: document.getElementById('target-domain'),
        btnSyncNow: document.getElementById('btn-sync-now'),
        btnListen: document.getElementById('btn-listen'),
        statusBadge: document.getElementById('status-badge'),
        lastSyncTime: document.getElementById('last-sync-time'),
        messageArea: document.getElementById('message-area')
    };

    // 1. 加载配置
    const config = await chrome.storage.local.get(['role', 'serverUrl', 'targetDomain', 'isListening']);
    elements.serverUrl.value = config.serverUrl || '';
    elements.targetDomain.value = config.targetDomain || '';
    
    // 初始化角色显示
    const setRole = (role) => {
        chrome.storage.local.set({ role });
        if (role === 'provider') {
            elements.btnProvider.classList.add('active');
            elements.btnConsumer.classList.remove('active');
            elements.providerPanel.classList.remove('hidden');
            elements.consumerPanel.classList.add('hidden');
        } else {
            elements.btnProvider.classList.remove('active');
            elements.btnConsumer.classList.add('active');
            elements.providerPanel.classList.add('hidden');
            elements.consumerPanel.classList.remove('hidden');
        }
    };
    setRole(config.role || 'provider');

    // 2. 事件监听
    elements.btnProvider.addEventListener('click', () => setRole('provider'));
    elements.btnConsumer.addEventListener('click', () => setRole('consumer'));

    // 保存配置变化
    const saveConfig = () => {
        chrome.storage.local.set({
            serverUrl: elements.serverUrl.value.trim(),
            targetDomain: elements.targetDomain.value.trim()
        });
    };
    elements.serverUrl.addEventListener('input', saveConfig);
    elements.targetDomain.addEventListener('input', saveConfig);

    // 发送端：立即同步
    elements.btnSyncNow.addEventListener('click', () => {
        saveConfig();
        const url = elements.serverUrl.value.trim();
        const domains = elements.targetDomain.value.trim();
        
        if (!url || !domains) {
            showMessage('请填写中转站地址和域名', 'error');
            return;
        }

        elements.btnSyncNow.disabled = true;
        elements.btnSyncNow.textContent = '正在同步...';

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

    // 接收端：开始/停止监听
    elements.btnListen.addEventListener('click', async () => {
        saveConfig();
        const { isListening } = await chrome.storage.local.get('isListening');
        const action = isListening ? 'STOP_LISTEN' : 'START_LISTEN';
        
        chrome.runtime.sendMessage({ action }, (response) => {
            updateListenUI(!isListening);
            if (response?.success) {
                showMessage(isListening ? '已停止监听' : '正在监听更新...', 'success');
            }
        });
    });

    const updateListenUI = (isListening) => {
        elements.btnListen.textContent = isListening ? '停止监听' : '开始监听';
        elements.btnListen.classList.toggle('primary', !isListening);
    };

    const showMessage = (msg, type) => {
        elements.messageArea.textContent = msg;
        elements.messageArea.style.color = type === 'error' ? '#ef4444' : '#94a3b8';
        setTimeout(() => { elements.messageArea.textContent = ''; }, 3000);
    };

    // 初始监听 UI 状态
    updateListenUI(!!config.isListening);

    // 定时轮询 background 获取连接状态
    const updateStatus = () => {
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, async (status) => {
            if (chrome.runtime.lastError) return;
            if (status) {
                const { isListening } = await chrome.storage.local.get('isListening');
                let statusText = '未连接';
                let isConnected = status.connected;

                if (isConnected) {
                    statusText = '已连接';
                } else if (isListening) {
                    statusText = '连接中...';
                }

                elements.statusBadge.textContent = statusText;
                elements.statusBadge.classList.toggle('connected', isConnected);
                elements.statusBadge.classList.toggle('disconnected', !isConnected);
                
                if (status.lastSync) {
                    elements.lastSyncTime.textContent = status.lastSync;
                }
            }
        });
    };
    updateStatus();
    setInterval(updateStatus, 2000);
});
