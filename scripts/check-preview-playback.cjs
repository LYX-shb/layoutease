// Real Chromium regression check; project edits stay in temporary copies.
const electron = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-playback-check-'));
const project = path.join(root, 'project');
fs.mkdirSync(project);
const course = process.argv.find(arg => arg.startsWith('--course='))?.slice(9);
if (course) fs.cpSync(course, project, { recursive: true });
else {
fs.writeFileSync(path.join(project, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:24px sans-serif;background:#f5f7ff}main{position:relative;width:900px;height:600px;background:white}
#feedback{position:absolute;left:180px;top:180px;width:220px;height:100px;background:#dceee5;padding:20px}
button{margin:20px;padding:14px;font-size:20px}.motion{width:30px;height:30px;background:#6699cc;animation:move 8s linear infinite}
@keyframes move{to{transform:translateX(300px)}}
</style><script>window.earlyTicks=0;window.counter=setInterval(()=>earlyTicks++,100);</script></head>
<body><main id="stage" data-phase="question"><button id="answer">回答正确</button><button id="instant">立即延时切换</button>
<div id="feedback" data-editor-id="feedback">请作答</div><div class="motion"></div></main><script>
const stage=document.querySelector('main'), feedback=document.querySelector('#feedback');
document.querySelector('#answer').onclick=()=>{stage.dataset.phase='correct';feedback.textContent='回答正确';window.nextAt=performance.now()+1800;setTimeout(()=>{stage.dataset.phase='next';feedback.textContent='下一题';},1800);};
document.querySelector('#instant').onclick=()=>{stage.dataset.phase='correct';feedback.textContent='立即反馈';setTimeout(()=>{stage.dataset.phase='next';feedback.textContent='下一题';},0);};
</script></body></html>`);
fs.writeFileSync(path.join(project, 'next.html'), '<!doctype html><html><body><main data-phase="intro"><h1>下一页</h1></main></body></html>');
}
electron.app.setPath('userData', path.join(root, 'profile'));
if (process.argv.includes('--inspect-ui')) electron.app.commandLine.appendSwitch('remote-debugging-port', '9336');
delete process.env.VITE_DEV_SERVER_URL;
let win;
const replacement = { ...electron,
  BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({ ...options, show: false, width: 1586, height: 992, useContentSize: true,
      webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); win = this;
      this.webContents.on('console-message', (event, ...args) => { const message = event.message || args.filter(item => typeof item === 'string').join(' '); if (message) console.error('RENDERER', message); });
    }
  },
  dialog: { ...electron.dialog, showOpenDialog: async () => ({ canceled: false, filePaths: [project] }) },
};
const originalLoad = Module._load;
Module._load = function(name, parent, main) { return name === 'electron' ? replacement : originalLoad.call(this, name, parent, main); };
try { require('../electron/main.cjs'); } finally { Module._load = originalLoad; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ui = code => win.webContents.executeJavaScript(code);
const frame = () => win.webContents.mainFrame.frames.find(item => item.url.startsWith('editor-project://'));
const page = code => frame().executeJavaScript(code);
async function until(check, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { try { if (await check()) return; } catch {} await delay(40); }
  throw Error('Timed out: ' + label);
}
async function click(label) {
  await ui(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable '+${JSON.stringify(label)});b.click()})()`);
  await delay(60);
}
const results = [];
const pass = label => { results.push(label); console.log('PASS ' + label); };
electron.app.whenReady().then(async () => {
  try {
    await until(() => ui(`!!document.querySelector('.empty-workspace')`), 'workspace');
    await click('浏览文件夹');
    await until(() => frame() && page(`window.__editorPlaybackRuntime?.state().paused`), 'initial edit pause');
    if (process.argv.includes('--check-progress')) {
      await click('测试');
      await page(`window.progressMarker='middle-of-test';document.querySelector('main').dataset.phase='middle'`);
      fs.writeFileSync(path.join(project, 'updated.css'), 'body{color:inherit}');
      await until(() => ui(`!!document.querySelector('.preview-stage-banner') || !!document.querySelector('.status-feedback')?.textContent.includes('最新内容')`), 'file change reaches editor');
      await delay(700);
      assert.equal(await page(`window.progressMarker`), 'middle-of-test', 'external file change must not reload a running test');
      assert.equal(await page(`document.querySelector('main').dataset.phase`), 'middle');
      assert.equal(await ui(`document.querySelector('.preview-mode-switcher .active').textContent`), '测试');
      pass('external file changes leave test progress and document intact');
      await click('编辑');
      await page(`(()=>{const e=document.querySelector('#feedback'),r=e.getBoundingClientRect();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:r.left+20,clientY:r.top+20}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:r.left+20,clientY:r.top+20}));})()`);
      await until(() => ui(`document.querySelector('.selected-title')?.dataset.elementId==='feedback'`), 'progress selection');
      await page(`(()=>{const e=document.querySelector('[data-selection-frame]'),r=e.getBoundingClientRect(),x=r.left+20,y=r.top+20;e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x+45,clientY:y+30}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:x+45,clientY:y+30}));})()`);
      await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'progress edit recorded');
      await click('测试');
      await until(() => ui(`!!document.querySelector('[aria-label="未保存修改"]')`), 'save before continuing');
      await click('保存并切换');
      await until(() => ui(`document.querySelector('.preview-mode-switcher .active').textContent==='测试'&&!document.querySelector('[aria-label="未保存修改"]')`), 'saved and continued');
      assert.equal(await page(`window.progressMarker`), 'middle-of-test', 'save-and-continue must not remount the preview');
      assert.equal(await page(`document.querySelector('main').dataset.phase`), 'middle');
      pass('save-and-continue retains the same document and current scene');
      await click('读取最新文件');
      await until(() => page(`!window.progressMarker&&document.querySelector('main').dataset.phase==='question'`), 'explicit refresh');
      pass('explicitly reading latest files refreshes when requested');
      electron.app.exit(0); return;
    }
    if (course && !process.argv.includes('--inspect-ui')) {
      console.log('INITIAL_COURSE_STATE', await page(`JSON.stringify(CoursewareApp.getState())`));
      await click('测试');
      await until(() => page(`CoursewareApp.getState().ready`), 'real course ready');
      await page(`document.querySelector('[data-hit-area="count-left"]').click()`);
      await click('立即定格');
      await until(() => ui(`document.querySelector('.preview-mode-switcher button.active').textContent==='编辑'`), 'real course capture');
      const before = await page(`document.querySelector('#stage').outerHTML`);
      await delay(2100);
      assert.equal(await page(`document.querySelector('#stage').outerHTML`), before);
      await click('测试');
      await until(async () => await page(`document.querySelector('#stage').outerHTML`) !== before, 'real course continues');
      console.log('PASS actual course click freezes its count feedback and resumes without rewriting original files');
      electron.app.exit(0); return;
    }
    if (process.argv.includes('--inspect-ui')) {
      win.showInactive();
      console.log('UI_READY ' + project);
      await delay(250);
      const directory = path.join(__dirname, '..', 'release', 'playback-check'); fs.mkdirSync(directory, { recursive: true });
      const layouts = [];
      for (const width of [1586, 1120, 1000, 1586]) {
        win.setContentSize(width, 900);
        await delay(200);
        win.webContents.invalidate();
        await delay(100);
        layouts.push(await ui(`(()=>{const r=document.querySelector('.preview-device-toolbar').getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,toolbar:{left:r.left,right:r.right},controls:[...document.querySelectorAll('.preview-action-controls > *')].map(e=>{const b=e.getBoundingClientRect();return {text:e.textContent.trim(),left:b.left,right:b.right,top:b.top,bottom:b.bottom}})}})()`));
        fs.writeFileSync(path.join(directory, 'ui-' + width + '.png'), (await win.webContents.capturePage()).toPNG());
      }
      fs.writeFileSync(path.join(directory, 'layouts.json'), JSON.stringify(layouts, null, 2));
      return;
    }
    const ticks = await page('earlyTicks'); await delay(500);
    assert.equal(await page('earlyTicks'), ticks);
    assert.equal(await page(`document.querySelector('.motion').getAnimations()[0].playState`), 'paused');
    pass('initial edit pauses head-script intervals and CSS animation');
    await click('测试');
    await page(`document.querySelector('#answer').click()`);
    await ui(`document.querySelector('.freeze-capture-button').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:7}))`);
    await until(() => ui(`document.querySelector('.preview-mode-switcher button.active').textContent==='编辑'`), 'capture enters edit');
    await until(() => ui(`document.querySelector('.freeze-capture-button').textContent==='已定格'`), 'freeze acknowledgement');
    await delay(2100);
    assert.equal(await page(`document.querySelector('main').dataset.phase`), 'correct');
    pass('pointerdown without click or pointerup freezes current feedback beyond its original 1800ms transition');
    await page(`(()=>{const e=document.querySelector('#feedback'),r=e.getBoundingClientRect();e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:r.left+20,clientY:r.top+20}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:r.left+20,clientY:r.top+20}));})()`);
    await until(() => ui(`document.querySelector('.selected-title')?.dataset.elementId==='feedback'`), 'select frozen element');
    await page(`(()=>{const e=document.querySelector('[data-selection-frame]');if(!e)throw Error('move control missing');const r=e.getBoundingClientRect(),x=r.left+20,y=r.top+20;e.setPointerCapture=()=>{};e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x+45,clientY:y+30}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:x+45,clientY:y+30}));})()`);
    await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'drag records edit');
    assert.match(await page(`document.querySelector('#feedback').style.translate`), /45px 30px/);
    await click('已定格');
    assert.equal(await ui(`!!document.querySelector('[aria-label="未保存修改"]')`), false);
    assert.equal(await ui(`!!document.querySelector('.save-state.dirty')`), true);
    assert.match(await page(`document.querySelector('#feedback').style.translate`), /45px 30px/);
    pass('freezing with an unsaved draft retains edits without a save dialog or reload');
    await click('撤销');
    assert.doesNotMatch(await page(`document.querySelector('#feedback').style.translate`), /45px 30px/);
    await click('重做');
    assert.match(await page(`document.querySelector('#feedback').style.translate`), /45px 30px/);
    await click('保存');
    await until(() => ui(`!document.querySelector('.save-state.dirty')`), 'save');
    const saved = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
    assert.ok(saved.includes('45px 30px'));
    assert.ok(!saved.includes('data-editor-playback'));
    pass('selection, dragging, undo, redo and save work while frozen; playback runtime stays out of saved HTML');
    await click('测试');
    await delay(500); assert.equal(await page(`document.querySelector('main').dataset.phase`), 'correct');
    await until(() => page(`document.querySelector('main').dataset.phase==='next'`), 'remaining timer resumes');
    pass('test resumes the pending transition without firing it immediately');
    await click('立即定格');
    await until(() => page(`window.__editorPlaybackRuntime.state().paused`), 'keyboard freeze');
    assert.equal(await page(`document.querySelector('main').dataset.phase`), 'next');
    await page(`window.frozenTimerRan=false;setTimeout(()=>window.frozenTimerRan=true,0)`);
    await delay(200); assert.equal(await page(`window.frozenTimerRan`), false);
    pass('keyboard/programmatic activation freezes the current scene and blocks newly scheduled zero-delay timers');
    await click('已定格');
    assert.equal(await page(`window.__editorPlaybackRuntime.state().armed`), false);
    assert.equal(await page(`window.__editorPlaybackRuntime.state().paused`), true);
    await click('刷新预览');
    await until(() => page(`document.querySelector('main').dataset.phase==='question' && window.__editorPlaybackRuntime.state().paused`), 'fresh edit preview');
    pass('repeated immediate freeze and explicit refresh reset playback correctly');
    const directory = path.join(__dirname, '..', 'release', 'playback-check'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ok: true, project, results }, null, 2));
    fs.writeFileSync(path.join(directory, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
    electron.app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    try { console.error('UI_STATE', await ui(`JSON.stringify({mode:document.querySelector('.preview-mode-switcher .active')?.textContent,button:document.querySelector('.freeze-capture-button')?.textContent,disabled:document.querySelector('.freeze-capture-button')?.disabled,message:document.querySelector('.status-feedback')?.textContent})`)); console.error('PAGE_STATE', await page(`JSON.stringify({runtime:window.__editorPlaybackRuntime?.state(),freezeType:typeof window.__editorPlaybackRuntime?.freeze,phase:document.querySelector('main')?.dataset.phase})`)); } catch {}
    electron.app.exit(1);
  }
});
