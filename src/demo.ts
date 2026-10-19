import type { LearningDocument } from './types'
import { withIds, paragraph, textOf } from '../shared/document.mjs'
import { defaultLearningIntent } from '../shared/learning-intent.mjs'

const text = (s: string, bold?: boolean) => ({ type: 'text', text: s, ...(bold ? { marks: [{ type: 'bold' }] } : {}) })
const p = (s: string) => paragraph(s)
const h = (s: string) => ({ type: 'heading', attrs: { level: 2 }, content: [text(s)] })
const list = (items: string[]) => ({ type: 'bulletList', content: items.map(s => ({ type: 'listItem', content: [p(s)] })) })
const note = (title: string, content: string, sourcePages: number[]) => ({ type: 'explanation', attrs: { title, sourcePages, origin: 'example' }, content: [p(content)] })
const doc = (content: object[]) => withIds({ type: 'doc', content })

export const sourcePages = [
  { number: 1, text: 'A Short Guide to Attention\n01 / Why attention?\nCandlelight Notes original teaching material\n\nA sequence model needs a way to combine information from different positions. A fixed-size summary can become a bottleneck: details that matter for one prediction may be irrelevant for another. Attention provides a flexible alternative. It computes a weighted combination of available information, with the weights depending on the current query.\n\nIn this guide we move from an intuitive retrieval example to scaled dot-product attention and multi-head attention. Our goal is to understand what queries, keys, and values do, and why attention weights should not automatically be interpreted as causal explanations.\n\nLearning outcomes: explain the roles of Q, K, and V; trace the dimensions of the attention operation; describe the motivation for scaling; identify a limitation of interpreting attention maps.' },
  { number: 2, text: '02 / The idea of attention\n\nAttention can be understood as content-based retrieval. A query represents what information is needed. Keys describe the available items, and values carry the information to be combined. Similarity scores between the query and each key are transformed into nonnegative weights that sum to one. The output is a weighted sum of the values.\n\nConsider reading the sentence: The animal did not cross the street because it was tired. To build a useful representation for it, a model may draw on other words in the sentence. Attention allows every query position to combine information from other positions. This is a teaching example, not an empirical claim about a particular trained model.\n\nA library analogy: the query is your question, keys are catalogue descriptions, and values are the actual book contents. In a neural network these are vectors, not literal questions or books. The analogy illustrates retrieval, but does not explain how the representations are learned.' },
  { number: 3, text: '02 / Queries, keys, and values\n\nIn self-attention, queries, keys, and values are derived from the same input sequence using different learned linear projections: Q = X W_Q, K = X W_K, V = X W_V. In cross-attention, queries and key-value pairs may come from different sequences.\n\nEach attention output mixes value vectors. Similarity is computed using queries and keys. Keeping separate projections lets the model learn different spaces for matching and for passing information. The projections are learned jointly with the rest of the network.\n\nAttention weights describe the mixing performed by this operation. They do not by themselves establish which tokens caused a final decision. Other heads, layers, residual connections, and nonlinear transformations also affect the result.' },
  { number: 4, text: '03 / Scaled dot-product attention\n\nAttention(Q, K, V) = softmax(Q K^T / sqrt(d_k)) V\n\nFor n query positions and m key positions, Q has shape n by d_k, K has shape m by d_k, and V has shape m by d_v. Q K^T produces an n by m score matrix. A row-wise softmax converts each query row into weights. Multiplication by V produces an n by d_v output.\n\nIf independent query and key components have zero mean and unit variance, the variance of their dot product grows with d_k. Dividing by sqrt(d_k) keeps the scale more stable under these simplifying assumptions. This can help avoid an overly peaked softmax early in training.\n\nA mask can remove disallowed positions before softmax. A causal mask prevents a position from attending to future positions. Padding masks prevent padded positions from contributing.' },
  { number: 5, text: '04 / Multiple perspectives\n\nMulti-head attention performs several attention operations using separate learned projections. Each head can represent a different pattern of relationships, although there is no guarantee that a head corresponds to a clean human-interpretable concept.\n\nThe outputs of the heads are concatenated and projected again: MultiHead(Q,K,V) = Concat(head_1,...,head_h) W_O. The output projection combines information gathered by the different heads.\n\nSelf-attention alone does not encode sequence order. Positional information must be supplied through additional mechanisms. Attention also does not replace all computation in a Transformer: feed-forward blocks, normalization, and residual paths are important parts of the architecture.' },
  { number: 6, text: '05 / Check your understanding\n\n1. Which vectors determine the attention scores, and which vectors are mixed to produce the output?\n2. If Q is 8 by 64, K is 12 by 64, and V is 12 by 32, what are the shapes of the score matrix and the final output?\n3. Why is the scaling factor sqrt(d_k) instead of d_k under the simplifying variance argument?\n4. Why is an attention heatmap not a complete causal explanation of a model prediction?\n\nSuggested answers: Scores use queries and keys; the output mixes values. The score matrix is 8 by 12 and the output is 8 by 32. The standard deviation, not the variance, scales with sqrt(d_k). Attention describes one mixing operation inside a larger computation, so causal claims require additional evidence.\n\nThis is an original educational example created for the Candlelight Notes workspace. It is not a reproduction or translation of a published paper.' },
]

