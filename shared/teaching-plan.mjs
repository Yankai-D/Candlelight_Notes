import { z } from 'zod';

const text = z.string().trim().min(1).max(1200);
const ids = z.array(z.string().max(100)).max(24);
export const teachingRole = z.enum(['introduce', 'apply', 'deepen']);
export const teachingPlanSchema = z.object({ version: z.literal(1), throughline: text,
  concepts: z.array(z.object({ id: z.string().regex(/^t[1-9]\d{0,2}$/), title: text,
    objective: text, prerequisites: ids, unitIds: ids.min(1),
    placements: z.array(z.object({ section: z.number().int().positive().max(300), role: teachingRole,
      advance: text, difficultPoint: z.string().max(1200), check: text }).strict()).min(1).max(24),
  }).strict()).min(1).max(120),
  examples: z.array(z.object({ id: z.string().regex(/^e[1-9]\d{0,2}$/), title: text, unitIds: ids.min(1),
    uses: z.array(z.object({ section: z.number().int().positive().max(300), conceptIds: ids.min(1), purpose: text }).strict()).min(1).max(24),
  }).strict()).max(60),
}).strict();

export function teachingIssues(plan, sourceIds) {
  if (!plan.teachingPlan) return [];
  const { concepts, examples } = plan.teachingPlan, issues = [], known = new Map(concepts.map(c => [c.id, c]));
  const issue = (path, code, expected) => issues.push({ path: ['teachingPlan', ...path], code, expected });
  const unique = values => new Set(values).size === values.length;
  if (!unique(concepts.map(c => c.id))) issue(['concepts'], 'TEACHING_ID', 'unique concept IDs');
  if (!unique(examples.map(e => e.id))) issue(['examples'], 'TEACHING_ID', 'unique example IDs');
  const first = c => c.placements.find(p => p.role === 'introduce')?.section;
  const sources = (item, path) => {
    if (!unique(item.unitIds) || item.unitIds.some(id => !sourceIds.includes(id))) issue([...path, 'unitIds'], 'TEACHING_SOURCE', sourceIds);
  };
  concepts.forEach((c, i) => {
    const path = ['concepts', i]; sources(c, path);
    if (c.placements.filter(p => p.role === 'introduce').length !== 1 || c.placements.some(p => p.section < first(c)) || !unique(c.placements.map(p => p.section)))
      issue([...path, 'placements'], 'TEACHING_ORDER', 'one first introduction; later applications/deepening have distinct sections');
    if (c.placements.some(p => p.section > plan.sections.length)) issue([...path, 'placements'], 'TEACHING_SECTION', plan.sections.length);
    const introduction = plan.sections[first(c) - 1];
    if (introduction && !c.unitIds.some(id => introduction.unitIds.includes(id)))
      issue([...path, 'unitIds'], 'TEACHING_INTRO_SOURCE', { section:first(c), rule:'assign an actual supporting source unit to the introduction' });
    if (!unique(c.prerequisites) || c.prerequisites.some(id => !known.has(id) || id === c.id || first(known.get(id)) > first(c)))
      issue([...path, 'prerequisites'], 'TEACHING_PREREQUISITE', 'existing prerequisites introduced no later than this concept');
  });
  const active = new Set(), done = new Set();
  const visit = id => {
    if (active.has(id)) { issue(['concepts'], 'TEACHING_CYCLE', `remove prerequisite cycle at ${id}`); return; }
    if (done.has(id) || !known.has(id)) return;
    active.add(id); for (const parent of known.get(id).prerequisites) visit(parent); active.delete(id); done.add(id);
  };
  concepts.forEach(c => visit(c.id));
  for (let n = 1; n <= plan.sections.length; n++) if (!concepts.some(c => c.placements.some(p => p.section === n)))
    issue(['concepts'], 'TEACHING_RESPONSIBILITY', `section ${n} needs an explicit learning responsibility`);
  examples.forEach((e, i) => {
    sources(e, ['examples', i]);
    if (!unique(e.uses.map(u => u.section))) issue(['examples', i, 'uses'], 'TEACHING_EXAMPLE_USE', 'one purpose per section; combine uses within that section');
    e.uses.forEach((use, j) => {
      if (use.section > plan.sections.length || !unique(use.conceptIds) || use.conceptIds.some(id => !known.get(id)?.placements.some(p => p.section === use.section)))
        issue(['examples', i, 'uses', j], 'TEACHING_EXAMPLE_BINDING', 'actual concept taught/applied in this section');
      if (plan.sections[use.section - 1] && !e.unitIds.some(id => plan.sections[use.section - 1].unitIds.includes(id)))
        issue(['examples', i, 'uses', j], 'TEACHING_EXAMPLE_SOURCE', { section:use.section, unitIds:e.unitIds, rule:'assign the example source so writing can verify its data; prior notes are not source evidence' });
    });
  });
  return issues;
}

