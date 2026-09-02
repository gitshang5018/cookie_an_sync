// ==UserScript==
// @name         小红书 · 原图批量下载 (ZIP打包)
// @namespace    xhs_zip_downloader
// @version      7.0
// @description  逆向原图返回原始分辨率JPEG。支持HEIC原图、预览选择、ZIP打包、并发下载、失败重试、懒加载、Esc关闭。
// @author       by 柚子
// @match        https://www.xiaohongshu.com/*
// @match        https://www.rednote.com/*
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

    const CONCURRENCY = 4;  // 并发下载数
    const RETRIES = 3;      // 每张重试次数

    GM_addStyle(`
        .xhs-dl-btn {
            display: inline-flex; align-items: center; justify-content: center;
            padding: 0 24px; height: 40px; width: 96px;
            background: rgb(255, 46, 77); color: #fff;
            border: none; border-radius: 100px;
            font-size: 16px; font-weight: 600; line-height: 1;
            white-space: nowrap; overflow: hidden; flex-shrink: 0;
            cursor: pointer; box-sizing: border-box;
            transition: opacity .2s ease, transform .15s ease;
        }
        .xhs-dl-btn:hover { opacity: .88; }
        .xhs-dl-btn:active { transform: scale(.96); }

        /* ===== 预览面板 ===== */
        .xhs-panel-overlay {
            position: fixed; inset: 0; z-index: 100001;
            background: rgba(0,0,0,0); backdrop-filter: blur(0px);
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
        .xhs-panel-overlay.show .xhs-panel {
            transform: scale(1) translateY(0); opacity: 1;
        }
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
        .xhs-format-group { display: flex; gap: 6px; }
        .xhs-format-btn {
            padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
            border: 1px solid #e0e0e0; background: #fff;
            color: #666; cursor: pointer; transition: all .15s;
        }
        .xhs-format-btn.active { background: #ff2442; border-color: #ff2442; color: #fff; }
        .xhs-format-btn:hover:not(.active) { border-color: #ff2442; color: #ff2442; }
        .xhs-select-all {
            padding: 6px 14px; border-radius: 8px; font-size: 13px;
            border: 1px solid #e0e0e0; background: #fff;
            color: #666; cursor: pointer; transition: all .15s;
        }
        .xhs-select-all:hover { border-color: #ff2442; color: #ff2442; }
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
            cursor: pointer; border: 2px solid transparent;
            transition: border-color .2s, transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease;
            background: #f5f5f5; aspect-ratio: 3/4;
        }
        .xhs-thumb-card.selected { border-color: #ff2442; }
        .xhs-thumb-card:hover {
            transform: scale(1.12) translateY(-4px);
            z-index: 10;
            box-shadow: 0 12px 32px rgba(0,0,0,0.2);
            border-color: rgba(255,36,66,0.4);
        }
        .xhs-thumb-card.selected:hover { border-color: #ff2442; }
        .xhs-thumb-card img {
            width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .xhs-thumb-checkbox {
            position: absolute; top: 6px; left: 6px; width: 22px; height: 22px;
            border-radius: 50%; border: 2px solid rgba(255,255,255,0.8);
            background: rgba(0,0,0,0.3); display: flex; align-items: center;
            justify-content: center; transition: all .15s;
        }
        .xhs-thumb-card.selected .xhs-thumb-checkbox {
            background: #ff2442; border-color: #ff2442;
        }
        .xhs-thumb-checkbox svg { width: 14px; height: 14px; opacity: 0; transition: opacity .15s; }
        .xhs-thumb-card.selected .xhs-thumb-checkbox svg { opacity: 1; }
        .xhs-thumb-info {
            position: absolute; bottom: 0; left: 0; right: 0;
            padding: 4px 8px; background: linear-gradient(transparent, rgba(0,0,0,0.7));
            color: #fff; font-size: 11px; font-family: monospace;
            display: flex; justify-content: space-between;
        }
        .xhs-thumb-loading {
            position: absolute; inset: 0; display: flex; align-items: center;
            justify-content: center; color: #666; font-size: 12px;
        }

        .xhs-panel-footer {
            display: flex; align-items: center; gap: 12px; flex-direction: column;
            padding: 16px 20px; border-top: 1px solid #f0f0f0;
        }
        .xhs-progress-bar-wrap {
            width: 100%; height: 6px; border-radius: 3px;
            background: #f0f0f0; overflow: hidden; display: none;
        }
        .xhs-progress-bar-wrap.show { display: block; }
        .xhs-progress-bar {
            height: 100%; width: 0%; border-radius: 3px;
            background: #ff2442; transition: width .2s ease;
        }
        .xhs-download-btn {
            width: 100%; padding: 12px; border-radius: 10px; font-size: 15px;
            font-weight: 600; border: none; background: #ff2442; color: #fff;
            cursor: pointer; transition: all .15s; display: flex; align-items: center;
            justify-content: center; gap: 8px;
        }
        .xhs-download-btn:hover { background: #e61f3a; }
        .xhs-download-btn:disabled { background: #ccc; cursor: not-allowed; }

        /* ===== Toast ===== */
        .xhs-dl-toast {
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            z-index: 100002; padding: 10px 24px;
            background: rgba(0,0,0,.82); color: #fff; border-radius: 12px;
            font-size: 14px; pointer-events: none; opacity: 0;
            transition: opacity .3s ease; backdrop-filter: blur(8px);
            text-align: center; max-width: 80vw;
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
        toastEl.textContent = msg; toastEl.classList.add('show');
        clearTimeout(toastEl._hide);
        toastEl._hide = setTimeout(() => toastEl.classList.remove('show'), d);
    }
    function log(...msgs) {
        console.log('[XHS]', ...msgs);
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // 获取笔记数据（多来源兜底，兼容 SPA 后状态丢失）
    function getNoteData() {
        const w = unsafeWindow || window;
        const id = location.pathname.split('/').pop();
        const state = w.__INITIAL_STATE__;
        // 1) 最常规路径
        if (state?.note?.noteDetailMap?.[id]?.note) {
            return state.note.noteDetailMap[id].note;
        }
        // 2) 弹窗/旧结构
        if (state?.noteData?.data?.noteData) {
            return state.noteData.data.noteData;
        }
        // 3) SPA 跳转后 __INITIAL_STATE__ 未更新：找当前 URL 匹配项
        if (state?.note?.noteDetailMap) {
            const entries = Object.entries(state.note.noteDetailMap);
            // 优先当前 id，找不到就取第一个有图笔记
            const hit = entries.find(([k, v]) => k === id && v?.note) || entries.find(([, v]) => v?.note);
            return hit?.[1]?.note || null;
        }
        return null;
    }

    // ★ 核心：ci.xiaohongshu.com 返回原始分辨率 JPEG
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

    // 带重试的抓取（指数退避）
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

    // 主抓取 + 备用：先原图，失败则直拉 CDN 缩略图 URL
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

    // 并发执行器：限制并发数
    async function mapLimit(items, limit, fn) {
        const results = new Array(items.length);
        let idx = 0;
        async function worker() {
            while (idx < items.length) {
                const cur = idx++;
                results[cur] = await fn(items[cur], cur);
            }
        }
        const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
        await Promise.all(workers);
        return results;
    }

    // 保存 blob 到本地
    function saveBlob(blob, filename) {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u; a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(u), 10000);
    }

    // 获取视频 URL
    function getVideoUrl(note) {
        if (!note?.video) return null;
        if (note.video.consumer?.originVideoKey)
            return `https://sns-video-bd.xhscdn.com/${note.video.consumer.originVideoKey}`;
        if (note.video.media?.stream) {
            const s = Object.values(note.video.media.stream).flat();
            s.sort((a, b) => (b.height || 0) - (a.height || 0));
            return s[0]?.backupUrls?.[0] || s[0]?.masterUrl || null;
        }
        return null;
    }

    // ===== 预览面板状态 =====
    let panelState = {
        format: 'jpg',
        selected: new Set(),
        note: null,
    };

    function createPanel(note) {
        document.querySelector('.xhs-panel-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'xhs-panel-overlay';

        const imgCount = note.imageList.length;
        const firstImg = note.imageList[0];
        const hasVideo = !!getVideoUrl(note);

        overlay.innerHTML = `
            <div class="xhs-panel">
                <div class="xhs-panel-header">
                    <div>
                        <div class="xhs-panel-title">${esc(note.title || '小红书笔记')}</div>
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
                    <span class="xhs-selected-count">已选 0 张</span>
                </div>
                <div class="xhs-panel-body"></div>
                <div class="xhs-panel-footer">
                    <div class="xhs-progress-bar-wrap">
                        <div class="xhs-progress-bar"></div>
                    </div>
                    <button class="xhs-download-btn" disabled>
                        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>
                        <span>下载选中图片</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const body = overlay.querySelector('.xhs-panel-body');
        const countEl = overlay.querySelector('.xhs-selected-count');
        const dlBtn = overlay.querySelector('.xhs-download-btn');
        const dlLabel = dlBtn.querySelector('span');
        const selectAllBtn = overlay.querySelector('.xhs-select-all');

        panelState.note = note;
        panelState.selected = new Set();
        panelState.format = 'jpg';

        // 生成缩略图卡片
        note.imageList.forEach((img, i) => {
            const card = document.createElement('div');
            card.className = 'xhs-thumb-card';
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
            imgEl.addEventListener('load', () => {
                imgEl.style.display = 'block';
                loadingEl.style.display = 'none';
            });
            imgEl.addEventListener('error', () => { loadingEl.textContent = '加载失败'; });

            if (thumbUrl) {
                imgEl.src = thumbUrl;
            } else {
                loadingEl.textContent = '无缩略图';
            }

            // 点击选中/取消
            card.addEventListener('click', (e) => {
                if (e.target.closest('.xhs-thumb-info')) return; // 点尺寸信息不触发
                if (panelState.selected.has(i)) {
                    panelState.selected.delete(i);
                    card.classList.remove('selected');
                } else {
                    panelState.selected.add(i);
                    card.classList.add('selected');
                }
                updateCount();
            });

            body.appendChild(card);
        });

        function updateCount() {
            const n = panelState.selected.size;
            countEl.textContent = `已选 ${n} 张`;
            dlBtn.disabled = n === 0;
            dlLabel.textContent = n > 0
                ? `下载 ${n} 张${panelState.format === 'heic' ? ' (HEIC)' : ''}`
                : '下载选中图片';
        }

        // 格式切换
        overlay.querySelectorAll('.xhs-format-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.xhs-format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                panelState.format = btn.dataset.fmt;
                updateCount();
            });
        });

        // 全选/取消
        selectAllBtn.addEventListener('click', () => {
            if (panelState.selected.size === note.imageList.length) {
                panelState.selected.clear();
                overlay.querySelectorAll('.xhs-thumb-card').forEach(c => c.classList.remove('selected'));
            } else {
                note.imageList.forEach((_, i) => panelState.selected.add(i));
                overlay.querySelectorAll('.xhs-thumb-card').forEach(c => c.classList.add('selected'));
            }
            updateCount();
        });

        // 关闭（带淡出动画）
        const closePanel = () => {
            overlay.classList.remove('show');
            document.removeEventListener('keydown', escHandler);
            setTimeout(() => overlay.remove(), 280);
        };
        overlay.querySelector('.xhs-panel-close').addEventListener('click', closePanel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

        // Esc 关闭
        function escHandler(e) { if (e.key === 'Escape') closePanel(); }
        document.addEventListener('keydown', escHandler);

        // 下载
        dlBtn.addEventListener('click', () => handleDownloadFromPanel(overlay));

        // 默认全选
        selectAllBtn.click();

        // 下一帧再添加 show 类，触发过渡动画
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
    }

    // 从面板下载 — 单张直接下载，多张并发打包ZIP
    async function handleDownloadFromPanel(overlay) {
        const note = panelState.note;
        if (!note) return;
        const indices = [...panelState.selected].sort((a, b) => a - b);
        if (indices.length === 0) return;

        const format = panelState.format;
        const dlBtn = overlay?.querySelector('.xhs-download-btn');
        const barWrap = overlay?.querySelector('.xhs-progress-bar-wrap');
        const bar = overlay?.querySelector('.xhs-progress-bar');
        if (dlBtn) dlBtn.disabled = true;

        const title = (note.title || document.title)
            .replace(/ - (小红书|RedNote)$/, '').trim() || '小红书_笔记';
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 80);
        const ext = format === 'heic' ? 'heic' : 'jpg';

        log(`📋 ${title}`);
        log(`🖼️ 选中 ${indices.length} 张 · 格式: ${format.toUpperCase()}`);

        // ===== 单张图片：直接下载，不打包（文件名带序号防覆盖）=====
        if (indices.length === 1) {
            const i = indices[0];
            const img = note.imageList[i];
            if (!img.fileId && !(img.urlDefault || img.urlPre)) {
                toast('❌ 无可用图片'); if (dlBtn) dlBtn.disabled = false; return;
            }
            toast(`📷 下载中...`);
            try {
                const blob = await fetchImageBlob(img, format);
                const name = `${safeTitle}_${String(i + 1).padStart(2, '0')}.${ext}`;
                saveBlob(blob, name);
                log(`✅ ${img.width}×${img.height} | ${(blob.size / 1024).toFixed(0)}KB (${format})`);
                toast(`✅ 已下载 ${name}`, 3000);
                // 下载成功 → 关闭面板（带淡出动画）
                overlay?.classList.remove('show');
                setTimeout(() => overlay?.remove(), 280);
            } catch (e) {
                log(`❌ 下载失败: ${e.message}`);
                toast('❌ 下载失败');
            }
            if (dlBtn) dlBtn.disabled = false;
            return;
        }

        // ===== 多张图片：并发下载 + 打包ZIP + 进度条 =====
        log('');
        barWrap?.classList.add('show');
        bar.style.width = '0%';

        // 并发抓取所有 blob
        const items = indices.map(i => ({ img: note.imageList[i], idx: i }));
        let doneCount = 0;
        const blobs = await mapLimit(items, CONCURRENCY, async ({ img, idx }) => {
            try {
                const blob = await fetchImageBlob(img, format);
                doneCount++;
                bar.style.width = `${Math.round(doneCount / items.length * 100)}%`;
                log(`✅ [${idx + 1}] ${img.width}×${img.height} | ${(blob.size / 1024).toFixed(0)}KB (${format})`);
                return { idx, blob, img };
            } catch (e) {
                doneCount++;
                bar.style.width = `${Math.round(doneCount / items.length * 100)}%`;
                log(`❌ [${idx + 1}] ${e.message}`);
                return null;
            }
        });

        const okItems = blobs.filter(Boolean);
        const ok = okItems.length;
        let totalSize = 0;

        const zip = new JSZip();
        for (const { idx, blob, img } of okItems) {
            const name = `${safeTitle}_${String(idx + 1).padStart(2, '0')}.${ext}`;
            zip.file(name, blob);
            totalSize += blob.size;
        }

        // 视频（如果有）
        const vUrl = getVideoUrl(note);
        if (vUrl) {
            toast('🎬 下载视频...');
            try {
                const resp = await fetch(vUrl);
                if (resp.ok) {
                    const blob = await resp.blob();
                    if (blob?.size > 1000) {
                        zip.file(`${safeTitle}_视频.mp4`, blob);
                        log(`✅ 视频 ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
                    }
                }
            } catch (e) { log(`⚠️ 视频: ${e.message}`); }
        }

        if (ok === 0) { toast('❌ 全部失败'); if (dlBtn) dlBtn.disabled = false; return; }

        toast(`📦 打包 ${ok} 张...`);
        bar.style.width = '95%';
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        saveBlob(zipBlob, `${safeTitle}.zip`);
        bar.style.width = '100%';
        log('');
        log(`✅ 完成! ${ok}张 | 总计 ${(totalSize / 1024 / 1024).toFixed(1)}MB | ZIP ${(zipBlob.size / 1024 / 1024).toFixed(1)}MB`);
        toast(`✅ ${ok}张${format === 'heic' ? 'HEIC' : '原图'} (${(zipBlob.size / 1024 / 1024).toFixed(1)}MB)`, 4000);
        if (dlBtn) dlBtn.disabled = false;
        setTimeout(() => { barWrap?.classList.remove('show'); bar.style.width = '0%'; }, 1500);

        // 关闭面板（带淡出动画）
        overlay?.classList.remove('show');
        setTimeout(() => overlay?.remove(), 280);
    }

    // 打开预览面板
    function openPanel() {
        const note = getNoteData();
        if (!note) { toast('❌ 无法获取笔记数据'); return; }
        if (!note.imageList?.length) { toast('❌ 未找到图片'); return; }
        createPanel(note);
    }

    // 按钮：插入到关注按钮左边，样式与关注按钮一致
    // 全局：找【可见的】关注按钮——多选择器 + 文字匹配，兼容弹窗模式
    function findVisibleFollow() {
        const selectors = [
            '.note-detail-follow-btn',
            '[class*="follow-btn"]',
            '[class*="FollowBtn"]',
            '[class*="follow_wrap"]',
            '[class*="FollowWrap"]',
            '[class*="author"] [class*="follow"]'
        ];
        for (const sel of selectors) {
            for (const fw of document.querySelectorAll(sel)) {
                if (fw.offsetParent !== null) return fw;
            }
        }
        for (const sel of selectors) {
            for (const fw of document.querySelectorAll(sel)) {
                const r = fw.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) return fw;
            }
        }
        for (const el of document.querySelectorAll('button, a')) {
            if (el.textContent.trim() === '关注' && el.offsetParent !== null) return el;
        }
        return null;
    }

    function createButton() {
        if (document.querySelector('.xhs-dl-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'xhs-dl-btn';
        btn.textContent = '下载';
        btn.addEventListener('click', openPanel);

        const followWrap = findVisibleFollow();
        if (!followWrap) {
            console.log('[小红书下载] ⚠️ 未找到关注按钮');
            return;
        }
        const authorWrapper = followWrap.parentElement;
        if (!authorWrapper) return;
        authorWrapper.insertBefore(btn, followWrap);
        console.log('[小红书下载] ✅ 下载按钮已插入');
    }

    // ===== 统一的按钮维护：MutationObserver（防抖）+ SPA 跳转清理 =====
    let moTimer = null;
    function scheduleCheck() {
        clearTimeout(moTimer);
        moTimer = setTimeout(() => {
            const followWrap = findVisibleFollow();
            if (!followWrap) return;
            const btn = document.querySelector('.xhs-dl-btn');
            // 按钮存在且在关注按钮旁边 → 不动
            if (btn && followWrap.parentElement?.querySelector('.xhs-dl-btn')) return;
            // 按钮不在 或 插错位置 → 移除重建
            btn?.remove();
            createButton();
        }, 200);
    }

    function cleanupPageState() {
        document.querySelector('.xhs-dl-btn')?.remove();
        document.querySelector('.xhs-panel-overlay')?.remove();
        toastEl?.remove(); toastEl = null;
    }

    function init() {
        // 始终建立 MutationObserver——无论当前 URL 是什么
        if (!window.__xhsDlObserver) {
            window.__xhsDlObserver = new MutationObserver(() => {
                if (!findVisibleFollow()) return; // 没关注按钮就不处理
                scheduleCheck();
            });
            window.__xhsDlObserver.observe(document.body, { childList: true, subtree: true });
        }

        // SPA 跳转：拦截 pushState/replaceState + popstate，比轮询高效
        const wrapHistory = (fn) => function (...args) {
            const r = fn.apply(this, args);
            setTimeout(() => {
                cleanupPageState();
                setTimeout(scheduleCheck, 300);
            }, 50);
            return r;
        };
        if (!window.__xhsDlWrappedHistory) {
            history.pushState = wrapHistory(history.pushState);
            history.replaceState = wrapHistory(history.replaceState);
            window.__xhsDlWrappedHistory = true;
        }
        if (!window.__xhsDlPopHandler) {
            window.__xhsDlPopHandler = () => {
                setTimeout(() => {
                    cleanupPageState();
                    setTimeout(scheduleCheck, 300);
                }, 50);
            };
            window.addEventListener('popstate', window.__xhsDlPopHandler);
        }

        // 初始尝试
        scheduleCheck();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    GM_registerMenuCommand('📥 打开下载面板', openPanel);
    console.log('[小红书下载] 🟢 v7.0 — 全量优化: 并发/重试/懒加载/Esc/进度条/SPA');
})();
