import { readFileSync } from 'node:fs';

// Authored reference, not a provider response. Public source text and page
// mapping are deliberately separate from the example's own synthetic data.
export const sources = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url), 'utf8')).sources;
const ref = (sourceId, page) => ({ sourceId, page });
const evidence = (sourceId, page, quote) => ({ sourceId, page, quote });
const topic = (id, label, dependsOn, sourceRefs, checks) => ({ id, label, dependsOn, sourceRefs, checks });

export const requirements = [
  topic('distribution', '变量类型、直方图与分布形状', [], [ref('textbook', 7), ref('textbook', 8), ref('categorical', 5)],
    ['解释数值变量与分类变量；直方图按数值区间分组，条形图按类别分组。', '交代组距、峰和长尾；不能通过交换柱子改变直方图顺序。']),
  topic('center', '均值与中位数', ['distribution'], [ref('textbook', 4), ref('numerical', 17)],
    ['定义样本均值及符号；说明样本与总体的区别。', '中位数先排序；偶数个观测取中间两项的均值；有重复值时不要声称严格一半小于中位数。']),
  topic('spread', '方差与标准差', ['center'], [ref('textbook', 11), ref('numerical', 15)],
    ['相同均值不能确定离散程度；解释偏差、平方及平方根。', '样本方差用 n−1，完整总体的方差用 N；注明单位和适用条件。', '标准差不等于平均绝对偏差；不能对任意分布声称 68%/95% 定律。']),
  topic('quartiles', '四分位数、IQR与箱线图', ['center', 'spread'], [ref('textbook', 14), ref('textbook', 15), ref('numerical', 18)],
    ['IQR=Q3−Q1；小样本算例明确四分位数算法。', '1.5 IQR 是识别可疑点的规则，须落在界内最远的实际观测上，不能直接画到界限。', '可疑值不等于错误值，不能自动删除。']),
  topic('choice', '稳健性与统计量选择', ['quartiles'], [ref('textbook', 16), ref('textbook', 17), ref('numerical', 23)],
    ['解释移动极端值为何影响均值和标准差。', '典型个体与累计总量是不同问题；偏态不能成为一律放弃均值的理由。', '不将偏态下均值与中位数的经验关系写成无条件定理。']),
  topic('frequencies', '频数、比例与条形图', ['distribution'], [ref('textbook', 18), ref('categorical', 4)],
    ['频数与比例的分母和单位明确；说明类别及总数。']),
  topic('denominators', '列联表与条件比例', ['frequencies'], [ref('textbook', 19), ref('categorical', 6)],
    ['同一个单元格除以行总数、列总数或总人数会回答不同问题。', '比较不同规模的组时保留分母，不用人数直接代替比例。']),
  topic('comparison', '图形选择与分组比较', ['denominators', 'choice'], [ref('textbook', 23), ref('textbook', 25), ref('textbook', 26), ref('categorical', 7)],
    ['区分堆叠、并排与标准化堆叠图，说明标准化后的组规模信息损失。', '跨组数值比较使用共同尺度，并观察中心、离散和形状；描述性差异不能推出因果或显著性。']),
];

export const courseGoal = '根据教材与两份课件，编写一份连贯的中文描述性统计复习讲义。围绕如何看懂和概括一组数据展开，覆盖约定的数值与分类数据主题，解释统计量解决什么问题、如何计算、何时适用及常见误区；合并重复内容，保留来源。只生成这一份讲义。';
export const learner = { background: '本科学生，已学基础代数，尚未系统学习描述性统计。', foundations: ['基础代数'] };
export const courseRequestFixture = { learningIntent: courseGoal, learner, sources, requirements };
const section = (id, title, purpose, topics) => ({ id, title, purpose, topics,
  sourceRefs: [...new Map(requirements.filter(r => topics.includes(r.id)).flatMap(r => r.sourceRefs).map(r => [`${r.sourceId}:${r.page}`, r])).values()] });
