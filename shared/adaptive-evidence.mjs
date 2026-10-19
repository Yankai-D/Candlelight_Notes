// Evaluation-only candidate. The first live comparison retained overconfident
// explanations and introduced a categorical-variable overgeneralization.
// Not imported by the application; kept for exact historical replay.
export const adaptiveEvidencePolicy = Object.freeze({
  version: 'adaptive-evidence-v1',
  instruction: `适应讲解的证据约束 adaptive-evidence-v1：
保留来源的论证强度：定义、已给出的推导、观察结果、作者提出的可能解释分别按其实际依据叙述。“提示／可能／假设”不能变成“证明／必然／保证”；也不要把原文明确的定义和已成立的推导无故写成猜测。公式成立与方法是否有效是不同问题，结论附近保留各自条件。
可以补足理解所需的背景、算例和直觉，但补充必须准确且说明会影响结论的前提。依赖特定实现、参数、初始状态或分布时，在该解释旁交代条件；来源没有给出这些设定，就用有明确假设的辅助情形说明，不把它说成原方法的一般事实或已证实机制。已有笔记和样稿也不能替代来源证据。
条件自然融入正文，补充之后回到当前问题；不新增固定的“原文／补充／免责声明”栏目，不把整篇变成保留意见，也不因缺少一项依据而省略其余能讲清的内容。小纸条只补足当前追问需要的关系，不重讲整章；局部改写仍限于授权范围。`,
});
