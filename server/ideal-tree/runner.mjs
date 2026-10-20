import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { atomicWrite } from '../atomic-file.mjs';
import { recoveryDecision, recordRecovery } from '../recovery.mjs';
import { executionScope, runStage } from '../execution.mjs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const { IDEAL_PROTOCOL, IDEAL_PROMPTS, idealInputSchema, idealCommandSchema, learningPathReport, validateContract, validateSkeleton, validateBranch, validateResearch, validateResearchPlan, salvageResearch, validateCleanup, validateReview } = await import(new URL(`../../shared/ideal-tree.mjs${new URL(import.meta.url).search}`, import.meta.url));
const { idealMessages } = await import(new URL(`./prompts.mjs${new URL(import.meta.url).search}`, import.meta.url));
const { createResearchTools, localSources, sourceContext, evidenceExcerpts } = await import(new URL(`./research.mjs${new URL(import.meta.url).search}`, import.meta.url));
const { findNodePapers } = await import(new URL(`./node-papers.mjs${new URL(import.meta.url).search}`, import.meta.url));
const { arxivId } = await import(new URL(`./arxiv.mjs${new URL(import.meta.url).search}`, import.meta.url));

export class IdealStore {
  constructor(directory, write = atomicWrite) { this.directory = resolve(directory); this.writes = Promise.resolve(); this.write = write; }
  path(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的学习树编号'); return join(this.directory, `${id}.json`); }
  async read(id) {
    // Windows can deny rename while the old file has a reader. Serialize reads
    // with atomic replacements too, so polling never races a checkpoint.
    const operation = this.writes.catch(() => {}).then(async () => JSON.parse(await readFile(this.path(id), 'utf8')));
    this.writes = operation; return operation;
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(f => /^[a-f0-9-]{36}\.json$/.test(f));
    return (await Promise.all(files.map(async f => { try { return await this.read(f.slice(0,-5)); } catch { return null; } }))).filter(Boolean).sort((a,b) => b.createdAt - a.createdAt);
  }
  async save(job) {
    const snapshot = JSON.stringify(job), path = this.path(job.id);
    const write = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true }); await this.write(path, snapshot);
    });
    this.writes = write; return write;
  }
  async remove(id) {
    const path = this.path(id);
    const operation = this.writes.catch(() => {}).then(() => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }));
    this.writes = operation; return operation;
  }
}
export function publicJob(job) {
  const { input, sources, orientation, execution, ...rest } = job;
  return { ...rest, ...(job.status === 'review' ? { status: 'complete', stage: '学习路径构建完成' } : {}),
    pathReport: job.pathReport || (['complete','review'].includes(job.status) ? learningPathReport(job) : undefined),
    goal: input.goal, profile: input.profile, sources: sources.map(({ text, asset, ...source }) => ({ ...source, ...(arxivId(source.url || '') ? {arxivId:arxivId(source.url)} : {}), importable: !!asset })),
    orientation: (orientation || []).map(({ text, asset, ...source }) => source) };
}
const summary = job => ({ id: job.id, title: job.contract?.title || job.input.goal.slice(0, 80), edition: job.edition || 1,
  status: job.status === 'review' ? 'complete' : job.status, stage: job.status === 'review' ? '学习路径构建完成' : job.stage,
  createdAt: job.createdAt, updatedAt: job.updatedAt, nodes: Object.values(job.branches).reduce((n,b) => n + b.nodes.length, 0) });
const compactBranch = branch => branch ? { branchId: branch.branchId, nodes: branch.nodes.map(n => ({ id: n.id, title: n.title, kind: n.kind, parentId: n.parentId, dependsOn: n.dependsOn, requirementIds: n.requirementIds, outcome: n.outcome, body: n.body.slice(0,1400), deliverable: n.deliverable, feedback: n.feedback })) } : undefined;

