import { readFileSync } from 'node:fs';
import { operationMaterials } from '../notes/operation-consistency.mjs';
import { materials } from '../notes/cases.mjs';

// These development probes and reference judgments were authored with AI.
// Labels, explanations and mock answers are NEVER sent in live requests.
const archive=JSON.parse(readFileSync(new URL('../notes/runs/2026-10-18-operation/run.json',import.meta.url),'utf8'));
const observed=archive.candidates.find(c=>c.id==='independent-shrink/fluent/1/operation-check');
const shrink=operationMaterials.find(m=>m.id==='independent-shrink');
const affine=operationMaterials.find(m=>m.id==='affine-composition');
const sampling=materials.find(m=>m.id==='standard-error');
const gap={title:'An iteration with an omitted appendix',goal:'了解当前选段实际说明的内容。',pages:[{number:1,text:'The method iteratively updates a state with a positive step size eta. The update equation and admissible step-size conditions are given in Appendix A, which is not included in this excerpt. No convergence theorem or proof is stated here.'}]};
const badShrink=String.raw`若 \(P\) 是单位矩阵，差为零，两种更新一致；只要 \(P\) 偏离单位矩阵，两种做法就会给出不同的下一步。`;
const goodShrink=String.raw`若 \(P\) 是单位矩阵，两种更新一致；更一般地，差是否为零取决于 \(\rho(P-I)u\)，即使 \(P\) 不是单位矩阵，两种更新也可能相同。`;
if(!observed.result.blocks[2].text.includes(badShrink))throw new Error('Archived observation changed');
const snapshot=(material,text,context=[])=>({documentId:'material',chapterId:'section',revision:1,title:material.title,goal:material.goal,
  blocks:[...context.map((b,i)=>({id:`context-${i+1}`,text:b.text,sourcePages:b.sourcePages})),{id:'p1',text,sourcePages:[1]}],targetIds:['p1'],source:structuredClone(material.pages)});
const item=(id,snap,expected,claim,quote,reason,extra={})=>({id,split:'development',snapshot:snap,expected,reference:{claim,quote,reason,...extra}});
const shrinkQuote='The coupled minus independent difference is -eta*rho*(P-I)*u.';
const shrinkContext=[observed.result.blocks[0],observed.result.blocks[3]];
const affineGood=String.raw`比较 \(T(x)=c(x+b)\) 与 \(S(x)=cx+b\)，差为 \((c-1)b\)。因此，对所有实数 \(x\)，两者在 \(c=1\) 或 \(b=0\) 时相等；只有 \((c-1)b\ne0\) 时才不同。`;
const affineBad=String.raw`比较 \(T(x)=c(x+b)\) 与 \(S(x)=cx+b\)，差为 \((c-1)b\)。因此，只要 \(c\ne1\)，两者对所有实数 \(x\) 都不同。`;
const affineQuote='They coincide when (c-1)*b=0, for example c=1 or b=0; this condition is independent of x.';
const sampleGood='在总体方差固定、独立抽样的条件下，样本量变为四倍会让理论标准误减半。这里比较的是重复抽样时样本均值的离散程度，不保证每次样本的实际估计误差也减半。';
const sampleBad='在总体方差固定、独立抽样的条件下，样本量变为四倍会让理论标准误减半。因此，每次抽样得到的均值与总体均值的绝对误差也必然减半。';
const sampleQuote='With the same population variance and independent sampling, quadrupling n halves the theoretical standard error; it does not promise a smaller realized estimation error in every sample.';
const gapGood='选段提到用正步长迭代更新状态，但更新公式和允许的步长条件在未提供的附录中。因此，仅凭当前选段不能确定哪些步长保证收敛。';
const gapBad='选段提到用正步长迭代更新状态。只要步长为正，这个迭代就必然收敛。';
const gapQuote='The update equation and admissible step-size conditions are given in Appendix A, which is not included in this excerpt.';

export const claimCases=[
  {...item('shrink-observed',snapshot(shrink,observed.result.blocks[2].text,shrinkContext),'issue',badShrink,shrinkQuote,
    'P 不为单位矩阵不充分；零衰减或参数落在 P 的单位特征子空间都可使差为零。',
    {counterexample:'取 eta=0.2, rho=0.5, P=diag(0.5,1), u=(0,2), h=(2,-1)，两种更新均为 (-0.2,2)。',after:goodShrink}),
    provenance:{kind:'real-model-output',run:'evals/notes/runs/2026-10-18-operation/run.json',candidateId:observed.id,blockIndex:2}},
  item('shrink-corrected',snapshot(shrink,observed.result.blocks[2].text.replace(badShrink,goodShrink),shrinkContext),'no-issue-found',goodShrink,shrinkQuote,'已保留乘积为零的条件，没有声称 P 不同必然导致更新不同。'),
  item('affine-valid',snapshot(affine,affineGood),'no-issue-found',affineGood,affineQuote,'全称量词有明确条件；对于这两个仿射映射，相等条件与 x 无关。'),
  item('affine-overclaim',snapshot(affine,affineBad),'issue',String.raw`因此，只要 \(c\ne1\)，两者对所有实数 \(x\) 都不同。`,affineQuote,'忽略 b=0 也使差为零。',
    {counterexample:'取 x=2,b=0,c=4，T=S=8。',after:String.raw`因此，只有 \((c-1)b\ne0\) 时两者才不同；\(b=0\) 时即使 \(c\ne1\)，两者也相等。`}),
  item('sampling-overclaim',snapshot(sampling,sampleBad),'issue','因此，每次抽样得到的均值与总体均值的绝对误差也必然减半。',sampleQuote,'把分布层面的标准误推广为每一次抽样的误差保证。',
    {counterexample:'总体为等概率 0/1，独立抽样的 n=2 与 n=8 都可能全为 1；两次绝对误差均为 0.5。',after:'这描述的是重复抽样的均值分布，不能保证每次样本的实际估计误差减半。'}),
  item('sampling-valid',snapshot(sampling,sampleGood),'no-issue-found',sampleGood,sampleQuote,'已区分理论标准误与一次样本的实际误差。'),
  item('context-cautious',snapshot(gap,gapGood),'no-issue-found',gapGood,gapQuote,'准确描述资料边界，缺少附录不意味着谨慎的原句本身有错。'),
  item('context-missing',snapshot(gap,gapBad),'needs-context','只要步长为正，这个迭代就必然收敛。',gapQuote,'没有更新式或定理，无法证明或构造该具体迭代的数值反例；应保留原稿并请求来源。',
    {missingContext:'附录 A 的更新方程、允许步长条件及收敛定理。'}),
];

export const claimOracles={
  shrink:[{u:[3,-2],h:[2,-1],p:[.5,2],eta:.2,rho:0,expected:[2.8,-1.6]},
    {u:[0,2],h:[2,-1],p:[.5,1],eta:.2,rho:.5,expected:[-.2,2]}],
  affine:{x:2,b:0,c:4,expected:8},
  sampling:{population:[0,1],probabilities:[.5,.5],sizes:[2,8],observedValue:1,absoluteError:.5},
};

// Injected only by the offline demonstration; it is not a quality evaluator.
export function simulatedClaimReply(testCase,stage) {
  const r=testCase.reference;
  if(stage==='patch')return {edits:[{blockId:'p1',before:r.claim,after:r.after}]};
  return {checks:[{blockId:'p1',verdict:testCase.expected,claim:r.claim,reason:r.reason,evidence:[{page:1,quote:r.quote}],counterexample:r.counterexample||'',missingContext:r.missingContext||''}]};
}
