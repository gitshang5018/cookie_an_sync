import assert from 'assert';

console.log('--- 开始微信文件传输助手 v2.8.9 算法验证 ---');

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
                    // 遇到容量（如 12MB/30MB）、百分比、标点括号、状态词则停止
                    if (/(?:MB|KB|GB|B|%|\/|:|正在|上传|发送|请稍候|[（\(])/i.test(prev)) {
                        break;
                    }
                    fileCandidate = prev + ' ' + fileCandidate;
                    j--;
                }
                return fileCandidate.trim();
            }
        }

        // 行内正则安全匹配
        const inline = line.match(new RegExp('([\\w\\u4e00-\\u9fa5\\.\\-_#\\(\\)（）]+?\\.(?:' + extPattern + '))', 'i'));
        if (inline) {
            return inline[1].trim();
        }
    }

    const firstLine = (lines[0] || name).trim();
    return firstLine.length > 80 ? firstLine.slice(0, 80) : firstLine;
}

// 压测
console.log('压测 1: 5000 次连续重叠点号...');
const severeRedosStr = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z.'.repeat(5000);
const start = performance.now();
const res1 = cleanWechatFileName(severeRedosStr);
const duration = performance.now() - start;
console.log(`ReDoS 压测耗时: ${duration.toFixed(2)}ms`);
assert(duration < 20, '防回溯压测未达标！');

// 功能测试
const tests = [
    ['我 12:30 文件传输助手: 正在上传... 45.2% (12.3MB/28.5MB) 财务汇总_2026.xlsx', '财务汇总_2026.xlsx'],
    ['文件传输助手: 正在发送... 请稍候', '正在发送... 请稍候'],
    ['我 09:15: 重要方案-评审稿(V2.1.0).pdf', '重要方案-评审稿(V2.1.0).pdf'],
    ['压缩包测试文件.tar.gz', '压缩包测试文件.tar.gz'],
    ['设计图纸.CDR', '设计图纸.CDR'],
    ['简单的Word文档.docx\n12.5MB\n已发送', '简单的Word文档.docx'],
    ['Annual Report 2026 Final.docx', 'Annual Report 2026 Final.docx']
];

for (const [input, expected] of tests) {
    const actual = cleanWechatFileName(input);
    console.log(`Input: "${input}" -> Actual: "${actual}"`);
    assert.strictEqual(actual, expected);
}

console.log('🎉 所有算法断言完全吻合！');
