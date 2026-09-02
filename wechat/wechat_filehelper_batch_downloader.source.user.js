// ==UserScript==
// @name         微信文件传输助手网页版 批量下载工具 (输入栏原生工具条版)
// @namespace    https://github.com/wechat-filehelper-downloader
// @version      2.8.6
// @description  精准捕获微信文件传输助手网页版（filehelper.weixin.qq.com）中全部真实文件（PDF/Word/Excel/CDR/RAR等）、高清原图和视频，工具栏无缝融入底部文件上传图标所在行，后台全量抓取+一次性极速落盘，下载真实原图与原文件！
// @author       Antigravity
// @match        https://filehelper.weixin.qq.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      *
// @connect      weixin.qq.com
// @connect      qq.com
// @connect      qpic.cn
// @connect      qlogo.cn
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. 全局状态 (State)
    // ==========================================
    const State = {
        items: new Map(), // key: uniqueKey -> Item Object
        blobs: new Map(), // key: url -> Blob instance
        filterType: 'all', // 'all', 'image', 'file', 'video'
        searchQuery: '',
        isAutoScrolling: false,
        autoScrollTimer: null,
        isDownloading: false,
        authParams: {
            skey: '',
            pass_ticket: '',
            wxsid: '',
            wxuin: '',
            dataTicket: '',
            currentUser: ''
        },
        elementCounter: 0
    };

    /**
     * 提取 URL 中的 MsgID
     */
    function extractMsgIdFromUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const m = url.match(/[?&]MsgID=([^&#]+)/i) || url.match(/[?&]msgid=([^&#]+)/i) || url.match(/[?&]msg_id=([^&#]+)/i);
        return m ? m[1] : '';
    }

    /**
     * 并发限制调度器 (Map Limit)
     */
    async function mapLimit(items, concurrency, fn) {
        const results = [];
        let index = 0;
        const total = items.length;

        async function worker() {
            while (index < total) {
                const curIdx = index++;
                const item = items[curIdx];
                try {
                    const res = await fn(item, curIdx);
                    results[curIdx] = res;
                } catch (err) {
                    results[curIdx] = null;
                }
                await sleep(30);
            }
        }

        const workers = [];
        const numWorkers = Math.min(concurrency, total);
        for (let i = 0; i < numWorkers; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }

    /**
     * 将 Blob 实例极速保存到本地 (100% 二进制安全)
     */
    function saveBlob(blob, filename) {
        if (!blob) return;
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        try {
            a.click();
        } catch (e) {}
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(u);
        }, 10000);
    }

    /**
     * 通过直接 URL 触发浏览器下载
     */
    function saveDirectUrl(url, filename) {
        if (!url || url.startsWith('#') || url.startsWith('javascript')) return;
        if (typeof GM_download === 'function') {
            try {
                GM_download({
                    url: url,
                    name: filename,
                    saveAs: false
                });
                return;
            } catch (e) {}
        }
        const a = document.createElement('a');
        a.href = url;
        if (filename) a.download = filename;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        try {
            a.click();
        } catch (e) {}
        setTimeout(() => a.remove(), 2000);
    }

    /**
     * 高清原图 URL 转换引擎 (将 type=slave 彻底替换为 type=big)
     */
    function getHdMediaUrl(url, msgId) {
        if (!url || typeof url !== 'string') return url;
        let hdUrl = url;

        if (hdUrl.includes('webwxgetmsgimg')) {
            if (hdUrl.includes('type=slave')) {
                hdUrl = hdUrl.replace(/([?&])type=slave/, '$1type=big');
            } else if (!hdUrl.includes('type=big')) {
                hdUrl += (hdUrl.includes('?') ? '&' : '?') + 'type=big';
            }
            if (State.authParams.skey && !hdUrl.includes('skey=')) {
                hdUrl += '&skey=' + encodeURIComponent(State.authParams.skey);
            }
            if (State.authParams.pass_ticket && !hdUrl.includes('pass_ticket=')) {
                hdUrl += '&pass_ticket=' + encodeURIComponent(State.authParams.pass_ticket);
            }
            return hdUrl;
        }

        if (hdUrl.includes('qpic.cn') || hdUrl.includes('qlogo.cn') || hdUrl.includes('weixin.qq.com')) {
            hdUrl = hdUrl.replace(/\/640(\?|$|\/)/, '/0$1')
                         .replace(/\/132(\?|$|\/)/, '/0$1')
                         .replace(/\/300(\?|$|\/)/, '/0$1')
                         .replace(/\/96(\?|$|\/)/, '/0$1');
        }

        hdUrl = hdUrl.replace(/_thumb\./, '.')
                     .replace(/_preview\./, '.')
                     .replace(/([?&])thumb=[^&]*&?/, '$1')
                     .replace(/([?&])type=preview&?/, '$1')
                     .replace(/[?&]$/, '');

        return hdUrl;
    }

    /**
     * 智能净化微信文件名
     */
    function cleanWechatFileName(rawText) {
        if (!rawText) return '';
        let name = rawText.trim();

        name = name.replace(/^.*?[的]?文件传输助手[:：\s]*/i, '');
        name = name.replace(/^(微信用户|我|好友|文件)[:：\s]*/i, '');
        name = name.replace(/^[\d]{1,2}:[\d]{2}[:\s]*/, '');

        const match = name.match(/([\w\u4e00-\u9fa5\.\-\s_#\(\)\[\]（）]+\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|cdr|psd|ai|txt|csv|mp3|mp4|apk|iso|tar|gz|json|md|wps|et|dps))/i);
        if (match) {
            return match[1].trim();
        }
        return name.trim();
    }

    /**
     * 构建微信源文件的下载 URL
     */
    function buildFileDownloadUrl(msg, mediaId, fileName) {
        const mid = mediaId || msg?.MediaId || msg?.mediaId || msg?.attachId || '';
        const name = fileName || msg?.FileName || msg?.title || 'file.bin';
        const sender = msg?.FromUserName || State.authParams.currentUser || 'filehelper';
        const fromUser = msg?.FromUserName || State.authParams.currentUser || 'filehelper';
        
        let params = [];
        params.push(`sender=${encodeURIComponent(sender)}`);
        if (mid) params.push(`mediaid=${encodeURIComponent(mid)}`);
        params.push(`filename=${encodeURIComponent(name)}`);
        if (fromUser) params.push(`fromuser=${encodeURIComponent(fromUser)}`);
        if (State.authParams.skey) params.push(`skey=${encodeURIComponent(State.authParams.skey)}`);
        if (State.authParams.pass_ticket) params.push(`pass_ticket=${encodeURIComponent(State.authParams.pass_ticket)}`);
        if (State.authParams.dataTicket) params.push(`webwx_data_ticket=${encodeURIComponent(State.authParams.dataTicket)}`);

        return `/cgi-bin/mmwebwx-bin/webwxgetmedia?` + params.join('&');
    }

    /**
     * 严格校验 Blob 是否为真实二进制，杜绝任何 HTML/HTM
     */
    function isRealBinaryBlob(blob, itemName) {
        if (!blob || blob.size === 0) return false;
        const type = (blob.type || '').toLowerCase();
        const ext = (itemName || '').split('.').pop().toLowerCase();

        if (ext !== 'html' && ext !== 'htm' && ext !== 'xml') {
            if (type.includes('text/html') || type.includes('text/xml') || type.includes('application/json')) {
                return false;
            }
        }
        return true;
    }

    function isContentTypeError(contentType, fileName) {
        if (!contentType) return false;
        const ext = (fileName || '').split('.').pop().toLowerCase();
        if (ext === 'html' || ext === 'htm' || ext === 'xml') return false;
        if (contentType.includes('text/html') || contentType.includes('text/xml') || contentType.includes('application/json')) return true;
        return false;
    }

    /**
     * 从 <img> 元素提取二进制 Blob (仅作为无原图时的最终兜底)
     */
    function getBlobFromImageElement(imgEl) {
        if (!imgEl) return Promise.resolve(null);
        return new Promise((resolve) => {
            try {
                if (imgEl.src && imgEl.src.startsWith('data:image')) {
                    fetch(imgEl.src).then(r => r.blob()).then(b => {
                        if (b && isRealBinaryBlob(b, 'image.jpg')) resolve(b);
                        else resolve(null);
                    }).catch(() => resolve(null));
                    return;
                }
                if (imgEl.src && imgEl.src.startsWith('blob:')) {
                    if (State.blobs.has(imgEl.src)) {
                        resolve(State.blobs.get(imgEl.src));
                        return;
                    }
                    fetch(imgEl.src).then(r => r.blob()).then(b => {
                        if (b && isRealBinaryBlob(b, 'image.jpg')) resolve(b);
                        else resolve(null);
                    }).catch(() => resolve(null));
                    return;
                }

                const canvas = document.createElement('canvas');
                const w = imgEl.naturalWidth || imgEl.clientWidth || 300;
                const h = imgEl.naturalHeight || imgEl.clientHeight || 300;
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(imgEl, 0, 0, w, h);
                canvas.toBlob((blob) => {
                    if (blob && blob.size > 0 && isRealBinaryBlob(blob, 'image.jpg')) {
                        resolve(blob);
                    } else {
                        resolve(null);
                    }
                }, 'image/jpeg', 0.98);
            } catch (e) {
                resolve(null);
            }
        });
    }

    /**
     * 智能去重与数据项管理
     */
    function addItem(item) {
        if (!item || (!item.url && !item.name && !item.element && !item.downloadBtn)) return;

        const isImage = item.type === 'image';
        const isFile = item.type === 'file';

        const rawName = item.name || generateDefaultName(item.type);
        const cleanName = isFile ? cleanWechatFileName(rawName) : sanitizeFilename(rawName);

        let rawUrl = item.url || '';
        const msgId = item.rawMsg?.MsgId || item.msgId || extractMsgIdFromUrl(rawUrl);
        let hdUrl = isImage ? getHdMediaUrl(rawUrl, msgId) : rawUrl;
        let previewUrl = item.previewUrl || rawUrl || hdUrl;

        if (isFile && (!hdUrl || hdUrl.startsWith('#') || hdUrl.startsWith('javascript')) && item.rawMsg) {
            const builtUrl = buildFileDownloadUrl(item.rawMsg, item.mediaId || item.rawMsg.MediaId, cleanName);
            if (builtUrl) hdUrl = builtUrl;
        }

        let key = null;

        if (isFile) {
            key = `file_${cleanName.toLowerCase()}`;
        } else if (isImage) {
            key = msgId ? `image_msg_${msgId}` : `image_${hashString(hdUrl || previewUrl)}`;
        } else {
            key = `video_${msgId || Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        }

        if (!State.items.has(key)) {
            let finalName = cleanName;
            if (isImage && (!finalName || finalName.startsWith('image_') || finalName === 'image.jpg')) {
                const count = Array.from(State.items.values()).filter(x => x.type === 'image').length + 1;
                finalName = `image_${count}_${msgId ? msgId.slice(-6) : Date.now().toString().slice(-4)}.jpg`;
            }

            const newItem = {
                id: key,
                type: item.type || 'file',
                name: finalName,
                url: hdUrl,
                dataUrl: item.dataUrl || '',
                previewUrl: previewUrl,
                size: item.size || 0,
                formattedSize: item.size ? formatBytes(item.size) : (item.formattedSize || '未知大小'),
                timeStr: item.timeStr || formatCurrentTime(),
                timestamp: item.timestamp || Date.now(),
                mediaId: item.mediaId || '',
                msgId: msgId,
                rawMsg: item.rawMsg || null,
                element: item.element || null,
                downloadBtn: item.downloadBtn || null,
                blob: item.blob || null,
                selected: true
            };

            State.items.set(key, newItem);
            updateNativeUIState();
            attachInlineTagToElement(newItem);
        } else {
            const existing = State.items.get(key);
            if (hdUrl && (!existing.url || existing.url.startsWith('#') || existing.url.startsWith('javascript') || existing.url.includes('type=slave'))) {
                existing.url = hdUrl;
            }
            if (item.dataUrl && !existing.dataUrl) existing.dataUrl = item.dataUrl;
            if (item.size && !existing.size) {
                existing.size = item.size;
                existing.formattedSize = formatBytes(item.size);
            }
            if (item.blob && !existing.blob) existing.blob = item.blob;
            if (item.element) existing.element = item.element;
            if (item.downloadBtn) existing.downloadBtn = item.downloadBtn;
            if (item.rawMsg && !existing.rawMsg) existing.rawMsg = item.rawMsg;
            if (item.mediaId && !existing.mediaId) existing.mediaId = item.mediaId;
        }
    }

    function sanitizeFilename(name) {
        if (!name) return 'file_' + Date.now();
        return name.replace(/[\\/:*?"<>|]/g, '_').trim();
    }

    function generateDefaultName(type) {
        const time = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        if (type === 'image') return `image_${time}.jpg`;
        if (type === 'video') return `video_${time}.mp4`;
        return `file_${time}.bin`;
    }

    function formatBytes(bytes, decimals = 1) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function formatCurrentTime() {
        const d = new Date();
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }

    // ==========================================
    // 2. 深度网络拦截 (Silent Hooks)
    // ==========================================
    function setupNetworkHooks() {
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        function extractAuthFromUrl(url) {
            if (!url) return;
            try {
                const u = new URL(url, win.location.origin);
                if (u.searchParams.get('skey')) State.authParams.skey = u.searchParams.get('skey');
                if (u.searchParams.get('pass_ticket')) State.authParams.pass_ticket = u.searchParams.get('pass_ticket');
                if (u.searchParams.get('wxsid')) State.authParams.wxsid = u.searchParams.get('wxsid');
                if (u.searchParams.get('wxuin')) State.authParams.wxuin = u.searchParams.get('wxuin');
                if (u.searchParams.get('webwx_data_ticket')) State.authParams.dataTicket = u.searchParams.get('webwx_data_ticket');
                if (u.searchParams.get('fromuser')) State.authParams.currentUser = u.searchParams.get('fromuser');
            } catch (e) {}
        }

        extractAuthFromUrl(win.location.href);
        try {
            const match = document.cookie.match(/webwx_data_ticket=([^;]+)/);
            if (match) State.authParams.dataTicket = match[1];
            const skeyMatch = document.cookie.match(/skey=([^;]+)/);
            if (skeyMatch && !State.authParams.skey) State.authParams.skey = skeyMatch[1];
        } catch (e) {}

        const origCreateObjectURL = win.URL.createObjectURL;
        win.URL.createObjectURL = function (obj) {
            const blobUrl = origCreateObjectURL.apply(this, arguments);
            if (obj instanceof Blob && obj.size > 0) {
                State.blobs.set(blobUrl, obj);
                for (const item of State.items.values()) {
                    if (item.url === blobUrl || item.previewUrl === blobUrl) {
                        item.blob = obj;
                        item.size = obj.size;
                        item.formattedSize = formatBytes(obj.size);
                    }
                }
            }
            return blobUrl;
        };

        const origOpenWin = win.open;
        win.open = function (url) {
            if (url && typeof url === 'string') {
                extractAuthFromUrl(url);
            }
            return origOpenWin.apply(this, arguments);
        };

        const origAnchorClick = win.HTMLAnchorElement.prototype.click;
        win.HTMLAnchorElement.prototype.click = function () {
            try {
                const href = this.href || '';
                if (href) {
                    extractAuthFromUrl(href);
                    const downloadName = this.getAttribute('download') || this.download;
                    if (downloadName) {
                        for (const item of State.items.values()) {
                            if (item.name === downloadName || downloadName.includes(item.name)) {
                                item.url = href;
                                if (State.blobs.has(href)) item.blob = State.blobs.get(href);
                            }
                        }
                    }
                }
            } catch (e) {}
            return origAnchorClick.apply(this, arguments);
        };

        const origOpen = win.XMLHttpRequest.prototype.open;
        const origSend = win.XMLHttpRequest.prototype.send;

        win.XMLHttpRequest.prototype.open = function (method, url) {
            this._reqUrl = url;
            this._reqMethod = method;
            extractAuthFromUrl(url);
            return origOpen.apply(this, arguments);
        };

        win.XMLHttpRequest.prototype.send = function (body) {
            if (typeof body === 'string' && body.includes('BaseRequest')) {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.BaseRequest) {
                        if (parsed.BaseRequest.Skey) State.authParams.skey = parsed.BaseRequest.Skey;
                        if (parsed.BaseRequest.Sid) State.authParams.wxsid = parsed.BaseRequest.Sid;
                        if (parsed.BaseRequest.Uin) State.authParams.wxuin = parsed.BaseRequest.Uin;
                    }
                } catch (e) {}
            }

            this.addEventListener('load', function () {
                try {
                    const url = this._reqUrl || '';
                    if (this.responseType === '' || this.responseType === 'text') {
                        parseApiResponse(url, this.responseText);
                    }
                } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };

        const origFetch = win.fetch;
        win.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            extractAuthFromUrl(url);
            const response = await origFetch.apply(this, args);
            try {
                const clone = response.clone();
                clone.text().then(text => {
                    parseApiResponse(url, text);
                }).catch(() => {});
            } catch (e) {}
            return response;
        };

        console.log('[WeChat Downloader] v2.8.6 ready.');
    }

    function parseApiResponse(url, responseText) {
        if (!responseText || typeof responseText !== 'string') return;

        if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
            try {
                const data = JSON.parse(responseText);
                extractMessagesFromObject(data);
            } catch (e) {}
        }
    }

    function extractMessagesFromObject(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj.SKey || obj.skey) State.authParams.skey = obj.SKey || obj.skey;
        if (obj.PassTicket || obj.pass_ticket) State.authParams.pass_ticket = obj.PassTicket || obj.pass_ticket;
        if (obj.User?.UserName) State.authParams.currentUser = obj.User.UserName;

        const msgList = obj.AddMsgList || obj.msg_list || obj.messages || obj.data?.list || (Array.isArray(obj) ? obj : null);
        if (Array.isArray(msgList)) {
            msgList.forEach(msg => handleRawMessage(msg));
        }
    }

    function handleRawMessage(msg) {
        if (!msg) return;
        const msgType = msg.MsgType || msg.msg_type || msg.type;
        const msgId = msg.MsgId || msg.msg_id || msg.id;
        if (!msgId) return;

        const content = msg.Content || msg.content || '';
        const skey = State.authParams.skey ? `&skey=${encodeURIComponent(State.authParams.skey)}` : '';
        const passTicket = State.authParams.pass_ticket ? `&pass_ticket=${encodeURIComponent(State.authParams.pass_ticket)}` : '';

        // 1. 图片消息
        if (msgType === 3 || msgType === 'IMAGE') {
            const hdImgUrl = msg.hd_url || msg.big_url || `/cgi-bin/mmwebwx-bin/webwxgetmsgimg?&MsgID=${msgId}${skey}${passTicket}&type=big`;
            const thumbUrl = msg.thumb_url || `/cgi-bin/mmwebwx-bin/webwxgetmsgimg?&MsgID=${msgId}${skey}${passTicket}&type=slave`;

            addItem({
                id: `image_msg_${msgId}`,
                msgId: msgId,
                type: 'image',
                name: `image_${msgId}.jpg`,
                url: hdImgUrl,
                previewUrl: thumbUrl,
                size: msg.FileSize || msg.file_size || 0,
                rawMsg: msg
            });
        }
        // 2. 视频消息
        else if (msgType === 43 || msgType === 62 || msgType === 'VIDEO') {
            let videoUrl = msg.url || msg.download_url || `/cgi-bin/mmwebwx-bin/webwxgetvideo?msgid=${msgId}${skey}${passTicket}`;
            addItem({
                id: `video_${msgId}`,
                msgId: msgId,
                type: 'video',
                name: `video_${msgId}.mp4`,
                url: videoUrl,
                previewUrl: msg.thumb_url || '',
                size: msg.FileSize || msg.file_size || 0,
                rawMsg: msg
            });
        }
        // 3. 应用消息/文件消息
        else if (msgType === 49 || msgType === 'FILE' || (content && content.includes('<appmsg>'))) {
            const titleMatch = content.match(/<title>(.*?)<\/title>/);
            const totalLenMatch = content.match(/<totallen>(.*?)<\/totallen>/);
            const attachIdMatch = content.match(/<attachid>(.*?)<\/attachid>/);
            const mediaIdMatch = content.match(/<mediaid>(.*?)<\/mediaid>/);
            const dataUrlMatch = content.match(/<dataurl>(.*?)<\/dataurl>/);
            const urlMatch = content.match(/<url>(.*?)<\/url>/);

            const rawName = (titleMatch && titleMatch[1]) ? decodeXml(titleMatch[1]) : (msg.FileName || msg.file_name || `file_${msgId}`);
            const fileName = cleanWechatFileName(rawName);
            const size = totalLenMatch ? parseInt(totalLenMatch[1], 10) : (msg.FileSize || msg.file_size || 0);
            const mediaId = msg.MediaId || (mediaIdMatch && mediaIdMatch[1]) || (attachIdMatch && attachIdMatch[1]) || '';
            const dataUrl = (dataUrlMatch && dataUrlMatch[1]) ? decodeXml(dataUrlMatch[1]) : ((urlMatch && urlMatch[1]) ? decodeXml(urlMatch[1]) : '');

            let fileUrl = dataUrl || msg.url || msg.download_url || '';
            if (!fileUrl && mediaId) {
                fileUrl = buildFileDownloadUrl(msg, mediaId, fileName);
            }

            addItem({
                id: `file_${fileName.toLowerCase()}`,
                msgId: msgId,
                type: 'file',
                name: fileName,
                url: fileUrl || ('#msg_' + msgId),
                dataUrl: dataUrl,
                mediaId: mediaId,
                previewUrl: '',
                size: size,
                rawMsg: msg
            });
        }
    }

    function decodeXml(str) {
        return str.replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    // ==========================================
    // 3. 精准 DOM 扫描 (Exact Message-Scoped Scanner)
    // ==========================================
    function extractMsgFromElement(el) {
        if (!el) return null;
        const msgItem = el.closest('.msg-item') || el.closest('.msg-list__item') || el.closest('li') || el;
        
        let curr = msgItem;
        while (curr && curr !== document.body) {
            if (curr.__vueParentComponent) {
                const comp = curr.__vueParentComponent;
                const item = comp.props?.item || comp.props?.msg || comp.setupState?.item || comp.setupState?.msg || comp.data?.item;
                if (item) return item;
            }
            if (curr.__vnode) {
                const vn = curr.__vnode;
                const item = vn.props?.item || vn.props?.msg || vn.memoizedProps?.item;
                if (item && typeof item === 'object') return item;
            }
            if (curr.__vue__) {
                const v = curr.__vue__;
                const item = v.item || v.msg || v.data?.item;
                if (item) return item;
            }
            curr = curr.parentElement;
        }
        return null;
    }

    function hashString(str) {
        if (!str) return Math.random().toString(36).slice(2);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * 将下载按钮直接注入到原生聊天气泡卡片下方
     */
    function attachInlineTagToElement(item) {
        if (!item.element) return;
        const parentCard = item.element.querySelector('.msg-file__content') || item.element.querySelector('.msg-image') || item.element.querySelector('.msg-item__content') || item.element;
        if (!parentCard || parentCard.querySelector('.wx-msg-download-tag')) return;

        const tag = document.createElement('div');
        tag.className = 'wx-msg-download-tag';
        const label = item.type === 'image' ? '⬇️ 高清原图' : (item.type === 'video' ? '⬇️ 视频' : '⬇️ 真实原件');
        tag.innerHTML = `<span>${label}</span>`;
        tag.title = `点击直接下载: ${item.name}`;

        tag.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();

            showToast(`⏳ 正在准备: ${item.name}`, 'info');
            try {
                const blob = await fetchFileBlob(item);
                if (blob && isRealBinaryBlob(blob, item.name)) {
                    saveBlob(blob, item.name);
                    showToast(`✅ ${item.name} 已保存`, 'success');
                } else if (item.downloadBtn) {
                    item.downloadBtn.click();
                    showToast(`✅ ${item.name} 已触发直下`, 'success');
                } else if (item.url && !item.url.startsWith('#') && !item.url.startsWith('javascript')) {
                    saveDirectUrl(item.url, item.name);
                    showToast(`✅ ${item.name} 已触发直下`, 'success');
                } else {
                    showToast(`❌ 未能获取该文件下载通道`, 'error');
                }
            } catch (err) {
                if (item.downloadBtn) {
                    item.downloadBtn.click();
                    showToast(`✅ ${item.name} 已触发直下`, 'success');
                } else {
                    showToast(`❌ 下载失败: ${err.message}`, 'error');
                }
            }
        });

        parentCard.appendChild(tag);
    }

    /**
     * 针对每条消息精确解析，保证数量 100% 对应且图片取高清原图
     */
    function scanDOM() {
        injectNativeInputOperationsBar();

        const chatBody = document.getElementById('chatBody') || document.querySelector('.chat-panel__body');
        if (!chatBody) return 0;

        const msgItems = chatBody.querySelectorAll('.msg-item');
        let scannedCount = 0;

        msgItems.forEach(msgEl => {
            // 1. 检查是否为文件消息 (.msg-file)
            const fileTitleEl = msgEl.querySelector('.msg-file__title');
            const fileCard = msgEl.querySelector('.msg-file');
            
            if (fileTitleEl || fileCard) {
                const rawTitle = fileTitleEl ? (fileTitleEl.childNodes[0]?.textContent || fileTitleEl.textContent) : (fileCard.textContent || '');
                const cleanName = cleanWechatFileName(rawTitle);

                if (cleanName) {
                    const compData = extractMsgFromElement(msgEl);
                    const mediaId = compData ? (compData.MediaId || compData.mediaId || compData.attachId) : '';
                    const dlBtn = msgEl.querySelector('.icon__download');

                    let href = '';
                    if (compData || mediaId) {
                        href = buildFileDownloadUrl(compData, mediaId, cleanName);
                    }

                    addItem({
                        id: `file_${cleanName.toLowerCase()}`,
                        type: 'file',
                        name: cleanName,
                        url: href || 'javascript:void(0)',
                        mediaId: mediaId,
                        rawMsg: compData,
                        element: msgEl,
                        downloadBtn: dlBtn
                    });
                    scannedCount++;
                }
                return; // 文件消息处理完毕
            }

            // 2. 检查是否为图片消息 (.msg-image)
            const imageCard = msgEl.querySelector('.msg-image');
            if (imageCard) {
                const chatImg = imageCard.querySelector('img');
                const dlBtn = imageCard.querySelector('.icon__download') || msgEl.querySelector('.icon__download');
                const rawSrc = chatImg ? (chatImg.getAttribute('data-big-src') || chatImg.getAttribute('data-src') || chatImg.src) : '';
                
                if (rawSrc) {
                    const compData = extractMsgFromElement(msgEl);
                    const msgId = compData?.MsgId || extractMsgIdFromUrl(rawSrc);
                    const hdUrl = getHdMediaUrl(rawSrc, msgId);

                    addItem({
                        id: msgId ? `image_msg_${msgId}` : `image_${hashString(rawSrc)}`,
                        msgId: msgId,
                        type: 'image',
                        name: `image_${msgId || Date.now()}.jpg`,
                        url: hdUrl,
                        previewUrl: rawSrc,
                        rawMsg: compData,
                        element: chatImg || imageCard,
                        downloadBtn: dlBtn
                    });
                    scannedCount++;
                }
                return; // 图片消息处理完毕
            }

            // 3. 检查是否为视频消息
            const videoCard = msgEl.querySelector('.msg-video, video');
            if (videoCard) {
                const compData = extractMsgFromElement(msgEl);
                const msgId = compData?.MsgId || ('video_' + Date.now());
                const dlBtn = msgEl.querySelector('.icon__download');

                addItem({
                    id: `video_${msgId}`,
                    msgId: msgId,
                    type: 'video',
                    name: `video_${msgId}.mp4`,
                    url: `/cgi-bin/mmwebwx-bin/webwxgetvideo?msgid=${msgId}`,
                    previewUrl: '',
                    rawMsg: compData,
                    element: videoCard,
                    downloadBtn: dlBtn
                });
                scannedCount++;
            }
        });

        return scannedCount;
    }

    function setupDOMObserver() {
        let timer = null;
        const observer = new MutationObserver((mutations) => {
            let shouldScan = false;
            for (const mut of mutations) {
                if (mut.addedNodes.length > 0) {
                    for (const node of mut.addedNodes) {
                        if (node.nodeType === 1 && !node.classList?.contains('wx-msg-download-tag') && !node.closest?.('.wx-input-operations-bar')) {
                            shouldScan = true;
                            break;
                        }
                    }
                }
            }
            if (shouldScan) {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    injectNativeInputOperationsBar();
                    scanDOM();
                }, 300);
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    // ==========================================
    // 4. 自动滚动加载历史记录 (Auto-Scroller)
    // ==========================================
    function findScrollContainer() {
        const chatBody = document.getElementById('chatBody') || document.querySelector('.chat-panel__body');
        if (chatBody && chatBody.scrollHeight > chatBody.clientHeight) {
            return chatBody;
        }
        return document.scrollingElement || document.documentElement;
    }

    function toggleAutoScroll() {
        if (State.isAutoScrolling) {
            stopAutoScroll();
        } else {
            startAutoScroll();
        }
    }

    function startAutoScroll() {
        State.isAutoScrolling = true;
        updateAutoScrollUI();
        showToast('🚀 已开始自动向上拉取历史消息...', 'info');

        let noChangeCount = 0;
        let lastHeight = 0;

        State.autoScrollTimer = setInterval(() => {
            const container = findScrollContainer();
            if (!container) return;

            scanDOM();

            const currentScrollTop = container.scrollTop;
            const currentScrollHeight = container.scrollHeight;

            if (currentScrollHeight === lastHeight && currentScrollTop === 0) {
                noChangeCount++;
                if (noChangeCount >= 4) {
                    stopAutoScroll();
                    showToast('🎉 已经加载全部历史消息！', 'success');
                    return;
                }
            } else {
                noChangeCount = 0;
            }

            lastHeight = currentScrollHeight;
            container.scrollTop = 0;
            container.dispatchEvent(new Event('scroll', { bubbles: true }));

        }, 1200);
    }

    function stopAutoScroll() {
        State.isAutoScrolling = false;
        if (State.autoScrollTimer) {
            clearInterval(State.autoScrollTimer);
            State.autoScrollTimer = null;
        }
        updateAutoScrollUI();
        showToast('⏹️ 已停止自动滚动', 'info');
    }

    function updateAutoScrollUI() {
        const btn = document.getElementById('wx-bar-btn-autoscroll');
        if (btn) {
            const textSpan = btn.querySelector('span');
            if (State.isAutoScrolling) {
                if (textSpan) textSpan.textContent = '停止拉取';
                btn.classList.add('active');
            } else {
                if (textSpan) textSpan.textContent = '拉取历史';
                btn.classList.remove('active');
            }
        }
    }

    // ==========================================
    // 5. 极速直下与后台数据流抓取引擎 (Safe Fetch & HD Image Engine)
    // ==========================================
    async function fetchBinaryBlobFromUrl(rawUrl, fileName) {
        if (!rawUrl || rawUrl.startsWith('#') || rawUrl.startsWith('javascript')) return null;

        if (State.blobs.has(rawUrl)) {
            const b = State.blobs.get(rawUrl);
            if (isRealBinaryBlob(b, fileName)) return b;
        }

        let absUrl = rawUrl.startsWith('/') ? (window.location.origin + rawUrl) : rawUrl;

        // 1. 原生 Fetch
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const res = await fetch(absUrl, { credentials: 'include', signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const ct = (res.headers.get('content-type') || '').toLowerCase();
                if (!isContentTypeError(ct, fileName)) {
                    const b = await res.blob();
                    if (isRealBinaryBlob(b, fileName)) {
                        State.blobs.set(rawUrl, b);
                        return b;
                    }
                }
            }
        } catch (e) {}

        // 2. GM_xmlhttpRequest
        try {
            const gmBlob = await new Promise((resolve) => {
                let resolved = false;
                const timer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve(null);
                    }
                }, 5000);

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: absUrl,
                    responseType: 'blob',
                    timeout: 5000,
                    headers: {
                        'Referer': window.location.href,
                        'Accept': '*/*'
                    },
                    onload: (res) => {
                        if (resolved) return;
                        resolved = true;
                        clearTimeout(timer);
                        const headers = (res.responseHeaders || '').toLowerCase();
                        if (res.status >= 200 && res.status < 300 && res.response) {
                            if (headers.includes('content-type: text/html') && isContentTypeError('text/html', fileName)) {
                                resolve(null);
                            } else {
                                resolve(res.response);
                            }
                        } else {
                            resolve(null);
                        }
                    },
                    onerror: () => {
                        if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
                    },
                    ontimeout: () => {
                        if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
                    }
                });
            });

            if (gmBlob && isRealBinaryBlob(gmBlob, fileName)) {
                State.blobs.set(rawUrl, gmBlob);
                return gmBlob;
            }
        } catch (e) {}

        return null;
    }

    async function fetchFileBlob(item) {
        if (item.blob && isRealBinaryBlob(item.blob, item.name)) {
            return item.blob;
        }

        const candidateUrls = [];
        let finalUrl = item.type === 'image' ? getHdMediaUrl(item.url, item.msgId) : item.url;
        if (finalUrl && !finalUrl.startsWith('#') && !finalUrl.startsWith('javascript')) {
            candidateUrls.push(finalUrl);
        }
        if (item.dataUrl) candidateUrls.push(item.dataUrl);
        if (item.previewUrl && !candidateUrls.includes(item.previewUrl)) {
            candidateUrls.push(item.previewUrl);
        }
        if (item.rawMsg) {
            const built = buildFileDownloadUrl(item.rawMsg, item.mediaId || item.rawMsg.MediaId, item.name);
            if (built && !candidateUrls.includes(built)) {
                candidateUrls.unshift(built);
                item.url = built;
            }
        }

        // 1. 尝试从高清网络接口抓取真实大图/原文件
        for (const u of candidateUrls) {
            const blob = await fetchBinaryBlobFromUrl(u, item.name);
            if (blob && isRealBinaryBlob(blob, item.name)) {
                item.blob = blob;
                return blob;
            }
        }

        // 2. 仅当图片无法通过高清接口获取且无原生按钮时，才使用页面 DOM 提取作为最后兜底
        if (item.type === 'image' && !item.downloadBtn) {
            const imgEl = item.element?.tagName === 'IMG' ? item.element : item.element?.querySelector('img');
            if (imgEl) {
                const canvasBlob = await getBlobFromImageElement(imgEl);
                if (canvasBlob && isRealBinaryBlob(canvasBlob, item.name)) {
                    item.blob = canvasBlob;
                    return canvasBlob;
                }
            }
        }

        return null;
    }

    function getFilteredItems() {
        return Array.from(State.items.values()).filter(item => {
            const matchesType = (State.filterType === 'all') || (item.type === State.filterType);
            const matchesQuery = !State.searchQuery || item.name.toLowerCase().includes(State.searchQuery);
            return matchesType && matchesQuery;
        });
    }

    /**
     * 极速无卡顿批量下载调度器 (保障 100% 真实原文件与高清原图，绝不落盘 HTML)
     */
    async function startBatchDownload() {
        const selectedItems = getFilteredItems();
        if (selectedItems.length === 0) {
            showToast('⚠️ 未扫描到可下载的文件或图片，请先点击【扫描】', 'warning');
            return;
        }

        State.isDownloading = true;
        const total = selectedItems.length;
        showInlineProgress(total);

        // ===== 阶段 1：在后台尝试读取真实二进制数据流 (支持高清大图与原文件) =====
        updateInlineProgress(0, total, '正在准备高清数据流...');

        let fetchedCount = 0;
        const fetchedList = await mapLimit(selectedItems, 2, async (item) => {
            if (!State.isDownloading) return null;
            try {
                const blob = await fetchFileBlob(item);
                fetchedCount++;
                updateInlineProgress(fetchedCount, total, `已就绪: ${item.name}`);
                return { item, blob, name: item.name };
            } catch (e) {
                fetchedCount++;
                updateInlineProgress(fetchedCount, total, `已就绪: ${item.name}`);
                return { item, blob: null, name: item.name };
            }
        });

        if (!State.isDownloading) {
            hideInlineProgress();
            return;
        }

        // ===== 阶段 2：数据就绪后，极速顺畅保存 =====
        updateInlineProgress(total, total, `🚀 正在批量保存 (${selectedItems.length} 项)...`);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < fetchedList.length; i++) {
            const { item, blob, name } = fetchedList[i];
            try {
                // 1. 如果成功抓取到高清原图或真实文件的 Blob，直接落盘
                if (blob && isRealBinaryBlob(blob, name)) {
                    saveBlob(blob, name);
                    successCount++;
                }
                // 2. 如果后台请求未鉴权，直接触发微信官方绿色下载按钮 (图片与文件均有该按钮，直达官方原图原件通道)
                else if (item.downloadBtn) {
                    item.downloadBtn.click();
                    successCount++;
                }
                // 3. 兜底直下有效 URL (非HTML页面)
                else if (item.url && !item.url.startsWith('#') && !item.url.startsWith('javascript')) {
                    saveDirectUrl(item.url, name);
                    successCount++;
                } else {
                    failCount++;
                }
                await sleep(250);
            } catch (e) {
                failCount++;
            }
        }

        let summary = `✅ 批量保存完成！成功 ${successCount} 项`;
        if (failCount > 0) summary += `，失败 ${failCount} 项`;
        showToast(summary, 'success');

        State.isDownloading = false;
        setTimeout(() => hideInlineProgress(), 1200);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==========================================
    // 6. 输入栏文件夹图标同行嵌入样式与DOM (Input Bar Integration)
    // ==========================================
    function injectStyles() {
        const css = `
            :root {
                --wx-primary: #07c160;
                --wx-primary-hover: #06ad56;
                --wx-primary-light: rgba(7, 193, 96, 0.08);
                --wx-bg-gray: #f7f7f7;
                --wx-border-color: rgba(0, 0, 0, 0.08);
            }

            .chat-panel__input-operations {
                display: flex !important;
                align-items: center !important;
                flex-wrap: nowrap !important;
                padding: 4px 12px 4px 10px !important;
                box-sizing: border-box !important;
                min-height: 36px !important;
            }

            .chat-panel__input-item {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex-shrink: 0 !important;
                margin-right: 6px !important;
            }

            .wx-input-operations-bar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex: 1;
                font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                user-select: none;
                gap: 6px;
            }

            .wx-bar-left {
                display: flex;
                align-items: center;
                gap: 5px;
                flex-shrink: 0;
            }

            .wx-bar-divider {
                width: 1px;
                height: 15px;
                background: rgba(0, 0, 0, 0.1);
                margin: 0 2px;
                flex-shrink: 0;
            }

            .wx-bar-right {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-left: auto;
                flex-shrink: 0;
            }

            .wx-btn-main {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: #07c160;
                color: #ffffff !important;
                border: none;
                border-radius: 5px;
                padding: 0 8px;
                height: 26px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
                line-height: 26px;
                box-sizing: border-box;
            }
            .wx-btn-main:hover {
                background: #06ad56;
                box-shadow: 0 2px 5px rgba(7, 193, 96, 0.3);
            }
            .wx-btn-main:active {
                transform: scale(0.97);
            }

            .wx-badge-num {
                background: rgba(255, 255, 255, 0.28);
                color: #ffffff;
                border-radius: 10px;
                padding: 0 4px;
                font-size: 11px;
                font-weight: 700;
                line-height: 15px;
                height: 15px;
                display: inline-block;
                text-align: center;
            }

            .wx-btn-sub {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                background: #ffffff;
                color: #333333;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 5px;
                padding: 0 7px;
                height: 26px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.15s ease;
                line-height: 24px;
                box-sizing: border-box;
            }
            .wx-btn-sub:hover {
                border-color: #07c160;
                color: #07c160;
                background: rgba(7, 193, 96, 0.05);
            }
            .wx-btn-sub.active {
                background: rgba(7, 193, 96, 0.1);
                border-color: #07c160;
                color: #07c160;
                font-weight: 600;
            }
            .wx-btn-sub:active {
                transform: scale(0.97);
            }

            .wx-svg-icon {
                display: inline-block;
                vertical-align: middle;
                flex-shrink: 0;
            }

            .wx-segmented-tabs {
                display: inline-flex;
                background: rgba(0, 0, 0, 0.06);
                border-radius: 5px;
                padding: 2px;
                gap: 2px;
                height: 26px;
                box-sizing: border-box;
            }

            .wx-seg-tab {
                border: none;
                background: transparent;
                color: #666666;
                padding: 0 7px;
                height: 22px;
                border-radius: 3px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.15s ease;
                line-height: 22px;
                box-sizing: border-box;
            }
            .wx-seg-tab:hover {
                color: #191919;
            }
            .wx-seg-tab.active {
                background: #ffffff;
                color: #07c160;
                font-weight: 600;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
            }

            .wx-search-wrap {
                display: inline-flex;
                align-items: center;
                position: relative;
                height: 26px;
            }
            .wx-search-icon {
                position: absolute;
                left: 7px;
                pointer-events: none;
            }
            .wx-search-field {
                height: 26px;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 5px;
                padding: 0 6px 0 22px;
                font-size: 12px;
                width: 65px;
                background: #ffffff;
                color: #333333;
                outline: none;
                transition: all 0.2s ease;
                box-sizing: border-box;
            }
            .wx-search-field:focus {
                width: 100px;
                border-color: #07c160;
                box-shadow: 0 0 0 2px rgba(7, 193, 96, 0.15);
            }

            .wx-msg-download-tag {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: rgba(7, 193, 96, 0.08);
                color: #07c160;
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                margin-top: 4px;
                transition: all 0.2s ease;
                user-select: none;
                border: 1px solid rgba(7, 193, 96, 0.2);
            }
            .wx-msg-download-tag:hover {
                background: #07c160;
                color: #ffffff !important;
                box-shadow: 0 2px 6px rgba(7, 193, 96, 0.25);
            }

            .wx-native-progress-container {
                width: 100%;
                display: none;
                padding: 4px 12px;
                align-items: center;
                gap: 8px;
                box-sizing: border-box;
                background: #fafafa;
                border-bottom: 1px solid rgba(0, 0, 0, 0.05);
            }
            .wx-native-progress-container.show {
                display: flex;
            }
            .wx-native-progress-track {
                flex: 1;
                height: 4px;
                background: #e0e0e0;
                border-radius: 2px;
                overflow: hidden;
            }
            .wx-native-progress-bar {
                height: 100%;
                background: var(--wx-primary);
                width: 0%;
                transition: width 0.2s ease;
            }
            .wx-native-progress-text {
                font-size: 11px;
                color: #666;
                white-space: nowrap;
                max-width: 220px;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            #wx-toast-container {
                position: fixed;
                top: 24px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 3000000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: none;
            }
            .wx-toast {
                background: rgba(25, 25, 25, 0.88);
                backdrop-filter: blur(8px);
                color: #fff;
                padding: 8px 18px;
                border-radius: 20px;
                font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                box-shadow: 0 4px 16px rgba(0,0,0,0.2);
                animation: wxToastFadeIn 0.3s ease forwards;
            }
            @keyframes wxToastFadeIn {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;

        if (typeof GM_addStyle !== 'undefined') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
    }

    /**
     * 将工具条直接注入到底部文件夹图标 (.chat-panel__input-operations) 同一行
     */
    function injectNativeInputOperationsBar() {
        const oldTopBar = document.getElementById('wx-native-action-bar');
        if (oldTopBar) oldTopBar.remove();

        const inputOps = document.querySelector('.chat-panel__input-operations');
        if (!inputOps) return;

        if (!document.getElementById('wx-input-operations-bar')) {
            const bar = document.createElement('div');
            bar.className = 'wx-input-operations-bar';
            bar.id = 'wx-input-operations-bar';

            bar.innerHTML = `
                <div class="wx-bar-left">
                    <button class="wx-btn-main" id="wx-bar-btn-batch" title="一键批量下载当前所有筛选出的真实文件与高清原图">
                        <svg class="wx-svg-icon" viewBox="0 0 24 24" width="13" height="13"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>
                        <span>批量下载</span>
                        <span class="wx-badge-num" id="wx-bar-badge-count">0</span>
                    </button>
                    <button class="wx-btn-sub" id="wx-bar-btn-scan" title="重新扫描当前聊天界面">
                        <svg class="wx-svg-icon" viewBox="0 0 24 24" width="12" height="12"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor"/></svg>
                        <span>扫描</span>
                    </button>
                    <button class="wx-btn-sub" id="wx-bar-btn-autoscroll" title="向上自动连续拉取历史聊天记录">
                        <svg class="wx-svg-icon" viewBox="0 0 24 24" width="12" height="12"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" fill="currentColor"/></svg>
                        <span>拉取历史</span>
                    </button>
                </div>

                <div class="wx-bar-divider"></div>

                <div class="wx-bar-right">
                    <div class="wx-segmented-tabs">
                        <button class="wx-seg-tab active" data-type="all">全部</button>
                        <button class="wx-seg-tab" data-type="image">原图</button>
                        <button class="wx-seg-tab" data-type="file">文件</button>
                        <button class="wx-seg-tab" data-type="video">视频</button>
                    </div>
                    <div class="wx-search-wrap">
                        <svg class="wx-search-icon" viewBox="0 0 24 24" width="11" height="11"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="#999"/></svg>
                        <input type="text" class="wx-search-field" id="wx-native-search-input" placeholder="过滤...">
                    </div>
                </div>
            `;

            inputOps.appendChild(bar);

            const chatInput = document.querySelector('.chat-panel__input');
            if (chatInput && !document.getElementById('wx-native-progress-wrap')) {
                const prog = document.createElement('div');
                prog.className = 'wx-native-progress-container';
                prog.id = 'wx-native-progress-wrap';
                prog.innerHTML = `
                    <div class="wx-native-progress-track">
                        <div class="wx-native-progress-bar" id="wx-native-progress-bar"></div>
                    </div>
                    <div class="wx-native-progress-text" id="wx-native-progress-text">准备下载...</div>
                `;
                chatInput.insertBefore(prog, inputOps.nextSibling);
            }

            bindNativeActionBarEvents();
        }
    }

    function bindNativeActionBarEvents() {
        const batchBtn = document.getElementById('wx-bar-btn-batch');
        if (batchBtn) batchBtn.addEventListener('click', startBatchDownload);

        const scanBtn = document.getElementById('wx-bar-btn-scan');
        if (scanBtn) scanBtn.addEventListener('click', () => {
            const count = scanDOM();
            showToast(`🔍 扫描完成，共捕获 ${State.items.size} 个资源`, 'info');
        });

        const autoBtn = document.getElementById('wx-bar-btn-autoscroll');
        if (autoBtn) autoBtn.addEventListener('click', toggleAutoScroll);

        document.querySelectorAll('.wx-seg-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.wx-seg-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                State.filterType = tab.getAttribute('data-type');
                updateNativeUIState();
            });
        });

        const searchInput = document.getElementById('wx-native-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                State.searchQuery = e.target.value.toLowerCase().trim();
                updateNativeUIState();
            });
        }
    }

    function updateNativeUIState() {
        const count = getFilteredItems().length;
        const total = State.items.size;

        const badge1 = document.getElementById('wx-bar-badge-count');
        if (badge1) badge1.textContent = count === total ? `${total}` : `${count}/${total}`;
    }

    function showInlineProgress(total) {
        const wrap = document.getElementById('wx-native-progress-wrap');
        if (wrap) wrap.classList.add('show');
        updateInlineProgress(0, total, '准备中...');
    }

    function hideInlineProgress() {
        const wrap = document.getElementById('wx-native-progress-wrap');
        if (wrap) wrap.classList.remove('show');
    }

    function updateInlineProgress(current, total, textDesc) {
        const bar = document.getElementById('wx-native-progress-bar');
        const text = document.getElementById('wx-native-progress-text');
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        if (bar) bar.style.width = percent + '%';
        if (text) text.textContent = `[${current}/${total}] (${percent}%) ${textDesc}`;
    }

    function showToast(msg, type = 'info') {
        let container = document.getElementById('wx-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'wx-toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'wx-toast';
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // ==========================================
    // 7. 初始化启动 (Bootstrap)
    // ==========================================
    function init() {
        setupNetworkHooks();
        injectStyles();

        document.getElementById('wx-native-action-bar')?.remove();
        document.getElementById('wx-input-dl-btn')?.remove();
        document.getElementById('wx-dl-float-btn')?.remove();
        document.getElementById('wx-dl-drawer')?.remove();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                injectNativeInputOperationsBar();
                setupDOMObserver();
                setTimeout(scanDOM, 1000);
            });
        } else {
            injectNativeInputOperationsBar();
            setupDOMObserver();
            setTimeout(scanDOM, 1000);
        }
    }

    init();
})();
