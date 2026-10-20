# 有状态执行与自动恢复 / Stateful execution and recovery

`server/execution.mjs` 是生成链路共用的执行层。它把一次用户操作拆为有输入绑定、候选结果、校验器和检查点的阶段；出错时恢复当前阶段，已经通过的阶段继续复用。接入范围包括笔记生成、来源定位、内容审查、建议复核、局部修订、模板选择与编辑、资料分类、联合笔记规划、理想学习树创建与重建，以及独立讲义生成器。

`server/execution.mjs` is the shared execution layer. Each stage has bound inputs, a candidate, a validator and a checkpoint. Recovery resumes the failing stage and reuses accepted work. Integrations cover note generation, citations, review, advice auditing, targeted revision, template routing/editing, classification, bundle planning, ideal-tree creation/rebuilding, and the standalone lecture generator.

## 执行状态与恢复策略 / State and strategies

正常路径是 `pending → produced → accepted`。模型响应先进入本机检查点，再校验和提交；失败进入 `recovering`，保留失败结果、具体字段约束、已尝试方法和累计调用次数。一次性修复失败不直接返回前端，而是在同一操作中继续诊断。

The normal path is `pending → produced → accepted`. A response is checkpointed before validation. Failures enter `recovering`, retaining the candidate, concrete constraint failures, previous strategies and call totals. A failed first repair continues within the same operation.

首次失败把校验结果和原任务交给模型定向修复。后续由 `execution-recovery-plan-v1` 读取原始约束、实际失败输出、校验路径与尝试历史，选择以下程序允许的动作。策略不依赖某篇论文、具体页码或预先枚举的报错文字。

The first failure receives targeted feedback. Subsequent diagnosis uses the original contract, actual rejected output, validator paths and attempt history to choose from application-defined capabilities. Strategy selection does not depend on a paper, particular page number or catalogue of known error messages.

| 动作 / Action | 执行范围 / Scope |
| --- | --- |
| `repair` | 基于现有候选修复当前步骤。 / Repair the current candidate. |
| `reframe` | 从原始任务重新推导当前步骤，用失败候选作对照；不重跑前序正文。 / Re-derive this stage from its original contract, retaining the rejected candidate as context. |
| `partition` | 仅能调用程序提供的拆分器；多条审查意见可逐条复核，多目标修改对同一正文快照分别处理后统一校验。 / Use an application-supplied partitioner; audit findings separately or merge independent edits against one immutable snapshot. |
| `stop` | 缺少外部输入、无可靠处理方法时保留状态。 / Preserve state when required inputs or a defensible recovery path are unavailable. |

恢复计划本身有严格 schema 与失败摘要绑定。非法计划最多触发一次确定性的换策略，不递归调用“修复恢复计划”。同一候选、同一失败不能无限重复同一方法；无进展时选择尚未尝试的方法，耗尽后明确停止。模型不能提供任意命令、文件路径、工具名或新的校验规则。

Recovery plans have a strict schema and failure digest. Invalid plans trigger a bounded fallback rather than a recursive controller-repair loop. Identical failures cannot repeatedly use the same strategy. The model cannot supply commands, paths, arbitrary tools or replacement validators.

## 结果与预算的边界 / Acceptance and budgets

所有恢复结果必须通过原校验器。正文范围、来源身份、精确引文、数学格式、模板约束和修订定位不因恢复而放宽。已经通过校验的审查意见必须在建议复核中逐项得到决定，补丁不能遗漏或增加问题。未通过校验的审查草稿保留作恢复与复核的参考，不把其中矛盾、撤销或不完整的批评固定为编辑要求。

Every recovered result passes the original validator. Recovery never relaxes source identity, exact quotations, math formatting, template constraints or edit scope. Validated findings require individual audit decisions; patches cannot omit or invent findings. Rejected review drafts remain diagnostic context without turning their contradictory, withdrawn or incomplete criticism into editing requirements.

普通逻辑请求默认最多 32 次真实 HTTP 尝试、8 个恢复动作、单阶段最多 3 个恢复动作；诊断、子阶段、传输重试和 token 扩展都占用同一实际调用预算。章节的内容修订另计：每章最多 3 次，整份任务每轮共享 `min(12, max(3, 章节数))` 次；协议故障不会耗光正文纠错额度。理想学习树保留整次构建 160 次请求上限，恢复动作最多 32 次。取消立即传播，预算不会在自动恢复中重置。

An ordinary logical request allows at most 32 actual HTTP attempts, eight recovery actions and three actions per stage. Diagnosis, child stages, transport retries and token expansion share the call ceiling. Content correction has a separate limit of three revisions per chapter and `min(12, max(3, chapter count))` per notebook attempt. Ideal trees retain their 160-request construction limit and allow at most 32 recovery actions. Cancellation propagates immediately; automatic recovery never resets a budget.

