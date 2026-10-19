import { createDemo } from '../../src/demo.ts';
import { paragraph } from '../../shared/document.mjs';

export function inlineMathDocument() {
  const document = createDemo();
  document.title = 'Adam：更新规则';
  document.subtitle = '段内公式与正文的连续阅读';
  document.notebookLabel = '纯翻译';
  document.chapters = [{ ...document.chapters[0], title: '2.1 Adam 的更新规则', subtitle: '', content: { type: 'doc', content: [
    paragraph(String.raw`Adam 更新规则的一个重要性质，是它对步长的谨慎选择。假设 \(\epsilon=0\)，那么在第 \(t\) 步于参数空间中实际迈出的有效步长为 \(\Delta_t=\alpha\cdot\hat m_t/\sqrt{\hat v_t}\)。这个有效步长有两个上界：当 \((1-\beta_1)>\sqrt{1-\beta_2}\) 时，\(|\Delta_t|\leq\alpha\cdot(1-\beta_1)/\sqrt{1-\beta_2}\)；在其余情形下，\(|\Delta_t|\leq\alpha\)。`),
    paragraph(String.raw`第一个情况（即 \((1-\beta_1)>\sqrt{1-\beta_2}\)）只会在最极端的稀疏情形下发生：某个梯度除了当前这一时间步之外，在之前所有时间步上都是零。对于那么稀疏的情形，有效步长会更小。当 \((1-\beta_1)=\sqrt{1-\beta_2}\) 时，有 \(|\hat m_t/\sqrt{\hat v_t}|<1\)，因此 \(|\Delta_t|<\alpha\)。`),
    paragraph(String.raw`在更常见的情形里，由于 \(|\mathbb{E}[g]/\sqrt{\mathbb{E}[g^2]}|\leq1\)，我们会得到 \(\hat m_t/\sqrt{\hat v_t}\approx\pm1\)。于是每一步在参数空间中实际移动的幅度大致被步长设定 \(\alpha\) 所界定，即 \(|\Delta_t|\lesssim\alpha\)。`),
    paragraph(String.raw`这个界可以理解为在当前参数值周围建立了一个信赖域（trust region）：一旦越出这个范围，当前的梯度估计就不足以提供可靠信息了。它的实际好处是，我们通常比较容易事先判断 \(\alpha\) 该取什么量级。`),
    { type: 'explanation', attrs: { title: '局部计算如何回到更新幅度', sourcePages: [3], origin: 'user' }, content: [paragraph(String.raw`由 \(\hat m_t/\sqrt{\hat v_t}\) 调整方向和相对尺度，\(\alpha\) 再决定整体步长。小纸条中的行内公式也遵循同样的基线和换行规则。`)] },
    paragraph(String.raw`独立公式：\[\theta_t=\theta_{t-1}-\alpha\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}\]`),
  ] } }];
  return document;
}
