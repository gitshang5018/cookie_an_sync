# 百度网盘免客户端直链下载与 IDM 调用油猴脚本 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建完整的百度网盘免客户端高速直链提取、IDM 专属调用/导出、Aria2/Motrix 推送及网页直接下载的油猴脚本。

**架构：** 脚本采用模块化结构（UI与样式、页面元数据提取、直链解析引擎、IDM专用子系统、RPC推送子系统、网页直下子系统、DOM动态挂载器），通过 GM API 模拟官方客户端特征实现无客户端直连下载。

**技术栈：** JavaScript (ES6+), TamperMonkey GM APIs (`GM_xmlhttpRequest`, `GM_download`, `GM_setClipboard`, `GM_getValue`, `GM_setValue`, `GM_addStyle`, `unsafeWindow`), IDM `.ef2` 规范, Aria2 JSON-RPC.

---

## 文件结构
- `baidu_netdisk_direct_downloader.user.js`：核心油猴脚本产物，包含全部逻辑与现代化 UI。
- `tests/test_script_syntax.js`：Node.js 自动化语法与模块逻辑自检脚本（用于验证核心解析与格式构造算法）。

---

### 任务 1：搭建单元测试与核心解析验证环境

**文件：**
- 创建：`tests/test_script_syntax.js`

- [ ] **步骤 1：编写核心算法验证测试代码**
编写测试脚本验证 `.ef2` 生成逻辑、cURL 命令生成逻辑、Aria2 RPC payload 构造逻辑。

- [ ] **步骤 2：运行 Node.js 测试验证**
运行 `node tests/test_script_syntax.js`。

- [ ] **步骤 3：Commit**
```bash
git add tests/test_script_syntax.js
git commit -m "test: add unit test for baidu netdisk helper core algorithms"
```

---

### 任务 2：编写油猴脚本核心实现 (`baidu_netdisk_direct_downloader.user.js`)

**文件：**
- 创建：`baidu_netdisk_direct_downloader.user.js`

- [ ] **步骤 1：编写元数据头部与样式注入模块**
包含所有 `@match` 规则、`@grant` 权限声明、现代化深色磨砂质感 CSS 样式（弹窗、按钮、Toast、输入表单、进度条）。

- [ ] **步骤 2：实现页面状态与文件元数据提取模块 (`Extractor`)**
支持个人网盘（`pan.baidu.com/disk/main`）与分享页面（`pan.baidu.com/s/*`），智能提取 `yunData`、`locals`、选中项 `fs_id`、`sign`、`timestamp`、`bdstoken` 等。

- [ ] **步骤 3：实现直链解析引擎 (`Dlink Engine`)**
调用百度网盘官方 API（个人盘 `xpan/multimedia` / `api/download` 与 分享页 `api/sharedownload`），模拟客户端请求头获取 `dlink`。

- [ ] **步骤 4：实现 IDM 专用调用子系统 (`IDM Subsystem`)**
1. 导出 `.ef2` 专用任务清单（内嵌 `User-Agent: netdisk;...`、`Cookie`、`Referer`）。
2. 生成 `IDMan.exe` 命令行与一键 `.cmd` 批处理文件。
3. 提供 IDM 浏览器扩展直接拉起与 UA 配置一键复制。

- [ ] **步骤 5：实现 Aria2/Motrix RPC 推送与网页直接下载模块**
1. 发送带 Client Headers 的 `aria2.addUri` JSON-RPC 请求。
2. 调用 `GM_download` / `GM_xmlhttpRequest` 流式下载。

- [ ] **步骤 6：实现 DOM 动态注入与事件交互绑定**
在网盘页面顶部操作栏注入【⚡ 免客户端直链下载】主按钮与文件列表悬浮按钮，绑定弹窗交互与设置面板。

- [ ] **步骤 7：验证并 Commit**
```bash
git add baidu_netdisk_direct_downloader.user.js
git commit -m "feat: implement baidu netdisk direct download and idm userscript"
```

---

### 任务 3：集成测试与说明文档编写

**文件：**
- 创建：`README_BAIDU_DOWNLOADER.md`

- [ ] **步骤 1：编写使用说明书与 IDM 配置图文指引**
详细说明安装方法、IDM .ef2 导入方式、IDM 扩展 UA 配置、Aria2/Motrix 推送配置。

- [ ] **步骤 2：运行语法自检并 Commit**
```bash
git add README_BAIDU_DOWNLOADER.md
git commit -m "docs: add user guide for baidu netdisk direct downloader userscript"
```
