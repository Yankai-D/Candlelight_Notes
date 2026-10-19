import { defaultSettings } from '../../../shared/learning.mjs';
import { freshTemplateLibrary, templateSnapshot } from '../../../shared/writing-templates.mjs';

export const calibrationVersion='note-calibration-v1';
export const provenance={kind:'authored-calibration',split:'development',attribution:'旁烛笔记原创校准材料，由 AI 协作编写；不是发表论文、真实模型实验或独立专家评审。',reviewStatus:'awaiting-independent-review'};
export const failureTypes=[
  {id:'math-without-purpose',label:'推导未回到问题',dimension:'reasoning'},
  {id:'missing-assumptions',label:'丢失成立条件',dimension:'faithfulness'},
  {id:'profile-voice-drift',label:'画像改变文风',dimension:'organization'},
  {id:'redundant-prerequisites',label:'重复已知铺垫',dimension:'adaptation'},
  {id:'paper-note-repetition',label:'纸条未回答追问',dimension:'goal'},
  {id:'unsupported-guarantee',label:'补充变成虚假保证',dimension:'faithfulness'},
  {id:'goal-not-addressed',label:'内容未回应学习目标',dimension:'goal'},
  {id:'outline-instead-of-notes',label:'提纲替代实质讲义',dimension:'coverage'},
];
const profiles={
  foundation:{background:'本科理科学生，学过高等数学、概率论和基础统计学。',foundations:['微积分','矩阵乘法','期望与方差']},
  fluent:{background:'本科理科学生，已经掌握下列概念及其基本推导。',foundations:['微积分','矩阵乘法','期望与方差','样本均值、标准差、标准误','方差与协方差展开','梯度下降与对角缩放']},
};
const p=text=>({type:'paragraph',text,sourcePages:[1],sourceQuote:''});
const h=text=>({type:'heading',text,sourcePages:[1],sourceQuote:''});
const note=blocks=>({blocks,summary:'原创局部校准样稿'});
const expected=(acceptable,score,quote,sourceQuote,reason,repair='',critical=false)=>({acceptable,score,quote,sourceQuote,reason,repair,critical});
const comparison=(good,bad)=>[{id:'reference',raw:good.raw,expected:good.expected},{id:'counterexample',raw:bad.raw,expected:bad.expected}];
const diagonal=String.raw`Hold a positive diagonal matrix D fixed for a one-step comparison. Let alpha > 0 and lambda >= 0. Coupled regularization gives u = w - alpha D(g + lambda w); separate shrinkage gives v = (1 - alpha lambda)w - alpha Dg. Thus u - v = -alpha lambda (D - I)w. Coordinate i receives penalty alpha lambda D_ii in u, but alpha lambda in v. This explains how gradient scaling also changes the effective penalty in the coupled update. For D = I the updates agree. These equations provide no convergence or prediction-accuracy guarantee.`;
const variance=String.raw`Let X_1,...,X_n be independent observations with a common finite variance sigma^2. Their mean has variance sigma^2/n and standard error sigma/sqrt(n). The variance expansion contains pairwise covariances; independence makes those terms zero. With correlated observations those terms must be retained. For sigma = 3 and n = 4 the theoretical standard error is 1.5. Standard error measures variation of the sample mean across repeated samples, not the spread of individual observations.`;
const expectation=String.raw`For integrable random variables X and Y and fixed constants a and b, E(aX+bY)=aE(X)+bE(Y). This linearity does not require independence. It follows by linearity of the integral defining expectation. Therefore the expectation of a sample mean is mu when each observation has mean mu, even when the observations are dependent. Dependence does matter for the variance of that mean.`;
const bias=String.raw`Suppose independent observations have mean mu+b and common finite variance sigma^2, where mu is the target and b is a fixed selection bias. Then E(X_bar)-mu=b and Var(X_bar)=sigma^2/n. The mean squared error for estimating mu equals b^2+sigma^2/n. Increasing n reduces the variance term but does not remove b. A small standard error alone therefore cannot establish that the estimate is close to the target.`;
const paperSource=String.raw`For independent observations from a population with fixed standard deviation sigma, the sample mean has standard error sigma/sqrt(n). Increasing n by a factor of four halves this standard error, while the population standard deviation remains sigma. With sigma=10, n=25 gives SE=2 and n=100 gives SE=1. This is an original arithmetic example, not observed experimental data.`;
const paperContext='标准差描述个体观测的离散程度，标准误描述样本均值在重复抽样中的波动。样本量变为四倍时，均值的标准误减半。';
const classifier=String.raw`In an original synthetic screening example there are 8 true positives, 2 false positives, 12 false negatives and 78 true negatives. Accuracy is (8+78)/100=0.86, precision is 8/(8+2)=0.8 and recall is 8/(8+12)=0.4. The target group contains 20 positive cases, of which 12 are missed. If missed positive cases are costly, high overall accuracy alone is insufficient; the positive-case recall and the cost of false alarms must also be considered. This table by itself does not determine the best decision threshold.`;
const lecture=String.raw`For data 1,2,3 the sample mean is 2. The sum of squared deviations is (1-2)^2+(2-2)^2+(3-2)^2=2. The usual sample variance divides by n-1, so s^2=2/2=1, and the sample standard deviation is s=1. Squaring avoids cancellation of positive and negative deviations. If measurements are in minutes, variance is in minutes squared and standard deviation is in minutes. If the three values are the entire population to be described, the average squared deviation instead uses denominator n, giving 2/3; the convention must be stated.`;