笔记按章提交并即时保存。当前章内部保留生成、定位、审查和修改检查点，只有整章通过才交付正式笔记。服务重启或外部问题解决后，同一任务的显式继续复用检查点；改变目标、资料、版本、模板、模型或端点会失效。新建重新生成任务不会沿用旧任务结果。复用的审查单独计入 `reusedReviewStages`，不冒充新的真实模型调用。

Accepted chapters are committed and saved individually. Within a chapter, generation, citation, review and revision checkpoints survive interruptions, but only an accepted chapter enters the notebook. Explicit continuation of the same task reuses checkpoints; changed goals, sources, revisions, templates, models or endpoints invalidate them. A new regeneration task starts fresh. Cached review proofs are reported separately as `reusedReviewStages`, not as new model calls.

详细检查点位于本机 `.candlelight/generation-records` 或理想学习树文件中，包含私人任务上下文和模型结果，不包含认证头或 Key，不进入公开包。生成记录沿用 20 份 / 64 MB 的保留策略，单份上限 32 MB；超过上限或写入失败时不能声称已持久化。普通恢复日志仅记录阶段、错误码和次数，约 512 KB 轮转，不保存原文。理想学习树的公开接口不暴露执行检查点。

Detailed checkpoints live in local generation records or ideal-tree files. They contain private task context and model results, never authorization headers or keys, and are excluded from public packages. Generation records retain at most 20 records / 64 MB with a 32 MB per-record ceiling; a failed checkpoint write is not durable. The rotating diagnostic log contains only stage names, codes and counts. Public tree responses exclude execution checkpoints.

## 审查与来源 / Review and grounding

默认仍为“仅异常或可疑结果触发内容审查”。结构、引用和数学检查始终执行。审查读取目标、模板、章节分工、完整当前来源和确切正文，检查目标交付、覆盖、来源边界与连贯性；提出问题后先复核批评和建议是否成立，再定向修改并复查。未改段落保留，补丁对同一快照操作并产生明确的位置映射。无法消除的分歧不会被程序猜成通过。

Content review remains anomaly-triggered by default; structural, citation and math checks always run. Review receives the goal, template, chapter responsibility, complete current evidence and exact candidate. Proposed criticisms are audited before targeted editing and rechecking. Untouched blocks remain intact, and patches operate against one snapshot with explicit index mappings. Unresolved disagreement is never inferred to be acceptance.

联合资料的原文件页码只用于显示，扁平来源 ID 用于定位。程序优先做有唯一逐字证据的本地映射；否则运行独立定位阶段，模型选择按内容绑定的 `sourceEvidenceIds`，程序回填原句并严格核验。定位故障不会重新生成整段正文。多来源段落可分别选择各来源证据，无需不同文件包含同一句话。

Original page numbers are display metadata; flattened source IDs identify evidence. Unambiguous exact-quote mappings are repaired locally. Other cases enter a citation stage where the model selects content-bound excerpt IDs and the application resolves and verifies exact text. Citation recovery preserves prose, and multi-source paragraphs can select distinct evidence from each source.

联合资料适应性整合在 48,000 来源字符内整章生成，其他阅读以 18,000 字符分段；来源不会被静默截去。后续片段收到已验收的完整前文块用于衔接，不把前文当成新来源。审查只检查本章/片段承担的任务，不要求每章覆盖整套课程。

Adaptive bundle synthesis keeps chapters together up to 48,000 source characters; other reading uses 18,000-character segments without silently dropping source text. Later segments receive accepted writing context for continuity, not as new source evidence. Review respects chapter and segment responsibilities.

## 运行环境错误 / Runtime failures

确定性的运行环境问题仍由专用层处理：原子文件写入对短暂 Windows/OneDrive 锁重试同一份快照，绝不先删旧文件；暂时连接故障按退避与共享传输额度重试。认证失败、磁盘已满或用户取消不能靠模型编造解决。日志保存失败不会使有效正文重新调用模型；关键数据持续无法保存时仍需明确暂停。

Deterministic runtime failures remain in dedicated layers: transient Windows/OneDrive locks retry the same atomic snapshot without deleting the old file, and temporary connection failures use bounded backoff. A model cannot invent a fix for invalid credentials, full disks or cancellation. Diagnostic failures do not regenerate valid prose; persistent failure to save essential data still requires a pause.

## 验证与限制 / Evidence and limits

