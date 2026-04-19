# 🚀 LAN Cookie Sync | 局域网 Cookie 同步神器

[![Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Edge%20%7C%20Chrome-blue.svg)]()
[![UI](https://img.shields.io/badge/Design-Modern_Dark-blue.svg)]()

**LAN Cookie Sync** 是一款专为解决素材站、会员网站“单账号限制登录设备数量”而设计的局域网同步工具。它通过 WebSocket 技术实现 Cookie 的秒级实时推送，让您的多个设备如同共用一个浏览器会话。

---

## ✨ 核心特性

-   **🛠️ 工业深色风**：发送端与接收端插件均采用硬朗的 **Modern Dark** 视觉设计，交互直观，运行稳定。
-   **⚡ 实时同步**：基于 WebSocket 协议，实现跨设备 Cookie 秒级同步，无需手动刷新（接收端自动重载）。
-   **🛠️ 强大中转**：采用 C# WPF 开发的高性能中转服务器，支持本地持久化缓存，确保同步稳定。
-   **🔒 隐私安全**：全过程数据流转仅在局域网内完成，不经过第三方服务器，确保账号信息安全。

---

## 📂 项目结构

```text
.
├── CookieSyncServer/     # C# WPF 中转服务器源码
├── extension-sender/     # 发送端浏览器插件 (已登录账号的电脑使用)
├── extension-receiver/   # 接收端浏览器插件 (其他需要同步的电脑使用)
├── CookieSyncServer.exe  # 已编译的服务器执行文件
└── sync_cache.json       # 服务器本地缓存文件
```

---

## 🛠️ 快速上手

### 第一步：启动中转服务器

1.  在局域网内任意一台 Windows 电脑上运行 `CookieSyncServer.exe`。
2.  服务器启动后会显示 **WebSocket 地址** (例如：`ws://192.168.1.5:3000`)。
3.  **保持该窗口运行**。

> [!TIP]
> 如果您想从源码运行，请使用 Visual Studio 打开 `CookieSyncServer.csproj` 并编译。

### 第二步：安装浏览器插件

1.  在 **Edge/Chrome** 浏览器中打开 `扩展管理` (edge://extensions 或 chrome://extensions)。
2.  开启 **“开发人员模式”**。
3.  点击 **“加载解压的扩展”**：
    *   在**发送端**电脑（已有登录状态的电脑）加载 `extension-sender` 文件夹。
    *   在**接收端**电脑（需要同步登录的电脑）加载 `extension-receiver` 文件夹。

### 第三步：配置与同步

#### 📡 发送端操作：
1.  点击插件图标，输入服务器地址（如 `192.168.1.5:3000`）。
2.  输入目标域名（如 `699pic.com`）。
3.  点击 **“立即推送同步”**。

#### 📥 接收端操作：
1.  点击插件图标，输入同样的服务器地址。
2.  点击 **“开始监听”**。
3.  状态变为 **“已连接”** 后，一旦发送端推送，接收端将自动同步 Cookie 并刷新页面。

---

## ⚠️ 注意事项

-   **防火墙设置**：若无法连接，请确保服务器端的 **3000 端口** 已在 Windows 防火墙中开放。
-   **域名匹配**：建议输入主域名（如 `baidu.com`），插件会自动处理该域名下的所有相关 Cookie。
-   **局域网环境**：请确保所有设备处于同一 Wi-Fi 或局域网段内。

---

## ❓ 常见问题 (FAQ)

**Q: 接收端显示“连接断开”？**
A: 请检查服务器是否正在运行，以及 IP 地址是否填写正确。

**Q: 同步后页面没有自动登录？**
A: 请检查发送端输入的域名是否与当前网页完全匹配。部分网站可能需要清除旧的 Cookie 后再同步。

**Q: 安全性如何？**
A: 本工具仅在您的局域网内传输数据。只要您的局域网是安全的，您的 Cookie 就是安全的。

---

## 📜 开源协议

本项目仅供学习交流使用，请勿用于非法用途。
