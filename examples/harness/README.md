# 从执行记录理解 harness

这个演示使用**人工编写的输入、来源和模拟模型响应**，驱动项目真正的 `IdealRunner`。它不联网、不使用 Key、不读取用户资料。目的在于检查应用如何处理输出和失败，不能用来宣称模型生成质量。

```sh
npm run demo:harness
```

无需启动页面或配置模型。输出目录是 `artifacts/harness-demo/`。每次使用独立临时存储，完成后清理该次存储，仅留下可审阅产物。

## 先看故事，再看文件

目标是理解检索评价并比较两种方案。执行器构建两个分支：B1 评价基础，B2 小规模实验，B2 依赖 B1。

| 事件 | 应用行为 | 验证位置 |
| --- | --- | --- |
| B1 成功，B2 模拟供应商中断 | 保存 B1，任务失败可续接 | `trace.json` 中 `branch` 的中断记录与 `events` |
| 用户继续 | 从 B2 开始，B1 不重复生成 | `report.json#behaviorChecks.completedBranchNotRepeated` |
| B2 返回不存在的来源 ID | 校验拒绝，并仅允许一次格式修正 | `events` 中 `repair`、调用输入中的具体错误 |
| 内容审查发现成果缺少评价条件 | 只修订 B2，不改 B1 | `job.json#repairDone`、前后分支对比断言 |
| 已完成后再次继续 | 无新增模型调用 | `report.json#behaviorChecks.completedResumeIsNoop` |

`job.json` 是真实执行器保存的最终数据结构；`trace.json` 包含阶段输入、完整提示消息、模拟输出及执行事件；`report.json` 将结构/引文检查与人工审查要求分开。动态 UUID、时间戳和耗时每次不同，关键行为断言应该一致。

## 建议的阅读顺序

1. 打开 `report.json`，确认 `provenance.realModelCalls` 为 0，`checks` 与 `behaviorChecks` 通过，人工评审仍为 required。
2. 在 `trace.json` 搜索 `Sunknown`，比较被拒绝的模拟输出与后续修正；对应调用的 `messages` 保留系统提示、原始上下文和具体校验反馈。
3. 搜索“模拟一次供应商中断”，确认它出现在 B2；B1 的 branch 调用只有一次。
4. 在 `job.json` 查看 `reviewRound`、`repairDone` 和 `metrics`。模型调用计数在这里表示模拟供应商被调用的次数，不能换算为真实花费；completionTokens 为 0。
5. 对照 [架构说明](../../docs/architecture.md) 定位 `runner.mjs` 的持久化与校验边界。

面试时可以据此解释：“提示词要求什么”与“程序允许什么被保存”分别由哪里负责，以及一次失败为什么不会丢失已经完成的工作。真实文风和讲解正确性应展示另一份独立的效果评测。
