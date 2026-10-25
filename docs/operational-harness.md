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
| `inspect` / `search` | 只读查看候选字段或搜索当前任务上下文，返回有长度限制的实际结果。 / Read candidate fields or search current context with bounded observations. |
| `patch` | 对候选做摘要绑定、旧值核对的字段或文字修改，再交原校验器验收。 / Apply digest-bound, expected-value-checked field or text edits, then run the original validator. |
| `stop` | 缺少外部输入、无可靠处理方法时保留状态。 / Preserve state when required inputs or a defensible recovery path are unavailable. |

恢复计划本身有严格 schema 与失败摘要绑定。无法识别的计划尝试其他可用方法；能识别工具意图但缺少操作字段时，把实际 schema 错误返回模型修正。调查没有轮数上限，只要持续获得新信息或执行有效修正就继续。失败身份使用校验器的字段路径、约束码、期望值、边界和问题身份。方法名称不是一次性额度：`repair` 与 `reframe` 都失败后仍允许检查、搜索、局部补丁或带有不同具体指令的修复。相同约束下重复同一方法和具体指令会收到无进展反馈；再次提出同一被拒操作，或原样重复读取同一候选且没有新信息时，退出该调查并尝试可用回退。局部补丁不能返回曾拒绝的候选。

Recovery plans have a strict schema and failure digest. Unrecognizable plans try available alternatives; recognizable tool intentions with missing fields receive actual schema feedback. Investigations have no turn limit while they obtain new information or apply effective corrections. Failed repair and reframing do not disable inspection, search, local patches or a concretely different instruction. Repeating the same rejected operation or rereading an unchanged candidate without new information exits that investigation and tries an available fallback. Patches cannot return to a rejected candidate.

`server/recovery-workbench.mjs` 只拥有候选结果，没有文件、网络、任意代码或校验器编辑权限。补丁先在副本中原子应用；任一旧值不符、过期摘要、危险属性路径或多处匹配都会拒绝。文字补丁可以指定解码后的字段路径，JSON 转义由程序负责；没有路径时只接受原始文本或解码后字符串中的唯一精确匹配，绝不模糊猜测。每次试改后原校验器重新执行，新的错误回到下一轮诊断；只有验收后的阶段才能进入正式笔记。

`server/recovery-workbench.mjs` owns only the candidate, with no filesystem, network, arbitrary-code or validator-edit capability. Patches apply atomically to a copy; stale digests, mismatched expected values, unsafe paths and ambiguous matches are rejected. Text edits can address decoded fields while the application handles JSON escaping. Unscoped edits require a unique exact raw or decoded match, never fuzzy matching. Every candidate goes through the original validator again; new failures return to diagnosis, and only accepted stages enter the notebook.

拆分失败仍由父阶段负责：某个子阶段无进展时，把具体失败带回父阶段，再选择其他方法。父子阶段用完整输入绑定区分，即使都叫 `note-review-audit` 也不会混淆。已经验收的子结果留在检查点内，整体结果仍须通过父校验器；取消、认证失败和缺少外部输入直接传播，不作为可修正文案处理。显式评测另行设置的额度仍受约束。

The parent owns partition recovery. A child with no progress returns evidence to the parent for a different strategy. Full input bindings distinguish parent and child even when both are named `note-review-audit`. Accepted children remain checkpointed, but the aggregate still requires parent validation. Cancellation, authentication failures and missing external inputs propagate instead of becoming content-repair prompts. Explicit evaluation ceilings remain enforceable.

## 结果与预算的边界 / Acceptance and budgets

所有恢复结果必须通过原校验器。正文范围、来源身份、精确引文、数学格式、模板约束和修订定位不因恢复而放宽。已经通过校验的审查意见必须在建议复核中逐项得到决定，补丁不能遗漏或增加问题。未通过校验的审查草稿保留作恢复与复核的参考，不把其中矛盾、撤销或不完整的批评固定为编辑要求。

Every recovered result passes the original validator. Recovery never relaxes source identity, exact quotations, math formatting, template constraints or edit scope. Validated findings require individual audit decisions; patches cannot omit or invent findings. Rejected review drafts remain diagnostic context without turning their contradictory, withdrawn or incomplete criticism into editing requirements.

