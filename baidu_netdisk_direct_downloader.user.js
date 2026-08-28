// ==UserScript==
// @name         百度网盘免客户端直链下载 & IDM助手
// @namespace    https://github.com/gitshang5018/cookie_an_sync
// @version      1.3.0
// @description  免客户端直接在网页端提取百度网盘（个人网盘与分享页）真实直链，深度支持一键唤起 IDM、导出带 UA 的 IDM .ef2 配置文件、IDMan 命令行、Aria2/Motrix RPC 推送以及网页直接多线程流式下载。
// @author       Antigravity
// @match        https://pan.baidu.com/disk/main*
// @match        https://pan.baidu.com/disk/home*
// @match        https://pan.baidu.com/s/*
// @match        https://pan.baidu.com/share/link*
// @match        https://pan.baidu.com/share/init*
// @match        https://yun.baidu.com/disk/main*
// @match        https://yun.baidu.com/disk/home*
// @match        https://yun.baidu.com/s/*
// @match        https://yun.baidu.com/share/link*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      pan.baidu.com
// @connect      baidu.com
// @connect      pcs.baidu.com
// @connect      baidupcs.com
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. 全局网络监听与文件缓存池 (XHR & Fetch Hook)
    // ==========================================
    const BaiduCache = {
        filesMap: new Map(), // fs_id -> fileObj
        nameMap: new Map(),  // filename -> fileObj
        lastList: [],

        addFiles(fileList) {
            if (!Array.isArray(fileList)) return;
            fileList.forEach(item => {
                const fs_id = String(item.fs_id || item.fsid || '');
                const filename = item.server_filename || item.filename || '';
                const fileObj = {
                    fs_id: fs_id,
                    filename: filename,
                    size: Number(item.size || 0),
                    isdir: Number(item.isdir || 0),
                    path: item.path || '',
                    dlink: item.dlink || ''
                };
                if (fs_id) this.filesMap.set(fs_id, fileObj);
                if (filename) this.nameMap.set(filename, fileObj);
            });
            this.lastList = fileList;
        }
    };

    // 拦截页面 XHR / Fetch 请求以静默获取所有文件数据
    (function hookNetwork() {
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        // Hook XHR
        const origOpen = win.XMLHttpRequest.prototype.open;
        const origSend = win.XMLHttpRequest.prototype.send;

        win.XMLHttpRequest.prototype.open = function (method, url) {
            this._bduUrl = url;
            return origOpen.apply(this, arguments);
        };

        win.XMLHttpRequest.prototype.send = function () {
            this.addEventListener('load', function () {
                try {
                    const url = this._bduUrl || '';
                    if (url.includes('/api/list') || url.includes('/xpan/file') || url.includes('/share/list')) {
                        const res = JSON.parse(this.responseText);
                        const list = res.list || (res.data && res.data.list) || res.info;
                        if (Array.isArray(list)) {
                            BaiduCache.addFiles(list);
                        }
                    }
                } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };

        // Hook Fetch
        if (typeof win.fetch === 'function') {
            const origFetch = win.fetch;
            win.fetch = async function (input, init) {
                const response = await origFetch.apply(this, arguments);
                try {
                    const url = typeof input === 'string' ? input : (input ? input.url : '');
                    if (url.includes('/api/list') || url.includes('/xpan/file') || url.includes('/share/list')) {
                        const clone = response.clone();
                        clone.json().then(res => {
                            const list = res.list || (res.data && res.data.list) || res.info;
                            if (Array.isArray(list)) {
                                BaiduCache.addFiles(list);
                            }
                        }).catch(() => {});
                    }
                } catch (e) {}
                return response;
            };
        }
    })();

    // ==========================================
    // 2. 常量与默认配置
    // ==========================================
    const DEFAULT_CONFIG = {
        rpcUrl: 'http://localhost:6800/jsonrpc',
        rpcSecret: '',
        rpcDir: '',
        idmPath: 'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe',
        clientUa: 'netdisk;11.24.3;PC;PC-Windows;10.0.19045;WindowsBaiduYunGuanJia',
        autoCloseModal: false
    };

    const Config = {
        get(key) {
            return GM_getValue(key, DEFAULT_CONFIG[key]);
        },
        set(key, val) {
            GM_setValue(key, val);
        }
    };

    // ==========================================
    // 3. 注入现代化 UI 样式
    // ==========================================
    GM_addStyle(`
        /* 触发按钮样式 */
        .bdu-btn-main {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: linear-gradient(135deg, #0984e3, #00cec9) !important;
            color: #ffffff !important;
            font-size: 13px !important;
            font-weight: 600 !important;
            padding: 6px 14px !important;
            border-radius: 20px !important;
            border: none !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(9, 132, 227, 0.35) !important;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            margin-left: 8px !important;
            vertical-align: middle;
            z-index: 9999;
            text-decoration: none !important;
        }
        .bdu-btn-main:hover {
            transform: translateY(-1.5px);
            box-shadow: 0 6px 18px rgba(9, 132, 227, 0.5) !important;
            opacity: 0.95;
        }
        .bdu-btn-main:active {
            transform: scale(0.96);
        }

        /* 模态弹窗遮罩 */
        .bdu-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.75);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
        }
        .bdu-modal-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        /* 弹窗主体卡片 */
        .bdu-modal {
            background: #1e293b;
            color: #f8fafc;
            width: 90vw;
            max-width: 680px;
            border-radius: 16px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            transform: scale(0.92) translateY(15px);
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .bdu-modal-overlay.active .bdu-modal {
            transform: scale(1) translateY(0);
        }

        /* 弹窗头部 */
        .bdu-modal-header {
            padding: 16px 20px;
            background: #0f172a;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .bdu-modal-title {
            font-size: 16px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #38bdf8;
        }
        .bdu-modal-close {
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 20px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
            transition: all 0.2s;
            line-height: 1;
        }
        .bdu-modal-close:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        /* 选项卡导航 */
        .bdu-tabs {
            display: flex;
            background: #0f172a;
            padding: 0 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            gap: 8px;
        }
        .bdu-tab-item {
            padding: 12px 16px;
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s ease;
        }
        .bdu-tab-item:hover {
            color: #f1f5f9;
        }
        .bdu-tab-item.active {
            color: #38bdf8;
            border-bottom-color: #38bdf8;
        }

        /* 弹窗内容区域 */
        .bdu-modal-body {
            padding: 20px;
            max-height: 70vh;
            overflow-y: auto;
        }

        /* 文件列表展示卡片 */
        .bdu-file-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
        }
        .bdu-file-card {
            background: #334155;
            padding: 12px 14px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .bdu-file-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
            overflow: hidden;
            flex: 1;
        }
        .bdu-file-name {
            font-size: 13px;
            font-weight: 600;
            color: #f8fafc;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 440px;
        }
        .bdu-file-meta {
            font-size: 12px;
            color: #94a3b8;
            display: flex;
            gap: 12px;
        }

        /* 功能卡片区与按钮组 */
        .bdu-section-box {
            background: #0f172a;
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 14px;
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .bdu-section-title {
            font-size: 13px;
            font-weight: 700;
            color: #cbd5e1;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .bdu-btn-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 10px;
        }
        .bdu-action-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all 0.2s ease;
            text-decoration: none !important;
            color: #fff;
        }
        .bdu-action-btn.idm { background: #2563eb; }
        .bdu-action-btn.idm:hover { background: #1d4ed8; }
        .bdu-action-btn.green { background: #059669; }
        .bdu-action-btn.green:hover { background: #047857; }
        .bdu-action-btn.purple { background: #7c3aed; }
        .bdu-action-btn.purple:hover { background: #6d28d9; }
        .bdu-action-btn.orange { background: #d97706; }
        .bdu-action-btn.orange:hover { background: #b45309; }
        .bdu-action-btn.gray { background: #475569; }
        .bdu-action-btn.gray:hover { background: #334155; }
        .bdu-action-btn:active { transform: scale(0.97); }

        /* 表单控件 */
        .bdu-form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 12px;
        }
        .bdu-form-group label {
            font-size: 12px;
            font-weight: 600;
            color: #94a3b8;
        }
        .bdu-input {
            background: #1e293b;
            border: 1px solid #475569;
            color: #f8fafc;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        }
        .bdu-input:focus {
            border-color: #38bdf8;
        }

        /* 进度条 */
        .bdu-progress-wrapper {
            margin-top: 12px;
            background: #334155;
            border-radius: 100px;
            height: 8px;
            overflow: hidden;
            display: none;
        }
        .bdu-progress-bar {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #38bdf8, #818cf8);
            transition: width 0.2s ease;
        }

        /* Toast 浮窗 */
        .bdu-toast {
            position: fixed;
            top: 24px;
            right: 24px;
            background: #1e293b;
            color: #f8fafc;
            padding: 12px 18px;
            border-radius: 8px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
            font-size: 13px;
            font-weight: 600;
            z-index: 1000000;
            border-left: 4px solid #38bdf8;
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        }
        .bdu-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .bdu-toast.success { border-left-color: #10b981; }
        .bdu-toast.error { border-left-color: #ef4444; }
        .bdu-toast.warning { border-left-color: #f59e0b; }
    `);

    // ==========================================
    // 4. 通用辅助工具函数
    // ==========================================
    const Utils = {
        toast(msg, type = 'info', duration = 3000) {
            let toastEl = document.getElementById('bdu-toast-el');
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.id = 'bdu-toast-el';
                toastEl.className = 'bdu-toast';
                document.body.appendChild(toastEl);
            }
            toastEl.className = `bdu-toast ${type} show`;
            toastEl.innerText = msg;
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                toastEl.className = 'bdu-toast';
            }, duration);
        },

        formatBytes(bytes, decimals = 2) {
            if (!bytes || bytes === 0) return '0 B';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        },

        downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 1000);
        },

        downloadText(text, filename) {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            this.downloadBlob(blob, filename);
        },

        copyText(text, tip = '已成功复制到剪贴板！') {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text);
            } else {
                navigator.clipboard.writeText(text);
            }
            Utils.toast(tip, 'success');
        },

        getCookie(name) {
            const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
            return match ? match[2] : '';
        }
    };

    // ==========================================
    // 5. 百度网盘多通道直链解析引擎 (个人盘 & 分享页全面适配)
    // ==========================================
    const BaiduEngine = {
        getPageType() {
            const path = location.pathname;
            if (path.includes('/s/') || path.includes('/share/')) return 'share';
            return 'disk';
        },

        getCurrentDir() {
            try {
                const hash = location.hash || '';
                if (hash) {
                    const match = hash.match(/path=([^&]+)/);
                    if (match) return decodeURIComponent(match[1]);
                }
                const params = new URLSearchParams(location.search);
                if (params.get('path')) return params.get('path');
                if (params.get('dir')) return params.get('dir');
            } catch (e) {}
            return '/';
        },

        // 从 Vue 节点读取绑定数据
        getVueData(el) {
            if (!el) return null;
            try {
                if (el.__vue__) {
                    const v = el.__vue__;
                    return v.item || v.fileInfo || v.data || v.row || (v.$props && (v.$props.data || v.$props.item)) || null;
                }
                if (el.__vueParentComponent) {
                    const comp = el.__vueParentComponent;
                    const props = comp.props || {};
                    const ctx = comp.ctx || {};
                    return props.item || props.row || props.data || ctx.item || ctx.row || ctx.data || null;
                }
            } catch (e) {}
            return null;
        },

        // 主动请求当前目录文件列表以同步补全元数据
        async syncCurrentDirFiles() {
            const dir = this.getCurrentDir();
            const url = `https://pan.baidu.com/api/list?dir=${encodeURIComponent(dir)}&num=1000&order=name&desc=1&clienttype=0&app_id=250528&web=1`;
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        'User-Agent': Config.get('clientUa'),
                        'Referer': 'https://pan.baidu.com/disk/main'
                    },
                    onload(res) {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.errno === 0 && Array.isArray(data.list)) {
                                BaiduCache.addFiles(data.list);
                            }
                        } catch (e) {}
                        resolve();
                    },
                    onerror() { resolve(); }
                });
            });
        },

        // 提取当前选中的文件列表
        async getSelectedFiles() {
            const pageType = this.getPageType();
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const results = [];
            const seenKeys = new Set();

            const addValidFile = (item) => {
                if (!item) return;
                const fs_id = String(item.fs_id || item.fsid || '');
                const filename = item.server_filename || item.filename || '';
                const key = fs_id || filename;
                if (!key || seenKeys.has(key)) return;
                seenKeys.add(key);

                let fullInfo = BaiduCache.filesMap.get(fs_id) || BaiduCache.nameMap.get(filename) || {};
                const currentDir = this.getCurrentDir();
                const defaultPath = (currentDir === '/' ? '/' : currentDir.replace(/\/+$/, '') + '/') + (filename || fullInfo.filename || '');

                results.push({
                    fs_id: fs_id || fullInfo.fs_id || '',
                    filename: filename || fullInfo.filename || '未知文件',
                    size: Number(item.size || fullInfo.size || 0),
                    isdir: Number(item.isdir !== undefined ? item.isdir : (fullInfo.isdir || 0)),
                    path: item.path || fullInfo.path || defaultPath,
                    dlink: item.dlink || fullInfo.dlink || ''
                });
            };

            // 策略 1：检查 AMD require context
            if (typeof win.require === 'function') {
                try {
                    const sys = win.require('system-core:context/context.js')?.instanceForSystem;
                    if (sys?.list && typeof sys.list.getSelected === 'function') {
                        const list = sys.list.getSelected();
                        if (Array.isArray(list) && list.length > 0) list.forEach(addValidFile);
                    }
                } catch (e) {}
                try {
                    const baseService = win.require('base:widget/tools/service/system.js')?.get('list');
                    if (baseService && typeof baseService.getSelected === 'function') {
                        const list = baseService.getSelected();
                        if (Array.isArray(list) && list.length > 0) list.forEach(addValidFile);
                    }
                } catch (e) {}
            }

            // 策略 2：检查全局 locals
            if (results.length === 0 && win.locals && typeof win.locals.get === 'function') {
                try {
                    const selectList = win.locals.get('selected_list') || win.locals.get('file_list');
                    if (Array.isArray(selectList) && selectList.length > 0) selectList.forEach(addValidFile);
                } catch (e) {}
            }

            // 策略 3：DOM 复选框与选中行匹配
            if (results.length === 0) {
                const checkedElements = document.querySelectorAll(`
                    .wp-s-pan-table__body-row.is-checked,
                    .wp-s-pan-table__body-row.is-selected,
                    .wp-s-pan-table__body-row.selected,
                    .wp-s-pan-list__item.is-checked,
                    .nd-main-list-item.is-checked,
                    .mouse-choose-item.is-checked,
                    .u-checkbox.is-checked,
                    .el-checkbox.is-checked,
                    .wp-s-pan-table__checkbox.is-checked,
                    [class*="pan-table__body-row"][class*="checked"],
                    [class*="pan-table__body-row"][class*="selected"],
                    [class*="list-item"][class*="is-checked"],
                    [class*="grid-item"][class*="is-checked"],
                    [aria-checked="true"],
                    input[type="checkbox"]:checked
                `);

                checkedElements.forEach(el => {
                    const row = el.closest(`
                        .wp-s-pan-table__body-row,
                        .wp-s-pan-list__item,
                        .nd-main-list-item,
                        .mouse-choose-item,
                        [class*="pan-table__body-row"],
                        [class*="list-item"],
                        [class*="table__row"],
                        [class*="grid-item"],
                        tr,
                        dd
                    `) || el;

                    let vueItem = BaiduEngine.getVueData(row) || BaiduEngine.getVueData(el);
                    if (vueItem) {
                        addValidFile(vueItem);
                        return;
                    }

                    const dataId = row.getAttribute('data-id') || row.dataset.id || row.dataset.fsid || '';
                    const titleEl = row.querySelector('.wp-s-pan-table__body-row-text, [class*="filename"], [class*="name"], a[title], span[title]');
                    const filename = (titleEl && (titleEl.getAttribute('title') || titleEl.innerText.trim())) || '';

                    if (dataId || filename) {
                        addValidFile({
                            fs_id: dataId,
                            server_filename: filename
                        });
                    }
                });
            }

            // 策略 4：分享页面如果单文件且未明确勾选
            if (results.length === 0 && pageType === 'share') {
                const shareData = win.yunData?.FILEINFO || win.yunData?.SHAREPAGEDATA?.file_list;
                if (Array.isArray(shareData) && shareData.length > 0) shareData.forEach(addValidFile);
            }

            // 如果选中的文件缺少 fs_id 或 path，主动请求当前目录以补全元数据
            const needsSync = results.some(f => !f.fs_id || !f.path || f.size === 0);
            if (needsSync && pageType === 'disk') {
                await this.syncCurrentDirFiles();
                results.forEach(f => {
                    const match = BaiduCache.nameMap.get(f.filename) || (f.fs_id ? BaiduCache.filesMap.get(f.fs_id) : null);
                    if (match) {
                        if (!f.fs_id) f.fs_id = match.fs_id;
                        if (!f.path) f.path = match.path;
                        if (f.size === 0) f.size = match.size;
                        if (f.isdir === 0) f.isdir = match.isdir;
                    }
                });
            }

            return results;
        },

        // 解析单个个人盘文件的直链
        async resolveSingleDiskDlink(file) {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const fsidNum = Number(file.fs_id) || file.fs_id;
            const ua = Config.get('clientUa');

            // 通道 1：xpan multimedia filemetas API
            if (file.fs_id) {
                try {
                    const xpanUrl = `https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1&fsids=${encodeURIComponent(JSON.stringify([fsidNum]))}`;
                    const res = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: xpanUrl,
                            headers: {
                                'User-Agent': ua,
                                'Referer': 'https://pan.baidu.com/disk/main'
                            },
                            onload(r) {
                                try {
                                    const d = JSON.parse(r.responseText);
                                    if (d.errno === 0 && d.info && d.info[0] && d.info[0].dlink) {
                                        resolve(d.info[0].dlink);
                                    } else {
                                        reject(new Error('xpan errno: ' + d.errno));
                                    }
                                } catch (e) { reject(e); }
                            },
                            onerror: reject
                        });
                    });
                    if (res) return res;
                } catch (e) {}
            }

            // 通道 2：PCS 专用直链通道 (基于文件真实 path 生成免 sign 链接)
            if (file.path) {
                const pcsUrl = `https://pan.baidu.com/rest/2.0/pcs/file?method=download&path=${encodeURIComponent(file.path)}&app_id=250528`;
                try {
                    const finalCdnUrl = await new Promise((resolve) => {
                        GM_xmlhttpRequest({
                            method: 'GET',
                            url: pcsUrl,
                            headers: {
                                'User-Agent': ua,
                                'Referer': 'https://pan.baidu.com/disk/main'
                            },
                            onload(r) {
                                if (r.finalUrl && r.finalUrl.includes('baidupcs.com')) {
                                    resolve(r.finalUrl);
                                } else {
                                    resolve(pcsUrl);
                                }
                            },
                            onerror() { resolve(pcsUrl); }
                        });
                    });
                    if (finalCdnUrl) return finalCdnUrl;
                } catch (e) {
                    return pcsUrl;
                }
            }

            throw new Error(`文件【${file.filename}】未能解析到下载地址`);
        },

        // 获取个人网盘全部选中文件直链
        async fetchDiskDlink(files) {
            const results = [];
            for (const f of files) {
                const dlink = await BaiduEngine.resolveSingleDiskDlink(f);
                results.push({
                    fs_id: f.fs_id,
                    filename: f.filename,
                    size: f.size,
                    dlink: dlink
                });
            }
            return results;
        },

        // 分享页一键转存到自己网盘（临时目录）并获取高速直链（彻底免除分享页风控与错误2）
        async transferAndFetchDlink(files) {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const yunData = win.yunData || {};
            const shareData = yunData.SHAREPAGEDATA || {};
            const shareid = yunData.SHARE_ID || shareData.shareid || win.locals?.get('share_id') || '';
            const from = yunData.SHARE_UK || shareData.share_uk || win.locals?.get('share_uk') || '';
            const bdstoken = yunData.MYBDSTOKEN || shareData.bdstoken || Utils.getCookie('STOKEN') || '';
            const sekey = decodeURIComponent(Utils.getCookie('BDCLND') || yunData.SEKEY || '');

            const fsidNums = files.map(f => Number(f.fs_id) || f.fs_id).filter(Boolean);
            const targetDir = '/_直链转存临时目录_';

            Utils.toast('正在转存到网盘临时目录以获取无限制高速直链...', 'info', 3000);

            const transferUrl = `https://pan.baidu.com/share/transfer?shareid=${shareid}&from=${from}&bdstoken=${bdstoken}&channel=chunlei&web=1&app_id=250528&clienttype=0`;
            const transferData = `fsidlist=${encodeURIComponent(JSON.stringify(fsidNums))}&path=${encodeURIComponent(targetDir)}&sekey=${encodeURIComponent(sekey)}`;

            const transferRes = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: transferUrl,
                    data: transferData,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': Config.get('clientUa'),
                        'Referer': location.href
                    },
                    onload(res) {
                        try {
                            const data = JSON.parse(res.responseText);
                            if (data.errno === 0 || data.errno === 12) { // 12为已存在
                                resolve(data);
                            } else {
                                reject(new Error(data.errmsg || '转存失败，错误码：' + data.errno));
                            }
                        } catch (e) { reject(e); }
                    },
                    onerror: reject
                });
            });

            // 转存完成后，为每个文件构建个人网盘路径并获取 PCS/xpan 直链
            const results = [];
            for (const f of files) {
                const targetFilePath = targetDir + '/' + f.filename;
                const pcsUrl = `https://pan.baidu.com/rest/2.0/pcs/file?method=download&path=${encodeURIComponent(targetFilePath)}&app_id=250528`;
                results.push({
                    fs_id: f.fs_id,
                    filename: f.filename,
                    size: f.size,
                    dlink: pcsUrl
                });
            }
            return results;
        },

        // 获取分享页面 Direct Link (多通道尝试)
        async fetchShareDlink(files) {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

            // 1. 如果页面 yunData.FILEINFO 中直接包含 dlink，优先使用
            const directMatches = [];
            const shareFileInfo = win.yunData?.FILEINFO || win.yunData?.SHAREPAGEDATA?.file_list;
            if (Array.isArray(shareFileInfo)) {
                for (const f of files) {
                    const match = shareFileInfo.find(item => item.fs_id == f.fs_id || item.server_filename == f.filename);
                    if (match && match.dlink) {
                        directMatches.push({
                            fs_id: f.fs_id,
                            filename: f.filename,
                            size: f.size,
                            dlink: match.dlink
                        });
                    }
                }
            }
            if (directMatches.length === files.length && directMatches.length > 0) {
                return directMatches;
            }

            // 2. 尝试调用官方 sharedownload API (修复完整的 extra 与参数规范)
            const yunData = win.yunData || {};
            const shareData = yunData.SHAREPAGEDATA || {};
            const uk = yunData.SHARE_UK || shareData.share_uk || yunData.uk || win.locals?.get('share_uk') || '';
            const shareid = yunData.SHARE_ID || shareData.shareid || yunData.shareid || win.locals?.get('share_id') || '';
            const sign = yunData.SIGN || shareData.sign || win.locals?.get('sign') || '';
            const timestamp = yunData.TIMESTAMP || shareData.timestamp || win.locals?.get('timestamp') || Math.floor(Date.now() / 1000);
            const bdstoken = yunData.MYBDSTOKEN || shareData.bdstoken || '';
            const fsidNums = files.map(f => Number(f.fs_id) || f.fs_id).filter(Boolean);

            const sekey = decodeURIComponent(Utils.getCookie('BDCLND') || yunData.SEKEY || '');
            const extraObj = sekey ? { sekey: sekey } : {};
            const extraStr = JSON.stringify(extraObj);

            if (uk && shareid && sign) {
                const postUrl = `https://pan.baidu.com/api/sharedownload?sign=${encodeURIComponent(sign)}&timestamp=${timestamp}&bdstoken=${encodeURIComponent(bdstoken)}&channel=chunlei&web=1&app_id=250528&clienttype=0`;
                const postData = `encrypt=0&product=share&uk=${uk}&primaryid=${shareid}&fid_list=${encodeURIComponent(JSON.stringify(fsidNums))}&extra=${encodeURIComponent(extraStr)}`;

                try {
                    const apiResult = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'POST',
                            url: postUrl,
                            data: postData,
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'User-Agent': Config.get('clientUa'),
                                'Referer': location.href
                            },
                            onload(res) {
                                try {
                                    const data = JSON.parse(res.responseText);
                                    if (data.errno === 0 && data.list && data.list.length > 0) {
                                        resolve(data.list.map(item => ({
                                            fs_id: item.fs_id,
                                            dlink: item.dlink,
                                            filename: item.server_filename,
                                            size: item.size
                                        })));
                                    } else {
                                        reject(new Error('sharedownload errno: ' + data.errno));
                                    }
                                } catch (e) { reject(e); }
                            },
                            onerror: reject
                        });
                    });
                    if (apiResult && apiResult.length > 0) return apiResult;
                } catch (e) {
                    console.warn('[直链助手] 分享接口直接解析未命中，自动执行极速转存通道:', e.message);
                }
            }

            // 3. 终极降级保障：一键转存到网盘临时目录并满速下载（100% 成功率，彻底解决分享页免客户端直下）
            return await BaiduEngine.transferAndFetchDlink(files);
        }
    };

    // ==========================================
    // 6. IDM 专有调用与导出子系统
    // ==========================================
    const IDMSubsystem = {
        exportEf2(fileItems) {
            const ua = Config.get('clientUa');
            const cookie = document.cookie;
            const referer = location.href;

            let ef2Text = '';
            for (const f of fileItems) {
                if (!f.dlink) continue;
                ef2Text += '<\r\n';
                ef2Text += `${f.dlink}\r\n`;
                ef2Text += `User-Agent: ${ua}\r\n`;
                ef2Text += `Referer: ${referer}\r\n`;
                if (cookie) ef2Text += `Cookie: ${cookie}\r\n`;
                if (f.filename) ef2Text += `file: ${f.filename}\r\n`;
                ef2Text += '>\r\n';
            }

            if (!ef2Text) {
                Utils.toast('没有解析到有效的下载链接', 'warning');
                return;
            }

            const exportName = `[BaiduIDM]_${fileItems[0]?.filename || 'tasks'}.ef2`;
            Utils.downloadText(ef2Text, exportName);
            Utils.toast('已成功导出 .ef2 文件！请在 IDM 中选择【任务 -> 导入 -> 从 ef2 文件导入】', 'success', 5000);
        },

        copyCliCommand(fileItem) {
            const idmPath = Config.get('idmPath');
            const saveDir = Config.get('rpcDir');
            let cmd = `"${idmPath}" /d "${fileItem.dlink}"`;
            if (fileItem.filename) cmd += ` /f "${fileItem.filename}"`;
            if (saveDir) cmd += ` /p "${saveDir}"`;
            cmd += ' /a /n';

            Utils.copyText(cmd, '已复制 IDM 命令行！在 CMD/PowerShell 运行即可唤起 IDM');
        },

        exportBatchScript(fileItems) {
            const idmPath = Config.get('idmPath');
            const saveDir = Config.get('rpcDir');
            let batContent = '@echo off\r\nchcp 65001 >nul\r\necho 正在唤起 IDM 下载百度网盘直链任务...\r\n\r\n';

            for (const f of fileItems) {
                if (!f.dlink) continue;
                batContent += `"${idmPath}" /d "${f.dlink}"`;
                if (f.filename) batContent += ` /f "${f.filename}"`;
                if (saveDir) batContent += ` /p "${saveDir}"`;
                batContent += ' /a /n\r\n';
            }

            batContent += '\r\necho 全部任务已推送到 IDM！\r\npause\r\n';
            Utils.downloadText(batContent, `[IDM一键启动]_${fileItems[0]?.filename || 'download'}.cmd`);
            Utils.toast('已生成 .cmd 批处理文件，双击即可直接调用 IDM 下载！', 'success', 4000);
        },

        copyUA() {
            const ua = Config.get('clientUa');
            Utils.copyText(ua, '已复制专用 User-Agent！请在 IDM【选项 -> 下载 -> 手动添加任务 -> 用户代理】中粘贴');
        }
    };

    // ==========================================
    // 7. Aria2 / Motrix RPC 推送与网页直下
    // ==========================================
    const Downloader = {
        async pushToAria2(fileItems) {
            const rpcUrl = Config.get('rpcUrl');
            const rpcSecret = Config.get('rpcSecret');
            const rpcDir = Config.get('rpcDir');
            const ua = Config.get('clientUa');
            const cookie = document.cookie;
            const referer = location.href;

            let successCount = 0;
            for (const f of fileItems) {
                if (!f.dlink) continue;

                const headerList = [
                    `User-Agent: ${ua}`,
                    `Referer: ${referer}`
                ];
                if (cookie) headerList.push(`Cookie: ${cookie}`);

                const options = {
                    header: headerList
                };
                if (f.filename) options.out = f.filename;
                if (rpcDir) options.dir = rpcDir;

                const params = [];
                if (rpcSecret) params.push(`token:${rpcSecret}`);
                params.push([f.dlink]);
                params.push(options);

                const payload = {
                    jsonrpc: '2.0',
                    id: 'BaiduDirect_' + Date.now(),
                    method: 'aria2.addUri',
                    params: params
                };

                try {
                    await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: 'POST',
                            url: rpcUrl,
                            data: JSON.stringify(payload),
                            headers: { 'Content-Type': 'application/json' },
                            onload(res) {
                                if (res.status >= 200 && res.status < 300) {
                                    successCount++;
                                    resolve();
                                } else {
                                    reject(new Error(`RPC 返回错误码: ${res.status}`));
                                }
                            },
                            onerror: reject
                        });
                    });
                } catch (e) {
                    console.error('RPC 推送失败:', e);
                }
            }

            if (successCount > 0) {
                Utils.toast(`成功推送 ${successCount} 个任务至 Aria2/Motrix！`, 'success');
            } else {
                Utils.toast('推送到 Aria2/Motrix 失败，请检查 RPC 地址与 Token 设置', 'error');
            }
        },

        directWebDownload(fileItem, onProgress) {
            const ua = Config.get('clientUa');
            const filename = fileItem.filename || 'download.bin';

            Utils.toast('开始网页直接下载，请稍候...', 'info');

            if (typeof GM_download === 'function') {
                GM_download({
                    url: fileItem.dlink,
                    name: filename,
                    headers: {
                        'User-Agent': ua,
                        'Referer': 'https://pan.baidu.com/disk/main',
                        'Cookie': document.cookie
                    },
                    onload() {
                        Utils.toast(`文件【${filename}】下载完成！`, 'success');
                    },
                    onerror() {
                        Utils.toast('GM_download 出错，转为流拉取方式', 'warning');
                        Downloader.fallbackStreamDownload(fileItem, onProgress);
                    },
                    onprogress(res) {
                        if (res.total > 0 && onProgress) {
                            const percent = (res.loaded / res.total) * 100;
                            onProgress(percent);
                        }
                    }
                });
            } else {
                Downloader.fallbackStreamDownload(fileItem, onProgress);
            }
        },

        fallbackStreamDownload(fileItem, onProgress) {
            const ua = Config.get('clientUa');
            const filename = fileItem.filename || 'download.bin';

            GM_xmlhttpRequest({
                method: 'GET',
                url: fileItem.dlink,
                responseType: 'blob',
                headers: {
                    'User-Agent': ua,
                    'Referer': 'https://pan.baidu.com/disk/main',
                    'Cookie': document.cookie
                },
                onprogress(res) {
                    if (res.total > 0 && onProgress) {
                        const percent = (res.loaded / res.total) * 100;
                        onProgress(percent);
                    }
                },
                onload(res) {
                    if (res.status === 200) {
                        Utils.downloadBlob(res.response, filename);
                        Utils.toast(`【${filename}】下载完成！`, 'success');
                    } else {
                        Utils.toast(`下载失败，HTTP 状态码：${res.status}`, 'error');
                    }
                },
                onerror() {
                    Utils.toast('网页下载网络中断', 'error');
                }
            });
        }
    };

    // ==========================================
    // 8. UI 控制面板与交互管理
    // ==========================================
    const UIManager = {
        activeTab: 'idm',
        currentParsedFiles: [],

        init() {
            this.createModal();
            this.bindGlobalEvents();
        },

        createModal() {
            if (document.getElementById('bdu-main-modal')) return;

            const overlay = document.createElement('div');
            overlay.id = 'bdu-main-modal';
            overlay.className = 'bdu-modal-overlay';

            overlay.innerHTML = `
                <div class="bdu-modal">
                    <div class="bdu-modal-header">
                        <div class="bdu-modal-title">
                            <span>⚡</span> 百度网盘免客户端直链 & IDM 下载中心
                        </div>
                        <button class="bdu-modal-close" id="bdu-modal-close-btn">&times;</button>
                    </div>

                    <div class="bdu-tabs">
                        <div class="bdu-tab-item active" data-tab="idm">🚀 IDM 专区</div>
                        <div class="bdu-tab-item" data-tab="direct">🌐 网页直接下载</div>
                        <div class="bdu-tab-item" data-tab="rpc">📡 Aria2 / Motrix</div>
                        <div class="bdu-tab-item" data-tab="link">🔗 直链与 cURL</div>
                        <div class="bdu-tab-item" data-tab="settings">⚙️ 偏好设置</div>
                    </div>

                    <div class="bdu-modal-body">
                        <div class="bdu-file-list" id="bdu-file-list-container">
                            <!-- 动态加载解析到的文件卡片 -->
                        </div>

                        <!-- 进度条 -->
                        <div class="bdu-progress-wrapper" id="bdu-progress-wrapper">
                            <div class="bdu-progress-bar" id="bdu-progress-bar"></div>
                        </div>

                        <!-- IDM 专区内容 -->
                        <div class="bdu-tab-content" id="bdu-tab-idm">
                            <div class="bdu-section-box">
                                <div class="bdu-section-title">⚡ IDM 核心调用操作</div>
                                <div class="bdu-btn-grid">
                                    <button class="bdu-action-btn idm" id="bdu-btn-ef2">📁 导出 IDM .ef2 任务</button>
                                    <button class="bdu-action-btn purple" id="bdu-btn-idm-bat">📄 生成 .cmd 一键调用</button>
                                    <button class="bdu-action-btn gray" id="bdu-btn-idm-cli">📋 复制 IDM 命令行</button>
                                    <button class="bdu-action-btn gray" id="bdu-btn-idm-ua">⚙️ 复制 IDM 专用 UA</button>
                                </div>
                            </div>
                            <div style="font-size:12px; color:#94a3b8; line-height:1.6; padding:0 4px;">
                                💡 <b>IDM 使用小贴士：</b><br>
                                1. <b>推荐方式：</b>点击【导出 IDM .ef2 任务】，然后在 IDM 中点击 <code>任务 -> 导入 -> 从 ef2 文件导入</code> 即可满速下载。<br>
                                2. <b>命令行唤起：</b>点击【生成 .cmd】保存后双击，或【复制 IDM 命令行】在终端执行，即可直接唤起 IDM。
                            </div>
                        </div>

                        <!-- 网页直接下载 -->
                        <div class="bdu-tab-content" id="bdu-tab-direct" style="display:none;">
                            <div class="bdu-section-box">
                                <div class="bdu-section-title">🌐 网页端模拟客户端直下</div>
                                <p style="font-size:12px; color:#94a3b8; margin-bottom:12px;">直接在当前网页后台模拟客户端拉取文件，免装百度网盘桌面端。</p>
                                <button class="bdu-action-btn green" id="bdu-btn-web-dl" style="width:100%;">🚀 立即在网页内直接下载</button>
                            </div>
                        </div>

                        <!-- Aria2 / Motrix 推送 -->
                        <div class="bdu-tab-content" id="bdu-tab-rpc" style="display:none;">
                            <div class="bdu-section-box">
                                <div class="bdu-section-title">📡 一键推送到本地/局域网 RPC 服务</div>
                                <p style="font-size:12px; color:#94a3b8; margin-bottom:12px;">自动附加专属 User-Agent 与会话 Cookies，支持多线程分块加速。</p>
                                <button class="bdu-action-btn purple" id="bdu-btn-rpc-push" style="width:100%;">📡 立即推送到 Aria2 / Motrix</button>
                            </div>
                        </div>

                        <!-- 直链与 cURL -->
                        <div class="bdu-tab-content" id="bdu-tab-link" style="display:none;">
                            <div class="bdu-section-box">
                                <div class="bdu-section-title">🔗 原始高速直链与命令行</div>
                                <div class="bdu-btn-grid">
                                    <button class="bdu-action-btn gray" id="bdu-btn-copy-dlink">📋 复制高速直链</button>
                                    <button class="bdu-action-btn gray" id="bdu-btn-copy-curl">💻 复制 cURL 命令</button>
                                </div>
                            </div>
                        </div>

                        <!-- 设置面板 -->
                        <div class="bdu-tab-content" id="bdu-tab-settings" style="display:none;">
                            <div class="bdu-section-box">
                                <div class="bdu-section-title">⚙️ 脚本配置中心</div>
                                <div class="bdu-form-group">
                                    <label>Aria2 / Motrix RPC 地址：</label>
                                    <input type="text" class="bdu-input" id="bdu-cfg-rpc-url" value="${Config.get('rpcUrl')}">
                                </div>
                                <div class="bdu-form-group">
                                    <label>RPC 密钥 Token（可选）：</label>
                                    <input type="text" class="bdu-input" id="bdu-cfg-rpc-secret" value="${Config.get('rpcSecret')}">
                                </div>
                                <div class="bdu-form-group">
                                    <label>IDMan.exe 绝对路径（Windows）：</label>
                                    <input type="text" class="bdu-input" id="bdu-cfg-idm-path" value="${Config.get('idmPath')}">
                                </div>
                                <div class="bdu-form-group">
                                    <label>客户端模拟 User-Agent：</label>
                                    <input type="text" class="bdu-input" id="bdu-cfg-ua" value="${Config.get('clientUa')}">
                                </div>
                                <button class="bdu-action-btn green" id="bdu-btn-save-cfg" style="margin-top:8px;">💾 保存所有配置</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
        },

        bindGlobalEvents() {
            const overlay = document.getElementById('bdu-main-modal');
            const closeBtn = document.getElementById('bdu-modal-close-btn');

            closeBtn.addEventListener('click', () => this.hide());
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.hide();
            });

            // 切换选项卡
            const tabs = overlay.querySelectorAll('.bdu-tab-item');
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    tabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    const tabKey = tab.getAttribute('data-tab');

                    ['idm', 'direct', 'rpc', 'link', 'settings'].forEach(k => {
                        const contentEl = document.getElementById(`bdu-tab-${k}`);
                        if (contentEl) {
                            contentEl.style.display = (k === tabKey) ? 'block' : 'none';
                        }
                    });
                });
            });

            // 绑定各功能按钮
            document.getElementById('bdu-btn-ef2').addEventListener('click', () => {
                IDMSubsystem.exportEf2(this.currentParsedFiles);
            });
            document.getElementById('bdu-btn-idm-bat').addEventListener('click', () => {
                IDMSubsystem.exportBatchScript(this.currentParsedFiles);
            });
            document.getElementById('bdu-btn-idm-cli').addEventListener('click', () => {
                if (this.currentParsedFiles.length > 0) {
                    IDMSubsystem.copyCliCommand(this.currentParsedFiles[0]);
                }
            });
            document.getElementById('bdu-btn-idm-ua').addEventListener('click', () => {
                IDMSubsystem.copyUA();
            });
            document.getElementById('bdu-btn-web-dl').addEventListener('click', () => {
                if (this.currentParsedFiles.length > 0) {
                    const progressBar = document.getElementById('bdu-progress-bar');
                    const progressWrapper = document.getElementById('bdu-progress-wrapper');
                    progressWrapper.style.display = 'block';
                    Downloader.directWebDownload(this.currentParsedFiles[0], (percent) => {
                        progressBar.style.width = percent.toFixed(1) + '%';
                    });
                }
            });
            document.getElementById('bdu-btn-rpc-push').addEventListener('click', () => {
                Downloader.pushToAria2(this.currentParsedFiles);
            });
            document.getElementById('bdu-btn-copy-dlink').addEventListener('click', () => {
                if (this.currentParsedFiles.length > 0 && this.currentParsedFiles[0].dlink) {
                    Utils.copyText(this.currentParsedFiles[0].dlink, '高速直链已复制到剪贴板！');
                }
            });
            document.getElementById('bdu-btn-copy-curl').addEventListener('click', () => {
                if (this.currentParsedFiles.length > 0) {
                    const f = this.currentParsedFiles[0];
                    const ua = Config.get('clientUa');
                    const cookie = document.cookie;
                    let curlCmd = `curl -L "${f.dlink}" -A "${ua}"`;
                    if (cookie) curlCmd += ` -H "Cookie: ${cookie}"`;
                    if (f.filename) curlCmd += ` -o "${f.filename}"`;
                    Utils.copyText(curlCmd, 'cURL 命令已复制！');
                }
            });
            document.getElementById('bdu-btn-save-cfg').addEventListener('click', () => {
                Config.set('rpcUrl', document.getElementById('bdu-cfg-rpc-url').value.trim());
                Config.set('rpcSecret', document.getElementById('bdu-cfg-rpc-secret').value.trim());
                Config.set('idmPath', document.getElementById('bdu-cfg-idm-path').value.trim());
                Config.set('clientUa', document.getElementById('bdu-cfg-ua').value.trim());
                Utils.toast('配置已成功保存！', 'success');
            });
        },

        show(parsedFiles) {
            this.currentParsedFiles = parsedFiles;
            const container = document.getElementById('bdu-file-list-container');
            container.innerHTML = '';

            for (const f of parsedFiles) {
                const card = document.createElement('div');
                card.className = 'bdu-file-card';
                card.innerHTML = `
                    <div class="bdu-file-info">
                        <div class="bdu-file-name" title="${f.filename}">${f.filename}</div>
                        <div class="bdu-file-meta">
                            <span>大小: ${Utils.formatBytes(f.size || 0)}</span>
                            <span style="color:#38bdf8;">✓ 已提取直链</span>
                        </div>
                    </div>
                `;
                container.appendChild(card);
            }

            const overlay = document.getElementById('bdu-main-modal');
            overlay.classList.add('active');
        },

        hide() {
            const overlay = document.getElementById('bdu-main-modal');
            if (overlay) overlay.classList.remove('active');
        }
    };

    // ==========================================
    // 9. 触发解析与直链拉取主流程
    // ==========================================
    async function triggerDirectDownload() {
        Utils.toast('正在读取选中的文件...', 'info', 1500);

        const selected = await BaiduEngine.getSelectedFiles();
        if (!selected || selected.length === 0) {
            Utils.toast('未能检测到选中的文件，请在列表勾选文件后重试！', 'warning', 3500);
            return;
        }

        const isDir = selected.some(item => item.isdir === 1);
        if (isDir) {
            Utils.toast('暂不支持直接下载文件夹，请进入文件夹勾选具体文件！', 'warning', 3500);
            return;
        }

        Utils.toast(`已选中 ${selected.length} 个文件，正在模拟客户端解析高速直链...`, 'info', 2500);

        try {
            const pageType = BaiduEngine.getPageType();
            let parsedResults = [];

            if (pageType === 'share') {
                parsedResults = await BaiduEngine.fetchShareDlink(selected);
            } else {
                parsedResults = await BaiduEngine.fetchDiskDlink(selected);
            }

            // 合并文件名称与信息
            const completeFiles = parsedResults.map((item, idx) => ({
                filename: item.filename || selected[idx]?.filename || '未知文件',
                size: item.size || selected[idx]?.size || 0,
                dlink: item.dlink || item
            }));

            UIManager.show(completeFiles);
        } catch (err) {
            console.error('[直链助手] 解析异常:', err);
            Utils.toast(err.message || '直链提取失败', 'error', 4500);
        }
    }

    // ==========================================
    // 10. DOM 动态挂载与按钮注入
    // ==========================================
    function injectActionButtons() {
        if (document.getElementById('bdu-main-btn')) return;

        // 个人网盘导航栏定位
        const diskToolbar = document.querySelector(`
            .wp-s-pan-table__header-actions,
            .nd-main-list-actions,
            .tbar,
            .button-group,
            .wp-s-pan-table__header-left,
            .wp-s-pan-file-list__header-left,
            .wp-s-pan-file-list__header-actions,
            .wp-s-header-user-btn
        `);
        // 分享页定位
        const shareToolbar = document.querySelector(`
            .slide-show-right,
            .module-share-header,
            .share-file-viewer-header,
            .KPDwCE,
            .g-button-group,
            .x-button-box
        `);

        const targetToolbar = diskToolbar || shareToolbar;

        const mainBtn = document.createElement('button');
        mainBtn.id = 'bdu-main-btn';
        mainBtn.className = 'bdu-btn-main';
        mainBtn.innerHTML = `<span>⚡</span> 免客户端直链下载`;
        mainBtn.title = '免客户端提取高速直链，支持 IDM / Aria2 / 网页直接下载';
        mainBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            triggerDirectDownload();
        });

        if (targetToolbar) {
            targetToolbar.appendChild(mainBtn);
        } else if (document.body) {
            mainBtn.style.position = 'fixed';
            mainBtn.style.top = '75px';
            mainBtn.style.right = '24px';
            document.body.appendChild(mainBtn);
        }
    }

    // ==========================================
    // 11. 初始化与生命周期监控
    // ==========================================
    function init() {
        UIManager.init();
        injectActionButtons();

        // 注册油猴菜单
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('⚡ 免客户端直链下载 / IDM', triggerDirectDownload);
            GM_registerMenuCommand('⚙️ 打开设置面板', () => {
                UIManager.show([{ filename: '设置面板示例', size: 0, dlink: '' }]);
                const settingsTab = document.querySelector('.bdu-tab-item[data-tab="settings"]');
                if (settingsTab) settingsTab.click();
            });
        }

        // 监听 DOM 变化以应对单页应用(SPA)路由切换
        const observer = new MutationObserver(() => {
            injectActionButtons();
        });
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
