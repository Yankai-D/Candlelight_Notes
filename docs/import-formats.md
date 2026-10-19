# 资料导入格式

当前源码支持文字 PDF、DOCX、PPTX、HTML/HTM、Markdown 和 TXT，单文件最大 50 MB。JSON 仅用于本工具的笔记备份，备份中的原文文字不等于原始文件。原件、提取的正文和学习笔记分别承担存档、来源定位和讲解作用；不执行文档中的指令、脚本、宏或外部链接。

| 格式 | 提取方式与边界 |
| --- | --- |
| PDF | 按原始页和书签提取，最多 1000 页；无文字的扫描件仍需外部 OCR。 |
| DOCX | 按标题、段落和表格单元格顺序读取，常见 Office 分式、根式、上下标转为 LaTeX。合并单元格、复杂公式、嵌入对象、脚注和原始版式需核查原件。 |
| PPTX | 使用 presentation 与关系文件中的顺序定位幻灯片，不按文件名排序。提取每张的文字；图片、图表、动画、演讲者备注不转换。纯图片课件不支持 OCR。 |
| HTML/HTM | 提取主文标题、段落、列表、表格与图片替代文字；保留链接文字，不读取链接。移除脚本、样式、表单和导航等内容；不还原网页外观。 |
| Markdown/TXT | 保留文字，Markdown 一级／二级标题参与章节分段。 |

旧版二进制 DOC/PPT 请先另存为 DOCX/PPTX；Excel 和其他未列出的格式暂未接入。Word 和网页使用文字片段定位，片段号不表示原排版页码。非 PDF 的“原文对照”显示已提取的正文，原文件按原始字节配套保存；图片和复杂视觉信息不被伪造为文字。

选择文件后，导入窗口禁用框外点击、Esc 和关闭图标，使用底部“取消”放弃本次导入。读取完成若有内容限制，先展示说明，用户确认后才保存；解析错误不会保存半份资料。取消和确认按钮固定在弹窗底部，正文区域可滚动。保存位置仍在每次导入时确认。

## 工程约束

文件格式、MIME 和标准原件名由 `shared/material-formats.mjs` 管理；新增原件接入存储、重新识别、缺失恢复、完整备份和统一迁移。正文继续使用原有 pages/chapters 契约，讲解模板、模型路由与协作编辑协议不因文件格式变化而分叉。读取限制 `sourceWarnings` 随笔记和 JSON 备份保留，展开原文时可查看。

Office/HTML 在独立 Worker 中解析，30 秒超时、256 MB 堆限制；输入不落临时磁盘。ZIP 最多 5000 条目，读取的单 XML 最大 16 MB、总 XML 最大 32 MB；拒绝加密、重复路径、异常路径、实体声明和过量展开。提取正文最多 4194304 个 UTF-16 单元；客户端沿用每片 16000 字、最多 300 章节的限制。接口要求会话令牌，携带的空间标记必须有效；不要求模型 Key，也不调用模型。

实现参考 Microsoft 的 [WordprocessingML](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document)、[PresentationML](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)，ZIP 读取使用 [yauzl](https://github.com/thejoshwolfe/yauzl)，HTML/XML 解析使用 jsdom。具体边界由测试和实际读取说明给出，不声称完整支持所有 Office 对象。