// Local change detection only, not an authenticity or correctness proof.
export function teachingKey(value) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const text = JSON.stringify(canonical(value)); let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489917); }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
export const teachingRecordSchema = z.object({ version: z.literal(1), planKey: z.string().max(100),
  entries: z.array(z.object({ kind: z.enum(['concept', 'example']), id: z.string().max(100),
    blocks: z.array(z.object({ id: z.string().max(100), key: z.string().max(100) }).strict()).min(1).max(3000),
  }).strict()).max(180),
}).strict();
export const teachingBlockFields = { teachingConceptIds: ids.optional(), teachingExampleIds: ids.optional() };
const nodeText = node => node.type === 'math' ? `${node.attrs?.display ? '\\[' : '\\('}${node.attrs?.latex || ''}${node.attrs?.display ? '\\]' : '\\)'}`
  : node.text || (node.content || []).map(nodeText).join(' ');
export const teachingBlockKey = node => teachingKey({ text: nodeText(node), sourcePages: node.attrs?.sourcePages || [] });

export function teachingAssignment(plan, section) {
  if (!plan) return undefined;
  return { throughline: plan.throughline,
    concepts: plan.concepts.flatMap(c => c.placements.filter(p => p.section === section).map(p => ({ id: c.id, title: c.title, objective: c.objective, prerequisites: c.prerequisites, ...p }))),
    examples: plan.examples.flatMap(e => e.uses.filter(u => u.section === section).map(u => ({ id: e.id, title: e.title, unitIds: e.unitIds, ...u }))),
  };
}

export function currentTeaching(request) {
  if (!request.composition || request.learning?.mode !== 'adaptive') return undefined;
  return teachingAssignment(request.taskPlan?.teachingPlan, request.document.chapters.findIndex(c => c.id === request.chapterId) + 1);
}
export function validateTeachingAnalysis(request, analysis) {
  const current = currentTeaching(request), issues = [];
  for (const [index, unit] of (analysis?.synthesis?.units || []).entries()) for (const [field, allowed] of [
    ['conceptIds', current?.concepts.map(c => c.id) || []], ['exampleIds', current?.examples.map(e => e.id) || []]]) {
    if ((unit[field] || []).some(id => !allowed.includes(id)) || new Set(unit[field]).size !== (unit[field]?.length || 0))
      issues.push({ path: ['synthesis','units',index,field], code:'TEACHING_BINDING', expected:allowed });
  }
  if (issues.length) throw Object.assign(new Error('章节分析的教学定位不属于本章已保存的安排。'), { code:'STAGE_CONTRACT', issues });
}

export function bindTeachingBlocks(request, result) {
  const current = currentTeaching(request), units = request.chapterAnalysis?.synthesis?.units;
  const issues = [];
  for (const [index, block] of result.blocks.entries()) {
    const unit = units?.find(u => u.id === block.learningUnitId);
    for (const [field, source, allowed] of [['teachingConceptIds', 'conceptIds', current?.concepts.map(c => c.id) || []], ['teachingExampleIds', 'exampleIds', current?.examples.map(e => e.id) || []]]) {
      if (unit?.[source]) block[field] = source === 'exampleIds' && ![...(block.learningRoles || []), block.learningRole].some(role => ['example','variant'].includes(role)) ? [] : [...unit[source]];
      if ((block[field] || []).some(id => !allowed.includes(id)) || new Set(block[field]).size !== (block[field]?.length || 0))
        issues.push({ path:['blocks',index,field], code:'TEACHING_BINDING', expected:allowed });
    }
  }
  if (issues.length) throw Object.assign(new Error('正文教学定位不属于当前章节。'), { code:'STAGE_CONTRACT', issues });
}

// A record points to prose, not a model's unverified claim of completion.
// Renderer expansion is supplied by the caller, so markdown remains identical.
export function makeTeachingRecord(plan, blocks, renderedNodes, expand) {
  if (!plan) return undefined;
  const entries = new Map(); let offset = 0;
  for (const block of blocks) {
    const count = expand(block).length, nodes = renderedNodes.slice(offset, offset + count); offset += count;
    for (const [kind, field] of [['concept','teachingConceptIds'],['example','teachingExampleIds']]) for (const id of block[field] || []) {
      const key = `${kind}:${id}`, entry = entries.get(key) || { kind, id, blocks:[] };
      for (const node of nodes) if (node.type !== 'heading' && node.attrs?.id && nodeText(node).trim())
        entry.blocks.push({ id:node.attrs.id, key:teachingBlockKey(node) });
      if (entry.blocks.length) entries.set(key, entry);
    }
  }
  return teachingRecordSchema.parse({version:1,planKey:teachingKey(plan),entries:[...entries.values()]});
}

