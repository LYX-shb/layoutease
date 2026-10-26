// Run with Electron after building. All edits are made to temporary project copies.
const electron = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-scene-check-'));
const project = path.join(root, 'project');
const course = process.argv.find(arg => arg.startsWith('--course='))?.slice(9);
if (course) fs.cpSync(course, project, { recursive: true });
else fs.mkdirSync(project);
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0}#stage{position:absolute;left:160px;top:140px;width:850px;height:550px;transform-origin:0 0}
#panel,#box{position:absolute}#box{background:#def;width:110px;height:50px;left:480px;top:250px}
</style></head><body><main id="stage" data-phase="collect"><img id="panel" src="panel.svg" data-editor-id="panel"><div id="box" data-editor-id="box">共用框</div></main>
<script>window.setScene=phase=>{const s=document.querySelector('#stage'),p=document.querySelector('#panel');s.dataset.phase=phase;Object.assign(p.style,phase==='collect'?{left:'30px',top:'40px',width:'250px',height:'140px'}:{left:'110px',top:'70px',width:'300px',height:'160px'});};setScene('collect');</script></body></html>`;
if (!course) {
  fs.writeFileSync(path.join(project, 'index.html'), fixture);
  fs.writeFileSync(path.join(project, 'panel.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#9dc"/></svg>');
}
electron.app.setPath('userData', path.join(root, 'profile'));
delete process.env.VITE_DEV_SERVER_URL;
let win;
const handle = electron.ipcMain.handle.bind(electron.ipcMain);
const replacement = {
  ...electron,
  BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({ ...options, width: 1600, height: 1000, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); win = this; }
  },
  dialog: { ...electron.dialog, showOpenDialog: async () => ({ canceled: false, filePaths: [project] }) },
  ipcMain: { handle(name, handler) { handle(name, name === 'project:catalog' ? async () => ({ ok: true, items: [], lastKey: '', limited: false }) : handler); } },
};
const originalLoad = Module._load;
Module._load = function(name, parent, main) { return name === 'electron' ? replacement : originalLoad.call(this, name, parent, main); };
try { require('../electron/main.cjs'); } finally { Module._load = originalLoad; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ui = code => win.webContents.executeJavaScript(code);
const frame = () => win.webContents.mainFrame.frames.find(item => item.url.startsWith('editor-project://'));
const page = code => frame().executeJavaScript(code);
async function until(check, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { try { if (await check()) return; } catch {} await delay(40); }
  throw Error('Timed out: ' + label);
}
async function click(label) {
  await ui(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable '+${JSON.stringify(label)});b.click()})()`);
  await delay(60);
}
async function scene(phase) {
  if (course) {
    await page(`(()=>{const phase=${JSON.stringify(phase)},config=CourseConfig.layouts[phase];document.querySelector('#stage').dataset.phase=phase;for(const [id,box] of Object.entries(config)){const element=document.getElementById(id);if(element&&(box===null||Array.isArray(box)&&typeof box[0]==='number'))CourseUtils.place(element,box);}})()`);
  } else await page(`setScene(${JSON.stringify(phase)})`);
  await delay(60);
}
async function select(selector) {
  await ui('window.lastSelection=null');
  await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:r.left+r.width*${course ? 0.01 : 0.5},clientY:r.top+r.height*${course ? 0.99 : 0.5}}));})()`);
  await until(() => ui(`!!window.lastSelection?.stateScope`), 'state-scoped selection');
}
async function metrics(selector = '#panel') {
  return page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,transform:s.transform,cssWidth:s.width,cssHeight:s.height}})()`);
}
function closeBounds(actual, expected, label, tolerance = 1.5) {
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(actual[key] - expected[key]) < tolerance, `${label}: ${key}, actual ${actual[key]}, expected ${expected[key]}`);
}
async function drag(selector, dx, dy) {
  await select(selector);
  await page(`document.querySelector('[data-editor-tools] button').click()`);
  await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.left+r.width*${course ? 0.01 : 0.5},y=r.top+r.height*${course ? 0.99 : 0.5};e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x+${dx},clientY:y+${dy}}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}));})()`);
  await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'drag recorded');
}
async function field(label, value) {
  await ui(`(()=>{const r=[...document.querySelectorAll('.property-row')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)}),e=r.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await delay(60);
  await ui(`(()=>{const r=[...document.querySelectorAll('.property-row')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(label)});r.querySelector('input').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));})()`);
  await delay(60);
}
async function save() {
  await click('保存');
  await until(() => ui(`!document.querySelector('.save-state.dirty')`), 'save finished');
}
async function refresh() {
  await page(`window.beforeRefresh=true`);
  await click('刷新预览');
  await until(() => frame() && page(`document.readyState==='complete'&&!window.beforeRefresh&&document.querySelector('#panel')?.getBoundingClientRect().width>0`), 'fresh preview');
  await delay(100);
}
const results = [];
function pass(name) { results.push(name); console.log('PASS ' + name); }
electron.app.whenReady().then(async () => {
  const timeout = setTimeout(() => electron.app.exit(1), 90000);
  try {
    await until(() => ui(`!!document.querySelector('.empty-workspace')`), 'editor');
    await click('浏览文件夹');
    await until(() => frame() && page(`document.readyState==='complete'`), 'project');
    await ui(`(()=>{const s=document.querySelector('[aria-label="预览设备"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'desktop');s.dispatchEvent(new Event('change',{bubbles:true}));window.addEventListener('message',e=>{if(e.data?.type==='selected')window.lastSelection=e.data;});})()`);
    await until(() => frame() && page(`innerWidth===1440&&document.readyState==='complete'`), 'desktop viewport');
    await scene('hint');
    const hintBefore = await metrics();
    await drag('#panel', 43, 23);
    const hintAfter = await metrics();
    closeBounds(hintAfter, { ...hintBefore, x: hintBefore.x + 43, y: hintBefore.y + 23 }, 'drag direction (including alignment snapping)', 7);
    const targetWidth = String(Math.round(parseFloat(hintAfter.cssWidth) - 31));
    await field('宽度', targetWidth);
    const hintSized = await metrics();
    assert.equal(hintSized.cssWidth, targetWidth + 'px');
    await scene('collect');
    const collectBefore = await metrics();
    assert.equal(collectBefore.transform, 'none', 'earlier scene has no later-scene transform, including legacy migration');
    await drag('#panel', -37, -19);
    const collectAfter = await metrics();
    closeBounds(collectAfter, { ...collectBefore, x: collectBefore.x - 37, y: collectBefore.y - 19 }, 'earlier-scene drag (including alignment snapping)', 7);
    await scene('hint');
    closeBounds(await metrics(), hintSized, 'later scene keeps own draft');
    await click('撤销');
    closeBounds(await metrics(), hintSized, 'undo in another scene does not move this scene');
    await scene('collect');
    closeBounds(await metrics(), collectBefore, 'undo restores only the edited scene');
    await click('重做');
    closeBounds(await metrics(), collectAfter, 'redo restores the correct scene');
    await save();
    pass('two scenes, same node/source: independent drafts, resize, undo and redo');
    await refresh();
    closeBounds(await metrics(), collectAfter, 'saved initial scene');
    await scene('hint');
    closeBounds(await metrics(), hintSized, 'saved hint scene');
    await select('#panel');
    await field('宽度', String(Number(targetWidth) - 20));
    const hintResaved = await metrics();
    await save(); await refresh();
    closeBounds(await metrics(), collectAfter, 'resaving hint leaves initial scene intact');
    await scene('hint'); closeBounds(await metrics(), hintResaved, 'repeated save retains hint position');
    pass('save, reload, and repeated saves keep both scene layouts');
    const savedHtml = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
    assert.ok(savedHtml.includes('data-phase="hint"') && savedHtml.includes('data-phase="collect"'));
    const standalone = new electron.BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await standalone.loadFile(path.join(project, 'index.html'));
    const savedTransform = await standalone.webContents.executeJavaScript(`getComputedStyle(document.querySelector('#panel')).transform`);
    assert.equal(savedTransform, collectAfter.transform);
    standalone.destroy();
    pass('saved styles also work outside the editor');
    if (!course) {
      await scene('collect');
      const boxBefore = await metrics('#box');
      await scene('hint'); await select('#box'); await field('宽度', '170'); await save();
      await scene('collect'); closeBounds(await metrics('#box'), boxBefore, 'non-image shared box');
      await refresh(); await scene('hint'); assert.equal((await metrics('#box')).cssWidth, '170px');
      pass('non-image shared boxes are isolated too');
      // Same inverse-coordinate path used by portrait courseware, with no device UI dependency.
      await page(`document.querySelector('#stage').style.transform='translate(500px,0) rotate(90deg) scale(.7)'`);
      await scene('hint');
      const rotatedBefore = await metrics();
      await drag('#panel', 32, -26);
      closeBounds(await metrics(), { ...rotatedBefore, x: rotatedBefore.x + 32, y: rotatedBefore.y - 26 }, 'rotated parent drag (including alignment snapping)', 7);
      await scene('collect');
      const rotatedCollect = await metrics();
      await scene('hint'); await save(); await refresh();
      await page(`document.querySelector('#stage').style.transform='translate(500px,0) rotate(90deg) scale(.7)'`);
      closeBounds(await metrics(), rotatedCollect, 'rotated previous scene after saving');
      pass('rotated and scaled parent preserves pointer direction and scene isolation');
    } else {
      // The real course already has an editor-wide panel rule. Its first edit migrates it.
      assert.ok(!/<style[^>]*>img#panel\[src=[^{}]+\{/.test(savedHtml), 'legacy global panel rule is now scene-scoped');
      pass('existing course global override migrated in the temporary copy');
    }
    const output = path.resolve(__dirname, '../release/scene-isolation-check');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, course ? 'course-result.json' : 'fixture-result.json'), JSON.stringify({ ok: true, project, results }, null, 2));
    clearTimeout(timeout); win.destroy(); electron.app.exit(0);
  } catch (error) {
    console.error(error.stack); console.error('Temporary project:', project);
    try { console.error(JSON.stringify(await ui('window.lastSelection'))); console.error(await page(`JSON.stringify([...document.querySelectorAll('style[data-editor-dynamic],style[data-editor-preview-style]')].map(s=>[s.getAttribute('data-editor-dynamic'),[...s.sheet.cssRules].map(r=>r.cssText)]))`)); } catch {}
    clearTimeout(timeout); if (win && !win.isDestroyed()) win.destroy(); electron.app.exit(1);
  }
});