产品运行不再设置调用次数、恢复动作、单阶段动作、单章正文修订或整份笔记共享修订额度；联合笔记规划和理想学习树同样不设隐含次数上限。调用与修订次数只作为统计记录。旧笔记请求中的 `repairAllowance` 和状态中的 `repairLimit` 兼容读取后移除，已经耗尽的旧额度不会阻断续接。取消立即传播；认证失败、无法处理的外部错误及重复无进展仍会保留状态并停止，不能用取消额度代替正确性验收。

Production execution has no implicit call, recovery-action, stage-action, chapter-revision or shared notebook-revision quotas. Bundle planning and ideal-tree construction follow the same policy. Calls and revisions remain statistics. Legacy `repairAllowance` requests and `repairLimit` state are read compatibly and discarded, so exhausted old quotas cannot prevent continuation. Cancellation, authentication failures, unresolvable external errors and repeated non-progress still preserve state and stop; removing quotas does not bypass acceptance checks.

独立评测可以显式传入调用限制，以遵守单独授权的测试范围；这不影响产品默认运行。仅此情况下，剩余一次调用留给实际执行，诊断及其网络重试不得占用预留调用。调用层仍在每次实际 HTTP 请求前执行 `reserveExecutionCall`，准确统计重试与 token 扩展；自定义适配器也须遵循这个契约。检查点写入失败时明确说明无法保证关闭后续接。

Independent evaluations may explicitly supply limits to respect their separately authorized scope; product defaults remain unlimited. Only with such an explicit limit is the final call reserved for execution rather than diagnosis or its network retries. Every actual HTTP attempt still calls `reserveExecutionCall`, including retries and token expansion; custom adapters share that accounting obligation. Failed checkpoint writes cannot claim durable continuation after shutdown.

笔记按章提交并即时保存。当前章内部保留生成、定位、审查和修改检查点，只有整章通过才交付正式笔记。服务重启或外部问题解决后，同一任务的显式继续复用检查点；改变目标、资料、版本、模板、模型或端点会失效。新建重新生成任务不会沿用旧任务结果。复用的审查单独计入 `reusedReviewStages`，不冒充新的真实模型调用。

Accepted chapters are committed and saved individually. Within a chapter, generation, citation, review and revision checkpoints survive interruptions, but only an accepted chapter enters the notebook. Explicit continuation of the same task reuses checkpoints; changed goals, sources, revisions, templates, models or endpoints invalidate them. A new regeneration task starts fresh. Cached review proofs are reported separately as `reusedReviewStages`, not as new model calls.

详细检查点位于本机 `.candlelight/generation-records` 或理想学习树文件中，包含私人任务上下文和模型结果，不包含认证头或 Key，不进入公开包。生成记录沿用 20 份 / 64 MB 的保留策略，单份上限 32 MB；超过上限或写入失败时不能声称已持久化。普通恢复日志仅记录阶段、错误码和次数，约 512 KB 轮转，不保存原文。理想学习树的公开接口不暴露执行检查点。

Detailed checkpoints live in local generation records or ideal-tree files. They contain private task context and model results, never authorization headers or keys, and are excluded from public packages. Generation records retain at most 20 records / 64 MB with a 32 MB per-record ceiling; a failed checkpoint write is not durable. The rotating diagnostic log contains only stage names, codes and counts. Public tree responses exclude execution checkpoints.

## 审查与来源 / Review and grounding

### 联合笔记的任务流程 / Bundle task workflow

规划各阶段的输出结构由实际校验 schema 自动生成，随首次请求发送，包含必需字段、类型和数组上限。规划审查使用程序生成的章节编号表及带位置的证据表；反馈分别指出不存在的章节、真实引文指错章节、引文不存在、检查维度矛盾和候选身份错误，不再用一条笼统的“证据或定位错误”混淆原因。真实引文和用户目标引用保持原样，正文范围与验收规则不因恢复而放宽；修好审查定位后仍须处理其内容意见。

Planning stages receive output contracts generated from their actual validation schemas, including required fields, types and array limits. Plan reviews use application-generated section numbers and located evidence. Diagnostics distinguish nonexistent chapters, quotations assigned to the wrong chapter, missing quotations, inconsistent checks and candidate-binding errors. Repairing a review envelope neither rewrites valid quotations nor accepts the plan's unresolved substantive issues.