// Rebuild from actual current prose on every request. Plans and stale records
// never establish that a reader has learned a concept or that a claim is true.
export function teachingContext(plan, chapters, section) {
  if (!plan) return undefined;
  const current = teachingAssignment(plan, section), relevant = new Set(current.concepts.map(c => c.id));
  const add = id => { const c = plan.concepts.find(c => c.id === id); for (const parent of c?.prerequisites || []) if (!relevant.has(parent)) { relevant.add(parent); add(parent); } };
  [...relevant].forEach(add);
  const exampleIds = new Set(current.examples.map(e => e.id)), key = teachingKey(plan);
  let remaining = 16000;
  const prior = [], evidence = [], evidenceById = new Map();
  for (const [i, chapter] of chapters.entries()) {
    if (i + 1 >= section) break;
    const assigned = teachingAssignment(plan, i + 1);
    const nodes = new Map((chapter.content.content || []).map(n => [n.attrs?.id, n]));
    for (const [kind, items, included] of [['concept', assigned.concepts, relevant], ['example', assigned.examples, exampleIds]]) for (const item of items) {
      if (!included.has(item.id)) continue;
      const saved = chapter.teachingRecord, entry = saved?.entries.find(e => e.kind === kind && e.id === item.id);
      const bound = saved?.planKey === key ? entry?.blocks || [] : [];
      const live = bound.filter(b => nodes.has(b.id) && teachingBlockKey(nodes.get(b.id)) === b.key);
      const present = bound.filter(b => nodes.has(b.id));
      const status = !nodeText(chapter.content).trim() ? 'not-written' : !entry ? 'untracked' : saved?.planKey !== key || live.length !== bound.length ? 'changed' : 'written';
      const evidenceIds = [];
      for (const block of present) {
        if (evidenceIds.length >= 4) break;
        const id = `${chapter.id}:${block.id}`;
        if (!evidenceById.has(id)) {
          if (remaining <= 0) continue;
          const text = nodeText(nodes.get(block.id)), excerpt = text.slice(0, Math.min(1200, remaining)); remaining -= excerpt.length;
          const item = { id, chapterId:chapter.id, blockId:block.id, text:excerpt, excerpted:excerpt.length < text.length,
            edited:teachingBlockKey(nodes.get(block.id)) !== block.key };
          evidenceById.set(id,item); evidence.push(item);
        }
        evidenceIds.push(id);
      }
      prior.push({ kind, id: item.id, chapterId: chapter.id, section: i + 1, title: chapter.title,
        ...(kind === 'concept' ? { role: item.role, advance: item.advance } : { purpose: item.purpose }), status, evidenceIds,
        ...(bound.length > evidenceIds.length ? { omittedBlocks: bound.length - evidenceIds.length } : {}) });
    }
  }
  return { ...current, prior, evidence, future: plan.concepts.filter(c => relevant.has(c.id)).flatMap(c => c.placements.filter(p => p.section > section).map(p => ({ id: c.id, section:p.section, role:p.role, advance:p.advance }))),
    rule: 'role/advance/check 是本次教学分工，不是已完成事实；prior 的 written 只表示带定位的正文仍存在，不证明正确或用户掌握。changed/untracked/not-written 不得假定已讲清。evidenceIds 指向去重的当前笔记摘录，edited 表示已修改；它们是有限写作上下文，不是原文证据。不要用规划替代缺失正文。允许同一例题承担新的应用与推理，禁止只换措辞重复；必要回顾按任务决定长度。' };
}

export const teachingPlanPrompt = `教学安排 teaching-plan-v1：在同一次章节规划返回 teachingPlan:{version:1,throughline,concepts,examples}。throughline 说明全篇要解决的核心问题及推进关系。concepts 每项给唯一 t 编号、title、objective（能解释/判断/构造/求解什么）、prerequisites（实际 t 编号，无则 []）、unitIds（来源单元）、placements。每个 placement 给 section、role:introduce|apply|deepen、advance（本次新增的理解或应用）、difficultPoint（真正要展开的卡点，无则空字符串）、check（能否独立完成的具体判据，不要求额外出试卷）。先有一次 introduce，之后允许 apply/deepen；同章需要的前提可在章内先讲。每章有职责，不能把同一段定义换词重讲。
examples 只选有教学价值的代表来源题，给唯一 e 编号、title、unitIds、uses:[{section,conceptIds,purpose}]，没有则 []。同例可反复应用，但每次 purpose 说明新的推理任务；每次使用的章节都分配至少一个该例来源 unit，首次解释概念的章节也分配实际支持它的 unit，写作才能核对原文。显式贯穿例题可在三章以上复用来源，但不能无理由重复全部资料。题干、数据与条件以原文为准，索引不足不编造。规划只规定分工，后续必须检查实际正文；不以章节数、字数或固定栏目作为质量判据。用户目标决定是否另设全题解或自测，不自动增加任务。`;
