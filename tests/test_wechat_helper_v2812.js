import assert from 'assert';

console.log('--- 开始微信文件传输助手 v2.8.12 杜绝重复膨胀 (3->6->12) 与确定性多扫描测试 ---');

// 模拟 State
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

function getHdMediaUrl(url, msgId) {
    return url;
}

function extractMsgId(url) {
    return '';
}

function buildFileDownloadUrl(rawMsg, mediaId, fileName) {
    return `/download/${mediaId || 'none'}/${encodeURIComponent(fileName)}`;
}

// 模拟 DOM 树
const mockDocument = {
    bodyNodes: new Set(),
    body: {
        contains(el) {
            return mockDocument.bodyNodes.has(el);
        }
    }
};

function addItem(item) {
    if (!item || (!item.url && !item.name && !item.element && !item.downloadBtn)) return;

    const isImage = item.type === 'image';
    const isFile = item.type === 'file';
    const isVideo = item.type === 'video';
    const rawName = item.name || (isImage ? 'image.jpg' : (isVideo ? 'video.mp4' : 'file.bin'));
    const cleanName = isFile ? cleanWechatFileName(rawName) : sanitizeFilename(rawName);

    let rawUrl = item.url || '';
    const msgId = item.rawMsg?.MsgId || item.rawMsg?.msg_id || item.rawMsg?.id || item.msgId || extractMsgId(rawUrl);
    const mediaId = item.mediaId || item.rawMsg?.MediaId || item.rawMsg?.mediaId || item.rawMsg?.attachId || '';
    let hdUrl = isImage ? getHdMediaUrl(rawUrl, msgId) : rawUrl;
    let previewUrl = item.previewUrl || rawUrl || hdUrl;

    if (isFile && (!hdUrl || hdUrl.startsWith('#') || hdUrl.startsWith('javascript')) && item.rawMsg) {
        const builtUrl = buildFileDownloadUrl(item.rawMsg, mediaId, cleanName);
        if (builtUrl) hdUrl = builtUrl;
    }

    // 1. 生成确定性全局唯一键
    let key = item.id;
    if (!key) {
        if (msgId) {
            key = `${item.type || 'file'}_msg_${msgId}`;
        } else if (mediaId) {
            key = `${item.type || 'file'}_media_${mediaId}`;
        } else if (hdUrl && !hdUrl.startsWith('#') && !hdUrl.startsWith('javascript')) {
            key = `${item.type || 'file'}_${hashString(hdUrl)}`;
        } else {
            key = `${item.type || 'file'}_${cleanName.toLowerCase()}_#0`;
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
        // DOM 扫描匹配网络项：当前有 DOM 元素但未提取出 msgId 时，按文件名顺序匹配尚未绑定有效 element 的网络项
        if (!State.items.has(key) && item.element && !msgId) {
            for (const [k, ex] of State.items.entries()) {
                if (ex.type === (item.type || 'file')) {
                    const needsElement = !ex.element || !mockDocument.body.contains(ex.element);
                    if (needsElement && isSameFileName(ex.name, cleanName)) {
                        key = k;
                        break;
                    }
                }
            }
        }
        // 网络项匹配 DOM 项
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
        const newItem = {
            id: key,
            type: item.type || 'file',
            name: cleanName,
            url: hdUrl,
            dataUrl: item.dataUrl || '',
            previewUrl: previewUrl,
            size: item.size || 0,
            formattedSize: item.size ? formatBytes(item.size) : (item.formattedSize || '未知大小'),
            timeStr: item.timeStr || formatCurrentTime(),
            timestamp: item.timestamp || Date.now(),
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
        if (item.formattedSize && (!existing.formattedSize || existing.formattedSize === '未知大小')) {
            existing.formattedSize = item.formattedSize;
        }
        if (item.element) {
            existing.element = item.element;
            if (item.downloadBtn) existing.downloadBtn = item.downloadBtn;
        }
        if (item.rawMsg && !existing.rawMsg) existing.rawMsg = item.rawMsg;
        if (mediaId && !existing.mediaId) existing.mediaId = mediaId;
        if (msgId && !existing.msgId) existing.msgId = msgId;
    }
}

// 模拟 DOM 扫描器
function simulateScanDOM(mockMsgItems) {
    const fileOccurrences = new Map();
    const imageOccurrences = new Map();
    const videoOccurrences = new Map();

    mockMsgItems.forEach(msgEl => {
        if (msgEl._sending) return;

        if (msgEl.fileTitle || msgEl.fileCard) {
            const cleanName = cleanWechatFileName(msgEl.fileTitle || msgEl.fileCard);
            if (cleanName) {
                const msgId = msgEl.msgId || '';
                const mediaId = msgEl.mediaId || '';
                const formattedSize = msgEl.formattedSize || '';

                const occKey = `${cleanName.toLowerCase()}_${formattedSize.toLowerCase().replace(/\s+/g, '')}`;
                const occIndex = fileOccurrences.get(occKey) || 0;
                fileOccurrences.set(occKey, occIndex + 1);

                const uid = msgId ? `file_msg_${msgId}` : (mediaId ? `file_media_${mediaId}` : `file_dom_${occKey}_#${occIndex}`);

                addItem({
                    id: uid,
                    msgId: msgId,
                    type: 'file',
                    name: cleanName,
                    url: 'javascript:void(0)',
                    mediaId: mediaId,
                    formattedSize: formattedSize,
                    element: msgEl,
                    downloadBtn: msgEl.downloadBtn
                });
            }
        }
    });
}

// ==========================================
// 测试用例 1：用户真实场景 (3个文件：单位名单.wps, 精宇 log.rar, Adult_every.rar)
// 验证：即使 Vue 多轮重渲染、DOM节点不断重建、连续扫描 20 次，State.items.size 必须始终恒等于 3！绝不能变成 6 或 12！
// ==========================================
console.log('\n[测试 1] 真实 3 文件场景多轮重绘扫描幂等性验证...');
State.items.clear();
mockDocument.bodyNodes.clear();

function createTestDOMGroup1() {
    const el1 = {
        fileTitle: '单位名单.wps',
        formattedSize: '36.00KB',
        downloadBtn: { clicked: 0, click() { this.clicked++; } }
    };
    const el2 = {
        fileTitle: '精宇 log.rar',
        formattedSize: '94.44KB',
        downloadBtn: { clicked: 0, click() { this.clicked++; } }
    };
    const el3 = {
        fileTitle: 'Adult_every.rar',
        formattedSize: '635.54KB',
        downloadBtn: { clicked: 0, click() { this.clicked++; } }
    };
    mockDocument.bodyNodes.clear();
    mockDocument.bodyNodes.add(el1);
    mockDocument.bodyNodes.add(el2);
    mockDocument.bodyNodes.add(el3);
    return [el1, el2, el3];
}

// 模拟 20 轮连续扫描与 Vue 节点替换 (例如滚动、点击、变动触发)
for (let round = 1; round <= 20; round++) {
    const domList = createTestDOMGroup1(); // 每次返回全新的 DOM 节点实例，旧节点从 document.body 移出
    simulateScanDOM(domList);
    assert.strictEqual(State.items.size, 3, `第 ${round} 轮扫描后，文件数应该恒等于 3，实际为 ${State.items.size}`);
}

console.log('✅ 测试 1 通过！连续 20 轮扫描+Vue节点重绘，文件数恒定为 3，彻底杜绝了 6->12 膨胀！');

// ==========================================
// 测试用例 2：同名文件场景 (2个同名合同.docx + 1个发票.pdf)
// 验证：2个同名文件必须被识别为 2 个独立条目，且多次重绘扫描后总数仍为 3！
// ==========================================
console.log('\n[测试 2] 同名文件去重与独立识别测试...');
State.items.clear();
mockDocument.bodyNodes.clear();

function createSameNameDOMGroup() {
    const doc1 = {
        fileTitle: '2026年业务合作合同.docx',
        formattedSize: '36.00KB',
        downloadBtn: { id: 'btn_doc1', clicked: 0, click() { this.clicked++; } }
    };
    const doc2 = {
        fileTitle: '2026年业务合作合同.docx',
        formattedSize: '36.00KB',
        downloadBtn: { id: 'btn_doc2', clicked: 0, click() { this.clicked++; } }
    };
    const pdf = {
        fileTitle: '发票清单.pdf',
        formattedSize: '1.20MB',
        downloadBtn: { id: 'btn_pdf', clicked: 0, click() { this.clicked++; } }
    };
    mockDocument.bodyNodes.clear();
    mockDocument.bodyNodes.add(doc1);
    mockDocument.bodyNodes.add(doc2);
    mockDocument.bodyNodes.add(pdf);
    return [doc1, doc2, pdf];
}

for (let round = 1; round <= 10; round++) {
    const domList = createSameNameDOMGroup();
    simulateScanDOM(domList);
    assert.strictEqual(State.items.size, 3, `第 ${round} 轮扫描后，总数应为 3 (含2个同名合同)，实际为 ${State.items.size}`);
}

// 模拟批量下载落盘命名测试
const items = Array.from(State.items.values());
assert.strictEqual(items.length, 3);
const savedNameCount = new Map();
const downloadNames = [];

for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = item.name;
    const lowerName = (name || 'file.bin').toLowerCase();
    const count = savedNameCount.get(lowerName) || 0;
    savedNameCount.set(lowerName, count + 1);

    let saveName = name;
    if (count > 0) {
        const dotIdx = name.lastIndexOf('.');
        if (dotIdx > 0) {
            saveName = `${name.slice(0, dotIdx)} (${count})${name.slice(dotIdx)}`;
        } else {
            saveName = `${name} (${count})`;
        }
    }
    downloadNames.push(saveName);
}

assert.strictEqual(downloadNames[0], '2026年业务合作合同.docx');
assert.strictEqual(downloadNames[1], '2026年业务合作合同 (1).docx');
assert.strictEqual(downloadNames[2], '发票清单.pdf');
console.log('✅ 测试 2 通过！同名文件识别为独立文件，且批量下载自动区分为合同.docx 与 合同 (1).docx！');

// ==========================================
// 测试用例 3：网络拦截优先 + DOM 扫描重绘绑定
// ==========================================
console.log('\n[测试 3] 网络先到达 + DOM 扫描多轮更新绑定测试...');
State.items.clear();
mockDocument.bodyNodes.clear();

// 1. 网络拦截 2 个文件
addItem({
    id: 'file_msg_net_1001',
    msgId: 'net_1001',
    type: 'file',
    name: '单位名单.wps',
    url: '/download/net_1001/file.wps',
    size: 36864
});
addItem({
    id: 'file_msg_net_1002',
    msgId: 'net_1002',
    type: 'file',
    name: 'Adult_every.rar',
    url: '/download/net_1002/file.rar',
    size: 650000
});
assert.strictEqual(State.items.size, 2);

// 2. DOM 扫描 (DOM 只有纯 DOM 元素，无 msgId)
const domEl1 = {
    fileTitle: '单位名单.wps',
    formattedSize: '36.00KB',
    downloadBtn: { id: 'btn_1', clicked: 0, click() { this.clicked++; } }
};
const domEl2 = {
    fileTitle: 'Adult_every.rar',
    formattedSize: '635.54KB',
    downloadBtn: { id: 'btn_2', clicked: 0, click() { this.clicked++; } }
};
mockDocument.bodyNodes.add(domEl1);
mockDocument.bodyNodes.add(domEl2);

simulateScanDOM([domEl1, domEl2]);
assert.strictEqual(State.items.size, 2, '网络项与 DOM 项应当精准合并，数量依然为 2');

const netItem1 = State.items.get('file_msg_net_1001');
assert.strictEqual(netItem1.element, domEl1, '网络项应成功绑定 DOM 节点 1');
assert.strictEqual(netItem1.downloadBtn, domEl1.downloadBtn, '网络项应成功绑定下载按钮 1');

// 3. 多轮重绘扫描
for (let r = 1; r <= 10; r++) {
    const newDomEl1 = {
        fileTitle: '单位名单.wps',
        formattedSize: '36.00KB',
        downloadBtn: { id: `btn_1_r${r}`, clicked: 0, click() { this.clicked++; } }
    };
    const newDomEl2 = {
        fileTitle: 'Adult_every.rar',
        formattedSize: '635.54KB',
        downloadBtn: { id: `btn_2_r${r}`, clicked: 0, click() { this.clicked++; } }
    };
    mockDocument.bodyNodes.clear();
    mockDocument.bodyNodes.add(newDomEl1);
    mockDocument.bodyNodes.add(newDomEl2);

    simulateScanDOM([newDomEl1, newDomEl2]);
    assert.strictEqual(State.items.size, 2, `第 ${r} 轮重绘后数量应依然为 2`);
    assert.strictEqual(netItem1.element, newDomEl1, 'live DOM 元素应自动更新');
    assert.strictEqual(netItem1.downloadBtn.id, `btn_1_r${r}`, 'live 下载按钮应自动更新');
}

console.log('✅ 测试 3 通过！网络与 DOM 混合流绑定完全准确，多轮更新保持绝对稳定！');

console.log('\n🎉 全部 v2.8.12 单元测试完美通过！');