资料摘录是规划索引，不能被误判为全文范围：摘录未展示某个内容不等于原文不存在。规划安排后续读取完整资料并讲解，只有实际核实缺失才能以来源局限处理。

Planning excerpts are an index, not the full source boundary: an unseen detail is not necessarily missing from the document. Plans assign subsequent full-source reading and explanation; limitations require verification against that source.

规划审查提出修改时，另一步复核分别决定确认、驳回或待原文核查。驳回必须说明依据；只有依赖完整来源的 coverage 疑点可延后，并按来源单元保存为明确问题，跨规划修订保留，在对应章节触发原文分析和正文审查。用户目标、结构定位和章节连贯性错误不能延后。这样既不把审查者的猜测直接改进正文，也不以“不确定”为由丢掉核查责任。

When plan review proposes changes, a separate audit confirms, dismisses or defers each finding with evidence. Only source-coverage uncertainty may defer, as an explicit question attached to source units. These questions survive plan revisions and trigger full-source analysis and prose review in the corresponding chapters. Goal, structural-location and coherence defects cannot defer. Uncertainty neither authorizes speculative edits nor discards verification obligations.

规划审查现在优先引用程序提供的证据 ID（包括资料分配、要求分配和依赖字段），无需模型重抄长引文；旧引文仍校验。首次审查及意见复核后，执行器保存候选、未解决问题和已驳回／延后意见。后续改动改为逐项核验修正，并检查改动引入的回归；不重新发起一轮无边界的全文挑错。回归必须关联实际改动的章节，且再次独立复核。没有变化的候选直接复用原结论；未修改不能被标为已解决。该账本随检查点保存，重启不丢失审查结论。

Plan reviews prefer application-provided evidence IDs, including source assignments, requirement assignments and dependencies, rather than copied quotations; legacy quotes remain validated. After the initial critique and audit, the runner retains the candidate, unresolved issues and dismissed or deferred decisions. Subsequent checks verify each repair and inspect regressions caused by actual changes instead of restarting an unbounded critique. Regressions must identify changed sections and receive independent audit. An unchanged candidate reuses its existing verdict and cannot be marked repaired. The ledger persists with the checkpoint across restarts.

2026-10-24 的两轮限额真实测试共调用 28 次，规划均未完成。恢复器确实修复了依赖自指和错误引文，但审查在后续重评中改变了对未改正文的判断，另有格式修复消耗预算。上面的收敛账本与证据 ID 协议是在该失败后实现的；当前证据是故障记录回放与离线流程测试，不能宣称最终协议已经通过真实模型端到端测试。初始审查可能遗漏问题，复核也可能判断错误；全文章节的来源与内容审查仍不可省略。

Two bounded live trials on 2026-10-24 used 28 calls without completing planning. Recovery did fix a self-dependency and invalid quotations, but subsequent critiques changed judgments about unchanged prose and spent calls on protocol repairs. The convergence ledger and evidence-ID protocol above were implemented after these failures. Their current evidence is recorded-failure replay and offline workflow tests, not an end-to-end live pass of the final protocol. The initial critique can miss defects and reviewers can be wrong; subsequent full-source chapter analysis and content review remain necessary.

协议中不影响行动的元数据不会额外消耗模型调用：结构化工具操作缺少说明文字时使用通用说明，审查缺少摘要时从实际检查结果生成摘要；重写指令、补丁操作和证据约束仍为必需。规划引用只归一化空白，不能改变词语、数字或数学符号。读取工具明确以字符分页，小型对象额外返回完整结构；补丁预期值不符时返回具体操作和字段的当前值，而非笼统失败。

Non-action metadata does not require another model call: executable tools may use a default caption, and a missing review summary is derived from its validated checks. Rewrite instructions, patch operations and evidence constraints remain mandatory. Plan quotations normalize whitespace only, never wording, numbers or mathematical symbols. Inspection declares character pagination and returns complete small structured values; mismatched patch preconditions identify the operation, path and current value.

