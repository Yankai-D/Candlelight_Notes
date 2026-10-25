import { z } from 'zod';

// Keep what the model is asked to produce identical to the structural validator.
// JSON-object mode alone does not communicate required fields, types or limits.
export function withOutputContract(messages, schema) {
  const contract = JSON.stringify(z.toJSONSchema(schema, { target: 'draft-7' }));
  return messages.map((message, index) => index === 0
    ? { ...message, content: `${message.content}\n输出必须满足以下 JSON Schema；包括字段类型、必需字段和数组上限。语义要求仍以任务与来源为准。\n${contract}` }
    : message);
}
