// Desktop UI regression check. Uses only a temporary project and mocked AI replies.
const electron = require('electron');
const { app } = electron;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const Module = require('node:module');
const resultDirectory = path.resolve(__dirname, '..', 'release', 'feedback-check');
fs.mkdirSync(resultDirectory, { recursive: true });
const resultFile = path.join(resultDirectory, 'result.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-feedback-'));
const projectRoot = path.join(root, '示例主题单元');
fs.mkdirSync(projectRoot);
fs.writeFileSync(path.join(projectRoot, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><main class="unit"><p class="unit-label">主题单元示例</p><h1 data-editor-id="unit-title">认识人工智能</h1><p class="unit-description">这是一个用于测试编辑器预览和元素识别的最小网页。</p><button data-editor-id="start">开始学习</button></main></body></html>');
fs.writeFileSync(path.join(projectRoot, 'next.html'), '<!doctype html><html><body><h1>下一页</h1></body></html>');
fs.writeFileSync(path.join(projectRoot, 'style.css'), 'body{font:18px "Segoe UI","Microsoft YaHei",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#20242b}.unit{text-align:center}.unit-label{display:inline-block;margin:0;padding:8px 12px;color:#245fdf;background:#eef3ff;border-radius:4px;font-size:14px;font-weight:600}h1{width:480px;height:72px;margin:24px auto;font-size:48px;line-height:72px}.unit-description{margin:28px 0 36px;color:#687482}button{padding:16px 36px;color:#fff;background:#2463eb;border:0;border-radius:8px;font-size:18px}');
app.setPath('userData', path.join(root, 'profile'));
delete process.env.VITE_DEV_SERVER_URL;
let win;
let contextReads = 0;
let settingsReads = 0;
let replyMode = 'failure';
const requests = [];
const handle = electron.ipcMain.handle.bind(electron.ipcMain);
const replacement = {
  ...electron,
  BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({ ...options, width: 1586, height: 992, useContentSize: true, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); win = this; }
  },
  dialog: { ...electron.dialog, showOpenDialog: async () => ({ canceled: false, filePaths: [projectRoot] }) },
  ipcMain: { handle(name, handler) {
    if (name === 'project:catalog') handler = async () => ({ ok: true, items: [], lastKey: '', limited: false });
    if (name === 'ai:get-settings') handler = async () => { settingsReads++; return { ok: true, apiBaseUrl: 'https://example.invalid/v1', apiFormat: 'chat-completions', model: 'local-test', apiKeyConfigured: true }; };
    if (name === 'project:list-ai-context') { const original = handler; handler = (...args) => { contextReads++; return original(...args); }; }
    if (name === 'ai:generate-proposal') handler = async (_event, payload) => {
      requests.push(payload);
      if (replyMode === 'throw') throw new Error('local test connection failure');
      if (replyMode === 'failure') return { ok: false, error: '模拟连接失败，未发送外部请求' };
      const originalContent = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
      return { ok: true, proposal: { summary: '将标题改为探索人工智能，并保留按钮。', files: [{ path: 'index.html', originalContent, content: originalContent.replace('认识人工智能', '探索人工智能') }] } };
    };
    handle(name, handler);
  } },
};
const originalLoad = Module._load;
Module._load = function(name, parent, main) { return name === 'electron' ? replacement : originalLoad.call(this, name, parent, main); };
try { require('../electron/main.cjs'); } finally { Module._load = originalLoad; }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ui = code => win.webContents.executeJavaScript(code);
async function until(check, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { try { if (await check()) return; } catch {} await wait(30); }
  throw new Error('Timed out: ' + label);
}
async function click(label) {
  await ui(`(()=>{const button=[...document.querySelectorAll('button')].find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)}||el.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Unavailable: '+${JSON.stringify(label)});button.click()})()`);
}
async function draft(value) {
  await ui(`(()=>{const field=document.querySelector('.ai-composer-box textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await until(() => ui(`document.querySelector('.ai-composer-box textarea').value===${JSON.stringify(value)}`), 'draft update');
}
async function changePage(pagePath) {
  await click('页面');
  await ui(`(()=>{const button=[...document.querySelectorAll('.page-item')].find(el=>el.querySelector('strong').textContent===${JSON.stringify(pagePath)});button.click()})()`);
  await until(() => ui(`document.querySelector('.preview-device-toolbar strong').textContent===${JSON.stringify(pagePath)}`), 'page switch');
  await click('AI 助手');
  await until(() => ui(`!document.querySelector('.ai-context-picker').textContent.includes('正在读取')`), 'context ready');
}
app.whenReady().then(async () => {
  try {
    await until(() => ui(`!!document.querySelector('.empty-workspace')`), 'editor ready');
    await click('浏览文件夹');
    await until(() => ui(`!!document.querySelector('.preview-stage iframe')&&!document.querySelector('.preview-loading')`), 'project loads');
    await click('AI 助手');
    await until(() => ui(`document.querySelector('.ai-context-list').textContent.includes('style.css')`), 'AI context');
    const previewFrame = win.webContents.mainFrame.frames.find(frame => frame.url.startsWith('editor-project://'));
    await previewFrame.executeJavaScript(`document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}))`);
    await until(() => ui(`document.querySelector('.selected-title')?.dataset.elementId==='unit-title'`), 'selected title');
    assert.equal(await ui(`document.querySelector('.color-input input').value`), '#20242B');
    await ui(`document.querySelector('.color-input input').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);
    assert.equal(await ui(`!!document.querySelector('.save-state.dirty')`), false, 'colour formatting is not an edit');
    await click('交互');
    assert.equal(await ui(`document.querySelector('[aria-label="基础交互"]').closest('[hidden]')===null`), true);
    await click('样式');
    assert.equal(await ui(`document.querySelector('.color-input').closest('[hidden]')===null`), true);
    replyMode = 'success';
    await draft('把标题改成探索人工智能，并保留开始学习按钮。');
    await click('发送给 AI');
    await until(() => ui(`!!document.querySelector('.ai-proposal-actions')&&!document.querySelector('.busy-spinner')`), 'screenshot proposal');
    await ui(`document.fonts.ready.then(()=>true)`);
    console.log('UI font:', await ui(`getComputedStyle(document.querySelector('.inspector-section strong')).fontFamily`));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const documentRoot = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const headingNode = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentRoot.root.nodeId, selector: '.inspector-section strong' });
    console.log('Rendered UI fonts:', JSON.stringify(await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId: headingNode.nodeId })));
    win.webContents.debugger.detach();
    win.showInactive();
    win.webContents.invalidate();
    await ui(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))`);
    await wait(180);
    fs.writeFileSync(path.join(resultDirectory, 'desktop-ui.png'), (await win.webContents.capturePage()).toPNG());
    win.hide();
    const beforeNoopSave = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    await click('保存');
    await until(() => ui(`document.querySelector('.status-feedback').textContent.includes('当前页面已保存')`), 'saved-state feedback');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), beforeNoopSave);
    await click('开始新对话');
    replyMode = 'failure';
    await draft('把标题改为探索人工智能');
    await ui(`document.querySelector('.ai-context-list input').click()`);
    const selected = await ui(`[...document.querySelectorAll('.ai-context-list input')].map(el=>el.checked)`);
    await click('页面'); await click('AI 助手');
    assert.equal(await ui(`document.querySelector('.ai-composer-box textarea').value`), '把标题改为探索人工智能');
    assert.deepEqual(await ui(`[...document.querySelectorAll('.ai-context-list input')].map(el=>el.checked)`), selected);
    assert.equal(contextReads, 1, 'tab switching reuses context');
    assert.equal(settingsReads, 1, 'tab switching reuses settings');
    await changePage('next.html'); await draft('下一页的草稿');
    await changePage('index.html');
    assert.equal(await ui(`document.querySelector('.ai-composer-box textarea').value`), '把标题改为探索人工智能');
    assert.equal(contextReads, 2, 'returning to a page uses its cache');
    // Restore index.html as an AI context file if the checkbox above removed it.
    await ui(`(()=>{for(const label of document.querySelectorAll('.ai-context-list label'))if(label.textContent==='index.html'&&!label.querySelector('input').checked)label.querySelector('input').click()})()`);
    await click('发送给 AI');
    await until(() => ui(`document.querySelector('.ai-chat-status').textContent.includes('模拟连接失败')`), 'failure response');
    assert.equal(await ui(`document.querySelector('.ai-composer-box textarea').value`), '把标题改为探索人工智能');
    await until(() => ui(`!document.querySelector('[aria-label="发送给 AI"]').disabled`), 'failure unlocks controls');
    replyMode = 'throw'; await click('发送给 AI');
    await until(() => ui(`document.querySelector('.ai-chat-status').textContent.includes('草稿已恢复')`), 'rejected call');
    await until(() => ui(`!document.querySelector('[aria-label="发送给 AI"]').disabled`), 'rejected call unlocks controls');
    replyMode = 'success'; await click('发送给 AI');
    await until(() => ui(`!!document.querySelector('.ai-proposal-actions')&&!document.querySelector('.busy-spinner')`), 'success proposal');
    await draft('按钮继续保留'); await click('发送给 AI');
    await until(() => ui(`document.querySelectorAll('.ai-chat-turn').length===4&&!document.querySelector('.busy-spinner')`), 'continuous history');
    assert.match(requests.at(-1).request, /将标题改为探索人工智能/);
    const original = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    await click('预览修改');
    await until(() => ui(`!!document.querySelector('.preview-stage-banner')&&!document.querySelector('.preview-loading')`), 'isolated preview');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), original);
    await click('返回原页面');
    await until(() => ui(`!document.querySelector('.preview-stage-banner')&&!document.querySelector('.busy-spinner')`), 'preview cancel');
    await click('预览修改');
    await until(() => ui(`!!document.querySelector('.ai-stage-card')`), 'second preview');
    await click('确认应用');
    await until(() => ui(`!document.querySelector('.ai-stage-card')&&!document.querySelector('.preview-loading')`), 'apply completes');
    assert.match(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), /探索人工智能/);
    assert.equal(await ui(`document.querySelectorAll('.ai-chat-turn').length`), 4);
    assert.equal(settingsReads, 1);
    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, contextReads, settingsReads, requests: requests.length, checkedAt: new Date().toISOString() }, null, 2));
    console.log('PASS: desktop context/settings cache, per-page drafts, continuous history, failure/rejection recovery, isolated preview/cancel/apply.');
    app.exit(0);
  } catch (error) { fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.stack }, null, 2)); console.error(error.stack); app.exit(1); }
});
