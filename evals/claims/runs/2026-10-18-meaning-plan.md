# 解释与计算含义的一次受控验证

本计划在真实调用之前保存。基线是现有 `condition-review-v1`，实验组只在同一 system 消息末尾增加 `evals/claims/meaning/policy.mjs` 的一段检查指令。两组都只诊断，不生成改稿，也不改变输出 JSON 契约。

## 具体假设与材料

实际公开教材讲义的 b7:s2 把算术均值说成“各观测值以自身大小为权重”，但上一轮复核返回 retain。现有任务强调成立条件，可能未充分检查解释文字隐含的运算。这是待检验的任务盲点，不能预先认定它就是漏检原因。

| 案例 | 来源和用途 | 开发参考 |
| --- | --- | --- |
| mean-observed | 真实 field 记录 w4 完整上下文，已见漏检 | b7:s2 contradiction，其余 retain |
| mean-equal-control | 仅把错误短语改为相加除以 n、相同系数 | 全部 retain |
| mean-contribution-control | 仅把错误短语改为数值对总和的贡献 | 全部 retain |
| weighted-control | 原创、明确指定不同正权重的加权均值 | 全部 retain |
| center-order-mismatch | 原创，式子 (x-a)/b 却解释成 x/b-a | p1:s2 contradiction，正确公式 retain |
| center-order-control | 同来源、同公式，文字先减再除 | 全部 retain |

材料与参考由 AI 协作编写；一例已见，三例是针对它的控制，跨概念正反例也属于开发数据。没有独立标注、未见留出集或统计意义上的准确率。参考判断和数值示例不进入请求。真实窗口来源是 OpenIntro Statistics 第四版（David Diez、Mine Çetinkaya-Rundel、Christopher D Barr），CC BY-SA 3.0；沿用 [field 来源与署名](2026-10-18-field/README.md)。修改的中文材料继续保留同一许可及改编说明，不表示作者背书。

## 执行与判据

六例各两组，每组每例一次请求，交替顺序；deepseek-flash，temperature=0，thinking disabled。最多 12 次实际调用、每次 2,048 输出 tokens，总输出上限 24,576；输入另计。保留原始响应、实际上下文、失败和用量；截断不扩大预算，格式错误不修复。调用前固定代码版本，观察结果后不改提示再重跑本批。

必须分别看 b7:s2 的定位、正确句的保留、跨概念正反例、格式失败和全部真实用量。旧错误若两组此次均检出，只能说此次没有区分收益；如果实验组检出但误报正确表述，也不能称为改进。相同总体标签不能掩盖错误定位。数值检查仅验证指定解释下的具体计算，不认证模型自然语言。

即使全部参考标签一致，也要逐条读诊断依据，记录错因是否相关。本轮不直接启用生产复核，不改用户笔记，不将 AI 判读写成人工评分。下一阶段应依据实际结果选择：扩大真实材料验证、修正任务边界，或放弃无收益规则。

## 零调用复现

```sh
npm run eval:claims -- --meaning
npm run eval:claims -- --meaning --demo
npm run eval:claims -- --inspect <run.json> --out <新目录>
```

真实运行必须使用 `--meaning --live` 并显式列出上述六个 `--case`；默认命令不会读取 Key 或发出请求。产物为 run.json、report.json、report.md，沿用现有检查点和只写新目录的约定。
