import { readFile } from 'node:fs/promises';
import { validateContract, validateSkeleton, validateBranch, validateResearch } from '../shared/ideal-tree.mjs';

// Offline artifact checks. No model calls and no automatic semantic score.
// A passed schema or coverage tag is not proof of educational correctness.
export function evaluateIdealArtifact(job) {
  const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, status: 'pass' }); } catch (e) { checks.push({ name, status: 'fail', detail: e.message }); } };
  check('目标约定', () => validateContract(job.contract));
  check('骨架覆盖与先修', () => validateSkeleton(job.contract,job.skeleton));
  for (const branch of job.skeleton?.branches || []) check(`分支结构:${branch.id}`, () => validateBranch(job.contract,job.skeleton,branch.id,job.branches[branch.id]));
  const completeSources = job.sources.every(s => typeof s.text === 'string');
  for (const [id,result] of Object.entries(job.research)) {
    if (completeSources) check(`资料引文:${id}`, () => validateResearch(job.branches[id].nodes,job.sources,{ selections:result.selections }));
    else checks.push({ name:`资料引文:${id}`,status:'not_evaluated',detail:'公开导出未包含来源正文，请使用本机内部构建记录核对。' });
  }
  const nodes = Object.values(job.branches).flatMap(b => b.nodes), references = Object.values(job.research).flatMap(r => r.selections);
  return { protocol:job.protocol,promptVersion:job.promptVersion,model:job.model,status:job.status,
    counts:{branches:Object.keys(job.branches).length,nodes:nodes.length,reading:nodes.filter(n=>n.kind==='reading').length,
      practice:nodes.filter(n=>['practice','experience'].includes(n.kind)).length,unresolvedReadings:references.filter(r=>!r.sourceIds.length).length,
      importantReviewIssues:job.issues.filter(i=>i.severity==='important').length},
    metrics:job.metrics,checks,
    humanReview:{ status:'required',criteria:['目标是否被实质覆盖，而非只有标签','先修关系与学习粒度是否合理','引文是否支持推荐主张，而非仅文字相同','实践成果是否检验对应能力','整体范围和内容质量是否符合用户描述'] },
  };
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/evaluate-ideal-tree.mjs')) {
  if (!process.argv[2]) throw new Error('用法：node scripts/evaluate-ideal-tree.mjs <构建记录.json>');
  const report = evaluateIdealArtifact(JSON.parse(await readFile(process.argv[2],'utf8')));
  console.log(JSON.stringify(report,null,2));
  if (report.checks.some(c => c.status==='fail')) process.exitCode=1;
}
