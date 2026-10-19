import { readFileSync } from 'node:fs';
import { caseFromMaterial } from './cases.mjs';

const paper = JSON.parse(readFileSync(new URL('./sources/resnet-section.json', import.meta.url), 'utf8'));
const course = JSON.parse(readFileSync(new URL('../../examples/course/descriptive-statistics/sources.json', import.meta.url), 'utf8'));
const slides = course.sources.find(source => source.id === 'categorical');
const paperProvenance = {
  kind: 'published-paper-extract', attribution: `${paper.title}; ${paper.authors.join(', ')} (2015)`,
  url: 'https://arxiv.org/abs/1512.03385', sourceSha256: paper.sourceSha256,
  license: '版权归原作者；使用用户已导入的 PDF 选段，未声明开放再许可。',
  priorUse: '论文已在本地资料库；本选段首次加入笔记对照。公开开发材料，不是保密留出集。',
  adaptation: 'PDF 第 3 页 §3.1 及脚注 2；按页面核对，合并行末断词和重复空格，保留原词句与公式字符。不提供相邻章节或图像。',
};

export const productMaterials = [
  {
    id: 'resnet-residual', title: 'ResNet · 3.1 Residual Learning', templateId: 'narrative', split: 'development',
    scenario: '论文长文', goal: '理解为什么将目标映射改写为残差有助于学习，并区分表示能力与优化难度。',
    provenance: paperProvenance, pages: paper.pages,
    criteria: [
      '围绕退化问题自然展开，解释 H(x)、F(x)=H(x)−x 与恒等映射，局部公式始终服务于研究动机。',
      '保留输入输出同维条件；逼近能力是本段假设，脚注明确其仍是开放问题，不能改写为已证明定理。',
      '区分存在不劣的恒等扩展解与优化器能否找到它，不保证更深模型一定训练成功或泛化更好。',
      '保留实际最优映射未必恒等、以恒等为参照寻找扰动的解释；Fig.7 仅可转述本段的小响应描述，不杜撰图中数值。',
      '观察讲解是否张弛有度：必要的数学解释接回问题，避免翻译、背景、原理栏目相互割裂。',
    ],
  },
  {
    id: 'openintro-categorical', title: 'OpenIntro · 分类数据与比例', templateId: 'lecture', split: 'development',
    scenario: '课件整理', goal: '复习分类数据的可视化，理解比较群体时为什么要选对比例的分母。',
    provenance: {
      kind: 'licensed-lecture-extract', attribution: `${slides.title}; ${slides.authors.join(', ')}; ${slides.contributors.join(', ')}`,
      url: slides.url, license: slides.license, licenseUrl: slides.licenseUrl, sourceSha256: slides.sha256,
      priorUse: '课件包已用于课程功能开发；本次选段未用于既有均值评测。仍作为公开开发材料，不声称未见材料泛化。',
      adaptation: '复用选编第 2、4、5、6、7 页（原 PDF 第 3、5、7、11、12 页）原样抽取文字，不含图表图像。改编稿保留署名与 CC BY-SA 3.0 US 许可。',
    },
    pages: slides.pages.filter(page => [2,4,5,6,7].includes(page.number)).map(({number,text})=>({number,text})),
    criteria: [
      '形成可独立回查的知识单元：列联表、条形图与直方图区别、比例分母、两变量图形，内容由浅入深而非仅列提纲。',
      '保留 51/137≈0.37 与 18/70≈0.26，解释两个分母对应各自群体，不能用人数大小替代群体内比例。',
      '分类条形图可以按类别重排（有序类别应保持合理顺序）；直方图横轴是数轴，不能任意重排。',
      '区分计数堆叠图、并排图与标准化比例堆叠图；原图不可见，不编造其形状或未给出的格子计数。',
      '本段比较只支持描述观察到的差异，不能直接得出总体显著差异或因果关系。',
    ],
  },
  {
    id: 'resnet-inline', title: 'ResNet · 恒等映射的小纸条', templateId: 'narrative', split: 'development',
    scenario: '小纸条追问', goal: '理解为什么将目标映射改写为残差有助于学习，并区分表示能力与优化难度。',
    provenance: {...paperProvenance, adaptation: `${paperProvenance.adaptation} 已有中文笔记是人工固定的测试上下文，并非本次模型生成，也不是参考答案。`},
    pages: paper.pages,
    interaction: {
      context: String.raw`残差学习把目标映射写成 \(H(x)=F(x)+x\)。在输入输出同维的前提下，若理想映射接近恒等映射，那么残差分支要拟合的就是相对输入的较小改动。这个改写没有凭空增加目标函数的表示能力，改变的是学习问题的表达方式。`,
      selection: '改变的是学习问题的表达方式',
      instruction: '既然只是换个写法，为什么训练会容易？是不是把 F 设成 0 就一定更好？接着这段笔记解释清楚，不要重讲整节，也不要只给一句结论。',
    },
    criteria: [
      '直接回应选区后的两个追问，承接已有笔记；不把小纸条写成另一份整章讲义。',
      '说明数学上的等价表示不保证优化难度相同，零残差对应恒等映射，为学习接近恒等的改动提供参照。',
      '明确 F=0 不一定是任务最优解，实际映射未必恒等；不承诺收敛速度或所有任务性能提升。',
      '必要补充与已有定义衔接，保持正文文风，不重复大段已有笔记。',
    ],
  },
];

export function productCase(material, profileId) {
  const testCase = caseFromMaterial(material, profileId);
  if (material.interaction) {
    const {context,selection,instruction} = material.interaction;
    Object.assign(testCase.request, {action:'explain',anchorId:'anchor',selection,instruction});
    testCase.request.document.chapters[0].content.content = [
      {type:'paragraph',attrs:{id:'anchor'},content:[{type:'text',text:context}]},
    ];
  }
  return testCase;
}
