// Original, deliberately small documents: no personal files or course exercises.
const paper = 'We study why increasing network depth can make optimization harder. Our method learns a residual function. We compare the optimization error of two models and discuss the limits of this comparison.';
const course = 'Mean and variance. The mean is the sum divided by the number of observations. Sample variance uses n-1. Lecture examples illustrate the difference between a center and dispersion.';
const exercises = 'Question 1. Waiting times are 2, 4 and 6 minutes. (a) Find the mean. (b) Find the sample variance using denominator n-1. Question 2. Solve x^2 - 5x + 6 = 0.';
const item = (id, intent, text, templateId, tasks, extra = {}) => ({ id, document: { title: 'Authored calibration material', intent, feedback: '', chapters: ['Source'], excerpts: [{ page: 1, text }] }, expected: { templateId, tasks, ...extra } });
export const templateRoutingCases = [
  item('paper-default', '看懂这篇文章', paper, 'narrative', ['understand']),
  item('course-default', '看懂这篇文章', course, 'lecture', ['understand']),
  item('exercise-default', '看懂这篇文章', exercises, 'exercise', ['understand', 'solve']),
  item('exercise-worked', '给我每道题的手写过程和答案', exercises, 'exercise', ['solve']),
  item('hints-not-answers', '只给提示，不要答案', exercises, 'exercise', ['hints']),
  item('answers-only', '只要答案，不用讲解', exercises, 'exercise', ['answers']),
  item('paper-as-review', '把本文重组为按知识点回查的复习讲义', paper, 'lecture', ['review']),
  item('course-last-question', '只逐题解答最后的练习，前面知识按需引用', course+'\n'+exercises, 'exercise', ['solve']),
  item('incidental-example', '解释作者的推理主线和实验边界', paper+'\nFor example, the toy values 2,4,6 have mean 4. This is only an illustration, not an exercise.', 'narrative', ['understand']),
  item('create-quiz', '生成两道练习题，并给出解答', course, 'exercise', ['create-exercises']),
  item('missing-questions', '给我每道题的手写过程和答案', 'Contents: 1 Introduction. 2 Exercises. The actual question pages are missing.', 'exercise', ['solve'], { fit: 'adapted' }),
  item('unsupported-deliverable', '根据这段资料写一份企业法律合同', 'The arithmetic mean of 2,4,6 is 4.', null, ['other'], { fit: 'adapted' }),
];
templateRoutingCases.push({ ...item('revision-hints', '给我每道题的手写过程和答案', exercises, 'exercise', ['hints']), document: { ...item('', '', exercises).document, intent: '给我每道题的手写过程和答案', feedback: '这次只给提示，不要答案' } });
export function checkTemplateChoice(testCase, result) {
  const failures = [];
  if (testCase.expected.templateId && result.templateId !== testCase.expected.templateId) failures.push(`template: expected ${testCase.expected.templateId}, got ${result.templateId}`);
  if (!testCase.expected.tasks.includes(result.task)) failures.push(`task: expected ${testCase.expected.tasks.join('/')}, got ${result.task}`);
  if (testCase.expected.fit && result.fit !== testCase.expected.fit) failures.push(`fit: expected ${testCase.expected.fit}, got ${result.fit}`);
  return failures;
}
