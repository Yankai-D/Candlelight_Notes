# 可执行的讲义教学安排 / Executable handout teaching plan

讲义规划现在同时保存章节与 `teachingPlan`：全篇主线、可观察的学习目标、前置概念，以及每章首次解释（introduce）、应用（apply）或深化（deepen）的职责。每次出现都说明新增理解、值得展开的难点和完成判据。贯穿例题有稳定编号，每次使用说明不同用途。课次可以帮助回查，不能代替教学分工；同例的新应用不应仅因再次出现被删除。

Handout planning now persists both sections and a `teachingPlan`: the throughline, observable learning objectives, prerequisite concepts and each chapter’s introduction, application or deepening responsibilities. Each placement identifies its added understanding, genuine difficulty and completion criterion. Recurring examples have stable IDs and distinct purposes. Week labels can aid navigation but cannot replace instructional responsibilities; a new application of an example is not automatically redundant.

新讲义在已有规划调用中返回这些信息，并由原有规划审查检查职责和能力目标。程序验证编号、来源、章节顺序、先备关系和循环；语义有效性仍由基于实际上下文的审查判断，结构通过不证明教学质量。旧版规划仍可读取，不自动重做。新任务与主动“调整并重新生成”会使用新安排；题解、翻译和论文长文的原有路线保持兼容。

New handouts return this information in the existing outline call, with the existing planning review checking responsibilities and objectives. Code validates identifiers, sources, section order, prerequisites and cycles. Semantic validity remains a contextual review task; structural validity does not establish teaching quality. Older plans remain readable without automatic regeneration. New tasks and explicit regeneration use the new plan; existing solution, translation and narrative routes remain compatible.

章节分析读取本章职责及前文实际笔记，用内部 `conceptIds`/`exampleIds` 将写作单元关联到全篇安排。生成结果保存 `teachingRecord`，指向实际渲染后正文块及其变更指纹，不写入可见正文或导出内容。下一章使用去重的当前段落摘录；同一段同时涉及多个概念时只发送一份文字。前文摘录总量不超过原先 24,000 字符的连续性上下文预算，其中定位摘录最多 16,000 字符，剩余额度用于旧版先修笔记回顾。它不是原文证据，也不是用户掌握程度。

Chapter analysis reads its assigned duties and actual earlier notes, linking writing units to course concepts and examples internally. A `teachingRecord` binds the result to rendered prose blocks and change fingerprints; it is absent from visible text and exports. Subsequent chapters receive deduplicated current excerpts, sending a passage only once even when it serves several concepts. Prerequisite prose stays within the existing 24,000-character continuity budget, with up to 16,000 characters for located excerpts and the remainder for legacy prerequisite context. These excerpts are neither primary-source evidence nor evidence of learner mastery.

正文原句仍在时记为 written；被改动或规划变化时为 changed；旧笔记没有定位记录时为 untracked；尚无正文时为 not-written。written 只说明相关段落仍存在，不证明内容正确或目标已达成。编辑过且仍可定位的段落以当前文字提供，并标 edited；删除后不再发送旧原句。备份、恢复与版本历史保留记录，重新生成建立新定位。指纹只用于检测变化，不作身份认证。

The states are written for still-present bound prose, changed after relevant edits or plan changes, untracked for older notes without bindings, and not-written when prose is absent. Written proves presence only, not correctness or objective attainment. Edited but locatable passages are supplied as current text with an edited marker; deleted passages are not replayed from stale records. Backups, restoration and history retain bindings, while regeneration creates new ones. Fingerprints detect changes and are not authentication mechanisms.

删除了按知识单元估算篇幅后触发审查的规则。长度现在仅记录；真实原句重复、分析中的具体疑点等仍进入原有异常审查。审查核对本章能力目标与关键推理，允许必要证明和递进应用；不能仅凭标签、长度或相同例题名称要求删改。默认仍是仅在异常或可疑结果时审查，不新增每章必跑的语义审查调用，也没有恢复次数配额。

The unit-based length estimate no longer triggers review. Length is observational; concrete repeated passages and actual analytical concerns can still activate the existing anomaly review. Review checks objectives and decisive reasoning while allowing necessary proofs and progressive applications. Labels, length or repeated example names alone do not justify edits. The default remains anomaly-triggered review, without an additional mandatory semantic review call per chapter or a recovery-count quota.

`evals/lectures/progression.mjs` 是原创的三章开发样例，串联查询语义、算法构造和程序验证；不是用户课程内容，也不是模型实测结果。离线回归走完整规划、分析、取舍、写作、保存和下一章读取路径：规划 4 次，三章各有分析、交付规划、写作 3 次，共 13 次模拟调用。异常审查另计。另测无效依赖、实际编辑、删除、恢复和隐藏元数据。`node scripts/preview-lecture-style.mjs --progression` 可生成阅读预览。真实成品仍需独立阅读评审；没有据此宣称模型效果或 token 费用已经改善。交付规划和新元数据都有开销，实际总成本需实测。

`evals/lectures/progression.mjs` is an authored three-chapter development case spanning query semantics, algorithm construction and verification. It contains neither the user’s course content nor live model results. Offline regression follows planning, analysis, selection, writing, persistence and subsequent chapter reads: four planning calls plus analysis, deliverable selection and writing for each of three chapters, totaling 13 simulated calls. Anomaly review is additional. Checks also cover invalid dependencies, actual edits, deletion, restoration and hidden metadata. Run `node scripts/preview-lecture-style.mjs --progression` for a reading preview. Actual generated quality requires independent reading review; neither better model quality nor token savings is claimed. Selection and metadata add overhead, so total cost must be measured.

2026-10-30 的[完整讲义真实开发对照](../evals/lectures/runs/2026-10-30-pilot.md)发现，标签缺口会让已经存在的正文进入结构恢复。后续源码修正为：无效编号仍是协议错误；缺少 concept/method/example/variant 标签只触发 `LECTURE_COVERAGE` 正文审查。审查依据实际段落和来源判断；已讲清即可接受，无须补标签，确有遗漏才修正文。此修正已做真实失败的离线回放，尚未进行修正后的真实模型对照。

The [2026-10-30 live development comparison](../evals/lectures/runs/2026-10-30-pilot.md) found that missing annotations sent already-present prose into structural recovery. Subsequent source changes keep invalid identifiers as protocol errors while treating absent role annotations as a `LECTURE_COVERAGE` content-review trigger. Review assesses actual prose and sources: adequate content can be accepted without annotation repair; real omissions require prose correction. Observed failures have been replayed offline, but the corrected implementation has not undergone another live comparison.
