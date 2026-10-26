// Run with Electron after building. All writes use a newly created temporary project.
const electron = require('electron');
const { app } = electron;
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const Module = require('node:module');
const workspace = path.resolve(__dirname, '..');
const resultFile = path.join(workspace, '.self-check-results.txt');
// Electron may outlive the shell/tool that launched this hidden-window check.
// Ignore a closed output pipe so an EPIPE does not become a main-process error dialog.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error?.code !== 'EPIPE') process.exitCode = 1;
  });
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-self-check-'));
const projectRoot = path.join(temporary, 'project');
fs.mkdirSync(projectRoot);
app.setPath('userData', path.join(temporary, 'profile'));
delete process.env.VITE_DEV_SERVER_URL;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:16px sans-serif;margin:30px}button{margin:8px;padding:10px}#plain{font-size:18px!important}
#stage{position:fixed;left:50%;top:50%;transform-origin:center;background:#eef;pointer-events:none}
#rotated{width:180px;height:60px;transform:rotate(20deg) scale(.7);background:#ddf}
#asset{width:110px;height:60px}#drag-image{display:block;width:80px;height:40px;pointer-events:none}
#formula-art{position:relative;width:240px;height:60px;background:linear-gradient(90deg,#fff 0 30%,transparent 30% 35%,#fff 35% 65%,transparent 65% 70%,#fff 70%);}
#formula-slot{position:absolute;left:4px;top:4px;width:60px;height:48px;padding:0;border:0;background:transparent;}
#formula-slot::after{content:"";}
</style><style data-editor-dynamic="legacy-feedback" data-editor-viewport="mobilePortrait">@media (max-width:500px) { main#stage.answering:nth-child(2) > div#feedback.feedback.visible.wrong:nth-child(13) > img:nth-child(1) {transform:translate(3px,-17px);} }</style></head><body>
<div id="stage"><strong style="position:absolute;top:4px;left:4px">TOP-LEFT</strong><strong style="position:absolute;right:4px;bottom:4px">BOTTOM-RIGHT</strong></div><script>(()=>{const layout=()=>{const portrait=/Android|Mobile/i.test(navigator.userAgent)&&innerHeight>innerWidth;document.documentElement.classList.toggle('mobile-portrait-layout',portrait);document.documentElement.classList.toggle('landscape-stage-rotated',portrait);const w=portrait?Math.min(innerHeight,innerWidth*16/9):Math.min(innerWidth,innerHeight*16/9);const s=document.querySelector('#stage');s.style.width=w+'px';s.style.height=w*9/16+'px';s.style.transform='translate(-50%,-50%)'+(portrait?' rotate(90deg)':'')};layout();addEventListener('resize',layout);addEventListener('orientationchange',layout)})()</script>
<button id="existing" data-editor-id="auto-1">原按钮</button><button id="fresh">新按钮</button>
<button id="rich" data-editor-id="rich"><svg width="10" height="10"><title>图标</title><circle r="4" cx="5" cy="5"/></svg><span>开始</span><b>0/3</b></button>
<button id="asset" draggable="true" aria-label="可拖动素材"><img id="drag-image" alt="素材图" draggable="true" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='40'%3E%3Crect width='80' height='40' rx='8' fill='%23ed8b24'/%3E%3Ctext x='40' y='26' text-anchor='middle' font-size='16' fill='white'%3E15%3C/text%3E%3C/svg%3E"></button>
<div id="formula-art" aria-label="整条算式背景图"><button id="formula-slot" type="button" aria-label="空白答题框"></button></div>
<h1 id="plain" data-editor-id="plain" style="font-size:30px!important">标题</h1>
<div id="rotated" data-editor-id="rotated">旋转元素</div>
<button id="action" data-editor-id="action">下一页</button>
<div id="feedback"></div><script>window.showResult=(kind)=>{const feedback=document.querySelector('#feedback');feedback.className='feedback visible '+kind;feedback.replaceChildren();const img=document.createElement('img');img.alt=kind==='wrong'?'错误提示':'正确提示';img.src='./'+kind+'.svg';img.style.width='180px';img.style.height='30px';feedback.append(img)};</script>
</body></html>`;
let win;
let saveDelay = 0;
let activeSaves = 0;
let maxActiveSaves = 0;
let closeChoice = 0;
let closePrompts = 0;
const nativeHandle = electron.ipcMain.handle.bind(electron.ipcMain);
const replacement = {
  ...electron,
  BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({ ...options, width: 1600, height: 1000, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); win = this; }
  },
  dialog: { ...electron.dialog,
    showOpenDialog: async () => ({ canceled: false, filePaths: [projectRoot] }),
    showMessageBoxSync: () => { closePrompts++; return closeChoice; },
  },
  ipcMain: { handle(name, handler) {
    nativeHandle(name, name === 'project:catalog' ? async () => ({ ok: true, items: [], lastKey: '', limited: false })
      : name === 'project:save-element' ? async (...args) => {
        activeSaves++; maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
        try { if (saveDelay) await new Promise(resolve => setTimeout(resolve, saveDelay)); return await handler(...args); }
        finally { activeSaves--; }
      } : handler);
  } },
};
const originalLoad = Module._load;
Module._load = function (name, parent, main) { return name === 'electron' ? replacement : originalLoad.call(this, name, parent, main); };
try { require('../electron/main.cjs'); } finally { Module._load = originalLoad; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ui(code) { return win.webContents.executeJavaScript(code); }
async function page(code) {
  const frame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('editor-project://'));
  if (!frame) throw Error('Preview has not loaded');
  return frame.executeJavaScript(code);
}
async function until(check, message) {
  const end = Date.now() + 8000;
  while (Date.now() < end) { try { if (await check()) return; } catch {} await delay(30); }
  throw Error('Timed out: ' + message);
}
async function click(text) {
  await ui(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)});b.click()})()`);
}
async function select(selector) {
  const id = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));return e.dataset.editorId})()`);
  await until(() => ui(`document.querySelector('.selected-title')?.textContent===${JSON.stringify(id)}`), 'select ' + selector);
}
async function field(label, value) {
  await ui(`(()=>{const label=[...document.querySelectorAll('.property-row')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)});const e=label.querySelector('input,textarea,select');const prototype=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await delay(40);
  await ui(`(()=>{const l=[...document.querySelectorAll('.property-row')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)});l.querySelector('input,textarea,select').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))})()`);
  await delay(40);
}
async function save() { await click('保存'); await until(() => ui(`!document.querySelector('.save-state.dirty')`), 'save completes'); }
async function refresh() {
  const oldFrame = win.webContents.mainFrame.frames.find(item => item.url.startsWith('editor-project://'));
  await click('刷新');
  await until(() => win.webContents.mainFrame.frames.some(item => item.url.startsWith('editor-project://') && item !== oldFrame), 'new preview frame');
  await until(() => page(`document.readyState==='complete' && !!document.querySelector('#plain')`), 'refresh loads');
  await ui(`document.querySelector('iframe').getBoundingClientRect().width`);
  await page(`document.documentElement.getBoundingClientRect().width`);
}
async function reset() {
  saveDelay = 0; closeChoice = 1;
  fs.writeFileSync(path.join(projectRoot, 'index.html'), fixture);
  fs.writeFileSync(path.join(projectRoot, 'next.html'), '<html><body>下一页</body></html>');
  for (const kind of ['wrong','correct']) fs.writeFileSync(path.join(projectRoot,kind+'.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="30"><rect width="180" height="30" fill="red"/></svg>');
  if (win && !win.isDestroyed()) await win.loadFile(path.join(workspace, 'dist/index.html'));
  await until(() => ui(`!!document.querySelector('#current-project')`), 'editor loads');
  await click('浏览文件夹');
  await until(() => page(`!!document.querySelector('#fresh')`), 'project opens');
  await click('电脑');
  await until(() => page(`innerWidth===1440 && document.readyState==='complete'`), 'desktop preview');
  closeChoice = 0;
}
const checks = [
  ['regenerated result images retain their saved position in test mode and a standalone mobile webpage', async () => {
    await click('华为 Pura 70 Pro+');
    await until(() => page(`innerWidth===378 && document.readyState==='complete'`), 'mobile viewport');
    await page(`showResult('wrong')`);
    assert.equal(await page(`new DOMMatrix(getComputedStyle(document.querySelector('#feedback img')).transform).f`),-17,'opening repairs the legacy saved position before editing');
    await select('#feedback img');
    assert.equal(await page(`(()=>{const e=document.querySelector('#feedback img');return document.querySelectorAll('div#feedback > img[alt="错误提示"]').length})()`),1);
    await page(`document.querySelector('[data-editor-tools] button').click()`);
    await page(`(()=>{const e=document.querySelector('#feedback img');e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:41,clientX:100,clientY:100}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:41,clientX:100,clientY:77}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:41}))})()`);
    await until(() => ui(`!!document.querySelector('.save-state.dirty')`),'result image drag');
    await save(); await refresh();
    await click('测试');
    await page(`document.querySelector('#feedback').before(document.createElement('div'));showResult('wrong')`);
    assert.equal(await page(`new DOMMatrix(getComputedStyle(document.querySelector('#feedback img')).transform).f`),-40,'saved result rule survives recreation and sibling insertion in test mode');
    await page(`showResult('correct')`);
    assert.equal(await page(`getComputedStyle(document.querySelector('#feedback img')).transform`),'none','wrong-result position does not leak into correct-result art');
    await click('编辑');
    await delay(60); // allow the asynchronous set-mode message to reach the iframe
    await select('#feedback img');
    await page(`document.querySelector('[data-editor-tools] button').click()`);
    await page(`(()=>{const e=document.querySelector('#feedback img');e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:42,clientX:100,clientY:100}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:42,clientX:100,clientY:75}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:42}))})()`);
    await until(() => ui(`!!document.querySelector('.save-state.dirty')`),'new result position records');
    await save(); await refresh();
    await click('测试');
    await page(`document.querySelector('#feedback').before(document.createElement('div'));showResult('correct')`);
    assert.equal(await page(`new DOMMatrix(getComputedStyle(document.querySelector('#feedback img')).transform).f`),-25,'new saved selector survives sibling insertion and regeneration');
    const exported = new electron.BrowserWindow({show:false,width:378,height:763,useContentSize:true,webPreferences:{sandbox:true}});
    try {
      await exported.loadFile(path.join(projectRoot,'index.html'));
      assert.equal(await exported.webContents.executeJavaScript('innerWidth'),378);
      await exported.webContents.executeJavaScript(`showResult('wrong')`);
      assert.equal(await exported.webContents.executeJavaScript(`new DOMMatrix(getComputedStyle(document.querySelector('#feedback img')).transform).f`),-40,'saved HTML applies position without the editor bridge');
      await exported.webContents.executeJavaScript(`showResult('correct')`);
      assert.equal(await exported.webContents.executeJavaScript(`new DOMMatrix(getComputedStyle(document.querySelector('#feedback img')).transform).f`),-25,'new correct-result rule is independent of the migrated wrong-result rule');
      await exported.webContents.executeJavaScript(`showResult('wrong')`);
      assert.equal(await exported.webContents.executeJavaScript(`new DOMMatrix(getComputedStyle(document.querySelector('#feedback img')).transform).f`),-40,'standalone repeated answer also retains position');
    } finally { exported.destroy(); }
  }],
  ['saved automatic IDs stay unique and editing the next element writes the correct target', async () => {
    await select('#fresh');
    assert.notEqual(await page(`document.querySelector('#fresh').dataset.editorId`), 'auto-1');
    await field('字号', '48'); await save(); await refresh();
    assert.equal(await page(`getComputedStyle(document.querySelector('#fresh')).fontSize`), '48px');
    assert.notEqual(await page(`getComputedStyle(document.querySelector('#existing')).fontSize`), '48px');
    const assetHit = await page(`(()=>{const image=document.querySelector('#drag-image');const rect=image.getBoundingClientRect();const target=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:9,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));return {target:target.tagName,id:image.dataset.editorId}})()`);
    assert.equal(assetHit.target, 'BUTTON', 'fixture image is covered by its draggable parent and has pointer-events:none');
    assert.ok(assetHit.id, 'editor selects the image asset behind the button hit target');
    await until(() => ui(`document.querySelector('.selected-title')?.textContent===${JSON.stringify(assetHit.id)}`), 'select nested draggable image');
    assert.equal(await page(`(()=>{const event=new DragEvent('dragstart',{bubbles:true,cancelable:true});document.querySelector('#drag-image').dispatchEvent(event);return event.defaultPrevented})()`), true, 'editor prevents the browser from stealing a native image drag');
    await page(`document.querySelector('[data-editor-tools] button').click()`);
    await page(`(()=>{const image=document.querySelector('#drag-image');image.setPointerCapture=()=>{};image.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:10,clientX:100,clientY:100}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:10,clientX:140,clientY:125}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:10}))})()`);
    await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'dragging nested image records an edit');
    assert.deepEqual(await page(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#drag-image')).transform);return [m.m41,m.m42]})()`), [40,25]);
    await save(); await refresh();
    assert.deepEqual(await page(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#drag-image')).transform);return [m.m41,m.m42]})()`), [40,25], 'nested image drag persists after refresh');
    const compositeId = await page(`(()=>{const slot=document.querySelector('#formula-slot');slot.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:11,clientX:120,clientY:100}));return document.querySelector('#formula-art').dataset.editorId})()`);
    await until(() => ui(`document.querySelector('.selected-title')?.textContent===${JSON.stringify(compositeId)}`), 'empty slot selects the visible CSS background asset that draws it');
    assert.equal(await page(`document.querySelector('#formula-slot').dataset.editorId`), null, 'the invisible overlay button is not mistaken for the visible artwork');
    await page(`document.querySelector('[data-editor-tools] button').click()`);
    await page(`(()=>{const art=document.querySelector('#formula-art');art.setPointerCapture=()=>{};document.querySelector('#formula-slot').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:12,clientX:120,clientY:100}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:12,clientX:155,clientY:128}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:12}))})()`);
    await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'dragging the visible composite artwork records an edit');
    assert.deepEqual(await page(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#formula-art')).transform);return [m.m41,m.m42]})()`), [35,28], 'drag moves the background artwork rather than its invisible hit area');
    await save(); await refresh();
    assert.deepEqual(await page(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#formula-art')).transform);return [m.m41,m.m42]})()`), [35,28], 'composite artwork movement persists after refresh');
    await click('华为 Pura 70 Pro+');
    await until(() => page(`innerWidth===378 && innerHeight===763 && document.readyState==='complete'`), 'Huawei phone webpage viewport shown upright in landscape');
    await until(() => page(`document.documentElement.classList.contains('landscape-stage-rotated')`), 'course rotates its stage for the portrait phone viewport');
    assert.match(await page(`navigator.userAgent`), /Android.*Mobile/);
    assert.equal(await page(`navigator.maxTouchPoints`), 5);
    const pageOrientation = await page(`({width:innerWidth,height:innerHeight,ua:navigator.userAgent,classes:document.documentElement.className,stage:document.querySelector('#stage').style.transform})`);
    assert.equal(pageOrientation.classes.includes('mobile-portrait-layout'), true, JSON.stringify(pageOrientation));
    assert.equal(await page(`document.documentElement.classList.contains('landscape-stage-rotated')`), true);
    assert.equal(await ui(`document.querySelector('.preview-frame').style.width`), '763px');
    assert.equal(await ui(`document.querySelector('.preview-frame').style.height`), '378px');
    assert.equal(await ui(`document.querySelector('.preview-page.rotated iframe').style.width`), '378px');
    assert.equal(await ui(`document.querySelector('.preview-page.rotated iframe').style.height`), '763px');
    assert.equal(await ui(`Math.round(document.querySelector('.preview-page.rotated').getBoundingClientRect().width)`), Math.round(await ui(`document.querySelector('.preview-frame').getBoundingClientRect().width`)));
    assert.equal(await ui(`Math.round(document.querySelector('.preview-page.rotated').getBoundingClientRect().height)`), Math.round(await ui(`document.querySelector('.preview-frame').getBoundingClientRect().height`)));
    const outerRotation = await ui(`new DOMMatrix(getComputedStyle(document.querySelector('.preview-page.rotated')).transform).b`);
    const stageRotation = await page(`new DOMMatrix(getComputedStyle(document.querySelector('#stage')).transform).b`);
    assert.equal(outerRotation, -stageRotation, 'editor rotation cancels the course stage rotation');
    const previewBounds = await ui(`(()=>{const r=document.querySelector('.preview-stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const previewImage = await win.webContents.capturePage({ x: Math.round(previewBounds.x), y: Math.round(previewBounds.y), width: Math.round(previewBounds.width), height: Math.round(previewBounds.height) });
    fs.writeFileSync(path.join(temporary, 'huawei-landscape-preview.png'), previewImage.toPNG());
    await click('网页原生横屏 · 763 × 378');
    await until(() => page(`innerWidth===763 && innerHeight===378 && document.readyState==='complete'`), 'Huawei native landscape preview');
    assert.equal(await page(`document.documentElement.classList.contains('mobile-portrait-layout')`), false);
    assert.equal(await page(`document.documentElement.classList.contains('landscape-stage-rotated')`), false);
    await click('横屏显示 · 网页 378 × 763');
    await until(() => page(`innerWidth===378 && innerHeight===763 && document.readyState==='complete'`), 'Huawei rotated portrait page restored');
    await select('#fresh'); await field('字号','36'); await save(); await refresh();
    assert.equal(await page(`getComputedStyle(document.querySelector('#fresh')).fontSize`),'36px');
    await click('电脑');
    await until(() => page(`innerWidth===1440 && document.readyState==='complete'`), 'desktop restore');
    assert.doesNotMatch(await page(`navigator.userAgent`), /Android.*Mobile/);
    assert.equal(await page(`getComputedStyle(document.querySelector('#fresh')).fontSize`),'48px');
  }],
  ['editing text preserves SVG, nested label and counter before and after saving', async () => {
    await select('#rich');
    assert.equal(await ui(`document.querySelector('.inspector-panel textarea').value`), '开始');
    await field('文字内容', '继续<&>');
    assert.equal(await page(`document.querySelector('#rich svg title').textContent`), '图标');
    assert.equal(await page(`document.querySelector('#rich b').textContent`), '0/3');
    await save(); await refresh();
    assert.equal(await page(`document.querySelector('#rich span').textContent`), '继续<&>');
    assert.equal(await page(`document.querySelector('#rich b').textContent`), '0/3');
  }],
  ['dragging preserves rotation and scaling; undo/redo restores the actual transform', async () => {
    await select('#rotated');
    const before = await page(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#rotated')).transform);return [m.a,m.b,m.c,m.d,m.e,m.f]})()`);
    await page(`document.querySelector('[data-editor-tools] button').click()`);
    await page(`(()=>{const e=document.querySelector('#rotated');e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:100,clientY:100}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:140,clientY:125}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}))})()`);
    await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'drag recorded');
    const after = await page(`(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('#rotated')).transform);return [m.a,m.b,m.c,m.d,m.e,m.f]})()`);
    assert.deepEqual(after.slice(0,4), before.slice(0,4)); assert.equal(after[4]-before[4],40); assert.equal(after[5]-before[5],25);
    await click('撤销'); await delay(60);
    assert.equal(await page(`new DOMMatrix(getComputedStyle(document.querySelector('#rotated')).transform).e`), before[4]);
    await click('重做');
    await until(() => page(`new DOMMatrix(getComputedStyle(document.querySelector('#rotated')).transform).e===40`), 'redo applied');
    await save();
    assert.match(fs.readFileSync(path.join(projectRoot,'index.html'),'utf8'), /matrix\([^)]*40[^)]*25\)/);
    await refresh();
    const state = await page(`(()=>{const e=document.querySelector('#rotated');return {inline:e.style.transform,computed:getComputedStyle(e).transform,html:e.outerHTML,ready:document.readyState,matrix:new DOMMatrix(getComputedStyle(e).transform).e}})()`);
    assert.equal(state.matrix, after[4], JSON.stringify(state));
  }],
  ['font edits preserve authored inline priority; clearing a value survives reload', async () => {
    await select('#plain'); await field('字号','48'); await save(); await refresh();
    assert.equal(await page(`getComputedStyle(document.querySelector('#plain')).fontSize`),'48px');
    await select('#plain'); await field('字号',''); await save(); await refresh();
    assert.equal(await page(`getComputedStyle(document.querySelector('#plain')).fontSize`),'18px');
  }],
  ['interaction drafts survive selecting another element and save to their original source', async () => {
    await select('#action'); await field('点击后动作','navigate'); await field('目标页面','next.html');
    await select('#plain'); assert.equal(await ui(`!!document.querySelector('.save-state.dirty')`),true);
    await select('#action'); assert.equal(await ui(`document.querySelector('.interaction-panel select').value`),'navigate');
    await select('#plain'); await save(); await refresh(); await select('#action');
    await until(() => ui(`document.querySelector('.interaction-panel select')?.value==='navigate'`), 'interaction reads back');
    assert.match(fs.readFileSync(path.join(projectRoot,'index.html'),'utf8'), /"targetPage":"\/?next.html"/);
  }],
  ['edits made while saving remain dirty and a subsequent save persists them', async () => {
    await select('#plain'); await field('字号','48'); saveDelay=400; maxActiveSaves=0;
    await click('保存'); await until(() => activeSaves===1,'save begins'); await field('字号','64');
    await until(() => activeSaves===0,'save finishes'); await delay(80);
    assert.equal(await ui(`!!document.querySelector('.save-state.dirty')`),true);
    assert.equal(maxActiveSaves,1); saveDelay=0; await save(); await refresh();
    assert.equal(await page(`getComputedStyle(document.querySelector('#plain')).fontSize`),'64px');
  }],
  ['test-mode navigation and closing the window protect unsaved work', async () => {
    await select('#plain'); await field('字号','50'); await click('测试');
    await until(() => ui(`!!document.querySelector('[aria-label="未保存修改"]')`),'mode-switch warning'); await click('取消');
    const count=closePrompts; win.close(); await until(() => closePrompts>count,'close warning');
    assert.equal(win.isDestroyed(),false); await save();
  }],
];
app.whenReady().then(async () => {
  let failed=0;
  const results=[];
  const timeout=setTimeout(()=>{console.error('Self-check timed out');app.exit(1)},120000);
  for (const [name, check] of checks) {
    try { await reset(); await check(); const line='PASS: '+name; results.push(line); console.log(line); }
    catch(error) { failed++; const line='FAIL: '+name+'\n'+error.stack; results.push(line); console.error(line); }
  }
  clearTimeout(timeout);
  const summary=`${checks.length-failed}/${checks.length} Electron checks passed; temporary project: ${projectRoot}`;
  results.push(summary);
  fs.writeFileSync(resultFile, results.join('\n'), 'utf8');
  console.log(summary);
  if(win&&!win.isDestroyed())win.destroy();
  app.exit(failed?1:0);
});
