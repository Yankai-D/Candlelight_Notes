import { number, variable, op } from './fixtures.mjs';

// New authored development probes. Both protocol versions see identical
// sources, note text and goals. Labels and numeric oracles stay off the wire.
const matrixSource=`Inverting a two-by-two matrix
Let A=[[a,b],[c,d]] have real entries. Its determinant is det(A)=a*d-b*c. An inverse exists if and only if det(A) is nonzero. When it exists, A_inverse=(1/det(A))*[[d,-b],[-c,a]]. The determinant, rather than the size of each individual entry, decides whether the inverse exists. This statement does not analyze numerical conditioning or the stability of an inversion algorithm.`;
const scaleSource=`Normalizing a scaled real vector
Let v be a nonzero real vector and a be a nonzero real scalar. The Euclidean norm satisfies ||a*v||=|a|*||v||. Therefore (a*v)/||a*v||=(a/|a|)*(v/||v||). This formula includes both positive and negative a; a=0 is excluded because the normalized zero vector is undefined. The identity alone makes no claim about an effect on model training.`;
const matrixBad=String.raw`对于实矩阵 \(A=\begin{pmatrix}a&b\\c&d\end{pmatrix}\)，行列式是 \(ad-bc\)。只要四个元素 \(a,b,c,d\) 全都非零，\(A\) 就必然可逆。`;
const matrixGood=String.raw`对于实矩阵 \(A=\begin{pmatrix}a&b\\c&d\end{pmatrix}\)，行列式是 \(ad-bc\)。矩阵可逆当且仅当 \(ad-bc\ne0\)，不能仅根据各个元素是否非零作判断。`;
const scaleBad=String.raw`对非零实向量 \(v\) 和非零实数 \(a\)，归一化结果满足 \(\frac{av}{\lVert av\rVert}=\frac{a}{|a|}\frac{v}{\lVert v\rVert}\)。因此，只要 \(a\ne0\)，缩放再归一化就一定得到与原向量归一化相同的方向。`;
const scaleGood=String.raw`对非零实向量 \(v\) 和非零实数 \(a\)，归一化结果满足 \(\frac{av}{\lVert av\rVert}=\frac{a}{|a|}\frac{v}{\lVert v\rVert}\)。当 \(a>0\) 时方向相同；当 \(a<0\) 时方向相反。`;
const create=(id,text,source,title,expected,claim,reference)=>({id,split:'development',provenance:'AI 协作编写的新开发探针；与协议一起设计，非独立留出集。',expected,
  snapshot:{documentId:'material',chapterId:'section',revision:1,title,goal:'看懂这段数学结论及其成立条件。',blocks:[{id:'p1',text,sourcePages:[1]}],targetIds:['p1'],source:[{number:1,text:source}]},reference:{claim,...reference}});
const matrixQuote='An inverse exists if and only if det(A) is nonzero.';
const scaleQuote='Therefore (a*v)/||a*v||=(a/|a|)*(v/||v||).';
export const freshOracles={
  matrix:{variables:{a:'1',b:'2',c:'2',d:'4'},left:op('subtract',op('multiply',variable('a'),variable('d')),op('multiply',variable('b'),variable('c'))),right:number(0),relation:'equal'},
  scale:{variables:{a:'-1',v:'2'},left:op('divide',op('multiply',variable('a'),variable('v')),op('absolute',op('multiply',variable('a'),variable('v')))),right:op('divide',variable('v'),op('absolute',variable('v'))),relation:'different'},
};
export const freshCases=[
  create('matrix-overclaim',matrixBad,matrixSource,'Inverting a two-by-two matrix','issue',matrixBad.split('。')[1]+'。',
    {quote:matrixQuote,reason:'四个元素非零不能保证行列式非零。',counterexample:'a=1,b=2,c=2,d=4，四个元素非零，但 ad-bc=0。',after:matrixGood.split('。')[1]+'。',arithmetic:freshOracles.matrix}),
  create('matrix-valid',matrixGood,matrixSource,'Inverting a two-by-two matrix','no-issue-found',matrixGood,{quote:matrixQuote,reason:'按行列式给出正确充要条件。'}),
  create('normalization-valid',scaleGood,scaleSource,'Normalizing a scaled real vector','no-issue-found',scaleGood,{quote:scaleQuote,reason:'明确区分正缩放和负缩放，不引入训练效果保证。'}),
  create('normalization-overclaim',scaleBad,scaleSource,'Normalizing a scaled real vector','issue',scaleBad.split('。')[1]+'。',
    {quote:scaleQuote,reason:'非零缩放可以为负数，负缩放使方向相反。',counterexample:'一维 v=2,a=-1，归一化后分别为 -1 和 1。',after:'当缩放系数为正时方向相同，为负时方向相反。',arithmetic:freshOracles.scale}),
];