`server/bundle-planner.mjs` 将独立笔记规划分为用户要求分析、逐批资料分析、章节职责与依赖关系规划、独立规划审查。用户要求必须有 intent/feedback 的连续原话依据；资料分析逐批覆盖全部来源单元，明确只看到了索引与摘录；规划同时检查来源覆盖、要求分配和先备章节顺序。独立审查再核对目标、覆盖、顺序与连贯性，发现可定位问题后回到同一候选修正，不能靠正确 JSON 就算完成。每个阶段共用执行器并保存检查点，已验收的分析可跨进程续接。

`server/bundle-planner.mjs` separates user-requirement analysis, batched material analysis, chapter responsibilities/dependencies and independent plan review. Requirements quote the user's intent or feedback. Analysis covers every source unit while identifying its index/excerpt evidence limit. The plan must cover sources and requirements and respect prerequisite order. A separate review checks goals, coverage, order and coherence, feeding located problems back into recovery; valid JSON alone is insufficient. Stages share the executor and persist checkpoints so accepted analysis can survive a restart.

规划结果随独立笔记保存，包括任务契约、资料用途、各章负责的要求与依赖关系。每章生成前，`server/chapter-analysis.mjs` 读取当前分配的完整原文片段，形成具体讲解／解题步骤，标记条件、冲突和需要核查的疑点。正文生成与审查收到同一任务契约、章节关系、前文有限摘录和本章分析。前文是衔接上下文，不能替代原始证据；模型的分析同样不是既定真理。

The saved notebook retains the task contract, source roles, chapter responsibilities and dependencies. Before each chapter is written, `server/chapter-analysis.mjs` reads the complete assigned source segment to develop concrete explanation/solution steps and identify conditions, conflicts and concerns. Generation and review receive the same contract, relationships, bounded preceding-note excerpts and chapter analysis. Prior prose supports continuity, never replaces original evidence; model analysis is not treated as established truth.

内容审查继续采用用户选择的“异常或可疑结果时执行”。章节分析提出具体疑点会增加 `ANALYSIS_RISK` 触发项；原有格式、引用与覆盖异常仍会触发。审查后的修订和建议复核沿用现有阶段。任务规划与章节正文遵循上述无隐含次数额度的执行策略，阶段验收与来源约束保持不变。

Content review retains the user-selected anomaly policy. Concrete concerns from chapter analysis add the `ANALYSIS_RISK` trigger alongside existing format, citation and coverage signals. Revision and advice auditing use the existing stages. Planning and chapter generation follow the no-implicit-quota policy above, preserving stage acceptance and source constraints.

规划请求携带独立任务身份并进入本机生成记录，取消或失败后同一任务可以复用已经通过的阶段；新目标、新资料、新版本、新模型或显式新建的重新生成任务使旧结果失效。测试覆盖结构有效但不符合目标的规划、分批分析后中断与续接、旧方法失败后继续局部修补，以及分析疑点触发知识审查。离线替身只证明调度和数据流，不能证明真实模型能稳定理解任意错误。真实故障记录及限额实测的结论见本节日期标注；私有资料与原始响应只留在忽略发布的本机 artifacts 中。

Planning requests carry an explicit task identity and use local generation records. Cancelled or failed tasks can reuse accepted stages; changed goals, sources, versions, models or an explicit regeneration invalidate them. Tests cover structurally valid but goal-misaligned plans, interrupted batch analysis and resumption, patching after failed rewrite methods, and analysis-triggered knowledge review. Offline doubles prove orchestration and data flow, not a real model's ability to diagnose every failure. Dated findings above distinguish actual failure records and bounded live evaluations; private sources and raw responses remain in local artifacts excluded from publication.

默认仍为“仅异常或可疑结果触发内容审查”。结构、引用和数学检查始终执行。审查读取目标、模板、章节分工、完整当前来源和确切正文，检查目标交付、覆盖、来源边界与连贯性；提出问题后先复核批评和建议是否成立，再定向修改并复查。未改段落保留，补丁对同一快照操作并产生明确的位置映射。无法消除的分歧不会被程序猜成通过。

Content review remains anomaly-triggered by default; structural, citation and math checks always run. Review receives the goal, template, chapter responsibility, complete current evidence and exact candidate. Proposed criticisms are audited before targeted editing and rechecking. Untouched blocks remain intact, and patches operate against one snapshot with explicit index mappings. Unresolved disagreement is never inferred to be acceptance.

