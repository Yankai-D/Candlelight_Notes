// Experimental only. Not imported by the application or enabled for users.
export const operationPolicy = Object.freeze({
  id:'operation-consistency-v1', status:'experimental',
  instruction:'文字与公式一致性：解释公式中的操作时，核对操作对象以及变量采用更新前还是更新后的值，使文字所述步骤与公式一致。并列作用于同一旧状态的项，不要改述成依次作用于中间结果；原式确实复合或递推时，保留相应顺序。只在容易混淆处自然说明，不把恒等式强写成算法，不新增检查清单或重复推导。',
});

const provenance={kind:'authored-operation-probe',attribution:'旁烛笔记原创微型论述材料；不是发表论文或学校试题',license:'Project-authored fixture',priorUse:'根据首轮错误类型新编的开发探针；与规则共同设计，非独立留出集。答案与判据不发送给模型。'};
export const operationMaterials=[
  {
    id:'independent-shrink',title:'Independent shrinkage under a fixed scale',templateId:'narrative',split:'development',provenance,
    goal:'理解对角缩放下独立衰减如何作用到参数，能核对给定的一步更新。',
    pages:[{number:1,text:`Independent shrinkage under a fixed scale
Let u be the current parameter vector, h a data gradient evaluated at u, and P a fixed positive diagonal matrix. For step size eta > 0 and rho >= 0, define the one-step update
u_new = (1 - eta*rho)*u - eta*P*h.
This is the sum of a uniformly shrunk current vector and a scaled data-gradient increment. In contrast, adding the quadratic-penalty gradient rho*u inside P gives u_new_coupled = u - eta*P*(h + rho*u). The coupled minus independent difference is -eta*rho*(P-I)*u. P, h and u in these formulas are held fixed for this comparison.
For u=(3,-2), h=(2,-1), P=diag(1/2,2), eta=0.2, rho=0.5, the independent update is (2.5,-1.4); the coupled update is (2.65,-1.2). The comparison isolates whether the coordinate scale also multiplies the penalty contribution. These one-step identities alone give no claim about convergence or prediction accuracy.`}],
    criteria:['解释独立衰减作用于当前 u，不把整个梯度步结果再乘收缩因子；P 和 h 固定。','保留独立与耦合更新、差值、数值和无效果保证的边界。','必要的对象说明融入原有长文，不堆出审计清单。'],
  },
  {
    id:'simultaneous-state',title:'One map on a two-coordinate state',templateId:'narrative',split:'development',provenance,
    goal:'看懂这篇文章',
    pages:[{number:1,text:`One map on a two-coordinate state
A two-coordinate state z=(a,b) is mapped to z_new=(a_new,b_new) by the matrix
M = [[1/2,1/4],[1/4,1/2]], with z_new=M*z.
Thus a_new=a/2+b/4 and b_new=a/4+b/2. The vector on the right-hand side is the state before this map is applied. Both components belong to one application of M. For z=(2,6), the result is (2.5,3.5).
The point of the matrix form is that it specifies one transformation of the whole state, not an in-place loop over coordinates. The first row determines the new first coordinate and the second row determines the new second coordinate. Implementations may store the results in any order provided they implement the same map. This short calculation does not analyze repeated iteration or infer a convergence rate.`}],
    criteria:['两式读取旧状态，不能将 a_new 代入第二式；写入顺序与数值依赖分清。','保留矩阵、两个分量与 (2.5,3.5)，不擅加迭代收敛结论。','不要为解释写入顺序强加原文没有的编程教程。'],
  },
  {
    id:'affine-composition',title:'Offsets and gains in a composed map',templateId:'narrative',split:'development',provenance,
    goal:'理解偏移与缩放的顺序为何影响结果，并核对具体数值。',
    pages:[{number:1,text:`Offsets and gains in a composed map
Consider the scalar map T(x)=c*(x+b), where b is an offset and c is a gain. This map adds b to x and then scales that sum by c. The alternative map S(x)=c*x+b scales x and then adds the offset. Expanding the first map gives T(x)=c*x+c*b, so T(x)-S(x)=(c-1)*b.
For x=2, b=3 and c=4, T(x)=20 whereas S(x)=11. They coincide when (c-1)*b=0, for example c=1 or b=0; this condition is independent of x. The order matters because scaling acts on the offset in T but not in S. This algebraic example concerns only the two specified affine maps, with no claim that either is preferable for a measurement system.`}],
    criteria:['保留真正的复合操作：T 先偏移后缩放，S 先缩放后偏移，不一律禁止顺序描述。','保留 20、11、(c-1)b 及相等条件，不能声称一切情况都不等。','解释顺序的数学原因即可，不新增算法检查栏目。'],
  },
  {
    id:'variance-identity',title:'A variance identity without an update rule',templateId:'narrative',split:'development',provenance,
    goal:'理解二阶原点矩、方差与均值的关系及成立条件。',
    pages:[{number:1,text:`A variance identity without an update rule
Let X be a real random variable with finite second moment and let mu=E[X]. By expanding the square and using linearity of expectation,
Var(X)=E[(X-mu)^2]=E[X^2]-2*mu*E[X]+mu^2=E[X^2]-mu^2.
The second raw moment E[X^2] and the variance differ by mu^2. They are equal when mu=0. If X takes 1 and 3 with equal probabilities, mu=2, E[X^2]=5 and Var(X)=1.
Squaring the mean instead gives (E[X])^2=4 in this example. Expectation and squaring cannot generally be exchanged. This is an identity between distributional quantities, not a recurrence that updates X or mu. No sampling estimator or normality assumption is needed for the identity.`}],
    criteria:['保留有限二阶矩、展开、均值为零时相等及 (2,5,1,4) 的数值。','不交换平方与期望，不混称二阶原点矩为方差。','无需更新算法，不引入新旧状态变量或检查清单；保留自然长文。'],
  },
];

// Numeric adjudication aids, not automatically scored model-output answers.
// Keep them separate from generation requests and frozen prompt messages.
export const operationOracles={
  'independent-shrink':{u:[3,-2],h:[2,-1],p:[0.5,2],eta:0.2,rho:0.5,expected:[2.5,-1.4],alternative:[2.52,-1.44]},
  'simultaneous-state':{state:[2,6],matrix:[[0.5,0.25],[0.25,0.5]],expected:[2.5,3.5],alternative:[2.5,3.625]},
  'affine-composition':{x:2,b:3,c:4,expected:20,alternative:11},
  'variance-identity':{values:[1,3],probabilities:[0.5,0.5],mean:2,rawSecond:5,variance:1,squaredMean:4},
};
