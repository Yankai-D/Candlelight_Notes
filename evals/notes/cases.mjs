import { readFileSync } from 'node:fs';
import { defaultSettings } from '../../shared/learning.mjs';
import { freshTemplateLibrary, templateSnapshot } from '../../shared/writing-templates.mjs';

// Evaluation criteria are deliberately separate from the generation request.
// These public probes have now informed calibration development, not an unseen test set.
const profiles = {
  foundation: { background: '本科理科学生，学过高等数学、概率论和基础统计学。', foundations: ['微积分', '矩阵乘法', '期望与方差'] },
  fluent: { background: '本科理科学生，熟悉以下基础，仍需要看懂当前资料的推理与适用条件。', foundations: ['微积分', '矩阵乘法', '期望与方差', '梯度下降与对角预条件', '样本均值、样本方差与标准误'] },
};
export const profileIds = Object.keys(profiles);
const publicCourse = JSON.parse(readFileSync(new URL('../../examples/course/descriptive-statistics/sources.json', import.meta.url), 'utf8'));
const textbook = publicCourse.sources.find(source => source.id === 'textbook');

export const materials = [
  {
    id: 'diagonal-penalty', title: 'Diagonal scaling and quadratic penalties', templateId: 'narrative', split: 'development',
    provenance: { kind: 'authored-research-style', attribution: '旁烛笔记原创测试材料；不是已发表论文', license: 'Project-authored fixture', priorUse: '未用于生产模板样稿；相关主题、公式与条件已参与离线校准材料开发。仅作开发诊断，不声称未见材料泛化。' },
    goal: '理解二次惩罚和独立权重衰减在对角缩放下为何不同，把公式差异联系到参数更新。',
    pages: [{ number: 1, text: String.raw`Diagonal scaling and quadratic penalties
Consider a parameter vector w and the gradient g of a differentiable data loss. For this one-step comparison, hold a positive diagonal matrix D fixed; do not recompute it from a penalized gradient. Let alpha > 0 and lambda >= 0. The gradient of (lambda/2)||w||_2^2 is lambda w.
Adding the penalty gradient before scaling gives w_next = w - alpha D(g + lambda w). Applying shrinkage separately gives w_next = (1 - alpha lambda)w - alpha Dg. Their difference, coupled minus separate, is -alpha lambda (D - I)w. With D = I the two updates agree. When D differs from I, they can still agree on particular coordinates, for example when the corresponding parameter is zero.
The coupled update shrinks coordinate i by alpha lambda D_ii; separate shrinkage uses alpha lambda on every coordinate. Thus a direction-dependent gradient scale also changes the effective penalty in the first update. This is an algebraic comparison of the two stated updates, not a claim that every adaptive optimizer uses a fixed D.
For w=(2,4), g=(1,1), D=diag(1,1/4), alpha=0.1 and lambda=0.2, the coupled update is (1.86,3.955), whereas separate shrinkage gives (1.86,3.895). The second coordinate makes the difference visible.
These equations alone establish neither a convergence theorem nor better prediction accuracy. Choosing a shrinkage rule still requires specifying the objective and evaluating the resulting method.` }],
    criteria: [
      '保留固定 D 的单步比较条件、两条更新式及差值，不把 D 当作所有优化器的完整机制。',
      '说明缩放为何同时影响惩罚，以及数学差异如何回到参数更新；不能只罗列公式。',
      '核对算例 (1.86,3.955) 与 (1.86,3.895)；不能宣称 D≠I 时任何参数下必不相等。',
      '保留没有收敛或泛化优势保证的边界，不移植样稿的均值、等待时间或 Adam 无偏结论。',
    ],
  },
  {
    id: 'standard-error', title: 'Sampling variability: spread and precision', templateId: 'lecture', split: 'development',
    provenance: { kind: 'authored-lecture', attribution: '旁烛笔记原创课件文字；不是学校试题', license: 'Project-authored fixture', priorUse: '未用于生产模板样稿；相关概念、算例与边界已参与离线校准材料开发。仅作开发诊断，不声称未见材料泛化。' },
    goal: '区分观测离散程度和均值估计精度，能完成一次标准误计算，并说明条件。',
    pages: [{ number: 1, text: String.raw`Sampling variability: spread and precision
1. Target. Independent observations X_1,...,X_n have a common mean mu and finite variance sigma^2. The sample mean estimates mu. Standard deviation describes the spread of individual observations; the standard error of the mean describes the spread of sample means under repeated sampling.
2. Calculation. Var(X_bar) = (1/n^2) sum_i Var(X_i) = sigma^2/n under these assumptions. Hence SE(X_bar) = sigma/sqrt(n). In practice sigma is usually unknown and is estimated by s, with s^2 = sum_i (x_i-x_bar)^2/(n-1) for n>1. Then the estimated standard error is s/sqrt(n).
3. Worked data. For observations 1,3,5,7, n=4, x_bar=4 and the sum of squared deviations is 20. Thus s^2=20/3, s is about 2.582, and the estimated standard error is about 1.291. The estimated standard error is not 20/3 or s/4. Standard deviation and standard error have the same units as the data; variance has squared units.
4. Limits. With the same population variance and independent sampling, quadrupling n halves the theoretical standard error; it does not promise a smaller realized estimation error in every sample. With correlated observations, Var(X_bar) also includes (2/n^2) sum_{i<j} Cov(X_i,X_j); the independent-observation formula need not apply. A small standard error does not repair selection bias. These notes do not introduce a confidence interval or assume normality merely to derive the variance identity.` }],
    criteria: [
      '区分标准差与标准误，说明重复抽样对象；方差恒等式不需要擅加正态性。',
      '保留独立、共同方差、有限方差条件和协方差项；小标准误不消除选择偏差。',
      '核对均值 4、平方和 20、s²=20/3、s≈2.582、SE≈1.291 及量纲。',
      '按知识依赖组织可独立回查的知识单元，有解释而非只列提纲；不扩展置信区间课程。',
    ],
  },
  {
    id: 'openintro-mean', title: 'OpenIntro · Dot plots and the mean（选段）', templateId: 'lecture', split: 'development',
    provenance: { kind: 'licensed-textbook-extract', attribution: `${textbook.title}; ${textbook.authors.join(', ')}`, url: textbook.url, license: textbook.license, licenseUrl: textbook.licenseUrl, sourceSha256: textbook.sha256, priorUse: '均值主题及来源已用于课程样稿，只作开发回归，不用于证明泛化。', adaptation: '选编第 4、5 页原样抽取文字，对应原书第 47、48 页；不含原图。模型生成的改编稿沿用来源署名与许可。' },
    goal: '看懂这篇文章',
    pages: textbook.pages.filter(page => [4, 5].includes(page.number)).map(({number, text}) => ({number, text})),
    criteria: [
      '解释均值的定义、符号和中心含义，保留 50 笔贷款、11.57% 的示例事实。',
      '区分样本均值与总体均值，不把当前样本统计量直接当作已知总体值。',
      '抽取文本缺少图像，不能臆造散点图细节或将图形字母噪声当成观测数值。',
      '默认目标只要求看懂，不扩张成实验作业、学习计划或一整门统计课程。',
    ],
  },
];

