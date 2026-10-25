# 修复工作区实测 / Recovery workbench assessment

2026-10-21 在用户授权下，用已配置的 `deepseek-flash` 完成 22 次真实 API 调用，约 6 分 27 秒；输入 401,200 tokens，输出 32,710 tokens。原笔记未写入。下表保留失败尝试，不把迭代中的失败删除后计算“成功率”。私人章节、模型原文和详细检查点保留在被 Git 忽略的本机 artifacts 中，不随公开源码发布。

On 2026-10-21, an authorized assessment made 22 actual API calls using the configured `deepseek-flash`, taking approximately 6 minutes 27 seconds with 401,200 input and 32,710 output tokens. The original note was untouched. Failed attempts remain in the table rather than being removed to manufacture a success rate. Private chapter content, model responses and detailed checkpoints stay in ignored local artifacts, outside public source distributions.

| 实验 / Experiment | 实际调用 / Calls | 结果与判定 / Outcome |
| --- | ---: | --- |
| 复合错误，第一轮 / Compound faults, first attempt | 4 | 结构通过，但 31 块被重写成 42 块，保留性验收失败。/ Structure passed, but 31 blocks became 42; preservation failed. |
| 同一复合错误，第二轮 / Same faults, second attempt | 9 | 前两处局部修好；文字补丁的转义层级不匹配，回退重写成 33 块，仍失败。/ Two local fixes succeeded; an escaping mismatch caused fallback rewriting into 33 blocks, failing preservation. |
| 同一复合错误，最终轮 / Same faults, final attempt | 4 | 错误块类型 → 越界来源号 → 不配对公式逐项解决；另 28 块逐字段保持不变。/ Block type, source namespace and math delimiter corrected in sequence; all other 28 blocks preserved field for field. |
| 错误审查意见及无效审查协议，两轮 / False criticism and invalid audit protocol, two attempts | 2 + 2 | 实际来源反驳错误批评，模型撤销建议；正确正文未改。/ The model dismissed criticism contradicted by the source; correct prose remained unchanged. |
| 原章节内容审查 / Original chapter content review | 1 | 未注入错误，真实审查接受原候选。不是独立教学质量证明。/ No injected faults; live review accepted the original candidate. This is not independent teaching-quality evidence. |

复合测试使用真实历史候选，人工植入三处错误，并明确注入一次无效的首轮修复，以触发连续恢复；此后的诊断和修复都由真实模型完成，没有按策略名称返回预定正确答案。验收除了生产校验器，还比较原始块数、未涉及块内容和来源范围。原故障记录本身在修过解析器的当前代码下已直接通过，所以不把那次旧误报的消失记为模型自主修复。

The compound test starts from a recorded candidate, injects three faults and explicitly supplies one unsuccessful first repair to exercise continued recovery. All subsequent diagnoses and fixes come from the real model, without branch-dependent canned success responses. Independent assertions check block count, untouched content and source scope in addition to production validation. The original incident response already passes the corrected parser, so disappearance of that old false positive is not credited as autonomous model recovery.

本轮真实失败推动了两项实现修改：能识别工具意图但缺少操作字段时，反馈实际 schema 错误继续纠正；文字补丁支持解码后的字段路径，并由程序处理 JSON 序列化。单元测试覆盖原子性、过期绑定、越权路径、连续修复、错误修复计划、新引入的问题、唯一匹配、取消和实际调用限额。控制器本身也受协议校验，不能修改代码、源资料或验收规则。

Observed failures led to two implementation changes: recognizable but incomplete tool plans receive actual schema errors for correction, and text patches can target decoded fields with application-managed JSON serialization. Tests cover atomicity, stale binding, forbidden paths, sequential fixes, malformed plans, introduced regressions, exact matching, cancellation and actual-call ceilings. The controller is itself validated and cannot edit code, source materials or acceptance rules.

## 可复现入口 / Reproduction

公开入口使用独立原创的小型资料，覆盖复合格式/引用/公式故障，以及审查者提出错误独立性条件的案例，不读取私人资料库。未加 `--live` 时只列任务，不加载 Key、不联网，也不声称测试通过。加 `--live` 后读取本机 `.env`，最多 12 次真实 HTTP 尝试、5 分钟、24,000 输出 tokens，报告和无认证头的调用记录放在全新的 artifacts 子目录。

The public runner uses separate original miniature materials for compound schema/citation/math faults and a critic's false independence requirement, without reading the private library. Without `--live`, it only lists tasks: no key loading, network or claimed test pass. With `--live`, it reads the local `.env` and permits at most 12 actual HTTP attempts, five minutes and 24,000 output tokens. Reports and request records without authentication headers go into a fresh artifacts directory.

```sh
npm run eval:recovery:agent
npm run eval:recovery:agent -- --live --out artifacts/my-agent-run
node --test tests/recovery-workbench.test.mjs
```

这些是小样本的能力和工程证据，尚未覆盖所有模型、所有资料和全部失败类型。恢复成功仍依赖模型能形成正确判断；预算与外部不可修复问题仍会停止。普通 API 返回问题不能被当成必须让用户重试的理由，但也不能通过删内容、改验收或无上限调用掩盖失败。

These are small-sample capability and engineering checks, not coverage of every model, document or failure type. Recovery still depends on model reasoning, and budgets or unfixable external conditions can stop a task. Ordinary response errors should not automatically require user retries; deleting content, weakening acceptance or unbounded calling cannot conceal failures either.
