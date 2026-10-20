# 公开源码与发行包 / Public source and distribution

本仓库是 Candlelight Notes 0.1.20 的干净源码快照，配套 Windows x64 安装包在 GitHub Releases 下载。

This repository provides the clean source snapshot for Candlelight Notes 0.1.20. The matching Windows x64 installer is available through GitHub Releases.

## 与安装版的关系 / Relationship to the installer

应用代码与已验收安装包对应，其本机代码修订为 `cac01f34e7f2e7c320acf6a12357c53dc6094969`。公开时仅调整发行文档和移除历史记录中的自用运行信息，不改写应用依赖或讲述模板。构建时间和来源元数据可能变化，不承诺重建二进制逐字节相同。

Application code corresponds to the verified installer, built from local revision `cac01f34e7f2e7c320acf6a12357c53dc6094969`. Publication only adjusts distribution documentation and removes historical personal-runtime records; it does not alter dependencies or explanation templates. Build times and provenance metadata may change, so rebuilt binaries are not promised to be byte-identical.

本机通过 408 项测试、11 套浏览器流程和 14 个检查阶段，验证 0.1.19 → 0.1.20 数据读取、重启保存与打包后的 DOCX/PPTX/HTML 解析。最终安装器的 36 个外层文件与受测程序逐字节一致，内部 12,086 个应用与资源文件通过发行审计。见 [版本记录](docs/releases/v0.1.20.json)。

Local verification passed 408 tests, 11 browser suites, and 14 engineering stages, including application-data compatibility from 0.1.19, restart persistence, and packaged DOCX/PPTX/HTML parsing. All 36 outer installer files match the tested application byte-for-byte; 12,086 internal application/resource files passed distribution auditing. See the [release record](docs/releases/v0.1.20.json).

本次修正跨文件引用编号，并以整份任务维护进度、诊断和共享修正预算。默认仅异常或可疑输出触发模型审查，定向修订经复查后保存；无法解决时暂停后续章节，保留完成内容。已有笔记不会自动重新生成。协议与局限见 [运行时 harness](docs/operational-harness.md)。

This release fixes cross-file citation IDs and maintains progress, diagnoses, and a shared correction budget across the task. Model review runs only on anomalous or suspicious output by default. Targeted revisions are rechecked before saving; unresolved failures pause later chapters and retain completed content. Existing notes are not automatically regenerated. See the [operational harness](docs/operational-harness.md).

## 发布边界 / Publication boundaries

- 延续既有公开 Git 历史，不包含自用仓库历史或忽略文件。

  Existing public Git history is retained; private development history and ignored files are excluded.
- 不包含个人论文、笔记、画像、API Key、`.env`、生成记录或缓存；`.env.example` 的 Key 为空。

  Personal papers, notes, profiles, API keys, `.env`, generation records, and caches are excluded. The key in `.env.example` is empty.
- 历史发行 JSON 移除 `selfUse`，其余验收数据保留；旧修订号仅标识证据来源。

  Historical release JSON omits `selfUse` while retaining engineering evidence. Old local revision IDs identify evidence sources only.
- 测试与评测包含原创校准案例、带出处的公开论文片段、模型实验和去除身份信息的使用反馈，不是产品预装资料库。

  Tests and evaluations include authored calibration cases, attributed paper excerpts, model experiments, and de-identified feedback. These are not the preinstalled library.
- 预装学习材料限三份 OpenIntro 统计选编，附署名、许可和页码映射；另有原创 Attention PDF 用于回归。

  Preinstalled materials are limited to three OpenIntro statistics selections with attribution, licensing, and page mappings. An authored Attention PDF supports regression tests.

`PUBLIC-SOURCE.json` 记录文件摘要、应用代码对应关系和安装包摘要，不包含自身摘要。校验发行版本应使用对应 tag 或源码 ZIP；资产摘要见 Releases 的 `SHA256SUMS.txt`。本机验收记录保留当时状态，上传与远程 CI 状态以 GitHub 为准。

`PUBLIC-SOURCE.json` records file hashes, application-code provenance, and the installer hash, excluding its own hash. Verify a release using its tag or source ZIP and the `SHA256SUMS.txt` release asset. Local records retain their original status; GitHub records publication and remote CI outcomes.

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

完整 NSIS 安装、快捷方式和卸载生命周期尚未在空白 Windows 用户或 VM 中验收，安装包未签名。跨版本测试针对应用数据与重启，不等同于完整安装器验收。本轮没有真实模型调用；异常触发审查不能保证发现全部语义错误，也不构成独立教学质量评测。

The complete NSIS installation, shortcut, and uninstall lifecycle has not been verified in a clean Windows account or VM. The installer is unsigned. Cross-version checks cover application data and restarts, not the full installer lifecycle. This review made no live model calls; anomaly-triggered review cannot guarantee detection of every semantic error and is not an independent teaching-quality evaluation.

项目代码尚未指定开源许可证，第三方软件和学习资料保留各自许可；详见 [致谢](ACKNOWLEDGEMENTS.md)。

The project code has no selected open-source license. Third-party software and learning materials retain their own terms; see [acknowledgements](ACKNOWLEDGEMENTS.md).
