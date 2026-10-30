# 复习讲义风格基准 v3 / Revision handout style v3

v3 将默认目标从“教材式讲义”改为可独立复习的短讲义：先选知识，再写正文。读过一份来源不等于必须把它写进笔记。默认合并重复定义与同法例题，删除课堂铺垫、无关历史和旁支证明；保留核心概念、适用条件、决定性的推理、可复现的方法和代表例题。用户明确要求证明、完整题解或深入专题时，以该任务为准。

Version 3 changes the default from textbook-like exposition to a compact, self-contained revision handout: select knowledge before drafting. Considering a source does not require reproducing it. Merge repeated definitions and equivalent examples; omit classroom framing, irrelevant history and tangential proofs. Retain core concepts, conditions, decisive reasoning, reproducible methods and representative examples. Explicit requests for proofs, complete solutions or deeper treatment take precedence.

用户提供的正向风格参考进一步明确：精简是每段承担明确的学习任务，不是追求最少字数。大章组织方法族，小节回答具体问题；定义直接，步骤可执行，用关键反例区分概念，在真正的难点解释原因。需要的构造、正确性、终止条件和边界论证应保留。例题数量由实质差异决定，不机械规定一个主题只能有一个例子。简短的知识关系概览可以保留；完整题库与自测只在目标要求时生成。这是用户的风格偏好，不代表对参考材料内容正确性的审计。个人参考文件不进入公开源码或安装包。

The user’s positive style reference further clarifies that concision means each passage performs a clear learning task, not minimum word count. Major chapters group method families; subsections answer specific questions. Use direct definitions, executable steps, discriminating counterexamples and explanations at genuine conceptual difficulties. Preserve necessary constructions, correctness arguments, termination conditions and boundaries. Select examples by substantive differences rather than a one-example quota. A brief map of knowledge relationships is useful; full question banks and self-tests require a matching goal. This is a style preference, not a factual audit of the reference. The personal reference file is excluded from public source and installers.

讲义以完整知识主题或解题任务组织章节，章内用紧凑的解释连接概念、关键原理、操作、例题与条件变体。精简减少重复和碎片，深度保留方法为何成立、何时适用以及关键推算。它既不是课件要点的扩写，也不是把资料逐段翻译后拼接。

A handout groups complete knowledge topics or problem-solving tasks into chapters. Concise explanations connect concepts, key reasoning, procedures, examples and changes in assumptions. Compression removes repetition and fragmentation while retaining why a method works, when it applies and the decisive calculation steps. It is neither expanded slides nor concatenated translations.

## 稳定规则 / Stable rules

相同方法的原理、使用和例题默认在同章；只有任务、方法族或先修层次实质变化才另立章。章内使用必要的小节标题，不把“概念、方法、例题、变体”做成固定栏目。已有章节标题足够定位时，不强制正文再加标题。不规定章数、字数、标题数或压缩比，避免为达数字指标而漏知识。

Keep a method’s reasoning, use and examples together. Add chapters when the task, method family or prerequisite level changes materially. Use meaningful subheadings where needed, without mandatory concept/method/example/variant slots. An existing chapter title can provide sufficient navigation. Chapter counts, word counts and compression ratios are not acceptance quotas.

一段应推进一个明确关系。定义先交代对象，公式说明条件与符号；在决定方法的推理处展开，在重复代数处收紧。例题保留足够题干，简述选法依据，给可复现过程与结果。变体在主方法旁解释条件、步骤和结论怎样变化。未知来源不补成原文，自编例子明确标注。

Each paragraph advances a specific relationship. Define objects and formula conditions, expand decisive reasoning and compress repeated algebra. Worked examples retain a sufficient problem statement, method choice, reproducible steps and result. Explain variants alongside the method they modify. Do not invent source claims; label authored examples.

## Harness 中的落实 / Harness integration

`shared/lecture-synthesis.mjs` 是统一写作契约与编排/审阅准则的来源；`shared/lecture-handout-sample.mjs` 是原创紧凑样稿。资料包规划可记录每章的 `focus`、`recallFrom`、`omit`，明确本章主讲、前文简短回顾和不展开的内容。旧规划和其他任务仍兼容可选的教学字段。

