// ==UserScript==
// @name         小红书 · 原图批量下载 (ZIP打包)
// @namespace    xhs_zip_downloader
// @version      7.1
// @description  逆向原图返回原始分辨率JPEG。支持HEIC原图、预览选择、ZIP打包、并发下载、失败重试、懒加载、Esc关闭。
// @author       by 柚子
// @match        https://www.xiaohongshu.com/*
// @match        https://www.rednote.com/*
// @icon         https://www.xiaohongshu.com/favicon.ico
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.9.1/jszip.min.js
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    if (typeof JSZip === 'undefined') {
        return console.error('[小红书下载] ❌ JSZip 加载失败');
    }

    const CONCURRENCY = 4;
    const RETRIES = 3;

    // 精炼后的核心样式表，保持极致动效与毛玻璃质感
    GM_addStyle(`
        .xhs-dl-btn {
            display: inline-flex; align-items: center; justify-content: center;
            padding: 0 24px; height: 40px; width: 96px;
            background: rgb(255, 46, 77); color: #fff;
            border: none; border-radius: 100px;
            font-size: 16px; font-weight: 600; line-height: 1;
            white-space: nowrap; flex-shrink: 0; cursor: pointer;
            box-sizing: border-box; transition: opacity .2s, transform .15s;
        }
        .xhs-dl-btn:hover { opacity: .88; }
        .xhs-dl-btn:active { transform: scale(.96); }

        .xhs-panel-overlay {
            position: fixed; inset: 0; z-index: 100001;
            background: rgba(0,0,0,0); backdrop-filter: blur(0);
            display: flex; align-items: center; justify-content: center;
            opacity: 0; visibility: hidden;
            transition: opacity .25s ease, backdrop-filter .25s ease, visibility 0s .25s;
        }
        .xhs-panel-overlay.show {
            opacity: 1; visibility: visible;
            background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
            transition: opacity .25s ease, backdrop-filter .25s ease, visibility 0s 0s;
        }
        .xhs-panel {
            background: #fff; border-radius: 16px; width: 92vw; max-width: 960px;
            max-height: 88vh; display: flex; flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25); overflow: hidden;
            transform: scale(0.92) translateY(20px); opacity: 0;
            transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s ease;
        }
        .xhs-panel-overlay.show .xhs-panel { transform: scale(1) translateY(0); opacity: 1; }

        .xhs-panel-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px; border-bottom: 1px solid #f0f0f0;
        }
        .xhs-panel-title { color: #333; font-size: 16px; font-weight: 600; }
        .xhs-panel-subtitle { color: #999; font-size: 12px; margin-top: 2px; }
        .xhs-panel-close {
            background: none; border: none; color: #999; font-size: 24px;
            cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 8px;
        }
        .xhs-panel-close:hover { color: #333; background: #f5f5f5; }

        .xhs-panel-toolbar {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            padding: 12px 20px; border-bottom: 1px solid #f5f5f5;
        }
        .xhs-format-btn, .xhs-select-all {
            padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
            border: 1px solid #e0e0e0; background: #fff; color: #666; cursor: pointer; transition: all .15s;
        }
        .xhs-format-btn.active { background: #ff2442; border-color: #ff2442; color: #fff; }
        .xhs-format-btn:hover:not(.active), .xhs-select-all:hover { border-color: #ff2442; color: #ff2442; }
        .xhs-selected-count { color: #999; font-size: 13px; margin-left: auto; }

        .xhs-panel-body {
            flex: 1; overflow-y: auto; padding: 16px 20px;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px; align-content: start;
        }
        .xhs-panel-body::-webkit-scrollbar { width: 6px; }
        .xhs-panel-body::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .xhs-panel-body::-webkit-scrollbar-track { background: #fafafa; }

        .xhs-thumb-card {
            position: relative; border-radius: 10px; overflow: hidden;
            cursor: pointer; border: 2px solid transparent; background: #f5f5f5; aspect-ratio: 3/4;
            transition: border-color .2s, transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s;
        }
        .xhs-thumb-card:hover {
            transform: scale(1.12) translateY(-4px); z-index: 10;
            box-shadow: 0 12px 32px rgba(0,0,0,0.2); border-color: rgba(255,36,66,0.4);
        }
        .xhs-thumb-card.selected { border-color: #ff2442; }
        .xhs-thumb-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .xhs-thumb-checkbox {
            position: absolute; top: 6px; left: 6px; width: 22px; height: 22px;
            border-radius: 50%; border: 2px solid rgba(255,255,255,0.8);
            background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;
            transition: all .15s;
        }
        .xhs-thumb-card.selected .xhs-thumb-checkbox { background: #ff2442; border-color: #ff2442; }
        .xhs-thumb-checkbox svg { width: 14px; height: 14px; opacity: 0; transition: opacity .15s; }
        .xhs-thumb-card.selected .xhs-thumb-checkbox svg { opacity: 1; }
        .xhs-thumb-info {
            position: absolute; bottom: 0; inset-inline: 0; padding: 4px 8px;
            background: linear-gradient(transparent, rgba(0,0,0,0.7));
            color: #fff; font-size: 11px; font-family: monospace; display: flex; justify-content: space-between;
        }
        .xhs-thumb-loading {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            color: #666; font-size: 12px;
        }

        .xhs-panel-footer {
            display: flex; align-items: center; gap: 12px; flex-direction: column;
            padding: 16px 20px; border-top: 1px solid #f0f0f0;
        }
        .xhs-progress-bar-wrap {
            width: 100%; height: 6px; border-radius: 3px; background: #f0f0f0; overflow: hidden; display: none;
        }
        .xhs-progress-bar-wrap.show { display: block; }
        .xhs-progress-bar { height: 100%; width: 0; border-radius: 3px; background: #ff2442; transition: width .2s; }
        .xhs-download-btn {
            width: 100%; padding: 12px; border-radius: 10px; font-size: 15px; font-weight: 600;
            border: none; background: #ff2442; color: #fff; cursor: pointer; transition: all .15s;
            display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .xhs-download-btn:hover { background: #e61f3a; }
        .xhs-download-btn:disabled { background: #ccc; cursor: not-allowed; }

        .xhs-dl-toast {
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            z-index: 100002; padding: 10px 24px; background: rgba(0,0,0,.82); color: #fff;
            border-radius: 12px; font-size: 14px; pointer-events: none; opacity: 0;
            transition: opacity .3s; backdrop-filter: blur(8px); text-align: center; max-width: 80vw;
        }
        .xhs-dl-toast.show { opacity: 1; }
    `);

    let toastEl;
    function toast(msg, d = 2500) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'xhs-dl-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastEl._hide);
        toastEl._hide = setTimeout(() => toastEl.classList.remove('show'), d);
    }

    const log = (...msgs) => console.log('[XHS]', ...msgs);
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // 获取笔记数据（单点提取，消除重复查找并兼容斜杠路由）
    function getNoteData() {
        const w = unsafeWindow || window;
        const id = location.pathname.split('/').filter(Boolean).pop();
        const state = w.__INITIAL_STATE__;
        const map = state?.note?.noteDetailMap;

        return map?.[id]?.note ||
            state?.noteData?.data?.noteData ||
            Object.values(map || {}).find(v => v?.note)?.note || null;
    }

    // 原始分辨率图片抓取
    async function fetchOriginal(fileId, format) {
        const url = format === 'heic'
            ? `https://ci.xiaohongshu.com/${fileId}`
            : `https://ci.xiaohongshu.com/${fileId}?imageView2/format/jpg`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (!blob || blob.size < 100) throw new Error('空响应');
        return blob;
    }

    async function fetchWithRetry(fileId, format) {
        let lastErr;
        for (let i = 0; i < RETRIES; i++) {
            try {
                return await fetchOriginal(fileId, format);
            } catch (e) {
                lastErr = e;
                if (i < RETRIES - 1) await sleep(500 * Math.pow(2, i));
            }
        }
        throw lastErr;
    }

    async function fetchImageBlob(img, format) {
        if (img.fileId) {
            try {
                return await fetchWithRetry(img.fileId, format);
            } catch (e) {
                console.warn('[XHS] ci 原图失败，走 CDN 兜底', e.message);
            }
        }
        const url = (img.urlDefault || img.urlPre || '').replace(/^http:/, 'https:');
        if (!url) throw new Error('无可用URL');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (!blob || blob.size < 100) throw new Error('空响应');
        return blob;
    }

    async function mapLimit(items, limit, fn) {
        const results = new Array(items.length);
        let idx = 0;
        async function worker() {
            while (idx < items.length) {
                const cur = idx++;
                results[cur] = await fn(items[cur], cur);
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
        return results;
    }

    function saveBlob(blob, filename) {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 10000);
    }

    function getVideoUrl(note) {
        if (!note?.video) return null;
        if (note.video.consumer?.originVideoKey) {
            return `https://sns-video-bd.xhscdn.com/${note.video.consumer.originVideoKey}`;
        }
        if (note.video.media?.stream) {
            const streams = Object.values(note.video.media.stream).flat();
            streams.sort((a, b) => (b.height || 0) - (a.height || 0));
            return streams[0]?.backupUrls?.[0] || streams[0]?.masterUrl || null;
        }
        return null;
    }

    // ===== 面板生命周期管理 =====
    let activePanelClose = null;

    function createPanel(note) {
        // 如果已有打开面板，先通过其绑定的 close 回调安全销毁，移除 keydown 监听
        if (activePanelClose) activePanelClose(true);

        const overlay = document.createElement('div');
        overlay.className = 'xhs-panel-overlay';

        const state = {
            format: 'jpg',
            selected: new Set(note.imageList.map((_, i) => i)),
            note
        };

        const imgCount = note.imageList.length;
        const firstImg = note.imageList[0];
        const hasVideo = !!getVideoUrl(note);

        overlay.innerHTML = `
            <div class="xhs-panel">
                <div class="xhs-panel-header">
                    <div>
                        <div class="xhs-panel-title"></div>
                        <div class="xhs-panel-subtitle">${imgCount} 张图片 · ${firstImg.width}×${firstImg.height}${hasVideo ? ' · 含视频' : ''}</div>
                    </div>
                    <button class="xhs-panel-close">&times;</button>
                </div>
                <div class="xhs-panel-toolbar">
                    <div class="xhs-format-group">
                        <button class="xhs-format-btn active" data-fmt="jpg">JPEG 原图</button>
                        <button class="xhs-format-btn" data-fmt="heic">HEIC 原图</button>
                    </div>
                    <button class="xhs-select-all">全选/取消</button>
                    <span class="xhs-selected-count">已选 ${imgCount} 张</span>
                </div>
                <div class="xhs-panel-body"></div>
                <div class="xhs-panel-footer">
                    <div class="xhs-progress-bar-wrap">
                        <div class="xhs-progress-bar"></div>
                    </div>
                    <button class="xhs-download-btn">
                        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>
                        <span>下载 ${imgCount} 张</span>
                    </button>
                </div>
            </div>
        `;

        // 使用 textContent 赋值标题，天然免疫 XSS
        overlay.querySelector('.xhs-panel-title').textContent = note.title || '小红书笔记';
        document.body.appendChild(overlay);

        const body = overlay.querySelector('.xhs-panel-body');
        const countEl = overlay.querySelector('.xhs-selected-count');
        const dlBtn = overlay.querySelector('.xhs-download-btn');
        const dlLabel = dlBtn.querySelector('span');
        const selectAllBtn = overlay.querySelector('.xhs-select-all');

        function updateCount() {
            const n = state.selected.size;
            countEl.textContent = `已选 ${n} 张`;
            dlBtn.disabled = n === 0;
            dlLabel.textContent = n > 0
                ? `下载 ${n} 张${state.format === 'heic' ? ' (HEIC)' : ''}`
                : '下载选中图片';
        }

        // 渲染缩略图卡片
        note.imageList.forEach((img, i) => {
            const card = document.createElement('div');
            card.className = 'xhs-thumb-card selected';
            card.dataset.idx = i;

            const thumbUrl = (img.urlDefault || img.urlPre || '').replace(/^http:/, 'https:');
            card.innerHTML = `
                <div class="xhs-thumb-loading">加载中...</div>
                <img style="display:none" />
                <div class="xhs-thumb-checkbox">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </div>
                <div class="xhs-thumb-info">
                    <span>${img.width}×${img.height}</span>
                    <span>#${i + 1}</span>
                </div>
            `;

            const imgEl = card.querySelector('img');
            const loadingEl = card.querySelector('.xhs-thumb-loading');
            imgEl.onload = () => { imgEl.style.display = 'block'; loadingEl.style.display = 'none'; };
            imgEl.onerror = () => { loadingEl.textContent = '加载失败'; };
            if (thumbUrl) imgEl.src = thumbUrl;
            else loadingEl.textContent = '无缩略图';

            card.addEventListener('click', (e) => {
                if (e.target.closest('.xhs-thumb-info')) return;
                if (state.selected.has(i)) {
                    state.selected.delete(i);
                    card.classList.remove('selected');
                } else {
                    state.selected.add(i);
                    card.classList.add('selected');
                }
                updateCount();
            });
            body.appendChild(card);
        });

        // 格式切换
        overlay.querySelectorAll('.xhs-format-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.xhs-format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.format = btn.dataset.fmt;
                updateCount();
            });
        });

        // 全选 / 取消
        selectAllBtn.addEventListener('click', () => {
            const allSelected = state.selected.size === note.imageList.length;
            state.selected.clear();
            if (!allSelected) {
                note.imageList.forEach((_, i) => state.selected.add(i));
            }
            overlay.querySelectorAll('.xhs-thumb-card').forEach(c => c.classList.toggle('selected', !allSelected));
            updateCount();
        });

        // 安全关闭面板：解绑全局 Esc 并附带淡出动效
        const closePanel = (immediate = false) => {
            document.removeEventListener('keydown', escHandler);
            activePanelClose = null;
            if (immediate) {
                overlay.remove();
            } else {
                overlay.classList.remove('show');
                setTimeout(() => overlay.remove(), 280);
            }
        };

        function escHandler(e) {
            if (e.key === 'Escape') closePanel();
        }

        activePanelClose = closePanel;
        document.addEventListener('keydown', escHandler);
        overlay.querySelector('.xhs-panel-close').addEventListener('click', () => closePanel());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

        dlBtn.addEventListener('click', () => handleDownload(state, overlay, closePanel));

        // 触发进场动画
        requestAnimationFrame(() => overlay.classList.add('show'));
    }

    // 下载处理流：统一单图直接保存与多图 ZIP 打包
    async function handleDownload(state, overlay, closePanel) {
        const { note, format } = state;
        const indices = [...state.selected].sort((a, b) => a - b);
        if (!indices.length) return;

        const dlBtn = overlay.querySelector('.xhs-download-btn');
        const barWrap = overlay.querySelector('.xhs-progress-bar-wrap');
        const bar = overlay.querySelector('.xhs-progress-bar');
        dlBtn.disabled = true;

        const title = (note.title || document.title)
            .replace(/ - (小红书|RedNote)$/, '').trim() || '小红书_笔记';
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
        const ext = format === 'heic' ? 'heic' : 'jpg';

        log(`📋 ${title} | 选中 ${indices.length} 张 · 格式: ${format.toUpperCase()}`);

        // 单张图片：直接下载，不打包 ZIP
        if (indices.length === 1) {
            const i = indices[0];
            const img = note.imageList[i];
            toast('📷 下载中...');
            try {
                const blob = await fetchImageBlob(img, format);
                const name = `${safeTitle}_${String(i + 1).padStart(2, '0')}.${ext}`;
                saveBlob(blob, name);
                log(`✅ ${img.width}×${img.height} | ${(blob.size / 1024).toFixed(0)}KB (${format})`);
                toast(`✅ 已下载 ${name}`, 3000);
                closePanel();
            } catch (e) {
                log(`❌ 下载失败: ${e.message}`);
                toast('❌ 下载失败');
                dlBtn.disabled = false;
            }
            return;
        }

        // 多张图片：并发下载 + ZIP 打包
        barWrap.classList.add('show');
        bar.style.width = '0%';

        const items = indices.map(i => ({ img: note.imageList[i], idx: i }));
        let doneCount = 0;

        const blobs = await mapLimit(items, CONCURRENCY, async ({ img, idx }) => {
            try {
                const blob = await fetchImageBlob(img, format);
                log(`✅ [${idx + 1}] ${img.width}×${img.height} | ${(blob.size / 1024).toFixed(0)}KB (${format})`);
                return { idx, blob };
            } catch (e) {
                log(`❌ [${idx + 1}] ${e.message}`);
                return null;
            } finally {
                doneCount++;
                bar.style.width = `${Math.round((doneCount / items.length) * 100)}%`;
            }
        });

        const okItems = blobs.filter(Boolean);
        if (okItems.length === 0) {
            toast('❌ 全部失败');
            dlBtn.disabled = false;
            return;
        }

        const zip = new JSZip();
        let totalSize = 0;
        for (const { idx, blob } of okItems) {
            zip.file(`${safeTitle}_${String(idx + 1).padStart(2, '0')}.${ext}`, blob);
            totalSize += blob.size;
        }

        // 打包视频（若存在）
        const vUrl = getVideoUrl(note);
        if (vUrl) {
            toast('🎬 下载视频...');
            try {
                const resp = await fetch(vUrl);
                if (resp.ok) {
                    const blob = await resp.blob();
                    if (blob?.size > 1000) zip.file(`${safeTitle}_视频.mp4`, blob);
                }
            } catch (e) {
                log(`⚠️ 视频: ${e.message}`);
            }
        }

        toast(`📦 打包 ${okItems.length} 张...`);
        bar.style.width = '95%';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        saveBlob(zipBlob, `${safeTitle}.zip`);
        bar.style.width = '100%';

        const zipMB = (zipBlob.size / 1024 / 1024).toFixed(1);
        log(`✅ 完成! ${okItems.length}张 | 总计 ${(totalSize / 1024 / 1024).toFixed(1)}MB | ZIP ${zipMB}MB`);
        toast(`✅ ${okItems.length}张${format === 'heic' ? 'HEIC' : '原图'} (${zipMB}MB)`, 4000);

        closePanel();
    }

    function openPanel() {
        const note = getNoteData();
        if (!note) return toast('❌ 无法获取笔记数据');
        if (!note.imageList?.length) return toast('❌ 未找到图片');
        createPanel(note);
    }

    // 查找当前页面可见的关注按钮（单次 selector 匹配 + 快速可见性检查）
    function findVisibleFollow() {
        const sel = '.note-detail-follow-btn, [class*="follow-btn"], [class*="FollowBtn"], [class*="follow_wrap"], [class*="FollowWrap"], [class*="author"] [class*="follow"]';
        for (const fw of document.querySelectorAll(sel)) {
            if (fw.offsetParent !== null || fw.getBoundingClientRect().width > 0) return fw;
        }
        for (const el of document.querySelectorAll('button, a')) {
            if (el.textContent.trim() === '关注' && (el.offsetParent !== null || el.getBoundingClientRect().width > 0)) {
                return el;
            }
        }
        return null;
    }

    function injectButton(followWrap) {
        if (!followWrap?.parentElement) return;
        const currentBtn = document.querySelector('.xhs-dl-btn');
        if (currentBtn) {
            if (currentBtn.nextElementSibling === followWrap) return; // 已经在正确位置
            currentBtn.remove();
        }

        const btn = document.createElement('button');
        btn.className = 'xhs-dl-btn';
        btn.textContent = '下载';
        btn.addEventListener('click', openPanel);
        followWrap.parentElement.insertBefore(btn, followWrap);
        log('✅ 下载按钮已就绪');
    }

    // 统一的防抖维护：MutationObserver 监听 DOM 树变化并精准注入
    let timer = null;
    function scheduleCheck() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const follow = findVisibleFollow();
            if (follow) injectButton(follow);
        }, 150);
    }

    function init() {
        // 使用单个轻量 MutationObserver 观察 DOM 变更
        const observer = new MutationObserver(scheduleCheck);
        observer.observe(document.body, { childList: true, subtree: true });

        // SPA 路由变化时清理无用状态
        window.addEventListener('popstate', () => {
            document.querySelector('.xhs-dl-btn')?.remove();
            if (activePanelClose) activePanelClose(true);
            scheduleCheck();
        });

        scheduleCheck();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    GM_registerMenuCommand('📥 打开下载面板', openPanel);
    log('🟢 v7.1 — 代码精简完成 (生命周期强化/无缝SPA/Zero Leak)');
})();
