import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { createDemo } from '../src/demo.ts';
import { paragraph } from '../shared/document.mjs';
import { compileResult } from '../shared/note-format.mjs';

test('rich editor and independent notebooks preserve edits, selection, history and persistence', { timeout: 60000 }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:5173', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'DocumentFragment', 'MutationObserver', 'DOMParser', 'getComputedStyle']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.innerHeight = 900;
  globalThis.innerWidth = 1440;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  dom.window.matchMedia = () => ({ matches: true });
  const rect = (top, height = 100) => ({ top, bottom: top + height, left: 0, right: 700, width: 700, height, x: 0, y: top, toJSON() {} });
  dom.window.HTMLElement.prototype.scrollTo = function (options) {
    this.scrollTop = options.top || 0;
    if (this.classList.contains('article-scroll')) this.dispatchEvent(new dom.window.Event('scroll'));
  };
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('article-scroll')) return rect(0, 600);
    const section = this.closest('[data-note-chapter]');
    if (section) {
      const sections = [...dom.window.document.querySelectorAll('[data-note-chapter]')];
      const top = 200 + sections.indexOf(section) * 1500 - (dom.window.document.querySelector('.article-scroll')?.scrollTop || 0);
      if (this === section) return rect(top, 1500);
      const prose = section.querySelector('.note-prose');
      let block = this;
      while (block.parentElement && block.parentElement !== prose && block !== section) block = block.parentElement;
      return rect(top + 170 + Math.max(0, [...(prose?.children || [])].indexOf(block)) * 100);
    }
    return rect(0);
  };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList.contains('article-scroll') ? 600 : 250; } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList.contains('article-scroll') ? 8000 : 1500; } });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { NoteEditor } = await vite.ssrLoadModule('/src/components/NoteEditor.tsx');
  const storage = await vite.ssrLoadModule('/src/storage.ts');
  const document = createDemo();
  const content = document.chapters[1].content;
  let editor, changed, selectedContext;
  const root = createRoot(dom.window.document.getElementById('root'));
  const originalFetch = globalThis.fetch;
  // This suite exercises the legacy IndexedDB adapter. New file-backed storage
  // and migration are covered against a real server in browser/file-storage.mjs.
  globalThis.fetch = async url => {
    if (url === '/api/config') return new Response(JSON.stringify({ fileStorage: false, token: 'test-session' }));
    throw new Error('Unexpected test URL: ' + url);
  };
  try {
    await React.act(async () => { root.render(React.createElement(NoteEditor, { content, identity: 'test', onChange: c => { changed = c; }, onSelection: c => { selectedContext = c; }, onReady: e => { editor = e; }, onAddNote: () => {} })); });
    assert.ok(editor);
    assert.equal(dom.window.document.querySelectorAll('.paper-note').length, 1);
    assert.match(dom.window.document.querySelector('.paper-note-body').textContent, /图书馆|Query/);
    const before = editor.getJSON();
    await React.act(async () => { editor.commands.setTextSelection({ from: 1, to: 6 }); editor.commands.insertContent('测试改写'); });
    assert.ok(changed);
    assert.match(editor.getText(), /^测试改写/);
    assert.equal(editor.getJSON().content.filter(n => n.type === 'explanation').length, 1);
    await React.act(async () => { editor.commands.undo(); });
    assert.deepEqual(editor.getJSON(), before);
    await React.act(async () => { editor.commands.insertContentAt(editor.state.doc.content.size, paragraph(String.raw`条件 \(\frac{\beta_1^2}{\sqrt{\beta_2}}<1\)`)); });
    let mathPosition;
    editor.state.doc.descendants((node,pos)=>{if(node.type.name==='math') mathPosition=pos;});
    assert.ok(dom.window.document.querySelector('.math-node svg [data-mml-node="mfrac"]'));
    await React.act(async () => { editor.commands.setNodeSelection(mathPosition); });
    assert.match(selectedContext.text,/\\frac/,'Selecting a rendered formula sends its LaTeX to the model');
    await React.act(async () => { dom.window.document.querySelector('.math-node').dispatchEvent(new dom.window.MouseEvent('dblclick',{bubbles:true})); });
    assert.ok(dom.window.document.querySelector('[aria-label="编辑公式"]'));
    assert.match(dom.window.document.querySelector('[aria-label="公式 LaTeX"]').value,/\\beta/);
    await React.act(async () => { dom.window.document.querySelector('.math-edit-actions .secondary').click(); });
    await React.act(async () => { editor.commands.undo(); });
    assert.deepEqual(editor.getJSON(),before,'Undo preserves the original note after adding a formula');
    const notePosition = (() => { let pos = 0; for (const node of editor.state.doc.content.content) { if (node.type.name === 'explanation') return pos; pos += node.nodeSize; } })();
    await React.act(async () => { editor.commands.setTextSelection(notePosition + 2); editor.commands.insertContent('我的个性化补充。'); });
    assert.match(dom.window.document.querySelector('.paper-note-body').textContent, /我的个性化补充/);
    document.chapters[1].content = editor.getJSON();
    await storage.saveDocument(document);
    const loaded = await storage.readDocuments();
    assert.equal(loaded.length, 1);
    assert.equal(JSON.stringify(loaded[0].chapters[1].content), JSON.stringify(editor.getJSON()));
    await storage.saveFile(document.id, new Blob(['test source']));
    assert.equal(await (await storage.readFile(document.id)).text(), 'test source');
    await storage.setPreference('active-document', document.id);
    assert.equal(await storage.getPreference('active-document'), document.id);

    // Exercise the actual application state machine. PDF layout is tested
    // separately; a text source keeps this DOM test independent of canvas.
    document.kind = 'text'; document.demo = false;
    await storage.saveDocument(document);
    let aiRequest;
    globalThis.fetch = async (url, options) => {
      if (url === '/api/config') return new Response(JSON.stringify({ baseUrl: 'https://api.deepseek.com', model: 'test-model', configured: true, token: 'test-session' }));
      if (url === '/api/edit') {
        aiRequest = JSON.parse(options.body);
        if (aiRequest.action === 'select-template') return new Response(JSON.stringify({ result: { templateId: 'narrative', reason: '研究论文的连续论证。' } }));
        const result = aiRequest.action === 'rewrite' ? { text: '改写后的选区', summary: '改写完成' } : { title: '界面工作流纸条', paragraphs: [String.raw`**这是一条模拟讲解**：\\(\frac{\hat m_t}{\sqrt{\hat v_t}}\\)，用于验证预览与写入。`], sourcePages: [2], summary: '完成界面测试' };
        result.rendering = compileResult(aiRequest.action, result, { strict: true });
        return new Response(JSON.stringify({ model: 'test-model', result }));
      }
      throw new Error('Unexpected test URL: ' + url);
    };
    const waitUntil = async (check) => {
      for (let i = 0; i < 60 && !(await check()); i++) await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
      assert.ok(await check(), 'Application did not reach expected UI state');
    };
    try {
      await storage.saveLearner({ background: '用于测试的学习者，已学过基本概率。', foundations: ['基础概率'], materials: [] }, 'complete');
      const { default: App } = await vite.ssrLoadModule('/src/App.tsx');
      await React.act(async () => { root.render(React.createElement(App)); });
      await waitUntil(() => dom.window.document.querySelector('.paper-library'));
      assert.equal(aiRequest, undefined, 'The default library must not start note generation');
      await React.act(async () => { dom.window.document.querySelector('.collection-document').click(); });
      await waitUntil(() => dom.window.document.querySelector('.note-prose'));
      await waitUntil(() => dom.window.document.querySelectorAll('.note-prose').length === 5);
      // Opening a notebook restores its reading anchor on the next frame and
      // saves it asynchronously. Compare appearance only after that initial save.
      await React.act(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      await waitUntil(() => dom.window.document.querySelector('.save-indicator')?.textContent === '已保存到本机');
      await waitUntil(async () => !!(await storage.readDocuments())[0]?.readingAnchor);
      const originalProse = dom.window.document.querySelector('.note-prose');
      const beforeAppearance = await storage.readDocuments();
      assert.equal(dom.window.document.documentElement.dataset.theme, 'sage');
      for (const theme of ['dark', 'light', 'sage', 'dark']) {
        await React.act(async () => {
          const picker = dom.window.document.querySelector('[aria-label="切换视觉风格"]');
          picker.click();
        });
        assert.equal(dom.window.document.querySelector('[aria-label="切换视觉风格"]').getAttribute('aria-expanded'), 'true');
        await React.act(async () => {
          dom.window.document.querySelector(`[data-theme-preview="${theme}"]`).click();
        });
        assert.equal(dom.window.document.querySelector('.theme-menu'), null, 'Picking a theme closes the panel immediately');
        assert.equal(dom.window.document.documentElement.dataset.theme, theme);
        assert.equal(dom.window.localStorage.getItem('reading-tree-visual-theme'), theme);
        assert.equal(dom.window.document.querySelector('.note-prose'), originalProse, 'Changing appearance must not recreate the editor');
      }
      assert.equal(aiRequest, undefined, 'Appearance never requests model output');
      assert.deepEqual(await storage.readDocuments(), beforeAppearance, 'Appearance leaves every notebook intact');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="切换视觉风格"]').click(); });
      assert.equal(dom.window.document.activeElement.dataset.themePreview, 'dark');
      await React.act(async () => { dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      assert.equal(dom.window.document.activeElement.dataset.themePreview, 'light');
      assert.equal(dom.window.document.documentElement.dataset.theme, 'dark', 'Keyboard exploration does not switch the theme before selection');
      await React.act(async () => { dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      assert.equal(dom.window.document.querySelector('.theme-menu'), null);
      assert.equal(dom.window.document.activeElement.getAttribute('aria-label'), '切换视觉风格');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="切换视觉风格"]').click(); });
      await React.act(async () => { dom.window.document.querySelector('.article-title').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); });
      assert.equal(dom.window.document.querySelector('.theme-menu'), null, 'Clicking outside dismisses without an extra click');
      assert.equal(dom.window.document.querySelectorAll('[data-note-chapter]').length, 5);
      assert.equal(dom.window.document.querySelector('.chapter-navigation'), null);
      assert.match(dom.window.document.querySelector('.breadcrumb-current').textContent, /注意力的核心直觉/);
      await waitUntil(() => dom.window.document.querySelector('[aria-label="发送 AI 编辑请求"]'));
      const selectionEditor = dom.window.document.querySelector('[data-note-chapter="attention"] .note-prose').editor;
      const beforeHighlight = selectionEditor.getJSON();
      await React.act(async () => { selectionEditor.view.focus(); selectionEditor.commands.setTextSelection({ from: 1, to: 8 }); });
      await waitUntil(() => dom.window.document.querySelector('.ai-selection-highlight'));
      const chosenText = selectionEditor.state.doc.textBetween(1, 8, '\n');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="向 AI 提出编辑诉求"]').focus(); });
      assert.equal(dom.window.document.querySelector('.ai-selection-highlight').textContent, chosenText);
      assert.equal(selectionEditor.isFocused, false);
      assert.deepEqual(selectionEditor.getJSON(), beforeHighlight, 'A persistent selection is decoration, not saved note content');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="发送 AI 编辑请求"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.suggestion-panel'));
      assert.equal(dom.window.document.querySelector('.ai-selection-highlight'), null);
      assert.equal(selectionEditor.state.selection.empty, true);
      assert.equal(aiRequest.selection, chosenText);
      assert.equal(aiRequest.action, 'explain');
      assert.equal(aiRequest.chapterId, 'attention');
      assert.match(dom.window.document.querySelector('.suggestion-preview').textContent, /界面工作流纸条/);
      await waitUntil(() => dom.window.document.querySelector('.suggestion-preview .math-render svg'));
      assert.ok(dom.window.document.querySelector('.suggestion-preview strong'));
      const previewFormula = dom.window.document.querySelector('.suggestion-preview .math-render').innerHTML;
      await React.act(async () => { dom.window.document.querySelector('.suggestion-footer .primary').click(); });
      await waitUntil(() => dom.window.document.querySelectorAll('.paper-note').length === 3);
      assert.equal(dom.window.document.querySelector('.paper-note-body .math-render').innerHTML, previewFormula, 'Preview and inserted paper note render the identical canonical formula');
      assert.equal(dom.window.document.querySelector('.suggestion-panel'), null);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="修改记录"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.version-item'));
      await React.act(async () => { dom.window.document.querySelector('.version-item .secondary').click(); });
      await waitUntil(() => dom.window.document.querySelectorAll('.paper-note').length === 2);
      const scroller = dom.window.document.querySelector('.article-scroll');
      const originalEditor = dom.window.document.querySelector('[data-note-chapter="attention"] .note-prose');
      await React.act(async () => { scroller.scrollTop = 2502; scroller.dispatchEvent(new dom.window.Event('scroll')); });
      await waitUntil(() => dom.window.document.querySelector('.sidebar-source [data-follow-page]')?.dataset.followPage === '3');
      assert.match(dom.window.document.querySelector('.chapter-link.current').textContent, /注意力的核心直觉/);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="展开原文"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.source-modal-content [data-follow-page]'));
      assert.equal(dom.window.document.querySelector('.source-modal-content [data-follow-page]').dataset.followPage, '3');
      assert.equal(dom.window.document.querySelectorAll('.source-modal-content [data-source-page]').length, document.pages.length, 'Source page slots remain mounted across page boundaries');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="关闭弹窗"]').click(); });
      // Native smooth scrolling emits frames from the old chapter before it
      // reaches the new one. Hold those frames so they can be observed in React.
      const instantScroll = dom.window.HTMLElement.prototype.scrollTo;
      const matchMedia = dom.window.matchMedia;
      let destination;
      dom.window.matchMedia = () => ({ matches: false });
      dom.window.HTMLElement.prototype.scrollTo = function (options) {
        if (this === scroller && options.behavior === 'smooth') destination = options.top;
        else instantScroll.call(this, options);
      };
      const route = () => dom.window.document.querySelector('[aria-label="跳转到章节"]').value;
      const frame = async top => {
        await React.act(async () => {
          scroller.scrollTop = top;
          scroller.dispatchEvent(new dom.window.Event('scroll'));
          await new Promise(resolve => setTimeout(resolve, 35));
        });
      };
      const arrow = async label => React.act(async () => { dom.window.document.querySelector(`[aria-label="${label}"]`).click(); });
      try {
        await arrow('后一章节');
        assert.equal(route(), 'formula');
        for (const top of [2503, 2700, 3100]) {
          await frame(top);
          assert.equal(route(), 'formula', 'Intermediate scroll frames must never revert the chapter counter');
          assert.equal(dom.window.document.querySelector('.sidebar-source [data-follow-page]').dataset.followPage, '4', 'Source context must not bounce back with stale scroll frames');
        }
        await arrow('后一章节');
        assert.equal(route(), 'multihead', 'A second click advances from the selected destination');
        await frame(3200);
        assert.equal(route(), 'multihead');
        await arrow('前一章节');
        assert.equal(route(), 'formula');
        await frame(destination);
        assert.equal(route(), 'formula');
        await frame(4700);
        assert.equal(route(), 'multihead', 'Ordinary scroll tracking resumes after arrival');
        await arrow('前一章节');
        await frame(4500);
        assert.equal(route(), 'formula', 'Backward jumps also keep their destination stable');
        await frame(destination);
        for (const event of [new dom.window.WheelEvent('wheel', { bubbles: true, deltaY: -100 }), new dom.window.Event('touchstart', { bubbles: true }), new dom.window.Event('pointerdown', { bubbles: true }), new dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'PageUp' })]) {
          await arrow('后一章节');
          await frame(3500);
          assert.equal(route(), 'multihead');
          await React.act(async () => { scroller.dispatchEvent(event); });
          await frame(3300);
          assert.equal(route(), 'formula', 'Taking over scrolling immediately releases the destination');
        }
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 6500 });
        await React.act(async () => {
          const selector = dom.window.document.querySelector('[aria-label="跳转到章节"]');
          selector.value = document.chapters.at(-1).id;
          selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        assert.equal(destination, 5900);
        await frame(destination);
        await frame(destination);
        assert.equal(route(), document.chapters.at(-1).id, 'A short final chapter stays selected when the scroll limit prevents top alignment');
        delete scroller.scrollHeight;
      } finally {
        dom.window.HTMLElement.prototype.scrollTo = instantScroll;
        dom.window.matchMedia = matchMedia;
        delete scroller.scrollHeight;
      }
      await React.act(async () => { dom.window.document.querySelectorAll('.chapter-link')[2].click(); });
      await waitUntil(() => /把直觉写成公式/.test(dom.window.document.querySelector('.breadcrumb-current').textContent));
      assert.equal(dom.window.document.querySelector('[data-note-chapter="attention"] .note-prose'), originalEditor, 'Chapter navigation must not replace the previous editor');
      assert.ok(scroller.scrollTop > 3000);
      assert.equal(dom.window.document.querySelector('.sidebar-source [data-follow-page]').dataset.followPage, '4');
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
      const saved = (await storage.readDocuments())[0];
      assert.equal(saved.currentChapter, 'formula');
      assert.equal(saved.versions.length, 2);
      assert.match(dom.window.document.querySelector('.save-indicator').textContent, /已保存到本机/);

      assert.equal(dom.window.document.querySelector('[aria-label="AI 编辑模式"] option[value="generate"]'), null);
      assert.equal(aiRequest.knowledge, undefined, 'Pure translation must not send the personal knowledge base');
      const mode = dom.window.document.querySelector('[aria-label="阅读方式"]');
      assert.equal(mode.value, 'translation');
      assert.equal(mode.options.length, 2);
      assert.equal(dom.window.document.querySelector('[aria-label="讲解难度"]'), null);
      assert.equal(dom.window.document.querySelector('[aria-label="讲解风格"]'), null);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="资料库"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.paper-library'));
      assert.equal(dom.window.document.querySelector('.collection-title h1').textContent, '资料库');
      assert.equal(dom.window.document.querySelectorAll('.paper-library [role="listitem"]').length, 1);
      assert.equal(dom.window.document.querySelector('.reading-tree-map'), null);
      assert.equal(dom.window.document.querySelector('.library-filters'), null);
      assert.equal((await storage.getPreference('knowledge'))?.materials?.length || 0, 0, 'Listing added files must not treat them as read');
      await React.act(async () => { dom.window.document.querySelector('.collection-document').click(); });
      await React.act(async () => { dom.window.document.querySelector('.reading-finished').click(); });
      await waitUntil(() => dom.window.document.querySelector('.reading-finished').disabled);
      assert.equal((await storage.getPreference('collection')).items[saved.id].status, 'completed');
      assert.equal((await storage.getPreference('knowledge'))?.materials?.length || 0, 0, 'Completing a document does not alter the learner profile');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="学习画像"]').click(); });
      assert.match(dom.window.document.querySelector('.knowledge-profile textarea').value, /用于测试的学习者/);
      assert.equal(dom.window.document.querySelectorAll('.knowledge-record').length, 0);
      assert.equal(dom.window.document.querySelector('.reading-tree-map'), null);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="关闭弹窗"]').click(); });

      // A newly supplied collection opens the shelf on first load and remains
      // selectable while the previous edited document stays intact in storage.
      const supplied = { ...createDemo(), id: 'paper-import-test', title: 'Original supplied paper', demo: false, kind: 'text', library: { id: 'import-test', label: 'Supplied Paper', year: '2020', authors: 'Test Author', group: '训练与优化', order: 0 } };
      supplied.chapters = supplied.chapters.map(c => ({ ...c, status: 'empty', content: { type: 'doc', content: [] } }));
      const initializationCalls = [];
      await storage.setPreference('learning-settings', { mode: 'translation', difficulty: 'advanced', style: 'derivation' });
      const regularFetch = globalThis.fetch;
      globalThis.fetch = (url, options) => {
        if (url === '/api/library') return Promise.resolve(new Response(JSON.stringify({ documents: [supplied] })));
        if (url === '/api/edit' && JSON.parse(options.body).action === 'generate') {
          const input = JSON.parse(options.body); initializationCalls.push(input);
          const adaptive = input.learning.mode === 'adaptive';
          const blocks = [{ type: 'paragraph', text: `${input.learning.mode} 初始化内容 ${input.chapterId}` }];
          if (adaptive) blocks.push({ type: 'paragraph', text: `顺着前文继续解释 ${input.chapterId}` });
          return Promise.resolve(new Response(JSON.stringify({ model: 'test-model', result: { blocks, summary: '' } })));
        }
        return regularFetch(url, options);
      };
      await React.act(async () => { root.render(React.createElement(App, { key: 'new-collection' })); });
      assert.equal(dom.window.document.documentElement.dataset.theme, 'dark', 'A reopened app restores its saved appearance');
      await waitUntil(() => dom.window.document.querySelector('.paper-library'));
      assert.match(dom.window.document.querySelector('.paper-library').textContent, /Supplied Paper/);
      assert.equal(dom.window.document.querySelectorAll('.paper-library [role="listitem"]').length, 2, 'Unread and read files both belong in the ordinary booklist');
      await React.act(async () => { dom.window.document.querySelector('[aria-label="打开 Supplied Paper"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.article-title')?.textContent === 'Original supplied paper');
      assert.equal(dom.window.document.querySelector('.paper-library'), null);
      await waitUntil(() => initializationCalls.length === supplied.chapters.length && !dom.window.document.querySelector('.preparation-banner'));
      assert.equal(initializationCalls[0].learning.mode, 'adaptive', 'New files start with adaptive notes regardless of obsolete global preferences');
      assert.equal(initializationCalls[0].learning.template, 'guided-v3');
      assert.equal(initializationCalls[0].learning.writingTemplate.id, 'narrative');
      assert.equal(initializationCalls[0].knowledge.materials, undefined);
      assert.equal(initializationCalls[0].document.intent, supplied.intent);
      assert.equal(initializationCalls[0].document.intent, '看懂这篇文章');
      assert.equal(dom.window.document.querySelector('[aria-label="阅读方式"]').value, 'adaptive');
      const afterImport = await storage.readDocuments();
      assert.equal(afterImport.length, 2);
      assert.deepEqual(afterImport.find(doc => doc.id === saved.id).chapters, saved.chapters);
      assert.equal(afterImport.find(doc => doc.id === saved.id).versions.length, saved.versions.length);
      assert.equal(afterImport.find(doc => doc.id === supplied.id).preparation.status, 'complete');
      assert.deepEqual(Object.keys(afterImport.find(doc => doc.id === supplied.id).notebooks), ['adaptive']);
      await React.act(async () => { root.render(React.createElement(App, { key: 'reopen-prepared' })); });
      await waitUntil(() => dom.window.document.querySelector('.paper-library'));
      await React.act(async () => { dom.window.document.querySelector('[aria-label="打开 Supplied Paper"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.article-title')?.textContent === 'Original supplied paper');
      assert.equal(initializationCalls.length, supplied.chapters.length, 'Reopening a prepared file must not regenerate it');

      const updatedGoal = '能够独立推导缩放点积注意力，理解缩放条件并解释其对权重的影响。';
      await React.act(async () => { dom.window.document.querySelector('.intent-pill').click(); });
      await React.act(async () => {
        const field = dom.window.document.querySelector('[aria-label="我的学习目标"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, updatedGoal);
        field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      await React.act(async () => { dom.window.document.querySelector('.intent-form .primary').click(); });
      assert.equal(initializationCalls.length, 5, 'Saving a goal does not silently regenerate existing notes');
      await React.act(async () => {
        const selector = dom.window.document.querySelector('[aria-label="阅读方式"]');
        selector.value = 'translation'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
      await waitUntil(() => initializationCalls.length === 10 && !dom.window.document.querySelector('.preparation-banner'));
      assert.equal(initializationCalls[5].learning.template, 'translation-v1');
      assert.equal(initializationCalls[5].knowledge, undefined);
      assert.equal(initializationCalls[5].document.intent, updatedGoal, 'The next generation must use the saved goal');

      // Sending clears the visible selection, but applying a rewrite must
      // still replace exactly the originally submitted range.
      await waitUntil(() => dom.window.document.querySelectorAll('.note-prose').length === supplied.chapters.length);
      await React.act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
      const rewriteEditor = dom.window.document.querySelector('[data-note-chapter="attention"] .note-prose').editor;
      await React.act(async () => { rewriteEditor.view.focus(); rewriteEditor.commands.setTextSelection({ from: 1, to: 6 }); });
      await waitUntil(() => dom.window.document.querySelector('.ai-selection-highlight'));
      await React.act(async () => { dom.window.document.querySelector('[aria-label="清除选区"]').click(); });
      assert.equal(dom.window.document.querySelector('.ai-selection-highlight'), null);
      assert.equal(rewriteEditor.state.selection.empty, true);
      const originalText = rewriteEditor.getText();
      await React.act(async () => { rewriteEditor.view.focus(); rewriteEditor.commands.setTextSelection({ from: 1, to: 6 }); });
      const rewriteMode = dom.window.document.querySelector('[aria-label="AI 编辑模式"]');
      await React.act(async () => { rewriteMode.value = 'rewrite'; rewriteMode.dispatchEvent(new dom.window.Event('change', { bubbles: true })); dom.window.document.querySelector('[aria-label="向 AI 提出编辑诉求"]').focus(); });
      assert.equal(dom.window.document.querySelector('.ai-selection-highlight').textContent, originalText.slice(0, 5));
      await React.act(async () => { dom.window.document.querySelector('[aria-label="发送 AI 编辑请求"]').click(); });
      await waitUntil(() => dom.window.document.querySelector('.suggestion-panel'));
      assert.equal(aiRequest.selection, originalText.slice(0, 5));
      assert.equal(aiRequest.document.intent, updatedGoal, 'Local editing must use the same current learning goal');
      assert.equal(dom.window.document.querySelector('.ai-selection-highlight'), null);
      assert.equal(rewriteEditor.state.selection.empty, true);
      await React.act(async () => { dom.window.document.querySelector('.suggestion-footer .primary').click(); });
      await waitUntil(() => !dom.window.document.querySelector('.suggestion-panel'));
      assert.equal(rewriteEditor.getText(), '改写后的选区' + originalText.slice(5));

      // The same paper has separate, persistent notebooks. The first selection
      // generates an edition; later selections never regenerate saved work.
      await React.act(async () => { dom.window.document.querySelector('.composer-bottom button').click(); });
      await waitUntil(() => dom.window.document.querySelector('.paper-note'));
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 500)); });
      const translationSaved = (await storage.readDocuments()).find(d => d.id === supplied.id).notebooks.translation;
      const chooseNotebook = async id => {
        await React.act(async () => {
          const selector = dom.window.document.querySelector('[aria-label="阅读方式"]');
          selector.value = id; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        await waitUntil(() => dom.window.document.querySelector('[aria-label="阅读方式"]').value === id);
      };
      await chooseNotebook('adaptive');
      await waitUntil(() => initializationCalls.length === 10 && !dom.window.document.querySelector('.preparation-banner'));
      await waitUntil(() => /adaptive 初始化内容.*顺着前文继续解释/s.test(dom.window.document.querySelector('.learning-article').textContent));
      assert.equal(initializationCalls[0].learning.template, 'guided-v3');
      assert.equal(initializationCalls[0].knowledge.materials, undefined);
      assert.equal(dom.window.document.querySelector('.paper-note'), null, 'Translation paper notes must not leak into the adaptive edition');
      assert.equal(dom.window.document.querySelectorAll('.note-prose h2').length, 0, 'The app must not manufacture separate teaching sections');
      const adaptiveEditor = dom.window.document.querySelector('[data-note-chapter="attention"] .note-prose').editor;
      await React.act(async () => { adaptiveEditor.commands.setTextSelection(adaptiveEditor.state.doc.content.size - 1); adaptiveEditor.commands.insertContent('适应学习的个人编辑。'); });
      const adaptiveContent = structuredClone(adaptiveEditor.getJSON());
      await chooseNotebook('translation');
      await waitUntil(() => dom.window.document.querySelector('.paper-note'));
      const returnedEditor = dom.window.document.querySelector('[data-note-chapter="attention"] .note-prose').editor;
      assert.deepEqual(structuredClone(returnedEditor.getJSON()), translationSaved.chapters.find(c => c.id === 'attention').content);
      assert.notEqual(returnedEditor, rewriteEditor, 'Switching notebooks must isolate the editor undo stack');
      await React.act(async () => { assert.equal(returnedEditor.commands.undo(), false); });
      assert.equal(initializationCalls.length, 10);
      await chooseNotebook('adaptive');
      await waitUntil(() => /适应学习的个人编辑/.test(dom.window.document.querySelector('.learning-article').textContent));
      assert.equal(initializationCalls.length, 10);
      await React.act(async () => { root.render(React.createElement(App, { key: 'reopen-editions' })); });
      await waitUntil(() => dom.window.document.querySelector('.paper-library'));
      await React.act(async () => { dom.window.document.querySelector('[aria-label="打开 Supplied Paper"]').click(); });
      await waitUntil(() => /适应学习的个人编辑/.test(dom.window.document.querySelector('.learning-article')?.textContent || ''));
      assert.equal(dom.window.document.querySelector('[aria-label="阅读方式"]').value, 'adaptive');
      assert.equal(initializationCalls.length, 10, 'Reopening must reuse the selected notebook');
      let storedEditions = (await storage.readDocuments()).find(d => d.id === supplied.id);
      assert.deepEqual(storedEditions.notebooks.translation.chapters, translationSaved.chapters);
      assert.deepEqual(storedEditions.notebooks.translation.versions, translationSaved.versions);
      assert.deepEqual(storedEditions.chapters.find(c => c.id === 'attention').content, adaptiveContent);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="重新生成当前笔记"]').click(); });
      assert.equal(initializationCalls.length, 10, 'Opening regeneration controls must not change notes');
      await React.act(async () => { dom.window.document.querySelector('.modal-actions .primary').click(); });
      await waitUntil(() => initializationCalls.length === 15 && !dom.window.document.querySelector('.preparation-banner'));
      storedEditions = (await storage.readDocuments()).find(d => d.id === supplied.id);
      assert.deepEqual(storedEditions.notebooks.translation.chapters, translationSaved.chapters);
      assert.deepEqual(storedEditions.versions[0].chapters.find(c => c.id === 'attention').content, adaptiveContent);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="修改记录"]').click(); });
      await React.act(async () => { dom.window.document.querySelector('.version-item .secondary').click(); });
      await waitUntil(() => /适应学习的个人编辑/.test(dom.window.document.querySelector('.learning-article').textContent));
      assert.equal(initializationCalls.length, 15, 'Restoring complete notes must not trigger generation');

      // A small navigation area must keep the active chapter visible and let
      // the reader reach any other chapter without scrolling the sidebar.
      const { ReadingRoute } = await vite.ssrLoadModule('/src/components/ReadingRoute.tsx');
      let resizeRoute, navigated;
      globalThis.ResizeObserver = class { constructor(callback) { resizeRoute = callback; } observe() {} disconnect() {} };
      const longDocument = { ...document, chapters: Array.from({ length: 100 }, (_, i) => ({ ...document.chapters[0], id: `chapter-${i}`, title: `Chapter ${i + 1}` })) };
      const renderRoute = index => React.createElement(ReadingRoute, { document: longDocument, currentIndex: index, progress: 0.4, onNavigate: id => { navigated = id; } });
      await React.act(async () => { root.render(renderRoute(53)); });
      await React.act(async () => { resizeRoute([{ contentRect: { height: 138 } }]); });
      assert.equal(dom.window.document.querySelectorAll('.chapter-link').length, 3);
      assert.match(dom.window.document.querySelector('.chapter-link.current').textContent, /Chapter 54/);
      const jump = dom.window.document.querySelector('[aria-label="跳转到章节"]');
      assert.equal(jump.options.length, 100);
      await React.act(async () => { jump.value = 'chapter-99'; jump.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
      assert.equal(navigated, 'chapter-99');
      await React.act(async () => { root.render(renderRoute(99)); });
      assert.match(dom.window.document.querySelector('.chapter-link.current').textContent, /Chapter 100/);
      assert.equal(dom.window.document.querySelector('[aria-label="后一章节"]').disabled, true);
      await React.act(async () => { dom.window.document.querySelector('[aria-label="前一章节"]').click(); });
      assert.equal(navigated, 'chapter-98');
      await React.act(async () => { resizeRoute([{ contentRect: { height: 46 } }]); });
      assert.equal(dom.window.document.querySelectorAll('.chapter-link').length, 1);
      assert.match(dom.window.document.querySelector('.chapter-link.current').textContent, /Chapter 100/);
    } finally { globalThis.fetch = originalFetch; }
  } finally {
    globalThis.fetch = originalFetch;
    await React.act(async () => root.unmount());
    await vite.close(); dom.window.close();
  }
});
