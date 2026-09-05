import fs from 'fs';
import { execSync } from 'child_process';

console.log('--- 开始构建微信助手混淆版 v2.8.10 ---');

const sourceFile = './wechat_filehelper_batch_downloader.source.user.js';
const outputFile = './wechat_filehelper_batch_downloader.user.js';

const content = fs.readFileSync(sourceFile, 'utf-8');
const headerEndIdx = content.indexOf('// ==/UserScript==');
if (headerEndIdx === -1) {
    throw new Error('未找到 UserScript 头部结束标记');
}

const header = content.slice(0, headerEndIdx + '// ==/UserScript=='.length);
const code = content.slice(headerEndIdx + '// ==/UserScript=='.length).trim();

// 临时写入纯代码
const tempSource = './temp_code.js';
const tempObf = './temp_obf.js';
fs.writeFileSync(tempSource, code, 'utf-8');

try {
    console.log('正在执行 javascript-obfuscator...');
    execSync('npx -y javascript-obfuscator ./temp_code.js --output ./temp_obf.js --compact true --control-flow-flattening true --numbers-to-expressions true --string-array true --string-array-encoding base64,rc4 --string-array-threshold 0.8', { stdio: 'inherit' });

    const obfCode = fs.readFileSync(tempObf, 'utf-8');
    const finalContent = `${header}\n\n${obfCode}\n`;
    fs.writeFileSync(outputFile, finalContent, 'utf-8');
    console.log(`✓ 成功构建并写入 ${outputFile}`);
} finally {
    if (fs.existsSync(tempSource)) fs.unlinkSync(tempSource);
    if (fs.existsSync(tempObf)) fs.unlinkSync(tempObf);
}

console.log('正在验证最终混淆代码语法...');
execSync(`node --check "${outputFile}"`, { stdio: 'inherit' });
console.log('🎉 混淆版构建与语法校验全部成功！');
