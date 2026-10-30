# 整份讲义开发评测 / Whole-handout development evaluation

`evaluate-course.mjs` 对两个冻结源码目录运行完整资料包规划和连续章节生成，固定原创资料、用户画像、目标、讲义模板、模型配置、温度与每组开销边界。版本不同可能同时包含多项改动，因此不是单变量因果实验。模型可自行分配两至三章；额外调用包括实际审查与恢复。固定模板不评测模板自动选择。

`evaluate-course.mjs` compares two frozen runtime directories through bundle planning and sequential chapter generation, holding authored sources, profile, goal, lecture template, model configuration, temperature and per-arm spending boundaries fixed. Runtime versions can differ in multiple ways; this is not a single-variable causal experiment. The model assigns two or three chapters, with review and recovery calls included. Template routing is outside this fixed-template comparison.

先冻结计划，再分别运行离线模拟或真实调用。输出目录必须不存在；不会静默覆盖或续跑已付费实验。真实调用从本机 `.env` 读取配置，凭据和 HTTP 认证头不写入记录。只使用 `course-case.mjs` 的原创虚构工厂课程；评审标准和迁移题不进入生成请求。

Freeze the plan before running a simulation or live trial. Output directories must be new; paid experiments are never silently overwritten or resumed. Live configuration comes from local `.env`; credentials and authentication headers are excluded from records. Only the authored fictional-factory course is sent. Assessment criteria and transfer questions stay outside generation requests.

```powershell
npm run eval:course -- --baseline-root output/build-0.1.40-calibrated --candidate-root output/build-0.1.41-verified --out artifacts/course-eval/plan
npm run eval:course -- --plan artifacts/course-eval/plan/plan.json --demo --out artifacts/course-eval/demo
npm run eval:course -- --plan artifacts/course-eval/plan/plan.json --live --out artifacts/course-eval/live
npm run eval:course -- --summarize artifacts/course-eval/live/review-packet.json --review artifacts/course-eval/live/assistant-review.json
```

根目录参数也可指向其他兼容版本的独立 Git 工作副本；示例中的历史构建目录不是仓库依赖。运行前后对 server/shared 模块和依赖锁作哈希绑定。每次响应和阶段完成都保存检查点；模型输出不写入个人资料库。`review.html` 隐藏版本与调用量，`cost.html` 单独展示统计和版本映射。A/B 匿名不等于独立盲评；评审者是否看过映射需要如实说明。

Root arguments may point to other compatible independent checkouts; the historical build directories above are not repository dependencies. Server/shared modules and dependency locks are fingerprinted before and after execution. Responses and completed stages are checkpointed without writing to the personal library. `review.html` hides version and usage; `cost.html` shows accounting and the mapping separately. Anonymous labels do not establish independent blinding; reviewers must disclose exposure to the mapping.

本次实验每版最多 14 次调用、49,152 个累计输出 token、8 分钟，单次最多 8,192 输出 token；输入另计。仅为独立评测的开销保护，不影响产品恢复流程。模拟响应不伪造 token 数据，因此模拟的累计预留上限按调用上限扩展；真实调用严格使用冻结预算。缺少提供方用量则保持未知，缓存未报告不视为未命中，不凭未知单价折算金额。

This trial permits up to 14 calls, 49,152 cumulative output tokens and eight minutes per arm, with 8,192 output tokens per call; inputs are additional. These are evaluation-only spending safeguards. Simulation does not fabricate usage, so its cumulative reservation expands to the call ceiling. Live runs retain the frozen budget. Missing provider usage remains unknown; missing cache fields are not inferred as misses, and no currency price is invented.

首次真实结果见 [2026-10-30 记录](runs/2026-10-30-pilot.md)：旧版完成两章，新版完成一章，两者均在实验调用边界停止。不能据此比较完整交付成本或声称教学优势。正文审读仍发现量纲误述与重复；assistant 审阅不是独立人工验收，也没有测量真实学习效果。使用该结果修改实现后，它就是开发回归材料，不能再声称为未见测试集。

The [2026-10-30 record](runs/2026-10-30-pilot.md) reports two completed chapters for the older version and one for the newer version; both stopped at the experimental call boundary. Complete-delivery cost and teaching superiority cannot be compared. Prose review found a units error and repetition; assistant review is not independent human acceptance or a measurement of learning outcomes. Once used to change implementation, the case is development regression material, not an unseen test set.

真实记录中的三处覆盖标签失败保留在 `tests/fixtures/course-coverage-observed-v1.json`，只含原创课程和对应模型返回。回归验证缺标注转入一次正文审查，不以标签缺口强迫整章重写；无效编号仍拒绝。语义遗漏需要审查定位实际缺失并修订，不靠补标签解决。

Three actual annotation failures are retained in `tests/fixtures/course-coverage-observed-v1.json`, containing only authored course content and associated model output. Regression verifies that missing annotations lead to content review instead of forced whole-chapter rewriting; invalid identifiers remain rejected. Actual semantic omissions require evidence-backed content corrections, not extra labels.

[局部恢复后续验证](runs/2026-10-30-recovery-followup.md) 分开记录真实运行和离线回放：真实复测仍只完成两章；旧返回的九处引号可零调用修复，新返回的 112 处转义由脚本模拟一次控制器选择后修复。后者尚未做新的真实工具选择验证，不把回放成功替代为完整交付或通用成功率。

The [local recovery follow-up](runs/2026-10-30-recovery-followup.md) separates live execution from offline replay: the live run still completed only two chapters; nine quote defects in the older response now repair without a call, while 112 escape positions in the newer response repair after one scripted controller selection. Live selection of the latter tool remains unverified. Replay success does not substitute for complete delivery or a general success rate.

后续[规划重置](../../docs/lecture-style.md)将来源阅读与教学交付分开：每章先分析、再取舍、最后整章写作。`tests/lecture-planning-reset.test.mjs` 使用原创材料及脚本响应，验证同知识材料增至 40 倍不增加写作任务、按需展开原页不改变教学任务、无关资料可排除但仍核对全文、行政批次不强造知识、新方法可增加交付内容。`--demo` 的正常三章流程现在是 13 次模拟调用，异常审查另计。历史冻结版本的真实统计不改写；这些新增测试既不是新的真实生成结果，也不支持费用或教学质量改善的结论。

The subsequent [planning reset](../../docs/lecture-style.md) separates source reading from teaching delivery: analyze, select, then draft each whole chapter. `tests/lecture-planning-reset.test.mjs` uses authored materials and scripted responses to verify that forty-fold equivalent source volume adds no writing tasks, page expansion preserves teaching duties, proposed exclusions still undergo full-text checks, administrative batches create no artificial knowledge, and new methods may expand delivery. Normal three-chapter `--demo` execution now uses 13 simulated calls, with anomaly review additional. Historical frozen-version measurements remain unchanged; these tests are neither new live generation results nor evidence of lower cost or better teaching.
