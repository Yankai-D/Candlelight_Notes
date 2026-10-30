# 学习笔记效果评测

当前工具的边界是冻结正文请求、生产校验与恢复；`harness` 等历史组名保留，不代表正在评测当前完整生成系统。资料分析、目标驱动的交付规划和按需展开证据由整份讲义工具 `eval:course` 覆盖。历史真实响应和费用记录保持原样，新模拟不补造真实效果。

This tool now explicitly evaluates frozen writing requests with production validation and recovery. Historical arm names such as `harness` remain labels, not claims to evaluate the complete current generation system. Use `eval:course` for source analysis, goal-driven deliverable selection and evidence expansion. Historical responses and costs remain unchanged; new simulations do not establish live performance.

跨版本质量—成本回归入口为 `npm run eval:regression`：读取冻结运行与人工评分，不调用模型；默认离线演示用 `--demo`。配对约束、金额估算、退出状态和范围见 [生成观察与回归说明](../../docs/generation-observability.md)。

Use `npm run eval:regression` for cross-version quality–cost comparisons. It reads frozen runs and human ratings without model calls; `--demo` exercises the offline path. See [observability and regression documentation](../../docs/generation-observability.md) for pairing constraints, cost estimates, exit states and scope.

当前重点回到 [主产品三场景对照](runs/2026-10-18-product-plan.md)：ResNet 长文、OpenIntro 课件、小纸条追问。使用 `--suite product-scenarios`，固定一份画像、两种方法、每组一次，复用本工具与人工审阅页。数学复核实验暂时冻结，历史记录保留。此轮不改生产提示词，先检查实际笔记质量；无人工审阅就不宣布优势。

[真实运行已归档](runs/2026-10-18-product/README.md)：7 次请求，harness 交付 3/3、直接调用 2/3；有一次格式修复，无截断。解释中的证据强度与背景假设仍有待核对的问题，独立人工评分为空。

随后 [证据约束单项对照](runs/2026-10-18-evidence/README.md) 用 7 次请求比较改前完整 harness 与一个新写作后缀。六份结构通过，内容仍未满足采用要求；候选已撤回，仅保留显式 `--suite evidence-boundary` 重放。另提供明确标注的 AI 编辑样稿，用于实际阅读讨论，不作为模型成绩。

这套工具回答一个窄问题：**固定单章材料、稳定画像、学习目标和写作模板，当前 harness 相比直接调用，是否交付更可靠、更适合阅读的笔记？** 已完成 [首轮真实开发诊断](runs/2026-10-17-pilot/README.md)：6 份输出全部结构接受，初步内容核对仍发现问题。尚无独立人工评分或优势结论；模拟输出不能进入效果结论。

不覆盖模板自动选择、全文承接、多文件合成、检索质量或用户学习成效。这些应有独立用例，不能用单章结果代替。

开始正式评分前，先用 [评测校准工作册](calibration/README.md) 练习：`npm run eval:calibrate` 生成 8 组原创正反例，覆盖六个评分维度，并运行 11 项生产执行边界回归。它不调用模型，也不会把原创参考稿加入本工具的真实候选或效果统计。参考判断仍需独立人工复核。

## 先运行，不消耗 Key

```sh
npm run eval:notes
npm run eval:notes -- --demo
```

第一条冻结实验方案，不调用任何模型。第二条使用明确标记的模拟响应，驱动**现有生产笔记 harness**，生成全部审阅文件。两条默认都包含 3 份材料 × 2 种画像 × 2 种方法。模拟正文故意不讲解材料，两个方法返回同样的探针；其作用是验证文件、渲染、记录和评分流程。

输出在 `artifacts/note-eval/<时间>-plan|demo|live/`。目录不会被覆盖，也不会自动恢复付费任务。`npm run check` 同样执行离线演示。

| 文件 | 用途 |
| --- | --- |
| `plan.json` | 原文、目标、画像、模板快照、初始提示全文与哈希、预算、Git 版本及工作区状态 |
| `review.html` | A／B 并排审阅，复用产品的公式和正文渲染；表单只在本机下载 JSON |
| `review-packet.json` | 隐藏方法标签的材料与笔记，不含耗时、token 或调用轨迹 |
| `review.template.json` | 尚未评分的记录，可人工编辑，也可由 HTML 表单导出 |
| `private-run.json` | 实际每次请求和响应、修复、失败、用量、最终笔记；审阅完成后再查看 |
| `private-mapping.json` | 匿名标签与方法的对应关系；不给审阅者提前看 |
| `checkpoint.json` | 每个候选完成后保存；只用于排查，不是自动续跑入口 |
| `summary.json` | 机械状态、失败分母、人工评分和跨画像判断；没有自动“优势结论” |
| `diagnostics.json` / `diagnostics.md` | 从实际发送记录重算额度、用量、修复与截断；与教学质量评分分开 |

