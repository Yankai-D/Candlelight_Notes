# 工程验收与维护

目标：一位没有参与开发的人，能从干净工作副本安装依赖、运行应用和测试，并解释一条 harness 执行记录。

0.1.13 增加 [完整学习空间维护](workspace-recovery.md) 与 [长期使用反馈和模板证据](product-quality.md)。完整门禁新增产品证据引用校验；浏览器维护套件使用隔离目录，验证回收、备份、恢复、原文关联和冲突另存，另跑 16 次编辑保存循环与 4 次刷新。加速回归不当作数小时稳定性结论。现有生产模板与样稿保持原样。

## 自用环境与公开发行的边界

项目内启动的应用是作者持续使用的个人学习环境。准备公开的安装包是同一套软件与 harness 的干净迁移版本，保留完整功能，以新的用户数据起步。两者共用功能代码，分别管理运行数据与发行产物。

| 项目 | 项目内自用环境 | 公开安装包 |
| --- | --- | --- |
| 模型连接 | 保留当前本机 `.env` 中的连接与 Key | 不携带作者的 Key、个人端点或连接配置；使用者自行填写 |
| 学习数据 | 保留个人资料、笔记、画像、自定义模板、学习树、阅读进度和偏好 | 不携带上述个人数据；全新用户从空白画像和默认模板开始，引导可跳过 |
| 示例资料 | 继续使用当前个人资料库 | 只附带核准的三份描述性统计公开资料及来源说明 |
| 更新方式 | 修复后按需要重新加载或重启，保持原有数据 | 从验收后的代码生成新安装包，单独核验包内文件、版本与隐私边界 |

打包只在新建发行目录中按白名单组装文件；准备公开版不清空、重置或迁移作者的自用环境。所谓“去除 API”指排除个人凭据与配置，模型接入能力仍保留。公开作者署名、仓库链接、致谢与材料许可照常保留。

测试在临时数据目录运行，不占用自用资料库。没有已有配置的新安装从空白画像开始；同一电脑的默认资料目录中若已有笔记，启动后可以识别它们。也可手动选择其他目录预览并关联，原笔记不改写，画像与 Key 不继承。已有安装的升级保留该使用者自己的数据，不因“公开包要干净”而清空；安装包本身不携带作者数据。

交付记录分别说明“自用服务已更新”和“公开候选包已更新”，注明各自对应的代码修订与验证结果。已有安装包不会因自用服务的源码修复而自动更新。

开发修改只落在项目源码；构建副本与发行产物放在项目的 `output/` 中。不得直接修改已安装应用的源码、`app.asar` 或安装目录文件来交付修复。安装版由用户运行新安装包更新。桌面验收使用项目内打包产物和隔离的临时用户数据，不替换日常使用的安装版或其资料。

Development changes belong in the project source; build snapshots and release artifacts live under the project's `output/` directory. Do not deliver fixes by editing an installed application's source, `app.asar`, or installation files. The user updates the installed application by running the new installer. Desktop verification uses project build artifacts and isolated temporary user data, without replacing the everyday installation or its materials.

涉及 Windows 安装器或卸载钩子的修改，除钩子测试外，必须运行 `npm run test:installer:upgrade -- <win-unpacked>`。该测试以独立注册身份执行完整安装、覆盖升级、旧卸载器失败、真实文件锁回滚、再次安装及卸载，不能用编译通过或解包校验替代。报告的钩子哈希必须与最终构建输入一致。

Changes to the Windows installer or uninstall hooks require `npm run test:installer:upgrade -- <win-unpacked>` in addition to hook tests. It performs full install, upgrade, legacy-uninstaller failure, real file-lock rollback, reinstall, and uninstall transactions under an isolated registration identity. Compilation and payload extraction do not replace these checks. Reported hook hashes must match the final build inputs.

## v0.1.0 的收束边界

本版收束为可运行、可演示、可复现验收的本地单用户工程基线。结束条件是：现有功能与生产 harness 固定；最终代码完成一次 `npm run check`；验收结果、范围和已知限制绑定到本地版本标签。后续质量评测不自动延长本版。封版记录见 [v0.1.0 验收与决策](releases/v0.1.0.json)。

保留现有长文和讲义模板，以及当前生产提示。证据约束候选已撤回，不因新增一条风格反馈重新启动付费调参。用户对 ResNet A 的反馈是有原文定位的局部阅读偏好，归档为开发依据；没有代填数字评分、修改生产提示或据此宣布普遍优势。

