import { z } from 'zod';
import { noteBlocks } from './note-format.mjs';

export const IDEAL_PROTOCOL = 'ideal-tree-v1';
export const IDEAL_PROMPTS = '2026-10-18.1';
const short = z.string().trim().min(1).max(160);
const prose = z.string().trim().min(1).max(8000);
const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,49}$/);
export const idealInputSchema = z.object({
  goal: z.string().trim().min(4).max(12000),
  profile: z.object({ background: z.string().max(6000), foundations: z.array(z.string().max(300)).max(100) }),
  library: z.array(z.object({ id: z.string().min(1).max(120), title: short,
    excerpts: z.array(z.object({ page: z.number().int().positive(), text: z.string().max(1600) })).max(3),
    chapters: z.array(z.object({ id: z.string().max(120), title: z.string().max(400) })).max(300),
  }).strict()).max(250),
}).strict();
export const idealCommandSchema = z.discriminatedUnion('command', [
  z.object({ action: z.literal('ideal-tree'), command: z.literal('create'), input: idealInputSchema, requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('ideal-tree'), command: z.literal('rebuild'), id: z.string().uuid(), revision: z.number().int().nonnegative(),
    requestId: z.string().uuid(), suggestion: z.string().trim().min(4).max(6000), reason: z.string().trim().min(4).max(3000), includeReview: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('ideal-tree'), command: z.literal('list') }).strict(),
  z.object({ action: z.literal('ideal-tree'), command: z.literal('delete'), id: z.string().uuid(), confirm: z.literal(true) }).strict(),
  ...['get', 'pause', 'resume', 'export'].map(command => z.object({ action: z.literal('ideal-tree'), command: z.literal(command), id: z.string().uuid() }).strict()),
  z.object({ action: z.literal('ideal-tree'), command: z.literal('resource'), id: z.string().uuid(), sourceId: z.string().max(120) }).strict(),
  z.object({ action: z.literal('ideal-tree'), command: z.literal('papers'), id: z.string().uuid(), branchId: ref, nodeId: ref, refresh: z.boolean().default(false) }).strict(),
]);
export const contractSchema = z.object({ title: short, summary: prose,
  capacity: z.object({ branches: z.number().int().min(1).max(16), nodesPerBranch: z.number().int().min(2).max(40) }).strict(),
  requirements: z.array(z.object({ id: ref, label: short, outcome: prose }).strict()).min(1).max(20),
  assumptions: z.array(z.string().max(1000)).max(12), excluded: z.array(z.string().max(1000)).max(12),
  researchQueries: z.array(z.string().trim().min(2).max(200)).min(1).max(3),
}).strict();
export const skeletonSchema = z.object({ branches: z.array(z.object({
  id: ref, title: short, purpose: prose, requirementIds: z.array(ref).min(1).max(20),
  dependsOn: z.array(ref).max(20),
}).strict()).min(1).max(16) }).strict();
export const branchSchema = z.object({ branchId: ref, nodes: z.array(z.object({
  id: ref, parentId: ref.nullable(), kind: z.enum(['knowledge', 'reading', 'practice', 'experience']),
  title: short, body: prose, outcome: z.string().trim().min(8).max(2000),
  requirementIds: z.array(ref).min(1).max(20), dependsOn: z.array(ref).max(30),
  priority: z.enum(['core', 'extension']),
  // These fields are operational inputs. Presentation uses body, not a form.
  deliverable: z.string().max(2000).default(''), feedback: z.string().max(2000).default(''),
  queries: z.array(z.string().trim().min(2).max(200)).max(2).default([]),
  urls: z.array(z.url().refine(s => s.startsWith('https://'))).max(2).default([]),
}).strict()).min(2).max(40) }).strict();
export const researchSelectionSchema = z.object({ selections: z.array(z.object({
  nodeId: ref, sourceIds: z.array(z.string().max(120)).max(3),
  explanation: z.string().trim().min(1).max(1800),
  evidence: z.array(z.union([
    z.object({ sourceId: z.string().max(120), excerptId: ref }).strict(),
    z.object({ sourceId: z.string().max(120), quote: z.string().min(12).max(500) }).strict(),
  ])).max(3),
}).strict()).max(40) }).strict();
export const researchPlanSchema = z.object({ plans: z.array(z.object({ nodeId: ref,
  queries: z.array(z.string().trim().min(2).max(200)).max(2),
  urls: z.array(z.url().refine(s => s.startsWith('https:'))).max(3),
}).strict()).max(40) }).strict();
const cleanupSchema = z.object({ updates: z.array(z.object({ id: ref, title: short, body: prose,
  outcome: z.string().min(8).max(2000), deliverable: z.string().max(2000), feedback: z.string().max(2000),
  queries: z.array(z.string().min(2).max(200)).max(2), urls: z.array(z.url().refine(s => s.startsWith('https:'))).max(2),
}).strict()).max(40) }).strict();
export const reviewSchema = z.object({ issues: z.array(z.object({
  branchId: ref, nodeId: ref.nullable(), severity: z.enum(['important', 'suggestion']),
  problem: z.string().trim().min(10).max(1600), repair: z.string().trim().min(10).max(1600),
}).strict()).max(30), summary: prose }).strict();

