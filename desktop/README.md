# Windows 桌面交付

桌面版使用 Electron 44.9.0，安装程序使用 electron-builder 26.15.3 / NSIS。0.1.19 增加启动时检查 GitHub 公开版本，以及“帮助 → 检查更新”；提供下载入口，不自动执行安装包。已有程序目录与已登记的安装位置直接复用，避免重复嵌套。程序尚无开发者数字签名。恢复预算和隔离安装路径测试见 [运行时 harness](../docs/operational-harness.md)。

这里的公开安装包是项目自用版本的干净迁移交付：共用功能代码与 harness，排除作者的 API 凭据、个人画像、资料、笔记、自定义模板及学习树状态。打包在独立输出目录中完成，项目内自用环境保持原有数据。新用户自行配置模型；升级时保留该使用者已有的数据。完整约定见 [自用与发行边界](../docs/engineering.md#自用环境与公开发行的边界)。

## 使用

安装 `Candlelight-Notes-0.1.20-Setup-x64.exe` 后，从桌面或开始菜单打开“烛光笔记 Candlelight”。正式英文名称为 Candlelight Notes。无需 Node/npm、Chrome/Edge 或脚本。模型配置仍由用户在设置中填写，写入本机 `.env`。

0.1.20 修正联合资料包的跨文件引用编号，增加仅修改引用的有界恢复与章节停止保护。整份笔记共享诊断记录和修正预算，仅异常或可疑结果触发模型审查；定向修订须复查通过才保存。原有完成章节保留，继续生成只处理未完成部分；不会在升级时重生成笔记。协议与测试范围见 [来源诊断与恢复](../docs/operational-harness.md#联合笔记的来源诊断与恢复)。

关闭窗口或通过文件菜单退出时，先向阅读窗口请求状态；任务进行中或仍有 AI 建议待确认时询问是否暂停。退出确认后取消正在执行的请求、等待学习树暂停状态写盘和笔记文件写入完成，再停止本机 HTTP 服务并退出。保存失败保留窗口，不直接丢弃内容。操作系统强制结束或断电不属于正常退出流程。

资料默认放在 Windows 文档目录下的 `烛光笔记`，每次导入前确认，成功后记住上次目录；设置可调整后续导入位置。每项资料有独立的原文副本与 `note.candlelight.json`，理想树和下载资料在资料目录的 `.candlelight/ideal-trees`。安装目录只存程序及内置描述性统计原文，禁止将用户资料目录设在程序或配置目录内。

`%APPDATA%\PangzhuNotes` 保存 `library-index.json` 路径索引、`preferences.json` 画像与偏好和 `.env` 模型连接。升级保留连接；真实卸载强制移除 `.env` 和 `.env.*.tmp`，清理缓存／日志，保留用户文件与轻量索引。旧 IndexedDB 和学习树在校验迁移后清理；未完成迁移的旧数据暂时保留，避免卸载造成丢失。

启动时识别默认资料目录与已记住的目录；资料库及“设置 → 资料存储”提供“识别已有笔记”，预览后关联 `note.candlelight.json` 和同目录原文，不复制文件。识别只恢复学习笔记，画像、连接和设置仍属于各自应用；尚未迁出旧浏览器 IndexedDB 的内容需要先在原应用完成迁移。编号冲突不覆盖，旧路径失效可重新关联，原文缺失允许只读查看笔记。共用笔记文件时，写入锁与文件摘要阻止并发或过时的内容覆盖。

0.1.13 增加完整备份、回收站、原文重新关联和冲突另存；恢复空间保留返回入口，API Key 不随备份迁移。生成依据与调用记录保存在资料目录，不挤占轻量应用配置。操作与边界见 [学习空间恢复](../docs/workspace-recovery.md)。

`node scripts/test-uninstall-policy.mjs` 编译并实际执行生产 NSIS 清理宏，目标固定为本轮临时目录，验证升级保留 Key、卸载必删 Key、清理缓存、保留文件和重复清理。它不注册产品、不操作个人安装，不替代完整安装器生命周期验收。

首次进入展示两步引导：空白学习画像、DeepSeek 连接。每步都可直接“跳过”，跳过画像不会保存草稿或补入默认背景；完成状态在本机保存。旧版未确认的固定示例画像会清空，自定义画像保留供用户确认。根系中的“清除画像，重新填写”只重置当前画像和引导进度，不改动笔记、资料、学习树或连接。侧栏帮助、F1 和桌面菜单使用同一份指南。

## 运行边界

- 主窗口使用固定 `pangzhu://app` 来源保存 IndexedDB，内部 HTTP 服务使用系统分配的空闲端口；端口变化不会创建新的笔记库。
- 窗口启用 sandbox、contextIsolation 和 webSecurity，禁止 Node integration。preload 只暴露退出保存回调；不暴露文件、进程或任意 IPC。
- 页面导航限定在应用来源，外部 HTTP(S) 链接交给系统浏览器，禁止外部页面获得应用权限。权限请求默认拒绝。
- PDF 共用 `printHTML` 和 `freezePrintLayout`，在临时、无 Node 权限的打印窗口中渲染，不调用外部浏览器。
- 程序从公共夹具重建描述性统计书单，不扫描个人资料库或读取项目 `.env`。源码、依赖、材料白名单和哈希写入随包清单。
- 安装程序按当前 Windows 用户安装，生成桌面和开始菜单快捷方式，保留用户数据。应用不注册系统服务或开机启动项。

## 构建与验收

```sh
npm ci
node node_modules/electron/install.js
npm run package:desktop
```

需要 Windows x64、Node.js 24 与已核验的 `output/pdf/descriptive-statistics/` 三份 PDF。运行时下载来源为 Electron 官方发行资源；版本固定在锁文件。默认输出 `output/releases/pangzhu-desktop-0.1.10`，目录已存在时拒绝覆盖，可用 `-- --out output/releases/<新目录>` 指定新位置。`--stage-only` 仅构建隔离载荷；`--dev` 跳过依赖复制和安装程序，供工作区内预览。正式构建要求干净 Git 工作区，缺少 Electron 运行时时在复制载荷前停止并提示安装命令。

```sh
node scripts/test-desktop.mjs <载荷的app目录或安装后的PangzhuNotes.exe>
```

验收使用独立中文／空格临时数据目录和无效配置哨兵，检查：三份公共材料、隔离配置与沙盒、重复启动、原文、内置 PDF、即时编辑后退出、服务停止和重启持久化。默认隐藏测试窗口；`--visible` 显示窗口并保存界面截图。测试关闭通过应用级退出执行，避免把 Chromium 禁止的网页 `window.close()` 当作原生关窗。报告位于 `artifacts/desktop`；不调用真实模型。

跨版本数据验收可加 `--previous <旧版PangzhuNotes.exe> --out artifacts/<新的证据目录>`：先由旧版在隔离目录建立笔记、保存设置并正常退出，再由新版读取同一数据目录，验证笔记和连接配置保留及再次重启。报告绑定两份 ASAR 的实际版本和 SHA-256，目录已存在时拒绝覆盖。旧版执行原生功能检查，新版执行数据恢复检查；这不替代安装器覆盖升级、快捷方式迁移或卸载测试。

安装程序验收命令（Windows PowerShell）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-desktop-installer.ps1 -Installer <安装程序的绝对路径>
```

脚本要求当前用户没有已安装的烛光笔记（含旧名旁烛笔记）、相应快捷方式或默认数据目录；发现已有状态会停止，避免影响个人使用。它在中文／空格临时目录内实际安装、核对快捷方式、运行上述应用验收、重新安装、卸载，并检查独立数据目录的标记始终保留。最后只清理自己创建的临时文件。报告为 `artifacts/desktop/installer-report.json`。

0.1.0 的实际安装、同版本重装与卸载验收见 [安装器发布证据](../docs/releases/v0.1.0-desktop.json)。0.1.1 保留安装器配置，更新理想学习树工作流；本次使用独立临时数据验证打包后的程序，不对已有个人安装执行卸载或升级测试。跨版本安装迁移不因源码兼容测试通过就视为已实测。安装包位于 `output/releases/pangzhu-desktop-0.1.1/installer/Pangzhu-Notes-0.1.1-Setup-x64.exe`，旁边附有 SHA-256 文件。

0.1.1 的工程检查、原树保护、重建反馈、界面及打包程序验收见 [0.1.1 记录](../docs/releases/v0.1.1-desktop.json)。未调用真实模型。

0.1.2 将窗口和快捷方式名称统一为“旁烛笔记 Candlelight”，正式英文名为 Candlelight Notes。旧的应用 ID、程序文件名、应用来源和个人数据目录保持稳定。新版编译、5 项相关测试及独立临时资料库中的桌面运行检查通过，详见 [0.1.2 记录](../docs/releases/v0.1.2-desktop.json)。未对现有个人安装执行升级或卸载，因此跨版本安装及快捷方式迁移仍未实测。安装包为 `output/releases/pangzhu-desktop-0.1.2/installer/Candlelight-Notes-0.1.2-Setup-x64.exe`，附 SHA-256 文件。

0.1.3 加入最新项目介绍、作者链接和可展开的致谢，安装包附带完整 `ACKNOWLEDGEMENTS.md`。安装程序为 `output/releases/pangzhu-desktop-0.1.3/installer/Candlelight-Notes-0.1.3-Setup-x64.exe`；下载压缩包为 `output/releases/pangzhu-desktop-0.1.3/Candlelight-Notes-0.1.3-Windows-x64.zip`，内含同一安装程序、校验文件、使用说明、致谢、第三方声明和资料来源。编译与打包程序运行检查通过，ZIP 中每个条目的 SHA-256 均与原始文件一致。结果见 [0.1.3 记录](../docs/releases/v0.1.3-desktop.json)。使用独立临时资料库验收，未对个人安装执行升级或卸载，也未调用真实模型。

0.1.4 将中文名改为“烛光笔记”，窗口和快捷方式显示“烛光笔记 Candlelight”。英文名、作者链接、致谢、应用标识和个人数据路径继续保留；当前界面、提示及协议中的产品称谓统一从品牌配置读取。编译、19 项相关测试、打包程序运行检查及 ZIP 条目校验通过，见 [0.1.4 记录](../docs/releases/v0.1.4-desktop.json)。安装包位于 `output/releases/pangzhu-desktop-0.1.4/installer/Candlelight-Notes-0.1.4-Setup-x64.exe`，压缩包位于 `output/releases/pangzhu-desktop-0.1.4/Candlelight-Notes-0.1.4-Windows-x64.zip`。未对个人安装执行升级或卸载，未调用真实模型。

0.1.5 换用为本项目绘制的蜡烛标志，界面、网页图标和原生图标从同一份矢量源生成，各尺寸直接渲染以避免放大模糊；绘制来源记录在致谢中。编译、5 项桌面及分发测试、打包程序运行检查、七种尺寸图标比对和 ZIP 条目校验通过，见 [0.1.5 记录](../docs/releases/v0.1.5-desktop.json)。安装包为 `output/releases/pangzhu-desktop-0.1.5/installer/Candlelight-Notes-0.1.5-Setup-x64.exe`，压缩包为 `output/releases/pangzhu-desktop-0.1.5/Candlelight-Notes-0.1.5-Windows-x64.zip`。名称、安装标识和数据路径保持不变；未对个人安装执行升级或卸载，未调用真实模型。

0.1.6 采用用户选定的 A「静烛」，统一界面、网页及原生图标的造型、线宽与颜色；导出的应用图标与选定提案逐字节一致。编译、5 项桌面及分发测试、三种主题预览、打包程序运行检查、七种尺寸图标比对和 ZIP 条目校验通过，见 [0.1.6 记录](../docs/releases/v0.1.6-desktop.json)。安装包为 `output/releases/pangzhu-desktop-0.1.6/installer/Candlelight-Notes-0.1.6-Setup-x64.exe`，压缩包为 `output/releases/pangzhu-desktop-0.1.6/Candlelight-Notes-0.1.6-Windows-x64.zip`。未对个人安装执行升级或卸载，未调用真实模型。

0.1.7 增加空白画像和 DeepSeek 连接的首次引导，两步均可直接跳过；支持保存进度、清除画像，以及侧栏／F1／桌面菜单共用的分主题帮助。编译、28 项相关测试、6 组浏览器流程、打包程序运行检查及 ZIP 条目校验通过，见 [0.1.7 记录](../docs/releases/v0.1.7-desktop.json)。最终跳过流程另外复测，确认草稿不被静默保存、留空不补入默认画像。安装包为 `output/releases/pangzhu-desktop-0.1.7/installer/Candlelight-Notes-0.1.7-Setup-x64.exe`，压缩包为 `output/releases/pangzhu-desktop-0.1.7/Candlelight-Notes-0.1.7-Windows-x64.zip`。未对个人安装执行升级或卸载，未调用真实模型。

0.1.8 增加可嵌套的联合资料包、独立笔记创建与改名、跨来源原文对照、范围快照、覆盖规划和断点续生成；使用现有模板与统一公式渲染。编译、71 项相关测试、7 组浏览器流程、打包程序运行检查和 ZIP 核验通过，见 [0.1.8 记录](../docs/releases/v0.1.8-desktop.json)。安装包为 `output/releases/pangzhu-desktop-0.1.8/installer/Candlelight-Notes-0.1.8-Setup-x64.exe`，压缩包为 `output/releases/pangzhu-desktop-0.1.8/Candlelight-Notes-0.1.8-Windows-x64.zip`。本轮生成验证使用模拟模型，不代表独立内容质量评测；个人安装没有执行升级或卸载。

0.1.10 纳入后端模块一致性修复，并按公开发行规则从同一功能代码生成干净安装包。冻结代码 `bbc41bd` 完成 306 项测试、7 组浏览器流程及全部 13 个检查阶段；新版桌面启动、PDF、退出恢复、0.1.9 → 0.1.10 隔离数据保留、12,058 个包内文件与 ZIP 校验均通过。详见 [0.1.10 记录](../docs/releases/v0.1.10.json)。安装包位于 `output/releases/pangzhu-desktop-0.1.10/installer/Candlelight-Notes-0.1.10-Setup-x64.exe`，另附同版本 ZIP 与 SHA-256。只预装三份描述性统计资料，保留作者和致谢，不含作者的 Key 或个人学习数据。未操作个人安装，未执行 NSIS 覆盖升级或卸载；安装包未签名、未推送 GitHub、未调用真实模型。

若应用已打包成功而 NSIS 构建中断，可在处理构建工具问题后运行 `node scripts/build-desktop-installer.mjs <现有桌面输出目录>`。该命令核验载荷清单并继续生成安装包，不重新编译应用。0.1.0 构建曾遇到 Windows 工具缓存目录重命名失败，校验下载归档及解压内容、恢复缓存状态后完成构建；未修改工具依赖或跳过完整性检查。

实现依据：[Electron 协议与存储](https://www.electronjs.org/docs/latest/api/protocol)、[安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[PDF 打印接口](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)、[NSIS 安装配置](https://www.electron.build/nsis/)。
