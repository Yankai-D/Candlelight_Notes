import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { escapeJSONSequences } from './json-escape-patch.mjs';

// This workbench owns only a returned candidate. It has no filesystem, fetch,
// executable-code or validator-edit capability. The caller owns acceptance.
export const candidateWire = value => typeof value === 'string' ? value : JSON.stringify(value);
export const candidateDigest = value => createHash('sha256').update(candidateWire(value)).digest('hex');
const pathSchema = z.array(z.union([z.string().max(160), z.number().int().nonnegative()])).max(32);
const base = { failureId: z.string().length(64), cause: z.string().min(1).max(1600), instruction: z.string().min(1).max(2400) };
// Tool operations carry executable intent themselves. A missing prose caption
// must not prevent an otherwise valid read or patch; rewrites still require it.
const toolBase = { ...base, cause: base.cause.default('执行结构化检查或局部修正，依据工具结果继续判断。'), instruction: base.instruction.default('执行结构化操作，并以原校验器验证结果。') };
const operation = z.discriminatedUnion('op', [
  z.object({ op:z.literal('json-escape'), sequences:z.array(z.string().min(2).max(160)).min(1).max(32) }).strict(),
  z.object({ op: z.literal('set'), path: pathSchema, expected: z.unknown(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('add'), path: pathSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal('insert'), path: pathSchema, index: z.number().int().nonnegative(), expected: z.unknown(), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: pathSchema, expected: z.unknown() }).strict(),
  z.object({ op: z.literal('text'), path: pathSchema.optional(), before: z.string().min(1).max(24000), after: z.string().max(24000) }).strict(),
]);
export const recoveryPlanSchema = z.discriminatedUnion('strategy', [
  z.object({ ...base, strategy: z.enum(['repair', 'reframe', 'partition', 'stop']) }).strict(),
  z.object({ ...toolBase, strategy: z.literal('patch'), targetDigest: z.string().length(64).optional(), candidateDigest: z.string().length(64).optional(), operations: z.array(operation).min(1).max(16) }).strict(),
  z.object({ ...toolBase, strategy: z.literal('inspect'), target: z.enum(['candidate', 'context']), path: pathSchema,
    unit: z.enum(['characters','items']).optional(), start: z.number().int().nonnegative().default(0), length: z.number().int().min(1).max(6000).default(3000) }).strict(),
  z.object({ ...toolBase, strategy: z.literal('search'), target: z.enum(['candidate', 'context']), query: z.string().min(1).max(200) }).strict(),
]);

function fail(message) { throw Object.assign(new Error(message), { code: 'RECOVERY_TOOL_CONTRACT' }); }
function safePath(path) {
  if (path.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) fail('Unsafe property path. Only ordinary own fields can be addressed.');
}
function own(value, key) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value) && (!Number.isSafeInteger(key) || key < 0 || key >= value.length)) return false;
  return Object.hasOwn(value, key);
}
function readPath(value, path) {
  safePath(path);
  for (const part of path) {
    if (!own(value, part)) fail(`Path does not exist: ${JSON.stringify(path)}`);
    value = value[part];
  }
  return value;
}

function replaceUnique(text, before, after) {
  const at = text.indexOf(before);
  if (at < 0 || text.indexOf(before, at + 1) !== -1) fail(at < 0
    ? 'No text match. Inspect the field and use its decoded text with a path; raw JSON has an extra escaping layer.'
    : 'Multiple text matches. Supply a string-field path or include more surrounding text.');
  return text.slice(0, at) + after + text.slice(at + before.length);
}