联合资料的原文件页码只用于显示，扁平来源 ID 用于定位。程序优先做有唯一逐字证据的本地映射；否则运行独立定位阶段，模型选择按内容绑定的 `sourceEvidenceIds`，程序回填原句并严格核验。定位故障不会重新生成整段正文。多来源段落可分别选择各来源证据，无需不同文件包含同一句话。

Original page numbers are display metadata; flattened source IDs identify evidence. Unambiguous exact-quote mappings are repaired locally. Other cases enter a citation stage where the model selects content-bound excerpt IDs and the application resolves and verifies exact text. Citation recovery preserves prose, and multi-source paragraphs can select distinct evidence from each source.

联合资料适应性整合在 48,000 来源字符内整章生成，其他阅读以 18,000 字符分段；来源不会被静默截去。后续片段收到已验收的完整前文块用于衔接，不把前文当成新来源。审查只检查本章/片段承担的任务，不要求每章覆盖整套课程。

Adaptive bundle synthesis keeps chapters together up to 48,000 source characters; other reading uses 18,000-character segments without silently dropping source text. Later segments receive accepted writing context for continuity, not as new source evidence. Review respects chapter and segment responsibilities.

## 运行环境错误 / Runtime failures

确定性的运行环境问题仍由专用层处理：原子文件写入对短暂 Windows/OneDrive 锁重试同一份快照，绝不先删旧文件；暂时连接故障按退避与共享传输额度重试。认证失败、磁盘已满或用户取消不能靠模型编造解决。日志保存失败不会使有效正文重新调用模型；关键数据持续无法保存时仍需明确暂停。

Deterministic runtime failures remain in dedicated layers: transient Windows/OneDrive locks retry the same atomic snapshot without deleting the old file, and temporary connection failures use bounded backoff. A model cannot invent a fix for invalid credentials, full disks or cancellation. Diagnostic failures do not regenerate valid prose; persistent failure to save essential data still requires a pause.

校验器本身的 `TypeError` 或 `ReferenceError` 属于程序缺陷，直接传播，不消耗模型调用来掩盖；显式结构约束、JSON 和 schema 校验错误仍进入内容恢复。模型输出截断沿用调用适配器的有界 token 扩展；耗尽后不能接受半份 JSON，也不能把任意资料拆分后当成等价任务。只有业务层提供了独立单元与合并校验契约，执行层才有权使用拆分。

An unclassified `TypeError` or `ReferenceError` from a validator is an application defect, not a model-editable answer. Explicit contract, JSON and schema failures still enter content recovery. Output truncation retains the adapter's bounded token expansion; exhaustion never authorizes partial JSON or arbitrary source splitting. Partitioning requires a domain-supplied independent-unit and aggregate-validation contract.

## 验证与限制 / Evidence and limits

讲义采用 `lecture-synthesis-v1` 契约。联合资料讲义按知识与方法合并资料，章前分析提取概念、可执行步骤、代表性来源例题和实际课内变体，并记录重复材料的合并去向。生成落实这些单元，审查与审查复核使用同一精简标准；覆盖来源不等于逐页翻译。普通单篇讲义使用同一精简表达约定，不额外增加合成分析调用。来源不足时不编造例题或变体。正文块的内部单元标记只用于交付检查，不进入阅读和导出排版；标记存在不证明内容正确，事实和解法仍需内容审查。明确的逐题解答要求优先，论文长文与纯翻译保持各自契约。

Lectures follow `lecture-synthesis-v1`. Bundle planning groups sources by knowledge and methods; chapter analysis extracts concepts, actionable procedures, representative source exercises and actual course variations, with a ledger for merged duplicates. Writing, review and audit share this concise standard. Ordinary single-source lectures use the same editorial contract without an additional synthesis-analysis call. Source coverage does not require page-by-page translation, and missing examples or variations must not be invented. Internal unit tags support delivery checks without appearing in reading or export; tags do not establish semantic correctness. Explicit requests to solve every exercise take precedence. Narrative papers and translation retain their separate contracts.

