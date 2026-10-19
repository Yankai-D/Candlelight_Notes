// Authored review baseline, not a model response or an automatic quality score.
// Checked against the supplied Adam PDF, section 3, page 3, including eqs. 1–4;
// the link back to parameter updates uses Algorithm 1 on page 2.
const paragraph = (id, text) => ({ id, type: 'paragraph', text });
const shared = {
  opening: paragraph('opening', 'Adam 用梯度及梯度平方的历史记录调整参数更新，这些记录的数值会影响更新的尺度。但训练刚开始时，还没有过去的梯度可供使用。把初始记录设为零虽然方便，却会把最初几步的估计拉向零。这里需要分清：记录偏小究竟反映了梯度的统计特征，还是来自人为设置的起点。偏差修正处理的是后一部分。'),
  target: paragraph('target', String.raw`先看梯度平方的记录。记第 \(t\) 步的梯度为 \(g_t\)，要估计的量是二阶原点矩 \(\mathbb E[g_t^2]\)。这里的平方按向量的各个分量计算；它没有减去均值，因此不能直接称为方差。Adam 用下面的递推保存这份记录，其中 \(0\leq\beta_2<1\)，初值为 \(v_0=0\)：\[v_t=\beta_2v_{t-1}+(1-\beta_2)g_t^2.\]`),
  unroll: paragraph('unroll', String.raw`要看清初值的影响，可以将递推逐步展开。每往前追溯一步，较早的观测就多乘一次 \(\beta_2\)；初值项由于 \(v_0=0\) 而消失。于是原文公式 (1) 可以写成\[v_t=(1-\beta_2)\sum_{i=1}^{t}\beta_2^{t-i}g_i^2.\]这使每次观测所占的权重显式出现。`),
  weights: paragraph('weights', String.raw`这些观测的权重之和并不是 1。利用有限等比数列求和，有\[(1-\beta_2)\sum_{i=1}^{t}\beta_2^{t-i}=1-\beta_2^t.\]还差的 \(\beta_2^t\) 对应零初值在递推中留下的份额。这次求和把开头的问题变成了可计算的比例：实际观测目前只占 \(1-\beta_2^t\)，其余份额仍留给初始的零。随着步数增加，这个起点的影响才逐渐消退。`),
  expectation: paragraph('expectation', String.raw`知道了这个比例，还需要检验重新归一化能否得到所需的二阶矩。对展开式两端取期望，再把各时刻的二阶矩与当前的二阶矩比较，就得到原文公式 (2)–(4) 的关系：\[\begin{aligned}\mathbb E[v_t]&=(1-\beta_2)\sum_{i=1}^{t}\beta_2^{t-i}\mathbb E[g_i^2]\\&=(1-\beta_2^t)\mathbb E[g_t^2]+\zeta_t.\end{aligned}\]取期望使用线性性质，不要求各次梯度彼此独立。这里将原文的余项 \(\zeta\) 记作 \(\zeta_t\)，它收集过去与当前二阶矩的差异。当这些时刻的二阶矩不变时，\(\zeta_t=0\)。`),
  residual: paragraph('residual', String.raw`初始化的影响已经分离出来，但训练过程中的梯度分布可能仍在变化。要看修正在哪些地方还有限制，需要回到刚才保留的余项。将它展开可得\[\zeta_t=(1-\beta_2)\sum_{i=1}^{t}\beta_2^{t-i}\bigl(\mathbb E[g_i^2]-\mathbb E[g_t^2]\bigr).\]这是对原文余项的显式展开。括号中的差值说明，即使已经重新归一化，过去的观测也未必能代表当前的统计特征。`),
  correction: paragraph('correction', String.raw`在这个条件下，估计与目标之间只差 \(1-\beta_2^t\) 这一因子。因此 Adam 将记录除以它，得到\[\hat v_t=\frac{v_t}{1-\beta_2^t},\qquad \mathbb E[\hat v_t]=\mathbb E[g_t^2].\]这一步也可以理解为把已经出现的观测重新归一化，使它们的权重之和成为 1。它修正的是零初值造成的系统性缩小，并不意味着每一次实现的估计值都会恰好等于真实二阶矩。`),
  firstMoment: paragraph('first-moment', String.raw`一阶矩的处理沿用同样的推理。将梯度平方换成梯度，将 \(\beta_2\) 换成 \(\beta_1\)，就得到\[m_t=\beta_1m_{t-1}+(1-\beta_1)g_t,\qquad \hat m_t=\frac{m_t}{1-\beta_1^t}.\]同样，严格的无偏关系需要相应的一阶矩在所考虑的时刻保持不变。`),
  updateConnection: paragraph('update-connection', String.raw`这两项修正随后回到 Adam 的参数更新。原文算法 1 使用修正后的一阶矩给出更新的分子，用修正后的二阶矩平方根与稳定常数组成分母：\[\theta_t=\theta_{t-1}-\alpha\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}.\]前面的权重计算因此落到了一个具体操作上：在用梯度记录决定更新尺度之前，先去掉零初值引入的比例因子。\(\alpha\) 仍控制整体步长，\(\epsilon\) 则用于数值稳定。`),
  nonstationary: paragraph('nonstationary', String.raw`修正后的期望关系仍带有这一余项：\[\mathbb E[\hat v_t]=\mathbb E[g_t^2]+\frac{\zeta_t}{1-\beta_2^t}.\]减少对久远梯度的权重，可以减轻过去分布的影响，但不能据此保证余项总是很小。是否接近当前二阶矩，还取决于分布变化的速度和权重的选择。因此，初始化修正解决了记录的起点问题，却没有替代记录追踪当前梯度变化的任务。`),
  sparse: paragraph('sparse', String.raw`稀疏梯度进一步说明了这项修正的用途。某个分量如果很少出现非零观测，估计它的二阶矩往往需要保留较长的历史。由权重 \(\beta_2^{t-i}\) 可知，\(\beta_2\) 越接近 1，历史衰减越慢；同时，初期的 \(1-\beta_2^t\) 也越小，零初值造成的缩小就越明显。原文末段把较长历史平均对应的取值写成较小的 \(\beta_2\)，这与本节递推式不一致；这里依据递推式说明两者的关系。`),
  steps: paragraph('steps', String.raw`当被缩小的二阶矩进入更新式的分母时，还会影响初期的步长。作为对这一机制的算例，暂时忽略稳定常数，取训练第一步中一个非零的梯度分量：未经修正时，更新幅度为 \(\alpha(1-\beta_1)/\sqrt{1-\beta_2}\)；两项都修正后，第一步的幅度为 \(\alpha\)。所以未经修正是否放大步长，要结合两个衰减系数判断。偏差修正的作用，是去掉零初始化引入的这组比例因子；它本身不构成训练收敛或效果改善的普遍保证。`),
};

