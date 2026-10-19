import { claimCases } from '../cases.mjs';
import { auditUnits, validateAudit } from '../../../server/claim-audit.mjs';

export const number=value=>({value:String(value)});
export const variable=name=>({variable:name});
export const op=(operation,...args)=>({op:operation,args});
export const affineWitness={variables:{x:'2',b:'0',c:'4'},left:op('multiply',variable('c'),op('add',variable('x'),variable('b'))),right:op('add',op('multiply',variable('c'),variable('x')),variable('b')),relation:'equal'};
export const shrinkWitness={variables:{eta:'1/5',rho:'0',p:'2',u:'3'},left:op('multiply',op('negate',variable('eta')),op('multiply',variable('rho'),op('multiply',op('subtract',variable('p'),number(1)),variable('u')))),right:number(0),relation:'equal'};

// Hand-adapted offline protocol fixtures, not newly generated model outputs
// and not a migration that turns rejected v1 responses into accepted results.
export const migrationCases=claimCases.map(c=>({...structuredClone(c),provenance:{...c.provenance,usage:'v1 known-failure development regression'}}));
export function fixtureReview(c) {
  const units=auditUnits(c.snapshot).filter(u=>u.target),source={page:1,quote:c.reference.quote};
  const common={assertion:c.reference.claim,premises:[]};
  if(c.expected==='no-issue-found')return {blocks:[{blockId:'p1',claims:[{...common,unitIds:units.map(u=>u.id),support:{kind:'direct',evidence:[source],reason:'模拟诊断，用于验证协议、渲染和保留路径；不是模型质量结果。'}}]}]};
  const text=c.snapshot.blocks.find(b=>b.id==='p1').text,start=text.indexOf(c.reference.claim),end=start+c.reference.claim.length;
  if(start<0)throw new Error('Missing fixture claim');
  const affected=units.filter(u=>u.end>start&&u.start<end);
  const background=group=>({unitIds:group.map(u=>u.id),assertion:'保留当前上下文',premises:[],support:{kind:'direct',evidence:[source],reason:'离线协议夹具，仅验证非目标改动保持不变。'}});
  const support=c.expected==='needs-context'?{kind:'insufficient',evidence:[source],reason:c.reference.reason,missing:[c.reference.missingContext]}:
    {kind:'contradicted',evidence:[source],reason:c.reference.reason,refutation:c.reference.arithmetic?
      {kind:'calculation',assumptions:c.reference.counterexample,explanation:'离线算例验证，不作为模型输出成绩。',arithmetic:structuredClone(c.reference.arithmetic)}:c.id.startsWith('shrink')||c.id.startsWith('affine')?
      {kind:'calculation',assumptions:c.id.startsWith('shrink')?'取一维正对角矩阵 P=(2)，u=3，eta=1/5，rho=0；满足来源允许范围。':'x=2,b=0,c=4；c 不为 1。',explanation:'算术仅核对这个取值下的差或两侧数值，来源映射需要独立核对。',arithmetic:structuredClone(c.id.startsWith('shrink')?shrinkWitness:affineWitness)}:
      {kind:'source',statement:source}};
  const before=units.filter(u=>u.end<=affected[0].start),after=units.filter(u=>u.start>=affected.at(-1).end);
  return {blocks:[{blockId:'p1',claims:[...(before.length?[background(before)]:[]),{...common,unitIds:affected.map(u=>u.id),support},...(after.length?[background(after)]:[])]}]};
}
export function fixturePatch(c,review,selection) {
  const audit=validateAudit(c.snapshot,review);
  return {edits:selection.claimIds.map(claimId=>({claimId,after:selection.kind==='withdrawal'?'当前选段缺少所需附录，尚不能根据所给资料判断收敛条件。':c.reference.after||'这是模拟修订候选。'}))};
}
