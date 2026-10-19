// Public example inputs only. Never read the developer's catalog or notebooks.
const outlines = {
  textbook: { title: '描述性统计入门：教材节选', label: '描述性统计 · 教材', year: '2019 · 2022 更新',
    sections: [['数值数据与散点图',2,3],['点图与均值',4,6],['直方图与分布形状',7,10],['方差与标准差',11,13],['中位数、四分位数与箱线图',14,15],['稳健统计量与离群值',16,17],['分类数据：列联表与条形图',18,19],['行比例、列比例与分母',19,21],['分类变量的图形比较',22,24],['跨组比较数值数据',25,26]] },
  numerical: { title: '数值数据：描述、比较与概括', label: '数值数据 · 课件', year: '公开课件',
    sections: [['点图与均值',2,5],['直方图与分布形状',6,10],['直方图与分布形状 · 续',11,13],['方差与标准差',14,16],['中位数、四分位数与箱线图',17,21],['离群值与稳健统计量',22,25]] },
  categorical: { title: '分类数据：频数、比例与图形', label: '分类数据 · 课件', year: '公开课件',
    sections: [['列联表与条形图',2,5],['比例与分母的选择',6,6],['分类变量与跨组比较',7,10]] },
};

export function statisticsCatalog(sources) {
  if (sources.length !== 3 || Object.keys(outlines).some(id => sources.filter(s => s.id === id).length !== 1)) throw new Error('Expected exactly the three public statistics sources');
  const createdAt = Date.UTC(2026,9,18);
  return { collection: '描述性统计', documents: Object.entries(outlines).map(([id, outline], order) => {
    const source = sources.find(s => s.id === id), libraryId = `descriptive-statistics-${id}`;
    const chapters = outline.sections.map(([title, start, end], index) => {
      const chapterId = `${libraryId}-s${index+1}`;
      return { id: chapterId, title, sourcePages: Array.from({length:end-start+1},(_,i)=>start+i), status:'empty',
        content:{type:'doc',content:[{type:'paragraph',attrs:{id:`${chapterId}-start`},content:[]}]}};
    });
    return { id:`paper-${libraryId}`,title:outline.title,subtitle:[...source.authors,...source.contributors].join(' · '),
      filename:source.file,kind:'pdf',intent:'看懂这篇文章',intentSource:'default',createdAt,updatedAt:createdAt,revision:0,
      pages:source.pages.map(({number,text,needsReview})=>({number,text,...(needsReview?{needsReview:true}:{})})),chapters,
      currentChapter:chapters[0].id,currentPage:2,versions:[],
      library:{id:libraryId,label:outline.label,year:outline.year,authors:source.authors.join(' · '),group:'描述性统计',order,
        placement:{folder:{id:'descriptive-statistics',name:'描述性统计',kind:'bundle',inTree:false},inTree:false}} };
  })};
}
