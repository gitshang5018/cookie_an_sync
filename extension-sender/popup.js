document.addEventListener('DOMContentLoaded', () => {
    const dot = document.getElementById('dot');
    const statusText = document.getElementById('status-text');
    const infoArea = document.getElementById('info-area');
    const urlText = document.getElementById('server-url');

    const updateStats = () => {
        chrome.runtime.sendMessage({ action: 'GET_STATUS' }, (status) => {
            if (chrome.runtime.lastError) return;
            if (status) {
                dot.className = 'dot';
                if (status.connected) {
                    dot.classList.add('active');
                    statusText.textContent = '服务已就绪';
                    infoArea.style.display = 'block';
                    urlText.textContent = status.url;
                } else if (status.scanning) {
                    dot.classList.add('scanning');
                    statusText.textContent = '正在搜索局域网...';
                    infoArea.style.display = 'none';
                } else {
                    statusText.textContent = '等待搜索启动';
                    infoArea.style.display = 'none';
                }
            }
        });
    };

    updateStats();
    setInterval(updateStats, 1000);
});
