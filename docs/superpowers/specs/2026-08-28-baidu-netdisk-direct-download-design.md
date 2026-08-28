# 百度网盘免客户端直链下载与 IDM 调用油猴脚本设计规格说明书

## 1. 目标与概述
构建一款高质量、现代化的 Tampermonkey（油猴）用户脚本，旨在解决百度网盘（网页版个人网盘与分享页）强制要求安装/启动客户端才能下载的问题。
脚本在网页端模拟客户端请求特征，提取高速直接下载链接（dlink），并深度整合 **IDM（Internet Download Manager）** 调用、**Aria2/Motrix RPC 推送**、**网页原生模拟下载** 与 **直链/cURL 导出** 功能。

---

## 2. 适用范围与脚本元数据（Metadata）

### 2.1 匹配网址
- 个人网盘：`https://pan.baidu.com/disk/main*`、`https://pan.baidu.com/disk/home*`
- 分享链接：`https://pan.baidu.com/s/*`、`https://pan.baidu.com/share/link*`、`https://pan.baidu.com/share/init*`

### 2.2 油猴特权授权（Grants）
- `GM_xmlhttpRequest`：跨域请求直链 API、模拟客户端 User-Agent 发送请求
- `GM_download`：调用油猴底层下载器实现直接下载
- `GM_setClipboard`：一键复制直链、cURL、IDM 命令及 UA
- `GM_getValue` / `GM_setValue`：本地持久化保存用户的 RPC 配置、IDM 路径等
- `GM_addStyle`：注入现代化磨砂质感与暗色/亮色自适应 UI
- `unsafeWindow`：读取网页内置全局变量与状态（如 `yunData`、`locals`）

---

## 3. 系统架构与核心模块划分

```
┌─────────────────────────────────────────────────────────────┐
│                       油猴脚本入口                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  DOM 注入与   │       │ 数据提取与   │       │  直链解析引擎 │
│  UI 交互模块  │       │ 会话识别     │       │ (Client API) │
└──────┬───────┘       └──────┬───────┘       └──────┬───────┘
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌────────────────────────────────┐   ┌────────────────────────────────┐
│        IDM 专用调用子系统        │   │       多协议下载与导出子系统     │
├────────────────────────────────┤   ├────────────────────────────────┤
│ 1. IDM 浏览器扩展直接拦截       │   │ 1. 网页内置流/GM_download 直下 │
│ 2. 导出带 UA 的 IDM .ef2 文件   │   │ 2. Aria2/Motrix JSON-RPC 推送  │
│ 3. 生成 IDMan.exe 命令行/批处理 │   │ 3. 原始 dlink / cURL 命令复制  │
└────────────────────────────────┘   └────────────────────────────────┘
```

---

## 4. 详细模块设计

### 4.1 页面数据提取与客户端模拟模块 (`Extractor & Client Simulator`)
1. **会话参数提取**：
   - 提取 `sign`、`timestamp`、`bdstoken`、`dp-logid`、`uk`、`shareid`。
   - 读取用户选中的文件列表（`fs_id`、`server_filename`、`size`、`isdir`）。
2. **直链接口请求 (Dlink Engine)**：
   - **个人网盘**：调用 `https://pan.baidu.com/api/download?type=dlink` 或 `https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas`。
   - **分享页面**：调用 `https://pan.baidu.com/api/sharedownload`，发送对应 `fid_list`、`extra` 签名。
   - **客户端 User-Agent 模拟**：
     - 默认特征 UA：`netdisk;11.24.3;PC;PC-Windows;10.0.19045;WindowsBaiduYunGuanJia`

---

### 4.2 IDM 专用调用与集成子系统 (`IDM Subsystem`)
提供三种互补的 IDM 调用与联动策略：

1. **方式 A：IDM 浏览器扩展直接拉起**
   - 触发网页下载指令，配合 IDM 浏览器集成扩展直接拦截。
   - 面板提供【一键复制 IDM 专用 UA】配置指引，避免出现 403 Forbidden。