真实 API Key 与请求认证头不会写入这些文件。实际端点、公开材料、模型输出会保存于本机文件；输出目录由 Git 忽略。

### 导出对照审阅 PDF

打开 `review.html`，点击底部「打印 / 保存 PDF」，在浏览器打印窗口选择保存为 PDF。默认 A3 横向，保留 A／B 并排与背景色；来源、评分尺度和局限自动展开。PDF 是阅读副本，评分仍须用「下载审阅 JSON」保存；打印后网页的展开状态和未保存评分不变。

需要与桌面页面同宽的连续长 PDF，可直接运行：

```sh
npm run eval:notes:pdf -- --input artifacts/evidence-review/review.html --out output/pdf/evidence-review.pdf
```

导出复用页面现有正文与 SVG 公式，不重新调用模型，不读取 Key。需要本机 Chrome / Edge / Chromium；超长内容在 PDF 页面尺寸上限内自然分页。

## 对照与公平性

| 方法 | 输入与流程 | 要回答的问题 |
| --- | --- | --- |
| `direct` | 相同原文、目标、画像、模板组织描述；合理的准确性与 JSON / 数学格式指令；一次生成 | 产品整体编排相对一个可用的直接调用基线有什么变化？ |
| `harness` | 产品 `buildMessages → runModel → validateResult`；完整模板样稿、约束与有界修复 | 当前交付流程的结果与失败率怎样？ |
| `no-sample`（可选） | 保留 harness 的其他部分，只移除提供给模型的样稿 | 样稿在这一配置中的边际作用如何？ |

直接调用组不会故意缺失学习目标或输出格式。两组最终经过同一个产品格式校验，失败保留为失败样本；直接调用没有产品的格式修复循环。相同请求上限不等于相同实际花费。`harness` 的样稿会增加输入 token，可能使用更多调用，报告必须同时比较质量、失败率和实际用量。

样稿消融命令：

```sh
npm run eval:notes -- --demo --arm direct --arm harness --arm no-sample
```

这不是“只改变一个提示词”的整体对照。只有 `harness` 对 `no-sample` 才是样稿的局部消融。不能从整体对照中直接归因某条规则的贡献。

两种画像保留同一目标和模板，仅改变明确的知识基础。不同材料可以有不同模板；同一材料的文风不应因画像变化。比较顺序在案例和重复之间轮换；匿名标签在同一材料的两种画像间保持一致。标签隐藏不保证审阅者无法从文风猜出方法。

## 材料与使用历史

| 材料 | 类型 | 使用边界 |
| --- | --- | --- |
| 对角缩放与二次惩罚 | 原创研究论述式材料 | 单步公式、算例、等价条件与证据边界；不是已发表论文 |
| 标准差与标准误 | 原创课件文字 | 概念、推导、量纲、算例与相关样本边界；不是学校试题 |
| OpenIntro 均值选段 | 已导入的公开教材 | 已参与样稿开发，只用于回归；保留署名、页码和许可 |

三份材料现均标为 `development`。两份原创材料最初作为公开迁移探针，相关概念和边界随后参与了离线校准开发；OpenIntro 已用于样稿。**当前没有保密留出集**，不能宣称在真正未见材料上的泛化性能。Adam 已参与人工样稿及来源纠错，也不能冒充新材料。

验收要点写在 `cases.mjs` 的 `criteria`，不发送给生成模型；模型只看到正常学习任务。数学算例另有独立数值核对测试。未来人工修订验收要点或材料时，需要新实验，不能沿用旧结论。

