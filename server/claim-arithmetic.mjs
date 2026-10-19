// A tiny exact-rational checker for proposed arithmetic witnesses. It verifies
// arithmetic only, never whether an expression formalizes a source or claim.
// No eval, dynamic code, tool access, loops, or floating-point tolerance.
const bad=()=>{throw Object.assign(new Error('Invalid or out-of-bound arithmetic witness'),{code:'CLAIM_ARITHMETIC_INVALID'});};
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){[a,b]=[b,a%b];}return a;};
const fraction=(n,d)=>{if(!d)bad();if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return [n/g,d/g];};
const rational=value=>{
  if(typeof value!=='string'||! /^-?\d{1,6}(?:\/[1-9]\d{0,5})?$/.test(value))bad();
  const [n,d='1']=value.split('/');return fraction(BigInt(n),BigInt(d));
};
const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));
const print=([n,d])=>d===1n?String(n):`${n}/${d}`;
export function checkArithmetic(witness) {
  if(!keys(witness,['variables','left','right','relation'])||!keys(witness.variables,Object.keys(witness.variables||{}))||!['equal','different'].includes(witness.relation))bad();
  const entries=Object.entries(witness.variables);if(entries.length>12)bad();
  const variables=new Map(entries.map(([name,value])=>{if(!/^[a-zA-Z][a-zA-Z0-9_]{0,15}$/.test(name))bad();return [name,rational(value)];}));
  let nodes=0;
  const evaluate=(node,depth=0)=>{
    if(++nodes>64||depth>8||!node||typeof node!=='object')bad();
    if(keys(node,['value'])&&Object.hasOwn(node,'value'))return rational(node.value);
    if(keys(node,['variable'])&&variables.has(node.variable))return variables.get(node.variable);
    if(!keys(node,['op','args'])||!['add','subtract','multiply','divide','negate','absolute'].includes(node.op)||!Array.isArray(node.args)||node.args.length!==( ['negate','absolute'].includes(node.op)?1:2))bad();
    const [[a,b],second]=node.args.map(arg=>evaluate(arg,depth+1)),[c,d]=second||[0n,1n];
    let result;
    switch(node.op){
      case 'add':result=fraction(a*d+c*b,b*d);break;
      case 'subtract':result=fraction(a*d-c*b,b*d);break;
      case 'multiply':result=fraction(a*c,b*d);break;
      case 'divide':result=fraction(a*d,b*c);break;
      case 'negate':result=[-a,b];break;
      case 'absolute':result=[a<0n?-a:a,b];break;
    }
    if(result.some(n=>String(n).length>512))bad();return result;
  };
  const left=evaluate(witness.left),right=evaluate(witness.right),equal=left[0]===right[0]&&left[1]===right[1];
  if(equal!==(witness.relation==='equal'))throw Object.assign(new Error('Arithmetic does not establish the proposed relation'),{code:'CLAIM_ARITHMETIC_MISMATCH'});
  return {left:print(left),right:print(right),relation:witness.relation,status:'arithmetic-checked',sourceMapping:'unverified',domainAssumptions:'unverified'};
}