// Each case is a deliberately small, complete teaching unit. These are NOT
// model outputs and must never be inserted into the live benchmark as results.
export const calibrationCases=[
  {id:'math-purpose',title:'数学做完之后，问题是否更清楚？',failure:'math-without-purpose',templateId:'narrative',profileId:'foundation',
    goal:'理解对角缩放为何使两种衰减更新不同，把差值联系到坐标上的实际更新。',source:diagonal,
    scope:'只比较这一段单步代数论证，重点校准推理与问题背景的联系。',
    candidates:comparison(
      {raw:note([p('要比较的不是两条公式写得是否相似，而是同一个衰减系数是否对每个坐标产生相同作用。先固定正对角矩阵 D，只考察一步更新。'),p(String.raw`两种更新分别是 \(u=w-\alpha D(g+\lambda w)\) 与 \(v=(1-\alpha\lambda)w-\alpha Dg\)，其中 \(\alpha>0,\lambda\geq0\)。相减得到 \(u-v=-\alpha\lambda(D-I)w\)。`),p(String.raw`差值的意义在第 i 个坐标上最清楚：耦合方式的惩罚系数是 \(\alpha\lambda D_{ii}\)，独立衰减则是 \(\alpha\lambda\)。因此梯度缩放也改变了前一种方式的惩罚强度；差异来自作用在参数上的衰减，而非数据梯度本身。\(D=I\) 时两者相同。这里仅建立一步更新的代数关系，没有证明收敛或预测精度优势。`)]),expected:expected(true,[3,4],'差值的意义在第 i 个坐标上最清楚','This explains how gradient scaling also changes the effective penalty in the coupled update.','先说明比较目的，再将矩阵差值还原为坐标上的惩罚强度，最后收束结论边界。')},
      {raw:note([p(String.raw`固定正对角矩阵 D，设 \(\alpha>0,\lambda\geq0\)。依次有 \(u=w-\alpha D(g+\lambda w)\)，\(v=(1-\alpha\lambda)w-\alpha Dg\)，\(u-v=-\alpha\lambda(D-I)w\)。`),p(String.raw`第 i 个坐标的两项系数分别为 \(\alpha\lambda D_{ii}\) 和 \(\alpha\lambda\)。\(D=I\) 时更新相同。以上为单步代数记录，不提供收敛或预测精度保证。`)]),expected:expected(false,[1,2],'以上为单步代数记录','This explains how gradient scaling also changes the effective penalty in the coupled update.','公式和边界保留了，但没有解释这些系数为何回答梯度缩放改变惩罚的问题。','补上坐标系数的含义及其与原问题的联系；无需增加更多公式。')})},
  {id:'variance-conditions',title:'公式正确的形状，能否掩盖错误的条件？',failure:'missing-assumptions',templateId:'lecture',profileId:'foundation',
    goal:'理解均值标准误的推导及成立条件，完成给定算例。',source:variance,scope:'核对独立性、共同有限方差，以及相关观测下的协方差项。',
    candidates:comparison(
      {raw:note([h('均值的波动从哪里来'),p(String.raw`标准误衡量重复抽样时均值的波动。若观测独立且具有共同的有限方差 \(\sigma^2\)，均值方差为 \(\sigma^2/n\)，标准误为 \(\sigma/\sqrt n\)。`),h('条件与算例'),p(String.raw`展开均值的方差时本来含有协方差项，独立性使这些项为零；相关观测必须保留它们，不能直接套用上式。\(\sigma=3,n=4\) 时标准误为 \(3/2=1.5\)，它描述均值的波动，不是个体观测的标准差。`)]),expected:expected(true,[3,4],'相关观测必须保留它们','With correlated observations those terms must be retained.','把公式的条件、条件在推导中的作用和算例明确连接。')},
      {raw:note([h('均值的标准误'),p(String.raw`对任意一组观测，均值方差都是 \(\sigma^2/n\)，标准误都是 \(\sigma/\sqrt n\)。`),h('算例'),p(String.raw`取 \(\sigma=3,n=4\)，得到标准误 \(1.5\)。标准误描述重复抽样时均值的波动，不描述个体的离散程度。`)]),expected:expected(false,[0,1],'对任意一组观测，均值方差都是','Let X_1,...,X_n be independent observations with a common finite variance sigma^2.','把有条件的公式扩张到任意观测；算例正确也不能消除这一实质错误。','恢复共同有限方差和独立条件，并交代相关时的协方差项。',true)})},
  {id:'profile-voice',title:'熟悉程度改变，书面文风是否保持？',failure:'profile-voice-drift',templateId:'narrative',profileId:'fluent',
    goal:'理解期望线性为何不要求独立，并与均值方差的条件区分。',source:expectation,scope:'两份候选均面向熟悉画像；同时与基础画像参考段落比较。',
    anchor:{profileId:'foundation',raw:note([p(String.raw`期望把随机量按其分布加权平均。对可积的 X、Y 和固定常数 a、b，积分的线性性给出 \(E(aX+bY)=aE(X)+bE(Y)\)，这个过程不要求 X 与 Y 独立。因此，只要每个观测的均值都是 \(\mu\)，样本均值的期望就是 \(\mu\)。依赖关系仍会影响均值方差，不能把这两个结论的条件混用。`)])},
    candidates:comparison(
      {raw:note([p(String.raw`由积分线性性，对可积的 X、Y 及固定 a、b 有 \(E(aX+bY)=aE(X)+bE(Y)\)，无须独立。于是共同均值为 \(\mu\) 的观测，其样本均值期望仍为 \(\mu\)。这里处理的是期望；依赖关系对均值方差的影响依然需要单独计算。`)]),expected:expected(true,[3,4],'这里处理的是期望','Dependence does matter for the variance of that mean.','与基础画像段落保持同样的书面叙述，只收束了已经熟悉的期望概念铺垫。')},
      {raw:note([p(String.raw`宝子，这里直接秒了！可积的 X、Y 配上固定 a、b，\(E(aX+bY)=aE(X)+bE(Y)\)，积分线性性就是这么能打，根本不用独立！每个观测均值都是 \(\mu\)，样本均值的期望也就是 \(\mu\)。不过方差那边可别开香槟，依赖关系还得另算哦。`)]),expected:expected(false,[1,2],'积分线性性就是这么能打','This linearity does not require independence.','核心事实没有变，但熟悉画像触发了明显的聊天口吻，与固定长文模板和基础画像参考文风不一致。','保持参考段落的术语和书面视角，只压缩已知步骤。')})},
  {id:'known-prerequisites',title:'铺垫是否帮助读者继续推理？',failure:'redundant-prerequisites',templateId:'narrative',profileId:'fluent',
    goal:'解释为何增加样本量不能消除选择偏差。',source:bias,scope:'画像已掌握期望、方差和标准误；重点核对额外铺垫是否必要。',
    candidates:comparison(
      {raw:note([p(String.raw`把目标记为 \(\mu\)，而独立观测的共同均值是 \(\mu+b\)、有限方差是 \(\sigma^2\)。因此样本均值的偏差始终是 b，方差为 \(\sigma^2/n\)。`),p(String.raw`均方误差分解为 \(E[(\bar X-\mu)^2]=b^2+\sigma^2/n\)。增加样本只减小第二项：估计会更稳定地集中在一个可能有偏的位置。故小标准误不能单独证明估计接近目标。`)]),expected:expected(true,[3,4],'增加样本只减小第二项','Increasing n reduces the variance term but does not remove b.','直接从画像熟悉的均值方差进入偏差分解，解释投入集中在学习目标。')},
      {raw:note([p('先重新学习期望。期望是按概率加权的平均，一个值出现的概率越大，它对平均的贡献通常就越大。对有限取值，可以将每个取值乘以概率再相加。再重新学习方差：它衡量随机变量偏离自身均值的平方距离的平均；平方避免正负偏差抵消。标准差是方差的平方根，回到原有单位。标准误则描述统计量在重复抽样下的波动。我们还需要再次回顾样本均值，它是所有观测求和后除以样本个数。'),p(String.raw`现在设独立观测均值为 \(\mu+b\)、共同有限方差为 \(\sigma^2\)。样本均值偏差为 b，方差为 \(\sigma^2/n\)，均方误差为 \(b^2+\sigma^2/n\)。增加 n 只减小方差，不能移除 b，小标准误不能单独证明估计接近目标。`)]),expected:expected(false,[1,2],'先重新学习期望','Increasing n reduces the variance term but does not remove b.','后段事实完整，但前段重复画像已明确掌握的整组定义，没有填补当前推理缺口。判断依据是知识匹配而非字数。','删除无必要的定义复习，直接解释偏差项为何不随样本量减少。')})},
  {id:'paper-note',title:'纸条有没有回答这一次追问？',failure:'paper-note-repetition',templateId:'narrative',profileId:'foundation',action:'explain',
    goal:'区分增加样本量对均值标准误和个体标准差的影响。',instruction:'样本量四倍时，个体标准差也会减半吗？用原文算例解释。',source:paperSource,context:paperContext,scope:'评估插入现有段落之后的小纸条，不把整篇笔记重新整理。',
    candidates:comparison(
      {raw:{title:'变稳定的是均值',paragraphs:[String.raw`不会。固定总体的个体标准差仍为 \(\sigma=10\)；变小的是重复抽样时均值的波动。这个原创算例中，\(n=25\) 时均值标准误为 \(10/\sqrt{25}=2\)，\(n=100\) 时为 \(10/\sqrt{100}=1\)。更多观测让平均更稳定，并没有把总体中每个观测的离散程度压缩一半。`],sourcePages:[1],summary:'回答标准差是否也改变'},expected:expected(true,[3,4],'变小的是重复抽样时均值的波动','Increasing n by a factor of four halves this standard error, while the population standard deviation remains sigma.','明确回答不会，再用两次样本量的同一算例解释变的是哪个量。')},
      {raw:{title:'再认识两个概念',paragraphs:['标准差描述个体观测的离散程度，标准误描述样本均值在重复抽样中的波动。样本量变为四倍时，均值的标准误减半。'],sourcePages:[1],summary:'重复概念定义'},expected:expected(false,[1,2],'标准差描述个体观测的离散程度','With sigma=10, n=25 gives SE=2 and n=100 gives SE=1.','纸条逐字重复已有段落，没有说明个体标准差保持不变，也没有完成用户明确要求的算例。','保留原段落，在纸条中直接回答追问并展示 25 与 100 的对照。')})},
  {id:'unsupported-claim',title:'真实引文能否支持新增保证？',failure:'unsupported-guarantee',templateId:'narrative',profileId:'fluent',
    goal:'看懂两种更新的代数差别及其结论边界。',source:diagonal,scope:'候选都有真实页码和连续引文；检查引文含义是否支持新增主张。',
    candidates:comparison(
      {raw:note([{...p(String.raw`固定正对角 D，在 \(\alpha>0,\lambda\geq0\) 下，\(u=w-\alpha D(g+\lambda w)\)、\(v=(1-\alpha\lambda)w-\alpha Dg\)，差值为 \(-\alpha\lambda(D-I)w\)。耦合方式的坐标惩罚为 \(\alpha\lambda D_{ii}\)，独立方式为 \(\alpha\lambda\)，所以梯度缩放改变前者的有效惩罚；\(D=I\) 时两者相同。`),sourceQuote:'For D = I the updates agree.'},p('这一单步代数关系不构成收敛或预测精度证明；比较实际效果还需额外条件与证据。')]),expected:expected(true,[3,4],'不构成收敛或预测精度证明','These equations provide no convergence or prediction-accuracy guarantee.','明确限制从更新式能够推出的结论。')},
      {raw:note([{...p(String.raw`固定正对角 D，在 \(\alpha>0,\lambda\geq0\) 下，\(u=w-\alpha D(g+\lambda w)\)、\(v=(1-\alpha\lambda)w-\alpha Dg\)，差值为 \(-\alpha\lambda(D-I)w\)。耦合惩罚为 \(\alpha\lambda D_{ii}\)，独立惩罚为 \(\alpha\lambda\)，\(D=I\) 时相同。`),sourceQuote:'For D = I the updates agree.'},{...p('因此独立衰减必然收敛，且测试精度一定优于耦合方式。'),sourceQuote:'These equations provide no convergence or prediction-accuracy guarantee.'}]),expected:expected(false,[0,1],'独立衰减必然收敛','These equations provide no convergence or prediction-accuracy guarantee.','引文真实存在却明确否定这种保证；引用匹配不能充当语义支持判定。','删除无证据的收敛与精度保证，恢复单步代数的边界。',true)})},
  {id:'goal-focus',title:'列出指标以后，是否回应了目标？',failure:'goal-not-addressed',templateId:'lecture',profileId:'foundation',
    goal:'解释在漏掉阳性代价很高时，为什么不能仅凭准确率评价筛查。',source:classifier,scope:'保留相同指标与数值，校准解释重点是否回应用户的问题。',
    candidates:comparison(
      {raw:note([h('整体准确不等于阳性覆盖充分'),p(String.raw`原创算例中 TP=8、FP=2、FN=12、TN=78。准确率为 \(86/100=0.86\)，精确率为 \(8/10=0.8\)，召回率为 \(8/20=0.4\)。`),p('问题在于 20 个阳性中漏掉了 12 个。大量阴性判断正确可以抬高整体准确率，却没有弥补漏诊；若漏诊代价高，必须关注阳性召回，同时考虑误报代价。仅凭这张表还不能确定最佳阈值。')]),expected:expected(true,[3,4],'大量阴性判断正确可以抬高整体准确率','If missed positive cases are costly, high overall accuracy alone is insufficient;','用同一张表解释准确率和目标成本之间的错位，并保留阈值选择的边界。')},
      {raw:note([h('三个常见指标'),p(String.raw`原创算例中 TP=8、FP=2、FN=12、TN=78，20 个阳性漏掉 12 个。准确率为 \(86/100=0.86\)，精确率为 \(8/10=0.8\)，召回率为 \(8/20=0.4\)。`),p('准确率考察全部预测，精确率考察预测为阳性的部分，召回率考察实际阳性的部分。这里可以复习三个指标的名称和计算。仅凭这张表还不能确定最佳阈值。')]),expected:expected(false,[1,2],'这里可以复习三个指标的名称和计算','If missed positive cases are costly, high overall accuracy alone is insufficient;','指标数值都正确，但没有解释大量正确阴性怎样掩盖漏诊，也没有把重点连到用户给定的成本。','补充指标与漏诊成本的联系，无须泛化成一整套分类课程。')})},
  {id:'lecture-substance',title:'标题下是否有足够的知识？',failure:'outline-instead-of-notes',templateId:'lecture',profileId:'foundation',
    goal:'能根据数据计算样本方差和标准差，并说明分母与单位。',source:lecture,scope:'校准一份可独立回查的讲义，与仅列复习提纲的区别。',
    candidates:comparison(
      {raw:note([h('从偏差到方差'),p(String.raw`数据 1、2、3 的均值是 2，平方偏差和为 \((1-2)^2+(2-2)^2+(3-2)^2=2\)。平方使正负偏差不再相互抵消。`),h('计算口径与单位'),p(String.raw`通常样本方差使用分母 \(n-1\)，所以 \(s^2=2/2=1\)，标准差 \(s=1\)。若数据单位为分钟，方差单位是分钟平方，标准差为分钟。若把这三个值作为全部总体，只描述平均平方偏差，则使用分母 n，得到 \(2/3\)；计算前须说明口径。`)]),expected:expected(true,[3,4],'计算前须说明口径','If the three values are the entire population to be described, the average squared deviation instead uses denominator n, giving 2/3;','定义动机、计算、分母差别和量纲都可从正文独立回查。')},
      {raw:note([h('一、基础概念'),p('复习均值、方差和标准差的定义。'),h('二、计算练习'),p('使用数据 1、2、3 计算；记住样本方差为 1，标准差为 1。'),h('三、注意事项'),p('注意分母和单位，区分样本与总体。')]),expected:expected(false,[0,1],'注意分母和单位，区分样本与总体','If measurements are in minutes, variance is in minutes squared and standard deviation is in minutes.','把关键解释替换成待办提示；读者无法从正文知道怎么算、单位是什么以及何时用哪个分母。','将标题下的提示展开为有计算过程、条件和量纲的知识单元。',true)})},
];

export function requestFor(testCase,profileId=testCase.profileId) {
  const content=testCase.context?{type:'doc',content:[{type:'paragraph',attrs:{id:'anchor'},content:[{type:'text',text:testCase.context}]}]}:{type:'doc',content:[]};
  return {action:testCase.action||'generate',scope:'chapter',instruction:testCase.instruction||'按所选模板完整整理本教学单元，保留实质内容。',revision:0,chapterId:'section',
    ...(testCase.action==='explain'?{anchorId:'anchor',selection:testCase.context}:{}),
    learning:{...defaultSettings,mode:'adaptive',writingTemplate:templateSnapshot(freshTemplateLibrary(),testCase.templateId,'固定校准模板；不评估路由')},
    knowledge:structuredClone(profiles[profileId]),
    document:{title:testCase.title,intent:testCase.goal,pages:[{number:1,text:testCase.source}],chapters:[{id:'section',title:testCase.title,sourcePages:[1],status:testCase.context?'ready':'empty',content}]}};
}
export const rawText=raw=>(raw.blocks?raw.blocks.flatMap(b=>b.items||[b.text]):raw.paragraphs||[raw.text]).filter(Boolean).join('\n\n');
