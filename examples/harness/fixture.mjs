// Authored simulation data. This is not a real model response or external paper.
export const input={goal:'理解检索评价，并完成一个可以比较两种检索方案的小实验。',profile:{background:'会基础 Python 的本科生',foundations:['均值','基础概率']},library:[]};
export const contract={title:'建立可比较的检索实验',summary:'先掌握评价条件，再用固定问题集比较方案。',capacity:{branches:2,nodesPerBranch:3},
  requirements:[{id:'R1',label:'理解评价条件',outcome:'解释问题集、相关性标注与评价指标之间的关系。'},{id:'R2',label:'完成对照实验',outcome:'固定评价条件并复现两种方案的结果。'}],
  assumptions:['能够运行 Python 脚本。'],excluded:['生产部署和大规模训练'],researchQueries:['retrieval evaluation']};
export const skeleton={branches:[{id:'B1',title:'评价基础',purpose:'建立公平比较的条件。',requirementIds:['R1'],dependsOn:[]},{id:'B2',title:'小规模实验',purpose:'通过可复现实验比较两个方案。',requirementIds:['R2'],dependsOn:['B1']}]};
export const source={id:'Sfixture',title:'检索评价 · 原创验收文本',url:'https://example.org/authored-retrieval-fixture',level:'body',extent:'人工编写的测试全文，并未访问网页',
  text:'A retrieval experiment compares systems on the same queries and document collection. Relevance judgments should be fixed before comparing results. Report the metric definition and failures as well as the aggregate score.',checkedAt:0};
export function branch(id,repaired=false){
  const r=id==='B1'?'R1':'R2';
  const common={body:'比较检索方案时，先固定输入和判断标准，才有条件解释指标的变化。用一个小例子区分算法变化和评价条件变化，再把这个区分用于实验。',outcome:'能够解释方法选择与评价条件之间的关系。',requirementIds:[r],dependsOn:[],priority:'core',deliverable:'',feedback:'',queries:[],urls:[]};
  return{branchId:id,nodes:[
    {...common,id:'K1',parentId:null,kind:'knowledge',title:'理解比较的条件'},
    {...common,id:'R1',parentId:'K1',kind:'reading',title:'阅读评价说明',queries:['retrieval evaluation']},
    {...common,id:'P1',parentId:'K1',kind:'practice',title:'比较两种方案',dependsOn:['R1'],deliverable:repaired?'固定问题集、指标定义和可复现结果表':'一份可复现的结果表',feedback:'核对输入是否相同，分析两个方案的失败案例。'},
  ]};
}
export function fixtureTools(){return{search:async()=>({sources:[structuredClone(source)],problems:[]}),read:async()=>structuredClone(source)};}
export function fixtureCompletion(transcript){
  let interrupted=false,malformed=false;
  return async(messages,task)=>{
    const context=JSON.parse(messages[1].content),record={stage:task.stage,input:context,messages:structuredClone(messages)};transcript.push(record);
    let result;
    if(task.stage==='contract')result=contract;
    else if(task.stage==='skeleton')result=skeleton;
    else if(task.stage==='branch'){
      if(context.branch.id==='B2'&&!interrupted){interrupted=true;record.error='模拟一次供应商中断';throw new Error(record.error);}
      result=branch(context.branch.id,!!context.issues);
    }else if(task.stage==='research'){
      const bad=context.branch.id==='B2'&&!malformed;malformed ||= bad;
      result={selections:context.nodes.map(node=>({nodeId:node.id,sourceIds:[bad?'Sunknown':source.id],explanation:'原创测试文本说明固定评价条件的重要性。',evidence:[{sourceId:source.id,excerptId:'E1'}]}))};
    }else if(task.stage==='review'){
      const repaired=context.branches.find(b=>b.branchId==='B2').nodes.find(n=>n.id==='P1').deliverable.includes('指标定义');
      result={summary:repaired?'模拟复核：成果现在明确包含评价条件。':'模拟审查：实验成果尚缺少指标定义。',issues:repaired?[]:[{branchId:'B2',nodeId:'P1',severity:'important',problem:'实验成果未要求保留问题集和指标定义，可能无法公平比较。',repair:'把固定问题集与指标定义加入成果要求，保留其他已正确的节点。'}]};
    }else throw new Error(`Unexpected demo stage ${task.stage}`);
    record.output=structuredClone(result);return JSON.stringify(result);
  };
}
