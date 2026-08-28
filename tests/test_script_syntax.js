// tests/test_script_syntax.js
import assert from 'assert';

// 模拟核心算法逻辑
function generateEf2Content(files, ua, cookie, referer) {
    let ef2Text = '';
    for (const f of files) {
        ef2Text += '<\r\n';
        ef2Text += `${f.dlink}\r\n`;
        ef2Text += `User-Agent: ${ua}\r\n`;
        if (referer) ef2Text += `Referer: ${referer}\r\n`;
        if (cookie) ef2Text += `Cookie: ${cookie}\r\n`;
        if (f.filename) ef2Text += `file: ${f.filename}\r\n`;
        ef2Text += '>\r\n';
    }
    return ef2Text;
}

function generateIdmCliCommand(idmPath, dlink, filename, savePath) {
    const bin = idmPath || 'IDMan.exe';
    let cmd = `"${bin}" /d "${dlink}"`;
    if (filename) cmd += ` /f "${filename}"`;
    if (savePath) cmd += ` /p "${savePath}"`;
    cmd += ' /a /n';
    return cmd;
}

function generateCurlCommand(dlink, filename, ua, cookie) {
    let cmd = `curl -L "${dlink}"`;
    if (ua) cmd += ` -A "${ua}"`;
    if (cookie) cmd += ` -H "Cookie: ${cookie}"`;
    if (filename) cmd += ` -o "${filename}"`;
    return cmd;
}

function generateAria2Payload(dlink, filename, ua, cookie, referer, saveDir) {
    const headerList = [];
    if (ua) headerList.push(`User-Agent: ${ua}`);
    if (cookie) headerList.push(`Cookie: ${cookie}`);
    if (referer) headerList.push(`Referer: ${referer}`);

    const options = {
        header: headerList
    };
    if (filename) options.out = filename;
    if (saveDir) options.dir = saveDir;

    return {
        jsonrpc: '2.0',
        id: 'BaiduDirect_' + Date.now(),
        method: 'aria2.addUri',
        params: [[dlink], options]
    };
}

// 运行断言测试
console.log('Running tests for Baidu Netdisk core helper...');

// 1. 测试 .ef2 格式生成
const testFiles = [{
    filename: 'test_video.mp4',
    dlink: 'https://d.pcs.baidu.com/file/sample123'
}];
const ua = 'netdisk;11.24.3;PC;PC-Windows;10.0.19045;WindowsBaiduYunGuanJia';
const cookie = 'BDUSS=fake_bduss_token';
const referer = 'https://pan.baidu.com/disk/main';

const ef2Result = generateEf2Content(testFiles, ua, cookie, referer);
assert(ef2Result.includes('<\r\n'), 'ef2 must start with <');
assert(ef2Result.includes(testFiles[0].dlink), 'ef2 must contain dlink');
assert(ef2Result.includes(`User-Agent: ${ua}`), 'ef2 must contain User-Agent');
assert(ef2Result.includes(`Cookie: ${cookie}`), 'ef2 must contain Cookie');
assert(ef2Result.includes(`file: ${testFiles[0].filename}`), 'ef2 must contain filename');
assert(ef2Result.includes('>\r\n'), 'ef2 must end block with >');
console.log('✓ EF2 generation test passed.');

// 2. 测试 IDM 命令行生成
const cliCmd = generateIdmCliCommand('C:\\IDM\\IDMan.exe', 'https://d.pcs.baidu.com/file/1', 'my_file.zip', 'D:\\Downloads');
assert(cliCmd.includes('"C:\\IDM\\IDMan.exe" /d "https://d.pcs.baidu.com/file/1" /f "my_file.zip" /p "D:\\Downloads" /a /n'));
console.log('✓ IDM CLI command generation test passed.');

// 3. 测试 cURL 命令生成
const curlCmd = generateCurlCommand('https://d.pcs.baidu.com/file/1', 'my_file.zip', ua, cookie);
assert(curlCmd.includes(`-A "${ua}"`));
assert(curlCmd.includes(`-H "Cookie: ${cookie}"`));
assert(curlCmd.includes(`-o "my_file.zip"`));
console.log('✓ cURL command generation test passed.');

// 4. 测试 Aria2 JSON-RPC payload 构造
const ariaPayload = generateAria2Payload('https://d.pcs.baidu.com/file/1', 'my_file.zip', ua, cookie, referer, 'D:\\Downloads');
assert.strictEqual(ariaPayload.method, 'aria2.addUri');
assert.deepStrictEqual(ariaPayload.params[0], ['https://d.pcs.baidu.com/file/1']);
assert.strictEqual(ariaPayload.params[1].out, 'my_file.zip');
assert(ariaPayload.params[1].header.some(h => h.startsWith('User-Agent:')));
assert(ariaPayload.params[1].header.some(h => h.startsWith('Cookie:')));
console.log('✓ Aria2 JSON-RPC payload test passed.');

console.log('\nAll unit tests passed successfully! 🎉');