export const fullPlan = {
  title: '如何看懂和概括一组数据',
  sections: [
    section('shape', '先看数据描述的是什么', '建立变量与图形之间的关系，为概括中心和离散程度提供上下文。', ['distribution']),
    section('summary', '从平均值到有意义的数据概括', '用中心、离散、极端值的关系解释统计量为何需要结合问题选择。', ['center', 'spread', 'quartiles', 'choice']),
    section('proportions', '比例的意义取决于分母', '将概括数值的思路转向类别与条件比例，防止不同组规模造成误判。', ['frequencies', 'denominators']),
    section('groups', '把差异放回可比较的尺度', '根据问题选择图形，在共同尺度上比较组，同时保留证据边界。', ['comparison']),
  ],
};

export const referenceRequest = { ...courseRequestFixture,
  learningIntent: '用一段连贯的复习讲义讲清均值、离散程度、异常值与统计量选择的关系。计算服务于判断，不逐页翻译，不扩展到统计推断。',
  requirements: requirements.filter(r => fullPlan.sections[1].topics.includes(r.id)).map(r => ({ ...r, dependsOn: r.dependsOn.filter(id => id !== 'distribution') })),
};
export const referencePlan = { title: fullPlan.title, sections: [fullPlan.sections[1]] };
const block = (id, text, topicIds, sourceRefs = [], origin = 'source') => ({ id, text, topicIds, sourceRefs, origin });
const supplementary = (id, text, topicIds) => block(id, text, topicIds, [], 'supplement');
const paragraphs = [
  block('question', '用一个数概括一组数据，会同时带来便利和损失。均值把所有观测合成一个中心，却没有保留每个观测离中心有多远。两组数据可以有相同的均值，却对应很不一样的日常体验。要判断这个中心是否有代表性，还需要把离散程度和极端值放回同一幅图景。', ['center', 'spread'], [
    evidence('textbook', 4, 'The mean, often called the average'),
    evidence('textbook', 11, 'variability in the data is also important'),
  ]),
  block('mean', String.raw`把观测值记为 \(x_1,\ldots,x_n\)，其中 \(n\) 是观测个数，样本均值为\[\bar x=\frac{1}{n}\sum_{i=1}^{n}x_i.\]它保留了总量与个数之间的关系：\(n\bar x\) 就是这组观测的总和。若这些观测只是更大总体中的一部分，\(\bar x\) 描述的是当前样本；总体均值通常记为 \(\mu\)。二者可以采用相同的计算方式，却对应不同的资料范围，不能因为算出了样本均值，就把它当成已知的总体均值。`, ['center'], [
    evidence('textbook', 4, 'The sample mean can be computed as the sum of the observed values'),
  ]),
  supplementary('same-center', String.raw`用两组以分钟为单位的合成等待时间看这个区别。第一组为 \(8,9,10,11,12\)，第二组为 \(2,6,10,14,18\)。两组总和都是 50，均值都是 10 分钟；但第二组既有很短的等待，也有明显更长的等待。“平均等十分钟”无法区分它们，而这个区别恰好影响等待是否稳定。`, ['center', 'spread']),
  block('deviation', String.raw`要把这种不稳定程度写成一个量，可以观察每个值相对均值的偏差 \(x_i-\bar x\)。方向相反的偏差会抵消，直接求和不能留下分散的信息。平方使正负偏差都贡献非负数，也让较大的偏离得到更大的权重。这个选择既使离散程度可以计算，也预示了一个代价：极端值会对结果产生较强影响。`, ['spread'], [
    evidence('textbook', 11, 'We call the distance of an observation from its mean its deviation'),
    evidence('numerical', 15, 'To weigh larger deviations more heavily'),
  ]),
  supplementary('cancellation', String.raw`第一组相对 10 分钟的偏差是 \(-2,-1,0,1,2\)，相加恰好为零。一般地，\(\sum_i(x_i-\bar x)=\sum_i x_i-n\bar x=0\)。因此，偏差相加为零来自均值的定义，并不意味着每次等待都一样。平方之后，第一组偏差的总和变成 \(4+1+0+1+4=10\)，分散的信息才保留下来。`, ['spread']),
  block('variance', String.raw`对 \(n>1\) 个观测，通常使用下面的样本方差与样本标准差：\[s^2=\frac{1}{n-1}\sum_{i=1}^{n}(x_i-\bar x)^2,\qquad s=\sqrt{s^2}.\]样本方差的分母是 \(n-1\)，不是 \(n\)。方差以原单位的平方计量；取平方根后，标准差回到原单位，因而更便于与等待时间直接比较。它反映相对均值的离散尺度，不是把绝对偏差直接取平均。`, ['spread'], [
    evidence('textbook', 11, 'We divide by n'),
    evidence('numerical', 15, 'To get rid of negatives'),
  ]),
  supplementary('denominator', String.raw`这里需要补充区分两个计算任务。若列出的是整个有限总体的 \(N\) 个值，总体方差按 \(\sigma^2=\frac{1}{N}\sum_{i=1}^{N}(x_i-\mu)^2\) 定义；若从总体抽样并用样本均值估计中心，则常用上面的 \(n-1\) 口径。在独立同分布、总体方差有限的条件下，后一统计量是总体方差的无偏估计。当前需要记住的是计算对象和口径，暂不展开这一估计性质的证明；不能仅凭“方差是平均偏差平方”就把两个分母混用。`, ['spread']),
  supplementary('spread-calculation', String.raw`按样本口径，第一组有 \(s^2=10/4=2.5\)，\(s\approx1.58\) 分钟。第二组的偏差平方和为 \(64+16+0+16+64=160\)，所以 \(s^2=40\)，\(s\approx6.32\) 分钟。均值相同的两组数据现在被区分开了：第二组偏离十分钟的尺度更大。这个结果描述离散程度，并不说明每个值都恰好离均值一个标准差，也不能保证任意分布都有固定比例的值落在某个标准差范围内。`, ['spread']),
  supplementary('extreme', String.raw`再把第一组中的 12 分钟换成 42 分钟，其余四个值不动。新的均值变为 \(80/5=16\) 分钟，样本标准差约为 \(14.58\) 分钟。一次很长的等待使两个量都明显增大，但其余四次仍在 8 到 11 分钟之间。这并不使均值算错；它说明均值回答的是把全部等待时间平均分配后的结果，少数很长的等待也必须计入其中。`, ['center', 'spread']),
  block('median', String.raw`如果关心的是排在中间的一次等待，可以改看中位数：先按大小排序，奇数个观测取中间一个，偶数个观测取中间两个的均值。刚才的五个值中，中位数始终是 10 分钟，因为改动最大的那个值没有改变中间位置。它因此提供了与均值不同的中心描述。存在重复值时，中位数两侧严格小于或大于它的观测不一定各占一半，排序位置仍然是这里的依据。`, ['center'], [
    evidence('numerical', 17, 'If there are an even number of observations'),
  ]),
  block('iqr', String.raw`用排序位置描述中心，也可以沿着同一思路描述离散程度。第一四分位数 \(Q_1\) 与第三四分位数 \(Q_3\) 分别对应 25% 和 75% 的位置，它们之间的跨度\[\mathrm{IQR}=Q_3-Q_1\]概括数据中间一半的分散程度。箱线图把这一段画成箱体，再在箱内标出中位数。四分位数在有限样本中的具体算法有不同约定，尤其对小样本应交代采用哪一种，不能把软件间的小差异直接当成错误。`, ['quartiles'], [
    evidence('textbook', 14, 'The total length of the box'),
    evidence('numerical', 18, 'The 25th percentile is also called the first quartile'),
  ]),
  block('whiskers', String.raw`箱线图还用两个界限提示可能异常的观测：\[Q_1-1.5\,\mathrm{IQR},\qquad Q_3+1.5\,\mathrm{IQR}.\]须线伸到界限以内最远的实际观测，不是直接画到这两个界限；界限以外的观测单独标出。这样的标记是在提醒进一步检查：它可能来自录入错误，也可能反映真实而少见的情况。仅凭超过界限，不能决定删除数据。`, ['quartiles'], [
    evidence('textbook', 15, 'it extends only to the last point below this limit'),
  ]),
  supplementary('box-example', String.raw`另取一组合成数据 \(8,9,9,10,10,11,11,42\) 分钟，明确采用“排序后将数据平分，再分别取两半中位数”的四分位数算法。于是 \(Q_1=9\)、\(Q_3=11\)，\(\mathrm{IQR}=2\)，两个界限是 6 和 14。实际的须线终点为 8 和 11，42 被单独标记。这一区分把计算落回了图形：14 是判断界限，不是这组数据里发生过的等待时间。`, ['quartiles']),
  block('robust', String.raw`均值和标准差会受到极端值的较强影响，中位数和 IQR 通常更稳健，因为后两者主要依赖相应排序位置附近的值。在偏态明显或存在极端值时，中位数与 IQR 往往更适合概括典型位置和中间部分的离散程度。稳健也不是完全不受数据变化影响；若排序位置附近的值发生改变，它们同样会变。`, ['choice'], [
    evidence('textbook', 16, 'The median and IQR are called robust statistics'),
    evidence('numerical', 23, 'Median and IQR are more robust to skewness and outliers'),
  ]),
  block('decision', String.raw`统计量的选择最终仍要回到最初的问题。若关心典型个体，中位数可能比被少数大值牵动的均值更贴近问题；若关心累计总量，均值与总和之间的关系就不可替代。偏态本身不能替我们作出选择。先看分布形状与异常观测，再说明要概括的是中心、离散还是总量，才知道应该保留哪些数字。数学细节在这里的作用，是让概括方式与问题相符。`, ['choice'], [
    evidence('textbook', 17, 'the median is probably more useful'),
  ]),
];

