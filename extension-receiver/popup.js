document.addEventListener('DOMContentLoaded', () => {
    const dot = document.getElementById('dot');
    const statusText = document.getElementById('status-text');
    const statsArea = document.getElementById('stats-area');
    const urlText = document.getElementById('server-url');
    const lastSyncText = document.getElementById('last-sync');

    const updateStats = () => {
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (status) => {
            if (chrome.runtime.lastError) return;
            if (status) {
                dot.className = 'dot';
                if (status.connected) {
                    dot.classList.add('active');
                    statusText.textContent = '接收服务在线';
                    statsArea.style.display = 'block';
                    urlText.textContent = status.url;
                    lastSyncText.textContent = status.lastSync || '从未';
                } else if (status.scanning) {
                    dot.classList.add('scanning');
                    statusText.textContent = '搜寻局域网节点...';
                    statsArea.style.display = 'none';
                } else {
                    statusText.textContent = '等待握手重试';
                    statsArea.style.display = 'none';
                }
            }
        });
    };

    updateStats();
    setInterval(updateStats, 1000);
});
