import { crc32, deflateRawSync } from 'node:zlib';
// Small authored OOXML fixtures, with ZIP metadata rather than renamed text.
export function zipFixture(files) {
  const chunks=[],directory=[];let offset=0;
  for(const [name,value] of Object.entries(files)) {
    const filename=Buffer.from(name),data=Buffer.from(value),compressed=deflateRawSync(data),crc=crc32(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    chunks.push(header,filename,compressed);directory.push(central,filename);offset+=header.length+filename.length+compressed.length;
  }
  const end=Buffer.alloc(22),size=directory.reduce((n,b)=>n+b.length,0);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...directory,end]);
}
export const wordXML=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>
<w:p><w:pPr><w:pStyle w:val="MyHeading"/></w:pPr><w:r><w:t>中文概率讲义</w:t></w:r></w:p>
<w:p><w:r><w:t>样本均值用于估计总体均值，原文需要完整保留。</w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>n</m:t></m:r></m:den></m:f><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>统计量</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>均值</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>方差</w:t></w:r></w:p><w:p><w:r><w:t>方差表示离散程度。</w:t></w:r></w:p></w:body></w:document>`;
export const docxFixture=()=>zipFixture({'word/document.xml':wordXML,'word/styles.xml':'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="MyHeading"><w:name w:val="heading 1"/></w:style></w:styles>'});
export const slideXML=title=>`<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>样本均值与总体参数的关系</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
export const pptxFixture=()=>zipFixture({'ppt/presentation.xml':'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="2" r:id="second"/><p:sldId id="1" r:id="first"/></p:sldIdLst></p:presentation>',
'ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
'ppt/slides/slide1.xml':slideXML('第二张'), 'ppt/slides/slide2.xml':slideXML('第一张')});
export const htmlFixture=()=>Buffer.from('<!doctype html><html><head><meta charset="utf-8"><title>HTML 复习讲义</title><script>globalThis.importExecuted=true;fetch("https://example.invalid/leak")</script></head><body><nav>UNWANTED NAVIGATION</nav><main><h1>概率入门</h1><p>事件与概率的定义。</p><h2>期望</h2><p>期望是加权平均。</p><table><tr><th>数值</th><th>概率</th></tr><tr><td>2</td><td>0.5</td></tr></table><img src="https://example.invalid/image" alt="分布图"><a href="javascript:alert(1)">只有链接文字</a></main></body></html>');
