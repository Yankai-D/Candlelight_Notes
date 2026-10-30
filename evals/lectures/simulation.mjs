// Protocol exercise, never a quality sample or token/cost measurement.
export function courseSimulator(testCase,{legacy=false,failCall=0}={}) {
  const sections=testCase.sources.slice(0,3).map((s,i)=>({title:s.title,purpose:`讲清当前主题及其与前后内容的关系：${s.title}`,unitIds:[`unit-${i+1}`,...(i===2?testCase.sources.slice(3).map((_,n)=>`unit-${n+4}`):[])],requirementIds:['r1'],dependsOn:i?[i]:[],handoff:'将当前方法用于后续分析。'}));
  const teachingPlan={version:1,throughline:'从条件的含义到一般关系，再到具体应用。',concepts:sections.map((s,i)=>({id:`t${i+1}`,title:s.title,objective:s.purpose,prerequisites:i?[`t${i}`]:[],unitIds:[`unit-${i+1}`],placements:[{section:i+1,role:'introduce',advance:s.purpose,difficultPoint:'参照总体与成立条件',check:'能依据资料独立复算本章例题。'}]})),examples:[]};
  let count=0;
  return async(_url,options)=>{
    count++;if(failCall===count)return new Response('fixture failure',{status:401});
    const {messages}=JSON.parse(options.body),system=messages[0].content,ctx=JSON.parse(messages[1].content);let value;
    if(system.startsWith('bundle-intent'))value={kind:'lecture',requirements:[{id:'r1',text:ctx.intent,evidenceQuote:ctx.intent}],organization:'按知识依赖组织',limitations:[]};
    else if(system.startsWith('bundle-materials'))value={units:ctx.units.map(u=>({id:u.id,topics:[u.title],prerequisites:[],role:'当前主题的来源',limitations:[]}))};
    else if(system.startsWith('bundle-outline'))value={sections,...(!legacy?{teachingPlan}:{})};
    else if(system.startsWith('bundle-plan-review'))value={candidateDigest:ctx.candidateDigest,verdict:'accept',checks:['goal','coverage','order','coherence'].map(dimension=>({dimension,status:'pass'})),findings:[],summary:'模拟协议通过，不代表质量。'};
    else if(system.startsWith('chapter-analysis')){
      const refs=[ctx.source[0].excerpts[0].id];
      value={approach:'按资料解释当前知识任务',connection:'由前一方法引入当前应用',steps:[{focus:'当前主题',instruction:ctx.contract.section.purpose,sourceEvidenceIds:refs}],risks:[],synthesis:{units:[{id:'k1',topic:'当前主题',concept:'解释来源中的关系和条件',method:[],...(!legacy?{conceptIds:ctx.contract.teaching?.concepts.map(c=>c.id)||[],exampleIds:[]}:{}),sourceEvidenceIds:refs,examples:[],variants:[]}],merges:[]}};
    }else if(system.startsWith('lecture-outline'))value=ctx.analyses[0];
    else if(ctx.composition?.contract){
      const i=sections.findIndex(s=>s.title===ctx.composition.contract.section.title);
      value={blocks:testCase.sources[i].pages.slice(0,2).map((text,n)=>({type:'paragraph',text,sourcePages:[ctx.source[n]?.number||ctx.source[0].number],learningUnitId:'k1',learningRoles:['concept'],sourceQuote:''})),summary:'离线协议样例。'};
    }else throw new Error(`Unexpected simulation protocol: ${system.slice(0,50)}`);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
  };
}
