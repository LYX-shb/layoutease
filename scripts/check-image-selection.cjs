// Run with Electron after building; course files are copied to a temporary project.
const electron = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const Module = require('node:module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-image-selection-'));
const project = path.join(root, 'project');
const course = process.argv.find(arg => arg.startsWith('--course='))?.slice(9);
if (course) fs.cpSync(course, project, { recursive: true });
else fs.mkdirSync(project);
if (process.argv.includes('--without-old-svg-runtime')) {
  const file = path.join(project, 'index.html');
  fs.writeFileSync(file, fs.readFileSync(file,'utf8').replace(/<script\b[^>]*data-editor-svg-layout-runtime[^>]*>[\s\S]*?<\/script>/gi,''));
}
const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="80"%3E%3Crect width="120" height="80" fill="orange"/%3E%3C/svg%3E';
const fixture = `<!doctype html><html><head><style>
body{margin:20px}.case{position:relative;display:inline-block;width:140px;height:100px;margin:10px;vertical-align:top}
.art{width:120px;height:80px;pointer-events:none}.cover{position:absolute;inset:0;background:transparent;border:0;padding:0}
.background{width:120px;height:80px;background:linear-gradient(orange,red);pointer-events:none}
.rotated{transform:rotate(30deg)}.hidden{visibility:hidden}.clipped{clip-path:inset(0 50% 0 0)}
.behind{position:absolute;inset:0}.opaque{position:absolute;inset:0;background:white}
</style></head><body>
<div class="case"><img id="covered-art" class="art" src='${image}'><button id="hit-area" class="cover" aria-label="交互热区"></button><svg style="position:absolute;inset:0;pointer-events:none" width="140" height="100"><g data-node="overlay-a"><rect width="5" height="5" fill="blue"/></g><g data-node="overlay-b"><rect x="130" width="5" height="5" fill="blue"/></g></svg></div>
<div class="case"><div id="css-art" class="background"></div><button class="cover" aria-label="背景热区"></button></div>
<div class="case"><button id="multi-button" class="cover"><img id="first-icon" style="position:absolute;left:0;top:0;width:40px;height:40px;pointer-events:none" src='${image}'><img id="second-icon" style="position:absolute;right:0;bottom:0;width:40px;height:40px;pointer-events:none" src='${image}'></button></div>
<div class="case"><img id="text-backdrop" class="art" src='${image}'><button class="cover"><span id="visible-text">下一题</span></button></div>
<div class="case"><img id="hidden-art" class="art hidden" src='${image}'><button id="visible-button" class="cover">可见按钮</button></div>
<div class="case"><img id="occluded-art" class="art" src='${image}'><div id="opaque-cover" class="opaque">前景内容</div></div>
<div class="case"><svg id="vector-art" width="120" height="80"><rect id="vector-shape" width="120" height="80" fill="orange"/></svg></div>
<div class="case"><img id="rotated-art" class="art rotated" src='${image}'></div>
<div class="case"><img id="clipped-art" class="art clipped" src='${image}'><button id="clipped-cover" class="cover" aria-label="裁切外区域"></button></div>
</body></html>`;
fs.writeFileSync(path.join(project, 'selection-fixture.html'), fixture);
if (!course) fs.writeFileSync(path.join(project, 'index.html'), fixture);
electron.app.setPath('userData', path.join(root, 'profile'));
delete process.env.VITE_DEV_SERVER_URL;
let win;
const nativeHandle = electron.ipcMain.handle.bind(electron.ipcMain);
const replacement = {
  ...electron,
  BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({ ...options, width: 1600, height: 1000, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); win = this; if(process.argv.includes('--debug-console')) this.webContents.on('console-message',(...args)=>console.log('Renderer:',typeof args[1]==='object'?args[1].message:args[2])); }
  },
  dialog: { ...electron.dialog, showOpenDialog: async () => ({ canceled: false, filePaths: [project] }) },
  ipcMain: { handle(name, handler) { nativeHandle(name, name === 'project:catalog' ? async () => ({ ok: true, items: [], lastKey: '', limited: false }) : handler); } },
};
const originalLoad = Module._load;
Module._load = function(name, parent, main) { return name === 'electron' ? replacement : originalLoad.call(this, name, parent, main); };
const installedAsar = process.argv.find(arg => arg.startsWith('--installed='))?.slice(12);
try { require(installedAsar ? path.join(installedAsar, 'electron/main.cjs') : '../electron/main.cjs'); } finally { Module._load = originalLoad; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ui = code => win.webContents.executeJavaScript(code);
function frame() { return win.webContents.mainFrame.frames.find(item => item.url.startsWith('editor-project://')); }
const page = code => frame().executeJavaScript(code);
async function until(check, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { try { if (await Promise.race([check(), delay(500).then(() => false)])) return; } catch {} await delay(30); }
  throw new Error('Timed out: ' + label);
}
async function click(label) { await ui(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable '+${JSON.stringify(label)});b.click()})()`); }
async function prepare() {
  await page(`window.__selection=null;window.__pointerLog=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>window.__pointerLog.push({type,id:e.pointerId,x:e.clientX,y:e.clientY,target:e.target.id||e.target.localName}),true);`);
  await ui(`window.__selection=null;if(!window.__watchSelection){window.__watchSelection=true;window.addEventListener('message',e=>{if(e.data?.source==='theme-unit-editor'&&e.data.type==='selected')window.__selection=e.data})}`);
}
async function pick(selector, ratioX = .5, ratioY = .5, altKey = false, native = false) {
  await ui(`window.__selection=null`);
  const hit = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.left+r.width*${ratioX},y=r.top+r.height*${ratioY};const hit=document.elementFromPoint(x,y);if(!${native}){hit?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:x,clientY:y,altKey:${altKey}}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1,clientX:x,clientY:y,altKey:${altKey}}))}return {hit:hit?.id||hit?.className, x,y}})()`);
  if (native) {
    await ui(`window.__selection=null`);
    win.webContents.focus();
    const point = await ui(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:Math.round(r.left+${hit.x}*r.width/1440),y:Math.round(r.top+${hit.y}*r.height/900)}})()`);
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await delay(170);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await delay(50);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  await delay(40);
  const selection = await ui(`window.__selection`);
  return { ...hit, selector: selection?.selector, tag: selection?.tag, src: selection?.src, background: selection?.styles?.backgroundImage, ...(native ? {events:await page('window.__pointerLog.slice(-5)')} : {}) };
}
const results = [];
async function check(name, selector, expected, x = .5, y = .5, altKey = false, native = false) {
  const actual = await pick(selector, x, y, altKey, native);
  const pass = Boolean(actual.selector) && await page(`document.querySelector(${JSON.stringify(actual.selector)})===document.querySelector(${JSON.stringify(expected)})`);
  results.push({ name, pass, expected, actual });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + ': ' + JSON.stringify(actual));
}

