export const defaultModelConnection = Object.freeze({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''});
export const defaultStartupMode = 'adaptive';
export const startupModes = [
  {id:'manual',label:'手动选择',description:'进入资料时先选择阅读方式，选定前不开始生成。'},
  {id:'translation',label:'纯翻译',description:'直接打开独立译文，忠实保留原文，不使用知识画像。'},
  {id:'adaptive',label:'适应性讲解',description:'按稳定画像和学习目标展开讲解，沿用笔记的写作模板。'},
];