export function evaluationCase(materialId, profileId) {
  const material = materials.find(value => value.id === materialId);
  return caseFromMaterial(material,profileId);
}

export function caseFromMaterial(material, profileId) {
  if (!material || !profiles[profileId]) throw new Error('Unknown evaluation material/profile');
  const writingTemplate = templateSnapshot(freshTemplateLibrary(), material.templateId, '评测固定模板；模板路由另行评测');
  const request = {
    action: 'generate', scope: 'chapter', instruction: '按阅读方式整理当前章节，保留实质内容并落实学习目标。', revision: 0, chapterId: 'section',
    learning: { ...defaultSettings, mode: 'adaptive', writingTemplate }, knowledge: structuredClone(profiles[profileId]),
    document: { title: material.title, intent: material.goal, chapters: [{ id: 'section', title: material.title, sourcePages: material.pages.map(page => page.number), content: { type: 'doc', content: [] } }], pages: structuredClone(material.pages) },
  };
  return { id: `${material.id}/${profileId}`, materialId:material.id, profileId, material: structuredClone(material), request };
}

// Mechanical smoke outputs deliberately identical between arms. Not references,
// not model quality results, and not candidates for semantic scoring.
export function smokeOutput(request) {
  const page = request.document.pages[0];
  if (request.action === 'explain') return {title:'模拟小纸条',paragraphs:[String.raw`这是离线模拟小纸条，检查局部追问、上下文和公式 \(a^2+b^2=c^2\) 的审阅显示，不能比较模型效果。`],sourcePages:[page.number],summary:'仅用于离线工具验收'};
  return { blocks: [
    ...(request.learning.writingTemplate.layout === 'structured' ? [{type:'heading', text:'模拟知识单元', sourcePages:[page.number], sourceQuote:''}] : []),
    {type:'paragraph', text:'这是离线模拟正文，用来检查评测文件、统一渲染和审阅流程。它没有实际讲解当前材料，不能用来比较模型效果。', sourcePages:[page.number], sourceQuote:page.text.slice(0,40)},
    {type:'paragraph', text:String.raw`公式渲染探针：\(a^2+b^2=c^2\)。这不是当前来源的知识结论。`, sourcePages:[], sourceQuote:''},
  ], summary:'仅用于离线工具验收'};
}