async function checkSvgSync() {
  const original = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
  const oldRenderer = original.match(/<script\b[^>]*\bdata-editor-layout-runtime(?:\s|=|>)[\s\S]*?<\/script\s*>/i)?.[0];
  const remember = name => { results.push({ name, pass: true }); console.log('PASS ' + name); };
  const basket = process.argv.includes('--basket');
  const target = basket ? '#scene [data-node="component-shopping-basket"]' : '#scene [data-node="1:508"]';
  await page(`document.querySelector('#hand')?.getAnimations().forEach(a=>a.finish())`);
  for (let attempt = 0; attempt < 12; attempt++) {
    const selection = await pick(target, .03, .96, attempt > 0);
    if (selection.selector && await page(`document.querySelector(${JSON.stringify(selection.selector)})===document.querySelector(${JSON.stringify(target)})`)) break;
  }
  assert.ok(await ui(`window.__selection?.selector.includes(${JSON.stringify(basket ? 'component-shopping-basket' : '1:508')})`), 'select the intended component');
  await ui(`window.__svgErrors=[];window.addEventListener('message',e=>{if(e.data?.type==='scope-error')window.__svgErrors.push(e.data.message)})`);
  const command = async (group, mode = 'all', states = []) => {
    await ui(`document.querySelector('iframe').contentWindow.postMessage({source:'theme-unit-editor',type:'set-edit-scope',id:window.__selection.id,group:${JSON.stringify(group)},mode:${JSON.stringify(mode)},states:${JSON.stringify(JSON.stringify(states))}},'*')`);
    await delay(80);
    assert.deepEqual(await ui('window.__svgErrors'), []);
  };
  await command('position'); await command('size');
  assert.equal(await page('window.__editorLayoutRuntime.snapshot().svgPins.length'), 2);
  remember('choosing all scenes snapshots actual position and size without requiring a drag');
  const read = () => page(`(()=>{const p=window.__editorLayoutRuntime.snapshot().svgPins[0],e=document.querySelector(p.selector),r=window.__editorLayoutRuntime.svgRect?.(e)||e.getBoundingClientRect(),s=e.ownerSVGElement.getBoundingClientRect();return {x:(r.left-s.left)/s.width,y:(r.top-s.top)/s.height,width:r.width/s.width,height:r.height/s.height}})()`);
  const expected = await read();
  async function allScenes(label) {
    for (let index = 0; index < 6; index++) {
      await page(`document.querySelector('#scene').innerHTML=window.FIGMA.scenes[${index}]`);
      await until(() => page(`document.querySelector('main').dataset.phase==='figma-scene-${index+1}'`), 'recognize SVG scene ' + index);
      await delay(60);
      const rect = await read();
      for (const key of Object.keys(expected)) assert.ok(Math.abs(rect[key]-expected[key])<.0002, label+' scene '+(index+1)+' '+key+': '+JSON.stringify({rect,expected}));
    }
    remember(label);
  }
  await allScenes('different node IDs retain identical visual geometry across all six scenes');
  const savedExpected = { ...expected };
  await click('保存');
  await until(() => ui(`!document.querySelector('.save-state.dirty')`), 'SVG pins saved');
  const saved = fs.readFileSync(path.join(project,'index.html'),'utf8');
  if (oldRenderer) assert.ok(saved.includes(oldRenderer), 'the existing saved renderer remains byte-for-byte intact');
  assert.match(saved, /data-editor-svg-layout-runtime/);
  await click('刷新预览');
  await until(() => page(`document.readyState==='complete'&&window.__editorLayoutRuntime.snapshot().svgPins?.length===2`), 'SVG pins restored');
  await allScenes('saved old-renderer pages retain geometry after reload and scene reconstruction');
  const selector = await page('window.__editorLayoutRuntime.snapshot().svgPins[0].selector');
  for (let attempt = 0; attempt < 12; attempt++) {
    const selection = await pick(selector, .03, .96, attempt > 0);
    if (selection.selector && await page(`document.querySelector(${JSON.stringify(selection.selector)})===document.querySelector(${JSON.stringify(selector)})`)) break;
  }
  const rawBefore = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return (window.__editorLayoutRuntime.svgRect?.(e)||e.getBoundingClientRect()).toJSON()})()`);
  await page(`(()=>{const e=document.querySelector('[data-move-tool]'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:9,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:9,clientX:x+70,clientY:y+35}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,clientX:x+70,clientY:y+35}))})()`);
  await delay(80);
  const rawAfter = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return (window.__editorLayoutRuntime.svgRect?.(e)||e.getBoundingClientRect()).toJSON()})()`);
  assert.ok(Math.abs(rawAfter.x-rawBefore.x-70)<.3 && Math.abs(rawAfter.y-rawBefore.y-35)<.3, 'locked SVG component still follows a drag');
  await page(`(()=>{const e=document.querySelector('[data-resize-direction="e"]'),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:10,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:10,clientX:x+80,clientY:y}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:10,clientX:x+80,clientY:y}))})()`);
  await delay(80);
  const resized = await page(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return (window.__editorLayoutRuntime.svgRect?.(e)||e.getBoundingClientRect()).toJSON()})()`);
  assert.ok(Math.abs(resized.width-rawAfter.width-80)<.3, 'locked SVG component still follows a width handle');
  Object.assign(expected, await read());
  await allScenes('dragging and resizing a synchronized object updates all six scenes');
  await click('撤销');
  await delay(80);
  Object.assign(expected, await read());
  assert.ok(Math.abs(expected.width-rawAfter.width/1440)<.001, 'undo restores the previous shared width');
  await allScenes('undo restores shared geometry across all six scenes');
  const allPins = await page('window.__editorLayoutRuntime.snapshot()');
  await page(`(()=>{const p=window.__editorLayoutRuntime.snapshot().svgPins[0],e=document.querySelector(p.selector);window.__editorLayoutRuntime.setSvgScope(e,{selector:'div#scene > svg [data-node='+JSON.stringify(e.getAttribute('data-node'))+']',sceneContext:{ownerSelector:'main#orientation',attribute:'data-phase',value:'figma-scene-6'}},'position','selected',['figma-scene-1','figma-scene-6'])})()`);
  await page(`document.querySelector('#scene').innerHTML=window.FIGMA.scenes[1]`); await delay(100);
  assert.ok(Math.abs((await read()).x-expected.x)>.01, 'unselected scene keeps its authored position');
  await page(`window.__editorLayoutRuntime.restore(${JSON.stringify(allPins)})`);
  remember('narrowing a position lock leaves unselected scenes independent');
  const standalone = new electron.BrowserWindow({ show:false, width:1440, height:900, webPreferences:{backgroundThrottling:false} });
  try {
    await standalone.loadFile(path.join(project, 'index.html'));
    for (let index=0;index<6;index++) {
      await standalone.webContents.executeJavaScript(`document.querySelector('#scene').innerHTML=window.FIGMA.scenes[${index}]`);
      await delay(90);
      const rect = await standalone.webContents.executeJavaScript(`(()=>{const p=window.__editorLayoutRuntime.snapshot().svgPins[0],e=document.querySelector(p.selector),r=window.__editorLayoutRuntime.svgRect?.(e)||e.getBoundingClientRect(),s=e.ownerSVGElement.getBoundingClientRect();return {x:(r.left-s.left)/s.width,y:(r.top-s.top)/s.height,width:r.width/s.width,height:r.height/s.height}})()`);
      for (const key of Object.keys(savedExpected)) assert.ok(Math.abs(rect[key]-savedExpected[key])<.0002, 'standalone scene '+index+' '+key);
    }
    assert.equal(await standalone.webContents.executeJavaScript(`!!document.querySelector('[data-editor-tools]')`),false);
    remember('standalone HTML keeps all six scenes fixed without editor bridge scripts');
    if (basket) {
      const directory = path.resolve(__dirname, '../release/basket-native-check'); fs.mkdirSync(directory,{recursive:true});
      standalone.showInactive();
      await standalone.loadFile(path.join(project,'index.html'));
      const nativeStates = [];
      async function verifyNative(phase) {
        await delay(100);
        const state = await standalone.webContents.executeJavaScript(`(()=>{const e=document.querySelector('[data-node="component-shopping-basket"]'),r=window.__editorLayoutRuntime.svgRect(e),s=e.ownerSVGElement.getBoundingClientRect();return {phase:document.querySelector('main').dataset.phase,x:(r.left-s.left)/s.width,y:(r.top-s.top)/s.height,width:r.width/s.width,height:r.height/s.height,parts:e.querySelectorAll('g[data-node]').length}})()`);
        if (!state.phase) console.log('Scene mismatch:',await standalone.webContents.executeJavaScript(`(()=>{const clean=n=>{n=n.cloneNode(true);for(const g of [...n.querySelectorAll('[data-editor-svg-lock]')].reverse())g.replaceWith(...g.childNodes);for(const e of [n,...n.querySelectorAll('*')])for(const a of [...e.attributes])if(a.name==='style'||a.name.startsWith('data-editor-'))e.removeAttribute(a.name);return n.outerHTML};const t=document.createElement('template');t.innerHTML=window.FIGMA.scenes[${phase-1}];const a=clean(document.querySelector('#scene > svg')),b=clean(t.content.firstElementChild);let i=0;while(i<a.length&&a[i]===b[i])i++;return {i,actual:a.slice(i-100,i+200),expected:b.slice(i-100,i+200)}})()`));
        assert.equal(state.phase,'figma-scene-'+phase);
        for(const key of Object.keys(savedExpected)) assert.ok(Math.abs(state[key]-savedExpected[key])<.0002,'native scene '+phase+' '+key);
        nativeStates.push(state);
        await standalone.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(directory,'scene-'+phase+'.png'),(await standalone.webContents.capturePage()).toPNG());
      }
      const nativeClick = selector => standalone.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const food = name => nativeClick('button[aria-label="把一'+(name==='糖果'?'罐糖果':'盒饼干')+'放进购物篮"]');
      await verifyNative(1);
      await food('糖果'); await verifyNative(2);
      await nativeClick('#restart'); await food('饼干'); await verifyNative(3);
      await food('糖果'); await verifyNative(4);
      await standalone.webContents.executeJavaScript(`for(const type of ['number','symbol']){const c=window.FIGMA.cards.find(c=>c.type===type&&c.value!==(type==='number'?'37':'<'));document.querySelector('[data-card='+JSON.stringify(c.id)+']').click()}`);
      await verifyNative(6);
      await nativeClick('#restart'); await food('饼干'); await food('糖果');
      await standalone.webContents.executeJavaScript(`for(const value of ['37','<']){const c=window.FIGMA.cards.find(c=>c.value===value);document.querySelector('[data-card='+JSON.stringify(c.id)+']').click()}`);
      await verifyNative(5);
      await nativeClick('#restart'); await verifyNative(1);
      fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(nativeStates,null,2));
      remember('actual food, answer, wrong, correct and restart handlers keep the complete basket fixed');
    }
  } finally { standalone.destroy(); }
  const directory = path.resolve(__dirname, '../release/svg-sync-check');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ project, results }, null, 2));
  fs.writeFileSync(path.join(directory, 'screenshot.png'), (await win.webContents.capturePage()).toPNG());
  console.log(results.length + '/' + results.length + ' SVG synchronization checks passed');
}

async function checkIdSvg() {
  const remember = name => { results.push({name,pass:true}); console.log('PASS '+name); };
  const rect = selector => page(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
  const nativeDrag = async (selector,dx,dy) => {
    win.focus();win.webContents.focus();
    await page(`window.__idEvents=[];if(!window.__idWatch){window.__idWatch=true;for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture'])window.addEventListener(type,e=>window.__idEvents.push({type,detail:e.detail,pointer:e.pointerId,x:e.clientX,y:e.clientY,target:e.target.outerHTML?.slice(0,100)}),true)}`);
    const r=await rect(selector);
    const point=await ui(`(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.left+${r.x+r.width/2}*r.width/1440,y:r.top+${r.y+r.height/2}*r.height/900,sx:r.width/1440,sy:r.height/900}})()`);
    if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
    const send=(type,x,y)=>win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await delay(100);await send('mousePressed',point.x,point.y);await delay(80);
    for(let i=1;i<=5;i++){await send('mouseMoved',point.x+dx*point.sx*i/5,point.y+dy*point.sy*i/5);await delay(25);}
    await send('mouseReleased',point.x+dx*point.sx,point.y+dy*point.sy);await delay(70);
    return r;
  };
  await click('测试');await until(()=>page(`!!document.querySelector('#bank-card-0')&&document.querySelector('#stage').dataset.state==='placing'`),'placing scene');
  await delay(1100);await click('编辑');await prepare();
  await check('SVG ID component selected independently through its child artwork','#bank-card-0','#bank-card-0',.5,.5,false,true);
  assert.ok(results.at(-1).pass,'ID-based SVG must select its component, not the full scene');
  const other=await rect('#bank-card-1');
  const before=await nativeDrag('#bank-card-0',38,24),after=await rect('#bank-card-0');
  assert.ok(Math.abs(after.x-before.x-38)<1&&Math.abs(after.y-before.y-24)<1,JSON.stringify({before,after,events:await page('window.__idEvents')}));
  assert.deepEqual(await rect('#bank-card-1'),other);remember('native mouse moves only the selected clipped component through stage scaling');
  await click('撤销');await until(async()=>Math.abs((await rect('#bank-card-0')).x-before.x)<1,'undo restores component');remember('one undo restores the original component position');
  await click('重做');await until(async()=>Math.abs((await rect('#bank-card-0')).x-after.x)<1,'redo restores component');
  await click('保存');await until(()=>ui(`!document.querySelector('.save-state.dirty')`),'ID component saved');
  await click('刷新预览');await until(()=>page(`!!document.querySelector('#bank-card-0')&&document.readyState==='complete'`),'saved component reload');
  await until(async()=>Math.abs((await rect('#bank-card-0')).x-after.x)<1,'saved movement restored');remember('component position survives saving and rebuilding the SVG');
  await click('测试');await delay(250);
  await page(`document.querySelector('[aria-label="重来"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  await delay(250);
  await page(`for(let i=0;i<6;i++){const e=document.querySelector('#bank-card-'+i);e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}`);
  await until(()=>page(`document.querySelector('#stage').dataset.state==='question'`),'native course advances after placing six gap cards');
  await click('编辑');await prepare();
  await check('question card SVG ID selects the whole card','#n-1-12','#n-1-12',.5,.5,false,true);assert.ok(results.at(-1).pass);
  const cardBefore=await nativeDrag('#n-1-12',-32,19),cardAfter=await rect('#n-1-12');
  assert.ok(Math.abs(cardAfter.x-cardBefore.x+32)<1&&Math.abs(cardAfter.y-cardBefore.y-19)<1,JSON.stringify({cardBefore,cardAfter}));remember('question card moves without consuming or placing a course answer');
  const scale=await page(`(()=>{const e=document.querySelector('#n-1-12');return e.parentElement.getScreenCTM().a})()`);
  await page(`(()=>{const h=document.querySelector('[data-resize-direction="e"]'),r=h.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;h.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:21,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:21,clientX:x+${20*scale},clientY:y}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:21,clientX:x+${20*scale},clientY:y}))})()`);
  await delay(80);const resized=await rect('#n-1-12');
  assert.ok(Math.abs(resized.width-cardAfter.width-20*scale)<1,JSON.stringify({cardAfter,resized,scale}));remember('SVG group resize changes the painted card width');
  await until(()=>ui(`!!document.querySelector('.save-state.dirty')`),'question movement dirty');
  await click('保存');await until(()=>ui(`!document.querySelector('.save-state.dirty')`),'question saved');
  await click('刷新预览');await until(()=>page(`!!document.querySelector('#bank-card-0')&&document.readyState==='complete'`),'question edit reload');
  assert.ok(await page(`getComputedStyle(document.querySelector('#n-1-12')).scale==='none'`),'question size does not leak into the placing scene');
  await click('测试');await delay(300);
  await page(`for(let i=0;i<6;i++)document.querySelector('#bank-card-'+i).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  await until(()=>page(`document.querySelector('#stage').dataset.state==='question'`),'question rebuilt');
  await until(async()=>Math.abs((await rect('#n-1-12')).width-resized.width)<1,'question dimensions restored');
  await click('编辑');await prepare();
  await check('saved question card remains selectable after native scene rebuild','#n-1-12','#n-1-12',.5,.5,false,true);assert.ok(results.at(-1).pass);
  remember('question movement and size survive reload without affecting the placing scene');
  const directory=path.resolve(__dirname,'../release/svg-id-check');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'screenshot.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({course,project,results},null,2));
  console.log(results.length+'/'+results.length+' SVG ID checks passed');
}
electron.app.whenReady().then(async () => {
  const timeout = setTimeout(() => electron.app.exit(1), 90000);
  try {
    await until(() => ui(`!!document.querySelector('.empty-workspace')`), 'editor ready');
    win.show(); win.focus();
    await click('浏览文件夹');
    await until(() => frame() && page(`document.readyState==='complete'`), 'project loaded');
    await ui(`(()=>{const s=document.querySelector('[aria-label="预览设备"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'desktop');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await until(() => frame() && page(`innerWidth===1440 && document.readyState==='complete'`), 'desktop viewport');
    await delay(100);
    await prepare();
    if (process.argv.includes('--id-svg')) { await checkIdSvg(); clearTimeout(timeout); win.destroy(); electron.app.exit(0); return; }
    if (process.argv.includes('--svg-sync')) { await checkSvgSync(); clearTimeout(timeout); win.destroy(); electron.app.exit(0); return; }
    if (course && await page(`!!window.FIGMA?.scenes`)) {
      await until(() => page(`document.querySelector('main').dataset.phase==='figma-scene-1'`), 'authored Figma scene recognized');
      await page(`document.querySelector('#hand')?.getAnimations().forEach(animation=>animation.cancel())`);
      await check('Figma biscuit selects its own node below transparent hit area', '#scene [data-node="1:523"]', '#scene [data-node="1:523"]');
      await check('Figma candy selects a different node with an ordinary click', '#scene [data-node="1:521"]', '#scene [data-node="1:521"]');
      await check('native mouse selects the biscuit artwork', '#scene [data-node="1:523"]', '#scene [data-node="1:523"]', .5, .5, false, true);
      // Selecting the old full-scene root must no longer trap later clicks.
      // Use the actual artwork selection, then explicitly select the root via a
      // click in the empty SVG area, just as the reported failure began.
      await pick('#scene > svg', .98, .95);
      await check('single click escapes a full-scene selection frame', '#scene [data-node="1:523"]', '#scene [data-node="1:523"]');
      await page(`window.__start=document.querySelector('#scene [data-node="1:523"]').getBoundingClientRect().toJSON();const r=window.__start;const x=r.x+r.width/2,y=r.y+r.height/2;document.elementFromPoint(x,y).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:7,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:7,clientX:x+40,clientY:y+25}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,clientX:x+40,clientY:y+25}));`);
      const moved = await page(`(()=>{const r=document.querySelector('#scene [data-node="1:523"]').getBoundingClientRect();return {x:r.x-window.__start.x,y:r.y-window.__start.y}})()`);
      assert.ok(Math.abs(moved.x-40)<1 && Math.abs(moved.y-25)<1, JSON.stringify(moved));
      results.push({name:'SVG object drag follows pointer through stage transforms',pass:true});
      await page(`(()=>{const e=document.querySelector('#scene [data-node="1:523"]'),m=e.parentElement.getScreenCTM(),delta=(500-e.getBBox().width)*m.a;const handle=document.querySelector('[data-resize-direction="e"]'),r=handle.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:8,clientX:x,clientY:y}));document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:8,clientX:x+delta,clientY:y}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:8,clientX:x+delta,clientY:y}))})()`);
      await until(() => page(`Math.abs(parseFloat(getComputedStyle(document.querySelector('#scene [data-node="1:523"]')).width)-500)<.1`), 'SVG size edit applied');
      const scale = await page(`getComputedStyle(document.querySelector('#scene [data-node="1:523"]')).scale`);
      assert.ok(parseFloat(scale)>1.2, 'SVG width must scale the painted object: '+scale);
      await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'SVG edit dirty');
      await click('保存');
      await until(() => ui(`!document.querySelector('.save-state.dirty')`), 'SVG edits saved');
      const saved = fs.readFileSync(path.join(project,'index.html'),'utf8');
      assert.ok(saved.includes('data-node=\\"1:523\\"'), 'persist using authored node identity');
      await click('刷新预览');
      await until(() => page(`document.readyState==='complete'&&getComputedStyle(document.querySelector('#scene [data-node="1:523"]')).width==='500px'`), 'SVG edit survives reload');
      assert.ok(await page(`parseFloat(getComputedStyle(document.querySelector('#scene [data-node="1:523"]')).scale)>1.2`));
      results.push({name:'SVG object dimensions and position persist through save and reload',pass:true});
      await page(`document.querySelector('#scene').innerHTML=window.FIGMA.scenes[1]`);
      await until(() => page(`document.querySelector('main').dataset.phase==='figma-scene-2'`), 'next authored scene recognized');
      assert.ok(await page(`![...document.querySelectorAll('#scene [data-node]')].some(element=>getComputedStyle(element).width==='500px')`), 'a current-scene edit does not leak into the next scene');
      await page(`document.querySelector('#scene').innerHTML=window.FIGMA.scenes[0]`);
      await until(() => page(`document.querySelector('main').dataset.phase==='figma-scene-1'&&getComputedStyle(document.querySelector('#scene [data-node="1:523"]')).width==='500px'`), 'returning scene restores its saved edit');
      results.push({name:'SVG edits remain isolated to their authored scene',pass:true});
      await page(`document.querySelector('#hand')?.getAnimations().forEach(animation=>animation.cancel())`);
      await check('saved SVG object remains independently selectable', '#scene [data-node="1:523"]', '#scene [data-node="1:523"]', .15, .15);
      await delay(100);
      assert.ok(await page(`!!document.querySelector('[data-selection-frame]')`), 'SVG object selection remains available after rendering');
      const directory = path.resolve(__dirname, '../release/image-selection-check');
      fs.mkdirSync(directory, {recursive:true});
      fs.writeFileSync(path.join(directory,'svg-course.png'), (await win.webContents.capturePage()).toPNG());
    } else if (course) {
      await check('board artwork under transparent fu hit area', '[data-fu="0"]', '.board-art');
      await check('native mouse over hover-highlighted hit area', '[data-fu="0"]', '.board-art', .5, .5, false, true);
      await page(`document.querySelector('[data-fu="0"]').style.backgroundColor='rgba(255,190,22,0.09)'`);
      await check('translucent interaction highlight does not mask image', '[data-fu="0"]', '.board-art');
      await page(`document.querySelector('[data-fu="0"]').style.removeProperty('background-color')`);
      await page(`fuTargets.forEach(pasteFu)`);
      await delay(320);
      await page(`document.getAnimations().forEach(animation=>animation.finish())`);
      await check('dynamic fu tile under disabled hit area', '.fu-tile', '.fu-tile');
      await check('number image inside interactive piece', '[data-piece="12"] img', '[data-piece="12"] img');
      await check('slot frame under empty holder', '[data-slot="0"] .slot-frame', '[data-slot="0"] .slot-frame');
      await page(`assignValue(answerSlots[0],'12')`);
      await check('dynamic slot value above frame', '[data-slot="0"] .slot-value img', '[data-slot="0"] .slot-value img');
      await check('Alt click reaches slot frame below dynamic value', '[data-slot="0"] .slot-value img', '[data-slot="0"] .slot-frame', .5, .5, true);
      await check('feedback image in pointer-disabled section', '#feedback-image', '#feedback-image');
      await check('equals sign in pointer-disabled section', '.equals-sign', '.equals-sign');
      await pick('.fu-tile');
      await until(() => ui(`document.querySelector('.selected-tag')?.textContent.startsWith('img')`), 'dynamic image inspector');
      await ui(`(()=>{const row=[...document.querySelectorAll('.property-row')].find(e=>e.querySelector('span')?.textContent==='宽度');const input=row.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'130');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await delay(40);
      await ui(`[...document.querySelectorAll('.property-row')].find(e=>e.querySelector('span')?.textContent==='宽度').querySelector('input').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);
      await until(() => ui(`!!document.querySelector('.save-state.dirty')`), 'image edit is dirty');
      await click('保存');
      await until(() => ui(`!document.querySelector('.save-state.dirty')`), 'image saved');
      assert.match(fs.readFileSync(path.join(project,'index.html'),'utf8'), /width:\s*130px/);
      await click('刷新预览');
      await until(() => page(`document.readyState==='complete'&&!document.querySelector('.fu-tile')`), 'course reloaded');
      await page(`fuTargets.forEach(pasteFu);document.getAnimations().forEach(animation=>animation.finish())`);
      await until(() => page(`getComputedStyle(document.querySelector('.fu-tile')).width==='130px'`), 'dynamic image edit survives recreation');
      results.push({ name: 'dynamic image resize saves and survives reload', pass: true });
      console.log('PASS dynamic image resize saves and survives reload');
    }
    if (course) {
      await ui(`[...document.querySelectorAll('.page-item')].find(e=>e.textContent.includes('selection-fixture.html')).click()`);
      await until(() => frame()?.url.includes('selection-fixture.html') && page(`!!document.querySelector('#covered-art')&&document.readyState==='complete'`), 'fixture loaded');
      await delay(200);
      await until(() => page(`document.querySelector('#covered-art')?.getBoundingClientRect().width>0`), 'fixture has rendered bounds');
    }
    await check('transparent overlay yields visible image', '#covered-art', '#covered-art');
    await check('CSS image with pointer-events none', '#css-art', '#css-art');
    await check('second nested image selected rather than first', '#second-icon', '#second-icon');
    await check('text button remains editable', '#visible-text', '.case:nth-child(4) > button');
    await check('hidden image is excluded', '#visible-button', '#visible-button');
    await check('opaque foreground is respected', '#opaque-cover', '#opaque-cover');
    await check('SVG descendants select SVG root', '#vector-shape', '#vector-art');
    await check('rotated image is selectable', '#rotated-art', '#rotated-art');
    await check('clipped image outside painted area excluded', '#clipped-art', '#clipped-cover', .85);
    assert.equal(await page(`document.querySelector('#covered-art').style.pointerEvents`), '', 'hit testing never changes authored inline styles');
    await ui(`window.__targetSelection=null;window.addEventListener('message',e=>{if(e.data?.type==='target-selected')window.__targetSelection=e.data.selector});document.querySelector('iframe').contentWindow.postMessage({source:'theme-unit-editor',type:'set-interaction-target',enabled:true},'*')`);
    await delay(40);
    await pick('#hit-area');
    await until(() => ui(`window.__targetSelection==='button#hit-area'`), 'interaction picking retains actual control');
    results.push({ name: 'interaction target picking retains original control', pass: true });
    // Test mode must keep the original hit areas and native interactions.
    await click('测试');
    await delay(60);
    if (await ui(`!!document.querySelector('[aria-label="未保存修改"]')`)) await click('放弃修改并切换');
    await until(() => ui(`document.querySelector('.mode-switcher .active')?.textContent==='测试'`), 'test mode');
    await until(() => frame() && page(`document.readyState==='complete'&&!!document.querySelector('#hit-area')`), 'test-mode preview loaded');
    await delay(60);
    await page(`window.__nativeClicks=0;document.querySelector('#hit-area').addEventListener('click',()=>window.__nativeClicks++);document.querySelector('#hit-area').click()`);
    assert.equal(await page(`window.__nativeClicks`), 1);
    results.push({ name: 'test mode preserves native page clicks', pass: true });
    const directory = path.resolve(__dirname, '../release/image-selection-check');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ course, project, results }, null, 2));
    if (!process.argv.includes('--diagnose')) assert(results.every(result => result.pass), 'image hit tests must all pass');
    console.log(`${results.filter(result => result.pass).length}/${results.length} image selection checks passed`);
    clearTimeout(timeout); win.destroy(); electron.app.exit(0);
  } catch (error) {
    console.error(error);
    if (win && !win.isDestroyed()) {
      fs.writeFileSync(path.resolve(__dirname, '../release/svg-selection-failure.png'), (await win.webContents.capturePage()).toPNG());
      console.error('Inspector:', await ui(`document.querySelector('.selected-tag')?.textContent`));
      console.error('SVG state:', await page(`JSON.stringify({phase:document.querySelector('main')?.dataset.phase,chosen:document.querySelector('#scene [data-node="1:523"]')?.getAttribute('style'),layout:window.__editorLayoutRuntime.snapshot(),selection:document.querySelector('[data-selection-frame]')?.outerHTML})`));
    }
    clearTimeout(timeout); if(win&&!win.isDestroyed())win.destroy(); electron.app.exit(1);
  }
});
