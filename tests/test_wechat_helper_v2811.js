import assert from 'assert';

console.log('--- 开始微信文件传输助手 v2.8.11 3变6与同名文件双向归并测试 ---');

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

function isSameFileName(name1, name2) {
    if (!name1 || !name2) return false;
    const n1 = name1.trim().toLowerCase();
    const n2 = name2.trim().toLowerCase();
    if (n1 === n2) return true;
    if (n1.replace(/\s+/g, '') === n2.replace(/\s+/g, '')) return true;
    if (n1.length > 15 && n2.length > 15) {
        if (n1.startsWith(n2.slice(0, 20)) || n2.startsWith(n1.slice(0, 20))) {
            return true;
        }
    }
    return false;
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

function formatBytes(bytes) {
    return `${bytes} B`;
}

function formatCurrentTime() {
    return '12:00';
}

function attachInlineTagToElement(item) {
    if (item.element) {
        item.element._hasTag = true;
    }
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

    // 2. 跨阶段属性合并：若同一资源通过网络或 DOM 再次触发，精准匹配现有项
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
        // 2.4 DOM 扫描匹配网络项：当前有 DOM 元素但未提取出 msgId 时，按文件名顺序匹配尚未绑定 element 的网络项
        if (!State.items.has(key) && item.element && !msgId) {
            for (const [k, ex] of State.items.entries()) {
                if (ex.type === (item.type || 'file') && !ex.element) {
                    if (isSameFileName(ex.name, cleanName)) {
                        key = k;
                        break;
                    }
                }
            }
        }
        // 2.5 网络项匹配 DOM 项：当前来自网络（有 msgId，无 element）时，按文件名顺序匹配尚未关联 msgId 的 DOM 项
        if (!State.items.has(key) && !item.element && msgId) {
            for (const [k, ex] of State.items.entries()) {
                if (ex.type === (item.type || 'file') && !ex.msgId) {
                    if (isSameFileName(ex.name, cleanName)) {
                        key = k;
                        break;
                    }
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
            formattedSize: item.formattedSize || '未知大小',
            blob: item.blob || null,
            selected: true
        };
        State.items.set(key, newItem);
        attachInlineTagToElement(newItem);
    } else {
        const existing = State.items.get(key);
        if (hdUrl && (!existing.url || existing.url.startsWith('#') || existing.url.startsWith('javascript'))) {
            existing.url = hdUrl;
        }
        if (item.element && !existing.element) existing.element = item.element;
        if (item.downloadBtn && !existing.downloadBtn) existing.downloadBtn = item.downloadBtn;
        if (item.rawMsg && !existing.rawMsg) existing.rawMsg = item.rawMsg;
        if (item.formattedSize && (!existing.formattedSize || existing.formattedSize === '未知大小')) {
            existing.formattedSize = item.formattedSize;
        }
        if (mediaId && !existing.mediaId) existing.mediaId = mediaId;
        if (msgId && !existing.msgId) existing.msgId = msgId;
        if (existing.element) attachInlineTagToElement(existing);
    }
}

// ==========================================
// 测试 1: 重现用户 3 个文件变成 6 个文件的问题并验证修复
// ==========================================
console.log('测试 1: 验证 3 个真实文件不会变成 6 个...');
State.items.clear();
State.elUidCounter = 0;

// 1. 网络拦截首先捕获 3 个文件
addItem({
    id: 'file_msg_101',
    msgId: '101',
    type: 'file',
    name: '精宇 lcx.rar',
    mediaId: 'mid_1',
    url: '/download/101'
});

addItem({
    id: 'file_msg_102',
    msgId: '102',
    type: 'file',
    name: '单位名...wps',
    mediaId: 'mid_2',
    url: '/download/102'
});

addItem({
    id: 'file_msg_103',
    msgId: '103',
    type: 'file',
    name: '附件2 不准.mp4',
    mediaId: 'mid_3',
    url: '/download/103'
});

assert.strictEqual(State.items.size, 3, '网络拦截后应有 3 个文件');

// 2. DOM 扫描 (无 msgId/mediaId 暴露)
const card1 = { node: 1 };
const card2 = { node: 2 };
const card3 = { node: 3 };
const btn1 = { click: () => {} };
const btn2 = { click: () => {} };
const btn3 = { click: () => {} };

function mockScanDOM(el, title, btn, sizeStr) {
    if (!el._wx_uid) {
        State.elUidCounter = (State.elUidCounter || 0) + 1;
        el._wx_uid = `el_mock_${State.elUidCounter}`;
    }
    const uid = `file_${el._wx_uid}`;
    addItem({
        id: uid,
        type: 'file',
        name: title,
        formattedSize: sizeStr,
        element: el,
        downloadBtn: btn
    });
}

mockScanDOM(card1, '精宇 lcx.rar', btn1, '94.44KB');
mockScanDOM(card2, '单位名...wps', btn2, '36.00KB');
mockScanDOM(card3, '附件2 不准.mp4', btn3, '55.01MB');

// 验证数量仍然是 3，绝不能变成 6！
console.log(`DOM 扫描后 State.items.size: ${State.items.size}`);
assert.strictEqual(State.items.size, 3, `【严重错误】3个文件变成了 ${State.items.size} 个！`);

// 验证 DOM 元素和下载按钮已绑定
const item101 = State.items.get('file_msg_101');
assert.strictEqual(item101.element, card1, 'item101 必须正确绑定 card1');
assert.strictEqual(item101.downloadBtn, btn1, 'item101 必须正确绑定 btn1');
assert.strictEqual(item101.formattedSize, '94.44KB', 'item101 必须提取到 DOM 上的容量大小');
assert.strictEqual(card1._hasTag, true, 'card1 必须成功挂载气泡标签');

console.log('✓ 测试 1 通过：3 个文件成功与 DOM 绑定，数量严格保持为 3，未出现 6 个重复项！');

// ==========================================
// 测试 2: 验证 3 个同名文件 (具有不同 MsgId) 也必须准确为 3
// ==========================================
console.log('测试 2: 验证 3 个相同文件名的文件准确为 3...');
State.items.clear();
State.elUidCounter = 0;

addItem({
    id: 'file_msg_201',
    msgId: '201',
    type: 'file',
    name: '财务报表.xlsx',
    url: '/download/201'
});

addItem({
    id: 'file_msg_202',
    msgId: '202',
    type: 'file',
    name: '财务报表.xlsx',
    url: '/download/202'
});

addItem({
    id: 'file_msg_203',
    msgId: '203',
    type: 'file',
    name: '财务报表.xlsx',
    url: '/download/203'
});

assert.strictEqual(State.items.size, 3);

const sameCard1 = { node: 11 };
const sameCard2 = { node: 12 };
const sameCard3 = { node: 13 };
const sameBtn1 = { click: () => {} };
const sameBtn2 = { click: () => {} };
const sameBtn3 = { click: () => {} };

mockScanDOM(sameCard1, '财务报表.xlsx', sameBtn1, '12.3KB');
mockScanDOM(sameCard2, '财务报表.xlsx', sameBtn2, '15.6KB');
mockScanDOM(sameCard3, '财务报表.xlsx', sameBtn3, '18.9KB');

assert.strictEqual(State.items.size, 3, `3个同名文件扫描后必须保持为 3，实际: ${State.items.size}`);
assert.strictEqual(State.items.get('file_msg_201').element, sameCard1);
assert.strictEqual(State.items.get('file_msg_202').element, sameCard2);
assert.strictEqual(State.items.get('file_msg_203').element, sameCard3);
console.log('✓ 测试 2 通过：3 个同名文件均精准一对一绑定到各自卡片，数量为 3！');

// ==========================================
// 测试 3: DOM 重复扫描幂等性验证
// ==========================================
console.log('测试 3: 验证滚动触发重复扫描的幂等性...');
mockScanDOM(sameCard1, '财务报表.xlsx', sameBtn1, '12.3KB');
mockScanDOM(sameCard2, '财务报表.xlsx', sameBtn2, '15.6KB');
mockScanDOM(sameCard3, '财务报表.xlsx', sameBtn3, '18.9KB');

assert.strictEqual(State.items.size, 3, `重复扫描后数量必须保持 3，实际: ${State.items.size}`);
console.log('✓ 测试 3 通过：重复扫描未产生任何冗余项！');

console.log('🎉 v2.8.11 3变6与同名文件双向归并所有断言全部通过！');