独立内容评分、扩大材料与留出集、进一步文风改进、练习答案质量评测、OCR 和多人服务属于后续工作。联合资料包的独立笔记入口及其恢复契约见 [嵌套资料包](bundle-notes.md)，结构测试不作为讲义质量结论。公开发布需要另行确定许可证、材料再分发范围并实际运行远程 CI；这些不被标记成本地封版已经完成的工作。

当前阶段暂停扩展数学自动复核，保留其历史实验与离线回归；它仍未启用到默认生成。[三场景真实输出](../evals/notes/runs/2026-10-18-product/README.md) 和后续 [证据约束对照](../evals/notes/runs/2026-10-18-evidence/README.md) 已归档。后者未达到本轮采用要求，生产后缀已撤回；独立人工审阅仍待完成。复用现有评测入口，不把测试数量、结构接受率或模型自评当作学习质量优势。对外展示按 [十分钟路线](project-walkthrough.md) 说明运行、恢复、质量证据与限制。

## 固定入口

Node 主版本由 `.node-version` 和 `package.json#engines` 约定为 24。`npm ci` 按 `package-lock.json` 安装；开发依赖更新应单独提交并重新运行检查。`.gitattributes` 统一文本行尾，避免 Windows 与 Linux 产生整文件换行差异。

```sh
npm ci
npm run check
```

`check` 串行执行环境、类型、构建、单元/集成、浏览器和 harness 演示；任一步失败即返回非零退出码并记录阶段，不把未运行阶段标为通过。运行报告不含 Key 或私人笔记。

| 层次 | 检验内容 | 不能证明的内容 |
| --- | --- | --- |
| 共享规则测试 | ID、范围、模板快照、修订、备份、资料归属 | 所有真实模型输出都准确 |
| DOM 测试 | 编辑、选区、切换、恢复与请求编排 | 实际浏览器的全部布局行为 |
| API 集成 | 真正的本地 HTTP、认证、模拟供应商、PDF 返回 | DeepSeek 当前线上可用性 |
| PDF / 浏览器验收 | 公式、导出、视口、文件夹、节点查找和导入 | 所有操作系统字体下像素完全一致 |
| Harness 演示 | 真实 runner 的中断、续接、校验与有界修订 | 模拟响应的教学质量等于真实模型质量 |
| 校准与失败回归 | 原创正反例的证据、评分记录、提交边界与修复次数 | 开发参考已经获得专家共识；真实模型已经达标 |
| 后续效果评测 | 真实材料上的内容、文风、覆盖和成本对照 | 一次评分等于用户已经学会 |

测试按文件串行运行，避免多套 Chromium 同时争抢资源导致服务器启动超时；不跳过 PDF 或 API 测试。HTTP 测试使用系统分配的空闲端口和临时目录，Key 显式为空或测试值，不依赖项目 `.env` 的真实配置。浏览器测试拦截模型与外部请求，误发模型请求会使验收失败。

## 查看结果

从 0.1.9 起，正式验收运行 `npm run check -- --require-clean --out artifacts/check-release`。显式输出目录必须尚不存在，防止覆盖上一轮证据；默认开发命令仍更新 `artifacts/check`。报告保存 Git 修订号、工作区状态、锁文件 SHA-256、全部未忽略源码的内容指纹，以及每阶段日志哈希。验收结束重新计算源码指纹，期间源码改变会使验收失败。报告中的路径/指纹不包含 `.env` 的内容。不同机器行尾或 Git 配置不同可能造成工作区指纹差异，应在同一干净检出中验收与打包。

完整发布复核流程及本轮结果见 [0.1.9 复核](reviews/2026-10-19-engineering.md)。桌面发行要求干净 Git 工作区；打包核对已安装生产依赖版本与锁文件，并记录同一源码指纹。`scripts/package-download.ps1` 创建白名单 ZIP；`node scripts/audit-desktop.mjs --check <报告路径>` 校验包内实际文件哈希、模型数据隔离、桌面烟测与源码验收的一致性。安装/升级/卸载验证单列，不能以解包程序烟测代替。

