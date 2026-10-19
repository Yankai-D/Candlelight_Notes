# 致谢 · Acknowledgements

Candlelight Notes 感谢以下项目的作者、维护者与贡献者，以及公开教学材料的创作者。产品设计参考、软件依赖和学习资料分别注明，方便读者了解各项工作的来源。

## 产品设计参考

- [EasyRead — Edwardxlai 与贡献者](https://github.com/Edwardxlai/easyread)：论文翻译、原文对照和边读边问的阅读体验，为本项目的文献阅读空间提供了参考。
- [DeepTutor — HKUDS 与贡献者](https://github.com/HKUDS/DeepTutor)：围绕资料展开辅导、学习路径和笔记协作的产品思路，为本项目的学习流程提供了参考。

这两项记录的是产品设计参考；实际安装的软件依赖列在下节。致谢不表示这些项目参与开发、审核或认可 Candlelight Notes。

## 开源组件与开发工具

下表列出主要直接依赖及重要基础组件。许可名称依据本地安装包的声明；准确版本见 `package-lock.json`，完整版权、许可文本及传递依赖声明以所用版本附带的文件为准。

| 项目 | 在本项目中的用途 | 声明的许可 |
| --- | --- | --- |
| [React / React DOM](https://react.dev/) | 界面与交互 | MIT |
| [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) | 可协作编辑的学习笔记正文 | MIT |
| [PDF.js — Mozilla 与贡献者](https://mozilla.github.io/pdf.js/) | PDF 解析、原文页面呈现 | Apache-2.0 |
| [MathJax](https://github.com/mathjax/MathJax-src) | 正文、小纸条和导出的公式呈现 | Apache-2.0 |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown 内容解析 | MIT |
| [Lucide](https://lucide.dev/) | 通用界面图标和学习树中的芽形功能图标 | ISC；保留其许可文件中的 Feather 衍生图标声明 |
| [idb](https://github.com/jakearchibald/idb) | 本地 IndexedDB 存储 | ISC |
| [Zod](https://zod.dev/) | 输入与结构校验 | MIT |
| [jsdom](https://github.com/jsdom/jsdom) | 文档处理 | MIT |
| [Undici](https://github.com/nodejs/undici) | HTTP 请求 | MIT |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | 浏览器自动化、PDF 导出与界面验收 | Apache-2.0 |
| [Electron](https://www.electronjs.org/) | 桌面窗口和内置浏览器运行时 | MIT；Chromium、Node.js 及其组件另附声明 |
| [Node.js](https://nodejs.org/) / [Chromium](https://www.chromium.org/) | 服务和渲染运行时 | 各运行时附带的完整许可与第三方声明 |
| [TypeScript](https://www.typescriptlang.org/) | 类型检查 | Apache-2.0 |
| [Vite](https://vite.dev/) 与 [React 插件](https://github.com/vitejs/vite-plugin-react) | 前端构建 | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | Windows 安装包构建 | MIT |
| [pdf-lib](https://pdf-lib.js.org/) | 原创示例 PDF 生成 | MIT |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | 本地存储测试 | Apache-2.0 |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | React 类型声明 | MIT |

感谢 [Noto Serif SC 的字体作者与贡献者](https://github.com/notofonts/noto-cjk)以及 Google Fonts。源码浏览器版本的中文衬线字体通过 Google Fonts 加载，适用 [SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt)。当前桌面及便携构建移除在线字体请求，使用本机字体。

## 品牌标志

当前采用六款设计提案中的 A「静烛」，以单烛、浅碟烛台和简洁直线底座组成。

当前蜡烛标志由本项目通过 AI 编程协作，从火焰、烛身和烛台的基本几何形状绘制，未使用现成图标库的路径或其他品牌图形。矢量源位于 `shared/brand-mark.mjs`，应用、浏览器和桌面图标共用该源。通用界面仍使用 Lucide，其致谢和许可继续保留。绘制过程说明不等于商标近似检索或注册结论。

## 公开课程资料与改编样稿

DOCX/PPTX 导入使用 [yauzl](https://github.com/thejoshwolfe/yauzl)（MIT）读取压缩包，感谢其对文件大小校验和有界读取的支持。Office 正文组织参考 Microsoft 的 [WordprocessingML](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document) 与 [PresentationML](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document) 文档；本项目实现正文提取，不包含 Microsoft Office 运行时。HTML 解析使用 jsdom，既有致谢与许可继续适用。

感谢 **OpenIntro** 及以下作者提供描述性统计教学资料：

- [OpenIntro Statistics, Fourth Edition](https://www.openintro.org/book/os/)：David Diez、Mine Çetinkaya-Rundel、Christopher D Barr。所用版本的许可为 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。
- [2.1 — Examining Numerical Data](https://docs.google.com/presentation/d/1YpJsHUEHPiuHlH7n0RKNYU3sQ_XX6uX36P92R8-_9sg)：Mine Çetinkaya-Rundel 编写，Curry Hilton 转制为 Google Slides。所用课件标明 [CC BY-SA 3.0 US](https://creativecommons.org/licenses/by-sa/3.0/us/)。
- [2.2 — Considering Categorical Data](https://docs.google.com/presentation/d/1D8PHarhuhj_FLDc2b7l7BoQ3euaHN0dv0V0T5-qttE4)：Mine Çetinkaya-Rundel 编写，Curry Hilton 转制为 Google Slides。所用课件标明 [CC BY-SA 3.0 US](https://creativecommons.org/licenses/by-sa/3.0/us/)。

选编保留所选教学页，增加来源说明页，并删去部分重复页、进阶内容和另有来源的插图。中文讲义样稿进行了翻译、教学重组及算例补充；这些改动由本项目作出，不归于原作者。课程样稿采用 CC BY-SA 3.0，具体范围见源码的 `examples/course/README.md`。

每份选编的作者、来源、许可、修改记录与原始页码映射保存在随包的 `materials/ATTRIBUTION.txt`、`materials/SOURCES.json`（桌面版位于 `resources/materials/`）。这些详细记录应随资料保留，不能用本页的一句致谢替代。选编与改编样稿不是 OpenIntro 官方产品。

## 论文与讲解来源

Adam 文风样稿参考 Diederik P. Kingma、Jimmy Ba 的 [Adam: A Method for Stochastic Optimization](https://arxiv.org/abs/1412.6980)，具体定位保存在 `examples/editorial/adam-bias-correction.mjs` 的 `source` 与 `sourceNote` 中。原论文的研究贡献属于原作者；样稿的教学重述、推导补充和新增算例属于本项目的整理。

其他用户导入、检索获得或用于本地审阅的论文不随干净安装包分发；其来源与作者应保留在各自资料记录中。本页不将论文的可访问性视为统一的再分发授权。

## 随版本保留的说明

源码保留本文件；桌面包附带 `resources/ACKNOWLEDGEMENTS.md`，便携包在根目录附带本文件。打包时生成的 `THIRD-PARTY-NOTICES.txt` 列出实际依赖版本和许可，并保留依赖目录及运行时附带的原始版权与许可文件。

Candlelight Notes 当前尚未选定项目代码的开源许可证。项目代码、第三方组件和教学材料各自的许可范围分别记录；致谢不会改变任何一项原有许可。

项目作者与预定仓库：[Yankai-D · Candlelight Notes](https://github.com/Yankai-D/Candlelight_Notes)。
