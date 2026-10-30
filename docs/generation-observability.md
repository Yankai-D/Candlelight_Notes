# 生成进度与质量—成本回归 / Generation progress and quality–cost regression

生成时，编辑框上方显示当前阶段、耗时和模型请求次数；展开可看已完成章节、阶段输入/输出 token、修复动作、资料索引复用及提供方报告的缓存命中。默认收起，结束后保留本次摘要。暂停使用原有取消按钮，已保存章节与检查点沿用原有流程。

During generation, a compact panel above the editor prompt shows the current stage, elapsed time and model request count. Expand it for completed chapters, tokens by stage, recovery actions, reused source indexes and provider-reported cache hits. It starts collapsed and retains the operation summary afterward. The existing cancel button pauses work; saved chapters and checkpoints follow the existing workflow.

本面板覆盖笔记规划、模板选择、逐章生成与局部 AI 编辑。它不是独立后台队列，也不是逐 token 流式输出；页面关闭或取消仍终止本次请求。学习树和模板优化没有接入这个笔记面板。多章任务按请求标识替换快照再累计，重复轮询不会重复计算。

The panel covers notebook planning, template selection, chapter generation and inline AI editing. It is neither an independent background queue nor token streaming: closing the page or cancelling still terminates the request. Learning-tree and template-optimization screens do not use this panel. Multi-chapter totals replace snapshots by request ID before aggregation, so repeated polling cannot double-count usage.

模型返回用量后才更新 token。未报告、进行中及失败请求的未知部分不当作零费用；暂停后的摘要也只包含最近收到的进度。应用不猜测人民币金额，账单以提供方为准。完整持久记录仍从“生成记录”查看。

Tokens update only after the provider reports usage. Unreported, in-flight or failed requests are not assumed to cost nothing; a paused summary contains only the latest received progress. The application does not guess currency costs; provider billing is authoritative. Persistent evidence remains available through generation records.

`POST /api/generation-progress` 复用本地令牌、来源和工作区校验，只返回内存中的计数及阶段，不返回 Key、来源正文、提示词或原始响应。完成记录保留至多 10 分钟、128 条；进行中任务不会被该清理淘汰。状态轮询不重发生成请求，轮询超时/失败不会中断生成。最终响应附带快照，快速请求也能累计。

`POST /api/generation-progress` uses the existing local token, origin and workspace checks. It returns in-memory counters and stages, never keys, source text, prompts or raw responses. Finished records expire after ten minutes or beyond 128 entries; active tasks are not evicted by this cleanup. Polling never replays generation, and polling failures or timeouts do not interrupt it. Final responses include a snapshot so fast requests are counted too.

## 零调用回归 / Read-only regression

`npm run eval:regression -- --demo` 用模拟记录验证报告链路，不访问模型或读取 `.env`。它也加入 `npm run check`。报告标为 `simulation-only`，不产生教学质量结论。

`npm run eval:regression -- --demo` verifies reporting with simulated records, without accessing a model or reading `.env`. It is also part of `npm run check`. Reports are marked `simulation-only` and establish no teaching-quality result.

真实对照沿用 [笔记评测工具](../evals/notes/README.md)：分别保存基线和候选版本的运行，打开各自 `review.html`，按来源、正文及评分锚点填写人工工作册并导出 JSON。之后执行以下只读命令；比较器本身产生零模型调用，拒绝覆写旧目录。

For real comparisons, use the existing [note evaluation tools](../evals/notes/README.md): retain baseline and candidate runs, open each `review.html`, complete the human workbook against source material and scoring anchors, and export JSON. Then run the read-only command below. The comparator makes zero model calls and refuses to overwrite an existing output directory.

```powershell
npm run eval:regression -- --baseline artifacts/baseline --candidate artifacts/candidate --baseline-review artifacts/baseline/review.json --candidate-review artifacts/candidate/review.json --out artifacts/regression-review
```

