// Observed during local DeepSeek guided-v3 review. These are editorial
// judgments on specific examples, not universal regex-based grading rules.
export const reviewCases = [
  {
    id: 'chapter-reporting-voice', category: 'voice',
    observed: '第 2 节已经说明这一修正的存在，第 3 节则给出它的来历。下面以二阶矩估计为例推导修正项。',
    issue: '段首介绍论文章节如何安排，尚未让读者进入知识本身。',
    revision: 'Adam 用过去的梯度估计当前更新需要的统计量，但训练刚开始时，还没有过去的梯度可供使用。把初始记录设为零虽然方便，却使最初几步的估计偏向零。',
    principle: '从要理解的问题及其原因展开；定位原文由来源锚点承担，必要归属与疑点说明仍可提及原文。',
  },
  {
    id: 'known-prerequisite-expanded', category: 'adaptation',
    observed: '读者已明确熟悉等比数列求和，正文仍额外展开换元和逐步约分，熟悉背景版反而比不熟悉背景版更长。',
    issue: '背景被当成扩展数学细节的暗示，而没有用于减少不必要的铺垫。长度差本身不是错误证据，已知内容的重复展开才是此例的审阅依据。',
    revision: '保留权重求和的结果及其对初始化偏差的意义，省略不在原文核心论证中的换元教学。',
    principle: '相同文风、相同实质内容，仅调整继续理解所需的解释。',
  },
  {
    id: 'decay-direction', category: 'source-fidelity',
    observed: 'β₂ 可以选得足够大，使得过于久远的梯度只获得很小的权重。',
    issue: '与权重 β₂^(t-i) 的变化方向相反；也不能从衰减系数单独保证非平稳余项足够小。',
    revision: 'β₂ 越接近 1，历史权重衰减越慢。减少对久远梯度的权重可以减轻过去分布的影响，余项大小仍取决于分布变化与权重选择。',
    principle: '顺畅行文不能覆盖公式矛盾，来源冲突须在相关位置明确处理。',
  },
  {
    id: 'weight-sum-direction', category: 'source-fidelity',
    observed: 'β₂ 越接近 1，单项衰减越慢，历史保留得越久，权重和也越接近 1。',
    issue: '在有限的固定 t 下，观测权重和为 1-β₂^t，β₂ 趋近 1 时它趋近 0。模型把“步数增长”的结论移到了“β₂ 增长”上。',
    revision: '固定 β₂<1 时，随着步数 t 增加，观测权重和趋近 1；固定有限步数 t 时，β₂ 越接近 1，观测权重和越小，零初值的影响越大。',
    principle: '审阅变化方向时明确固定哪个量、改变哪个量；流畅度和格式通过不能替代公式含义核对。',
  },
];