function patchText(text, edit) {
  let decoded;
  try { decoded = JSON.parse(text); } catch { /* Raw repair is available for malformed JSON. */ }
  if (edit.path?.length) {
    const value = readPath(decoded, edit.path);
    if (typeof value !== 'string') fail('Text patch path must address a string field.');
    const parent = readPath(decoded, edit.path.slice(0, -1));
    parent[edit.path.at(-1)] = replaceUnique(value, edit.before, edit.after);
    return JSON.stringify(decoded);
  }
  if (text.includes(edit.before)) return replaceUnique(text, edit.before, edit.after);
  // Models inspect decoded fields, whereas the wire JSON has another escaping
  // layer. Resolve only a single exact occurrence across decoded string values;
  // never guess the intended field, normalize wording or fuzzy-match an edit.
  const queue = [{ value: decoded, path: [] }], matches = [];
  for (let i = 0; i < queue.length && matches.length < 2; i++) {
    const { value, path } = queue[i];
    if (typeof value === 'string' && value.includes(edit.before)) {
      const at = value.indexOf(edit.before);
      matches.push({ path, value });
      if (value.indexOf(edit.before, at + 1) !== -1) matches.push({ path, value });
    } else if (value && typeof value === 'object' && path.length < 32) {
      for (const key of Object.keys(value)) {
        if (!['__proto__', 'prototype', 'constructor'].includes(key)) queue.push({ value: value[key], path: [...path, Array.isArray(value) ? Number(key) : key] });
      }
    }
  }
  if (matches.length !== 1) fail(matches.length ? 'Multiple decoded text matches. Supply a string-field path or more context.'
    : 'No raw or decoded text match. Inspect the exact field before retrying.');
  const match = matches[0];
  if (!match.path.length) return JSON.stringify(replaceUnique(match.value, edit.before, edit.after));
  const parent = readPath(decoded, match.path.slice(0, -1));
  parent[match.path.at(-1)] = replaceUnique(match.value, edit.before, edit.after);
  return JSON.stringify(decoded);
}

export function inspectRecoveryCandidate(raw, messages, plan) {
  const context = messages.slice(1).map(message => {
    let content = message.content; try { content = JSON.parse(content); } catch { /* Plain text remains read-only text. */ }
    return { role: message.role, content };
  });
  const text = plan.target === 'candidate' ? candidateWire(raw) : JSON.stringify(context);
  if (plan.strategy === 'search') {
    const matches = []; let from = 0, at;
    while (matches.length < 6 && (at = text.indexOf(plan.query, from)) !== -1) {
      matches.push({ offset: at, excerpt: text.slice(Math.max(0, at - 180), at + plan.query.length + 180) });
      from = at + plan.query.length;
    }
    return { target: plan.target, targetDigest: candidateDigest(raw), query: plan.query, matches, truncated: text.indexOf(plan.query, from) !== -1 };
  }
  let value;
  try { value = JSON.parse(text); } catch { value = text; }
  value = readPath(value, plan.path);
  const rendered = candidateWire(value);
  if (plan.unit === 'items') {
    if (!Array.isArray(value)) fail('Item pagination requires an array path. Use characters for a string or object.');
    const entries = []; let size = 0;
    for (let index = plan.start; index < Math.min(value.length,plan.start + Math.min(plan.length,16)); index++) {
      const text = candidateWire(value[index]);
      if (entries.length && size + text.length > 6000) break;
      entries.push({ index, path: [...plan.path,index], ...(text.length <= 6000 ? { value: structuredClone(value[index]) } : { excerpt: text.slice(0,6000), truncated:true }) });
      size += Math.min(text.length,6000);
    }
    return { target:plan.target, targetDigest:candidateDigest(raw), path:plan.path, kind:'array', paginationUnit:'items',
      start:plan.start,totalItems:value.length,entries,nextStart:plan.start+entries.length,truncated:plan.start+entries.length<value.length };
  }
  return { target: plan.target, targetDigest: candidateDigest(raw), path: plan.path, kind: Array.isArray(value) ? 'array' : typeof value,
    ...(value && typeof value === 'object' && rendered.length <= 6000 && plan.start === 0 ? { value: structuredClone(value) } : {}),
    ...(value && typeof value === 'object' ? { keys: Object.keys(value).slice(0, 80) } : {}),
    ...(Array.isArray(value) && rendered.length > 6000 ? { arrayIndex: value.slice(0,24).map((item,index)=>({index,path:[...plan.path,index],
      preview:candidateWire(item).slice(0,120), ...(item && typeof item === 'object' && !Array.isArray(item) ? {fields:Object.fromEntries(Object.entries(item).filter(([,v])=>['string','number','boolean'].includes(typeof v)&&String(v).length<=100).slice(0,8))}:{})})),
      readHint:'Use unit:"items" with start/length to read array entries with exact indices, or inspect one returned path.' } : {}),
    paginationUnit: 'characters', start: plan.start, totalCharacters: rendered.length, excerpt: rendered.slice(plan.start, plan.start + plan.length),
    truncated: plan.start + plan.length < rendered.length };
}