2. **方式 B：一键导出 IDM `.ef2` 任务导入清单**
   - `.ef2` 是 IDM 的专有批量任务导入协议，内置独立 Headers。
   - 脚本动态构建 `.ef2` 纯文本内容并保存为 `[BaiduDirect]_filename.ef2`：
     ```text
     <
     https://d.pcs.baidu.com/file/...
     User-Agent: netdisk;11.24.3;PC;PC-Windows;10.0.19045;WindowsBaiduYunGuanJia
     Referer: https://pan.baidu.com/disk/main
     Cookie: BDUSS=...; STOKEN=...;
     file: example_filename.ext
     >
     ```
   - 用户在 IDM 中点击 `任务 -> 导入 -> 从 ef2 文件导入` 即可直接多线程满速下载，彻底免去配置全局 UA 的烦恼。
3. **方式 C：IDMan.exe 命令行生成与复制**
   - 自动生成精准的 IDM 启动命令：
     ```cmd
     "C:\Program Files (x86)\Internet Download Manager\IDMan.exe" /d "DLINK_URL" /f "FILE_NAME" /a /n
     ```
   - 提供【复制命令行】与【下载 .bat 一键脚本】两个快捷操作。

---

### 4.3 多协议下载与导出子系统 (`Multi-Protocol Downloader`)
1. **网页模拟直下**：
   - 使用 `GM_download` 或 `GM_xmlhttpRequest` 拉取文件流并触发浏览器下载器，实时反馈下载进度。
2. **Aria2 / Motrix JSON-RPC 一键推送**：
   - 支持向 `http://localhost:6800/jsonrpc`（可自定义 RPC URL、Token、保存路径）发送 `aria2.addUri` 请求。
   - 在 RPC 请求中附带 `header: ["User-Agent: netdisk;...", "Referer: ...", "Cookie: ..."]`。
3. **直链与 cURL 复制**：
   - 提取原始 `dlink` 链接并支持快速复制。
   - 生成标准的 `curl -L -A "netdisk;..." -H "Cookie: ..." "dlink" -o "filename"` 命令。

---

### 4.4 UI 界面与交互设计 (`Modern Glass UI`)
1. **注入位置**：
   - 在网盘顶部操作栏（如“分享”、“复制”旁）以及文件列表 hover 操作菜单中注入 **【⚡ 免客户端直链】** 按钮。
2. **控制面板组件**：
   - **头部**：选中的文件名称、大小与状态徽章。
   - **IDM 专区**：
     - `[ 🚀 IDM 扩展下载 ]`
     - `[ 📁 导出 IDM .ef2 任务 ]`
     - `[ 📋 复制 IDM 命令行 ]`
     - `[ ⚙️ 复制 IDM 专用 UA ]`
   - **其他下载选项**：
     - `[ 🌐 网页内直接下载 ]`
     - `[ 📡 推送至 Aria2 / Motrix ]`
     - `[ 🔗 复制直链 ]` / `[ 💻 复制 cURL ]`
   - **配置抽屉**：可配置 Aria2 RPC 地址/密钥、IDM 安装路径等。

---

## 5. 异常处理与降级机制

1. **未勾选文件或选择文件夹提示**：
   - 百度网盘不支持对文件夹直接获取单个 `dlink`，若用户勾选了文件夹，提示“请进入文件夹勾选具体文件或选择单文件”。
2. **接口返回验证码 (Captcha / SCode)**：
   - 当 API 返回需要验证码（如错误码 `-20` 或 `vcode` 需求）时，面板展示验证码输入框供用户实时输入后重试。
3. **直链失效/签名过期**：
   - 直链通常具有 8~24 小时有效期，面板提供【重新解析】一键刷新机制。

---

## 6. 验证与测试计划

1. **单文件解析测试**：在个人网盘与公开分享页测试不同大小文件（<50MB, >1GB）的直链提取准确性。
2. **IDM .ef2 导出测试**：验证导出的 `.ef2` 文件在 IDM 导入后能否正常读取 Header 并建立多连接下载。
3. **IDM 命令行测试**：验证复制的 `IDMan.exe` 命令在 Windows 终端中能否正确唤起并开始下载。
4. **RPC 推送测试**：验证 Aria2 / Motrix 是否能收到携带专用 Headers 的下载任务。
5. **网页直接下载测试**：验证 `GM_download` / 流下载功能。