export function parseIdeal(schema, raw) {
  try { return schema.parse(typeof raw === 'string' ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')) : raw); }
  catch (error) { throw new Error(error instanceof z.ZodError ? error.issues.slice(0, 8).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : '返回内容不是完整 JSON'); }
}
export function unique(items, label) {
  if (new Set(items).size !== items.length) throw new Error(`${label}重复`);
}
export function acyclic(items, edges, label) {
  const byId = new Map(items.map(item => [item.id, item])), done = new Set(), path = new Set();
  function visit(id) {
    if (!byId.has(id)) throw new Error(`${label}引用了不存在的 ${id}`);
    if (path.has(id)) throw new Error(`${label}存在循环：${id}`);
    if (done.has(id)) return;
    path.add(id); edges(byId.get(id)).forEach(visit); path.delete(id); done.add(id);
  }
  items.forEach(item => visit(item.id));
}
export function validateContract(raw) {
  const value = parseIdeal(contractSchema, raw); unique(value.requirements.map(r => r.id), '目标编号'); return value;
}
export function validateSkeleton(contract, raw) {
  const value = parseIdeal(skeletonSchema, raw); unique(value.branches.map(b => b.id), '分支编号');
  if (value.branches.length > contract.capacity.branches) throw new Error(`branches 数量超过目标约定的 ${contract.capacity.branches} 条上限，请合并相近分工并保留全部目标覆盖`);
  const ids = new Set(contract.requirements.map(r => r.id)), covered = new Set();
  for (const branch of value.branches) for (const id of branch.requirementIds) {
    if (!ids.has(id)) throw new Error(`分支 ${branch.id} 引用了未知目标 ${id}`); covered.add(id);
  }
  if ([...ids].some(id => !covered.has(id))) throw new Error('全局骨架遗漏目标');
  acyclic(value.branches, b => b.dependsOn, '分支先修'); return value;
}
export function validateBranch(contract, skeleton, branchId, raw) {
  const value = parseIdeal(branchSchema, raw), branch = skeleton.branches.find(b => b.id === branchId);
  if (!branch || value.branchId !== branchId) throw new Error('结果不属于当前分支');
  if (value.nodes.length > contract.capacity.nodesPerBranch) throw new Error(`nodes 数量超过目标约定的 ${contract.capacity.nodesPerBranch} 个上限，请保留有意义的完整学习单元`);
  unique(value.nodes.map(n => n.id), '节点编号'); unique(value.nodes.map(n => n.title.toLowerCase()), '节点标题');
  acyclic(value.nodes, n => n.parentId ? [n.parentId] : [], '父子关系');
  acyclic(value.nodes, n => n.dependsOn, '节点先修');
  const covered = new Set();
  for (const node of value.nodes) {
    for (const id of node.requirementIds) {
      if (!branch.requirementIds.includes(id)) throw new Error(`节点 ${node.id} 越过分支目标范围`); covered.add(id);
    }
    if (node.parentId && value.nodes.find(n => n.id === node.parentId)?.kind !== 'knowledge') throw new Error('阅读和实践应为叶节点');
    if (['practice', 'experience'].includes(node.kind) && (!node.deliverable.trim() || !node.feedback.trim())) throw new Error(`nodes.${value.nodes.indexOf(node)}（${node.id}）必须填非空 deliverable 和 feedback 字段：deliverable 写具体成果，feedback 写核对或取得反馈的方法；不能只写进 body`);
    if (node.kind === 'reading' && !node.queries.length && !node.urls.length) throw new Error(`阅读节点 ${node.id} 缺少研究任务`);
    // All note surfaces share this compiler. Raw HTML is never a rendering path.
    noteBlocks(node.body, {}, { strict: true });
  }
  if (branch.requirementIds.some(id => !covered.has(id))) throw new Error('分支展开遗漏了约定目标');
  return value;
}
// Deterministic traceability, not a semantic score or a claim of mastery.
export function learningPathReport(job) {
  const errors = [], branches = job.skeleton?.branches || [];
  try {
    validateContract(job.contract); validateSkeleton(job.contract, job.skeleton);
    for (const branch of branches) validateBranch(job.contract, job.skeleton, branch.id, job.branches[branch.id]);
    if (Object.keys(job.branches).some(id => !branches.some(b => b.id === id))) throw new Error('存在未纳入骨架的分支');
  } catch (error) { errors.push(error.message); }
  if (errors.length) return { version:1, status:'invalid', errors, semanticQuality:'not_verified', branchOrder:[], requirements:[] };
  const order = [], pending = [...branches];
  while (pending.length) {
    const i = pending.findIndex(b => b.dependsOn.every(id => order.includes(id)));
    if (i < 0) break;
    order.push(pending.splice(i, 1)[0].id);
  }
  return { version: 1, status: errors.length ? 'invalid' : 'checked', errors,
    semanticQuality: 'not_verified', branchOrder: order,
    requirements: (job.contract?.requirements || []).map(requirement => ({ ...requirement,
      tasks: branches.flatMap(branch => (job.branches[branch.id]?.nodes || []).filter(n => n.requirementIds?.includes(requirement.id)).map(n => ({
        branchId: branch.id, branchTitle: branch.title, nodeId: n.id, title: n.title, kind: n.kind, outcome: n.outcome,
        deliverable: n.deliverable, feedback: n.feedback,
      }))),
    })),
  };
}
const normalize = s => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export function idealSourceIdentity(raw) {
  try {
    const url=new URL(raw);
    if (/^(?:www\.|export\.)?arxiv\.org$/i.test(url.hostname)) {
      const id=url.pathname.match(/^\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+\/\d{7}))(?:v\d+)?(?:\.pdf)?$/i)?.[1];
      if(id) return `arxiv:${id.toLowerCase()}`;
    }
  } catch { /* Local resources can have no URL. */ }
  return '';
}
// Sources belong to a learning task, not to every node in its branch. Reuse
// only explicit parent/prerequisite links, preserving each recommendation's scope.
export function idealNodeResources(job, branchId, nodeId) {
  const nodes = job.branches[branchId]?.nodes || [], node = nodes.find(n => n.id === nodeId);
  if (!node) return [];
  const related = node.kind === 'knowledge' ? nodes.filter(n => n.kind === 'reading' &&
    (n.parentId === nodeId || n.dependsOn.includes(nodeId) || node.dependsOn.includes(n.id))) : [];
  const selections = [job.paperResearch?.[branchId]?.[nodeId]?.selection,
    job.research[branchId]?.selections.find(s => s.nodeId === nodeId),
    ...related.map(n => job.research[branchId]?.selections.find(s => s.nodeId === n.id))].filter(Boolean);
  const seen = new Set(), resources = [];
  for (const selection of selections) for (const sourceId of selection.sourceIds) {
    const source=job.sources.find(s=>s.id===sourceId), identity=idealSourceIdentity(source?.url) || sourceId;
    if (seen.has(identity) || !source) continue;
    seen.add(identity);
    resources.push({ sourceId, explanation: selection.explanation,
      quote: selection.evidence.find(e => e.sourceId === sourceId)?.quote || '',
      viaTitle: selection.nodeId === nodeId ? '' : nodes.find(n => n.id === selection.nodeId)?.title || '' });
  }
  return resources;
}
export function validateResearch(nodes, sources, raw) {
  const value = parseIdeal(researchSelectionSchema, raw), reading = nodes.filter(n => n.kind === 'reading');
  unique(value.selections.map(s => s.nodeId), '资料选择');
  if (value.selections.length !== reading.length || value.selections.some(s => !reading.some(n => n.id === s.nodeId))) throw new Error('资料选择遗漏或新增阅读节点');
  for (const selection of value.selections) {
    unique(selection.sourceIds, '选定来源'); unique(selection.evidence.map(e => e.sourceId), '来源依据');
    if (selection.sourceIds.length !== selection.evidence.length) throw new Error('每份选定资料必须有核对依据');
    for (const id of selection.sourceIds) {
      const source = sources.find(s => s.id === id), evidence = selection.evidence.find(e => e.sourceId === id);
      if (!source || !evidence || !['body', 'abstract', 'local'].includes(source.level)) throw new Error('不能采用未经阅读核实的资料');
      if (evidence.excerptId) {
        const excerpt = source.excerpts?.find(e => e.id === evidence.excerptId);
        if (!excerpt) throw new Error(`资料 ${id} 引用了未知摘录 ${evidence.excerptId}`);
        evidence.quote = excerpt.quote; delete evidence.excerptId;
      }
      if (!normalize(source.text).includes(normalize(evidence.quote))) throw new Error(`资料 ${id} 的依据不在读取内容中`);
    }
  }
  return value;
}
export function validateResearchPlan(nodes, raw) {
  const value = parseIdeal(researchPlanSchema, raw);
  unique(value.plans.map(p => p.nodeId), '补查节点');
  if (value.plans.some(p => !nodes.some(n => n.id === p.nodeId))) throw new Error('补查计划超出当前阅读节点');
  return value;
}
export function salvageResearch(nodes, sources, raw) {
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }
  return { selections: nodes.filter(n => n.kind === 'reading').map(node => {
    const candidates = data.selections?.filter?.(s => s.nodeId === node.id);
    try {
      if (candidates?.length !== 1) throw new Error('missing');
      return validateResearch([node], sources, { selections: candidates }).selections[0];
    } catch { return { nodeId:node.id, sourceIds:[], evidence:[], explanation:'这次资料匹配未能建立有效引用，已保留学习内容；可单独补查阅读资料。' }; }
  }) };
}
export function validateCleanup(job, branch, nodes, raw) {
  const proposed = parseIdeal(z.object({updates:z.array(z.record(z.string(),z.unknown())).max(40)}).strict(),raw).updates;
  unique(proposed.map(n=>n.id),'修订节点');
  if (proposed.some(n=>!branch.nodes.some(original=>original.id===n.id))) throw new Error('修订引用了不存在的节点');
  const keys=['id','title','body','outcome','deliverable','feedback','queries','urls'];
  // Models sometimes echo the enclosing branch or immutable fields. Compile
  // only the requested IDs and editable fields; no unrelated change can land.
  const { updates } = parseIdeal(cleanupSchema,{updates:proposed.filter(n=>nodes.some(original=>original.id===n.id)).map(n=>Object.fromEntries(keys.map(key=>[key,n[key]])))});
  const missing=nodes.filter(n=>!updates.some(update=>update.id===n.id)).map(n=>n.id);
  if (missing.length) throw new Error(`修订只能覆盖指定节点；遗漏 ${missing.join(', ')}。必须返回这些编号的完整更新字段。`);
  return validateBranch(job.contract, job.skeleton, branch.branchId, { ...branch,
    nodes: branch.nodes.map(n => ({ ...n, ...updates.find(update => update.id === n.id) })),
  });
}
export function validateReview(job, raw) {
  const value = parseIdeal(reviewSchema, raw);
  for (const issue of value.issues) {
    if (!job.skeleton.branches.some(b => b.id === issue.branchId)) throw new Error('审查引用了未知分支');
    if (issue.nodeId && !job.branches[issue.branchId]?.nodes.some(n => n.id === issue.nodeId)) throw new Error('审查引用了未知节点');
  }
  return value;
}
export function idealInput(goal, profile, documents) {
  return idealInputSchema.parse({ goal, profile: { background: profile.background, foundations: profile.foundations },
    library: documents.slice(0, 250).map(d => ({ id: d.id, title: d.title.slice(0, 160),
      excerpts: [...new Set([0, Math.floor(d.pages.length / 2), d.pages.length - 1])].filter(i => i >= 0).map(i => ({ page: d.pages[i].number, text: d.pages[i].text.slice(0, 1600) })),
      chapters: d.chapters.map(c => ({ id: c.id, title: c.title })),
    })),
  });
}
