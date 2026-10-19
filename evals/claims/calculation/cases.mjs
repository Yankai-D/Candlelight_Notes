import { meaningCases } from '../meaning/cases.mjs';
import { auditUnits } from '../../../server/claim-audit.mjs';

const make=(id,text,source,issues,reason)=>({id,split:'development-control',snapshot:{documentId:'material',chapterId:'section',revision:1,title:'概念与解释',goal:'看懂这篇文章',blocks:[{id:'p1',text,sourcePages:[1]}],targetIds:['p1'],source:[{number:1,text:source}]},reference:{issues,reason}});
export const calculationCases=[...structuredClone(meaningCases).map(c=>({...c,split:'known-development'})),
  make('balance-metaphor','把观测值想成数轴上的等质量砝码，均值是使它们平衡的支点。这个图像帮助理解均值的位置，没有额外定义按数值大小分配的质量。','For real observations x_i, the arithmetic mean is sum(x_i)/n with n>0. It can be visualized as the balancing point of equal masses placed at the observations.',[],'仅作等质量平衡点比喻，不凭比喻强制另造计算规则。'),
  make('undefined-transform','资料提到一个名为 Q 的变换。它的计算规则是把输入除以 2。','The text names a transform Q on real inputs but does not provide its definition or properties.',[{unitId:'p1:s2',verdict:'needs-source',reason:'来源未定义 Q，无法判断其规则是否是除以 2。'}],'未知定义应保留缺口，不用算术常识补出来源。'),
];

// Offline fixtures are developer references, never inserted into a live request.
export function extractionFixture(c) {
  return {units:auditUnits(c.snapshot).filter(u=>u.target).map(u=>{
    const context={unitId:u.id,kind:'context'};
    const calculation=(quote,expression)=>({unitId:u.id,kind:'calculation',rules:[{quote,expression}]});
    if(c.id.startsWith('mean-')) {
      if(u.id==='b7:s2') {
        const expression=c.id==='mean-observed'?'sum(x_i*x_i)/n': 'sum(x_i)/n';
        return calculation(u.text.slice(0,u.text.indexOf('，偏离')),expression);
      }
      if(u.id==='b7:s1'||u.id==='b7:s3')return {unitId:u.id,kind:'intuition',quote:u.text,reason:'平衡点或影响方向的直觉说明，未指定另一套计算步骤。'};
    }
    if(c.id==='weighted-control'&&u.id==='p1:s2')return calculation(u.text,'(1*1+2*3)/(1+2)');
    if(c.id.startsWith('center-order-')&&u.id==='p1:s2')return calculation(u.text,c.id==='center-order-mismatch'?'x/b-a':'(x-a)/b');
    if(c.id==='balance-metaphor')return {unitId:u.id,kind:'intuition',quote:u.text,reason:'用等质量砝码解释平衡点，未声称改变均值运算。'};
    if(c.id==='undefined-transform'&&u.id==='p1:s2')return calculation(u.text,'Q(x)=x/2');
    return context;
  })};
}
export function comparisonFixture(c,extraction) {
  const checks=auditUnits(c.snapshot).filter(u=>u.target).map(u=>{
    const issue=c.reference.issues.find(i=>i.unitId===u.id);
    if(!issue)return {unitId:u.id,verdict:'retain'};
    return issue.verdict==='needs-source'?{unitId:u.id,verdict:'needs-source',missing:issue.reason}:
      {unitId:u.id,verdict:'contradiction',evidence:[{page:issue.page,quote:issue.quote}],conflict:issue.reason};
  });
  const comparisons=extraction.units.flatMap(u=>(u.rules||[]).map((rule,ruleIndex)=>{
    const issue=c.reference.issues.find(i=>i.unitId===u.unitId);
    if(issue?.verdict==='needs-source')return {unitId:u.unitId,ruleIndex,relation:'needs-source',missing:issue.reason};
    const page=c.snapshot.source[0];
    return {unitId:u.unitId,ruleIndex,relation:issue?'conflict':'compatible',source:{page:issue?.page||page.number,quote:issue?.quote||page.text.slice(0,Math.min(page.text.length,100))},
      sourceExpression:c.id.startsWith('mean-')?'sum(x_i)/n':c.id.startsWith('center-')?'(x-a)/b':rule.expression,
      reason:issue?.reason||'本离线夹具中的计算规则一致；不代表真实模型判断。'};
  }));
  return {checks,comparisons};
}