export function applyRecoveryPatch(raw, plan) {
  const actual = candidateDigest(raw), supplied = plan.targetDigest || plan.candidateDigest;
  if (actual !== supplied || plan.targetDigest && plan.candidateDigest && plan.targetDigest !== plan.candidateDigest) throw Object.assign(new Error('Stale candidateDigest / targetDigest. Use toolState.targetDigest, not a candidateDigest field inside the returned data.'), {
    code: 'RECOVERY_TOOL_CONTRACT', issues: [{ path: ['targetDigest'], code: 'PATCH_BINDING', expected: actual }],
  });
  let text = candidateWire(raw);
  const originalLength = text.length;
  // All edits are provisional. A failed later operation discards this entire
  // transaction; the input candidate and source context are never mutated.
  for (const [index, edit] of plan.operations.entries()) {
    if(edit.op==='json-escape'){
      try{text=escapeJSONSequences(text,edit.sequences);}catch(error){fail(error.message);}
    } else if (edit.op === 'text') {
      text = patchText(text, edit);
    } else {
      safePath(edit.path);
      if (!edit.path.length) fail('Root replacement is not a local patch. Use repair or reframe for a complete candidate.');
      let value;
      try { value = JSON.parse(text); } catch { fail('Candidate is not valid JSON. Repair its exact raw text before using a JSON path.'); }
      if (edit.op === 'insert') {
        const array = readPath(value,edit.path);
        if (!Array.isArray(array) || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index > array.length) fail('Insert requires an array path and an index from zero through its current length.');
        const anchor = edit.index === array.length ? null : array[edit.index];
        if (!Object.hasOwn(edit,'expected') || !isDeepStrictEqual(anchor,edit.expected)) fail('Insert anchor does not match. Inspect the current entry at index; appending requires expected:null. No changes applied.');
        if (!Object.hasOwn(edit,'value')) fail('Insert requires a value.');
        array.splice(edit.index,0,structuredClone(edit.value));
        text = JSON.stringify(value);
      } else {
      const parent = readPath(value, edit.path.slice(0, -1)), key = edit.path.at(-1);
      if (!parent || typeof parent !== 'object') fail('Patch parent is not a container.');
      if (edit.op === 'add') {
        if (Array.isArray(parent) || own(parent, key)) fail('Add only creates a missing object field; use set to replace an array or an existing field.');
      } else if (!own(parent, key) || !Object.hasOwn(edit, 'expected') || !isDeepStrictEqual(parent[key], edit.expected)) {
        const current = own(parent, key) ? candidateWire(parent[key]) : undefined;
        throw Object.assign(new Error(`Expected value does not match the current field at ${JSON.stringify(edit.path)} (operation ${index}). The whole patch was rejected; no changes applied.`), {
          code: 'RECOVERY_TOOL_CONTRACT', issues: [{ path: ['operations', index, 'expected'], code: 'PATCH_EXPECTED_VALUE',
            expected: { candidatePath: edit.path, exists: current !== undefined,
              ...(current !== undefined && current.length <= 3000 ? { value: structuredClone(parent[key]) } : { instruction: 'Inspect this candidatePath to read the current field.' }) } }],
        });
      }
      if (edit.op === 'remove') {
        if (Array.isArray(parent)) parent.splice(key,1);
        else delete parent[key];
      } else {
        if (!Object.hasOwn(edit, 'value')) fail('Set/add requires a value.');
        parent[key] = structuredClone(edit.value);
      }
      text = JSON.stringify(value);
      }
    }
    if (text.length > Math.max(originalLength * 2, originalLength + 48000)) fail('Patch expands the candidate too much. Use a bounded complete repair.');
  }
  if (candidateDigest(text) === candidateDigest(raw)) fail('Patch did not change the candidate.');
  return text;
}

