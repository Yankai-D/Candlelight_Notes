import { freshCases } from '../v2/cases.mjs';
import { auditUnits } from '../../../server/claim-audit.mjs';

// References are fixtures, never model input. New probes are development data,
// and the two normalization cases are explicitly known failure regressions.
const make=(id,text,source,expected,reference)=>({id,split:'development',provenance:'AI 编写，与协议一起设计；非独立留出集。',expected,
  snapshot:{documentId:'material',chapterId:'section',revision:1,title:'结论与适用范围',goal:'看懂结论及其成立条件。',
    blocks:[{id:'p1',text,sourcePages:[1]}],targetIds:['p1'],source:[{number:1,text:source}]},reference});
const logSource='The real natural logarithm is defined only for positive real inputs. For x>0 and y>0, ln(xy)=ln(x)+ln(y). Both x and y must be positive; xy>0 alone is insufficient to define the two logarithms on the right. The product identity follows from the addition law of the exponential function.';
const logGood=String.raw`这里的 \(\ln\) 指实数自然对数，\(x>0,y>0\)。因此乘积的对数可以拆开：\(\ln(xy)=\ln x+\ln y\)。`;
const logBad=String.raw`这里的 \(\ln\) 指实数自然对数，\(x,y\) 是非零实数。因此只要 \(xy>0\)，乘积的对数就可以拆开：\(\ln(xy)=\ln x+\ln y\)。`;
const theoremSource='The displayed figure records the residual decreasing in three experimental runs with one configuration. The text refers readers to Theorem 2 in the appendix for a convergence result. Neither the theorem statement, its assumptions nor its proof are included in this excerpt. The figure reports measurements rather than a theorem.';
export const focusedCases=[
  ...['normalization-valid','normalization-overclaim'].map(id=>({...structuredClone(freshCases.find(c=>c.id===id)),split:'known-regression',provenance:'上一轮已观察的失败案例，不算新测试数据。'})),
  make('log-domain-overclaim',logBad,logSource,'issue',{quote:'Both x and y must be positive; xy>0 alone is insufficient to define the two logarithms on the right.',reason:'x=y=-1 时 xy>0，但实数 ln x 与 ln y 未定义。',unitId:'p1:s2'}),
  make('log-domain-valid',logGood,logSource,'no-issue-found',{quote:'For x>0 and y>0, ln(xy)=ln(x)+ln(y).',reason:'上下文已声明正数定义域，不需每句重复，也不需补指数加法推导。'}),
  make('theorem-unavailable',String.raw`图中记录了三次实验的残差下降。附录定理 2 进一步保证，这个方法对本文所研究的问题具有线性收敛率。`,theoremSource,'needs-context',
    {quote:'Neither the theorem statement, its assumptions nor its proof are included in this excerpt.',reason:'缺少定理原文，不能判定是否保证线性收敛，也不能据此判为错误。',unitId:'p1:s2'}),
  make('experiment-cautious',String.raw`图中记录了同一配置下三次实验的残差下降。这是这些实验的观测，当前摘录没有提供附录定理的内容，无法据此判断一般的收敛率。`,theoremSource,'no-issue-found',
    {quote:'The figure reports measurements rather than a theorem.',reason:'准确区分实验观测与未提供的理论结论，不需要补条件或证明。'}),
];

export function conditionFixture(c) {
  return {checks:auditUnits(c.snapshot).filter(u=>u.target).map(unit=>{
    const problem=c.expected!=='no-issue-found'&&(c.reference.unitId?unit.id===c.reference.unitId:unit.text===c.reference.claim);
    if(!problem)return {unitId:unit.id,verdict:'retain'};
    if(c.expected==='needs-context')return {unitId:unit.id,verdict:'needs-source',missing:c.reference.reason};
    return {unitId:unit.id,verdict:'contradiction',evidence:[{page:1,quote:c.reference.quote}],conflict:c.reference.counterexample||c.reference.reason};
  })};
}
export function auditFixture(c) {
  const minimal=conditionFixture(c);
  return {blocks:c.snapshot.targetIds.map(blockId=>({blockId,claims:auditUnits(c.snapshot).filter(u=>u.target&&u.blockId===blockId).map(unit=>{
    const item=minimal.checks.find(c=>c.unitId===unit.id),ev=[{page:1,quote:c.reference.quote}];
    const support=item.verdict==='retain'?{kind:'direct',evidence:ev,reason:c.reference.reason}:
      item.verdict==='needs-source'?{kind:'insufficient',evidence:ev,reason:item.missing,missing:[item.missing]}:
      {kind:'contradicted',evidence:ev,reason:item.conflict,refutation:{kind:'source',statement:ev[0]}};
    return {unitIds:[unit.id],assertion:unit.text,premises:[],support};
  })}))};
}