`tests/execution.test.mjs` 使用全新约束验证通用诊断、换策略、拆分、取消、调用预算、检查点失效和日志失败。`tests/execution-integration.test.mjs` 验证持续不确定的审查能在一次操作中恢复、多目标补丁统一提交，以及真实本机记录的续接不会重跑已完成正文或泄露凭据。其余笔记、模板、分类、理想学习树与文件系统测试保留原有内容边界检查。

The execution tests use novel constraints to check diagnosis, strategy changes, partitioning, cancellation, budgets, cache invalidation and failed diagnostics. Integration tests cover resolving uncertain reviews within one operation, atomic multi-target edits, and continuation from real local records without regenerating accepted prose or persisting credentials. Existing adapter and filesystem suites retain their correctness checks.

这些是离线、合成故障和保存响应的回放证据，不是新一轮真实模型成功率。此轮没有追加真实 API 调用。独立论文搜索和研究评测工具仍有各自的有界执行器，不能据此宣称项目内每个模型工具已经迁移。审查者与恢复调度使用同一用户配置模型，仍可能共享认知错误；该机制不等于数学证明或教师评测。

These are offline fault-injection and saved-response replay checks, not a new live-model success rate. No additional live API calls were made in this round. Independent paper search and research-evaluation utilities retain their own bounded runners; not every model utility has migrated. Review and recovery use the configured model and can share its reasoning errors; they are not mathematical proof or independent teacher evaluation.


## 批量资料与独立笔记

资料导入分为三个阶段：保存原件及轻量记录 → 首次需要时提取正文 → 按学习目标生成笔记。前两阶段不调用模型。

- 一批最多 100 份、每份最多 50 MB；文件夹选择保留最多 12 层目录，新文件夹作为联合资料包。辅助图片等未支持格式会提示跳过。
- 批量默认“仅添加资料，需要时再生成”。单文件也能选择此项；另一选项是在打开时沿用阅读启动设置。
- `sourceState: deferred` 表示尚未读取正文；空兼容占位页不会传入生成。原文件成功保存后即完成导入，扫描件或坏正文在真正读取时报告，原件仍保留。
- 创建独立笔记时读取当前包及后代全部原始资料，提取后缓存。第二份讲义或题解复用正文缓存，各自拥有目标、来源快照和生成历史；不依赖成员文件的 AI 笔记。
- 停止导入在当前文件保存完成后生效，成功文件保留；失败文件可单独重试。同编号的重放必须同时匹配原件与记录内容，才确认成功，不覆盖其他版本。

范围和正文质量限制仍见 [联合资料包](bundle-notes.md) 与 [导入格式](import-formats.md)。当前没有 OCR 或跨文件的隐式删节；超出来源快照上限会明确停止。

## 更新与安装位置

安装版显示主窗口后后台检查 GitHub 的公开 Releases，8 秒超时、2 MB 响应限制；失败不阻止启动。版本按数值及 prerelease 顺序比较，只接受本仓库发布页与匹配的 x64 安装包。当前 0.x 发行仍为预发布，检查会包含已发布的预发布版本；1.x 稳定版默认忽略预发布。

发现新版提供下载入口、稍后、跳过此版本。帮助菜单可手动检查。此功能不会自动下载或执行安装包，不发送模型凭据、画像和资料；正常公开网络请求仍会向 GitHub 暴露 IP 等连接信息。API 采用官方 [公开发布列表](https://docs.github.com/en/rest/releases/releases)，不用仅返回稳定版的 latest 接口。

安装目录页替换 electron-builder 内置的简单名称包含判断：选中已有程序目录或已登记的安装位置时原样复用；首次选择父目录仅追加一层产品目录。显式 `/D` 与安装器既有的更新、卸载策略保留。不能声称已自动搬回此前被用户装到嵌套目录的旧安装。


## 格式误报与定位 / Format false positives and diagnostics

统一解析器将 `data$column`、`summary(model)$statistic` 等成员访问表达式中的美元符号视为代码文字，避免错误进入公式恢复；显式数学定界符仍须配对。生成、讲解、改写和风格编辑的格式诊断包含结果字段路径、字符位置和局部上下文，恢复层将这些证据交给模型，不再只返回笼统的公式报错。该修改通过合成回归及旧响应离线回放验证，没有新增真实模型调用。

The shared parser treats dollars embedded in member-access expressions such as `data$column` and `summary(model)$statistic` as literal text, avoiding false math recovery. Explicit math delimiters must still match. Format diagnostics for generation, explanation, rewriting, and style editing include the result-field path, character offset, and local context. The recovery layer forwards this evidence rather than only a generic math error. Synthetic regression and saved-response replay verified this change without new live model calls.
