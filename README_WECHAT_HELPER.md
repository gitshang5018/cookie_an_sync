# 微信文件传输助手网页版 批量下载油猴脚本使用说明

## 📖 脚本介绍
本脚本专为微信文件传输助手网页版深度定制，同时完美支持官方双域名：
- [filehelper.weixin.qq.com](https://filehelper.weixin.qq.com/?from=webapp)
- [szfilehelper.weixin.qq.com](https://szfilehelper.weixin.qq.com/)

**100% 原生 UI 深度整合、零弹窗、零浮窗**，提供原始真实文件（PDF/Word/Excel等）、高清原图和视频的一键极速批量下载能力。

---

## ✨ 核心特性

1. **📥 极速批量直下**：
   - 采用队列极速直下机制，一键批量触发下载；
   - 深度接入 Tampermonkey 原生 `GM_download` 直下引擎，下载更稳定快速；
   - 智能赋予唯一序号文件名，杜绝同名覆盖。

2. **🎨 100% 微信原生 UI 深度整合（零弹窗 / 零抽屉）**：
   - **底部工具栏同行整合**：操作栏无缝嵌入到输入框上方的 `📁` 文件上传图标同一行（`.chat-panel__input-operations`）；
   - **聊天气泡即点即下**：每条文件或图片消息气泡下方均附带 `[ ⬇️ 真实原件 / ⬇️ 高清原图 ]` 极简标签；
   - **内嵌式进度指示**：下载时进度条直接在工具栏下方平滑展开，不遮挡任何界面元素。

3. **🎯 深度资源捕获与精准去重**：
   - **三层拦截体系**：底层 Fetch/XHR 拦截 + DOM 组件深度探测 + HTML5 Canvas 内存流自动兜底；
   - 以独一无二的 `MsgID` 与 DOM 实例作为特征 Key，精准识别全部文件与图片，绝不漏数或误合并。

4. **📜 自动向上拉取历史消息**：
   - 点击 **`📜 拉取历史`** 即可自动连续平滑向上滚动，触发微信加载更多历史记录并自动扫描入库。

5. **🔍 分类与即时过滤**：
   - 支持原生的分段切换标签：`[全部]`、`[原图]`、`[文件]`、`[视频]`；
   - 支持输入关键词实时过滤下载文件名。

---

## 🚀 安装步骤

1. **安装油猴插件**：
   - 推荐使用 [Tampermonkey (篡改猴)](https://www.tampermonkey.net/)、[ScriptCat (脚本猫)](https://docs.scriptcat.org/) 或 Violentmonkey。

2. **添加脚本**：
   - 打开油猴管理面板，点击 **“添加新脚本”**（或 `+` 号）。
   - 将 [wechat_filehelper_batch_downloader.user.js](file:///j:/Program%20Files/1/ztcookie/wechat_filehelper_batch_downloader.user.js)（混淆版）或 [wechat_filehelper_batch_downloader.source.user.js](file:///j:/Program%20Files/1/ztcookie/wechat_filehelper_batch_downloader.source.user.js)（源码版）的代码复制粘贴进去。
   - 按 `Ctrl + S` 保存脚本。

3. **使用方法**：
   - 打开微信文件传输助手网页版（以下任意官方地址均可）：
     - [https://filehelper.weixin.qq.com/?from=webapp](https://filehelper.weixin.qq.com/?from=webapp)
     - [https://szfilehelper.weixin.qq.com/](https://szfilehelper.weixin.qq.com/)
   - 手机微信扫码登录。
   - 在输入框上方 `📁` 文件夹图标右侧，即可看到原生工具栏：
     - 点击 **`📥 批量下载 (N)`**：一键连续下载当前所有捕获的文件与高清原图；
     - 点击 **`🔍 扫描`**：手动重新扫描当前聊天界面；
     - 点击 **`📜 拉取历史`**：自动向上连续翻页加载历史消息。
