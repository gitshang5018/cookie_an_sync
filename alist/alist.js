// ==UserScript==
// @name         Alist 文件智能重命名
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  在 AList / OpenList 网页上扫描当前目录，用 TMDB 智能批量重命名影视文件
// @author       You
// @match        *://*/*
// @run-at       document-idle
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

    // ------- AList 站点识别 --------
    function looksLikeAlist() {
        try {
            const title = (document.title || '').toLowerCase();
            if (/alist|openlist/.test(title)) return true;
            if (document.querySelector('meta[name="generator"][content*="list" i]')) return true;
            // AList 把登录 token 存在 localStorage.token
            const tk = localStorage.getItem('token') || '';
            if (tk && tk.length > 20) return true;
            // 一些自部署可能没有 meta，留个 hatch：URL 含 /@manage 或 hash 路由 #/
            if (/\/@manage\b|\/@login\b/.test(location.pathname)) return true;
        } catch(_) {}
        return false;
    }

    if (!looksLikeAlist()) {
        // 不是 AList 页，但仍允许用菜单强行打开（用户在其他页想用作工具）
        try {
            GM_registerMenuCommand('强制启用 AList 重命名面板', () => {
                window.__alist_renamer_force = true;
                init();
            });
        } catch(_) {}
        return;
    }

    init();

    // -------- 主程序 ---------
    function init() {
        if (window.__alist_renamer_inited) return;
        window.__alist_renamer_inited = true;

        const defaultConfig = {
            alistUrl: location.origin,
            alistToken: localStorage.getItem('token') || '',
            tmdbApiKey: '',
            tmdbLang: 'zh-CN',
            tmdbHost: 'https://api.themoviedb.org',
            nameStyle: 'chinese', // 'chinese' | 'english' | 'bilingual'
            recursive: false,
            recursiveDepth: 2,
            skipMetadata: true,
            dryRun: true
        };
        let config = { ...defaultConfig, ...GM_getValue('alist_renamer_config', {}) };

        // 每次启动用 localStorage 中最新 token 覆盖（用户重新登录后无需手动改）
        const lsToken = localStorage.getItem('token') || '';
        if (lsToken && lsToken !== config.alistToken) {
            config.alistToken = lsToken;
            GM_setValue('alist_renamer_config', config);
        }

        const saveConfig = () => GM_setValue('alist_renamer_config', config);

        // ====== UI ======
        GM_addStyle(`
            #alist-renamer-trigger {
                position: fixed; left: 16px; bottom: 90px; z-index: 2147483646;
                width: 46px; height: 46px; border-radius: 50%; border: none;
                background: #10b981; color: #fff; font-size: 20px; cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            }
            #alist-renamer-trigger:hover { transform: scale(1.05); }
            #alist-renamer-panel {
                position: fixed; left: 16px; bottom: 150px; width: 640px;
                max-height: 78vh; background: #fff; color: #111;
                border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,0.25);
                z-index: 2147483646; display: none; overflow: hidden;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 13px;
            }
            #alist-renamer-panel.show { display: flex; flex-direction: column; }
            .arp-head {
                padding: 10px 14px; background: #10b981; color: #fff;
                display: flex; align-items: center; justify-content: space-between;
            }
            .arp-head h3 { margin: 0; font-size: 14px; font-weight: 600; }
            .arp-head button {
                background: rgba(255,255,255,0.2); color: #fff; border: none;
                width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
            }
            .arp-tabs { display: flex; border-bottom: 1px solid #e5e7eb; }
            .arp-tabs button {
                flex: 1; padding: 8px 0; background: #fff; border: none;
                cursor: pointer; font-size: 13px; color: #6b7280;
                border-bottom: 2px solid transparent;
            }
            .arp-tabs button.active { color: #10b981; border-bottom-color: #10b981; }
            .arp-body { padding: 12px 14px; overflow-y: auto; flex: 1; }
            .arp-row { display: flex; align-items: center; margin-bottom: 8px; gap: 8px; }
            .arp-row label { width: 110px; color: #374151; flex-shrink: 0; }
            .arp-row input[type=text], .arp-row input[type=password], .arp-row select {
                flex: 1; padding: 4px 6px; border: 1px solid #d1d5db;
                border-radius: 4px; font-size: 12px;
            }
            .arp-row input[type=checkbox] { transform: scale(1.1); }
            .arp-btn {
                background: #10b981; color: #fff; border: none; padding: 6px 12px;
                border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 6px;
            }
            .arp-btn.secondary { background: #6b7280; }
            .arp-btn.warn { background: #ef4444; }
            .arp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .arp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
            .arp-table th, .arp-table td {
                border-bottom: 1px solid #f3f4f6; padding: 4px 6px; text-align: left;
                vertical-align: top;
            }
            .arp-table th { background: #f9fafb; color: #374151; font-weight: 500; position: sticky; top: 0; }
            .arp-table td.old { color: #6b7280; max-width: 260px; word-break: break-all; }
            .arp-table td.new { color: #059669; max-width: 260px; word-break: break-all; }
            .arp-table tr.skip td { color: #9ca3af; font-style: italic; }
            .arp-table tr.error td { color: #dc2626; }
            .arp-log {
                background: #111827; color: #d1d5db; font-family: monospace;
                font-size: 11px; padding: 8px; border-radius: 4px; height: 160px;
                overflow-y: auto; white-space: pre-wrap; margin-top: 8px;
            }
            .arp-summary { margin: 8px 0; color: #4b5563; }
            .arp-summary strong { color: #111827; }
            .arp-controls { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
            .arp-path-display {
                background: #f9fafb; padding: 6px 8px; border-radius: 4px;
                color: #4b5563; font-family: monospace; font-size: 11px;
                word-break: break-all; margin-bottom: 8px;
            }
            .arp-alt-select {
                margin-top: 4px; font-size: 11px; max-width: 100%;
                padding: 2px 4px; border: 1px solid #d1d5db; border-radius: 3px;
                background: #fff; color: #374151;
            }
            .arp-alt-select:hover { border-color: #10b981; }
        `);

        const trigger = document.createElement('button');
        trigger.id = 'alist-renamer-trigger';
        trigger.title = 'Alist 智能重命名';
        trigger.innerHTML = '🏷️';
        document.body.appendChild(trigger);

        const panel = document.createElement('div');
        panel.id = 'alist-renamer-panel';
        panel.innerHTML = `
            <div class="arp-head">
                <h3>🏷️ AList 文件智能重命名 v0.2</h3>
                <button id="arp-close">✕</button>
            </div>
            <div class="arp-tabs">
                <button data-tab="main" class="active">扫描 / 重命名</button>
                <button data-tab="config">设置</button>
            </div>
            <div class="arp-body" id="arp-tab-main">
                <div class="arp-path-display" id="arp-path-display">当前路径: -</div>
                <div class="arp-controls">
                    <button class="arp-btn" id="arp-scan">📂 扫描并预览</button>
                    <button class="arp-btn secondary" id="arp-select-all">全选</button>
                    <button class="arp-btn secondary" id="arp-select-none">取消全选</button>
                    <button class="arp-btn warn" id="arp-execute" disabled>🚀 执行重命名</button>
                    <button class="arp-btn secondary" id="arp-stop" style="display:none;">⛔ 停止</button>
                </div>
                <div class="arp-summary" id="arp-summary">未扫描</div>
                <div style="max-height: 280px; overflow-y: auto;">
                    <table class="arp-table">
                        <thead><tr>
                            <th style="width: 24px;"><input type="checkbox" id="arp-th-check"></th>
                            <th>原名</th>
                            <th>建议新名</th>
                            <th style="width: 50px;">类型</th>
                        </tr></thead>
                        <tbody id="arp-tbody"></tbody>
                    </table>
                </div>
                <div class="arp-log" id="arp-log"></div>
            </div>
            <div class="arp-body" id="arp-tab-config" style="display:none;">
                <div class="arp-row">
                    <label>AList 地址</label>
                    <input type="text" id="cfg-url" placeholder="https://your-alist.com">
                </div>
                <div class="arp-row">
                    <label>AList Token</label>
                    <input type="password" id="cfg-token" placeholder="自动从 localStorage 读取">
                </div>
                <div class="arp-row">
                    <label>TMDB API Key</label>
                    <input type="password" id="cfg-tmdb" placeholder="必填，去 themoviedb.org 申请">
                </div>
                <div class="arp-row">
                    <label>TMDB 语言</label>
                    <select id="cfg-lang">
                        <option value="zh-CN">中文 (zh-CN)</option>
                        <option value="zh-TW">繁體 (zh-TW)</option>
                        <option value="en-US">English</option>
                        <option value="ja-JP">日本語</option>
                    </select>
                </div>
                <div class="arp-row">
                    <label>TMDB Host</label>
                    <input type="text" id="cfg-host" placeholder="https://api.themoviedb.org / 反代">
                </div>
                <div class="arp-row">
                    <label>命名风格</label>
                    <select id="cfg-namestyle">
                        <option value="chinese">中文优先（推荐）</option>
                        <option value="english">英文 (English)</option>
                        <option value="bilingual">双语 中文 + 英文</option>
                    </select>
                </div>
                <div class="arp-row">
                    <label>递归子目录</label>
                    <input type="checkbox" id="cfg-recursive">
                    <label style="width:80px;">最大深度</label>
                    <input type="text" id="cfg-depth" style="width: 50px; flex: none;">
                </div>
                <div class="arp-row">
                    <label>预览模式</label>
                    <input type="checkbox" id="cfg-dryrun">
                    <span style="color:#6b7280; font-size:11px;">勾选则仅预览不实际改名</span>
                </div>
                <div class="arp-row">
                    <button class="arp-btn" id="cfg-save">💾 保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        const $ = (s) => panel.querySelector(s);
        const updatePathDisplay = () => {
            const p = currentPath();
            $('#arp-path-display').textContent = `当前路径: ${p}`;
        };
        updatePathDisplay();
        window.addEventListener('hashchange', updatePathDisplay);
        window.addEventListener('popstate', updatePathDisplay);
        // AList 用 pushState 切换路径，监听不到，所以打开面板时也刷新
        trigger.onclick = () => { panel.classList.toggle('show'); updatePathDisplay(); };
        $('#arp-close').onclick = () => panel.classList.remove('show');

        // tabs
        panel.querySelectorAll('.arp-tabs button').forEach(b => {
            b.onclick = () => {
                panel.querySelectorAll('.arp-tabs button').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                $('#arp-tab-main').style.display = b.dataset.tab === 'main' ? 'block' : 'none';
                $('#arp-tab-config').style.display = b.dataset.tab === 'config' ? 'block' : 'none';
                if (b.dataset.tab === 'config') populateConfigForm();
            };
        });

        function populateConfigForm() {
            $('#cfg-url').value = config.alistUrl || '';
            $('#cfg-token').value = config.alistToken || '';
            $('#cfg-tmdb').value = config.tmdbApiKey || '';
            $('#cfg-lang').value = config.tmdbLang || 'zh-CN';
            $('#cfg-host').value = config.tmdbHost || '';
            $('#cfg-namestyle').value = config.nameStyle || 'chinese';
            $('#cfg-recursive').checked = !!config.recursive;
            $('#cfg-depth').value = config.recursiveDepth || 2;
            $('#cfg-dryrun').checked = !!config.dryRun;
        }
        $('#cfg-save').onclick = () => {
            config.alistUrl = $('#cfg-url').value.trim();
            config.alistToken = $('#cfg-token').value.trim();
            config.tmdbApiKey = $('#cfg-tmdb').value.trim();
            config.tmdbLang = $('#cfg-lang').value;
            config.tmdbHost = $('#cfg-host').value.trim() || 'https://api.themoviedb.org';
            config.nameStyle = $('#cfg-namestyle').value;
            config.recursive = $('#cfg-recursive').checked;
            config.recursiveDepth = parseInt($('#cfg-depth').value, 10) || 2;
            config.dryRun = $('#cfg-dryrun').checked;
            saveConfig();
            log('✅ 设置已保存');
        };

        // ===== 日志 =====
        function log(msg) {
            const el = $('#arp-log');
            const time = new Date().toLocaleTimeString();
            el.textContent += `[${time}] ${msg}\n`;
            el.scrollTop = el.scrollHeight;
        }

        // ===== 路径检测 =====
        function currentPath() {
            // AList v3 默认是 path 路由：location.pathname 即为目录
            // 个别部署可能用 hash 路由
            let p = '';
            if (location.hash && location.hash.startsWith('#/')) {
                p = decodeURIComponent(location.hash.slice(1));
            } else {
                p = decodeURIComponent(location.pathname || '/');
            }
            // 去除尾部斜杠（根目录除外）
            if (p.length > 1) p = p.replace(/\/+$/, '');
            if (!p.startsWith('/')) p = '/' + p;
            return p;
        }

        // ====== AList API ======
        async function listDir(path) {
            const apiUrl = `${config.alistUrl.replace(/\/$/, '')}/api/fs/list`;
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: apiUrl,
                    headers: {
                        'Authorization': config.alistToken,
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify({ path, password: '', page: 1, per_page: 1000, refresh: false }),
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

        // ====== 解析器（与主脚本同源） ======
        // CJK 范围：汉字 + 日文假名 + 韩文谚文
        const CJK_CLASS = '\\u4e00-\\u9fa5\\u3041-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7a3';
        const CJK_RE = new RegExp(`[${CJK_CLASS}]`);

        function tokenizeBracketTags(str) {
            const tokens = [];
            const re = /[\[\【]([^\[\]\【\】]+)[\]\】]/g;
            let m;
            while ((m = re.exec(str)) !== null) tokens.push(m[1].trim());
            return tokens;
        }

        function isJunkTag(tag) {
            if (!tag) return true;
            const t = tag.trim();
            const patterns = [
                /^WEB[-\.]?(MKV|DL|Rip)\b/i, /^WEBRip$/i,
                /^(BluRay|Blu-Ray|BDRip|BDRemux|HDTV|HDRip|REMUX|REPACK|PROPER)\b/i,
                /^WEB-MKV\s*\/.*GB$/i, /^[\d\.]+\s*(GB|MB|TB)$/i,
                /^(2160p|1080p|720p|480p|4K|UHD|4K[-\s]?2160P|2160P)$/i,
                /^(HDR\d*\+?|HDR版本|HDR\s?10\+?|杜比视界(?:版本)?|HQ|SDR|DV|DoVi|10bit|8bit)$/i,
                /^(H\.?264|H\.?265|HEVC|AVC|x264|x265|H26[45]编码)$/i,
                /^(简繁|中字|英字|内嵌|内封|官中|官方简体|繁中|简中|双语)/,
                /字幕$/, /配音$/, /^.{0,8}(双语|国粤|国英|国日|中英|国语|粤语)/,
                /^(流媒体|高码版?|国配|完结|未删减|加长版|导演剪辑版|3D|2D|IMAX|60帧率?|60帧)$/,
                /^(AAC|FLAC|DTS(?:-HD)?|AC3|DDP?[\d\.]+|TrueHD|Atmos|EAC3|MA)$/i,
                /^(19|20)\d{2}$/,
                /^(QuickIO|PandaQT|DreamHD|FRDS|CHDBits|HDChina|HHWEB|MTeam|NTb|FLUX|TEPES|NF|AMZN|DSNP|HMAX|ATVP|iTunes)$/i,
            ];
            return patterns.some(p => p.test(t));
        }

        // 单 token（按空格 / 点拆分后的一段）是否是无关 junk
        function isJunkToken(tok) {
            if (!tok) return true;
            const t = tok.trim();
            if (!t) return true;
            if (isJunkTag(t)) return true;
            const patterns = [
                // 容器/扩展名
                /^(mp4|mkv|avi|rmvb|ts|m2ts|webm|mov|wmv|flv|iso|m4v)$/i,
                // 帧率
                /^\d{2,3}帧(率)?$/,
                // 来源缩写
                /^(BD|HD|UHD|WEB|DVD|TV|CAM|TS|TC)$/i,
                // 中文音轨/字幕组合
                /^(国粤双语|国英双语|中英双语|国日双语|国韩双语|双语|国粤|国英|国日|中英)/,
                /^(国语|粤语|英语|日语|韩语|普通话)(中字|高清|版|配音|原声)?$/,
                /^(中字|英字|双字|简繁|简中|繁中|官中|官方简体|官方繁体|内嵌|内封|内嵌字幕|内封字幕|中文字幕|英文字幕|繁体字幕|简体字幕)$/,
                /^(BD中字|HD中字|HD国粤|BD国粤|HD国语|BD国语|HD粤语|BD粤语|HD中英|BD中英|HD双语|BD双语)/,
                /^(无水印|高清|超清|完结(版)?|未删减|加长版|导演剪辑版|纪念版|杜比视界(版本)?|HDR版本|国配版?|公映版|港版|台版|美版|日版|韩版)$/,
                // 分辨率/质量
                /^(2160p|1080p|720p|480p|4K|8K|UHD|HDR10\+?|HDR|DV|DoVi)$/i,
                // 编码
                /^(H\.?264|H\.?265|HEVC|AVC|x264|x265|10bit|8bit)$/i,
                // 音频
                /^(AAC|FLAC|AC3|DTS(?:-HD)?|DDP?[\d\.]*|TrueHD|Atmos|EAC3|MA|MP3|OGG|OPUS)$/i,
                // 文件大小
                /^[\d\.]+(GB|MB|TB)$/i,
                // 年份
                /^(19|20)\d{2}$/,
            ];
            return patterns.some(p => p.test(t));
        }

        // 在第一个 junk token 处截断标题（保留前置 token）
        function trimJunkTokens(title, sep) {
            if (!title) return title;
            const splitRe = sep === '.' ? /\./ : /\s+/;
            const tokens = String(title).trim().split(splitRe);
            if (tokens.length <= 1) return tokens.join(sep === '.' ? ' ' : ' ').trim();
            let cut = tokens.length;
            for (let i = 1; i < tokens.length; i++) {
                if (isJunkToken(tokens[i])) { cut = i; break; }
            }
            return tokens.slice(0, cut).join(' ').trim();
        }

        // 剥离开头单字母 ASCII 前缀 "D 毒劫" / "Q 枪手" -> "毒劫" / "枪手"
        function stripSingleLetterPrefix(s) {
            return s.replace(new RegExp(`^[A-Za-z]\\s+(?=[${CJK_CLASS}])`), '');
        }

        // 中文数字 -> 阿拉伯数字 (支持 0-99,涵盖剧集季数)
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

        // 解析到集数但没有季数时,推断季号:优先从父目录,否则默认第一季
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

        // 去除标题中残留的季/集标记 ("黑袍纠察队.第六季" -> "黑袍纠察队")
        function cleanTitleSeasonMarkers(title) {
            if (!title) return title;
            let t = String(title);
            t = t.replace(/[\.\s]*第\s*[零〇一二三四五六七八九十百千\d]+\s*[季集][\.\s]*/g, ' ');
            t = t.replace(/(?:^|[\.\s])[Ss]\d{1,2}(?:[\.\-_\s]*[Ee]\d{1,3}(?:[\.\-_\s]*E?\d{1,3})?)?(?=$|[\.\s])/g, ' ');
            t = t.replace(/\s+/g, ' ').replace(/^[\.\s]+|[\.\s]+$/g, '').trim();
            return t;
        }

        // 把"标题(YYYY)/Quality/-发布组哈希"等尾巴清干净
        function cleanTitleTail(title) {
            if (!title) return title;
            let t = String(title).trim();
            // 反复剥离尾部 (YYYY) / 质量标签 / -哈希
            let prev;
            do {
                prev = t;
                // 尾部 (YYYY) 或 [YYYY] 或 [纯年份]
                t = t.replace(/\s*[\(（\[\【]\s*(?:19|20)\d{2}\s*[\)）\]\】]\s*$/, '');
                // 尾部 (单年份就是裸 YYYY)
                t = t.replace(/\s+(?:19|20)\d{2}\s*$/, '');
                // 尾部质量短语，如 "Remux-2160p", "BluRay 1080p", "WEB-DL", "REMUX", "2160p", "UHD"
                t = t.replace(/\s+(?:Remux|BluRay|Blu-Ray|BDRip|BDRemux|WEB[-\.]?DL|WEB[-\.]?Rip|WEBRip|HDTV|HDRip|REMUX|REPACK|PROPER|2160p|1080p|720p|480p|4K|UHD|HDR\d*\+?|HEVC|x26[45]|H\.?26[45]|10bit|8bit|SDR|DV|DoVi)(?:[-\s]*\d{3,4}p?)?\s*$/i, '');
                // 尾部 "-发布组" / "-哈希"
                t = t.replace(/[-\.\s]+[A-Za-z0-9@!]{3,}\s*$/, '');
                t = t.trim();
            } while (t !== prev && t.length > 1);
            // 空格分隔的中文/英文 junk 尾巴（"反贪风暴4 国粤双语 BD中字 mp4"）
            t = trimJunkTokens(t, ' ');
            return t.replace(/\s+/g, ' ').trim();
        }

        // 剥离开头的发布站/压制组前缀，如 "MoviCloud - 全信没收"、"GROUP | Title"
        function stripLeadingReleaseGroup(s) {
            // 形如  "ABC - " / "ABC123 | "   后面是 CJK 或英文长串
            return s.replace(new RegExp(`^[A-Za-z][A-Za-z0-9_]{2,20}\\s*[-|–—]\\s*(?=[${CJK_CLASS}A-Za-z])`), '');
        }

        // 判断是否 Scene 格式（点分隔英文 + 年份 或 SxxExx）
        function isSceneStyle(s) {
            // 在判断前 normalize 日文/中文句号
            const normalized = String(s).replace(/[。．]/g, '.');
            const dotCount = (normalized.match(/\./g) || []).length;
            const hasBrackets = /[\[\【\(（]/.test(normalized);
            const hasDottedYear = /[\._](?:19|20)\d{2}(?:[\._]|$)/.test(normalized);
            const hasDottedSE = /[\._][Ss]\d{1,2}[Ee]\d{1,3}(?:[\._]|$)/.test(normalized);
            // 没年份/季集时，识别带 .BluRay./.1080p./.WEB-DL. 等质量标签的场景命名
            const hasDottedQuality = /[\._](?:BluRay|Blu-Ray|BDRip|BDRemux|WEB[-\.]?DL|WEB[-\.]?Rip|WEBRip|HDTV|HDRip|REMUX|2160p|1080p|720p|480p|HEVC|x26[45]|H\.?26[45])(?:[\._]|$)/i.test(normalized);
            return dotCount >= 3 && !hasBrackets && (hasDottedYear || hasDottedSE || hasDottedQuality);
        }

        // Scene 解析：以年份为分界取前面作为标题
        function parseSceneStyle(rawName, parentPath = '') {
            let s = String(rawName).replace(/\.(torrent|mkv|mp4|avi|rmvb|ts|m2ts|webm|mov)$/i, '');
            s = s.replace(/_/g, '.');
            // 日文/中文句号 normalize
            s = s.replace(/[。．]/g, '.');

            // 季/集解析:在整串上搜索并剥离 (集数标记可能出现在年份之后,如 "龙门镖局.2013.E02...")
            let season = null, episode = null, episodeEnd = null;
            const seMatch = s.match(/(?:^|[\.\s])[Ss](\d{1,2})[\.\s]*[Ee](\d{1,3})(?:[\.\s]*-?[\.\s]*E?(\d{1,3}))?(?=$|[\.\s])/);
            if (seMatch) {
                season = parseInt(seMatch[1], 10);
                episode = parseInt(seMatch[2], 10);
                if (seMatch[3]) episodeEnd = parseInt(seMatch[3], 10);
                s = s.replace(seMatch[0], '.');
            } else {
                // 支持裸 E01 / EP01 等集数格式
                const epMatch = s.match(/(?:^|[\.\s])[Ee][Pp]?(\d{1,3})(?:[\.\s]*-?[\.\s]*E?(\d{1,3}))?(?=$|[\.\s])/);
                if (epMatch) {
                    episode = parseInt(epMatch[1], 10);
                    if (epMatch[2]) episodeEnd = parseInt(epMatch[2], 10);
                    s = s.replace(epMatch[0], '.');
                }
            }
            // bare Sxx:整季 scene 命名 The.Boys.S05.2160p... (无 Exx)
            if (season === null) {
                const sOnly = s.match(/(?:^|[\.\s])[Ss](\d{1,2})(?=$|[\.\s])/);
                if (sOnly) {
                    season = parseInt(sOnly[1], 10);
                    s = s.replace(sOnly[0], '.');
                }
            }
            // 解析到集数但无季数:推断季号 (整季文件常省略季标记)
            if (season === null && episode !== null) {
                season = defaultSeason(parentPath);
            }

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
            // 进一步在 titlePart 内按 "." 切分，遇到 junk 段则截断
            // 处理类似 "唐人街探案2.120帧.国语中字"
            {
                const segs = titlePart.split('.');
                let cut2 = segs.length;
                for (let i = 1; i < segs.length; i++) {
                    if (isJunkToken(segs[i])) { cut2 = i; break; }
                }
                titlePart = segs.slice(0, cut2).join('.');
            }
            let title = titlePart.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
            return { title, year, season, episode, episodeEnd, tvHint: season !== null || episode !== null };
        }

        function extractNameFields(rawName, parentPath = '') {
            let s = String(rawName || '');
            s = s.replace(/^\s*\[(磁力|种子)\]\s*/, '');
            s = s.replace(/\.(torrent|mkv|mp4|avi|rmvb|ts|m2ts|webm|mov)$/i, '');
            s = s.replace(/^\s*【[^】]*?(?:\.com|\.cn|\.net|\.org|\.tv|论坛|发布|影视|资源|网|家|社)[^】]*】\s*/i, '');
            s = s.replace(new RegExp(`^\\s*【[^】]{2,40}】\\s*(?=[${CJK_CLASS}\\[\\【])`), '');

            // 在剥离括号之前,提取版本注释 (真人版/动画版/剧场版 等) 作为强 hint
            let versionHint = null;
            const verMatch = s.match(/[\(（]\s*(真人版?|动画版?|剧场版|电影版|TV版|OVA|特别篇|完结篇|舞台版)\s*[\)）]/);
            if (verMatch) versionHint = verMatch[1];

            // 提取名字中显式的英文连续片段作为 englishHint (如 "ONE.PIECE" / "Born.with.Luck")
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

            // 剥离短括号注释 (美版)/(国语)/(粤版)/(原盘)/(未知年份)/(导演剪辑版) 等
            // 规则：括号内容仅含 1-8 个 CJK 字符（不含数字/字母），视为版本/区域标记
            s = s.replace(new RegExp(`[\\(（]([${CJK_CLASS}]{1,8})[\\)）]`, 'g'), ' ');

            // Scene-style: The.Title.2023.1080p.BluRay... — 先用专用解析器
            if (isSceneStyle(s)) {
                const scene = parseSceneStyle(s, parentPath);
                if (scene.title && scene.title.length >= 1) {
                    scene.versionHint = versionHint;
                    scene.englishHint = englishHint;
                    return scene;
                }
            }

            // 剥离开头的英文发布组前缀
            s = stripLeadingReleaseGroup(s);
            // 剥离开头单字母+空格 中文标题：D 毒劫 / Q 枪手
            s = stripSingleLetterPrefix(s);

            let titleFromPrefix = null;
            const leadingMatch = s.match(/^([^\[\]\【\】]+?)(?=[\[\【]|$)/);
            if (leadingMatch) {
                let lead = leadingMatch[1].trim().replace(/[\s·•、,，]+$/g, '');
                lead = cleanTitleTail(lead);
                lead = cleanTitleSeasonMarkers(lead);
                const hasCJK = CJK_RE.test(lead);
                const noJunkWords = !/\b(2160p|1080p|720p|BluRay|WEB-?DL|WEBRip|HEVC|x26[45]|HDR|UHD|REMUX|H\.?26[45])\b/i.test(lead);
                // 接受条件：含中日韩字符 ｜ 或纯英文但去尾后长度>=3且不含质量关键词
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
                        // 支持裸 E01 / EP01 等集数格式
                        const epMatch = s.match(/(?:^|[\s\.\-_\[\(【（])[Ee][Pp]?(\d{1,3})(?:[\s\.\-_]*[Ee]?(\d{1,3}))?(?:[\s\.\-_\]\)】）]|$)/);
                        if (epMatch) {
                            episode = parseInt(epMatch[1], 10);
                            if (epMatch[2]) episodeEnd = parseInt(epMatch[2], 10);
                            s = s.replace(epMatch[0], ' ');
                        }
                    }
                }
            }
            // 整季文件夹: bare Sxx (无 Exx),如 "The.Boys.S05.2160p..."
            if (season === null) {
                const sOnly = s.match(/(?:^|[\s\.\-_\[\(【（])[Ss](\d{1,2})(?:[\s\.\-_\]\)】）]|$)/);
                if (sOnly) {
                    season = parseInt(sOnly[1], 10);
                    s = s.replace(sOnly[0], ' ');
                }
            }
            // 中文季,支持中文数字: 第六季 / 第十二季
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
            // 如果解析到了集数但没有季数，尝试从父级目录解析季数，未解析到则默认第一季
            if (season === null && episode !== null) {
                season = defaultSeason(parentPath);
            }
            // TV 强信号: [全X集] [共X集] [X集全] [更新至X集] (即便没解析到 Sxx 也判定为剧集)
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
                    /\b(H\.?264|H\.?265|HEVC|AVC|x264|x265|10bit|8bit)\b/gi,
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

        function parseName(rawName, parentPath = '') {
            const r = extractNameFields(rawName, parentPath);
            return {
                rawName,
                title: r.title,
                year: r.year,
                season: r.season,
                episode: r.episode,
                episodeEnd: r.episodeEnd,
                isTV: r.season !== null || r.episode !== null || !!r.tvHint,
                versionHint: r.versionHint || null,
                englishHint: r.englishHint || null
            };
        }

        // 单次 TMDB 搜索:返回 results 数组(失败抛错)
        async function tmdbQueryType(parsed, type, overrideLang) {
            const searchLang = overrideLang || ((config.nameStyle === 'english') ? 'en-US' : (config.tmdbLang || 'zh-CN'));
            const yearKey = type === 'tv' ? 'first_air_date_year' : 'year';
            const params = new URLSearchParams({
                api_key: config.tmdbApiKey,
                language: searchLang,
                query: parsed.title,
                include_adult: 'true'
            });
            if (parsed.year) params.set(yearKey, String(parsed.year));

            const primaryHost = (config.tmdbHost || 'https://api.themoviedb.org').replace(/\/$/, '');
            const hosts = [primaryHost];
            if (!primaryHost.includes('api.tmdb.org') && primaryHost !== 'https://api.tmdb.org') {
                hosts.push('https://api.tmdb.org');
            }
            const tryHost = (host) => new Promise((resolve, reject) => {
                const url = `${host}/3/search/${type}?${params.toString()}`;
                GM_xmlhttpRequest({
                    method: 'GET', url, headers: { 'Accept': 'application/json' }, timeout: 30000,
                    onload: (res) => {
                        try {
                            const j = JSON.parse(res.responseText);
                            if (j.status_code && j.status_code !== 1) reject(new Error(j.status_message || `TMDB ${j.status_code}`));
                            else resolve(j);
                        } catch(e) { reject(new Error('TMDB 响应解析失败')); }
                    },
                    onerror: () => reject(new Error('请求失败')),
                    ontimeout: () => reject(new Error('请求超时'))
                });
            });

            let data = null, lastErr = null;
            for (const h of hosts) {
                try { data = await tryHost(h); break; }
                catch(e) { lastErr = e; }
            }
            if (!data) throw new Error(`TMDB 不可达: ${lastErr ? lastErr.message : ''}`);
            return data.results || [];
        }

        // 给候选打分:精确标题 > popularity > 年份匹配 > 类型偏向 > 版本/英文 hint
        function scoreCandidate(result, parsed, type) {
            if (!result) return -Infinity;
            let score = 0;
            const q = String(parsed.title || '').toLowerCase().trim();
            if (!q) return -Infinity;
            const title = String(result.title || result.name || '').toLowerCase().trim();
            const orig = String(result.original_title || result.original_name || '').toLowerCase().trim();

            // 精确标题匹配最重要
            if (title === q || orig === q) score += 200;
            else if (title.startsWith(q) || q.startsWith(title) || orig.startsWith(q) || q.startsWith(orig)) score += 50;
            // 不奖励单纯 includes,防止"棋士" 命中"女棋士之恋"

            // TMDB popularity (一般 0-200,顶流条目 50+)
            score += Math.min(80, result.popularity || 0);
            // vote_count:有评分的更可能是真实条目
            score += Math.min(30, Math.log(1 + (result.vote_count || 0)) * 6);

            // 年份匹配
            if (parsed.year) {
                const date = result.release_date || result.first_air_date || '';
                const y = date ? parseInt(date.slice(0, 4), 10) : null;
                if (y === parsed.year) score += 40;
                else if (y && Math.abs(y - parsed.year) <= 1) score += 15;
                else if (y && Math.abs(y - parsed.year) > 5) score -= 20;
            }
            // 类型偏向:有强 TV 信号时 tv 类型加分;否则不偏向
            if (parsed.isTV && type === 'tv') score += 30;
            if (!parsed.isTV && type === 'movie') score += 3;

            // 版本注释 (真人版/动画版/剧场版) — 按 genre / overview 强加权
            // TMDB genre_id 16 = Animation
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

            // 英文 hint: 候选的原始标题包含此英文,加分
            if (parsed.englishHint) {
                const en = parsed.englishHint.toLowerCase();
                if (en.length >= 3) {
                    if (orig.includes(en) || title.includes(en)) score += 40;
                }
            }
            return score;
        }

        async function tmdbSearch(parsed) {
            if (!config.tmdbApiKey) throw new Error('未配置 TMDB API Key');
            if (!parsed.title) throw new Error('解析不到有效标题');

            // 强 TV/电影信号:Sxx/Exx 已确定 → 只搜对应类型;否则双搜 movie + tv 选最佳
            const hasStrongSignal = parsed.season !== null || parsed.episode !== null;
            const types = hasStrongSignal
                ? [parsed.isTV ? 'tv' : 'movie']
                : ['movie', 'tv'];

            const isEnglishTitle = !CJK_RE.test(parsed.title);
            const searchLang = isEnglishTitle ? 'en-US' : ((config.nameStyle === 'english') ? 'en-US' : (config.tmdbLang || 'zh-CN'));

            // 多 query: 基础中文 title; 加版本 hint; 英文 hint
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
                // 中英混合标题:用纯英文片段重搜
                const latinOnly = parsed.title.replace(new RegExp(`[${CJK_CLASS}]+\\d*`, 'g'), ' ').replace(/\s+/g, ' ').trim();
                if (latinOnly && latinOnly !== parsed.title && latinOnly.length >= 2 && /[A-Za-z]/.test(latinOnly)) {
                    log(`TMDB 无结果,改用英文标题重搜: "${latinOnly}"`);
                    return tmdbSearch({ ...parsed, title: latinOnly });
                }
                if (parsed.year) {
                    log(`TMDB 无结果,去年份重搜...`);
                    return tmdbSearch({ ...parsed, year: null });
                }
                throw lastErr || new Error('TMDB 无匹配结果');
            }

            candidates.sort((a, b) => b.score - a.score);

            // 把前 6 个候选都构造为完整 meta(供 UI 手动切换)
            const buildMetaFromCandidate = (c) => {
                const top = c.result;
                const officialTitle = top.title || top.name || parsed.title;
                const originalTitle = top.original_title || top.original_name || '';
                const date = top.release_date || top.first_air_date || '';
                const matchedYear = date ? parseInt(date.slice(0, 4), 10) : parsed.year;
                return {
                    type: c.type,
                    tmdbId: top.id,
                    title: officialTitle,
                    originalTitle,
                    englishTitle: null,
                    year: matchedYear,
                    popularity: top.popularity || 0,
                    score: c.score,
                    season: parsed.season,
                    episode: parsed.episode,
                    episodeEnd: parsed.episodeEnd,
                    episodes: null
                };
            };
            const topCandidates = candidates.slice(0, 6).map(buildMetaFromCandidate);
            const meta = topCandidates[0];
            meta.alternatives = topCandidates.slice(1);

            if (queries.length > 1 || types.length > 1) {
                const cn = meta.type === 'tv' ? '剧集' : '电影';
                log(`  ⇒ 命中${cn} "${meta.title}" (score ${meta.score.toFixed(0)},${queries.length} query × ${types.length} type → ${topCandidates.length} 候选)`);
            }

            const userLang = (config.nameStyle === 'english') ? 'en-US' : (config.tmdbLang || 'zh-CN');
            if (searchLang === 'en-US' && userLang !== 'en-US') {
                meta.translated = true;
                try {
                    const localTitle = await fetchTmdbTitleByLang(meta.type, meta.tmdbId, userLang);
                    if (localTitle) {
                        if (config.nameStyle === 'bilingual' && localTitle !== meta.title) {
                            meta.englishTitle = meta.title;
                        }
                        meta.title = localTitle;
                    }
                } catch (_) {}
            }

            if (config.nameStyle === 'bilingual' && !/^[\x00-\x7f\s]+$/.test(meta.title)) {
                if (!meta.englishTitle) {
                    try {
                        const en = await fetchTmdbTitleByLang(meta.type, meta.tmdbId, 'en-US');
                        if (en && en !== meta.title) meta.englishTitle = en;
                    } catch(_) { /* 忽略 */ }
                }
            }
            return meta;
        }

        async function fetchTmdbTitleByLang(type, id, lang) {
            const primaryHost = (config.tmdbHost || 'https://api.themoviedb.org').replace(/\/$/, '');
            const url = `${primaryHost}/3/${type}/${id}?api_key=${encodeURIComponent(config.tmdbApiKey)}&language=${lang}`;
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, headers: { 'Accept': 'application/json' }, timeout: 20000,
                    onload: (res) => {
                        try {
                            const j = JSON.parse(res.responseText);
                            resolve(j.title || j.name || '');
                        } catch(e) { reject(e); }
                    },
                    onerror: () => reject(new Error('请求失败')),
                    ontimeout: () => reject(new Error('超时'))
                });
            });
        }

        // 获取剧集某一季的所有 episode 名称,返回 { [episode_number]: name }
        async function fetchTmdbSeasonEpisodes(tvId, seasonNum) {
            const searchLang = config.nameStyle === 'english' ? 'en-US' : (config.tmdbLang || 'zh-CN');
            const primaryHost = (config.tmdbHost || 'https://api.themoviedb.org').replace(/\/$/, '');
            const url = `${primaryHost}/3/tv/${tvId}/season/${seasonNum}?api_key=${encodeURIComponent(config.tmdbApiKey)}&language=${searchLang}`;
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, headers: { 'Accept': 'application/json' }, timeout: 20000,
                    onload: (res) => {
                        try {
                            const j = JSON.parse(res.responseText);
                            const map = {};
                            (j.episodes || []).forEach((ep) => {
                                if (ep.episode_number != null && ep.name) {
                                    map[ep.episode_number] = ep.name;
                                }
                            });
                            resolve(map);
                        } catch(_) { resolve({}); }
                    },
                    onerror: () => resolve({}),
                    ontimeout: () => resolve({})
                });
            });
        }

        // 判断集名是否是占位符 (如 "第 5 集" / "Episode 5") — 这种没必要拼进文件名
        function isPlaceholderEpName(name, epNum) {
            if (!name) return true;
            const trimmed = String(name).trim();
            if (!trimmed) return true;
            if (new RegExp(`^第\\s*${epNum}\\s*集$`).test(trimmed)) return true;
            if (new RegExp(`^Episode\\s*${epNum}$`, 'i').test(trimmed)) return true;
            if (new RegExp(`^Ep\\s*${epNum}$`, 'i').test(trimmed)) return true;
            if (new RegExp(`^E${epNum}$`, 'i').test(trimmed)) return true;
            return false;
        }

        // 取该集集名(若有且非占位符)
        function getEpisodeName(meta, epNum) {
            if (!meta || !meta.episodes || epNum == null) return null;
            const raw = meta.episodes[epNum];
            if (!raw || isPlaceholderEpName(raw, epNum)) return null;
            return raw;
        }

        // 确保 meta.episodes 已加载(剧集且有 season 时)
        async function ensureEpisodes(meta) {
            if (!meta) return;
            if (meta.type !== 'tv') return;
            if (meta.season == null) return;
            if (meta.episodes) return;
            try {
                meta.episodes = await fetchTmdbSeasonEpisodes(meta.tmdbId, meta.season);
                const cnt = Object.keys(meta.episodes).length;
                if (cnt) log(`  📺 已加载 ${meta.title} 第 ${meta.season} 季 ${cnt} 集集名`);
            } catch(_) { meta.episodes = {}; }
        }

        const VIDEO_EXTS = ['mkv','mp4','avi','ts','m2ts','mov','webm','rmvb','rm','flv','wmv','mpg','mpeg','iso','3gp'];
        const SUB_EXTS = ['srt','ass','ssa','vtt','sub','idx','sup','smi','pgs'];

        function looksLikeExtensionlessVideo(name) {
            const s = String(name || '');
            const hasEpisode = /(?:^|[\s\.\-_\[\(【（])[Ee][Pp]?\d{1,3}(?:[\s\.\-_\]\)】）]|$)/.test(s) ||
                /第\s*\d+\s*集/.test(s) ||
                /[Ss]\d{1,2}[\s\.\-_]*[Ee]\d{1,3}/.test(s);
            const hasReleaseTag = /(?:^|[\s\.\-_])(WEB[-\.]?DL|WEB[-\.]?Rip|WEBRip|BluRay|Blu-Ray|BDRip|BDRemux|HDTV|HDRip|REMUX|2160p|1080p|720p|480p|4K|UHD|HEVC|H\.?26[45]|x26[45]|HDR10?\+?|DV|DoVi|10bits?|8bits?|DDP?[\d\.]+|EAC3|AAC|DTS)(?:[\s\.\-_]|$)/i.test(s);
            return hasEpisode && hasReleaseTag;
        }

        function mediaInfoFromName(name) {
            const m = String(name).match(/\.([A-Za-z0-9]{1,5})$/);
            const ext = m ? m[0] : '';
            const extLower = m ? m[1].toLowerCase() : '';
            const isVideo = VIDEO_EXTS.includes(extLower);
            const isSub = SUB_EXTS.includes(extLower);
            if (isVideo || isSub) return { ext, extLower, isVideo, isSub };
            if (looksLikeExtensionlessVideo(name)) {
                return { ext: '', extLower: '', isVideo: true, isSub: false };
            }
            return { ext, extLower, isVideo: false, isSub: false };
        }

        // 根据 nameStyle 拼出最终标题文本
        function composeTitle(meta) {
            const t = (meta.title || '').trim();
            const en = (meta.englishTitle || '').trim();
            const orig = (meta.originalTitle || '').trim();
            if (config.nameStyle === 'bilingual') {
                // 主 + 英文（若不同且存在）；主标题已是英文时不重复
                const isMainAscii = /^[\x00-\x7f\s]+$/.test(t);
                if (!isMainAscii && en && en !== t) return `${t} ${en}`;
                if (!isMainAscii && !en && orig && orig !== t && /^[\x00-\x7f\s]+$/.test(orig)) return `${t} ${orig}`;
                return t;
            }
            // chinese / english 模式：直接用主标题（已按对应语言查询）
            return t;
        }

        function buildFolderName(meta) {
            const safe = (s) => String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
            const title = safe(composeTitle(meta));
            const year = meta.year ? ` (${meta.year})` : '';
            if (meta.type === 'tv' && meta.season !== null) {
                const s = String(meta.season).padStart(2, '0');
                return `${title}${year} - S${s}`;
            }
            return `${title}${year}`;
        }
        function buildTargetName(meta, originalName) {
            const { ext } = mediaInfoFromName(originalName);
            const safe = (s) => String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
            const title = safe(composeTitle(meta));
            const year = meta.year ? ` (${meta.year})` : '';
            if (meta.type === 'tv' && meta.season !== null && meta.episode !== null) {
                const s = String(meta.season).padStart(2, '0');
                const e = String(meta.episode).padStart(2, '0');
                const eEnd = meta.episodeEnd ? `-E${String(meta.episodeEnd).padStart(2, '0')}` : '';
                const epName = getEpisodeName(meta, meta.episode);
                const epSuffix = epName ? ` - ${safe(epName)}` : '';
                return `${title}${year} - S${s}E${e}${eEnd}${epSuffix}${ext}`;
            }
            return `${title}${year}${ext}`;
        }
        function buildInnerName(meta, innerName) {
            const { ext, isVideo, isSub } = mediaInfoFromName(innerName);
            if (!isVideo && !isSub) return null;
            const safe = (s) => String(s).replace(/[\\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
            const title = safe(composeTitle(meta));
            const year = meta.year ? ` (${meta.year})` : '';
            let langSuffix = '';
            if (isSub) {
                const stem = innerName.slice(0, -ext.length);
                const langMatch = stem.match(/\.([A-Za-z]{2,5}|[A-Za-z]{2,3}-[A-Za-z]{2,8}|chs|cht|sc|tc|chi|eng|jpn|jap|kor)$/i);
                if (langMatch) langSuffix = `.${langMatch[1]}`;
            }
            if (meta.type === 'tv') {
                let sNum = null, eNum = null;
                const seMatch = innerName.match(/[Ss](\d{1,2})[\s\.\-_]*[Ee](\d{1,3})/);
                if (seMatch) {
                    sNum = parseInt(seMatch[1], 10);
                    eNum = parseInt(seMatch[2], 10);
                } else {
                    const cn = innerName.match(/第\s*(\d+)\s*季[\s\S]{0,4}?第?\s*(\d+)\s*集?/);
                    if (cn) {
                        sNum = parseInt(cn[1], 10);
                        eNum = parseInt(cn[2], 10);
                    } else {
                        // 兜底: 仅 EXX (如 "第03集" / "EP03")
                        const epOnly = innerName.match(/(?:第\s*(\d+)\s*集|[Ee][Pp]?(\d{1,3}))/);
                        if (epOnly) {
                            eNum = parseInt(epOnly[1] || epOnly[2], 10);
                            if (meta.season !== null) sNum = meta.season;
                        } else if (meta.season !== null && meta.episode !== null) {
                            sNum = meta.season;
                            eNum = meta.episode;
                        }
                    }
                }
                if (sNum !== null && eNum !== null) {
                    const s = String(sNum).padStart(2, '0');
                    const e = String(eNum).padStart(2, '0');
                    const epName = getEpisodeName(meta, eNum);
                    const epSuffix = epName ? ` - ${safe(epName)}` : '';
                    return `${title}${year} - S${s}E${e}${epSuffix}${langSuffix}${ext}`;
                }
                return `${title}${year}${langSuffix}${ext}`;
            }
            return `${title}${year}${langSuffix}${ext}`;
        }

        // ====== 扫描流程 ======
        // proposals: Array<{ kind, path, oldName, newName?, error?, checked, meta?, innerPlans? }>
        // kind: 'folder' | 'file'
        // innerPlans: Array<{ oldName, newName, fullPath }>  仅 folder 情况
        let proposals = [];
        let aborted = false;

        async function gatherEntries(rootPath, depth) {
            const out = [];
            async function walk(p, lvl) {
                if (aborted) return;
                let list;
                try { list = await listDir(p); }
                catch(e) { log(`❌ 列目录失败 ${p}: ${e.message}`); return; }
                for (const item of list) {
                    out.push({ parent: p, item });
                    if (config.recursive && item.is_dir && lvl < depth) {
                        const sub = `${p.replace(/\/$/, '')}/${item.name}`;
                        await walk(sub, lvl + 1);
                    }
                }
            }
            await walk(rootPath, 0);
            return out;
        }

        // 判断名称是否已经符合目标命名规范（Plex/Jellyfin 风格），符合则不必再查 TMDB
        function looksAlreadyCorrect(name, isDir) {
            if (!name) return false;
            const trimmed = name.trim();
            // 含发布组分隔符的不算（如 "MoviCloud - 全信没收 (2026)"）
            if (/\s[-|]\s/.test(trimmed)) {
                // 但允许 " - S01E01" 和 " - S01E01 - 集名" 这种合法分隔
                const stripped = trimmed.replace(/\s-\sS\d{2}E\d{2}(?:-E\d{2})?(?:\s-\s[^\/\\]+)?(?=[\.\s]|$)/, '');
                if (/\s[-|]\s/.test(stripped)) return false;
            }
            if (isDir) {
                return /^[^\[\]\【\】\/\\]+\s\((?:19|20)\d{2}\)(?:\s-\sS\d{2})?$/.test(trimmed);
            }
            const extM = name.match(/\.([A-Za-z0-9]{1,5})$/);
            if (!extM) return false;
            const ext = extM[1].toLowerCase();
            const isVideo = VIDEO_EXTS.includes(ext);
            const isSub = SUB_EXTS.includes(ext);
            if (!isVideo && !isSub) return false;
            const stem = name.slice(0, -extM[0].length);
            const stemNoLang = isSub ? stem.replace(/\.([A-Za-z]{2,8}|[A-Za-z]{2,3}-[A-Za-z]{2,8})$/, '') : stem;
            // 接受: "Title (Year)" / "Title (Year) - S01E01" / "Title (Year) - S01E01 - 集名"
            return /^[^\[\]\【\】\/\\]+\s\((?:19|20)\d{2}\)(?:\s-\sS\d{2}E\d{2}(?:-E\d{2})?(?:\s-\s.+)?)?$/.test(stemNoLang.trim());
        }

        // 根据 meta 与 insideFiles 计算文件夹内文件的重命名计划
        function computeInnerPlans(meta, insideFiles) {
            const videos = insideFiles.filter(f => !f.is_dir && mediaInfoFromName(f.name).isVideo);
            const mainVideo = videos.length ? videos.reduce((a, b) => (a.size > b.size ? a : b)) : null;
            const innerPlans = [];
            for (const inner of insideFiles) {
                if (inner.is_dir) continue;
                const targetInner = buildInnerName(meta, inner.name);
                if (!targetInner) continue;
                if (meta.type === 'movie' && videos.length > 1 && mainVideo && inner.name !== mainVideo.name &&
                    mediaInfoFromName(inner.name).isVideo) {
                    continue;
                }
                if (targetInner === inner.name) continue;
                innerPlans.push({ oldName: inner.name, newName: targetInner });
            }
            return innerPlans;
        }

        // 切换 proposal 当前选中的 meta(用于 UI 手动覆盖)
        async function applyMetaIdx(proposal, idx) {
            if (!proposal.metaCandidates || idx < 0 || idx >= proposal.metaCandidates.length) return;
            proposal.metaIdx = idx;
            proposal.meta = proposal.metaCandidates[idx];

            const searchLang = (config.nameStyle === 'english') ? 'en-US' : (config.tmdbLang || 'zh-CN');
            if (searchLang !== 'en-US' && !proposal.meta.translated) {
                proposal.meta.translated = true;
                try {
                    const localTitle = await fetchTmdbTitleByLang(proposal.meta.type, proposal.meta.tmdbId, searchLang);
                    if (localTitle) {
                        if (config.nameStyle === 'bilingual' && localTitle !== proposal.meta.title) {
                            proposal.meta.englishTitle = proposal.meta.title;
                        }
                        proposal.meta.title = localTitle;
                    }
                } catch (_) {}
            }

            await ensureEpisodes(proposal.meta);
            if (proposal.kind === 'folder') {
                proposal.newName = buildFolderName(proposal.meta);
                proposal.innerPlans = computeInnerPlans(proposal.meta, proposal.insideFiles || []);
            } else {
                proposal.newName = buildTargetName(proposal.meta, proposal.oldName);
            }
        }

        // 从文件夹内部文件推断季号(用于整季文件夹无明确 season 时)
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
                    // 裸 E01 / 第03集 (无 S) 也算作剧集文件
                    hasEpisodeLike = true;
                }
            }
            let best = null, bestCount = 0;
            for (const k in counts) {
                if (counts[k] > bestCount) { best = parseInt(k, 10); bestCount = counts[k]; }
            }
            // 没有任何 SxxExx,但存在裸集数文件 → 默认第一季
            if (best === null && hasEpisodeLike) return 1;
            return best;
        }

        async function buildProposalForEntry(parentPath, item) {
            const proposal = {
                kind: item.is_dir ? 'folder' : 'file',
                parent: parentPath,
                oldName: item.name,
                fullPath: `${parentPath.replace(/\/$/, '')}/${item.name}`,
                checked: true,
                innerPlans: null,
                meta: null,
                metaCandidates: null,
                metaIdx: 0,
                insideFiles: null,
                newName: null,
                error: null,
                skip: false
            };

            // 文件类型筛选：跳过 nfo/jpg/txt 等元数据，跳过非视频/字幕（如果是顶层文件）
            if (!item.is_dir) {
                const { isVideo, isSub } = mediaInfoFromName(item.name);
                if (!isVideo && !isSub) {
                    proposal.skip = true;
                    proposal.error = '跳过 (非视频/字幕)';
                    proposal.checked = false;
                    return proposal;
                }
            }

            // 已经是正确命名直接跳过，省一次 TMDB 调用
            let looksCorrect = looksAlreadyCorrect(item.name, item.is_dir);
            let inside = null;

            if (item.is_dir) {
                try { inside = await listDir(proposal.fullPath); } catch(_) {}
                proposal.insideFiles = inside;

                if (looksCorrect && inside) {
                    const hasUnrenamedFiles = inside.some(f => {
                        if (f.is_dir) return false;
                        const { isVideo, isSub } = mediaInfoFromName(f.name);
                        if (!isVideo && !isSub) return false;
                        return !looksAlreadyCorrect(f.name, false);
                    });
                    if (!hasUnrenamedFiles) {
                        proposal.skip = true;
                        proposal.error = '已是规范命名';
                        proposal.checked = false;
                        return proposal;
                    }
                    looksCorrect = false;
                }
            } else {
                if (looksCorrect) {
                    proposal.skip = true;
                    proposal.error = '已是规范命名';
                    proposal.checked = false;
                    return proposal;
                }
            }

            try {
                const parsed = parseName(item.name, parentPath);
                if (!parsed.title || parsed.title.length < 1) throw new Error('无法解析标题');
                const insideFilesList = item.is_dir ? (proposal.insideFiles || []) : [];
                if (item.is_dir && parsed.season == null && parsed.episode == null) {
                    const guessed = guessSeasonFromInside(insideFilesList);
                    if (guessed != null) {
                        parsed.season = guessed;
                        parsed.isTV = true;
                    }
                }
                const meta = await tmdbSearch(parsed);
                proposal.meta = meta;
                proposal.metaCandidates = [meta, ...(meta.alternatives || [])];
                proposal.metaIdx = 0;
                if (item.is_dir) {
                    // 当前 meta.season 未确定时,尝试从子文件 SxxExx 推断 (整季文件夹常用)
                    if (meta.type === 'tv' && meta.season == null) {
                        const guessed = guessSeasonFromInside(insideFilesList);
                        if (guessed != null) meta.season = guessed;
                    }
                    await ensureEpisodes(meta);
                    proposal.newName = buildFolderName(meta);
                    proposal.innerPlans = computeInnerPlans(meta, insideFilesList);
                } else {
                    await ensureEpisodes(meta);
                    proposal.newName = buildTargetName(meta, item.name);
                    if (proposal.newName === item.name) {
                        proposal.skip = true;
                        proposal.error = '与原名一致';
                        proposal.checked = false;
                    }
                }
            } catch (e) {
                proposal.error = e.message;
                proposal.checked = false;
            }
            return proposal;
        }

        function renderTable() {
            const tbody = $('#arp-tbody');
            tbody.innerHTML = '';
            let renamableCount = 0;
            proposals.forEach((p, idx) => {
                const tr = document.createElement('tr');
                if (p.skip) tr.classList.add('skip');
                if (p.error && !p.skip) tr.classList.add('error');

                const tdCk = document.createElement('td');
                if (p.error || p.skip || !p.newName) {
                    tdCk.textContent = '';
                } else {
                    const ck = document.createElement('input');
                    ck.type = 'checkbox';
                    ck.checked = p.checked;
                    ck.onchange = () => { proposals[idx].checked = ck.checked; updateSummary(); };
                    tdCk.appendChild(ck);
                    renamableCount++;
                }
                tr.appendChild(tdCk);

                const tdOld = document.createElement('td');
                tdOld.className = 'old';
                tdOld.textContent = p.oldName + (p.kind === 'folder' ? '/' : '');
                tr.appendChild(tdOld);

                const tdNew = document.createElement('td');
                tdNew.className = 'new';
                if (p.error) {
                    tdNew.textContent = `— ${p.error}`;
                } else if (p.newName) {
                    const nameDiv = document.createElement('div');
                    let txt = p.newName + (p.kind === 'folder' ? '/' : '');
                    if (p.innerPlans && p.innerPlans.length) {
                        txt += `  (含 ${p.innerPlans.length} 个内部文件)`;
                    }
                    nameDiv.textContent = txt;
                    tdNew.appendChild(nameDiv);

                    // 多候选时显示下拉选择(用户可手动覆盖自动选择)
                    if (p.metaCandidates && p.metaCandidates.length > 1) {
                        const sel = document.createElement('select');
                        sel.className = 'arp-alt-select';
                        sel.title = '切换 TMDB 候选条目';
                        p.metaCandidates.forEach((m, i) => {
                            const opt = document.createElement('option');
                            opt.value = String(i);
                            const kind = m.type === 'tv' ? '剧' : '影';
                            const yr = m.year ? ` (${m.year})` : '';
                            const prefix = i === 0 ? '★ ' : '';
                            opt.textContent = `${prefix}[${kind}] ${m.title}${yr}`;
                            if (i === (p.metaIdx || 0)) opt.selected = true;
                            sel.appendChild(opt);
                        });
                        sel.onchange = async () => {
                            await applyMetaIdx(p, parseInt(sel.value, 10));
                            renderTable();
                        };
                        tdNew.appendChild(sel);
                    }
                }
                tr.appendChild(tdNew);

                const tdType = document.createElement('td');
                tdType.textContent = p.kind === 'folder' ? '📁' : '📄';
                tr.appendChild(tdType);

                tbody.appendChild(tr);
            });
            updateSummary();
            $('#arp-execute').disabled = !proposals.some(p => p.checked);
        }

        function updateSummary() {
            const total = proposals.length;
            const ok = proposals.filter(p => p.newName && !p.error).length;
            const errs = proposals.filter(p => p.error && !p.skip).length;
            const skipped = proposals.filter(p => p.skip).length;
            const sel = proposals.filter(p => p.checked).length;
            $('#arp-summary').innerHTML = `共 <strong>${total}</strong> 项 / 可重命名 <strong>${ok}</strong> / 错误 <strong>${errs}</strong> / 跳过 <strong>${skipped}</strong> / 已勾选 <strong>${sel}</strong>` +
                (config.dryRun ? ' <span style="color:#f59e0b;">[预览模式]</span>' : '');
        }

        async function doScan() {
            if (!config.alistToken) { log('❌ 未检测到 AList Token，请到设置里填入'); return; }
            if (!config.tmdbApiKey) { log('❌ 未配置 TMDB API Key'); return; }
            aborted = false;
            proposals = [];
            renderTable();
            const path = currentPath();
            log(`📂 扫描路径: ${path}${config.recursive ? ` (递归深度 ${config.recursiveDepth})` : ''}`);
            $('#arp-scan').disabled = true;
            $('#arp-stop').style.display = '';
            try {
                const entries = await gatherEntries(path, config.recursiveDepth);
                log(`找到 ${entries.length} 个条目，开始查询 TMDB...`);
                for (let i = 0; i < entries.length; i++) {
                    if (aborted) { log('⛔ 已停止'); break; }
                    const { parent, item } = entries[i];
                    log(`(${i+1}/${entries.length}) ${item.name}`);
                    const prop = await buildProposalForEntry(parent, item);
                    proposals.push(prop);
                    if (prop.error && !prop.skip) log(`  ⚠️ ${prop.error}`);
                    else if (prop.newName) log(`  → ${prop.newName}`);
                    renderTable();
                    // 避免触发 TMDB 速率限制
                    await new Promise(r => setTimeout(r, 250));
                }
                log('✅ 扫描完成');
            } catch(e) {
                log(`❌ 扫描异常: ${e.message}`);
            } finally {
                $('#arp-scan').disabled = false;
                $('#arp-stop').style.display = 'none';
            }
        }

        async function doExecute() {
            const todo = proposals.filter(p => p.checked && p.newName && !p.error);
            if (!todo.length) { log('没有可执行的项'); return; }
            if (config.dryRun) {
                log(`[预览模式] 将重命名 ${todo.length} 项（实际未改动）。取消预览模式再执行。`);
                todo.forEach(p => {
                    log(`  ${p.oldName} → ${p.newName}`);
                    if (p.innerPlans) p.innerPlans.forEach(ip => log(`    └ ${ip.oldName} → ${ip.newName}`));
                });
                return;
            }
            if (!confirm(`即将重命名 ${todo.length} 项（及其内部文件），不可逆，确认继续？`)) return;
            aborted = false;
            $('#arp-execute').disabled = true;
            $('#arp-stop').style.display = '';
            let success = 0, fail = 0;
            try {
                for (const p of todo) {
                    if (aborted) { log('⛔ 已停止'); break; }
                    try {
                        if (p.kind === 'folder') {
                            let curFolder = p.oldName;
                            if (p.newName && p.newName !== p.oldName) {
                                await alistRename(p.fullPath, p.newName);
                                log(`✅ 文件夹: ${p.oldName} → ${p.newName}`);
                                curFolder = p.newName;
                            }
                            if (p.innerPlans && p.innerPlans.length) {
                                const newFolderPath = `${p.parent.replace(/\/$/, '')}/${curFolder}`;
                                for (const ip of p.innerPlans) {
                                    if (aborted) break;
                                    const innerFull = `${newFolderPath}/${ip.oldName}`;
                                    try {
                                        await alistRename(innerFull, ip.newName);
                                        log(`  ✅ ${ip.oldName} → ${ip.newName}`);
                                    } catch(ie) {
                                        log(`  ❌ ${ip.oldName}: ${ie.message}`);
                                        fail++;
                                    }
                                }
                            }
                            success++;
                        } else {
                            await alistRename(p.fullPath, p.newName);
                            log(`✅ ${p.oldName} → ${p.newName}`);
                            success++;
                        }
                    } catch(e) {
                        log(`❌ ${p.oldName}: ${e.message}`);
                        fail++;
                    }
                }
                log(`完成: 成功 ${success} 失败 ${fail}`);
            } finally {
                $('#arp-execute').disabled = false;
                $('#arp-stop').style.display = 'none';
            }
        }

        $('#arp-scan').onclick = doScan;
        $('#arp-execute').onclick = doExecute;
        $('#arp-stop').onclick = () => { aborted = true; log('⏹ 正在停止...'); };
        $('#arp-select-all').onclick = () => {
            proposals.forEach(p => { if (p.newName && !p.error && !p.skip) p.checked = true; });
            renderTable();
        };
        $('#arp-select-none').onclick = () => {
            proposals.forEach(p => p.checked = false);
            renderTable();
        };
        $('#arp-th-check').onchange = (e) => {
            const v = e.target.checked;
            proposals.forEach(p => { if (p.newName && !p.error && !p.skip) p.checked = v; });
            renderTable();
        };

        try {
            GM_registerMenuCommand('打开 AList 重命名面板', () => panel.classList.add('show'));
        } catch(_) {}

        log('🏷️ AList 智能重命名 v0.2 已就绪');
        log(`当前路径: ${currentPath()}`);
        if (!config.tmdbApiKey) log('⚠️ 请先到「设置」填入 TMDB API Key');
    }
})();