export function createDemo(): LearningDocument {
  const now = Date.now()
  const example: LearningDocument = {
    id: 'attention-demo', title: 'Attention：从直觉到理解', subtitle: 'A Short Guide to Attention',
    filename: 'attention-field-notes.pdf', kind: 'pdf', intent: defaultLearningIntent, intentSource: 'default',
    createdAt: now, updatedAt: now, revision: 0, demo: true, pages: sourcePages,
    currentChapter: 'attention', currentPage: 2, versions: [],
    chapters: [
      { id: 'intro', title: '为什么需要注意力', subtitle: '从一个问题开始', sourcePages: [1], status: 'ready', content: doc([
        p('读一段文字时，我们并不会给每个词同样的关注。序列模型同样需要一种机制，根据当前任务，从不同位置的信息中找到有用的部分。'),
        h('固定摘要的局限'), p('把整段输入压缩成一个固定大小的向量，可能形成信息瓶颈：对当前预测很重要的细节，未必能被完整保留。Attention 提供了另一种方式——根据当前的查询，动态组合可用的信息。'),
        h('这份讲义的阅读路线'), list(['先理解注意力在做什么，再认识 Query、Key、Value。', '沿着张量形状读懂缩放点积注意力公式。', '理解多头机制，并谨慎解释注意力权重。']),
      ]) },
      { id: 'attention', title: '注意力的核心直觉', subtitle: '让模型知道，什么值得关注', sourcePages: [2, 3], status: 'ready', content: doc([
        { type: 'paragraph', content: [text('注意力机制的核心很简单：'), text('根据当前需要，给不同的信息分配不同的权重。', true), text('它让模型在处理一个位置时，能够有选择地关注其他位置，再把这些信息组合起来。')] },
        h('01　先理解「关注」这件事'),
        p('试着读这句话：“那只动物没有穿过马路，因为它太累了。”理解“它”时，我们会回头寻找相关的词。注意力机制提供了一种类似的信息聚合方式，让当前词的表示能够吸收其他位置的信息。'),
        p('这里的“关注”并不是人的意识活动，而是一次可计算的加权求和：相关程度决定权重，权重决定不同信息进入结果的比例。'),
        note('像在图书馆里，带着问题找书', '把 Query 想成你想解决的问题，Key 想成每本书的目录，Value 则是书里的实际内容。你先用问题与目录匹配，再把最相关的内容带回来。模型做的事情与之相似，只不过问题、目录和内容都变成了向量。', [2]),
        h('02　三种角色，一个协作过程'),
        list(['Query（查询）：「我现在需要什么信息？」描述当前的信息需求。', 'Key（键）：「我这里有什么？」用于和查询计算匹配程度。', 'Value（值）：「我能提供什么内容？」真正被加权组合的信息。']),
        p('在自注意力中，Q、K、V 来自同一段输入，但经过三个不同的线性投影。分开学习这些投影，让模型可以分别优化“怎样匹配”和“传递什么”。'),
        h('03　读到这里，记住一个边界'),
        p('注意力权重展示的是这一层如何混合信息。它本身不能完整解释模型为什么做出最终判断——其他注意力头、后续层与残差连接同样会影响结果。'),
      ]) },
      { id: 'formula', title: '把直觉写成公式', subtitle: '一步步拆解 Scaled Dot-Product', sourcePages: [4], status: 'ready', content: doc([
        p('缩放点积注意力把前面“匹配、分配权重、汇总信息”的过程写成一个紧凑的公式。'),
        { type: 'blockquote', content: [p('Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V')] },
        h('跟着形状理解运算'), list(['QKᵀ：每个 Query 与所有 Key 做点积，得到匹配分数。', '除以 √dₖ：在简化假设下，稳定点积的尺度。', 'softmax：逐行把分数转换为和为 1 的非负权重。', '乘 V：按这些权重组合 Value，得到新的表示。']),
        note('为什么是平方根？', '假设 Q 与 K 的各分量相互独立、均值为 0 且方差为 1，dₖ 个乘积相加后，点积的方差约为 dₖ，标准差约为 √dₖ。用标准差缩放，能让输入 softmax 的数值尺度更稳定。这是帮助理解的简化推导。', [4]),
        h('用一个维度例子检查理解'), p('若 Q 为 8 × 64，K 为 12 × 64，V 为 12 × 32，则分数矩阵是 8 × 12，最终输出是 8 × 32。每个查询位置都获得了一个 32 维的信息汇总。'),
      ]) },
      { id: 'multihead', title: '多头，多一种视角', subtitle: '让不同关系同时被看见', sourcePages: [5], status: 'ready', content: doc([
        p('多头注意力使用多组独立学习的投影，同时进行几次注意力运算。不同的头可以学习不同的信息关系，之后将结果拼接，再通过输出投影组合。'),
        h('不是给每个头安排固定工作'), p('我们有时会用“一个头看语法、另一个头看语义”来建立直觉，但这并不是机制的保证。训练得到的注意力头未必对应清晰的人类概念。'),
        h('注意力之外'), list(['自注意力本身不携带顺序，需要额外的位置机制。', '前馈网络进一步处理每个位置的表示。', '归一化和残差路径帮助信息流动与训练。']),
      ]) },
      { id: 'review', title: '停一下，检查理解', subtitle: '把读过的变成自己的', sourcePages: [6], status: 'ready', content: doc([
        p('合上公式，试着用自己的话回答下面几个问题。也可以在题目后添加一张小纸条，写下你目前的理解。'),
        h('三个值得带走的问题'), list(['谁负责计算匹配分数，谁携带真正被组合的信息？', '为什么要除以 √dₖ？这个推导依赖哪些假设？', '一张注意力热力图，能否完整说明模型做出判断的原因？']),
        h('回看答案'), p('Query 与 Key 决定匹配分数，Value 被加权组合。缩放基于独立、零均值、单位方差的简化假设。注意力只是模型内部的一次混合运算，因果解释还需要更多证据。'),
      ]) },
    ],
  }
  const attentionQuotes = ['Attention can be understood as content-based retrieval.', 'Consider reading the sentence:', 'Consider reading the sentence:', 'The output is a weighted sum of the values.', '', 'In self-attention,', 'Each attention output mixes value vectors.', 'Keeping separate projections', 'Attention weights describe the mixing', 'Attention weights describe the mixing']
  for (const chapter of example.chapters) chapter.content.content?.forEach((block, index) => {
    if (block.type === 'explanation') return
    block.attrs = { ...block.attrs, sourcePages: [chapter.id === 'attention' ? index < 5 ? 2 : 3 : chapter.sourcePages[0]], sourceQuote: chapter.id === 'attention' ? attentionQuotes[index] || '' : '' }
  })
  return example
}

// Add source anchors to existing demo notebooks without replacing user edits.
export function hydrateDemoSources(document: LearningDocument): LearningDocument {
  if (!document.demo) return document
  const reference = createDemo()
  return { ...document, chapters: document.chapters.map(chapter => ({ ...chapter, content: { ...chapter.content, content: chapter.content.content?.map(block => {
    if (block.type === 'explanation' || block.attrs?.sourcePages?.length) return block
    const match = reference.chapters.find(c => c.id === chapter.id)?.content.content?.find(b => textOf(b) === textOf(block))
    return match ? { ...block, attrs: { ...block.attrs, sourcePages: match.attrs?.sourcePages, sourceQuote: match.attrs?.sourceQuote } } : block
  }) } })) }
}
