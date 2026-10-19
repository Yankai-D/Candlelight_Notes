# 成立条件复核：任务收缩实验

上一轮 v2 出现了两个问题：复述主张时把原句变成纠正后的说法；把推导依据误当成笔记遗漏的适用条件。本实验缩小模型任务，检验简化是否减少误报和格式负担。

`server/condition-review.mjs` 只负责诊断契约。模型逐个引用程序生成的文字单元编号，返回 retain、contradiction、missing-condition 或 needs-source。正确内容不要求复述、列举前提或完整推导；发现问题时才要求对应证据或具体缺口。程序验证覆盖、来源页和连续引文，按原稿恢复文字范围。

这不是自动判真系统。`retain` 不表示已证明正确；即使引用逐字存在，也可能没有支持模型判断。错误地报告“遗漏条件”仍可能通过结构校验，因此所有诊断保持 `model-proposal-unverified`。当前没有改写或持久化接口，未接入应用。

## 对照范围

两组都只运行诊断阶段：保留原 v2 提示和校验逻辑，对比新协议。使用相同材料、文字单元、模型、温度和实际输出预算，均最多一次供应商请求、2,048 输出 tokens；截断重试不能绕过调用上限。本轮不运行修订，不能用诊断结果推断修订质量。

两例向量归一化是上一轮已见的失败回归；四例新开发稿涉及实对数定义域和缺少定理原文。新旧案例分别标注，标签均由 AI 协作编写。每例每组一次，计划在调用前提交，结果不用于调整本批提示或标签后重跑。

```sh
npm run eval:claims -- --focused
npm run eval:claims -- --focused --demo
npm run eval:claims -- --focused --live --case log-domain-overclaim --out artifacts/claim-eval/my-focused-run
npm run eval:claims -- --inspect artifacts/claim-eval/my-focused-run/run.json --out artifacts/claim-eval/my-focused-replay
```

默认仅冻结计划，`--demo` 不接触外部模型。真实调用必须显式选案例。记录保留失败、原始请求/响应、代码版本和实际用量；重放直接重新校验原始响应，防止结构化结果与供应商输出分离。输出目录不能覆盖已有证据。旧 v1/v2 实验及重放命令保持可用。

计划见 [2026-10-18-focused-plan.md](../runs/2026-10-18-focused-plan.md)。判断本轮表现时同时看正确原稿是否被误报、错误原稿是否漏检、来源缺口是否被误判为错误，不能只数 JSON 通过率或总标签一致数。

[真实结果已归档](../runs/2026-10-18-focused/README.md)：12 次请求，新协议在本批材料中表现更好且输出更少；同时记录旧协议标签恰好一致但错误定位错位的案例。材料仍是开发探针，不据此开启默认复核。