`shared/lecture-synthesis.mjs` supplies the writing contract and planning/review criteria; `shared/lecture-handout-sample.mjs` supplies the authored compact example. Bundle plans can record each chapter’s `focus`, `recallFrom` and `omit`, distinguishing primary teaching, brief recall and exclusions. These teaching fields remain optional for older plans and other tasks.

每章都先分析来源，再通过独立的 `lecture-outline` 从学习目标重置交付规划，即使来源很短也不直接扩写分析草稿。原文超过 48,000 字符时分批阅读、保留完整页；阅读批次只影响取证，不增加正文任务。规划确定读者最终应理解的区别、可执行的方法、必要推理及代表题，随后一次整章写作。写作任务不再按原文页数字数切分后拼接，完成这些学习任务即可结束。

Every chapter first analyzes sources, then independently resets its deliverable through `lecture-outline`, even for short sources. Reading uses batches above 48,000 characters while preserving whole pages; batches affect evidence acquisition, not the number of prose tasks. Selection defines the distinctions, executable methods, decisive reasoning and representative problems the learner needs. One whole-chapter writing task follows, ending when those learning tasks are complete rather than splitting and concatenating prose according to source length.

资料包的 `sourceSelection.omissions` 允许有理由地不把重复或无关资料列入教学职责，但索引摘录不能证明全文无关。因此这些来源仍分配到一次全文分析中，核实后可以省略，也可以重新纳入需要讲解的知识。纯行政内容的阅读批次允许不产生知识单元。最终取舍记录保留在检查点；仅当资料确实没有支持目标的知识时明确报告资料不足，不编造讲义。

Bundle `sourceSelection.omissions` records reasons for excluding repeated or irrelevant sources from teaching responsibilities, but previews cannot establish irrelevance of the full text. These sources still enter one reading analysis, which can confirm exclusion or recover relevant knowledge. Administrative-only batches may produce no learning units. Selection records stay in checkpoints; if no source supports the requested knowledge, report that limitation rather than inventing a handout.

写作者先接收与所选知识绑定的逐字原文片段，不接收全部阅读材料作为扩写清单。片段明确标记省略，可请求展开所选原页核对上下文；展开只增加证据，不改变教学任务或产生另一段要拼接的正文。校验和审查仍保留完整原页及原定位。引用片段不是摘要，也不是知识正确性的证明；保留、合并和省略理由同样需要评审。

The writer initially receives verbatim spans bound to selected knowledge, not the entire reading corpus as an expansion checklist. Excerpts are explicitly marked partial and selected pages can be expanded to verify context. Expansion adds evidence without changing the teaching task or creating another prose fragment to concatenate. Validation and review retain full originals and source bindings. Extractive evidence is neither a summary nor proof of correctness; inclusion, merging and omission still need review.

`shared/lecture-editorial.mjs` 提供与前章或当前正文重复的较长原句线索。0.1.41 起长度仅记录，不再按知识单元估算字数或以篇幅触发审查。只有具体可疑结果才触发现有审查；核查时结合教学职责，允许同例的新应用和必要证明，通过删除、合并、定向修改解决实际冗余，不增加固定重写轮数。当前本地重复检查只识别规范化后的原句重复，不能保证识别所有换词复述。跨章安排与实际正文记录见 [教学安排](teaching-plan.md)。

`shared/lecture-editorial.mjs` identifies substantial repeated passages. As of 0.1.41, length is observational: unit-based estimates and length-triggered review are removed. Concrete suspicious results activate the existing review, which considers teaching responsibilities, permits new applications and necessary proofs, and removes or merges actual redundancy without a fixed rewrite count. Local duplicate detection identifies normalized exact passages, not every paraphrase. See the [teaching plan](teaching-plan.md) for cross-chapter responsibilities and actual prose bindings.

内置默认样稿升级采用精确版本匹配，保留用户改过的个人样稿、撤销记录及版本号。已生成笔记和其中锁定的样稿快照不被批量改写；新建笔记使用新默认样稿，主动重生成或局部编辑遵守当前讲义契约。论文长文和题目讲解仍由各自模板负责。