OpenIntro 文字直接复用已有来源夹具：David Diez、Mine Çetinkaya-Rundel、Christopher D Barr，《OpenIntro Statistics》第四版，原书第 47、48 页，来源 [OpenIntro](https://www.openintro.org/book/os/)，许可 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。抽取文字没有改写，不包含原图；改编输出保留相同署名与许可。本测试项目不代表 OpenIntro 背书，材料许可不替代项目代码的许可决定。

## 人工审阅与汇总

1. 打开 `review.html`，先看任务、来源和验收要点，再分别阅读 A／B。不要提前看 `private-*.json`。
2. 依据 [评分规则](RUBRIC.md) 填写六个维度。每项必须有**笔记中的短引文和具体理由**。遗漏无法引用缺失的文字时，引用邻近的实际段落，并在理由中指出缺少哪个来源要点。
3. 单独标记重大事实、公式、条件或内容遗漏。跨画像比较文风、事实与铺垫；引用两份笔记中的实际文字，不根据长度猜测适应性。
4. 下载 `review.json`。页面不自动保存，关闭或刷新前先下载。可在导出 JSON 中补充多个错误条目。模拟记录可以练习流程，汇总仍不会产生质量成绩。
5. 汇总：

```sh
npm run eval:notes -- --summarize artifacts/note-eval/<运行目录> --review <review.json的路径>
```

评分绑定具体产物哈希。错用另一轮输出、重复记录会被拒绝；缺失评分、伪造引文或遗漏跨画像检查会得到 `awaiting-human-review`，不生成均分。通过后分别报告各维度、同案例差值、重大错误和失败数量，**不生成掩盖错误的综合总分**。失败候选计入总数，不从结果中悄悄删除。

第一次正式审阅建议两位审阅者先独立评同一小组，再讨论分歧并校准尺度。单人结论需标清审阅者，不能冒充盲评共识。当前没有自动模型裁判；模型自评不能替代来源核对。

## 显式运行真实对照

决定实测时，可复用应用“设置 → 模型连接”保存的本机 `.env`，或自行填写 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL`。脚本读取文件，不需要重启日常服务；配置 Key 不等于授权实测，真实调用仍需显式使用 `--live`。普通 `check` 只运行离线工具。

```sh
npm run eval:notes -- --live --case diagonal-penalty
```

必须显式选择材料。上述命令是 1 份材料 × 2 画像 × 2 方法，共 4 个候选；每个最多 2 次实际模型请求，每次请求最多 2048 输出 token，累计输出额度最多 4096。**输入 token 另计，不是货币成本上限。** 截断和格式修复也消耗相同额度。提供方没返回用量时按全额保留预算，用量报告为 `null`，不假装已知；金额不填猜测的价格。

默认 `temperature=0`，显式关闭现有 DeepSeek 适配器的思考模式，仍不保证服务逐次确定性。`--repeats 3` 可做重复实验，范围 1–5，会按比例增加请求上限。记录模型名不等于锁定供应商内部权重版本，服务变化仍会影响结果。

第一轮真实对照用于发现失败、校准评分，不用于发布“提升 X%”。之后再建立更广的材料池、隔离调教用例、重复试验，并记录预先约定的成功标准。对源码的改动须重新执行实验；初始提示哈希不匹配时会拒绝沿用旧方案。

## 从历史记录复核，不调用模型

```sh
npm run eval:notes -- --inspect evals/notes/runs/2026-10-17-pilot/run.json --findings evals/notes/runs/2026-10-17-pilot/findings.json
```

核对记录哈希、实际额度和逐段证据。追加 `--out artifacts/pilot-review` 可从历史输出重建审阅页，目标目录必须不存在；不读取 Key，也不会重跑生成。输入既可以是保留的真实快照，也可以是演示的 `private-run.json`，模拟标记仍会保留。重建显示使用当前共用渲染器，不等同于锁定未来所有显示依赖的历史像素结果。

`findings.json` 是 AI 协作者的初步诊断，显式标注非独立、已见方法标签、待人工复核。证据验证只检查引文和段落定位真实存在，不认证语义判断；不会代替 `review.json` 或把人工评分状态改成已完成。

## 单项约束实验

`operation-consistency` 套件比较现有完整 harness 与仅增加“文字操作对象、变量取值时点和公式顺序一致”约束的版本。规则仅在评测模块内，未进入应用默认生成。四份原创探针含合法顺序与无需算法的反向控制；原文、画像、目标、样稿、修复与预算不变。详见 [运行前方案](runs/2026-10-18-operation-plan.md)。

[本轮真实结果](runs/2026-10-18-operation/README.md) 已归档：8 次调用、两组各 4 份结构接受；AI 初步核对未观察到可区分的目标改善，实验组仍有条件推广错误，规则未进入默认流程。真实记录可零调用重建，正式人工评分仍待完成。

```sh
npm run eval:notes -- --demo --suite operation-consistency
```

这条命令只用模拟响应验证工具链。真实调用仍必须 `--live` 并逐个指定 `--case`；例如四份材料为 `independent-shrink`、`simultaneous-state`、`affine-composition`、`variance-identity`。默认每格一次，共 8 个候选，最多 16 次请求、32,768 输出 token，输入另计。套件固定同一熟练画像及两种方法，不测跨画像差异。默认 `eval:notes` 的原有材料与方法不扩容。

运行前冻结规则与数值判据哈希；候选只增加一个 system 后缀，判据与反例不发送给模型。正式人工评分支持按本轮预定的 baseline/treatment 计算各维差值，仍不生成总分或自动优势结论。
