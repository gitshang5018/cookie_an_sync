import assert from 'assert';

console.log('--- 开始微信文件传输助手 v2.8.10 算法与多同名文件测试 ---');

// 模拟 State 与算法
const State = {
    items: new Map(),
    blobs: new Map(),
    elUidCounter: 0,
    filterType: 'all',
    searchQuery: '',
    authParams: {
        skey: 'test_skey',
        pass_ticket: 'test_pass',
        currentUser: 'filehelper'
    }
};

function cleanWechatFileName(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let name = rawText.trim().slice(0, 300)
        .replace(/^.*?[的]?文件传输助手[:：\s]*/i, '')
        .replace(/^(微信用户|我|好友|文件)[:：\s]*/i, '')
        .replace(/^[\d]{1,2}:[\d]{2}[:\s]*/, '')
        .trim();

    const extPattern = 'tar\\.gz|pdf|docx?|xlsx?|pptx?|zip|rar|7z|cdr|psd|ai|txt|csv|mp3|mp4|apk|iso|tar|gz|json|md|wps|et|dps';
    const extRegex = new RegExp('\\.(?:' + extPattern + ')$', 'i');

    const lines = name.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
        const words = line.split(/\s+/);
        for (let i = words.length - 1; i >= 0; i--) {
            const w = words[i].replace(/^[（\(]+/, '').replace(/[）\)]+$/, '');
            if (extRegex.test(w)) {
                let fileCandidate = w;
                let j = i - 1;
                while (j >= 0) {
                    const prev = words[j];
                    if (/(?:MB|KB|GB|B|%|\/|:|正在|上传|发送|请稍候|[（\(])/i.test(prev)) {
                        break;
                    }
                    fileCandidate = prev + ' ' + fileCandidate;
                    j--;
                }
                return fileCandidate.trim();
            }
        }

        const inline = line.match(new RegExp('([\\w\\u4e00-\\u9fa5\\.\\-_#\\(\\)（）]+?\\.(?:' + extPattern + '))', 'i'));
        if (inline) {
            return inline[1].trim();
        }
    }

    const firstLine = (lines[0] || name).trim();
    return firstLine.length > 80 ? firstLine.slice(0, 80) : firstLine;
}