export const workbenchPrompt = `恢复工作区 recovery-workbench-v1：修复无需总是重写整个结果。优先定位并修补有证据支持的字段；不要改动正确内容。你的操作仅作用于当前返回值，不能编辑软件、源资料、原任务或验收规则。每个候选都将交给同一个真实校验器试验；失败会带回新的诊断，继续据此修正，不能声称未经执行的修复已通过。
repair/reframe 会重新调用原步骤并返回完整内容，不是执行你的文字补丁说明。若判断只需改标点、转义或字段，请选择 patch 并提交可执行 operations；只有确实需要重新推导内容时才选择完整重写。
toolState.stringEscapes 是程序扫描当前原始字符串得到的转义清单，包含序列、匹配数和上下文。若确认其中某些反斜杠本来应为字面字符，可用 patch 的 {"op":"json-escape","sequences":[清单中的精确 sequence]} 一次转义其所有未正确编码的出现位置；已双写的反斜杠、Unicode 转义、未选中的序列和其他字符不变。不必逐段复制正文或数偏移。validJSONPrefix=true 的项有歧义（例如制表符与公式命令），必须据实际上下文判断，不能全部勾选。该操作不是正确性证明，修后仍检查内容与来源。纯标点修补由程序先行处理；没有适用项时用原始文本精确补丁或进一步 inspect。
remove 可删除数组内已证实多出的项目：path 指向实际索引，expected 必须是该项完整当前值，整个候选摘要必须匹配。后续索引会前移，多项删除应从后往前；任何预期不符则整批拒绝。此能力不能用于删除有效问题来假装通过；原任务与审查覆盖仍由业务校验器约束。
候选版本以 toolState.targetDigest 为准；当前 failure 是本版本的真实失败，历史错误不代表现在仍存在。读取根对象前先看 toolState.parsed 与 kind：不可解析的候选只能按原始字符读取/精确文本补丁，不能按 blocks 等对象路径操作。不要为 metadata 标注缺口整章重写；先核对是否已有实际内容，只有真实缺失才局部补写。
可以选择以下 strategy（均保留 failureId、cause、instruction；另外必须输出各操作要求的字段，只有自然语言 instruction 不是可执行补丁）：
数组插入使用 {"op":"insert","path":["blocks"],"index":3,"expected":当前索引3的完整块,"value":新增块}，在锚点前插入，其他块由程序后移，不要手动逐块搬移。在末尾追加时 index 等于数组长度，expected 为 null。操作仍绑定整个候选摘要，索引/锚点不符会原子拒绝。add 只添加对象字段；为已有段落增加 learningRoles 数组可用 add，不重复段落。真实内容补写与标签调整都必须过原校验。
读取数组可用 inspect 的 unit:"items",start:起始索引,length:条目数（单次最多16项/6000字符）；返回 entries 中的 index/path/value 可直接构造插入锚点。默认 unit:"characters" 保持字符分页，大数组另给 arrayIndex 摘要；字符偏移不能当数组索引。
inspect：增加 target("candidate" 或 "context")、path(JSON 键/数字索引数组)，读取局部。start/length 是字符偏移与字符数量，不是数组项数；一般省略，默认读取前3000字符，最多6000。小对象/数组会额外返回完整 value，可直接据此构造 expected，不能只看 excerpt。大对象应按 path 读具体字段。context 是消息数组，其中 content 已解析为 JSON 对象，例如 target:"context",path:[0,"content","blocks",4] 读取原上下文的正文；candidate 是当前失败返回值（如审查决定），其中不一定有 blocks。JSON 无法解析时 candidate 是原始字符串，只支持空 path。
search：增加 target 和 query，在返回值或原上下文中搜索字面字符串；不支持正则、文件或网络访问。
patch 的完整返回示例：{"failureId":"当前 failureId","strategy":"patch","cause":"证据支持的诊断","instruction":"定向修正字段","targetDigest":"照抄 toolState.targetDigest","operations":[{"op":"set","path":["blocks",0,"text"],"expected":"旧值","value":"新值"}]}。targetDigest 是工具对整个返回值的摘要；返回值内部的 candidateDigest 可能是正文绑定，二者不同，不能混用。每次工具观察返回当前 targetDigest；旧 candidateDigest 参数只兼容历史调用，不要同时填写。add 为缺失的对象字段添加 value；remove 删除对象字段或数组项目，必须提供完整 expected，并核对删除后索引变化；数组整体替换需 set 和完整 expected。局部文字用 {"op":"text","path":["blocks",0,"text"],"before":"该字段中唯一匹配的解码后片段","after":"替换片段"}；只抄需要改的一小处，保留其他文字。before/after 使用解码后字段文本，JSON 序列化由工具负责。path 省略时先精确匹配原始 JSON；未命中则查找解码后字符串字段，只有全候选唯一匹配才执行，绝不模糊匹配。原始 JSON 损坏时省略 path，直接修补唯一的原始片段。最多 16 项，按顺序原子应用，绑定过期或预期不符会拒绝并反馈。禁止整个根对象替换或删除问题来假装修复，引用/证据修改必须由 source 支持。
inspect/search 只收集信息，不算完成；patch 后将立即执行原校验器。如果出现新错误，核对是原有问题暴露还是你引入的回归，保留有效修改并改换具体假设。反复输出相同候选、无关改写或仅改措辞不会通过。缺失证据时不能猜测或修改校验规则。`;
