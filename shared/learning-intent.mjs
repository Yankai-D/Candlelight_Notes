export const defaultLearningIntent = '看懂这篇文章';

// Exact historical prefills only. Never infer a new goal from the paper title
// or ask a model to generate one, and never replace a user's saved custom goal.
const oldDefaults = new Set([
  '理解核心概念、关键推导与结论。遇到抽象的地方，用通俗例子帮助我建立直觉。',
  '我了解基本的线性代数，希望从直觉出发理解 Attention，能读懂公式，并解释 Q、K、V 各自的作用。',
  '理解 AlexNet 的网络结构、训练方式与实验，能解释各设计选择解决的问题。',
  '理解残差学习的动机、残差块与实验结果，区分退化问题和过拟合。',
  '理解 CBOW、Skip-gram 的目标与计算方式，读懂词向量评估和实验。',
  '理解编码器—解码器、LSTM 序列建模和论文的训练与解码流程。',
  '理解软对齐与注意力的动机、公式和实验，追踪每一步如何得到上下文向量。',
  '从原文理解 Transformer，读懂注意力公式、张量形状、模型结构、训练设置与实验。',
  '理解 Dropout 的训练和测试行为、正则化解释与实验依据。',
  '理解批归一化的前向计算、训练和推理的差异，并区分论文解释与实验观察。',
  '逐步读懂 Adam 的一阶矩、二阶矩估计和偏差修正，理解超参数与实验。',
  '理解权重衰减与 L2 正则化在自适应优化器中的差异，读懂解耦更新与实验。',
  '理解参数量、数据量和计算量的经验缩放规律，区分拟合范围、实验条件与结论。',
]);

export function normalizeLearningIntent(document) {
  if (document.intentSource === 'user') return document;
  const intent = document.intent?.trim() || '';
  if (!intent || intent === defaultLearningIntent || oldDefaults.has(intent)) {
    return document.intent === defaultLearningIntent && document.intentSource === 'default'
      ? document : { ...document, intent: defaultLearningIntent, intentSource: 'default' };
  }
  return { ...document, intentSource: 'user' };
}