function sanitizeFilename(name) {
    return (name || ('file_' + Date.now())).replace(/[\\/:*?"<>|]/g, '_').trim();
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

function buildFileDownloadUrl(msg, mediaId, fileName) {
    return `/cgi-bin/mmwebwx-bin/webwxgetmedia?mediaid=${encodeURIComponent(mediaId)}&filename=${encodeURIComponent(fileName)}`;
}

function formatBytes(bytes) {
    return `${bytes} B`;
}

function formatCurrentTime() {
    return '12:00';
}

function addItem(item) {
    if (!item || (!item.url && !item.name && !item.element && !item.downloadBtn)) return;

    const isImage = item.type === 'image';
    const isFile = item.type === 'file';
    const isVideo = item.type === 'video';
    const rawName = item.name || (isImage ? 'image.jpg' : (isVideo ? 'video.mp4' : 'file.bin'));
    const cleanName = isFile ? cleanWechatFileName(rawName) : sanitizeFilename(rawName);

    let rawUrl = item.url || '';
    const msgId = item.rawMsg?.MsgId || item.rawMsg?.msg_id || item.rawMsg?.id || item.msgId || '';
    const mediaId = item.mediaId || item.rawMsg?.MediaId || item.rawMsg?.mediaId || item.rawMsg?.attachId || '';
    let hdUrl = rawUrl;
    let previewUrl = item.previewUrl || rawUrl || hdUrl;

    if (isFile && (!hdUrl || hdUrl.startsWith('#') || hdUrl.startsWith('javascript')) && item.rawMsg) {
        const builtUrl = buildFileDownloadUrl(item.rawMsg, mediaId, cleanName);
        if (builtUrl) hdUrl = builtUrl;
    }

    // 1. 生成全局唯一键
    let key = item.id;
    if (!key || key.startsWith('file_' + cleanName.toLowerCase())) {
        if (msgId) {
            key = `${item.type || 'file'}_msg_${msgId}`;
        } else if (mediaId) {
            key = `${item.type || 'file'}_media_${mediaId}`;
        } else if (item.element) {
            if (!item.element._wx_uid) {
                State.elUidCounter = (State.elUidCounter || 0) + 1;
                item.element._wx_uid = `el_${Date.now()}_${State.elUidCounter}`;
            }
            key = `${item.type || 'file'}_${item.element._wx_uid}`;
        } else if (hdUrl && !hdUrl.startsWith('#') && !hdUrl.startsWith('javascript')) {
            key = `${item.type || 'file'}_${hashString(hdUrl)}`;
        } else {
            State.elUidCounter = (State.elUidCounter || 0) + 1;
            key = `${item.type || 'file'}_anon_${Date.now()}_${State.elUidCounter}`;
        }
    }

    // 2. 跨阶段属性合并
    if (!State.items.has(key)) {
        if (msgId) {
            for (const [k, ex] of State.items.entries()) {
                if (ex.msgId && String(ex.msgId) === String(msgId)) {
                    key = k;
                    break;
                }
            }
        }
        if (!State.items.has(key) && mediaId) {
            for (const [k, ex] of State.items.entries()) {
                if (ex.mediaId && String(ex.mediaId) === String(mediaId)) {
                    key = k;
                    break;
                }
            }
        }
        if (!State.items.has(key) && item.element) {
            for (const [k, ex] of State.items.entries()) {
                if (ex.element && ex.element === item.element) {
                    key = k;
                    break;
                }
            }
        }
    }

    if (!State.items.has(key)) {
        let finalName = cleanName;
        const newItem = {
            id: key,
            type: item.type || 'file',
            name: finalName,
            url: hdUrl,
            mediaId: mediaId,
            msgId: msgId,
            rawMsg: item.rawMsg || null,
            element: item.element || null,
            downloadBtn: item.downloadBtn || null,
            blob: item.blob || null,
            selected: true
        };
        State.items.set(key, newItem);
    } else {
        const existing = State.items.get(key);
        if (hdUrl && (!existing.url || existing.url.startsWith('#') || existing.url.startsWith('javascript'))) {
            existing.url = hdUrl;
        }
        if (item.element && !existing.element) existing.element = item.element;
        if (item.downloadBtn && !existing.downloadBtn) existing.downloadBtn = item.downloadBtn;
        if (item.rawMsg && !existing.rawMsg) existing.rawMsg = item.rawMsg;
        if (mediaId && !existing.mediaId) existing.mediaId = mediaId;
        if (msgId && !existing.msgId) existing.msgId = msgId;
    }
}

// ==============================
// 测试场景 1: 网络接收 3 个同名文件
// ==============================
console.log('测试 1: 接收 3 个同名文件 (具有不同 MsgId)...');
State.items.clear();
State.elUidCounter = 0;

addItem({
    id: 'file_msg_1001',
    msgId: '1001',
    type: 'file',
    name: '财务汇总_2026.xlsx',
    mediaId: 'media_1',
    url: '/download/1001'
});

addItem({
    id: 'file_msg_1002',
    msgId: '1002',
    type: 'file',
    name: '财务汇总_2026.xlsx',
    mediaId: 'media_2',
    url: '/download/1002'
});

addItem({
    id: 'file_msg_1003',
    msgId: '1003',
    type: 'file',
    name: '财务汇总_2026.xlsx',
    mediaId: 'media_3',
    url: '/download/1003'
});

assert.strictEqual(State.items.size, 3, `预期捕获 3 个独立同名文件，实际捕获: ${State.items.size}`);
console.log('✓ 测试 1 通过：3 个同名文件已正确识别为 3 个独立资源！');

// ==============================
// 测试场景 2: DOM 渲染并关联到已有的网络消息
// ==============================
console.log('测试 2: DOM 扫描关联网络捕获项...');
const fakeEl1 = { tagName: 'DIV', classList: [] };
const fakeBtn1 = { click: () => console.log('Btn 1 clicked') };

addItem({
    id: 'file_msg_1001',
    msgId: '1001',
    type: 'file',
    name: '财务汇总_2026.xlsx',
    element: fakeEl1,
    downloadBtn: fakeBtn1
});

assert.strictEqual(State.items.size, 3, '关联 DOM 后数量应仍为 3');
const item1 = State.items.get('file_msg_1001');
assert.strictEqual(item1.element, fakeEl1, 'item1 应成功绑定 DOM 元素');
assert.strictEqual(item1.downloadBtn, fakeBtn1, 'item1 应成功绑定下载按钮');
console.log('✓ 测试 2 通过：DOM 元素与下载按钮成功绑定至已有同名资源！');

// ==============================
// 测试场景 3: 纯 DOM 扫描（无网络拦截）3 个同名文件
// ==============================
console.log('测试 3: 纯 DOM 扫描 3 个同名文件...');
State.items.clear();
State.elUidCounter = 0;

const domCard1 = { node: 1 };
const domCard2 = { node: 2 };
const domCard3 = { node: 3 };

function scanMockDOM(el, title) {
    if (!el._wx_uid) {
        State.elUidCounter = (State.elUidCounter || 0) + 1;
        el._wx_uid = `el_mock_${State.elUidCounter}`;
    }
    const uid = `file_${el._wx_uid}`;
    addItem({
        id: uid,
        type: 'file',
        name: title,
        element: el,
        downloadBtn: { clicked: false, click() { this.clicked = true; } }
    });
}

scanMockDOM(domCard1, '设计稿.cdr');
scanMockDOM(domCard2, '设计稿.cdr');
scanMockDOM(domCard3, '设计稿.cdr');

assert.strictEqual(State.items.size, 3, `DOM 扫描预期 3 个文件，实际: ${State.items.size}`);
console.log('✓ 测试 3 通过：纯 DOM 模式下 3 个同名文件均独立存在！');

// ==============================
// 测试场景 4: 重复扫描 DOM 幂等性校验
// ==============================
console.log('测试 4: 重复扫描 DOM (防重复添加)...');
scanMockDOM(domCard1, '设计稿.cdr');
scanMockDOM(domCard2, '设计稿.cdr');
scanMockDOM(domCard3, '设计稿.cdr');

assert.strictEqual(State.items.size, 3, `重复扫描后数量应保持为 3，实际: ${State.items.size}`);
console.log('✓ 测试 4 通过：重复扫描未产生任何冗余重复项！');

// ==============================
// 测试场景 5: 模拟批量下载触发
// ==============================
console.log('测试 5: 批量下载所有同名文件...');
let downloadCount = 0;
for (const item of State.items.values()) {
    if (item.downloadBtn) {
        item.downloadBtn.click();
        assert.strictEqual(item.downloadBtn.clicked, true);
        downloadCount++;
    }
}
assert.strictEqual(downloadCount, 3, `预期触发 3 次下载，实际触发: ${downloadCount}`);
console.log('✓ 测试 5 通过：3 个同名文件均已依次触发下载！');

console.log('🎉 v2.8.10 所有多文件同名识别与下载断言全部通过！');
