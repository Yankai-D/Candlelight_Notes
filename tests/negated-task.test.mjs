import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitTask,routingProblem} from '../shared/template-decision.mjs';
import {isLectureSynthesis} from '../shared/lecture-synthesis.mjs';

test('negated deliverables cannot force a lecture into exercise or translation generation',()=>{
  const goals=['整理一份精简讲义，不额外出一份试卷','整理知识点，不要生成新的练习题','请讲解这些知识，无需逐题求解','Do not generate an exam; produce a revision handout.','Explain these notes; do not translate only.'];
  for(const intent of goals){
    assert.equal(explicitTask(intent),null,intent);
    assert.equal(isLectureSynthesis({learning:{mode:'adaptive',writingTemplate:{layout:'structured'}},document:{intent},taskPlan:{analysis:{task:{kind:'lecture'}}}}),true,intent);
    assert.equal(routingProblem({intent},[{id:'lecture'},{id:'exercise'}],{templateId:'lecture',task:'review',material:'course',fit:'direct',adaptation:''}),null);
  }
});
test('affirmative exercises, hints, answer-only and translation requests keep their existing constraints',()=>{
  for(const [intent,task]of [['生成练习题，不要答案','create-exercises'],['只给提示，不要答案','hints'],['只要答案，不用讲解','answers'],['只翻译','translate'],['给我每道题的过程和答案','solve'],['Generate a quiz without answers','create-exercises']])assert.equal(explicitTask(intent),task,intent);
});