Default sample migration matches known versions exactly and preserves edited personal samples, undo history and revision numbers. Existing note content and locked sample snapshots are not rewritten in bulk. New notes use the new default sample; explicit regeneration or local editing follows the current handout contract. Narrative papers and exercise solutions retain their own templates.

## 评审与迭代 / Evaluation and iteration

运行 `node scripts/preview-lecture-style.mjs` 生成三份原创样稿的统一阅读预览。开发样稿覆盖描述统计、多重检验和二分查找，分别考查概念与计算口径、方法选择与条件、算法不变量与边界。每份列出应教会的知识和具体反例，不能将样稿当作未见测试集。

Run `node scripts/preview-lecture-style.mjs` to render three authored anchors with the production reader/export renderer. Descriptive statistics tests concepts and calculation conventions; multiple testing tests method choice and assumptions; binary search tests invariants and boundaries. Each anchor lists concrete learning requirements and anti-patterns. These development materials are not a held-out test set.

复核按结构、密度、深度、可操作性、范围和可读性六项进行，每项引用具体段落和改法。第一轮发现旧样稿将一个方法拆成四章，第二轮补齐新样稿中样本方差分母的关键依据，第三轮核对多重检验条件及二分边界，并统一公式渲染。算例验算和协议测试只能证明这些局部性质，不能证明生成质量已经提高。

Review structure, density, depth, actionability, scope and readability using specific passages and proposed edits. The first local pass identified the old sample’s four-way fragmentation; the second supplied the key justification for the sample-variance denominator; the third checked multiple-testing assumptions, binary-search boundaries and shared math rendering. Arithmetic and protocol tests establish local properties, not an improvement in generated teaching quality.

下一轮真实对照应固定资料、目标、画像和模型，比较旧版与新版的规划及正文；评审表先留空，记录遗漏、错误、冗余和定位段落，并另选未参与样稿开发的材料检查泛化。通过后再把成功例与失败例作为后续版本的固定回归依据，而不是根据单次微调不断叠提示。当前未运行这轮真实对照，不报告模型教学优势或用户认可。

A future live comparison should hold source, goal, profile and model constant while comparing old and new plans and prose. Start with blank review judgments, record omissions, errors, redundancy and exact passages, and use separate unseen materials to probe generalization. Promote reviewed examples and failures into versioned regression evidence instead of accumulating ad hoc prompt clauses. That live comparison has not run; no model-quality improvement or user endorsement is claimed.

v3 的离线回归覆盖“多组重复资料全部分析后只写一次选中内容”、来源定位、省略说明、跨章教学责任、异常触发和合理长文放行，以及取消时停止后续调用。规划重置回归进一步将同一知识材料重复 40 倍：模拟响应固定教学任务，程序增加阅读批次，却保持一次交付规划、一个写作任务及相同的选定原文；新增实质方法则允许增加任务。这证明编排规则，不证明模型能可靠识别所有重复。原创样稿预览输出在 `artifacts/lecture-style-v3/`，不能当成模型生成成品。此次规划重置未进行真实 API 质量对照或节费测量；短章节也增加一次交付规划调用，不能仅凭流程宣称总费用下降。

The v3 offline suite checks that all repeated source groups are analyzed before selected content is written once, together with evidence bindings, omission reasons, chapter responsibilities, anomaly review, justified long prose and cancellation. Planning-reset tests additionally multiply equivalent source volume forty-fold: scripted responses hold learning tasks fixed while code increases reading batches, retaining one deliverable selection, one writing task and identical selected evidence. A materially new method may add a task. This proves orchestration, not reliable model recognition of every duplicate. Authored previews in `artifacts/lecture-style-v3/` are not model-generated results. The planning reset has no live quality comparison or cost measurement; short chapters now also add a selection call, so lower total cost is not guaranteed.

升级只迁移精确匹配的旧内置默认模板，个人样稿与旧笔记保持不变。已有臃肿笔记需要从“调整并重新生成”主动重做；如选择了旧个人样稿，也需由用户决定是否恢复默认。

Upgrades migrate only exact matches to old built-in defaults, preserving personal samples and existing notes. Regenerate an existing bloated note explicitly through the goal/revision entry; users retain control over whether to reset an older personal sample to the default.
