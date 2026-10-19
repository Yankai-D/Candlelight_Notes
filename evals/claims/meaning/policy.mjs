import { buildConditionMessages } from '../../../server/condition-review.mjs';

// Experimental single-variable intervention; never imported by production generation.
export const meaningSuffix='\n另外核对解释文字与公式、定义的计算含义是否一致：把文字所说的操作按其顺序和作用对象理解，再与来源比较，不能因为旁边公式正确就默认解释也正确。若不一致，用具体操作差异或满足上下文的简单数值例说明，并定位到解释句；若只是比喻或直觉说明，且没有声称不同的计算规则，不要求它重复公式或补完整证明。沿用原有 JSON 格式，只在发现具体问题时输出依据。';
export function buildMeaningMessages(snapshot) {
  const messages=buildConditionMessages(snapshot);
  messages[0].content+=meaningSuffix;
  return messages;
}
