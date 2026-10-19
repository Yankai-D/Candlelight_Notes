const components = [
  ['React', 'https://react.dev/'],
  ['Tiptap / ProseMirror', 'https://tiptap.dev/'],
  ['PDF.js', 'https://mozilla.github.io/pdf.js/'],
  ['MathJax', 'https://github.com/mathjax/MathJax-src'],
  ['markdown-it', 'https://github.com/markdown-it/markdown-it'],
  ['Lucide', 'https://lucide.dev/'],
  ['Electron', 'https://www.electronjs.org/'],
  ['Node.js', 'https://nodejs.org/'],
]

export function Acknowledgements() {
  return <details className="help-acknowledgements">
    <summary>致谢与来源 · Acknowledgements</summary>
    <section>
      <h3>产品设计参考</h3>
      <p>感谢 <a href="https://github.com/Edwardxlai/easyread" target="_blank" rel="noopener noreferrer">EasyRead（Edwardxlai 与贡献者）</a>的论文翻译与原文对照体验，以及 <a href="https://github.com/HKUDS/DeepTutor" target="_blank" rel="noopener noreferrer">DeepTutor（HKUDS 与贡献者）</a>的资料辅导与笔记协作思路。</p>
      <h3>课程资料</h3>
      <p>描述性统计示例来自 <a href="https://www.openintro.org/book/os/" target="_blank" rel="noopener noreferrer">OpenIntro</a>。教材作者为 David Diez、Mine Çetinkaya-Rundel、Christopher D Barr；课件由 Mine Çetinkaya-Rundel 编写、Curry Hilton 转制。</p>
      <p>教材采用 <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 3.0</a>，所用课件采用 <a href="https://creativecommons.org/licenses/by-sa/3.0/us/" target="_blank" rel="noopener noreferrer">CC BY-SA 3.0 US</a>。选编、中文重述和补充由本项目作出，详细修改及页码记录随资料附带。</p>
      <h3>开源组件</h3>
      <p>感谢以下组件及其他依赖的作者、维护者与贡献者：</p>
      <ul>{components.map(([name, url]) => <li key={name}><a href={url} target="_blank" rel="noopener noreferrer">{name}</a></li>)}</ul>
      <p>完整项目致谢随源码和分发包的 ACKNOWLEDGEMENTS.md 提供；依赖版本、许可和运行时版权另附于 THIRD-PARTY-NOTICES.txt 及相应许可文件。上述作者和项目未对本产品作出背书。</p>
    </section>
  </details>
}
