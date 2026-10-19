import { readFileSync } from 'node:fs';
import { fingerprint } from '../../../server/claim-review.mjs';
import { auditUnits } from '../../../server/claim-audit.mjs';

// Keep the real window intact, including neighboring prose and full supplied pages.
const field=JSON.parse(readFileSync(new URL('../runs/2026-10-18-field/run.json',import.meta.url),'utf8'));
const {artifactHash,...body}=field;
if(artifactHash!=='7626f4fd23e2a1b43605887418e7cdf4f44a810e430c0550e3355bbbc6c1fe0d'||fingerprint(body)!==artifactHash)throw new Error('Field regression evidence changed');
const original=field.reviews.find(w=>w.windowId==='w4'||w.id==='w4')?.result.snapshot;
if(!original)throw new Error('Missing field window w4');
const meanQuote='The sample mean can be computed as the sum of the observed values divided by the number\nof observations:';
const corrected=structuredClone(original),magnitude=structuredClone(original);
const phrase='均值是各观测值以自身大小为权重、以观测个数为分母的平均';
if(!corrected.blocks.find(b=>b.id==='b7').text.includes(phrase))throw new Error('Original wording changed');
corrected.blocks.find(b=>b.id==='b7').text=corrected.blocks.find(b=>b.id==='b7').text.replace(phrase,'均值是各观测值相加、再以观测个数为分母的平均，每个观测的系数都是 1/n');
magnitude.blocks.find(b=>b.id==='b7').text=magnitude.blocks.find(b=>b.id==='b7').text.replace(phrase,'均值是各观测值相加后除以观测个数，较大的观测值对总和的数值贡献也较大');
const make=(id,snapshot,issues=[],split='development-control',reason='参考由 AI 编写，尚未独立审定。')=>({id,split,snapshot,reference:{reason,issues}});
const basic=(text,source)=>({documentId:'material',chapterId:'section',revision:1,title:'公式与理解',goal:'看懂这篇文章',
  blocks:[{id:'p1',text,sourcePages:[1]}],targetIds:['p1'],source:[{number:1,text:source}]});
const weightedSource='For positive weights w_i, the weighted mean is sum(w_i*x_i)/sum(w_i). The weights are specified separately from the values. Equal weights give the arithmetic mean. For values 1 and 3 with weights 1 and 2, the weighted mean is 7/3.';
const centeredSource='Let x and a be real numbers and b>0. The transform is z=(x-a)/b. Subtract the center a from x and divide the resulting difference by b. Equivalently, z=x/b-a/b.';
const centered=String.raw`设 \(x,a\) 为实数且 \(b>0\)，变换定义为 \(z=(x-a)/b\)。`;
export const meaningCases=[
  make('mean-observed',structuredClone(original),[{unitId:'b7:s2',verdict:'contradiction',page:4,quote:meanQuote,reason:'把观测值本身当权重改变了均值的计算规则；算术均值的各项系数相同。'}],'known-regression','上一轮真实讲义 w4 原样重放，已见漏检；其他句子包括平衡点直觉均参考 retain。'),
  make('mean-equal-control',corrected,[],'matched-control','只替换已知错误短语，来源、邻文和其余目标句保持原样。'),
  make('mean-contribution-control',magnitude,[],'matched-control','数值贡献与数学权重分开；合理直觉无需重复完整证明。'),
  make('weighted-control',basic(String.raw`这里讨论加权均值：\(m=\sum_i w_i x_i/\sum_i w_i\)，权重预先单独指定且为正。观测值 1、3 对应的权重是 1、2，因此第二个观测在加权和中被乘以 2，得到 \(m=(1\cdot1+2\cdot3)/(1+2)=7/3\)。`,weightedSource),[],'development-control','存在不同权重本身不是错误，应按给定定义判断。'),
  make('center-order-mismatch',basic(centered+'也就是先把输入除以尺度 b，再从结果减去中心 a。',centeredSource),[{unitId:'p1:s2',verdict:'contradiction',page:1,quote:'Equivalently, z=x/b-a/b.',reason:'x=10,a=2,b=4 时原式为 2，文字操作为 0.5；除以 b 后应减 a/b。'}],'development-transfer','AI 新编的跨概念顺序错误，非独立留出集。'),
  make('center-order-control',basic(centered+'也就是先从输入减去中心 a，再把差值除以尺度 b。',centeredSource),[],'matched-control','与错误版本共享定义和来源，只改变操作顺序。'),
];
export function meaningFixture(c) {
  return {checks:auditUnits(c.snapshot).filter(u=>u.target).map(u=>{
    const issue=c.reference.issues.find(i=>i.unitId===u.id);
    return issue?{unitId:u.id,verdict:issue.verdict,evidence:[{page:issue.page,quote:issue.quote}],conflict:issue.reason}:{unitId:u.id,verdict:'retain'};
  })};
}
