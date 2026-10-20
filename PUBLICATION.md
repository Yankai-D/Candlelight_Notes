# 公开源码与发行包 / Public source and distribution

本仓库是 Candlelight Notes 0.1.26 的干净源码快照，配套 Windows x64 安装包在 GitHub Releases 下载。

This repository provides the clean source snapshot for Candlelight Notes 0.1.26. The matching Windows x64 installer is available through GitHub Releases.

## 与安装版的关系 / Relationship to the installer

应用代码对应已验收安装包，本机代码修订为 `90d477cef75581e36d734e005627322df98a7171`。公开时仅调整发行文档并移除历史记录中的自用运行信息，不改写应用依赖、测试或讲述模板。构建时间和来源元数据可能变化，不承诺重建二进制逐字节相同。

Application code corresponds to the verified installer built from local revision `90d477cef75581e36d734e005627322df98a7171`. Publication adjusts distribution documentation and removes historical personal-runtime records without altering application dependencies, tests, or explanation templates. Build times and provenance metadata may change; rebuilt binaries are not promised to be byte-identical.

本机通过 446 项测试、11 套浏览器流程、14 个检查阶段及 10 项桌面检查，验证 0.1.25 → 0.1.26 数据读取与重启保存。安装器解出的 36 个文件与受测程序逐字节一致，12,091 个内部应用与资源文件通过审计。见 [版本记录](docs/releases/v0.1.26.json)。

Local verification passed 446 tests, 11 browser suites, 14 engineering stages, and 10 desktop checks, including application-data compatibility from 0.1.25 and restart persistence. All 36 extracted installer files match the tested application byte-for-byte, and 12,091 internal application/resource files passed auditing. See the [release record](docs/releases/v0.1.26.json).

本次加入有状态阶段执行、诊断与有限恢复，保留已完成阶段并分开管理协议恢复和正文修订预算。修正代码中的 `$` 被误判为公式定界符的问题；错误诊断带上具体字段、位置及局部上下文。协议与局限见 [运行时 harness](docs/operational-harness.md)。

This release adds stateful execution, diagnosis, and bounded recovery, preserving accepted stages and separating protocol recovery from content-correction budgets. It fixes code dollars being misread as math delimiters and adds field, offset, and local-context diagnostics. See the [operational harness](docs/operational-harness.md) for protocols and limits.

## 发布边界 / Publication boundaries

延续既有公开 Git 历史，不包含自用开发历史、个人论文、笔记、画像、API Key、`.env`、生成记录或缓存。`.env.example` 的 Key 为空。历史发行 JSON 移除 `selfUse`，其余验收数据保留；旧修订号仅标识证据来源。

Existing public Git history is retained. Private development history, personal papers, notes, profiles, keys, `.env`, generation records, and caches are excluded. The key in `.env.example` is empty. Historical release JSON omits `selfUse` while retaining engineering evidence; local revision IDs identify evidence sources only.

测试与评测包含原创校准案例、带出处的公开论文片段、模型实验和去除身份信息的使用反馈，不是产品预装资料库。预装学习材料限三份 OpenIntro 统计选编，附署名、许可和页码映射；另有原创 Attention PDF 用于回归。

Tests and evaluations contain authored calibration cases, attributed public-paper excerpts, model experiments, and de-identified feedback, not a preinstalled personal library. Bundled learning materials are limited to three OpenIntro statistics selections with attribution, licensing, and page mappings. An authored Attention PDF supports regression tests.

`PUBLIC-SOURCE.json` 记录文件摘要、应用代码对应关系和安装包摘要，不包含自身摘要。核对发行版应使用对应 tag 或源码 ZIP；发行资产摘要见 Releases 的 `SHA256SUMS.txt`。本机验收记录保留当时状态，上传与远程 CI 状态以 GitHub 为准。

`PUBLIC-SOURCE.json` records file hashes, application-code provenance, and the installer hash, excluding its own hash. Verify a release using its tag or source ZIP and the `SHA256SUMS.txt` asset. Local records retain their original status; GitHub records publication and remote CI outcomes.

## 本地复现 / Local reproduction

```sh
npm ci
npm run dev:public
```

完整检查为 `npm run check`。Windows x64 构建安装包：先执行 `npm run prepare:materials`，再执行 `npm run package:desktop`。打包要求干净 Git 工作区；从源码 ZIP 开始时先初始化 Git 并提交源码。

Run `npm run check` for full verification. To build the Windows x64 installer, run `npm run prepare:materials`, then `npm run package:desktop`. Packaging requires a clean Git worktree; when starting from the source ZIP, initialize Git and commit the source first.

测试使用隔离数据和模拟模型，不读取个人 Key，也不自动发起付费试验。浏览器版 PDF 与界面测试需要 Chrome、Edge 或 Chromium；Linux 需要中文字体。安装版内置运行时及 PDF 引擎。

Tests use isolated data and mock models without reading personal keys or starting paid experiments automatically. Browser-based PDF and UI tests need Chrome, Edge, or Chromium, plus Chinese fonts on Linux. The installer bundles its runtime and PDF engine.

## 当前验证范围 / Verification limits

本次发布验收没有新增真实模型调用。旧响应回放通过了具体故障检查，不代表新版整份八章任务的真实复测。恢复控制器与审查者使用同一配置模型，可能共享推理错误；异常触发审查不能发现所有语义问题。工程验收不构成独立教学质量评测。

This release verification made no new live model calls. Saved-response replay passed specific failure checks, not a new live end-to-end run of the full eight-chapter task. The recovery controller and reviewer use the same configured model and may share reasoning errors. Anomaly-triggered review cannot detect every semantic issue; engineering checks are not independent teaching-quality evaluations.

完整 NSIS 安装、快捷方式和卸载生命周期仍待空白 Windows 用户或 VM 验收，安装包未签名。跨版本测试针对应用数据与重启，不等同于完整安装器生命周期验收。

The complete NSIS installation, shortcut, and uninstall lifecycle still needs verification in a clean Windows account or VM. The installer is unsigned. Cross-version checks cover application data and restarts, not the entire installer lifecycle.

项目代码尚未指定开源许可证，第三方软件和学习资料保留各自许可；详见 [致谢](ACKNOWLEDGEMENTS.md)。

The project code has no selected open-source license. Third-party software and learning materials retain their own terms; see [acknowledgements](ACKNOWLEDGEMENTS.md).
