# 局部恢复后续验证 / Local recovery follow-up

本轮落实两项改动：JSON 结构标点错误先在本地修补，整份交付的要求与具体章节任务分别表达和检查。仍使用项目原创的虚构工厂概率课程、配置的 `deepseek-flash` 和三章讲义目标。此次为单组开发复测，最多 20 次调用、10 分钟；不改变产品的恢复限制，不访问或覆盖个人笔记。它不是新的随机对照实验，历史 14 次调用的两组结果也没有被替换。

This follow-up implements local JSON punctuation repair and separate handling of whole-delivery constraints and chapter tasks. It uses the same project-authored fictional-factory course, configured `deepseek-flash` model and three-chapter goal. The single development run permits up to 20 calls and ten minutes without changing product recovery limits or accessing personal notes. It is not a new randomized comparison and does not replace either historical 14-call arm.

真实结果仍不理想：20 次调用后只提交两章，第三章正文因为 JSON 公式转义失败进入恢复，随后触及实验上限。提供方累计报告输入 182,115 token、输出 21,091 token；累计调用时间约 121.5 秒。全局要求没有再因缺少章节标签返工，但需求引文、教学顺序约束、章前分析 JSON 和第三章转义仍产生恢复成本。没有完成整份交付，不能声称已降低完整生成成本或提升教学质量。

The live result remains unsatisfactory: twenty calls committed only two chapters. The third draft entered recovery for JSON math escaping and then hit the experimental boundary. Provider-reported usage totals 182,115 input and 21,091 output tokens, with approximately 121.5 seconds of cumulative call time. Global requirements no longer caused missing-chapter-tag repair, but goal quotations, teaching-order constraints, chapter-analysis JSON and third-chapter escaping incurred recovery costs. Without full delivery, no complete-generation cost reduction or teaching-quality improvement is established.

随后新增了模型可执行的 `json-escape` 操作，而不是继续把“修转义”的自然语言指令发回整章写作者。程序提供实际转义位置与上下文，模型选择应保留为字面反斜杠的序列，再由程序批量修改。原失败正文有 112 处此类位置，离线回放用一次脚本提供的控制器决定完成修补，原笔记校验通过，其他字符不变。此次没有追加付费调用，因此不能声称真实模型已经学会稳定选择该工具；原真实失败记录完整保留。

A subsequent change adds an executable `json-escape` operation instead of handing a prose instruction to rewrite the whole chapter. The program inventories actual escape positions and context; the model selects sequences intended as literal backslashes, and the program applies them together. The failed draft contains 112 such positions. Offline replay repairs them with one scripted controller decision, preserving other characters and passing original note validation. No additional paid calls were made, so reliable live selection of this new tool has not been established. The original live failure remains intact.

此前失败记录中的九处属性引号缺失，也已由纯语法修补一次解决，额外模型调用为零；其余字符逐字校验不变。两条恢复路径不同：确定的结构标点可自动修，有歧义的转义需模型明确选择，并保留正常内容审查。合法 JSON、标签齐全或结构校验通过都不等于事实正确。

The nine missing property quotes in the earlier record now repair in one deterministic pass, with zero additional model calls and byte-for-byte preservation elsewhere. The two paths are distinct: unambiguous structural punctuation can be repaired automatically; ambiguous escapes require explicit model selection and retain normal content review. Valid JSON, complete tags and structural acceptance do not establish factual correctness.

assistant 审读还发现首章把“分母漏掉 495”错误地推成 `90/100`；直接漏掉该项应得到 `90/90`，而 `90/100` 是换了条件总体。真实模型审查未发现此因果解释错误。正文还重复了章节标题，第二章重复题干可继续精简。本轮没有独立学习者或教师验收，不能把通过编排测试当成教学基准优势。

Assistant review found that chapter one incorrectly claims omitting 495 from the denominator produces `90/100`; direct omission gives `90/90`, whereas `90/100` changes the conditioning population. Live model review missed this causal error. Generated prose also repeats chapter titles, and chapter two could shorten its repeated problem statement. No independent learner or teacher accepted the material; passing orchestration tests is not evidence of teaching superiority.

公开统计见 [JSON 清单](2026-10-30-recovery-followup.json)。本机原始证据位于 `artifacts/course-eval/2026-10-30-local-recovery-live/`，包括请求响应、检查点、未润色正文、部分讲义预览和 assistant 审阅。最终回归与构建日志另存于 `artifacts/course-eval/2026-10-30-local-recovery-check-final/`。对外统计不包含凭据、API 端点、个人材料或安装路径。

Public statistics are in the [JSON manifest](2026-10-30-recovery-followup.json). Local requests, responses, checkpoints, unpolished prose, partial-handout preview and assistant review reside in `artifacts/course-eval/2026-10-30-local-recovery-live/`. Final regression and build logs are recorded separately in `artifacts/course-eval/2026-10-30-local-recovery-check-final/`. Public statistics exclude credentials, API endpoints, personal materials and installation paths.

最终工程检查：全量 609 项中 608 项通过，剩余一项仍模拟“返回完整新正文”的旧恢复协议；将该替身更新为可执行转义补丁后，所在测试及转义测试共 12 项复跑通过。此后没有更改生产代码。类型检查和构建通过；部分讲义在桌面与窄屏均未横向溢出，65 个公式节点正常渲染。这些结果说明实现与兼容性检查通过，不改变上述真实生成未完成及内容错误的结论。

Final engineering checks: 608 of 609 full-suite tests passed. The remaining mock still returned a complete new note under the previous recovery protocol; after updating it to an executable escape patch, all twelve notebook and escape tests passed on rerun. Production code did not change after the full run. Type checking and build passed. The partial handout showed no horizontal overflow at desktop and narrow widths, with 65 rendered formula nodes. These checks establish implementation compatibility, not completion or correctness of the live handout.