- `artifacts/check/report.json`：环境、阶段、耗时和失败原因。
- `artifacts/check/*.log`：每阶段标准输出与错误输出。
- `artifacts/browser/bundles/`：资料包转换、归属、索引、主题与窄屏截图。
- `artifacts/browser/ideal-tree/`：目标入口、树布局、节点论文导入、重复打开等截图。
- `artifacts/browser/settings/`：连接锁定与重置、阅读启动选项、手动选择、主题与窄屏截图。
- `artifacts/browser/calibration/`：离线工作册、跨画像与纸条显示、导入导出和草稿恢复截图。
- `artifacts/harness-demo/`：模拟供应商驱动真实执行器的结果、调用记录和检查报告。
- `artifacts/note-eval/`：笔记对照实验方案、匿名审阅页、原始轨迹；`check` 仅生成离线模拟结果。
- `artifacts/calibration/`：版本化的原创校准材料、参考解释、机械回归与审阅工作册；不包含真实模型结果。
- `artifacts/claim-eval/`：条件复核的冻结计划、分阶段检查点、原稿与修订候选；`check` 只运行模拟演示。

正式用例在 `tests/browser/`，不再依赖 `tmp/` 中的开发脚本或 `.local-library` 的私人资料。浏览器位置复用 PDF 的自动发现逻辑，也可通过 `READING_TREE_PDF_BROWSER` 指定。测试截图用于审阅；自动断言检验行为与尺寸，不宣称已经实现跨平台像素比对。

## 持续集成

`.github/workflows/ci.yml` 在 push、pull request 和手动触发时运行，Windows 与 Ubuntu 各执行 `npm ci` 和 `npm run check`。Ubuntu 安装中文字体。工作流仅申请仓库读取权限，不使用模型密钥；测试产物保留 14 天。失败同样上传已有记录。

当前工作流在本地准备；只有实际推送并观察平台结果后，才能声称远程 CI 通过。没有为这个项目创建远程仓库、推送或发布。

