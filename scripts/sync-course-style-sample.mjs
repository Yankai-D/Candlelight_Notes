import { writeFile } from 'node:fs/promises';
import { reference, sources } from '../examples/course/descriptive-statistics/reference.mjs';

// Browser-safe copy of the authored reference. No filesystem access, source
// corpus or provider SDK is bundled into the style settings UI.
await writeFile(new URL('../shared/course-default-sample.json', import.meta.url), JSON.stringify({
  version: 'course-style-baseline-v1', title: '从平均值到有意义的数据概括',
  paragraphs: reference.blocks.map(({ id, text }) => ({ id, text })),
  rules: [
    '采用冷静、直接、准确的书面中文，每段推进一个明确关系。',
    '背景、直觉、公式和例子融入连续叙述，避免机械重复的教学栏目。',
    '先解释为什么需要计算，再展开关键步骤，随后说明结果如何影响当前判断。',
    '在概念转换和易误解处充分展开，熟悉的代数与重复解释紧凑处理。',
  ],
  attribution: {
    note: '依据 OpenIntro 公开教材与课件人工编写，进行了中文改编、重组及补充；等待时间为合成算例。不是 OpenIntro 官方讲义。个人调整稿继续保留来源署名。',
    license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    sources: sources.filter(s => s.id !== 'categorical').map(({ title, authors, contributors, url, license, licenseUrl }) => ({ title, authors, contributors, url, license, licenseUrl })),
  },
}, null, 2) + '\n');
console.log('Updated shared/course-default-sample.json');
