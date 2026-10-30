import { lectureSample } from '../../shared/lecture-synthesis.mjs';

// Authored development anchors, not provider output, held-out benchmarks, or
// evidence that the new prompt already improves model quality.
export const lectureAnchors = [
  { id: 'descriptive', title: lectureSample.title, origin: 'project-authored',
    goal: '掌握均值、方差的计算和口径，能解释极端值对选择的影响。',
    paragraphs: lectureSample.paragraphs,
    checks: ['解释偏差为什么不能直接相加', '给出 n−1 的关键依据与抽样条件', '可从完整题干复算结果', '区分估计和有限总体描述', '依据任务比较均值与中位数'],
    avoid: '把概念、方法、例题、口径分别拆成四章；只说“代入公式”而不给平方偏差和。' },
  { id: 'multiplicity', title: '多重检验：先选要控制的错误', origin: 'project-authored',
    goal: '会区分 FWER 与 FDR，选择并执行 Bonferroni 或 BH 校正。',
    paragraphs: [
      { id: 'error', text: String.raw`## 1. 错误控制的对象决定方法

一次检验控制第一类错误，并不等于一组检验仍有相同保障。若 20 个真零假设的检验相互独立、各自恰有 \(0.05\) 的误拒概率，至少误拒一次的概率为 \(1-0.95^{20}\approx0.642\)。这里算的是整组至少一次错误的概率，不是错误占发现的比例。` },
      { id: 'targets', text: String.raw`记 \(V\) 为误拒的真零假设数，\(R\) 为全部拒绝数。家族错误率是 \(\mathrm{FWER}=P(V\ge1)\)；假发现率是 \(\mathrm{FDR}=\mathbb E[V/\max(R,1)]\)。前者关心是否出现任何错误，后者关心发现中错误比例的期望。没有拒绝时比例按零计；FDR 控制也不保证每一次实验的实际错误比例都低于阈值。` },
      { id: 'methods', text: String.raw`若任何一次误拒都代价很高，可用 Bonferroni：对 \(m\) 个检验，将各自阈值设为 \(\alpha/m\)。只要各真零假设的 p 值有效，由并集概率上界有 \(P(V\ge1)\le\sum_{i\in H_0}P(p_i\le\alpha/m)\le\alpha\)，不要求检验独立。代价是检验多时阈值很严格。` },
      { id: 'bh', text: String.raw`若目标是筛选发现并控制其中的错误比例，可在独立或满足相应正相关条件时使用 Benjamini–Hochberg（BH）。先将 p 值排序为 \(p_{(1)}\le\cdots\le p_{(m)}\)，找最大的 \(k\) 使 \(p_{(k)}\le kq/m\)，再拒绝排序前 \(k\) 项；没有这样的 \(k\) 就不拒绝任何项。要找最大满足位置，不能遇到第一个不满足就停。一般依赖结构下，不能直接宣称该程序仍保证 FDR 不超过 \(q\)。` },
      { id: 'example', text: String.raw`## 2. 同一组 p 值，怎样得到不同决策

**自编例题。** 四个检验的 p 值为 \(0.008,0.018,0.040,0.200\)，比较 \(\alpha=q=0.05\) 时两种程序的拒绝结果。Bonferroni 的共同阈值为 \(0.05/4=0.0125\)，仅拒绝第一项。BH 的排序阈值依次为 \(0.0125,0.025,0.0375,0.05\)，最大的满足位置是 \(k=2\)，故拒绝前两项。` },
      { id: 'interpret', text: 'BH 在这组数值上给出更多发现，原因是它采用了不同的错误控制目标和阶梯阈值，不代表它在所有任务中更好。报告结果时应写明控制对象、阈值以及所用程序的依赖条件；这里已知的 p 值足够执行算法，却不足以判断具体检验之间是否独立。' },
    ],
    checks: ['两种错误指标分母和期望不混淆', 'Bonferroni 给出并集界与有效 p 值前提', 'BH 使用最大通过位置而非首次失败截断', '算例结果可复算且不臆测依赖关系'],
    avoid: '按 FWER、FDR、Bonferroni 定义、Bonferroni 步骤、BH 定义、BH 步骤、例题拆成七章；泛泛说方法很重要，却不讲控制对象。' },
  { id: 'binary-search', title: '二分查找：用区间不变量避免边界错误', origin: 'project-authored',
    goal: '能手写查找第一个不小于目标的元素，并处理重复值与不存在的情形。',
    paragraphs: [
      { id: 'invariant', text: String.raw`## 1. 区间不变量决定更新方式

在非递减数组中查找第一个不小于目标 \(t\) 的位置，返回值可以等于数组长度 \(n\)，表示所有元素都小于目标。维护半开区间 \([l,r)\)：小于 \(l\) 的位置都已知小于 \(t\)，大于或等于 \(r\) 的有效位置都已知不小于 \(t\)。初始 \(l=0,r=n\)，两侧都为空，不变量成立。` },
      { id: 'update', text: String.raw`当 \(l<r\) 时取 \(m=l+\lfloor(r-l)/2\rfloor\)。若 \(a_m<t\)，排序保证 \(m\) 及其左侧都不是答案，令 \(l=m+1\)；否则答案可能就是 \(m\)，令 \(r=m\)，不能用 \(m-1\) 越过它。两种更新都保持不变量并严格缩短区间。终止时 \(l=r\)，左侧全小于目标，当前位置及右侧全不小于目标，因此返回 \(l\)。` },
      { id: 'example', text: String.raw`**自编例题。** 数组为 \([1,3,3,7]\)，查找第一个不小于 \(3\) 的位置，采用从零开始的下标。区间先为 \([0,4)\)：\(m=2,a_m=3\)，取 \(r=2\)；再有 \(m=1,a_m=3\)，取 \(r=1\)；最后 \(m=0,a_m=1\)，取 \(l=1\)。此时返回 \(1\)，正好是两个重复值中第一个的位置。` },
      { id: 'variant', text: String.raw`若改为查找第一个严格大于 \(t\) 的位置，将左移排除条件改成 \(a_m\le t\)，其他区间约定保持不变；同一数组对目标 3 返回 3。若要查找目标是否存在，则先求第一个不小于目标的位置 \(i\)，再检查 \(i<n\) 且 \(a_i=t\)。先检查边界，才能访问数组；空数组或目标大于所有元素时，算法可返回 \(n\)。` },
    ],
    checks: ['更新由不变量推出而非背诵', '重复值例题展示关键边界', '区分 lower bound、upper bound 与存在性', '空数组与越界检查明确'],
    avoid: '只有伪代码和复杂度术语，没有解释为何 r=m；或花多段比喻“折半查字典”，却省去重复值边界。' },
];

export const lectureRubric = [
  { id: 'structure', question: '章节是否对应完整知识任务，同一方法是否被栏目或文件边界切碎？' },
  { id: 'density', question: '每段是否新增关系、条件或操作信息；删去重复铺垫是否不损失内容？' },
  { id: 'depth', question: '关键推导和方法选择是否有理由，读者是否知道何时不能用？' },
  { id: 'actionability', question: '仅用讲义能否从题干走到答案，关键步骤与条件是否可复现？' },
  { id: 'scope', question: '是否整合重复来源、保留实质差异，且没有发明原题或教学范围？' },
  { id: 'readability', question: '标题、段落和公式是否帮助回查，是否既非碎点也非长墙？' },
];