两轮必须具有相同的来源、目标、画像、学习设置（模板资产除外）、评分标准、方法矩阵、评测额度、模型名称及地址。提示词、模板及实现可以改变，报告记录提示词变化、原始快照哈希及源码版本。默认比较 `harness`，可显式重复 `--arm` 选择其他共有方法。历史人工工作册没有评分标准哈希时需用 `eval:notes -- --inspect <private-run.json> --out <新目录>` 重建工作册并复核；不会自动替旧评分背书。

Both runs must share sources, goals, learner profile, learning settings except template assets, criteria, method matrix, evaluation allowance, model name and endpoint. Prompts, templates and implementation may change; reports retain prompt changes, artifact hashes and source revisions. The default comparison is `harness`; repeat `--arm` to select other shared methods explicitly. Historical workbooks without a rubric hash must be regenerated with `eval:notes -- --inspect <private-run.json> --out <new-directory>` and reviewed again; old ratings are not automatically certified.

默认报告标记输入/输出或估算费用超过基线 1.25 倍、耗时超过 1.5 倍、任一内容维度下降、低于 3/4 或存在严重内容错误。可通过 `--policy <json>` 在运行前冻结不同规则。**这是评测报告的判据，不是生产生成的调用、时间或修订上限。** 无人工评分不能通过内容验收；失败输出保留在分母中，不把失败导致的低用量当成节省。P50/P95 只是当前小样本最近秩统计。

Defaults flag input/output tokens or estimated cost above 1.25 times baseline, latency above 1.5 times baseline, any content-dimension decline, scores below 3/4, and critical content errors. Freeze different rules beforehand with `--policy <json>`. **These are evaluation reporting criteria, not production call, time or revision limits.** Unreviewed outputs cannot pass the content gate. Failures stay in the denominator and are never presented as savings. P50/P95 are nearest-rank descriptive statistics for the current small sample.

只有显式提供 `--prices <json>` 才估算金额。字段为 `currency`（三位大写货币代码）、`asOf`（日期）、`model`、`baseUrl`、`inputPerMillion`、`outputPerMillion`，可选 `cacheHitInputPerMillion`；价格单位为每百万 token。价格表必须匹配模型与服务地址，两轮使用同一价格表。启用缓存价格但缺少命中/未命中用量，或两者之和不等于输入量时，金额保持未知。不要将示例价格当作现行收费。

Currency estimates require an explicit `--prices <json>`. Fields are `currency` (three uppercase letters), `asOf` (date), `model`, `baseUrl`, `inputPerMillion`, `outputPerMillion`, and optional `cacheHitInputPerMillion`; rates are per million tokens. Provider and model must match, and both runs use the same price sheet. When cache pricing is enabled but hit/miss counts are missing or do not sum to input tokens, cost remains unknown. Example prices must not be treated as current tariffs.

退出状态 1 表示需要审查、缺少人工评分或用量证据不全；`simulation-only` 只说明离线链路可运行。`no-observed-regression` 仅说明这批配对样本在冻结判据下未观察到退化，不证明教学优势或用户学习效果。

Exit status 1 means attention is required, human ratings are missing, or usage evidence is incomplete. `simulation-only` verifies the offline toolchain. `no-observed-regression` means only that the paired sample showed no regression under the frozen criteria; it does not establish teaching superiority or learner outcomes.

当前公开三场景仍是开发集：论文、课件和小纸条使用固定模板，覆盖单章正文和格式恢复，不覆盖自动路由、语义审查、资料包规划、全文衔接、索引冷启动/复用或整学期讲义。原有故障注入测试分别覆盖这些运行边界；不能拿它们代替内容质量和整任务费用测量。本轮未运行收费对照，也未改写生产讲述模板。

The current three public scenarios remain a development set: paper, slides and inline explanation use fixed templates, covering single-chapter output and format recovery. They do not cover routing, semantic review, bundle planning, cross-chapter flow, cold/reused indexes or semester-length notes. Existing fault-injection tests cover operational boundaries separately; they cannot replace content-quality and whole-task cost measurements. This release ran no paid comparison and did not rewrite production teaching templates.
