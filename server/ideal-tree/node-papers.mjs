import { z } from 'zod';
const version=new URL(import.meta.url).search;
const { parseIdeal, validateResearch, idealNodeResources }=await import(new URL(`../../shared/ideal-tree.mjs${version}`,import.meta.url));
const { idealMessages }=await import(new URL(`./prompts.mjs${version}`,import.meta.url));
const { evidenceExcerpts }=await import(new URL(`./research.mjs${version}`,import.meta.url));
const { arxivId }=await import(new URL(`./arxiv.mjs${version}`,import.meta.url));
const planSchema=z.object({query:z.string().trim().min(2).max(200),arxivIds:z.array(z.string().refine(v=>!!arxivId(v),'需要有效的 arXiv 编号')).max(2)}).strict();

// This is a bounded, independent source task. It never invokes curriculum
// expansion/review/repair and never writes node bodies, prerequisites or goals.
export async function findNodePapers(runner,job,branchId,nodeId,complete,signal) {
  const node=job.branches[branchId].nodes.find(n=>n.id===nodeId);
  const state=job.paperResearch[branchId][nodeId];
  const context={goal:job.input.goal,profile:job.input.profile,branch:job.skeleton.branches.find(b=>b.id===branchId),
    node:{id:node.id,title:node.title,body:node.body,outcome:node.outcome}};
  let retries=1;
  const ask=async(stage,data,validate)=>{
    let messages=idealMessages(stage,data);
    for(;;) {
      signal.throwIfAborted(); job.metrics.modelCalls++;
      const started=Date.now(); await runner.persist(job);
      let raw;
      try {
        raw=await complete(messages,{stage,signal,onCompletion:info=>{job.metrics.completionTokens+=info.completionTokens||0;}});
        signal.throwIfAborted(); const result=validate(raw);
        await runner.persist(job,{type:'model',stage,branchId,nodeId,accepted:true,elapsedMs:Date.now()-started}); return result;
      } catch(error) {
        signal.throwIfAborted();
        await runner.persist(job,{type:'model',stage,branchId,nodeId,accepted:false,issue:error.message.slice(0,1000)});
        if(!raw||!retries--) throw error;
        job.metrics.repairs++;
        messages=[...messages,{role:'assistant',content:raw},{role:'user',content:`只修复本次资料选择格式：${error.message.slice(0,1500)}。返回约定 JSON，不修改学习树。`}];
      }
    }
  };
  state.stage='确定论文检索范围'; await runner.persist(job);
  const linked=idealNodeResources(job,branchId,nodeId).map(r=>job.sources.find(s=>s.id===r.sourceId));
  const plan=await ask('paper-plan',{...context,existing:linked.map(s=>({title:s.title,url:s.url}))},raw=>parseIdeal(planSchema,raw));
  state.stage='查找 arXiv 并核实摘要'; job.metrics.toolCalls++; await runner.persist(job);
  const result=await runner.tools.arxiv({query:plan.query,ids:plan.arxivIds},signal);
  signal.throwIfAborted();
  const sources=result.sources.map(s=>({...s,excerpts:evidenceExcerpts(s,node.title+' '+plan.query)}));
  state.problems=result.problems;
  await runner.persist(job,{type:'tool',tool:'arxiv',stage:'paper-search',branchId,nodeId,accepted:!!sources.length});
  if(!sources.length) throw new Error(result.problems.join(' ') || '没有找到可核实且相关的 arXiv 论文，可稍后重新查找。');
  state.stage='核对论文与学习目标'; await runner.persist(job);
  const selected=await ask('paper-select',{...context,sources:sources.map(({id,title,url,text,excerpts,extent})=>({id,title,url,text,excerpts,extent}))},raw=>{
    const value=validateResearch([{...node,kind:'reading'}],sources,raw).selections[0];
    if(value.sourceIds.length>2) throw new Error('最多推荐两篇论文');
    return value;
  });
  // Only adopt recommendations with real quoted evidence. An empty or failed
  // refresh cannot erase a previous useful result.
  if(selected.sourceIds.length) {
    for(const source of sources.filter(s=>selected.sourceIds.includes(s.id))) {
      const index=job.sources.findIndex(s=>s.id===source.id);
      if(index<0) { const {excerpts,...saved}=source; job.sources.push(saved); }
      else if(!job.sources[index].asset) { const {excerpts,...saved}=source; job.sources[index]=saved; }
      else {
        const old=job.sources[index];
        job.sources[index]={...old,title:source.title,arxivId:source.arxivId,authors:source.authors,attribution:source.attribution,
          text:old.text.includes(source.text) ? old.text : `${old.text}\n\n[arXiv 官方摘要]\n${source.text}`};
      }
    }
    state.selection=selected; state.status='complete'; state.stage='论文已找到，可以直接导入';
  } else { state.status='empty'; state.stage='暂未匹配到合适论文'; state.error=selected.explanation; }
  state.checkedAt=Date.now(); await runner.persist(job,{type:'papers-finished',branchId,nodeId,accepted:!!selected.sourceIds.length});
}
