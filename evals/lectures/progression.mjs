// Project-authored multi-chapter fixture. No user course files or model output.
export const progression = {
  intent: '学会从有序数组设计二分查找，解释正确性并分析最坏时间。',
  sources: [
    '有序数组允许重复值。例题数据为 [1,3,3,7]，下标从零开始。lower bound 是第一个不小于目标的位置；若不存在返回数组长度 n。对目标 3，结果应为 1，不能任选一个值为 3 的位置。',
    '维护半开区间 [l,r)，初始 l=0,r=n。已排除的左侧元素均小于目标，右侧有效元素均不小于目标。取 m=l+floor((r-l)/2)；a[m]<t 时令 l=m+1，否则令 r=m。对 [1,3,3,7] 和 t=3，区间依次为 [0,4)、[0,2)、[0,1)、[1,1)，返回 1。',
    '正确性需要初始化、保持和终止三个依据。两种更新都严格减少非负整数 r-l，故必终止；结束时 l=r，结合区间外性质可知 l 正是第一个不小于目标的位置。最坏每轮待查区间长度至多折半，查询时间 O(log(n+1))。求第一个严格大于目标时，将排除条件改为 a[m]<=t；原例返回 3。',
  ],
  sections: [
    {title:'有序信息与查询目标',purpose:'确定查询返回值及重复元素的边界。',unitIds:['unit-1'],requirementIds:['r1'],dependsOn:[],handoff:'查询语义约束下一章的排除方式。'},
    {title:'用不变量构造查找程序',purpose:'从边界约定得到可执行的更新。',unitIds:['unit-2'],requirementIds:['r1'],dependsOn:[1],handoff:'程序构造为验证与成本分析提供对象。'},
    {title:'验证程序并比较条件变化',purpose:'说明为何总停机、答案正确以及条件改变后的更新。',unitIds:['unit-3'],requirementIds:['r1'],dependsOn:[1,2],handoff:'能在新数据和不同查询条件下使用该方法。'},
  ],
  teachingPlan: {version:1,throughline:'查询究竟要返回什么 → 如何利用顺序排除候选 → 为什么程序正确且高效。',concepts:[
    {id:'t1',title:'有序查询的边界语义',objective:'区分任意匹配与第一个满足条件的位置。',prerequisites:[],unitIds:['unit-1'],placements:[
      {section:1,role:'introduce',advance:'明确重复值和未找到时的返回值。',difficultPoint:'相等不表示可以立即返回。',check:'能说出原例为什么返回 1 而非 2。'},
      {section:2,role:'apply',advance:'依据最左位置要求选择保留哪一侧。',difficultPoint:'当前中点可能就是答案。',check:'能解释为什么右边界更新为 m 而非 m-1。'},
      {section:3,role:'deepen',advance:'把查询条件改为严格大于，并辨认需改的一步。',difficultPoint:'相等时的排除方向改变。',check:'能给出新条件下的返回位置。'},
    ]},
    {id:'t2',title:'区间不变量',objective:'由已排除部分的性质推出正确更新。',prerequisites:['t1'],unitIds:['unit-2'],placements:[
      {section:2,role:'introduce',advance:'把边界语义写成不变量并构造两种更新。',difficultPoint:'边界处与空区间都必须成立。',check:'能手动重放原例的每次更新。'},
      {section:3,role:'deepen',advance:'用不变量和严格下降量共同证明程序。',difficultPoint:'正确性与终止性是两个证明义务。',check:'能分别给出答案正确和总停机的理由。'},
    ]},
    {id:'t3',title:'最坏查询成本',objective:'从区间收缩推出查询时间界。',prerequisites:['t2'],unitIds:['unit-3'],placements:[
      {section:3,role:'introduce',advance:'由每轮至多折半给出最坏时间，而非从一次运行猜测。',difficultPoint:'区分单个算例的步数与一般上界。',check:'能说明空数组和一般 n 下的成本口径。'},
    ]},
  ],examples:[{id:'e1',title:'在 [1,3,3,7] 中查询目标 3',unitIds:['unit-1','unit-2','unit-3'],uses:[
    {section:1,conceptIds:['t1'],purpose:'区分任意匹配与最左匹配。'},
    {section:2,conceptIds:['t1','t2'],purpose:'重放区间更新，观察为什么不能跳过中点。'},
    {section:3,conceptIds:['t1','t2','t3'],purpose:'比较严格大于的变体，区分轨迹与最坏上界。'},
  ]}]},
  prose: [
    ['在有序数组中，先明确要找的是任意匹配，还是第一个满足条件的位置。lower bound 返回第一个不小于目标的位置，不存在时返回数组长度。',
      '对 [1,3,3,7] 查目标 3，答案是下标 1。下标 2 虽然也等于 3，却不满足“第一个”的要求；这个区别将决定下一章如何排除候选。'],
    ['用半开区间 [l,r) 保存待查范围：左侧已经确认小于目标，右侧有效位置已经确认不小于目标。取中点 m；若 a[m]<t，令 l=m+1，否则令 r=m。后一个分支仍保留中点，因为它可能就是最左答案。',
      '沿用 [1,3,3,7] 与目标 3，区间依次为 [0,4)、[0,2)、[0,1)、[1,1)，返回 1。这里复用原例是为了检查更新，不再重新定义查询任务。'],
    ['正确性与终止性分开说明：初始化时两侧为空，不变量成立；两种更新保持它，且非负整数 r-l 严格下降，所以总会结束。结束时 l=r，左侧全小于目标而右侧全不小于目标，返回位置因而正确。',
      '若查询改成第一个严格大于目标的位置，相等时也应排除中点，条件改成 a[m]<=t。原例返回 3。一般 n 下，每轮剩余区间至多折半，最坏时间为 O(log(n+1))；原例的三轮运行仅是一次轨迹，不能代替一般证明。'],
  ],
  humanReview: [
    '仅读成品，能否解释第一个匹配与任意匹配的区别？',
    '能否推导而非背诵两种边界更新？',
    '能否区分正确性、终止性、单次轨迹与最坏上界？',
    '同例三次出现是否分别贡献语义、执行与条件迁移，而非重讲？',
    '有无缺失前提、空泛铺垫或由删减造成的推理跳步？',
  ],
};
