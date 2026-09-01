# 微信文件传输助手网页版 批量下载油猴脚本使用说明

## 📖 脚本介绍
本脚本专为 [微信文件传输助手网页版 (filehelper.weixin.qq.com)](https://filehelper.weixin.qq.com/?from=webapp) 设计，提供文件、图片、视频的一键批量捕获与下载能力。

---

## ✨ 核心功能
- 📦 **一键打包 ZIP 下载**：采用客户端 JSZip 极速多线程打包，自动按分类（图片/、视频/、文档与文件/）归档，智能重命名防覆盖。
- ⚡ **分步依次下载**：支持单个文件直接下载或队列顺序下载。
- 📜 **自动向上拉取历史消息**：自动平滑滚动聊天记录，触发微信上拉加载，批量抓取早期的文件与图片。
- 🎯 **智能捕获机制（网络拦截 + DOM 深度扫描）**：
  - Hook 底层 Fetch 与 XHR 请求，捕获高清原图与原始媒体链接；
  - 结合 MutationObserver 实时监控新发来的文件和图片。
- 🔍 **丰富筛选与管理**：支持标签分类（全部/图片/文件/视频）、文件名实时搜索、全选/反选/清空。
- 🎨 **微信原生视觉风格**：右下角悬浮胶囊按钮，微信绿（`#07c160`）搭配半透明磨砂玻璃抽屉面板，带实时进度条与 Toast 提醒。

---

## 🚀 安装步骤

1. **安装油猴插件**：
   - 推荐使用 [Tampermonkey (篡改猴)](https://www.tampermonkey.net/)、[ScriptCat (脚本猫)](https://docs.scriptcat.org/) 或 Violentmonkey。

2. **添加脚本**：
   - 打开油猴管理面板，点击 **“添加新脚本”**（或 `+` 号）。
   - 将 [wechat_filehelper_batch_downloader.user.js](file:///j:/Program%20Files/1/ztcookie/wechat_filehelper_batch_downloader.user.js) 文件的全部代码复制并粘贴进去。
   - 按 `Ctrl + S` 保存脚本。

3. **使用方法**：
   - 打开微信文件传输助手网页版：[https://filehelper.weixin.qq.com/?from=webapp](https://filehelper.weixin.qq.com/?from=webapp)
   - 手机微信扫码登录。
   - 页面右下角将出现 **`📥 批量下载 (X)`** 悬浮按钮。
   - 点击展开面板后：
     - 若想下载历史文件，点击 **`📜 自动向上拉取历史`**；
     - 勾选需要的文件后，点击 **`📦 打包下载 ZIP`** 即可！