审查复核支持 `refine`：同一意见混合了真实缺陷与错误批评时，复核可收窄问题和修正指令，但不能更改目标、添加新任务或绕过来源证据。修订后仍独立复查。恢复工作区以 `targetDigest` 绑定整份待修复返回值，与返回值内部用于绑定正文的 `candidateDigest` 区分；工具支持按 JSON 路径查看只读上下文，并在旧绑定错误中返回当前绑定。上述笔记与规划阶段在首次调用前收到由实际 schema 生成的输出契约，而非等出错后才解释字段要求。

Audit supports `refine`: when a finding mixes a real defect with an invalid criticism, the auditor may narrow its problem and repair instruction without retargeting it, adding tasks or bypassing source evidence. Revised prose still receives an independent recheck. The recovery workbench binds the entire response with `targetDigest`, distinct from an embedded prose `candidateDigest`; tools expose read-only decoded context paths and return the current binding for stale patches. Note and planning stages receive output contracts generated from their actual schemas before their first call.

`tests/lecture-synthesis.test.mjs` 和规划回归在恢复额度为零时检查有效输出能一次贯通，检查遗漏的已选例题、伪造证据、无效合并与旧模板迁移。`tests/note-review-audit.test.mjs` 检查混合意见收窄、定向修订与复查，并拒绝越界或无依据修订。已保存失败的本机离线回放确认可只修一段并保留其余 14 段及来源定位；收窄决定和补丁是测试提供的，不能称为新的真实模型成功。个人样稿、撤销记录与并发修订号在模板迁移中保留，既有笔记不会自动改写。

Lecture and planning regressions disable recovery to check valid first-pass orchestration, omitted selected examples, fabricated evidence, invalid merges and legacy template migration. Audit tests cover narrowed findings, targeted revisions and rechecks, rejecting scope or evidence violations. A local saved-failure replay confirms one-block repair while preserving 14 other blocks and source anchors; its refined decision and patch are test-supplied, not a new live model success. Template migration preserves personal samples, undo history and concurrent-edit revisions; existing notes are not automatically rewritten.

2026-10-24 在用户授权的 12 次调用、10 分钟上限内，以同一失败记录做了 7 次真实调用：混合意见的独立复核一次返回 `refine`，保留真实拼写错误并撤销错误的条件缺失批评；同章生成经历一次 JSON 语法错误及方法步骤覆盖不足，经两次恢复动作完成并通过触发式正文审查。原记录和原笔记未修改。该结果证明本次恢复走通，不证明首轮输出无错、数学正确性或普遍成功率。使用的仍是旧学习地图章节与原目标，因此也不是新规划风格已达标的证据；完整重组需使用“调整并重新生成”重做规划，而非继续旧章节。真实资料和原始调用仅存本机，未进入分发源码。

An authorized live test on 2026-10-24 used 7 calls within a 12-call, 10-minute ceiling. Audit returned `refine` on its first call, retaining the actual spelling defect and withdrawing an invalid missing-condition criticism. Generation of the same chapter encountered invalid JSON and omitted method coverage; two recovery actions completed the chapter, followed by triggered prose review. Original records and notes were unchanged. This establishes recovery for this case, not error-free first attempts, mathematical correctness or general success rates. It retained the old learning-map chapter and goal, so it also does not establish the quality of newly planned concise lectures. Full restructuring requires the existing adjust-and-regenerate action to replace the outline. Private sources and raw calls remain local and are excluded from distribution.

`tests/execution.test.mjs` 使用全新约束验证通用诊断、换策略、拆分、取消、调用预算、检查点失效和日志失败。`tests/execution-integration.test.mjs` 验证持续不确定的审查能在一次操作中恢复、多目标补丁统一提交，以及真实本机记录的续接不会重跑已完成正文或泄露凭据。其余笔记、模板、分类、理想学习树与文件系统测试保留原有内容边界检查。

The execution tests use novel constraints to check diagnosis, strategy changes, partitioning, cancellation, budgets, cache invalidation and failed diagnostics. Integration tests cover resolving uncertain reviews within one operation, atomic multi-target edits, and continuation from real local records without regenerating accepted prose or persisting credentials. Existing adapter and filesystem suites retain their correctness checks.

