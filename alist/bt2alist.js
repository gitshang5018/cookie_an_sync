// ==UserScript==
// @name         Alist BT 自动发送助手
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  监控网页中的 .torrent 文件链接或磁力链接，一键发送到 Alist 并联动 Openlist
// @author       You
// @match        *://1lou.me/*
// @match        *://*.1lou.me/*
// @match        *://1lou.cc/*
// @match        *://*.1lou.cc/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.themoviedb.org
// @connect      api.tmdb.org
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    console.log('[AList Helper] 脚本已加载', location.href);

    // 默认配置 (需手动输入)
    const defaultConfig = {
        alistUrl: '',
        alistToken: '',
        downloadPath: '/',
        pathMovie: '/xunlei/电影',
        pathSeries: '/xunlei/剧集',
        pathAnime: '/xunlei/动漫',
        dlTool: 'aria2', // aria2 或 storage
        openlistEnabled: false,
        openlistUrl: '',
        openlistToken: '',
        openlistPath: '',
        openlistRate: 0,
        // 智能命名 (TMDB)
        renameEnabled: false,
        tmdbApiKey: '',
        tmdbLang: 'zh-CN',
        tmdbHost: 'https://api.themoviedb.org', // 国内可改反代，如 https://tmdb.xxx.workers.dev
        renamePollTimeout: 1800 // 秒，最长等待 30 分钟
    };

    let config = { ...defaultConfig, ...GM_getValue('alist_bt_config', {}) };

    // --- 全局任务状态跟踪 ---
    let activeTaskCount = 0;
    window.addEventListener('beforeunload', (e) => {
        if (activeTaskCount > 0) {
            e.preventDefault();
            e.returnValue = '有发送任务或索引更新正在后台执行，确定要离开吗？';
            return e.returnValue;
        }
    });

    // --- UI 注入 ---
    GM_addStyle(`
        #alist-bt-helper {
            position: fixed !important;
            bottom: 20px !important;
            right: 20px !important;
            z-index: 2147483647 !important;
            font-family: system-ui, -apple-system, sans-serif;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        #alist-btn-trigger {
            background: #0066cc !important;
            color: white !important;
            border: none !important;
            border-radius: 50% !important;
            width: 50px !important;
            height: 50px !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            transition: transform 0.2s;
            visibility: visible !important;
            opacity: 1 !important;
        }
        #alist-btn-trigger:hover { transform: scale(1.05); }
        #alist-floating-batch {
            position: fixed;
            top: 50%;
            right: 12px;
            transform: translateY(-50%);
            z-index: 999998;
            display: none;
            flex-direction: column;
            gap: 8px;
            font-family: system-ui, -apple-system, sans-serif;
        }
        #alist-floating-batch.show { display: flex; }
        .alist-float-btn {
            min-width: 110px;
            padding: 8px 12px;
            color: white;
            border: none;
            border-radius: 24px;
            cursor: pointer;
            font-size: 13px;
            line-height: 1.4;
            box-shadow: 0 3px 10px rgba(0,0,0,0.25);
            transition: transform 0.15s, opacity 0.15s;
            text-align: center;
        }
        .alist-float-btn:hover:not(:disabled) { transform: translateX(-3px); }
        .alist-float-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        #alist-panel {
            display: none;
            position: absolute;
            bottom: 60px;
            right: 0;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            width: 320px;
            padding: 16px;
            color: #333;
        }
        #alist-panel.show { display: block; }
        .alist-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
        .alist-header h3 { margin: 0; font-size: 16px; }
        .alist-close { cursor: pointer; color: #666; background: none; border: none; font-size: 18px; }
        .alist-tabs { display: flex; margin-bottom: 12px; }
        .alist-tab { flex: 1; text-align: center; padding: 6px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 14px; }
        .alist-tab.active { border-bottom-color: #0066cc; color: #0066cc; font-weight: bold; }
        .alist-tab-content { display: none; max-height: 400px; overflow-y: auto; }
        .alist-tab-content.active { display: block; }
        .alist-form-group { margin-bottom: 10px; }
        .alist-form-group label { display: block; font-size: 12px; margin-bottom: 4px; color: #555; }
        .alist-form-group input, .alist-form-group select { width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 13px; }
        .alist-form-group input[type="checkbox"] { width: auto; margin-right: 8px; }
        .alist-checkbox-label { display: flex; align-items: center; font-size: 13px; cursor: pointer; }
        .alist-btn { background: #0066cc; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-size: 14px; margin-top: 8px; }
        .alist-btn:disabled { background: #ccc; cursor: not-allowed; }
        .alist-link-list { list-style: none; padding: 0; margin: 0; }
        .alist-link-item { font-size: 12px; padding: 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .alist-link-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
        .alist-link-btn { background: #4caf50; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .alist-log { font-size: 12px; color: #666; margin-top: 10px; max-height: 100px; overflow-y: auto; background: #f5f5f5; padding: 8px; border-radius: 4px; }
        .alist-section-title { font-size: 14px; font-weight: bold; margin: 12px 0 8px; border-top: 1px solid #eee; padding-top: 8px; }
    `);

    const uiHtml = `
        <div id="alist-bt-helper">
            <div id="alist-panel">
                <div class="alist-header">
                    <h3>AList BT 助手</h3>
                    <button class="alist-close" id="alist-close-btn">&times;</button>
                </div>
                <div class="alist-tabs">
                    <div class="alist-tab active" data-target="links">发现链接 (<span id="alist-link-count">0</span>)</div>
                    <div class="alist-tab" data-target="config">设置</div>
                </div>

                <div id="alist-tab-links" class="alist-tab-content active">
                    <ul id="alist-link-list-ul" class="alist-link-list">
                        <!-- 链接将在这里动态生成 -->
                    </ul>
                    <div style="display: flex; gap: 6px; margin-top: 12px;">
                        <button id="alist-send-all-movie" class="alist-btn" style="margin-top:0; background:#f59e0b; padding:6px;">全部发电影</button>
                        <button id="alist-send-all-series" class="alist-btn" style="margin-top:0; background:#3b82f6; padding:6px;">全部发剧集</button>
                        <button id="alist-send-all-anime" class="alist-btn" style="margin-top:0; background:#ec4899; padding:6px;">全部发动漫</button>
                    </div>
                    <div id="alist-log" class="alist-log"></div>
                </div>

                <div id="alist-tab-config" class="alist-tab-content">
                    <div class="alist-section-title" style="border:none; padding:0; margin-top:0;">Alist 设置</div>
                    <div class="alist-form-group">
                        <label>Alist 地址</label>
                        <input type="text" id="cfg-alist-url" placeholder="http://localhost:5244">
                    </div>
                    <div class="alist-form-group">
                        <label>Alist Token</label>
                        <input type="password" id="cfg-alist-token">
                    </div>
                    <div class="alist-form-group">
                        <label>默认下载目录 (Fallback)</label>
                        <input type="text" id="cfg-alist-path" placeholder="/Downloads">
                    </div>
                    <div style="display:flex; gap:8px; margin-bottom: 10px;">
                        <div class="alist-form-group" style="margin-bottom:0; flex:1;">
                            <label>🎬 电影目录</label><input type="text" id="cfg-alist-path-movie" placeholder="/电影">
                        </div>
                        <div class="alist-form-group" style="margin-bottom:0; flex:1;">
                            <label>📺 剧集目录</label><input type="text" id="cfg-alist-path-series" placeholder="/剧集">
                        </div>
                        <div class="alist-form-group" style="margin-bottom:0; flex:1;">
                            <label>🎌 动漫目录</label><input type="text" id="cfg-alist-path-anime" placeholder="/动漫">
                        </div>
                    </div>
                    <div class="alist-form-group">
                        <label>下载工具</label>
                        <select id="cfg-dl-tool">
                            <option value="aria2">Aria2</option>
                            <option value="storage">Storage (本地)</option>
                        </select>
                    </div>

                    <div class="alist-section-title">智能命名 (TMDB)</div>
                    <div class="alist-form-group">
                        <label class="alist-checkbox-label">
                            <input type="checkbox" id="cfg-rename-enabled">
                            发送后等待下载并自动命名
                        </label>
                    </div>
                    <div class="alist-form-group">
                        <label>TMDB API Key</label>
                        <input type="password" id="cfg-tmdb-key" placeholder="themoviedb.org 申请 v3 API Key">
                    </div>
                    <div class="alist-form-group">
                        <label>TMDB Host (国内可填反代)</label>
                        <input type="text" id="cfg-tmdb-host" placeholder="https://api.themoviedb.org">
                    </div>
                    <div style="display:flex; gap:8px; margin-bottom: 10px;">
                        <div class="alist-form-group" style="margin-bottom:0; flex:1;">
                            <label>TMDB 语言</label>
                            <select id="cfg-tmdb-lang">
                                <option value="zh-CN">中文 (zh-CN)</option>
                                <option value="zh-TW">繁体 (zh-TW)</option>
                                <option value="en-US">English</option>
                                <option value="ja-JP">日本語</option>
                            </select>
                        </div>
                        <div class="alist-form-group" style="margin-bottom:0; flex:1;">
                            <label>轮询超时 (秒)</label>
                            <input type="number" id="cfg-rename-timeout" placeholder="1800">
                        </div>
                    </div>

                    <div class="alist-section-title">Openlist 联动</div>
                    <div class="alist-form-group">
                        <label class="alist-checkbox-label">
                            <input type="checkbox" id="cfg-ol-enabled">
                            发送后触发 Openlist 扫描
                        </label>
                    </div>
                    <div class="alist-form-group">
                        <label>Openlist 地址</label>
                        <input type="text" id="cfg-ol-url" placeholder="http://192.168.1.100:3000">
                    </div>
                    <div class="alist-form-group">
                        <label>Openlist Token</label>
                        <input type="password" id="cfg-ol-token">
                    </div>
                    <div class="alist-form-group">
                        <label>基础扫描路径 (Strm)</label>
                        <input type="text" id="cfg-ol-path" placeholder="如 /Strm (自动追加 /电影 等)">
                    </div>
                    <div class="alist-form-group">
                        <label>速率限制 (Rate)</label>
                        <input type="number" id="cfg-ol-rate" step="0.1" placeholder="0 = 无限制">
                    </div>

                    <button id="alist-save-config" class="alist-btn">保存设置</button>
                </div>
            </div>
            <button id="alist-btn-trigger">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
            </button>
        </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = uiHtml;

    function injectContainer() {
        if (!document.body) {
            setTimeout(injectContainer, 100);
            return;
        }
        if (!document.getElementById('alist-bt-helper')) {
            document.body.appendChild(container);
        }
        // UI 就绪后启动事件绑定
        if (!container.dataset.inited) {
            container.dataset.inited = '1';
            initUI();
        }
        // 注入后再做一次保险：若被站点脚本移除，5 秒后重新挂载
        setTimeout(() => {
            if (!document.getElementById('alist-bt-helper') && document.body) {
                document.body.appendChild(container);
                console.log('[AList Helper] 检测到 UI 被移除，已重新挂载');
            }
        }, 5000);
    }
    injectContainer();

    // --- 逻辑与状态 ---
    let foundLinks = []; // { url, name, type: 'magnet'|'torrent' }

    function log(msg) {
        const logEl = document.getElementById('alist-log');
        logEl.innerHTML += `<div>${new Date().toLocaleTimeString()} - ${msg}</div>`;
        logEl.scrollTop = logEl.scrollHeight;
        console.log('[AList Helper]', msg);
    }

    // --- Bencode 与哈希生成 (极简版) ---
    async function getTorrentBuffer(url) {
        try {
            // 优先尝试原生 fetch，它能完美携带当前站点的 Cookie 和原生 Header，应对同源防盗链效果最好
            const res = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
                }
            });
            if (res.ok) {
                return await res.arrayBuffer();
            }
            throw new Error(`Fetch HTTP ${res.status}`);
        } catch (err) {
            log(`fetch 失败 (${err.message})，尝试 GM_xmlhttpRequest...`);
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer',
                    headers: {
                        'Referer': window.location.href,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
                    },
                    onload: function(res) {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.response);
                        } else {
                            reject(new Error(`HTTP ${res.status}`));
                        }
                    },
                    onerror: (e) => reject(new Error('网络请求失败'))
                });
            });
        }
    }

    async function getMagnetFromTorrent(url, name) {
        log(`正在下载并解析种子: ${name}`);
        const arrayBuffer = await getTorrentBuffer(url);
        const buffer = new Uint8Array(arrayBuffer);
        const infoBytes = getInfoRawBytes(buffer);
        if (!infoBytes) throw new Error('找不到 info 字典(可能无权限或文件损坏)');

        const hashBuffer = await crypto.subtle.digest('SHA-1', infoBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const infoHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
    }

    function getInfoRawBytes(buffer) {
        let pos = 0;
        if (buffer[pos] !== 100) return null; // 'd'
        pos++;
        while (pos < buffer.length && buffer[pos] !== 101) { // 'e'
            const keyStart = pos;
            while (buffer[pos] !== 58) pos++; // ':'
            const keyLen = parseInt(String.fromCharCode(...buffer.slice(keyStart, pos)), 10);
            pos++;
            const key = String.fromCharCode(...buffer.slice(pos, pos + keyLen));
            pos += keyLen;

            if (key === 'info') {
                const infoStart = pos;
                pos = skipBencodeValue(buffer, pos);
                return buffer.slice(infoStart, pos);
            } else {
                pos = skipBencodeValue(buffer, pos);
            }
        }
        return null;
    }

    function skipBencodeValue(buffer, pos) {
        const char = buffer[pos];
        if (char === 105) { // 'i'
            pos++; while (buffer[pos] !== 101) pos++; pos++; return pos;
        } else if (char === 108) { // 'l'
            pos++; while (buffer[pos] !== 101) pos = skipBencodeValue(buffer, pos); pos++; return pos;
        } else if (char === 100) { // 'd'
            pos++; while (buffer[pos] !== 101) { pos = skipBencodeValue(buffer, pos); pos = skipBencodeValue(buffer, pos); } pos++; return pos;
        } else if (char >= 48 && char <= 57) { // str
            const start = pos; while (buffer[pos] !== 58) pos++;
            const len = parseInt(String.fromCharCode(...buffer.slice(start, pos)), 10);
            pos++; pos += len; return pos;
        }
        return pos + 1;
    }

    // --- API 调用 ---
    async function sendToAlist(magnetUrl, path) {
        if (!config.alistUrl || !config.alistToken) throw new Error('Alist 未配置');
        const apiUrl = `${config.alistUrl.replace(/\/$/, '')}/api/fs/add_offline_download`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: apiUrl,
                headers: {
                    'Authorization': config.alistToken,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    path: path || config.downloadPath,
                    urls: [magnetUrl],
                    tool: config.dlTool,
                    delete_policy: 'delete_on_upload_succeed'
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.code === 200) resolve(data.data || true);
                        else reject(new Error(data.message));
                    } catch(e) { reject(new Error('解析 API 响应失败')); }
                },
                onerror: () => reject(new Error('网络请求失败'))
            });
        });
    }

    // 列出目录返回文件名集合
    async function listDir(path) {
        if (!config.alistUrl || !config.alistToken) throw new Error('Alist 未配置');
        const apiUrl = `${config.alistUrl.replace(/\/$/, '')}/api/fs/list`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: apiUrl,
                headers: {
                    'Authorization': config.alistToken,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    path: path,
                    password: '',
                    page: 1,
                    per_page: 1000,
                    refresh: true
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.code !== 200) return reject(new Error(data.message || `HTTP ${res.status}`));
                        const items = (data.data && data.data.content) || [];
                        resolve(items.map(i => ({ name: i.name, is_dir: !!i.is_dir, size: i.size || 0 })));
                    } catch(e) { reject(new Error('解析列表响应失败')); }
                },
                onerror: () => reject(new Error('列目录请求失败'))
            });
        });
    }

    // 查询某个任务是否仍在 undone 列表中
    async function fetchUndoneTaskIds(endpoint) {
        const apiUrl = `${config.alistUrl.replace(/\/$/, '')}/api/admin/task/${endpoint}/undone`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: apiUrl,
                headers: { 'Authorization': config.alistToken },
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.code !== 200) return resolve([]); // 接口不可用时当作无任务
                        resolve((data.data || []).map(t => String(t.id)));
                    } catch(e) { resolve([]); }
                },
                onerror: () => resolve([])
            });
        });
    }

    // 等待提交的离线任务及其转存任务完成；timeoutSec 后放弃
    async function waitForTasks(taskIds, timeoutSec) {
        if (!taskIds || !taskIds.length) return false;
        const idSet = new Set(taskIds.map(String));
        const start = Date.now();
        const deadline = start + timeoutSec * 1000;
        log(`等待 ${idSet.size} 个 AList 任务完成 (最长 ${timeoutSec}s)...`);

        while (Date.now() < deadline) {
            const [dlUndone, trUndone] = await Promise.all([
                fetchUndoneTaskIds('offline_download'),
                fetchUndoneTaskIds('offline_download_transfer')
            ]);
            const stillPending = dlUndone.concat(trUndone).some(id => idSet.has(id));
            if (!stillPending) {
                // 提交的任务都已离开 undone 列表，但转存任务可能稍后才出现；再等一轮观察
                await new Promise(r => setTimeout(r, 5000));
                const [dl2, tr2] = await Promise.all([
                    fetchUndoneTaskIds('offline_download'),
                    fetchUndoneTaskIds('offline_download_transfer')
                ]);
                const stillPending2 = dl2.concat(tr2).some(id => idSet.has(id));
                if (!stillPending2) {
                    log('✅ AList 任务已全部完成');
                    return true;
                }
            }
            await new Promise(r => setTimeout(r, 5000));
        }
        log(`⏱️ 任务等待超时 (${timeoutSec}s)，按当前目录状态继续`);
        return false;
    }

    async function alistRename(fullPath, newName) {
        const apiUrl = `${config.alistUrl.replace(/\/$/, '')}/api/fs/rename`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: apiUrl,
                headers: {
                    'Authorization': config.alistToken,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({ path: fullPath, name: newName }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.code === 200) resolve(true);
                        else reject(new Error(data.message || `HTTP ${res.status}`));
                    } catch(e) { reject(new Error('解析 rename 响应失败')); }
                },
                onerror: () => reject(new Error('rename 请求失败'))
            });
        });
    }

    // --- 提取公共方法：通用目录刷新 ---
    async function refreshDirectory(baseUrl, token, path, serverName) {
        if (!baseUrl || !token || !path) return;
        const apiUrl = `${baseUrl.replace(/\/$/, '')}/api/fs/list`;
        log(`正在触发 ${serverName} 目录刷新: ${path}`);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: apiUrl,
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    path: path,
                    password: '',
                    page: 1,
                    per_page: 30,
                    refresh: true
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.code === 200) {
                            log(`✅ ${serverName} 目录刷新完成`);
                            resolve(true);
                        } else {
                            reject(new Error(data.message || `HTTP ${res.status}`));
                        }
                    } catch(e) { reject(new Error('解析 API 响应失败')); }
                },
                onerror: () => reject(new Error('网络请求失败'))
            });
        });
    }

    async function triggerOpenlistScan(targetPath) {
        if (!config.openlistEnabled || !config.openlistUrl || !config.openlistToken || !config.openlistPath) return;

        // 确保扫描路径格式绝对正确（去除首尾空格，确保以 / 开头）
        let scanPath = config.openlistPath.trim();
        if (!scanPath.startsWith('/')) scanPath = '/' + scanPath;

        // --- 动态分类目录映射 ---
        // 获取下载目录的最后一级名称
        const dlParts = (targetPath || config.downloadPath).split('/').filter(p => p.trim() !== '');
        const lastDir = dlParts.length > 0 ? dlParts[dlParts.length - 1] : '';

        // 如果下载目录是特定分类，且基础扫描路径未包含该分类，则自动追加
        const autoAppendDirs = ['电影', '剧集', '动漫', '电视剧', '纪录片', '综艺'];
        if (autoAppendDirs.includes(lastDir) && !scanPath.endsWith(lastDir)) {
            scanPath = scanPath.replace(/\/$/, '') + '/' + lastDir;
        }

        // AList V3 官方 API (router.go: index.POST("/update", ...))
        const updateUrl = `${config.openlistUrl.replace(/\/$/, '')}/api/admin/index/update`;

        log(`正在调用 AList 官方 API 更新索引 [路径: ${scanPath}]...`);

        const triggerUpdate = new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: updateUrl,
                headers: {
                    'Authorization': config.openlistToken,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    paths: [scanPath], // AList 官方要求必须是数组
                    max_depth: 20      // AList 官方前端默认值为 20
                }),
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.code === 200) {
                            resolve(data);
                        } else {
                            reject(new Error(data.message || `HTTP ${res.status}`));
                        }
                    } catch(e) {
                        if (res.status === 200) resolve(res.responseText);
                        else reject(new Error(`HTTP ${res.status} - 接口异常`));
                    }
                },
                onerror: () => reject(new Error('网络请求彻底失败(可能被拦截或跨域)'))
            });
        });

        try {
            await triggerUpdate;
            log(`✅ Openlist 索引更新信号已下发`);
            return true;
        } catch(e) {
            throw new Error(`接口拒绝: ${e.message}`);
        }
    }

    // 提取所有方括号片段及其内容
    function tokenizeBracketTags(str) {
        const tokens = [];
        const re = /[\[\【]([^\[\]\【\】]+)[\]\】]/g;
        let m;
        while ((m = re.exec(str)) !== null) {
            tokens.push(m[1].trim());
        }
        return tokens;
    }

    // 判断括号内容是否为已知垃圾标签（规格/编码/语言/发布组等）
    function isJunkTag(tag) {
        if (!tag) return true;
        const t = tag.trim();
        const patterns = [
            // 文件格式 + 体积
            /^WEB[-\.]?(MKV|DL|Rip)\b/i, /^WEBRip$/i, /^(BluRay|Blu-Ray|BDRip|BDRemux|HDTV|HDRip|REMUX|REPACK|PROPER)\b/i,
            /^WEB-MKV\s*\/.*GB$/i, /^[\d\.]+\s*(GB|MB|TB)$/i,
            // 分辨率
            /^(2160p|1080p|720p|480p|4K|UHD|4K[-\s]?2160P|2160P)$/i,
            // HDR / 杜比
            /^(HDR\d*\+?|HDR版本|HDR\s?10\+?|杜比视界(?:版本)?|HQ|SDR|DV|DoVi|10bit|8bit)$/i,
            // 编码
            /^(H\.?264|H\.?265|HEVC|AVC|x264|x265|H26[45]编码)$/i,
            // 字幕/配音
            /^(简繁|中字|英字|内嵌|内封|官中|官方简体|繁中|简中|双语)/,
            /字幕$/, /配音$/, /^.{0,8}(双语|国粤|国英|国日|中英|国语|粤语)/,
            // 杂项
            /^(流媒体|高码版?|国配|完结|未删减|加长版|导演剪辑版|3D|2D|IMAX|60帧率?|60帧)$/,
            // 音频
            /^(AAC|FLAC|DTS(?:-HD)?|AC3|DDP?[\d\.]+|TrueHD|Atmos|EAC3|MA)$/i,
            // 纯年份
            /^(19|20)\d{2}$/,
            // 已知发布组 / 流媒体源标
            /^(QuickIO|PandaQT|DreamHD|FRDS|CHDBits|HDChina|HHWEB|MTeam|NTb|FLUX|TEPES|NF|AMZN|DSNP|HMAX|ATVP|iTunes)$/i,
        ];
        return patterns.some(p => p.test(t));
    }

    const CJK_CLASS = '\\u4e00-\\u9fa5\\u3041-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7a3';
    const CJK_RE = new RegExp(`[${CJK_CLASS}]`);

    function isJunkToken(tok) {
        if (!tok) return true;
        const t = tok.trim();
        if (!t) return true;
        if (isJunkTag(t)) return true;
        const patterns = [
            /^(mp4|mkv|avi|rmvb|ts|m2ts|webm|mov|wmv|flv|iso|m4v)$/i,
            /^\d{2,3}帧(率)?$/,
            /^(BD|HD|UHD|WEB|DVD|TV|CAM|TS|TC)$/i,
            /^(国粤双语|国英双语|中英双语|国日双语|国韩双语|双语|国粤|国英|国日|中英)/,
            /^(国语|粤语|英语|日语|韩语|普通话)(中字|高清|版|配音|原声)?$/,
            /^(中字|英字|双字|简繁|简中|繁中|官中|官方简体|官方繁体|内嵌|内封|内嵌字幕|内封字幕|中文字幕|英文字幕|繁体字幕|简体字幕)$/,
            /^(BD中字|HD中字|HD国粤|BD国粤|HD国语|BD国语|HD粤语|BD粤语|HD中英|BD中英|HD双语|BD双语)/,
            /^(无水印|高清|超清|完结(版)?|未删减|加长版|导演剪辑版|纪念版|杜比视界(版本)?|HDR版本|国配版?|公映版|港版|台版|美版|日版|韩版)$/,
            /^(2160p|1080p|720p|480p|4K|8K|UHD|HDR10\+?|HDR|DV|DoVi)$/i,
            /^(H\.?264|H\.?265|HEVC|AVC|x264|x265|10bits?|8bits?)$/i,
            /^(AAC|FLAC|AC3|DTS(?:-HD)?|DDP?[\d\.]*|TrueHD|Atmos|EAC3|MA|MP3|OGG|OPUS)$/i,
            /^[\d\.]+(GB|MB|TB)$/i,
            /^(19|20)\d{2}$/,
        ];
        return patterns.some(p => p.test(t));
    }

    function trimJunkTokens(title, sep) {
        if (!title) return title;
        const splitRe = sep === '.' ? /\./ : /\s+/;
        const tokens = String(title).trim().split(splitRe);
        if (tokens.length <= 1) return tokens.join(' ').trim();
        let cut = tokens.length;
        for (let i = 1; i < tokens.length; i++) {
            if (isJunkToken(tokens[i])) { cut = i; break; }
        }
        return tokens.slice(0, cut).join(' ').trim();
    }

    function stripSingleLetterPrefix(s) {
        return s.replace(new RegExp(`^[A-Za-z]\\s+(?=[${CJK_CLASS}])`), '');
    }

    const CN_NUM_MAP = { '零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
    function parseCnNumber(str) {
        if (!str) return null;
        if (/^\d+$/.test(str)) return parseInt(str, 10);
        if (str === '十') return 10;
        if (str.length === 1) return CN_NUM_MAP[str] != null ? CN_NUM_MAP[str] : null;
        if (str.length === 2) {
            if (str[0] === '十') return 10 + (CN_NUM_MAP[str[1]] || 0);
            if (str[1] === '十') return (CN_NUM_MAP[str[0]] || 0) * 10;
            return null;
        }
        if (str.length === 3 && str[1] === '十') {
            return (CN_NUM_MAP[str[0]] || 0) * 10 + (CN_NUM_MAP[str[2]] || 0);
        }
        return null;
    }

    function defaultSeason(parentPath) {
        if (parentPath) {
            const parentFolderName = parentPath.split(/[/\\]/).filter(Boolean).pop() || '';
            const parentSMatch = parentFolderName.match(/(?:^|[\s\.\-_\[\(【（])[Ss](\d{1,2})(?:[\s\.\-_\]\)】）]|$)/);
            if (parentSMatch) return parseInt(parentSMatch[1], 10);
            const parentCnSMatch = parentFolderName.match(/第\s*([零〇一二三四五六七八九十百千\d]+)\s*季/);
            if (parentCnSMatch) {
                const n = parseCnNumber(parentCnSMatch[1]);
                if (n !== null) return n;
            }
        }
        return 1;
    }

    function cleanTitleSeasonMarkers(title) {
        if (!title) return title;
        let t = String(title);
        t = t.replace(/[\.\s]*第\s*[零〇一二三四五六七八九十百千\d]+\s*[季集][\.\s]*/g, ' ');
        t = t.replace(/(?:^|[\.\s])[Ss]\d{1,2}(?:[\.\-_\s]*[Ee]\d{1,3}(?:[\.\-_\s]*E?\d{1,3})?)?(?=$|[\.\s])/g, ' ');
        t = t.replace(/\s+/g, ' ').replace(/^[\.\s]+|[\.\s]+$/g, '').trim();
        return t;
    }

    function cleanTitleTail(title) {
        if (!title) return title;
        let t = String(title).trim();
        let prev;
        do {
            prev = t;
            t = t.replace(/\s*[\(（\[\【]\s*(?:19|20)\d{2}\s*[\)）\]\】]\s*$/, '');
            t = t.replace(/\s+(?:19|20)\d{2}\s*$/, '');
            t = t.replace(/\s+(?:Remux|BluRay|Blu-Ray|BDRip|BDRemux|WEB[-\.]?DL|WEB[-\.]?Rip|WEBRip|HDTV|HDRip|REMUX|REPACK|PROPER|2160p|1080p|720p|480p|4K|UHD|HDR\d*\+?|HEVC|x26[45]|H\.?26[45]|10bits?|8bits?|SDR|DV|DoVi)(?:[-\s]*\d{3,4}p?)?\s*$/i, '');
            t = t.replace(/[-\.\s]+[A-Za-z0-9@!]{3,}\s*$/, '');
            t = t.trim();
        } while (t !== prev && t.length > 1);
        t = trimJunkTokens(t, ' ');
        return t.replace(/\s+/g, ' ').trim();
    }

    function stripLeadingReleaseGroup(s) {
        return s.replace(new RegExp(`^[A-Za-z][A-Za-z0-9_]{2,20}\\s*[-|–—]\\s*(?=[${CJK_CLASS}A-Za-z])`), '');
    }

    function isSceneStyle(s) {
        const normalized = String(s).replace(/[。．]/g, '.');
        const dotCount = (normalized.match(/\./g) || []).length;
        const hasBrackets = /[\[\【\(（]/.test(normalized);
        const hasDottedYear = /[\._](?:19|20)\d{2}(?:[\._]|$)/.test(normalized);
        const hasDottedSE = /[\._][Ss]\d{1,2}[Ee]\d{1,3}(?:[\._]|$)/.test(normalized);
        const hasDottedQuality = /[\._](?:BluRay|Blu-Ray|BDRip|BDRemux|WEB[-\.]?DL|WEB[-\.]?Rip|WEBRip|HDTV|HDRip|REMUX|2160p|1080p|720p|480p|HEVC|x26[45]|H\.?26[45])(?:[\._]|$)/i.test(normalized);
        return dotCount >= 3 && !hasBrackets && (hasDottedYear || hasDottedSE || hasDottedQuality);
    }

    function parseSceneStyle(rawName, parentPath = '') {
        let s = String(rawName).replace(/\.(torrent|mkv|mp4|avi|rmvb|ts|m2ts|webm|mov)$/i, '');
        s = s.replace(/_/g, '.').replace(/[。．]/g, '.');
        let season = null, episode = null, episodeEnd = null;
        const seMatch = s.match(/(?:^|[\.\s])[Ss](\d{1,2})[\.\s]*[Ee](\d{1,3})(?:[\.\s]*-?[\.\s]*E?(\d{1,3}))?(?=$|[\.\s])/);
        if (seMatch) {
            season = parseInt(seMatch[1], 10);
            episode = parseInt(seMatch[2], 10);
            if (seMatch[3]) episodeEnd = parseInt(seMatch[3], 10);
            s = s.replace(seMatch[0], '.');
        } else {
            const epMatch = s.match(/(?:^|[\.\s])[Ee][Pp]?(\d{1,3})(?:[\.\s]*-?[\.\s]*E?(\d{1,3}))?(?=$|[\.\s])/);
            if (epMatch) {
                episode = parseInt(epMatch[1], 10);
                if (epMatch[2]) episodeEnd = parseInt(epMatch[2], 10);
                s = s.replace(epMatch[0], '.');
            }
        }
        if (season === null) {
            const sOnly = s.match(/(?:^|[\.\s])[Ss](\d{1,2})(?=$|[\.\s])/);
            if (sOnly) {
                season = parseInt(sOnly[1], 10);
                s = s.replace(sOnly[0], '.');
            }
        }
        if (season === null && episode !== null) season = defaultSeason(parentPath);

        const yearMatch = s.match(/[\._]((?:19|20)\d{2})(?:[\._]|$)/);
        let titlePart, year = null;
        if (yearMatch) {
            titlePart = s.slice(0, yearMatch.index);
            year = parseInt(yearMatch[1], 10);
        } else {
            const parts = s.split('.');
            let cut = parts.length;
            for (let i = 1; i < parts.length; i++) {
                if (isJunkToken(parts[i])) { cut = i; break; }
            }
            titlePart = parts.slice(0, cut).join('.');
        }
        const segs = titlePart.split('.');
        let cut2 = segs.length;
        for (let i = 1; i < segs.length; i++) {
            if (isJunkToken(segs[i])) { cut2 = i; break; }
        }
        titlePart = segs.slice(0, cut2).join('.');
        const title = titlePart.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
        return { title, year, season, episode, episodeEnd, tvHint: season !== null || episode !== null };
    }

    // --- 智能命名 (TMDB) ---
    function getPageMovieTitle() {
        // 论坛帖子标题：尝试 Discuz 常见选择器
        const selectors = [
            '#thread_subject',
            'h1.ts', '.ts', '.thread-title',
            'h1#thread_subject', 'h1.thread-title',
            '.post-title h1', '.post h1',
            'article h1', 'main h1', 'h1'
        ];
        for (const sel of selectors) {
            try {
                const el = document.querySelector(sel);
                if (el) {
                    const t = el.textContent.trim();
                    if (t && t.length > 1 && t.length < 300) return t;
                }
            } catch(_) {}
        }
        // 回退到 <title>，去掉论坛站名后缀
        let t = document.title || '';
        t = t.replace(/\s*[-_|—–·]\s*(1lou|一楼).*$/i, '');
        t = t.replace(/\s*[-_|—–·]\s*[^-_|—–·]{0,30}论坛.*$/, '');
        t = t.replace(/\s*-\s*Powered by .*$/i, '');
        return t.trim();
    }

    // 从单个字符串中提取标题/年份/季集
    function extractNameFields(rawName, parentPath = '') {
        let s = String(rawName || '');
        s = s.replace(/^\s*\[(磁力|种子)\]\s*/, '');
        s = s.replace(/\.(torrent|mkv|mp4|avi|rmvb|ts|m2ts|webm|mov)$/i, '');
        s = s.replace(/^\s*【[^】]*?(?:\.com|\.cn|\.net|\.org|\.tv|论坛|发布|影视|资源|网|家|社)[^】]*】\s*/i, '');
        s = s.replace(new RegExp(`^\\s*【[^】]{2,40}】\\s*(?=[${CJK_CLASS}\\[\\【])`), '');

        let versionHint = null;
        const verMatch = s.match(/[\(（]\s*(真人版?|动画版?|剧场版|电影版|TV版|OVA|特别篇|完结篇|舞台版)\s*[\)）]/);
        if (verMatch) versionHint = verMatch[1];

        let englishHint = null;
        {
            let stripped = s.replace(/[\[\【][^\[\]\【\】]*[\]\】]/g, ' ')
                            .replace(/[\(（][^\(\)（）]*[\)）]/g, ' ');
            stripped = stripped
                .replace(/[Ss]\d{1,2}(?:[Ee]\d{1,3})?/g, ' ')
                .replace(/\b(?:19|20)\d{2}\b/g, ' ')
                .replace(/[\._\-]/g, ' ');
            const words = stripped.split(/\s+/).filter(Boolean);
            let best = [], current = [];
            for (const w of words) {
                const ok = /^[A-Za-z][A-Za-z'']{1,30}$/.test(w) && !isJunkToken(w) && w.length >= 2;
                if (ok) current.push(w);
                else {
                    if (current.length > best.length) best = current;
                    current = [];
                }
            }
            if (current.length > best.length) best = current;
            if (best.length >= 1) englishHint = best.join(' ');
        }

        s = s.replace(new RegExp(`[\\(（]([${CJK_CLASS}]{1,8})[\\)）]`, 'g'), ' ');

        if (isSceneStyle(s)) {
            const scene = parseSceneStyle(s, parentPath);
            if (scene.title && scene.title.length >= 1) {
                scene.versionHint = versionHint;
                scene.englishHint = englishHint;
                return scene;
            }
        }

        s = stripLeadingReleaseGroup(s);
        s = stripSingleLetterPrefix(s);

        let titleFromPrefix = null;
        const leadingMatch = s.match(/^([^\[\]\【\】]+?)(?=[\[\【]|$)/);
        if (leadingMatch) {
            let lead = leadingMatch[1].trim().replace(/[\s·•、,，]+$/g, '');
            lead = cleanTitleTail(lead);
            lead = cleanTitleSeasonMarkers(lead);
            const hasCJK = CJK_RE.test(lead);
            const noJunkWords = !/\b(2160p|1080p|720p|BluRay|WEB-?DL|WEBRip|HEVC|x26[45]|HDR|UHD|REMUX|H\.?26[45])\b/i.test(lead);
            if (lead && lead.length >= 1 && lead.length <= 60 && !isJunkTag(lead) &&
                (hasCJK || (noJunkWords && lead.length >= 3))) {
                titleFromPrefix = lead;
            }
        }

        let titleFromTag = null;
        if (!titleFromPrefix) {
            const tags = tokenizeBracketTags(s);
            for (const tag of tags) {
                if (!isJunkTag(tag) && tag.length >= 1 && tag.length <= 60) {
                    titleFromTag = tag;
                    break;
                }
            }
        }

        let season = null, episode = null, episodeEnd = null;
        const seMatch = s.match(/[Ss](\d{1,2})[\s\.\-_]*[Ee](\d{1,3})(?:[\s\.\-_]*E?(\d{1,3}))?/);
        if (seMatch) {
            season = parseInt(seMatch[1], 10);
            episode = parseInt(seMatch[2], 10);
            if (seMatch[3]) episodeEnd = parseInt(seMatch[3], 10);
            s = s.replace(seMatch[0], ' ');
        } else {
            const cnMatch = s.match(/第\s*(\d+)\s*季[\s\S]{0,4}?第?\s*(\d+)\s*集?/);
            if (cnMatch) {
                season = parseInt(cnMatch[1], 10);
                episode = parseInt(cnMatch[2], 10);
                s = s.replace(cnMatch[0], ' ');
            } else {
                const epOnly = s.match(/第\s*(\d+)\s*集/);
                if (epOnly) {
                    episode = parseInt(epOnly[1], 10);
                    s = s.replace(epOnly[0], ' ');
                } else {
                    const epMatch = s.match(/(?:^|[\s\.\-_\[\(【（])[Ee][Pp]?(\d{1,3})(?:[\s\.\-_]*[Ee]?(\d{1,3}))?(?:[\s\.\-_\]\)】）]|$)/);
                    if (epMatch) {
                        episode = parseInt(epMatch[1], 10);
                        if (epMatch[2]) episodeEnd = parseInt(epMatch[2], 10);
                        s = s.replace(epMatch[0], ' ');
                    }
                }
            }
        }
        if (season === null) {
            const sOnly = s.match(/(?:^|[\s\.\-_\[\(【（])[Ss](\d{1,2})(?:[\s\.\-_\]\)】）]|$)/);
            if (sOnly) {
                season = parseInt(sOnly[1], 10);
                s = s.replace(sOnly[0], ' ');
            }
        }
        if (season === null) {
            const cnSeasonOnly = s.match(/第\s*([零〇一二三四五六七八九十百千\d]+)\s*季/);
            if (cnSeasonOnly) {
                const n = parseCnNumber(cnSeasonOnly[1]);
                if (n !== null) {
                    season = n;
                    s = s.replace(cnSeasonOnly[0], ' ');
                }
            }
        }
        if (season === null && episode !== null) season = defaultSeason(parentPath);

        let tvHint = season !== null || episode !== null;
        if (!tvHint) {
            if (/[\[\【]\s*(?:全|共|更新至)\s*\d+\s*集\s*[\]\】]/.test(s) ||
                /[\[\【]\s*\d+\s*集\s*全?\s*[\]\】]/.test(s)) {
                tvHint = true;
            }
        }

        let year = null;
        const yearMatch = s.match(/(?:^|[^0-9])(19\d{2}|20\d{2})(?:[^0-9]|$)/);
        if (yearMatch) {
            year = parseInt(yearMatch[1], 10);
            s = s.replace(yearMatch[1], ' ');
        }

        let title;
        if (titleFromPrefix) title = titleFromPrefix;
        else if (titleFromTag) title = titleFromTag;
        else {
            let s2 = s.replace(/[\[\【][^\[\]\【\】]{0,40}[\]\】]/g, ' ');
            s2 = s2.replace(/[\(（][^\(\)（）]{0,40}[\)）]/g, ' ');
            const junkPatterns = [
                /\b(2160p|1080p|720p|480p|4K|UHD|HDR10?\+?|HDR|DV|DoVi|HQ|SDR)\b/gi,
                /\b(WEB[-\.]?DL|WEB[-\.]?Rip|WEBRip|WEB-MKV|BluRay|Blu-Ray|BDRip|BDRemux|HDTV|HDRip|REMUX|REPACK|PROPER)\b/gi,
                /\b(H\.?264|H\.?265|HEVC|AVC|x264|x265|10bits?|8bits?)\b/gi,
                /\b(AAC|FLAC|DTS(?:-HD)?|AC3|DDP?5\.1|DDP?\.?2\.0|TrueHD|Atmos|EAC3|MA)\b/gi,
                /(国语|粤语|国粤双语|国英双语|中英双语|国日双语|双语字幕?|中字|英字|内嵌字?幕?|内封字?幕?|官方简体|繁中|简中|简繁(?:英)?字幕?|简繁|官中|繁体|中文字幕)/g,
                /(完结|未删减|加长版|导演剪辑版|纪念版|3D|2D|IMAX|国配|高码版?|杜比视界(?:版本)?|HDR版本|流媒体|60帧率?)/g,
                /\bWEB-MKV\/[\d\.]+GB\b/gi
            ];
            junkPatterns.forEach(p => { s2 = s2.replace(p, ' '); });
            s2 = s2.replace(/[\._]+/g, ' ').replace(/\s+/g, ' ').trim();
            s2 = s2.replace(/[-]\s*[A-Za-z0-9@!]+$/g, '').trim();
            s2 = s2.replace(/^[\s\-\|·•、]+|[\s\-\|·•、]+$/g, '').trim();
            title = s2;
        }

        title = cleanTitleSeasonMarkers(title);
        return { title, year, season, episode, episodeEnd, tvHint, versionHint, englishHint };
    }

    function parseName(rawName, contextTitle, parentPath = '') {
        const fromRaw = extractNameFields(rawName, parentPath);

        // 链接文本里的标题是否可用：要有内容且包含中文或长度 ≥ 4
        const rawTitleUsable = fromRaw.title && fromRaw.title.length >= 2 &&
            (/[一-龥]/.test(fromRaw.title) || fromRaw.title.length >= 4);

        let merged = { ...fromRaw };
        if (!rawTitleUsable && contextTitle) {
            const fromCtx = extractNameFields(contextTitle, parentPath);
            if (fromCtx.title && fromCtx.title.length >= 2) {
                merged.title = fromCtx.title;
                merged.year = fromRaw.year ?? fromCtx.year;
                merged.season = fromRaw.season ?? fromCtx.season;
                merged.episode = fromRaw.episode ?? fromCtx.episode;
                merged.episodeEnd = fromRaw.episodeEnd ?? fromCtx.episodeEnd;
                merged.tvHint = fromRaw.tvHint || fromCtx.tvHint;
                merged.versionHint = fromRaw.versionHint || fromCtx.versionHint;
                merged.englishHint = fromRaw.englishHint || fromCtx.englishHint;
            }
        }

        return {
            rawName: rawName,
            contextTitle: contextTitle || '',
            title: merged.title,
            year: merged.year,
            season: merged.season,
            episode: merged.episode,
            episodeEnd: merged.episodeEnd,
            isTV: merged.season !== null || merged.episode !== null || !!merged.tvHint,
            versionHint: merged.versionHint || null,
            englishHint: merged.englishHint || null
        };
    }

    async function tmdbQueryType(parsed, type, overrideLang) {
        const lang = overrideLang || (config.tmdbLang || 'zh-CN');
        const yearKey = type === 'tv' ? 'first_air_date_year' : 'year';
        const params = new URLSearchParams({
            api_key: config.tmdbApiKey,
            language: lang,
            query: parsed.title,
            include_adult: 'true'
        });
        if (parsed.year) params.set(yearKey, String(parsed.year));

        // 主 host 与备用 host：主 host 失败时自动尝试备用
        const primaryHost = (config.tmdbHost || 'https://api.themoviedb.org').replace(/\/$/, '');
        const hosts = [primaryHost];
        if (!primaryHost.includes('api.tmdb.org') && primaryHost !== 'https://api.tmdb.org') {
            hosts.push('https://api.tmdb.org'); // 备用官方域名
        }

        const tryHost = (host) => new Promise((resolve, reject) => {
            const url = `${host}/3/search/${type}?${params.toString()}`;
            log(`TMDB 查询 ${type} @ ${host}: ${parsed.title}${parsed.year ? ' (' + parsed.year + ')' : ''}`);
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers: { 'Accept': 'application/json' },
                timeout: 30000,
                onload: (res) => {
                    try {
                        const j = JSON.parse(res.responseText);
                        if (j.status_code && j.status_code !== 1) {
                            reject(new Error(j.status_message || `TMDB ${j.status_code}`));
                        } else {
                            resolve(j);
                        }
                    } catch(e) {
                        reject(new Error('TMDB 响应解析失败'));
                    }
                },
                onerror: () => reject(new Error('请求失败')),
                ontimeout: () => reject(new Error('请求超时'))
            });
        });

        let data = null, lastErr = null;
        for (const host of hosts) {
            try {
                data = await tryHost(host);
                break;
            } catch (e) {
                lastErr = e;
                log(`⚠️ TMDB ${host} ${e.message}，尝试下一个`);
            }
        }
        if (!data) throw new Error(`TMDB 不可达: ${lastErr ? lastErr.message : '未知错误'}。可在设置里把 TMDB Host 改为自建反代`);
        return data.results || [];
    }

    function scoreCandidate(result, parsed, type) {
        if (!result) return -Infinity;
        let score = 0;
        const q = String(parsed.title || '').toLowerCase().trim();
        if (!q) return -Infinity;
        const title = String(result.title || result.name || '').toLowerCase().trim();
        const orig = String(result.original_title || result.original_name || '').toLowerCase().trim();
        if (title === q || orig === q) score += 200;
        else if (title.startsWith(q) || q.startsWith(title) || orig.startsWith(q) || q.startsWith(orig)) score += 50;
        score += Math.min(80, result.popularity || 0);
        score += Math.min(30, Math.log(1 + (result.vote_count || 0)) * 6);

        if (parsed.year) {
            const date = result.release_date || result.first_air_date || '';
            const y = date ? parseInt(date.slice(0, 4), 10) : null;
            if (y === parsed.year) score += 40;
            else if (y && Math.abs(y - parsed.year) <= 1) score += 15;
            else if (y && Math.abs(y - parsed.year) > 5) score -= 20;
        }

        if (parsed.isTV && type === 'tv') score += 30;
        if (!parsed.isTV && type === 'movie') score += 3;

        if (parsed.versionHint) {
            const hint = String(parsed.versionHint);
            const genres = result.genre_ids || [];
            const overview = (result.overview || '').toLowerCase();
            const allText = `${title} ${orig} ${overview}`;
            if (/真人/.test(hint)) {
                if (genres.includes(16)) score -= 120;
                if (/真人|live[\s-]*action/i.test(allText)) score += 80;
            } else if (/动画/.test(hint)) {
                if (genres.includes(16)) score += 60;
                else score -= 40;
            } else if (/剧场版|电影版/.test(hint)) {
                if (type === 'movie') score += 30;
            }
        }

        if (parsed.englishHint) {
            const en = parsed.englishHint.toLowerCase();
            if (en.length >= 3 && (orig.includes(en) || title.includes(en))) score += 40;
        }
        return score;
    }

    function inferTypeHintFromPath(path) {
        const p = String(path || '').replace(/\/+$/, '');
        const moviePath = String(config.pathMovie || '').replace(/\/+$/, '');
        const seriesPath = String(config.pathSeries || '').replace(/\/+$/, '');
        const animePath = String(config.pathAnime || '').replace(/\/+$/, '');
        if (moviePath && p === moviePath) return 'movie';
        if ((seriesPath && p === seriesPath) || (animePath && p === animePath)) return 'tv';
        if (/(^|[\/\\])(电影|movie|movies)([\/\\]|$)/i.test(p)) return 'movie';
        if (/(^|[\/\\])(剧集|电视剧|番剧|动漫|anime|series|tv)([\/\\]|$)/i.test(p)) return 'tv';
        return null;
    }

    async function tmdbSearch(parsed, preferredType = null) {
        if (!config.tmdbApiKey) throw new Error('未配置 TMDB API Key');
        if (!parsed.title) throw new Error('解析不到有效标题');

        const hasStrongSignal = parsed.season !== null || parsed.episode !== null;
        const types = hasStrongSignal ? [parsed.isTV ? 'tv' : 'movie'] : (preferredType ? [preferredType] : ['movie', 'tv']);
        const searchLang = CJK_RE.test(parsed.title) ? (config.tmdbLang || 'zh-CN') : 'en-US';
        const queries = [parsed.title];
        if (parsed.versionHint) queries.push(`${parsed.title} ${parsed.versionHint}`);
        if (parsed.englishHint && parsed.englishHint.toLowerCase() !== parsed.title.toLowerCase()) {
            queries.push(parsed.englishHint);
        }

        const candidates = [];
        const seen = new Set();
        let lastErr = null;
        for (const q of queries) {
            for (const t of types) {
                try {
                    const res = await tmdbQueryType({ ...parsed, title: q }, t, searchLang);
                    for (const r of res.slice(0, 5)) {
                        const key = `${t}:${r.id}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        candidates.push({ type: t, result: r, score: scoreCandidate(r, parsed, t) });
                    }
                } catch(e) { lastErr = e; }
            }
        }

        if (!candidates.length) {
            const latinOnly = parsed.title.replace(new RegExp(`[${CJK_CLASS}]+\\d*`, 'g'), ' ').replace(/\s+/g, ' ').trim();
            if (latinOnly && latinOnly !== parsed.title && latinOnly.length >= 2 && /[A-Za-z]/.test(latinOnly)) {
                log(`TMDB 无结果，改用英文标题重搜: "${latinOnly}"`);
                return tmdbSearch({ ...parsed, title: latinOnly });
            }
            if (parsed.year) {
                log('TMDB 无结果，尝试不带年份重搜');
                return tmdbSearch({ ...parsed, year: null });
            }
            throw lastErr || new Error('TMDB 无匹配结果');
        }

        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        const top = best.result;
        const officialTitle = top.title || top.name || parsed.title;
        const origTitle = top.original_title || top.original_name || '';
        const date = top.release_date || top.first_air_date || '';
        const matchedYear = date ? parseInt(date.slice(0, 4), 10) : parsed.year;
        const cn = best.type === 'tv' ? '剧集' : '电影';
        log(`  ⇒ 命中${cn} "${officialTitle}" (score ${best.score.toFixed(0)})`);

        return {
            type: best.type,
            tmdbId: top.id,
            title: officialTitle,
            originalTitle: origTitle,
            year: matchedYear,
            score: best.score,
            season: parsed.season,
            episode: parsed.episode,
            episodeEnd: parsed.episodeEnd
        };
    }

    function buildTargetName(meta, originalName) {
        const { ext } = mediaInfoFromName(originalName);
        const safe = (s) => String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
        const title = safe(meta.title);
        const year = meta.year ? ` (${meta.year})` : '';
        if (meta.type === 'tv' && meta.season !== null && meta.episode !== null) {
            const s = String(meta.season).padStart(2, '0');
            const e = String(meta.episode).padStart(2, '0');
            const eEnd = meta.episodeEnd ? `-E${String(meta.episodeEnd).padStart(2, '0')}` : '';
            return `${title}${year} - S${s}E${e}${eEnd}${ext}`;
        }
        return `${title}${year}${ext}`;
    }

    // 视频/字幕扩展名集合
    const VIDEO_EXTS = ['mkv','mp4','avi','ts','m2ts','mov','webm','rmvb','rm','flv','wmv','mpg','mpeg','iso','3gp'];
    const SUB_EXTS = ['srt','ass','ssa','vtt','sub','idx','sup','smi','pgs'];

    function mediaInfoFromName(name) {
        const m = String(name).match(/\.([A-Za-z0-9]{1,5})$/);
        const ext = m ? m[0] : '';
        const extLower = m ? m[1].toLowerCase() : '';
        const isVideo = VIDEO_EXTS.includes(extLower);
        const isSub = SUB_EXTS.includes(extLower);
        return { ext, extLower, isVideo, isSub };
    }

    function guessSeasonFromInside(insideFiles) {
        const counts = {};
        let hasEpisodeLike = false;
        for (const f of insideFiles) {
            const m = f.name.match(/[Ss](\d{1,2})[\s\.\-_]*[Ee]\d{1,3}/);
            if (m) {
                const s = parseInt(m[1], 10);
                counts[s] = (counts[s] || 0) + 1;
            } else if (/(?:^|[\s\.\-_\[\(【（])[Ee][Pp]?\d{1,3}(?:[\s\.\-_\]\)】）]|$)/.test(f.name) ||
                       /第\s*\d+\s*集/.test(f.name)) {
                hasEpisodeLike = true;
            }
        }
        let best = null, bestCount = 0;
        for (const k in counts) {
            if (counts[k] > bestCount) { best = parseInt(k, 10); bestCount = counts[k]; }
        }
        if (best === null && hasEpisodeLike) return 1;
        return best;
    }

    async function refineMetaByInsideFiles(meta, insideFiles, baseName) {
        const guessed = guessSeasonFromInside(insideFiles);
        if (guessed == null) return meta;
        if (meta.type === 'tv') {
            if (meta.season == null) meta.season = guessed;
            return meta;
        }
        log(`📺 文件夹内检测到剧集文件，按第 ${guessed} 季重新匹配 TMDB`);
        const parsed = parseName(baseName || meta.title);
        parsed.isTV = true;
        parsed.season = guessed;
        parsed.episode = parsed.episode ?? null;
        try {
            return await tmdbSearch(parsed);
        } catch (e) {
            log(`⚠️ 剧集重匹配失败，保留原 TMDB 结果: ${e.message}`);
            return meta;
        }
    }

    async function refineMetaByFileName(meta, fileName) {
        const parsed = parseName(fileName);
        if (parsed.season === null && parsed.episode === null && !parsed.isTV) return meta;
        try {
            return await tmdbSearch(parsed);
        } catch (e) {
            log(`⚠️ 单文件剧集重匹配失败，保留原 TMDB 结果: ${e.message}`);
            return {
                ...meta,
                type: 'tv',
                season: parsed.season ?? meta.season ?? 1,
                episode: parsed.episode ?? meta.episode,
                episodeEnd: parsed.episodeEnd ?? meta.episodeEnd
            };
        }
    }

    // 给文件夹内的单个文件生成新名（不重命名 nfo/jpg/txt 等元数据文件，避免破坏刮削）
    function buildInnerName(meta, innerName) {
        const { ext, isVideo, isSub } = mediaInfoFromName(innerName);
        if (!isVideo && !isSub) return null;

        const safe = (s) => String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
        const title = safe(meta.title);
        const year = meta.year ? ` (${meta.year})` : '';

        // 字幕：保留原有的语言后缀，如 .chs.srt / .eng.ass / .zh-Hans.srt
        let langSuffix = '';
        if (isSub) {
            const stem = innerName.slice(0, -ext.length);
            const langMatch = stem.match(/\.([A-Za-z]{2,5}|[A-Za-z]{2,3}-[A-Za-z]{2,8}|chs|cht|sc|tc|chi|eng|jpn|jap|kor)$/i);
            if (langMatch) langSuffix = `.${langMatch[1]}`;
        }

        // 电视剧：优先从这个文件名里提取本集的 S/E，文件名里没有才退回 meta
        if (meta.type === 'tv') {
            let s = null, e = null;
            const seMatch = innerName.match(/[Ss](\d{1,2})[\s\.\-_]*[Ee](\d{1,3})/);
            if (seMatch) {
                s = String(parseInt(seMatch[1], 10)).padStart(2, '0');
                e = String(parseInt(seMatch[2], 10)).padStart(2, '0');
            } else {
                const cn = innerName.match(/第\s*(\d+)\s*季[\s\S]{0,4}?第?\s*(\d+)\s*集?/);
                if (cn) {
                    s = String(parseInt(cn[1], 10)).padStart(2, '0');
                    e = String(parseInt(cn[2], 10)).padStart(2, '0');
                } else {
                    const epOnly = innerName.match(/(?:第\s*(\d+)\s*集|[Ee][Pp]?(\d{1,3}))/);
                    if (epOnly) {
                        e = String(parseInt(epOnly[1] || epOnly[2], 10)).padStart(2, '0');
                        if (meta.season !== null) s = String(meta.season).padStart(2, '0');
                    } else if (meta.season !== null && meta.episode !== null) {
                        s = String(meta.season).padStart(2, '0');
                        e = String(meta.episode).padStart(2, '0');
                    }
                }
            }
            if (s && e) {
                return `${title}${year} - S${s}E${e}${langSuffix}${ext}`;
            }
            // 实在拿不到 S/E 就用基础命名
            return `${title}${year}${langSuffix}${ext}`;
        }
        // 电影
        return `${title}${year}${langSuffix}${ext}`;
    }

    // 给文件夹生成新名（不带扩展名）
    function buildFolderName(meta) {
        const safe = (s) => String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
        const title = safe(meta.title);
        const year = meta.year ? ` (${meta.year})` : '';
        if (meta.type === 'tv' && meta.season !== null) {
            const s = String(meta.season).padStart(2, '0');
            return `${title}${year} - S${s}`;
        }
        return `${title}${year}`;
    }

    async function handleSendLink(item, targetPath) {
        activeTaskCount++;
        const path = targetPath || config.downloadPath;
        try {
            let magnet = item.url;
            if (item.type === 'torrent') {
                magnet = await getMagnetFromTorrent(item.url, item.name);
            }

            // 智能命名：发送前先解析+查 TMDB+取目录快照
            let renamePlan = null;
            if (config.renameEnabled && config.tmdbApiKey) {
                try {
                    const parsed = parseName(item.name);
                    const typeHint = inferTypeHintFromPath(path);
                    log(`本地解析: 标题="${parsed.title}" 年份=${parsed.year || '?'} 季=${parsed.season ?? '-'} 集=${parsed.episode ?? '-'}`);
                    const meta = await tmdbSearch(parsed, typeHint);
                    log(`TMDB 命中: ${meta.title}${meta.year ? ' (' + meta.year + ')' : ''} [tmdb:${meta.tmdbId}]`);
                    const before = await listDir(path).catch(() => []);
                    renamePlan = { meta, typeHint, before: new Set(before.map(f => f.name)) };
                } catch (re) {
                    log(`⚠️ 智能命名预处理失败，将按原文件名下载: ${re.message}`);
                }
            }

            log(`发送中: ${item.name}`);
            const sendData = await sendToAlist(magnet, path);
            log(`✅ 发送成功: ${item.name}`);

            // 提取任务 id，用于轮询
            const taskIds = (sendData && sendData.tasks) ? sendData.tasks.map(t => String(t.id)) : [];
            if (renamePlan && taskIds.length) renamePlan.taskIds = taskIds;

            log('等待 2 秒以便 AList 开始处理任务...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 智能命名：等任务完成→对比目录→重命名
            if (renamePlan) {
                try {
                    if (renamePlan.taskIds) {
                        await waitForTasks(renamePlan.taskIds, config.renamePollTimeout || 1800);
                    } else {
                        log('未拿到任务 ID，回退到固定等待 30s');
                        await new Promise(r => setTimeout(r, 30000));
                    }
                    const after = await listDir(path);
                    const newEntries = after.filter(f => !renamePlan.before.has(f.name));
                    if (!newEntries.length) {
                        log('⚠️ 未发现新文件，跳过重命名');
                    } else {
                        for (const entry of newEntries) {
                            const oldFullPath = `${path.replace(/\/$/, '')}/${entry.name}`;
                            if (entry.is_dir) {
                                // 1) 先读取内部文件，用多集文件名修正 movie/tv 判断
                                let curFolder = entry.name;
                                let folderPath = oldFullPath;
                                let inside = [];
                                try {
                                    inside = await listDir(folderPath);
                                } catch (e) {
                                    log(`⚠️ 无法列出文件夹内容: ${e.message}`);
                                }
                                const effectiveMeta = await refineMetaByInsideFiles(renamePlan.meta, inside, entry.name);

                                // 2) 重命名文件夹
                                const newFolder = buildFolderName(effectiveMeta);
                                if (newFolder && newFolder !== entry.name) {
                                    try {
                                        await alistRename(oldFullPath, newFolder);
                                        curFolder = newFolder;
                                        folderPath = `${path.replace(/\/$/, '')}/${curFolder}`;
                                        log(`✅ 重命名文件夹: ${entry.name} → ${newFolder}`);
                                    } catch (e) {
                                        log(`❌ 重命名文件夹失败: ${e.message}`);
                                    }
                                }

                                // 3) 进入文件夹处理内部视频/字幕
                                const videos = inside.filter(f => !f.is_dir && mediaInfoFromName(f.name).isVideo);
                                const mainVideo = videos.length ? videos.reduce((a, b) => (a.size > b.size ? a : b)) : null;

                                for (const inner of inside) {
                                    if (inner.is_dir) continue;
                                    let targetName = buildInnerName(effectiveMeta, inner.name);
                                    if (!targetName) continue;
                                    // 电影 + 多个视频：只把"主视频"改成 Title (Year).ext，其它保留原名避免冲突
                                    if (effectiveMeta.type === 'movie' && videos.length > 1 && mainVideo && inner.name !== mainVideo.name &&
                                        mediaInfoFromName(inner.name).isVideo) {
                                        log(`跳过次要视频 (避免文件名冲突): ${inner.name}`);
                                        continue;
                                    }
                                    if (targetName === inner.name) continue;
                                    const innerFullPath = `${folderPath}/${inner.name}`;
                                    try {
                                        await alistRename(innerFullPath, targetName);
                                        log(`✅ 重命名: ${inner.name} → ${targetName}`);
                                    } catch (renErr) {
                                        log(`❌ 重命名失败 (${inner.name}): ${renErr.message}`);
                                    }
                                }
                            } else {
                                // 顶层就是一个文件
                                const effectiveMeta = await refineMetaByFileName(renamePlan.meta, entry.name);
                                const targetName = buildTargetName(effectiveMeta, entry.name);
                                if (targetName === entry.name) {
                                    log(`目标名与原名一致，跳过: ${entry.name}`);
                                    continue;
                                }
                                try {
                                    await alistRename(oldFullPath, targetName);
                                    log(`✅ 重命名: ${entry.name} → ${targetName}`);
                                } catch (renErr) {
                                    log(`❌ 重命名失败 (${entry.name}): ${renErr.message}`);
                                }
                            }
                        }
                    }
                } catch (e) {
                    log(`❌ 智能命名流程异常: ${e.message}`);
                }
            }

            // 先尝试触发 AList 刷新
            try {
                await refreshDirectory(config.alistUrl, config.alistToken, path, 'AList');
            } catch(ae) {
                log(`❌ AList 刷新失败: ${ae.message}`);
            }

            // 再尝试触发 Openlist 刷新与同步
            if (config.openlistEnabled) {
                // 目录刷新与索引更新独立处理，刷新失败不影响索引更新
                try {
                    await refreshDirectory(config.openlistUrl, config.openlistToken, path, 'Openlist');
                } catch(re) {
                    log(`⚠️ Openlist 目录刷新失败(不影响索引): ${re.message}`);
                }

                log('等待 3 秒以确保网盘离线/底层目录状态同步...');
                await new Promise(r => setTimeout(r, 3000));

                try {
                    await triggerOpenlistScan(path);
                } catch(oe) {
                    log(`❌ Openlist 索引更新失败: ${oe.message}`);
                }
            }
            return true;
        } catch(e) {
            log(`❌ 失败: ${item.name} - ${e.message}`);
            throw e;
        } finally {
            activeTaskCount--;
        }
    }

    // --- 监控网页链接 ---
    function scanPageForLinks() {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const newLinks = [];

        anchors.forEach(a => {
            if (a.dataset.alistBound) return;

            const href = a.href;
            const text = a.textContent.trim() || '未命名文件';
            let isTorrent = false;
            let isMagnet = false;
            let name = text;

            if (href.startsWith('magnet:?')) {
                isMagnet = true;
                name = `[磁力] ${text}`;
            } else if (
                href.toLowerCase().endsWith('.torrent') ||
                href.includes('download.php?id=') ||
                href.includes('attach-download-') ||
                text.toLowerCase().includes('.torrent')
            ) {
                isTorrent = true;
                name = `[种子] ${text}`;
            }

            if (isMagnet || isTorrent) {
                a.dataset.alistBound = 'true';
                const item = { url: href, name: name, type: isMagnet ? 'magnet' : 'torrent' };
                if (!foundLinks.some(l => l.url === href)) {
                    newLinks.push(item);
                }

                const btnGroup = document.createElement('span');
                btnGroup.style.cssText = 'margin-left: 8px; display: inline-flex; gap: 4px; vertical-align: middle;';

                const cats = [
                    { id: 'movie', label: '🎬', path: config.pathMovie || config.downloadPath, color: '#f59e0b' },
                    { id: 'series', label: '📺', path: config.pathSeries || config.downloadPath, color: '#3b82f6' },
                    { id: 'anime', label: '🎌', path: config.pathAnime || config.downloadPath, color: '#ec4899' }
                ];

                cats.forEach(cat => {
                    const btn = document.createElement('button');
                    btn.innerHTML = cat.label;
                    btn.title = `发送到 ${cat.path}`;
                    btn.style.cssText = `font-size: 12px; padding: 2px 6px; background: ${cat.color}; color: white; border: none; border-radius: 4px; cursor: pointer; line-height: 1.5;`;

                    btn.onclick = (e) => {
                        e.preventDefault(); e.stopPropagation();
                        Array.from(btnGroup.children).forEach(b => b.disabled = true);
                        btn.innerHTML = '⏳';

                        handleSendLink(item, cat.path).then(() => {
                            // 已发送状态持久保留，便于确认
                            btn.innerHTML = '✅已发';
                            btn.title = `已发送到 ${cat.path}`;
                            btn.dataset.sent = '1';
                            // 允许同一链接发往其他分类，但当前按钮保持已发送
                            Array.from(btnGroup.children).forEach(b => {
                                if (b !== btn && b.dataset.sent !== '1') b.disabled = false;
                            });
                        }).catch(() => {
                            btn.innerHTML = '❌';
                            setTimeout(() => {
                                Array.from(btnGroup.children).forEach(b => {
                                    if (b.dataset.sent !== '1') b.disabled = false;
                                });
                                btn.innerHTML = cat.label;
                            }, 3000);
                        });
                    };
                    btnGroup.appendChild(btn);
                });

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    btnGroup.children[0].click(); // 默认点击第一个(电影)
                });

                if (a.nextSibling) {
                    a.parentNode.insertBefore(btnGroup, a.nextSibling);
                } else {
                    a.parentNode.appendChild(btnGroup);
                }
            }
        });

        if (newLinks.length > 0) {
            foundLinks = foundLinks.concat(newLinks);
            updateLinkListUI();
        }

        updateFloatingBatchUI();
    }

    // --- 右侧悬浮批量发送按钮 ---
    function ensureFloatingBatch() {
        let group = document.getElementById('alist-floating-batch');
        if (group) return group;

        group = document.createElement('div');
        group.id = 'alist-floating-batch';

        const cats = [
            { id: 'movie', label: '🎬 全发电影', getPath: () => config.pathMovie || config.downloadPath, color: '#f59e0b' },
            { id: 'series', label: '📺 全发剧集', getPath: () => config.pathSeries || config.downloadPath, color: '#3b82f6' },
            { id: 'anime', label: '🎌 全发动漫', getPath: () => config.pathAnime || config.downloadPath, color: '#ec4899' }
        ];

        cats.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'alist-float-btn';
            btn.dataset.cat = cat.id;
            btn.dataset.label = cat.label;
            btn.style.background = cat.color;
            btn.innerHTML = `${cat.label} (0)`;

            btn.onclick = async (e) => {
                e.preventDefault(); e.stopPropagation();
                if (btn.disabled || foundLinks.length === 0) return;

                Array.from(group.children).forEach(b => b.disabled = true);
                btn.innerHTML = '⏳ 批量发送中...';

                let successCount = 0;
                for (const item of foundLinks) {
                    try {
                        await handleSendLink(item, cat.getPath());
                        successCount++;
                        await new Promise(r => setTimeout(r, 1000));
                    } catch (err) {
                        console.error('[AList Helper] 批量发送失败:', item.name, err);
                    }
                }

                // 保持已发送状态可见，便于确认；只解锁其他按钮
                btn.innerHTML = `✅ 已发送 (${successCount}/${foundLinks.length})`;
                btn.dataset.sent = '1';
                Array.from(group.children).forEach(b => {
                    if (b !== btn) b.disabled = false;
                });
            };
            group.appendChild(btn);
        });

        document.body.appendChild(group);
        return group;
    }

    function updateFloatingBatchUI() {
        const group = ensureFloatingBatch();
        const count = foundLinks.length;
        if (count > 0) {
            group.classList.add('show');
            Array.from(group.children).forEach(btn => {
                if (btn.disabled || btn.dataset.sent === '1') return;
                btn.innerHTML = `${btn.dataset.label} (${count})`;
            });
        } else {
            group.classList.remove('show');
        }
    }


    // --- UI 事件 ---
    function updateLinkListUI() {
        document.getElementById('alist-link-count').textContent = foundLinks.length;
        const ul = document.getElementById('alist-link-list-ul');
        ul.innerHTML = '';

        foundLinks.forEach((item, index) => {
            item.sentCats = item.sentCats || {};
            const mark = (c) => item.sentCats[c] ? '✅ 已发' : ({movie:'电影', series:'剧集', anime:'动漫'})[c];
            const li = document.createElement('li');
            li.className = 'alist-link-item';
            li.innerHTML = `
                <span class="alist-link-name" title="${item.name}">${item.name}</span>
                <span style="display:flex; gap:4px;">
                    <button class="alist-link-btn" data-index="${index}" data-cat="movie" style="background:#f59e0b;" ${item.sentCats.movie?'disabled':''}>${mark('movie')}</button>
                    <button class="alist-link-btn" data-index="${index}" data-cat="series" style="background:#3b82f6;" ${item.sentCats.series?'disabled':''}>${mark('series')}</button>
                    <button class="alist-link-btn" data-index="${index}" data-cat="anime" style="background:#ec4899;" ${item.sentCats.anime?'disabled':''}>${mark('anime')}</button>
                </span>
            `;
            ul.appendChild(li);
        });

        // 绑定单条分类发送事件
        ul.querySelectorAll('.alist-link-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.target.getAttribute('data-index');
                const cat = e.target.getAttribute('data-cat');
                const item = foundLinks[idx];

                let targetPath = config.downloadPath;
                if (cat === 'movie') targetPath = config.pathMovie;
                else if (cat === 'series') targetPath = config.pathSeries;
                else if (cat === 'anime') targetPath = config.pathAnime;

                const parent = e.target.parentNode;
                const originalText = e.target.textContent;
                Array.from(parent.children).forEach(b => b.disabled = true);
                e.target.textContent = '⏳';

                handleSendLink(item, targetPath).then(() => {
                    item.sentCats = item.sentCats || {};
                    item.sentCats[cat] = true;
                    e.target.textContent = '✅ 已发';
                    // 解锁同行其他分类按钮，但当前按钮保持已发送禁用态
                    Array.from(parent.children).forEach(b => {
                        if (b !== e.target) b.disabled = false;
                    });
                }).catch(() => {
                    e.target.textContent = '❌ 失败';
                    setTimeout(() => {
                        e.target.textContent = originalText;
                        Array.from(parent.children).forEach(b => {
                            const c = b.getAttribute('data-cat');
                            if (!item.sentCats || !item.sentCats[c]) b.disabled = false;
                        });
                    }, 3000);
                });
            });
        });
    }

    function initUI() {
        const panel = document.getElementById('alist-panel');
        const trigger = document.getElementById('alist-btn-trigger');
        const closeBtn = document.getElementById('alist-close-btn');

        trigger.addEventListener('click', () => {
            panel.classList.toggle('show');
            if (panel.classList.contains('show')) scanPageForLinks();
        });

        closeBtn.addEventListener('click', () => panel.classList.remove('show'));

        // Tabs
        document.querySelectorAll('.alist-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.alist-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.alist-tab-content').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                document.getElementById(`alist-tab-${e.target.getAttribute('data-target')}`).classList.add('active');
            });
        });

        // Config Init
        document.getElementById('cfg-alist-url').value = config.alistUrl;
        document.getElementById('cfg-alist-token').value = config.alistToken;
        document.getElementById('cfg-alist-path').value = config.downloadPath;
        if(document.getElementById('cfg-alist-path-movie')) {
            document.getElementById('cfg-alist-path-movie').value = config.pathMovie;
            document.getElementById('cfg-alist-path-series').value = config.pathSeries;
            document.getElementById('cfg-alist-path-anime').value = config.pathAnime;
        }
        document.getElementById('cfg-dl-tool').value = config.dlTool;
        document.getElementById('cfg-rename-enabled').checked = config.renameEnabled;
        document.getElementById('cfg-tmdb-key').value = config.tmdbApiKey;
        document.getElementById('cfg-tmdb-host').value = config.tmdbHost || 'https://api.themoviedb.org';
        document.getElementById('cfg-tmdb-lang').value = config.tmdbLang || 'zh-CN';
        document.getElementById('cfg-rename-timeout').value = config.renamePollTimeout;
        document.getElementById('cfg-ol-enabled').checked = config.openlistEnabled;
        document.getElementById('cfg-ol-url').value = config.openlistUrl;
        document.getElementById('cfg-ol-token').value = config.openlistToken;
        document.getElementById('cfg-ol-path').value = config.openlistPath;
        document.getElementById('cfg-ol-rate').value = config.openlistRate;

        // Save Config
        document.getElementById('alist-save-config').addEventListener('click', () => {
            config.alistUrl = document.getElementById('cfg-alist-url').value;
            config.alistToken = document.getElementById('cfg-alist-token').value;
            config.downloadPath = document.getElementById('cfg-alist-path').value;
            if(document.getElementById('cfg-alist-path-movie')) {
                config.pathMovie = document.getElementById('cfg-alist-path-movie').value;
                config.pathSeries = document.getElementById('cfg-alist-path-series').value;
                config.pathAnime = document.getElementById('cfg-alist-path-anime').value;
            }
            config.dlTool = document.getElementById('cfg-dl-tool').value;
            config.renameEnabled = document.getElementById('cfg-rename-enabled').checked;
            config.tmdbApiKey = document.getElementById('cfg-tmdb-key').value.trim();
            config.tmdbHost = (document.getElementById('cfg-tmdb-host').value || 'https://api.themoviedb.org').trim().replace(/\/$/, '');
            config.tmdbLang = document.getElementById('cfg-tmdb-lang').value;
            config.renamePollTimeout = parseInt(document.getElementById('cfg-rename-timeout').value, 10) || 1800;
            config.openlistEnabled = document.getElementById('cfg-ol-enabled').checked;
            config.openlistUrl = document.getElementById('cfg-ol-url').value;
            config.openlistToken = document.getElementById('cfg-ol-token').value;
            config.openlistPath = document.getElementById('cfg-ol-path').value;
            config.openlistRate = parseFloat(document.getElementById('cfg-ol-rate').value) || 0;

            GM_setValue('alist_bt_config', config);
            alert('设置已保存！');
        });

        // 面板内的一键发送全部分类按钮
        const bindBatchBtn = (id, targetPath) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', async (e) => {
                btn.disabled = true;
                btn.textContent = '发送中...';

                for (const item of foundLinks) {
                    await handleSendLink(item, targetPath);
                    await new Promise(r => setTimeout(r, 1000));
                }

                btn.textContent = '✅ 已发送';
            });
        };

        bindBatchBtn('alist-send-all-movie', config.pathMovie || config.downloadPath);
        bindBatchBtn('alist-send-all-series', config.pathSeries || config.downloadPath);
        bindBatchBtn('alist-send-all-anime', config.pathAnime || config.downloadPath);

        // 初次加载扫描
        setTimeout(scanPageForLinks, 1500);
        // 观察 DOM 变化 (针对 SPA 或异步加载的网站)
        const observer = new MutationObserver((mutations) => {
            let shouldScan = false;
            for (let m of mutations) {
                if (m.addedNodes.length > 0) { shouldScan = true; break; }
            }
            if (shouldScan) {
                // 节流处理
                clearTimeout(window._alistScanTimer);
                window._alistScanTimer = setTimeout(scanPageForLinks, 2000);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- 注册油猴菜单 ---
    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('⚙️ 助手设置', () => {
            const panel = document.getElementById('alist-panel');
            if (panel) {
                panel.classList.add('show');
                const configTab = document.querySelector('.alist-tab[data-target="config"]');
                if (configTab) configTab.click();
            }
        });
    }

})();