工作流参数参考官方 [setup-node v6](https://github.com/actions/setup-node/tree/v6)、[checkout v6](https://github.com/actions/checkout/tree/v6) 和 [upload-artifact v4](https://github.com/actions/upload-artifact/tree/v4)。

## 改动与版本

先保留可运行基线，再按问题提交小改动。一次提交应能说明触发条件、最终行为和验证方式；提示词与协议改变也需要解释兼容性。不要把未完成的结果、结构通过或人工样稿写成模型效果已经达标。

个人资料、Key、构建产物和运行记录由 `.gitignore` 排除。课程原始 PDF 可从保留的公开来源获取，不纳入 Git；测试所需的授权文本夹具和署名保留。当前代码许可尚未选择，不替作者决定公开授权。

笔记效果评测工具已建立，见 [实验说明](../evals/notes/README.md)。固定材料、模型与输出额度，比较直接调用、完整 harness 及样稿消融；机械检查与人工内容评分分开。[首轮真实开发诊断](../evals/notes/runs/2026-10-17-pilot/README.md) 已保存 6 份输出与逐段问题证据，尚无独立人工评分。`--inspect` 可从快照重算实际额度和用量，附加 `--out` 可零调用重建审阅页；执行器请求值与实际发送额度分别显示。后续版本的质量工作可从独立审阅和单项失败验证开始，再扩充材料并建立留出集；不作为本版工程封版的追加门槛。真实实验不能混入默认离线测试。

人工校准的准备材料已交付，见 [校准包](../evals/notes/calibration/README.md) 和 [失败定位指南](../evals/notes/calibration/FAILURES.md)。16 份原创候选全部通过生产格式校验，其中 8 份在开发参考中需要修改；这项断言明确记录当前校验器的语义边界。执行回归同时包含拒绝和允许通过的控制用例，检查错误类别、调用次数和输入不变。独立人工校准仍待进行，真实诊断中的 AI 初步问题不能冒充人工评分。

[操作一致性实验](../evals/notes/runs/2026-10-18-operation/README.md) 演示了提示改动的保留边界：先冻结规则、材料、判据与预算，校验两组实际请求只差一个 system 后缀，再记录真实结果和反向控制。本轮未显示可区分收益，规则继续留在 `evals/notes/operation-consistency.mjs`，应用不导入它。新增数值回归只证明具体反例，不冒充通用中文语义判错器。评测报告按实际实验组别解释用量差异，不能把单项后缀的开销错写成样稿开销。

条件与量词的 [独立复核实验](../evals/claims/README.md) 已加入离线验收。测试包括真实失败记录重放、原句与引文匹配、拒绝越界/重复/旧版本、取消、截断预算和公式编译。实际探针、原始响应和 AI 初步判断分开保存；数值反例只验证具体计算，不把模型自然语言当作已证明的结论。`npm run eval:claims -- --inspect <run.json> --out <新目录>` 可零调用重建并列审阅页。

`eval:claims -- --compare` 冻结 v1/v2 对照，`--demo` 注入离线响应，`--live` 仍必须显式列出 `--case`。两版来源、目标、模型和实际预算相同，报告保留协议带来的上下文与输出用量差异。原始坏 JSON 不自动修好后归档；算术、定位、原稿保留和主张语义分层记录。检查命令包含两版模拟演示，真实对照单独执行。

`eval:claims -- --focused` 冻结成立条件的任务收缩实验。两组均只诊断，每例最多一次供应商请求，实际截断重试也计入上限。新开发材料与已见失败回归分开标注；重放将接受的诊断与原始响应重新校验比对。`check` 包含其离线模拟，默认不做任何真实 API 调用。

`eval:field` 固定真实教材讲义试验，默认只保存计划，`--demo` 验证生成、窗口覆盖和人工工作册，真实模式必须显式选材料。`--inspect` 重放，`--summarize ... --review ...` 汇总逐句人工记录；输出写入新目录。浏览器验收包含展开前判断冻结、草稿刷新、导入导出和拒绝导入回退曝光记录。没有真实人工输入时不生成独立评测结论。

`eval:claims -- --meaning` 在同一复核契约上检验一个“解释文字与计算含义一致”的后缀，见 [调用前计划](../evals/claims/runs/2026-10-18-meaning-plan.md)。真实窗口与局部正确对照共享来源和上下文，报告逐单元列出漏检、误报及执行失败。共用原有单次调用边界和原始响应校验，不扩大 JSON 协议；`check` 只跑离线模拟。新旧实验均可从记录离线重放。

`eval:claims -- --calculation` 将复核拆成只读笔记的解释提取和带来源的比较，见 [两阶段计划](../evals/claims/runs/2026-10-18-calculation-plan.md)。提取与原稿及来源快照绑定；下一阶段不能悄悄替换中间解释，比较失败仍保留它。重放逐阶段重建实际上下文并从原始响应重新校验，检测错误引用、遗漏规则、冲突与最终判断不一致、越预算或被改动的中间数据。纯比喻和缺定义分别有退出路径；表达式不会执行，语义仍未认证。实验组两次调用与基线一次调用分开计成本。

## 运行问题

| 现象 | 处理 |
| --- | --- |
| PowerShell 阻止 npm.ps1 | 使用 `npm.cmd` |
| Node 版本不匹配 | 安装 Node 24，重新运行 `npm ci` |
| 找不到浏览器 | 安装 Chrome / Edge / Chromium，或设置 `READING_TREE_PDF_BROWSER` |
| 中文字体缺失 | Windows 安装中文字体；Ubuntu 安装 `fonts-noto-cjk`；可指定 `READING_TREE_PDF_FONT` |
| 浏览器启动权限错误或超时 | 在允许启动本机进程的普通终端验收；查看对应阶段日志 |
| 浏览器验收没有 dist | 先 `npm run build`，或者直接 `npm run check` |
| 5173 被占用 | 检查是否已有应用服务；测试本身使用随机端口，不需要停止日常服务 |
| 真实模型连接失败 | 在可联网终端启动应用；区分网络、端点、模型和 Key 错误；无需向日志或聊天粘贴 Key |

模型连接与阅读启动选项保存到本机 `.env`，日常服务重启后仍然有效。设置先校验，再串行原子写入，写入失败不改变当前连接；文件中其他变量和注释会保留。文件内显式保存的连接字段优先于继承的环境变量，包括主动清空的 Key。Key 不通过配置接口回传；测试草稿使用临时配置，不保存。“恢复默认连接”清除 Key，但保留阅读启动设置。

测试通过 `READING_TREE_ENV_FILE` 使用独立临时 `.env`，不会读取或写入日常服务的 Key，也不会重启日常服务。设置回归覆盖文件重载与新进程恢复、失败回滚、并发保存、草稿测试、重置，以及浏览器中的锁定、三种启动方式和独立笔记复用。后端、harness 或共享模块改动后必须重启服务；不通过查询参数单独重载 harness，以免新调用方与缓存的旧依赖混用。`tests/server-runtime.test.mjs` 在临时源码副本中增加导出及其调用，验证旧进程继续正常响应、完整重启后加载新版本。仅更新静态界面可重新构建后刷新。