const expanded = [
  shared.opening,
  shared.target,
  paragraph('average-bridge', String.raw`这条递推先保留旧记录的 \(\beta_2\) 部分，再加入当前梯度平方的 \(1-\beta_2\) 部分。举一个只用于理解初始化的算例：如果某个分量每次的梯度平方都是 4，并取 \(\beta_2=0.9\)，那么 \(v_1=0.4\)，\(v_2=0.76\)。观测并没有变小，记录却远小于 4，因为它仍然混合着从零开始的影响。`),
  shared.unroll, shared.weights, shared.expectation, shared.correction,
  paragraph('numeric-check', String.raw`前面的算例可以直接核对这个修正。第一步除以 \(1-0.9=0.1\)，得到 \(0.4/0.1=4\)；第二步除以 \(1-0.9^2=0.19\)，得到 \(0.76/0.19=4\)。这里每次输入都相同，所以可以逐步恢复到 4；随机梯度的无偏关系则是对期望而言。`),
  shared.firstMoment, shared.updateConnection, shared.residual, shared.nonstationary, shared.sparse, shared.steps,
];
const compact = [shared.opening, shared.target, shared.unroll, shared.weights, shared.expectation, shared.correction, shared.firstMoment, shared.updateConnection, shared.residual, shared.nonstationary, shared.sparse, shared.steps];

export const adamBiasCorrection = {
  id: 'adam-initialization-bias',
  title: 'Adam 的初始化偏差修正',
  status: '人工编写的章节范文，供文风审阅；不是模型质量评测结果',
  source: { title: 'Adam: A Method for Stochastic Optimization', url: 'https://arxiv.org/abs/1412.6980', section: '3 Initialization Bias Correction', pages: [2, 3] },
  sourceNote: '正文以第 3 节的初始化偏差修正为主，参数更新式来自第 2 页算法 1；已对照用户提供的 PDF 核对。第 3 页余项段使用了 β₁ 记号，末段使用了 “small β₂” 的文字；本范文按明确的二阶矩递推式说明权重关系，并在正文指出末段的不一致。算例、余项的显式展开和第一步幅度的演算属于笔记补充。',
  variants: [
    { id: 'expanded', label: '展开必要铺垫', background: '已学概率论，尚不熟悉指数移动平均。', paragraphs: expanded },
    { id: 'compact', label: '缩短已知铺垫', background: '已学概率论，熟悉指数移动平均。', paragraphs: compact },
  ],
  reviewCriteria: [
    '两种知识背景下，叙述视角、术语、语言和逻辑衔接保持一致；变化集中在必要铺垫。',
    '正文独立解释概念与推理，避免逐句翻译后另加评论，也没有背景、直觉、原理的栏目拼接。',
    '保留原文核心递推、展开、期望关系及条件；补充推导能回到当前论证，实验或收敛结论不凭空扩张。',
    '关键推导之前交代计算目的，之后说明结果如何回到方法；在转折处展开，在已知步骤处收束，保持连贯正文。',
    '区分零初始化偏差和分布变化余项；区分二阶原点矩和方差；无偏只在对应矩稳定的条件下陈述。',
    '局部补充能融入前后正文；各章节仍可追溯其来源，不能通过删掉难点换取流畅。',
  ],
};