export class IdealRunner {
  constructor({ directory = '.local-ideal-trees', store, tools, maxCalls = 160, retryDelay = 1500 } = {}) {
    this.store = store || new IdealStore(directory); this.tools = tools || createResearchTools(this.store.directory);
    this.active = new Map(); this.paperActive = new Map(); this.control = Promise.resolve(); this.maxCalls = maxCalls; this.retryDelay = retryDelay;
  }
  command(request, complete, model) {
    const action = this.control.catch(() => {}).then(() => this.dispatch(request, complete, model));
    this.control = action; return action;
  }
  async recover(job) {
    if (job.status === 'running' && !this.active.has(job.id)) {
      job.status = 'paused'; job.error = '服务曾中断，已保存的分支可继续构建。'; await this.store.save(job);
    }
    if (!this.paperActive.has(job.id)) {
      let changed=false;
      for (const branch of Object.values(job.paperResearch || {})) for(const state of Object.values(branch)) if(state.status==='running') {
        state.status='failed'; state.error='论文查找曾中断，已保留原资料，可以重新查找。'; changed=true;
      }
      if(changed) await this.store.save(job);
    }
    return job;
  }
  async dispatch(request, complete, model) {
    if (request.command === 'delete') {
      request = idealCommandSchema.parse({ ...request, action: 'ideal-tree' });
      // Stop both writers and wait for their final checkpoint before removal.
      // Research assets are shared; imported documents belong to the library.
      for (const tasks of [this.active, this.paperActive]) {
        const task = tasks.get(request.id);
        if (task) { task.controller.abort(); await task.promise; }
      }
      await this.store.remove(request.id);
      return { deletedId: request.id };
    }
    if (request.command === 'list') return { trees: await Promise.all((await this.store.list()).map(async j => summary(await this.recover(j)))) };
    if (request.command === 'create') {
      const previous = (await this.store.list()).find(j => j.requestId === request.requestId);
      if (previous) {
        if (previous.rebuild || JSON.stringify(previous.input) !== JSON.stringify(idealInputSchema.parse(request.input))) throw new Error('请求编号已用于不同的构建，请重新提交。');
        return { job: publicJob(await this.recover(previous)) };
      }
      if (this.active.size || this.paperActive.size) throw new Error('已有学习树任务正在进行，请先暂停它或等待完成。');
      const now = Date.now(), job = { protocol: IDEAL_PROTOCOL, promptVersion: IDEAL_PROMPTS, id: randomUUID(), requestId: request.requestId,
        input: idealInputSchema.parse(request.input), model, createdAt: now, updatedAt: now, status: 'paused', stage: '准备目标',
        branches: {}, research: {}, sources: [], orientation: [], events: [], metrics: { modelCalls: 0, completionTokens: 0, toolCalls: 0, repairs: 0 },
        reviewRound: 0, repairDone: [], repairDrafts: [], issues: [], revision: 0, edition: 1 };
      await this.store.save(job); this.start(job, complete); return { job: publicJob(job) };
    }
    if (request.command === 'rebuild') {
      request = idealCommandSchema.parse({ ...request, action: 'ideal-tree' });
      const { id, revision, suggestion, reason, includeReview } = request;
      const previous = (await this.store.list()).find(j => j.requestId === request.requestId);
      if (previous) {
        const r = previous.rebuild;
        if (!r || r.sourceId !== id || r.sourceRevision !== revision || r.suggestion !== suggestion || r.reason !== reason || r.includeReview !== includeReview) throw new Error('请求编号已用于不同的重建，请重新提交。');
        return { job: publicJob(await this.recover(previous)) };
      }
      if (this.active.size || this.paperActive.size) throw new Error('已有学习树任务正在进行，请先暂停它或等待完成。');
      const source = await this.store.read(id);
      if (!['complete','review'].includes(source.status)) throw new Error('请先完成当前构建，再提交重建建议。');
      if (source.revision !== revision) throw new Error('原学习树已更新，请重新打开后再重建。');
      const now = Date.now();
      const job = { protocol: IDEAL_PROTOCOL, promptVersion: IDEAL_PROMPTS, id: randomUUID(), requestId: request.requestId,
        input: structuredClone(source.input), model, createdAt: now, updatedAt: now, status: 'paused', stage: '准备重建',
        edition: (source.edition || 1) + 1, familyId: source.familyId || source.id,
        rebuild: { sourceId: id, sourceRevision: revision, suggestion, reason, includeReview,
          previousContract: structuredClone(source.contract),
          previousOutline: source.skeleton.branches.map(b => ({ ...b, nodes: (source.branches[b.id]?.nodes || []).map(n => ({ id:n.id,title:n.title,kind:n.kind })) })),
          ...(includeReview ? { review: structuredClone(source.review) } : {}),
        },
        branches: {}, research: {}, sources: [], orientation: [], events: [], metrics: { modelCalls: 0, completionTokens: 0, toolCalls: 0, repairs: 0 },
        reviewRound: 0, repairDone: [], repairDrafts: [], issues: [], revision: 0 };
      // A new durable version: failure, cancellation or retries never overwrite the source.
      await this.store.save(job); this.start(job, complete); return { job: publicJob(job) };
    }
    let job;
    try { job = await this.recover(await this.store.read(request.id)); } catch (e) { if (e.code === 'ENOENT') throw new Error('这棵理想学习树不存在'); throw e; }
    if (request.command === 'get') return { job: publicJob(job) };
    if (request.command === 'export') return { artifact: publicJob(job) };
    if (request.command === 'resource') {
      const source = job.sources.find(s => s.id === request.sourceId);
      if (!source) throw new Error('这份资料不属于当前学习树');
      return this.tools.asset(source.asset ? source : arxivId(source.arxivId || source.url || '') && source.level==='abstract' ? await this.tools.paper(source,AbortSignal.timeout(90000)) : source);
    }
    if (request.command === 'papers') {
      const node=job.branches[request.branchId]?.nodes.find(n=>n.id===request.nodeId);
      if(!node || !['knowledge','reading'].includes(node.kind)) throw new Error('请从知识与能力或阅读节点查找论文。');
      if(this.paperActive.has(job.id)) return {job:publicJob(job)};
      const previous=job.paperResearch?.[request.branchId]?.[request.nodeId];
      if(previous?.status==='complete' && !request.refresh) return {job:publicJob(job)};
      if(this.active.size || this.paperActive.size) throw new Error('请先等待当前学习树任务完成，或暂停后再查找论文。');
      job.paperResearch ||= {}; job.paperResearch[request.branchId] ||= {};
      const state={...previous,status:'running',stage:'准备查找论文',error:'',startedAt:Date.now()};
      job.paperResearch[request.branchId][request.nodeId]=state;
      const controller=new AbortController(), entry={controller,promise:null}; this.paperActive.set(job.id,entry);
      await this.persist(job);
      entry.promise=findNodePapers(this,job,request.branchId,request.nodeId,complete,AbortSignal.any([controller.signal,AbortSignal.timeout(240000)]))
        .catch(async error=>{
          state.status='failed'; state.error=controller.signal.aborted ? '论文查找已暂停，已保留原资料。' : error.name==='TimeoutError' ? '论文查找超时，已保留原资料，可以重新查找。' : error.message;
          await this.persist(job,{type:'papers-stopped',branchId:request.branchId,nodeId:request.nodeId,reason:state.error}).catch(()=>{});
        }).finally(()=>this.paperActive.delete(job.id));
      return {job:publicJob(job)};
    }
    if (request.command === 'pause') {
      const active = this.active.get(job.id);
      if (active) { active.controller.abort(); await active.promise; }
      const papers=this.paperActive.get(job.id);
      if(papers) { papers.controller.abort(); await papers.promise; }
      return { job: publicJob(await this.store.read(job.id)) };
    }
    if (request.command === 'resume') {
      if(this.paperActive.size) throw new Error('请先等待论文查找完成，或暂停查找后继续构建。');
      if (this.active.has(job.id)) return { job: publicJob(job) };
      if (this.active.size) throw new Error('请先暂停正在构建的另一棵树。');
      if (['review','complete'].includes(job.status)) {
        if (!job.gaps?.length) return { job: publicJob(job) };
        if (job.protocol !== IDEAL_PROTOCOL) throw new Error('这棵树使用不兼容的协议，请保留结果并新建目标。');
        job.previousResults = [...(job.previousResults || []), { at:Date.now(), branches:structuredClone(job.branches), research:structuredClone(job.research), review:job.review }].slice(-5);
        job.pendingResearch = [...new Set(job.gaps.map(gap => gap.branchId))];
        job.supplementOnly = true;
        job.model = model; this.start(job, complete); return { job: publicJob(job) };
      }
      if (job.promptVersion !== IDEAL_PROMPTS && !job.supplementOnly) {
        if (job.protocol !== IDEAL_PROTOCOL || !['2026-10-17.1','2026-10-17.2','2026-10-17.3','2026-10-17.4'].includes(job.promptVersion)) throw new Error('这棵树使用不兼容的构建协议，请保留结果并新建目标。');
        if (job.promptVersion === '2026-10-17.4') {
          job.promptVersion = IDEAL_PROMPTS;
        } else {
          job.previousResults = [...(job.previousResults || []), { at:Date.now(), promptVersion:job.promptVersion, branches:structuredClone(job.branches), research:structuredClone(job.research), review:job.review }].slice(-5);
          job.upgrade = { from:job.promptVersion, cleaned:[] }; job.promptVersion = IDEAL_PROMPTS;
          delete job.review; job.issues = []; job.finalReviewDone = false;
          // Old automatic repair attempts remain spent; an upgrade is not a
          // license to start another whole-tree repair cycle.
          job.pendingResearch = Object.keys(job.branches);
        }
      }
      job.model = model; this.start(job, complete); return { job: publicJob(job) };
    }
    throw new Error('未知学习树操作');
  }
  start(job, complete) {
    job.status = 'running'; job.error = '';
    const controller = new AbortController();
    const entry = { controller, promise: null };
    this.active.set(job.id, entry);
    entry.promise = this.run(job, complete, controller.signal).catch(async error => {
      job.status = controller.signal.aborted || ['BUDGET','STORAGE_BUSY'].includes(error.code) ? 'paused' : 'failed';
      job.error = controller.signal.aborted ? '构建已暂停，已完成内容已保存。' : error.message;
      delete job.activity;
      await this.persist(job, { type:'stopped', stage:job.stage, reason:job.error, status:job.status }).catch(() => {});
    }).finally(() => this.active.delete(job.id));
  }
  async persist(job, event) {
    job.updatedAt = Date.now(); job.revision++;
    if (event) job.events.push({ at: job.updatedAt, ...event });
    // Events contain stage/counters/failure location only, never prompts or keys.
    await this.store.save(job);
  }
  async run(job, complete, signal) {
    return executionScope({ binding: { id: job.id, model: job.model, provider: complete.identity, input: job.input, promptVersion: job.promptVersion },
      state: job.execution, save: async state => { job.execution = state; await this.persist(job); },
      limits: { calls: this.maxCalls, recoveries: Math.min(32, this.maxCalls), perStage: 3 },
    }, () => this.runStages(job, complete, signal));
  }
  async runStages(job, complete, signal) {
    const until = job.metrics.modelCalls + this.maxCalls;
    await this.persist(job);
    const ask = async (stage, context, validate, recover) => {
      if (job.rebuild && ['contract','skeleton','branch','review'].includes(stage)) {
        const { suggestion, reason, previousContract, previousOutline, review } = job.rebuild;
        context = { ...context, rebuild: { suggestion, reason,
          ...(stage === 'contract' || stage === 'skeleton' ? { previousContract, previousOutline } : {}),
          ...(review ? { review } : {}),
        } };
      }
      const messages = idealMessages(stage, context);
      const label = job.stage;
      let networkRetries = 0, attempt = 0, latestRaw;
      const call = async (conversation, action) => {
        for (;;) {
        signal.throwIfAborted();
        if (job.metrics.modelCalls >= until) throw Object.assign(new Error('本轮调用预算已用完，已保存进度；可继续构建。'), { code: 'BUDGET' });
        job.metrics.modelCalls++; attempt++; const started = Date.now(); job.stage = label;
        job.activity = { stage: action, branchId:context.branch?.id, attempt, startedAt:started }; await this.persist(job);
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
        let requests=0;
        try { const raw = await complete(conversation, { stage: action, signal: bounded, onRequest: () => {
          // The first request is reserved above. Token-expansion retries must
          // also consume the same workflow budget, not disappear in transport.
          if (++requests>1) {
            if(job.metrics.modelCalls>=until)throw Object.assign(new Error('本轮调用预算已用完，已保存进度；可继续构建。'),{code:'BUDGET'});
            job.metrics.modelCalls++;
          }
        }, onCompletion: info => {
          job.metrics.completionTokens += info.completionTokens || 0;
        } }); signal.throwIfAborted();
          if (action !== 'recovery-plan') latestRaw = raw;
          return raw;
        } catch (error) {
          signal.throwIfAborted(); delete job.activity;
          await this.persist(job, { type:'model', stage, branchId:context.branch?.id, attempt:attempt+1, elapsedMs:Date.now()-started, accepted:false, issue:error.message.slice(0,1500) });
          if (recoveryDecision(error, 'transport', signal) === 'retry' && !networkRetries) {
            recordRecovery({layer:'transport',stage:`ideal-${stage}`,attempt:attempt+1,outcome:'retry',error});
            networkRetries++; job.stage = `连接短暂中断，正在重试 · ${label}`;
            await this.persist(job,{type:'retry',stage,reason:'transport'}); await delay(this.retryDelay,undefined,{signal}); continue;
          }
          throw error;
        }
        }
      };
      try {
        const result = await runStage({ stage, messages, complete: call, validate, signal,
          onCandidate: raw => { latestRaw = raw; },
          onRecovery: ({ strategy }) => { job.metrics.repairs++; job.events.push({ at: Date.now(), type: 'repair', stage, strategy }); } });
        delete job.activity;
        job.events.push({ at:Date.now(), type:'model', stage, branchId:context.branch?.id, attempt, accepted:true, reused: result.reused });
        return result.value;
      } catch (error) {
        if (error.code === 'EXECUTION_BLOCKED' && latestRaw && recover) {
          const value = recover(latestRaw);
          job.events.push({ at:Date.now(), type:'partial', stage, issue: error.message });
          return value;
        }
        throw error;
      }
    };
    const tool = async (name, input) => {
      signal.throwIfAborted(); job.metrics.toolCalls++; const started = Date.now();
      try { const result = await this.tools[name](input, signal); signal.throwIfAborted();
        job.events.push({at:Date.now(),type:'tool',tool:name,elapsedMs:Date.now()-started,accepted:true}); return result;
      } catch (error) { signal.throwIfAborted(); await this.persist(job, { type: 'tool', tool: name, elapsedMs: Date.now() - started, accepted: false, issue:error.message.slice(0,500) }); return { sources: [], problems: [error.message] }; }
    };
    const putSources = sources => {
      for (const source of sources) {
        const index = job.sources.findIndex(s => s.id === source.id);
        if (index < 0) job.sources.push(source); else if (source.level === 'body' || job.sources[index].level !== 'body') job.sources[index] = source;
      }
    };
    if (!job.contract) { job.stage = '理解目标'; await this.persist(job); job.contract = await ask('contract', { goal: job.input.goal, profile: job.input.profile }, validateContract); await this.persist(job); }
    if (!job.orientationDone) {
      job.stage = '调研领域结构'; await this.persist(job);
      for (const query of job.contract.researchQueries) {
        const result = await tool('search', query); job.orientation.push(...result.sources.filter(s => s.level !== 'metadata').slice(0, 3));
      }
      job.orientationDone = true; await this.persist(job);
    }
    if (!job.skeleton) {
      job.stage = '建立全局骨架'; await this.persist(job);
      job.skeleton = await ask('skeleton', { contract: job.contract, profile: job.input.profile, orientation: job.orientation.map(s => ({ title: s.title, level: s.level, text: s.text.slice(0,5000) })) }, raw => validateSkeleton(job.contract, raw));
      await this.persist(job);
    }
    const researchBranch = async branch => {
      const description = job.skeleton.branches.find(b => b.id === branch.branchId);
      job.stage = `查证阅读资料 · ${description.title}`; await this.persist(job);
      const nodes = branch.nodes.filter(n => n.kind === 'reading');
      if (!nodes.length) return { selections: [], problems: [] };
      const pool = new Map(), problems = [], queried = new Set(), readURLs = new Set();
      const previous = job.research[branch.branchId];
      const priorSourceIds = new Set(previous?.selections.flatMap(s => s.sourceIds) || []);
      job.sources.filter(s => priorSourceIds.has(s.id)).forEach(s => pool.set(s.id,s));
      // Local excerpts are real evidence, but limited in extent. Rank them using
      // the branch vocabulary, retaining only a bounded context for comparison.
      const words = (branch.nodes.map(n => n.title + ' ' + n.queries.join(' ')).join(' ').toLowerCase().match(/[a-z]{3,}|[\u4e00-\u9fff]{2,}/g) || []);
      const locals = localSources(job.input).map(s => ({ ...s, score: words.reduce((n,w) => n + (s.title.toLowerCase().includes(w) ? 5 : s.text.toLowerCase().includes(w) ? 1 : 0), 0) })).sort((a,b) => b.score-a.score).slice(0, 8);
      locals.forEach(s => pool.set(s.id, s));
      const gather = async (node, round) => {
        const query = node.queries[round];
        if (query && !queried.has(query)) {
          queried.add(query); const result = await tool('search', query);
          result.sources.forEach(s => pool.set(s.id, s)); problems.push(...result.problems);
        }
        if (!round) for (const url of node.urls) if (!readURLs.has(url)) {
          readURLs.add(url); const source = await tool('read', url);
          if (source.id) pool.set(source.id, source); else problems.push(...source.problems);
        }
      };
      for (const node of nodes) await gather(node, 0);
      putSources([...pool.values()]); await this.persist(job);
      const choose = () => {
        const vocabulary = nodes.map(n => n.title+' '+n.queries.join(' ')).join(' ');
        const sources = [...pool.values()].filter(s => s.level !== 'metadata').map(s => ({ ...s, excerpts:evidenceExcerpts(s,vocabulary) }));
        return ask('research', { contract: job.contract, branch: description,
        nodes: nodes.map(n => ({ id: n.id, title: n.title, outcome: n.outcome, body: n.body })),
        sources: sources.map(source => ({ id:source.id,title:source.title,url:source.url,level:source.level,
          text: sourceContext(source,vocabulary),excerpts:source.excerpts,extent:source.extent })),
      }, raw => validateResearch(nodes, sources, raw), raw => salvageResearch(nodes,sources,raw)); };
      let selected = await choose();
      const gaps = nodes.filter(n => !selected.selections.find(s => s.nodeId === n.id)?.sourceIds.length);
      if (gaps.length) {
        job.stage = `补查阅读资料 · ${description.title}`; await this.persist(job);
        let plans = [];
        try { ({plans} = await ask('research-plan',{ branch:description,nodes:gaps,previousQueries:[...queried],previousURLs:[...readURLs] },raw => validateResearchPlan(gaps,raw))); }
        catch(error) { signal.throwIfAborted(); if (error.code === 'BUDGET') throw error; problems.push(`补查计划未完成：${error.message}`); }
        for (const node of gaps) {
          const plan = plans.find(p => p.nodeId === node.id);
          if (plan) await gather({...node,queries:plan.queries.slice(0,1),urls:plan.urls},0);
          else if (node.queries[1] && !queried.has(node.queries[1])) await gather(node,1);
        }
        putSources([...pool.values()]); await this.persist(job); selected = await choose();
      }
      return { ...selected, problems: [...new Set(problems)], checkedAt: Date.now() };
    };
    if (job.upgrade && !job.upgrade.done && !job.supplementOnly) {
      job.upgrade.cleanedNodes ||= [];
      for (const branch of Object.values(job.branches)) {
        if (job.upgrade.cleaned.includes(branch.branchId)) continue;
        const nodes = branch.nodes.filter(n => /待补|待核|尚缺|另.{0,8}补|未.{0,10}核|草图|摘要级|全文.{0,10}复核|资料.{0,10}补齐/.test(n.title+' '+n.body+' '+n.outcome));
        for (const node of nodes) {
          const checkpoint = `${branch.branchId}/${node.id}`;
          if (job.upgrade.cleanedNodes.includes(checkpoint)) continue;
          job.stage = `恢复学习内容 · ${node.title}`; await this.persist(job);
          job.branches[branch.branchId] = await ask('cleanup',{ contract:job.contract,
            branch:job.skeleton.branches.find(b=>b.id===branch.branchId),
            surrounding:branch.nodes.map(n=>({id:n.id,title:n.title,parentId:n.parentId,kind:n.kind})),
            nodes:[node].map(({id,title,body,outcome,deliverable,feedback,queries,urls})=>({id,title,body,outcome,deliverable,feedback,queries,urls})),
          },raw => validateCleanup(job,job.branches[branch.branchId],[node],raw));
          job.upgrade.cleanedNodes.push(checkpoint); await this.persist(job);
        }
        job.upgrade.cleaned.push(branch.branchId); await this.persist(job);
      }
      job.upgrade.done = true; await this.persist(job);
    }
    const expand = async (branch, issues) => {
      job.stage = `${issues ? '修复' : '展开'} · ${branch.title}`; await this.persist(job);
      const result = await ask('branch', { contract: job.contract, profile: job.input.profile, globalSkeleton: job.skeleton, branch,
        prerequisiteBranches: branch.dependsOn.map(id => compactBranch(job.branches[id])).filter(Boolean),
        localLibrary: job.input.library.map(d => ({ id: d.id, title: d.title })),
        ...(issues ? { previous: job.branches[branch.id], issues } : {}),
      }, raw => validateBranch(job.contract, job.skeleton, branch.id, raw));
      // A valid branch commits atomically. Research has its own checkpoint.
      job.branches[branch.id] = result; delete job.research[branch.id]; await this.persist(job);
    };
    // Topological scheduling provides actual accepted prerequisites, not a
    // model-invented memory of work that has not happened yet.
    const pending = [...job.skeleton.branches];
    while (pending.length) {
      signal.throwIfAborted();
      const index = pending.findIndex(b => b.dependsOn.every(id => job.branches[id]));
      if (index < 0) throw new Error('先修分支调度失败');
      const branch = pending.splice(index,1)[0];
      if (!job.branches[branch.id]) await expand(branch);
      if (!job.research[branch.id] || job.pendingResearch?.includes(branch.id)) {
        job.research[branch.id] = await researchBranch(job.branches[branch.id]);
        job.pendingResearch = (job.pendingResearch || []).filter(id=>id!==branch.id); await this.persist(job);
      }
    }
    const review = () => {
      const pathReport = learningPathReport(job);
      return ask('review', { goal:job.input.goal, profile:job.input.profile, contract: job.contract, skeleton: job.skeleton,
        pathReport: { ...pathReport, requirements: pathReport.requirements.map(r => ({ id:r.id, tasks:r.tasks.map(t => `${t.branchId}/${t.nodeId}`) })) },
        branches: Object.values(job.branches).map(compactBranch) }, raw => validateReview(job,raw));
    };
    if (!job.review && !job.supplementOnly) { job.stage = '审查目标覆盖与学习路径'; await this.persist(job); job.review = await review(); job.issues = job.review.issues; job.reviewedRepairCount = job.repairDone.length; await this.persist(job); }
    if (!job.reviewRound && !job.supplementOnly) {
      const repairIds = [...new Set(job.review.issues.filter(i => i.severity === 'important').map(i => i.branchId))];
      job.repairDrafts ||= [];
      for (const id of repairIds) {
        if (job.repairDone.includes(id)) continue;
        const branch = job.skeleton.branches.find(b => b.id === id);
        if (!job.repairDrafts.includes(id)) {
          await expand(branch, job.review.issues.filter(i => i.branchId === id));
          job.repairDrafts.push(id); await this.persist(job);
        }
        if (!job.research[id]) job.research[id] = await researchBranch(job.branches[id]);
        job.repairDone.push(id); await this.persist(job);
      }
      job.reviewRound = 1; await this.persist(job);
    }
    if (!job.finalReviewDone && !job.supplementOnly) {
      if (job.repairDone.length > (job.reviewedRepairCount || 0)) { job.stage = '复核修复后的学习树'; await this.persist(job); job.review = await review(); job.issues = job.review.issues; job.reviewedRepairCount = job.repairDone.length; }
      job.finalReviewDone = true; await this.persist(job);
    }
    signal.throwIfAborted();
    job.gaps = Object.entries(job.research).flatMap(([branchId,result]) => result.selections.filter(s => !s.sourceIds.length).map(s => ({ branchId, nodeId: s.nodeId, explanation: s.explanation })));
    job.pathReport = learningPathReport(job);
    if (job.pathReport.status !== 'checked') throw new Error(`学习路径结构校验未通过：${job.pathReport.errors.join('；')}`);
    delete job.supplementOnly;
    job.status = 'complete'; job.stage = '学习路径构建完成'; job.completedAt = Date.now();
    await this.persist(job, { type: 'finished', status: job.status });
  }
}