`npm run eval:recovery` 运行 [18 类离线故障场景](../evals/recovery/README.md)，输出每个场景的预期结局、实际结局、模拟调用数、策略序列、验收与复用阶段。它同时作为单元测试和 `npm run check` 的独立阶段运行。2026-10-21 审查先在原执行层复现 12 个场景，其中 6 个未达到契约，再修改执行层；补充边界场景后共 18 类。报告区分“恢复成功”和“正确停止”，不把停止伪装成完成。

`npm run eval:recovery` runs [18 offline fault scenarios](../evals/recovery/README.md), reporting expected and observed outcomes, mock-call counts, strategies, acceptance and reuse. The same cases run as unit tests and a dedicated `npm run check` stage. The 2026-10-21 audit first reproduced 12 scenarios against the original runner, six of which violated their contracts, before changing the implementation; boundary checks expand the suite to 18. Reports distinguish recovered tasks from correct stops rather than presenting every pass as completion.

上述 18 类评测是离线机制证据；另有 [受限修复工作区的真实复测](../evals/recovery/agent-evidence.md)，区分故障注入、真实模型响应、原记录回放和独立验收。不能用合成替身或某次成功宣称普遍成功率。独立论文搜索和研究评测工具仍有各自的有界执行器，不能据此宣称每个模型工具已经迁移。审查者与恢复调度使用同一用户配置模型，仍可能共享认知错误；该机制不等于数学证明或教师评测。

The 18 scenarios are offline mechanism evidence. A separate [live workbench assessment](../evals/recovery/agent-evidence.md) distinguishes injected faults, actual model responses, recorded-response replay and independent assertions. Neither doubles nor an individual success establish a general success rate. Independent paper search and research-evaluation utilities retain their own bounded runners; not every model utility has migrated. Review and recovery use the configured model and can share its reasoning errors; they are not mathematical proof or independent teacher evaluation.


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

讲义正文允许 `learningRoles` 多用途标注；旧 `learningRole` 仍兼容。覆盖缺口先核对正文与标注，不等同于知识缺失。生成与审查的局部恢复使用当前候选的索引、字段预览和诊断，历史观察必须匹配当前摘要。数组插入由程序原子执行并验证完整锚点，模型不手动移动后续段落。同一段落的独立审查意见分别复核，只在写作时归并目标，所有原意见都保留复查映射。

Lecture prose supports multiple `learningRoles` while retaining legacy `learningRole`. A coverage gap prompts inspection of prose and metadata; it does not establish missing knowledge. Local generation and review recovery use current-candidate indices, previews and diagnostics; prior observations must match its digest. Array insertion is atomic and verifies the complete anchor rather than making the model shift later paragraphs. Independent findings on one paragraph are audited separately, grouped only for writing, and retain all recheck mappings.

写作阶段只接收复核后仍成立的意见与明确目标清单，旧草稿、撤销理由和原错误指令留在诊断记录。若模型按同一目标下的原编号分别输出，程序无损归并文字并保留全部复查映射；不接受已撤销或未授权目标。错误反馈列出准确字段及遗漏/多出目标，不以笼统“不匹配”要求整份重写。

Writing receives only findings retained after audit and an explicit target contract; rejected drafts, dismissal summaries and withdrawn instructions stay in diagnostic records. Responses using multiple confirmed identifiers for one target are combined without discarding prose, retaining every recheck mapping. Withdrawn or unauthorized targets remain invalid. Errors identify exact fields and missing or extra targets instead of requesting an entire rewrite with an unexplained mismatch.

统一解析器将 `data$column`、`summary(model)$statistic` 等成员访问表达式中的美元符号视为代码文字，避免错误进入公式恢复；显式数学定界符仍须配对。生成、讲解、改写和风格编辑的格式诊断包含结果字段路径、字符位置和局部上下文，恢复层将这些证据交给模型，不再只返回笼统的公式报错。该修改通过合成回归及旧响应离线回放验证，没有新增真实模型调用。

The shared parser treats dollars embedded in member-access expressions such as `data$column` and `summary(model)$statistic` as literal text, avoiding false math recovery. Explicit math delimiters must still match. Format diagnostics for generation, explanation, rewriting, and style editing include the result-field path, character offset, and local context. The recovery layer forwards this evidence rather than only a generic math error. Synthetic regression and saved-response replay verified this change without new live model calls.
