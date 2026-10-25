# 烛光笔记 · Candlelight Notes

> 流光旁烛，知识成林

> Let light reach further; let knowledge grow into a forest.

导入论文、课件或讲义，让 AI 由浅入深、张弛有度地讲解学习资料，与你共同维护一份可编辑的学习笔记。选中内容即可追问、补充讲解或局部改写；“小纸条”融入正文，成为学习过程的一部分。

Import papers, slides, or lecture notes and build editable learning notes with AI. Explanations connect the bigger picture with local details. Select a passage to ask questions, add explanations, or revise it; inline explanation notes become part of the document.

学习树整理已有资料，也可围绕目标规划理想学习路径。知识节点区分阅读和实践，支持寻找可获取的论文、导入本地并继续学习。

Learning trees organize existing materials and can map an ideal path toward a goal. Nodes distinguish reading from practice, helping you find accessible papers, import them locally, and continue learning.

作者：[Yankai-D](https://github.com/Yankai-D) · [项目仓库](https://github.com/Yankai-D/Candlelight_Notes)

Author: [Yankai-D](https://github.com/Yankai-D) · [Repository](https://github.com/Yankai-D/Candlelight_Notes)

## 下载与使用 / Download and use

[下载 Windows x64 安装包和对外源码](https://github.com/Yankai-D/Candlelight_Notes/releases/tag/v0.1.32)。0.1.32 已通过本机工程验收，作为预发布版本提供。安装后从桌面或开始菜单打开“烛光笔记 Candlelight”，无需安装 Node 或浏览器。

[Download the Windows x64 installer and public source](https://github.com/Yankai-D/Candlelight_Notes/releases/tag/v0.1.32). Version 0.1.32 passed local engineering checks and is offered as a prerelease. Open “烛光笔记 Candlelight” from the desktop or Start menu; Node and an external browser are not required.

首次引导可填写学习画像和 DeepSeek 连接，也可直接跳过，之后在设置中调整。“?”、F1 和桌面帮助菜单提供分主题指南。发行包仅附三份描述性统计公开选编及完整署名，不含作者的 Key、画像、个人资料或笔记。

Initial setup offers a learning profile and DeepSeek connection; either step can be skipped and revisited in settings. The “?” button, F1, and desktop Help menu provide topic-based guidance. The distribution includes only three public descriptive-statistics selections with attribution, excluding the author's key, profile, personal materials, and notes.

导入支持文字 PDF、Word（DOCX）、PowerPoint（PPTX）、HTML/HTM、Markdown 和 TXT；JSON 用于恢复笔记备份。可批量选择文件或整个文件夹，保留嵌套资料包。批量默认只保存原件，在首次阅读或创建独立笔记时才提取正文，不逐文件生成 AI 笔记；单文件也可选择仅添加资料。

Import supports text-based PDF, Word (DOCX), PowerPoint (PPTX), HTML/HTM, Markdown, and TXT; JSON restores note backups. Import multiple files or whole folders while retaining nested bundles. Batch import saves originals by default and extracts text when first reading a material or creating an independent note, without generating notes for every file. Single-file import offers the same option.

旧版 DOC/PPT 需另存为新格式，扫描件需要外部 OCR。选择文件后，点击窗口外部或按 Esc 不会丢失填写内容；停止导入会先保存当前文件。原件保存成功不代表正文一定可解析，具体边界见 [导入格式](docs/import-formats.md)。

Legacy DOC/PPT files require conversion, and scans require external OCR. After selecting files, clicking outside the dialog or pressing Esc does not discard entered requirements. Stopping an import finishes saving the current file. Saving an original does not guarantee successful text extraction; see [import formats and limits](docs/import-formats.md).

资料和笔记默认保存在“文档／烛光笔记”，每次导入前确认位置。设置 → 资料存储提供完整备份、恢复、回收站和统一迁移，可将原文、笔记和学习树迁移到独立空目录。模型连接保存在本机 `.env`；卸载清除 Key，保留资料文件。真实生成会将相关资料、目标与上下文发送到用户配置的模型服务。

Materials and notes default to “Documents/烛光笔记,” with the destination confirmed before each import. Settings → Material storage provides backup, restore, a recycle bin, and migration of originals, notes, and trees to a separate empty directory. Model settings are stored locally in `.env`; uninstalling removes the key and retains material files. Live generation sends relevant materials, goals, and context to the user's configured model service.

安装版启动后检查 GitHub 公开版本，可打开下载页、稍后处理或跳过新版；帮助菜单支持手动检查。已有安装目录会原样复用。更新不会自动下载或执行安装包。

The desktop application checks public GitHub releases on startup. You can open the download page, defer, or skip a version, with a manual check in Help. Existing installation directories are reused. Updates do not automatically download or execute installers.

## 源码运行 / Run from source

需要 Node.js 24、npm 和 Git。浏览器版 PDF 导出与界面测试需要 Chrome、Edge 或 Chromium；Linux 还需中文字体。

Source builds require Node.js 24, npm, and Git. Browser-based PDF export and UI tests require Chrome, Edge, or Chromium; Linux also needs Chinese fonts.

```sh
npm ci
npm run dev:public
```

打开 <http://127.0.0.1:5173>。公开入口校验并准备随仓库附带的三份材料，不写入 Key。Windows PowerShell 若阻止 `npm.ps1`，使用 `npm.cmd`。Key 在应用设置中填写，配置字段见 [.env.example](.env.example)。

Open <http://127.0.0.1:5173>. The public entry point verifies and prepares the three bundled resources without writing a key. Use `npm.cmd` if Windows PowerShell blocks `npm.ps1`. Enter your key in application settings; fields are documented in [.env.example](.env.example).

`npm run dev` 使用调用者已有的本机资料配置。两种入口共用完整应用代码，个人配置、缓存、笔记和生成记录均被 Git 忽略。

`npm run dev` uses the caller's existing local material configuration. Both entry points share the complete application code. Personal configuration, caches, notes, and generation records are ignored by Git.

## 产品与 harness / Product and harness

- 连续长文阅读、章节定位、原文跟随、三种视觉主题，以及正文、小纸条和 PDF 共用的数学渲染。

  Continuous reading, chapter navigation, synchronized sources, three visual themes, and shared math rendering across main text, inline notes, and PDF.
- 翻译与适应性讲解独立保存；内置长文讲述、结构化讲义、题目讲解三套模板，支持自定义模板，通常总计最多五套。

  Translation and adaptive explanations are saved independently. Three built-in templates cover narrative explanations, structured lectures, and worked exercises, with custom templates bringing the normal total to at most five.
- 学习目标、稳定画像、来源范围和模板快照分别约束生成；画像改变铺垫深度，核心文风保持稳定。题解按小题原文、简短思路和必要解法组织，优先遵守仅提示或仅答案等要求。

  Goals, stable learner profiles, source scope, and template snapshots constrain generation separately. Profiles change prerequisite depth while retaining the core style. Exercises retain each subquestion, a concise approach, and the necessary solution, respecting requests for hints or answers only.
- 模板选择先判断任务，再判断资料类型；不一致结果进入同一任务的诊断与恢复流程。缺少题面或数据时明确缺项，不编造数值；当前不自动获取外部数据或运行统计代码。见 [学习任务](docs/learning-tasks.md)。

  Template routing considers the task before document genre; mismatches enter diagnosis and recovery within the same task. Missing questions or data are reported rather than invented; external datasets and statistical code are not fetched or executed automatically. See [learning tasks](docs/learning-tasks.md).
- “调整并重新生成”合并学习目标与修改意见，原正文和小纸条保留为历史版本；长期偏好在“设置 → 模板风格”中调整。

  “Adjust and regenerate” combines goal changes with revision feedback, retaining previous text and inline notes in history. Long-term preferences belong in Settings → Template style.
- 整份笔记共享进度与诊断记录，不再设置隐含的调用、恢复或正文修订次数额度。默认仅异常或可疑结果触发模型审查；问题须有实际定位与依据，定向修订后复查，通过后保存。正常输出仍经过结构、来源和公式校验。

  Each note-generation task shares progress and diagnostic records without implicit call, recovery or content-revision quotas. Model review runs only on anomalies or suspicious output by default. Findings need actual targets and evidence; targeted revisions are rechecked before saving. Normal output still receives structural, source and math validation.
- 联合笔记区分跨文件来源定位号与原文件页码。引用异常优先按可核对引文修复，否则只修引用元数据；恢复失败后暂停后续章节，保留完成内容，继续时跳过已完成章节。

  Multi-source notes distinguish cross-file reference IDs from original page numbers. Citation errors use verifiable quotations or targeted metadata repair. Missing external inputs or repeated non-progress preserve completed content; continuation reuses accepted stages.
- 共享锁、短暂网络故障有限重试；保存重试复用同一结果，诊断记录失败不否决有效生成。关键数据持续无法保存时保留原数据并暂停。见 [运行时 harness](docs/operational-harness.md)。

  Shared-file locks and transient network failures receive bounded retries. Save retries reuse the same result; diagnostic logging failures do not invalidate successful generation. Persistent essential-storage failures preserve existing data and pause the task. See the [operational harness](docs/operational-harness.md).
- 嵌套资料包与独立笔记复用原始资料正文；资料学习树和可重建、删除的理想学习树支持整理与规划。原文与笔记配套保存，支持缺失原文关联、冲突另存和生成请求追溯。

  Nested bundles and independent notes reuse extracted originals. Material trees and rebuildable, deletable ideal trees support organization and planning. Originals and notes stay together, with source relinking, conflict copies, and generation records.

架构见 [架构说明](docs/architecture.md)，演示路线见 [项目 walkthrough](docs/project-walkthrough.md)。讲述模板和长期使用反馈是持续维护的产品资产，证据与局限见 [产品质量](docs/product-quality.md)。

See the [architecture](docs/architecture.md) and [project walkthrough](docs/project-walkthrough.md). Explanation templates and long-term usage feedback are maintained product assets; evidence and limits are documented in [product quality](docs/product-quality.md).

0.1.32 取消单章修订、跨章共享额度、执行层调用与恢复次数，以及诊断调查轮数上限。旧记录的剩余额度不再阻断续接。恢复器可检查、搜索和原子修改当前候选，再通过原校验器；有效修正可持续进行，用户取消和重复无进展仍会停止。联合笔记按任务分析、资料分析、章节关系规划与逐章原文分析组织，讲义围绕精简知识点、方法、例题和变体写作。

Version 0.1.32 removes implicit chapter, shared-notebook, execution-call, recovery-action and investigation-turn ceilings. Exhausted legacy allowances no longer block continuation. The controller can inspect, search and atomically edit the current candidate before original validation; effective corrections can continue, while cancellation and repeated non-progress remain stopping conditions. Bundle notes use task analysis, material analysis, chapter relationships and per-chapter source analysis; lectures organize concise concepts, methods, examples and variations.

## 验证与构建 / Verification and builds

```sh
npm run check
npm run prepare:materials
# Windows x64: build the desktop installer
npm run package:desktop
```

`check` 使用隔离数据与模拟供应商，不读取个人 Key。源码保留测试、原创校准材料、公开材料选编及版本化开发实验，供复核重放。历史本机修订号仅标识证据来源，不代表其旧提交已包含在公开 Git 历史。

`check` uses isolated data and mock providers without reading personal keys. Tests, authored calibration cases, public selections, and versioned development experiments are retained for replay. Historical local revision IDs identify evidence sources; those private commits are not included in public Git history.

0.1.32 本机验收通过 **517 项测试和 15 个工程检查阶段**，包含浏览器流程，并验证 0.1.31 → 0.1.32 应用数据读取、重启保存及打包后的多格式解析。安装器解出的 36 个文件与受测程序逐字节一致，12,098 个内部应用与资源文件通过审计。隔离安装测试覆盖真实文件锁回退、重新安装及卸载保留资料；首次并行测试出现错误日志缺少文件名，原始失败记录已保留，随后未改代码的串行复测通过全部六项。见 [版本记录](docs/releases/v0.1.32.json)和 [公开发布说明](PUBLICATION.md)。

Local verification for 0.1.32 passed **517 tests and 15 engineering stages**, including browser workflows, application-data compatibility from 0.1.31, restart persistence and packaged multi-format parsing. All 36 extracted installer files match the tested application; 12,098 internal files passed auditing. Isolated transactions cover real file-lock rollback, reinstallation and retaining materials on uninstall. An initial parallel run lacked the filename in its failure log; the failure is retained, and an unchanged serial rerun passed all six transactions. See the [release record](docs/releases/v0.1.32.json) and [publication notes](PUBLICATION.md).

本轮取消额度的验证没有真实模型调用，不新增教学质量结论。异常触发审查不保证发现所有语义问题，工程验收不证明普遍教学优势或完整跨平台兼容。安装包未签名；安装测试使用本机隔离身份与目录，不等同于空白 Windows VM 验收。远程 CI 以 GitHub Actions 实际状态为准。

Quota-removal verification made no live model calls and establishes no new teaching-quality claim. Anomaly-triggered review cannot detect every semantic error; engineering checks do not establish a general teaching advantage or complete cross-platform compatibility. The installer is unsigned. Installation tests use isolated local identities and directories, not a clean Windows VM. GitHub Actions reports actual remote CI status.

安装包放在 Releases，不进入 Git 历史；源码快照附来源清单，发行资产附 SHA-256。自用开发历史、运行数据与临时产物不属于公开仓库。

Installers are distributed through Releases rather than Git history. Source snapshots include provenance manifests, and release assets include SHA-256 checksums. Private development history, runtime data, and temporary artifacts are excluded.

## 致谢与许可 / Acknowledgements and licensing

详见 [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)。感谢 EasyRead、DeepTutor 的产品思路参考，以及 React、Tiptap、PDF.js、MathJax、Electron 等开源组件。

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md). Thanks to EasyRead and DeepTutor for product-design references, and to open-source components including React, Tiptap, PDF.js, MathJax, and Electron.

描述性统计选编与样稿的作者、来源、改编说明和 CC BY-SA 许可见 [材料署名](materials/descriptive-statistics/ATTRIBUTION.txt)和 [课程说明](examples/course/README.md)。原创 Attention 示例用于演示与回归；论文开发探针保留出处和原文定位，不附用户导入的整篇论文。

Authors, sources, adaptations, and CC BY-SA terms for the statistics selections and samples are documented in [material attribution](materials/descriptive-statistics/ATTRIBUTION.txt) and the [course notes](examples/course/README.md). The authored Attention example supports demonstrations and regression tests. Paper-based probes retain sources and passage locations without bundling users' imported papers.

项目代码的开源许可证尚未指定，本次不自动添加 MIT、Apache 或其他许可证。第三方组件和学习材料各自的声明继续适用。

An open-source license for the project code has not yet been selected. This release does not add an MIT, Apache, or other license. Third-party components and learning materials retain their respective terms.
