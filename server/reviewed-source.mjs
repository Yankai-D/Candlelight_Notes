// A narrowly matched, source-checked editorial case. These observations are
// supplied only for the exact passage; they are not global model instructions.
// Reviewed against Adam section 3, PDF page 3. No learner-dependent wording.
const normalized = value => value.replace(/\s+/g, '').toLowerCase();
export function reviewedSourceContext(document, source) {
  if (!/^Adam:\s*A Method for Stochastic Optimization$/i.test(document.title.trim())) return undefined;
  const page = source.find(value => value.number === 3);
  if (!page) return undefined;
  const quotes = [
    'where ζ = 0 if the true second moment E[g2\ni ] is stationary',
    'many gradients by chosing a small value of β2',
  ];
  if (!quotes.every(quote => normalized(page.text).includes(normalized(quote)))) return undefined;
  return [{ id: 'adam-initialization-bias-v1', sourcePages: [3], sourceQuotes: quotes,
    observations: [
      '二阶原点矩为 E[g_t²]，方差为 E[g_t²]-(E[g_t])²。原文括号里的 uncentered variance 指前者，二者只有在均值为零时才相等。',
      '初始化的零是人为设置的起点，不是已经采集的观测；实际梯度本身仍然可以为零。',
      '由 v_t = (1-β₂) Σ β₂^(t-i) g_i² 可直接核对：β₂ 越接近 1，历史权重衰减越慢。',
      '原文末段两次使用 small β₂，分别关联较长历史平均和初始步长过大；这两处方向都与本节递推式不一致，不只是前半句有问题。',
      '原文余项段使用了 β₁ 记号；本节二阶矩递推的系数实际为 β₂，这是局部记号冲突。',
      '修正后 E[v̂_t] = E[g_t²] + ζ/(1-β₂^t)。对应二阶矩不随时间变化时 ζ=0，本推导给出严格无偏；分布变化时，选择衰减系数本身不保证余项小，除去初始化因子也不消除余项。',
      '第一步某分量的梯度非零且忽略 ε 时，未修正的幅度为 α(1-β₁)/sqrt(1-β₂)，两项都修正后为 α。固定 β₁ 时，β₂ 越小，分母越大，未修正幅度越小；因此原文“小 β₂ 导致过大初始步长”的方向不能由该公式支持。',
    ],
    firstStepCheck: [0.9, 0.999].map(beta2 => ({ beta1: 0.9, beta2, uncorrectedOverCorrected: (1 - 0.9) / Math.sqrt(1 - beta2), conditions: '第一步，该梯度分量非零，忽略 ε，α>0' })),
  }];
}