export const reference = { sectionId: 'summary', blocks: paragraphs };
export const compactReference = { ...reference, blocks: paragraphs.filter(p => p.id !== 'cancellation').map(p => p.id === 'spread-calculation' ? { ...p,
  text: String.raw`按样本口径，两组方差分别为 \(2.5\) 和 \(40\)，标准差约为 \(1.58\) 与 \(6.32\) 分钟。均值相同的两组数据因此被区分开了：第二组偏离十分钟的尺度更大。这仍是对离散程度的概括，不能保证任意分布都有固定比例的值落在某个标准差范围内。`,
} : p) };

export const numericCases = [
  { id: 'same-center-a', blockIds: ['same-center', 'cancellation', 'spread-calculation'], data: [8, 9, 10, 11, 12], mean: 10, median: 10, squaredDeviations: 10, sampleVariance: 2.5, sampleSDRounded: 1.58 },
  { id: 'same-center-b', blockIds: ['same-center', 'spread-calculation'], data: [2, 6, 10, 14, 18], mean: 10, median: 10, squaredDeviations: 160, sampleVariance: 40, sampleSDRounded: 6.32 },
  { id: 'extreme', blockIds: ['extreme'], data: [8, 9, 10, 11, 42], mean: 16, median: 10, squaredDeviations: 850, sampleVariance: 212.5, sampleSDRounded: 14.58 },
  { id: 'box', blockIds: ['box-example'], data: [8, 9, 9, 10, 10, 11, 11, 42], quartileMethod: 'median-of-halves', q1: 9, q3: 11, iqr: 2, fences: [6, 14], whiskers: [8, 11], outliers: [42] },
];

export const sourceNotes = [
  '这是全讲义四个小节中的第二节人工基准样稿；其他小节目前只有覆盖规划。样稿没有冒充完整课程或真实模型结果。',
  '数值课件第 4、14、16 页的核心公式是图像，抽取文本不完整；本样稿从教材第 4、11 页取得均值、方差与标准差的依据，未把课件残片当成完整公式。',
  '样本与总体口径的补充、合成等待时间、平方和演算及四分位数算法约定由本笔记添加。源文中的总体经验比例没有扩写成普遍定律。',
  '正文经中文改编、重组、合并及补充。教材：David Diez、Mine Çetinkaya-Rundel、Christopher D Barr，OpenIntro Statistics 第四版，CC BY-SA 3.0；课件：Mine Çetinkaya-Rundel，Curry Hilton 转制，CC BY-SA 3.0 US。不是 OpenIntro 官方讲义或背书。此改编样稿按 CC BY-SA 3.0 发布；源材料各自许可不变。',
];
