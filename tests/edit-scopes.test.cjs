const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { installLayoutRuntime, normalizeLayoutConfig, upsertLayoutDocument } = require('../electron/edit-scopes.cjs');

const fixture = `<!doctype html><html><head><style>[hidden]{display:none!important}</style></head><body>
<main id="stage" data-phase="hint" style="width:1200px;height:700px"><div id="bees">
<button class="bee incoming arrived" data-group="incoming" data-index="0" aria-label="已飞入的第1只蜜蜂"><span class="bee-motion"><img src="bee.png" style="position:absolute;left:80px;top:80px;width:69px;height:69px;transform:scaleX(-1)"></span></button>
<button class="bee incoming arrived" data-group="incoming" data-index="1" aria-label="已飞入的第2只蜜蜂"><span class="bee-motion"><img src="bee.png" style="position:absolute;left:600px;top:80px;width:69px;height:69px"></span></button>
</div><button data-card="six" style="position:absolute;left:300px;top:400px">6</button></main></body></html>`;
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const bridge = source.match(/const previewBridgeScript = [\s\S]*?String\.raw`([\s\S]*?)`;\s*function contentType/)[1];
const tick = () => new Promise(resolve => setImmediate(resolve));

function environment(html = fixture, width = 1400) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://editor.test/index.html', pretendToBeVisual: true });
  const w = dom.window, d = w.document, messages = [];
  let viewportWidth = width, pointed = null;
  Object.defineProperty(w, 'innerWidth', { get: () => viewportWidth });
  w.matchMedia = query => ({ matches: [...query.matchAll(/(min|max)-width:\s*(\d+)px/g)].every(([, bound, size]) => bound === 'min' ? viewportWidth >= +size : viewportWidth <= +size) });
  w.CSS = { escape: value => String(value).replace(/[^\w-]/g, character => '\\' + character) };
  w.DOMMatrix = class {
    constructor() { this.m11 = this.m22 = this.m44 = 1; this.m12 = this.m21 = this.m14 = this.m24 = this.m34 = 0; }
    multiply() { return this; }
    scale() { return this; }
  };
  const computed = w.getComputedStyle.bind(w);
  w.getComputedStyle = (element, pseudo) => {
    const style = computed(element);
    if (pseudo) return new Proxy(style, { get: (target, key) => key === 'content' ? 'none' : Reflect.get(target, key) });
    Object.defineProperty(style, 'translate', { value: element.style.getPropertyValue('translate') || 'none' });
    return style;
  };
  w.Element.prototype.getBoundingClientRect = function () {
    const shift = this.style.getPropertyValue('translate').split(/\s+/);
    let left = (parseFloat(this.style.left) || 0) + (parseFloat(shift[0]) || 0);
    let top = (parseFloat(this.style.top) || 0) + (parseFloat(shift[1]) || 0);
    // Group movement belongs to the control wrapping the image. Mirror that
    // inherited movement so anchor compensation converges as it does in Chromium.
    for (let parent = this.parentElement; parent; parent = parent.parentElement) {
      const inherited = parent.style.getPropertyValue('translate').split(/\s+/);
      left += parseFloat(inherited[0]) || 0; top += parseFloat(inherited[1]) || 0;
    }
    const rw = parseFloat(this.style.width) || 69, rh = parseFloat(this.style.height) || 69;
    return { left, top, x: left, y: top, width: rw, height: rh, right: left + rw, bottom: top + rh };
  };
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest('[hidden]') ? [this.getBoundingClientRect()] : []; };
  w.Element.prototype.setPointerCapture = () => {};
  d.elementsFromPoint = () => { const result = []; for (let node = pointed; node; node = node.parentElement) result.push(node); return result; };
  w.postMessage = message => messages.push(message);
  w.CourseConfig = { layouts: { collect: {}, hint: {}, wrong: {}, correct: {} } };
  w.eval('(' + installLayoutRuntime.toString() + ')()');
  const instrumented = bridge.replace(/\}\)\(\);\s*<\/script>\s*$/, 'window.__scopeTest = { selectElement: (element, options) => select(editableElement(element), options) };\n})();</script>');
  const script = new JSDOM(instrumented).window.document.querySelector('script').textContent;
  w.eval(script);
  const bee = index => d.querySelector('button[data-index="' + (index || 0) + '"] img');
  const select = element => { w.__scopeTest.selectElement(element); return messages.filter(item => item.type === 'selected').at(-1); };
  const command = data => w.dispatchEvent(new w.MessageEvent('message', { data: { source: 'theme-unit-editor', ...data } }));
  const scope = (mode, states = [], group = 'position') => { const selected = select(bee()); command({ type: 'set-edit-scope', id: selected.id, mode, states: JSON.stringify(states), group }); };
  const edit = styles => { const selected = select(bee()); command({ type: 'edit-styles', id: selected.id, styles: JSON.stringify(styles) }); };
  const phase = async value => { d.getElementById('stage').dataset.phase = value; d.querySelector('button[data-index="0"]').setAttribute('aria-label', '第1只蜜蜂 · ' + value); await tick(); };
  function pointer(type, x, y, target) {
    const event = new w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    (target || (type === 'pointerdown' ? pointed : d)).dispatchEvent(event);
  }
  function drag() {
    pointed = bee(); select(pointed);
    pointer('pointerdown', 100, 100, d.querySelector('[data-selection-frame]')); pointer('pointermove', 143, 127); pointer('pointerup', 143, 127);
  }
  return { dom, w, d, messages, bee, select, command, scope, edit, phase, drag,
    clickThroughSelection: element => {
      pointed = element;
      const frame = d.querySelector('[data-selection-frame]');
      pointer('pointerdown', 20, 20, frame);
      pointer('pointerup', 21, 21);
    },
    selectMore: element => { w.__scopeTest.selectElement(element, { additive: true }); },
    dragSelection: element => {
      pointed = element;
      const control = d.querySelector('[data-selection-frame]');
      assert.ok(control, 'multi-selection drag control is available');
      pointer('pointerdown', 100, 100, control); pointer('pointermove', 143, 127); pointer('pointerup', 143, 127);
    },
    marquee: (left = 0, top = 0, right = 740, bottom = 180) => {
      pointed = bee(); command({ type: 'set-marquee-mode', enabled: 'true' });
      pointer('pointerdown', left, top); pointer('pointermove', right, bottom); pointer('pointerup', right, bottom);
    },
    viewport: value => { viewportWidth = value; w.dispatchEvent(new w.Event('resize')); } };
}

test('an ordinary click escapes a scene-sized frame and selects an authored SVG object', t => {
  const e = environment('<main id="stage" data-phase="one"><svg><g data-node="biscuit"><path d="M0 0h50v50z"/></g><g data-node="candy"><path d="M0 0h50v50z"/></g></svg></main>');
  t.after(() => e.dom.window.close());
  const root = e.d.querySelector('svg'), biscuit = e.d.querySelector('[data-node="biscuit"]'), candy = e.d.querySelector('[data-node="candy"]');
  e.select(root);
  e.clickThroughSelection(biscuit.querySelector('path'));
  assert.equal(e.messages.filter(item => item.type === 'selected').at(-1).selector, 'main#stage > svg [data-node="biscuit"]');
  e.clickThroughSelection(candy.querySelector('path'));
  assert.equal(e.messages.filter(item => item.type === 'selected').at(-1).selector, 'main#stage > svg [data-node="candy"]');
  assert.equal(e.messages.filter(item => item.type === 'layout-changed').length, 0, 'a slightly unsteady click never moves or dirties artwork');
});

test('saved group reselects its members and moves them with one undoable gesture', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.select(e.bee()); e.selectMore(e.bee(1));
  assert.equal(e.messages.filter(item => item.type === 'selection-set').at(-1).count, 2);
  e.command({ type: 'group-selection' });
  assert.equal(JSON.parse(e.messages.filter(item => item.type === 'layout-changed').at(-1).after).groups[0].sync, 'current');
  e.command({ type: 'set-group-sync', value: 'all' });
  const grouped = e.messages.filter(item => item.type === 'layout-changed').at(-1);
  assert.equal(JSON.parse(grouped.after).groups[0].members.length, 2);
  assert.equal(JSON.parse(grouped.after).anchors.length, 2, 'all-page groups pin source members to the canvas');
  e.dragSelection(e.bee());
  const moved = e.messages.filter(item => item.type === 'layout-changed').at(-1);
  const near = (element, x, y) => { const rect = element.getBoundingClientRect(); assert.ok(Math.abs(rect.left - parseFloat(element.style.left) - x) < 0.1 && Math.abs(rect.top - parseFloat(element.style.top) - y) < 0.1, JSON.stringify(rect)); };
  near(e.bee(), 43, 27); near(e.bee(1), 43, 27);
  assert.equal(e.messages.filter(item => item.type === 'layout-changed').length, 3, 'grouping, scope selection and dragging each create one history entry');
  e.command({ type: 'apply-layout-snapshot', value: moved.before });
  near(e.bee(), 0, 0); near(e.bee(1), 0, 0);
  e.command({ type: 'apply-layout-snapshot', value: moved.after });
  near(e.bee(), 43, 27); near(e.bee(1), 43, 27);
  const saved = upsertLayoutDocument(fixture, JSON.parse(moved.after));
  const reopened = environment(saved); t.after(() => reopened.dom.window.close());
  reopened.select(reopened.bee());
  assert.equal(reopened.messages.filter(item => item.type === 'selection-set').at(-1).count, 2, 'saved group is restored on reopen');
  reopened.command({ type: 'ungroup-selection' });
  assert.equal(JSON.parse(reopened.messages.filter(item => item.type === 'layout-changed').at(-1).after).groups.length, 0);
  reopened.select(reopened.bee());
  assert.equal(reopened.messages.filter(item => item.type === 'selection-set').at(-1).count, 1, 'ungrouped members are independent');
});

test('marquee selects multiple visible assets for a temporary move', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.marquee();
  assert.equal(e.messages.filter(item => item.type === 'selection-set').at(-1).count, 2);
  assert.equal(e.messages.filter(item => item.type === 'marquee-mode').at(-1).enabled, false);
});

test('marquee accepts mostly covered assets and remains active after an empty drag', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.marquee(90, 90, 158, 158);
  assert.equal(e.messages.filter(item => item.type === 'selection-set').at(-1).count, 1);
  e.marquee(900, 300, 920, 320);
  assert.equal(e.messages.filter(item => item.type === 'marquee-mode').at(-1).enabled, true);
  assert.equal(e.messages.filter(item => item.type === 'marquee-result').at(-1).count, 0);
});

test('one command groups selected members and fixes their position across matching scenes', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.select(e.bee()); e.selectMore(e.bee(1));
  e.command({ type: 'group-selection-all' });
  const changed = e.messages.filter(item => item.type === 'layout-changed');
  const config = JSON.parse(changed.at(-1).after);
  assert.equal(changed.length, 1);
  assert.equal(config.groups[0].sync, 'all');
  assert.equal(config.anchors.length, 2);
  assert.ok(config.anchors.every(item => item.force), 'group anchors override differing scene-specific positions only in the chosen scope');
});

test('a saved group supports named scenes and an explicit webpage list', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.select(e.bee()); e.selectMore(e.bee(1));
  e.command({ type: 'group-selection-selected' });
  let config = JSON.parse(e.messages.filter(item => item.type === 'layout-changed').at(-1).after);
  assert.equal(config.groups[0].sync, 'selected');
  assert.deepEqual(config.groups[0].states, ['hint']);
  e.command({ type: 'set-group-scope', mode: 'selected', states: JSON.stringify(['hint', 'wrong']) });
  e.command({ type: 'set-group-pages', pages: JSON.stringify(['second.html', 'third.html']) });
  e.command({ type: 'set-group-visibility', mode: 'selected', states: JSON.stringify(['hint', 'wrong']) });
  config = JSON.parse(e.messages.filter(item => item.type === 'layout-changed').at(-1).after);
  assert.deepEqual(config.groups[0].pages, ['second.html', 'third.html']);
  assert.deepEqual(config.groups[0].visibility, { mode: 'selected', states: ['hint', 'wrong'] });
  assert.equal(config.visibility.length, 2);
  assert.deepEqual(config.anchors[0].scene.states, ['hint', 'wrong']);
  const payload = e.messages.filter(item => item.type === 'layout-changed').at(-1).groupSync;
  assert.deepEqual(Array.from(payload.pages), ['second.html', 'third.html']);
  assert.equal(payload.scope, 'selected');
  e.command({ type: 'set-group-scope', mode: 'current', states: '[]' });
  config = JSON.parse(e.messages.filter(item => item.type === 'layout-changed').at(-1).after);
  assert.equal(config.anchors.length, 0, 'current scene stops using shared scene anchors');
  assert.deepEqual(config.groups[0].pages, ['second.html', 'third.html'], 'webpage choice is independent of scene choice');
});

test('group anchors hold one whole-page position only in named scenes', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.select(e.bee()); e.selectMore(e.bee(1));
  e.command({ type: 'group-selection-selected' });
  e.command({ type: 'set-group-scope', mode: 'selected', states: JSON.stringify(['hint', 'wrong']) });
  e.dragSelection(e.bee());
  const near = (element, x, y) => {
    const rect = element.getBoundingClientRect();
    const actualX = rect.left - parseFloat(element.style.left), actualY = rect.top - parseFloat(element.style.top);
    assert.ok(Math.abs(actualX - x) < 0.1 && Math.abs(actualY - y) < 0.1, JSON.stringify({ translate: element.style.translate, actualX, actualY, x, y }));
  };
  near(e.bee(), 43, 27);
  await e.phase('wrong');
  near(e.bee(), 43, 27);
  await e.phase('correct');
  near(e.bee(), 0, 0);
});

test('saved page anchors keep a matched member at the same whole-canvas position', async t => {
  const config = { version: 1, edits: [], preferences: [], anchors: [{ id: 'group-12345678:0', selector: '#frame', viewport: 'desktop', x: 20, y: 30 }] };
  const html = '<html><body><main id="stage" style="width:1200px;height:700px"><img id="frame" style="position:absolute;left:80px;top:80px;width:70px;height:70px"></main>'
    + '<script type="application/json" data-editor-layout-data>' + JSON.stringify(config) + '</script></body></html>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://editor.test/page.html' });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  w.matchMedia = () => ({ matches: true });
  w.CSS = { supports: () => true };
  w.DOMMatrix = class { constructor() { this.m11 = this.m22 = 1; this.m12 = this.m21 = 0; } multiply() { return this; } scale() { return this; } };
  const computed = w.getComputedStyle.bind(w);
  w.getComputedStyle = element => {
    const style = computed(element);
    Object.defineProperty(style, 'translate', { value: element.style.getPropertyValue('translate') || 'none' });
    return style;
  };
  w.Element.prototype.getBoundingClientRect = function () {
    const shift = this.style.getPropertyValue('translate').split(/\s+/);
    const left = (parseFloat(this.style.left) || 0) + (parseFloat(shift[0]) || 0);
    const top = (parseFloat(this.style.top) || 0) + (parseFloat(shift[1]) || 0);
    const width = parseFloat(this.style.width) || 70, height = parseFloat(this.style.height) || 70;
    return { left, top, right: left + width, bottom: top + height, width, height };
  };
  w.eval('(' + installLayoutRuntime.toString() + ')()');
  const frame = d.getElementById('frame');
  assert.equal(frame.style.translate, '160px 130px');
  frame.style.left = '100px';
  await tick();
  assert.equal(frame.style.translate, '140px 130px', 'authored layout changes are compensated to retain the canvas position');
});

test('dragging remains current-state by default and never moves another bee using the same image', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.drag();
  const moved = e.bee().style.translate;
  assert.ok(moved && moved !== '0px 0px');
  assert.equal(e.bee(1).style.translate, '');
  assert.equal(e.bee().style.transform, 'scaleX(-1)', 'authored transform is preserved');
  assert.equal(e.messages.filter(message => message.type === 'layout-changed').length, 1, 'one drag produces one undo transaction');
  await e.phase('correct');
  assert.equal(e.bee().style.translate, '', 'current-state edit is absent in another state');
  await e.phase('hint');
  assert.equal(e.bee().style.translate, moved, 'returning to the state restores its adjustment');
});

test('a current adjustment can be linked to selected scenes, narrowed, and applied globally', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.drag(); const moved = e.bee().style.translate;
  e.scope('selected', ['hint', 'correct']);
  assert.equal(e.messages.filter(item => item.type === 'scope-error').length, 0);
  await e.phase('correct'); assert.equal(e.bee().style.translate, moved);
  await e.phase('wrong'); assert.equal(e.bee().style.translate, '');
  await e.phase('hint'); e.scope('selected', ['hint']);
  await e.phase('correct'); assert.equal(e.bee().style.translate, '', 'unchecking a scene restores its independent layout');
  await e.phase('hint'); e.scope('all');
  for (const phase of ['collect', 'wrong', 'correct', 'future-scene']) {
    await e.phase(phase);
    assert.equal(e.bee().style.translate, moved, 'all includes ' + phase);
    assert.equal(e.bee(1).style.translate, '', 'neighbor remains independent');
  }
});

test('positions and sizes retain separate scopes through layout recalculation and node recreation', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.scope('all'); e.edit({ translate: '31px 18px' });
  e.edit({ width: '110px', height: '110px' });
  await e.phase('correct');
  e.bee().style.width = '75px'; e.bee().style.height = '75px';
  await tick();
  assert.equal(e.bee().style.translate, '31px 18px');
  assert.equal(e.bee().style.width, '75px', 'size edit remains current-state');
  e.bee().style.translate = '0px 0px';
  await tick(); assert.equal(e.bee().style.translate, '31px 18px', 'authored rerender cannot reset shared movement');
  const replacement = e.d.createElement('img'); replacement.src = 'bee.png'; replacement.style.width = '81px';
  e.bee().replaceWith(replacement);
  await tick();
  assert.equal(replacement.style.translate, '31px 18px', 'a regenerated image receives the same semantic edit');
  const selected = e.select(replacement);
  assert.equal(selected.editScopes.position.mode, 'all');
  assert.equal(selected.editScopes.size.mode, 'original', 'default scope still edits only the active scene');
});

test('scope changes and gestures undo and redo atomically without changing the authored layout', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.drag(); const moved = e.bee().style.translate;
  e.scope('selected', ['hint', 'correct']);
  const transaction = e.messages.filter(item => item.type === 'layout-changed').at(-1);
  await e.phase('correct'); assert.equal(e.bee().style.translate, moved);
  e.command({ type: 'apply-layout-snapshot', value: transaction.before });
  assert.equal(e.bee().style.translate, '');
  e.command({ type: 'apply-layout-snapshot', value: transaction.after });
  assert.equal(e.bee().style.translate, moved);
  assert.equal(e.bee().style.left, '80px');
});

test('saved standalone HTML retains scope preferences and regenerated-node styles without the editor', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.scope('selected', ['hint', 'wrong', 'correct']); e.edit({ translate: '25px -12px' });
  const config = e.w.__editorLayoutRuntime.snapshot();
  const saved = upsertLayoutDocument(fixture, config);
  assert.equal(upsertLayoutDocument(saved, config), saved, 'saving twice does not duplicate runtime scripts');
  const standalone = new JSDOM(saved, { runScripts: 'outside-only' }); t.after(() => standalone.window.close());
  standalone.window.matchMedia = () => ({ matches: false });
  standalone.window.eval(standalone.window.document.querySelector('script[data-editor-layout-runtime]').textContent);
  const d = standalone.window.document;
  const image = d.querySelector('button[data-index="0"] img');
  assert.equal(image.style.translate, '25px -12px');
  d.getElementById('stage').dataset.phase = 'correct'; await tick();
  assert.equal(image.style.translate, '25px -12px');
  d.getElementById('stage').dataset.phase = 'collect'; await tick();
  assert.equal(image.style.translate, '');
  assert.equal(standalone.window.__editorLayoutRuntime.snapshot().preferences[0].scope.mode, 'selected');
});

test('device settings and individual per-scene preferences stay independent', async t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.scope('selected', ['hint', 'correct']); e.edit({ translate: '20px 10px' });
  await e.phase('wrong'); e.scope('current'); e.edit({ translate: '4px 5px' });
  await e.phase('hint');
  assert.equal(e.select(e.bee()).editScopes.position.mode, 'selected', 'editing an excluded state does not discard the shared preference');
  e.viewport(390); e.command({ type: 'set-mode', mode: 'edit', viewport: 'mobilePortrait' });
  e.edit({ translate: '8px 9px' });
  assert.equal(e.bee().style.translate, '8px 9px');
  e.scope('current');
  assert.equal(e.select(e.bee()).editScopes.position.mode, 'current');
  e.viewport(1400); e.command({ type: 'set-mode', mode: 'edit', viewport: 'desktop' });
  assert.equal(e.select(e.bee()).editScopes.position.mode, 'selected', 'mobile scope preferences do not replace desktop preferences');
  e.viewport(844); await tick(); assert.equal(e.bee().style.translate, '20px 10px');
  e.viewport(390); await tick(); assert.equal(e.bee().style.translate, '8px 9px');
});

test('new shared edits override old saved state CSS while unrelated properties are retained', async t => {
  const html = fixture.replace('</head>', '<style data-editor-dynamic="old">#stage[data-phase="hint"] button[data-index="0"] img{transform:translate(12px,3px)!important;color:red!important}</style></head>');
  const e = environment(html); t.after(() => e.dom.window.close());
  e.scope('selected', ['hint', 'correct']);
  const config = e.w.__editorLayoutRuntime.snapshot();
  assert.equal(config.edits.some(edit => edit.property === 'color'), false, 'position scope does not synchronize appearance');
  await e.phase('correct');
  assert.match(e.bee().style.transform, /12px/);
  const countBefore = config.edits.length;
  e.edit({ color: '#ff0000' });
  await tick(); await tick();
  assert.equal(e.w.__editorLayoutRuntime.snapshot().edits.length, countBefore + 1, 'normalized CSS values do not cause repeated mutation writes');
});

test('layout records reject executable values, invalid devices, excessive or empty selected scopes', () => {
  const valid = { version: 1, edits: [{ target: '#bee', selector: '#bee', property: 'translate', value: '12px 3px', viewport: 'desktop' }], preferences: [] };
  assert.equal(normalizeLayoutConfig(valid).edits[0].property, 'translate');
  assert.throws(() => normalizeLayoutConfig({ ...valid, edits: [{ ...valid.edits[0], value: '1px; color:red' }] }));
  assert.throws(() => normalizeLayoutConfig({ ...valid, edits: [{ ...valid.edits[0], viewport: 'anywhere' }] }));
  assert.throws(() => normalizeLayoutConfig({ ...valid, preferences: [{ target: '#bee', scope: { mode: 'selected', states: [] } }] }));
  assert.throws(() => normalizeLayoutConfig({ ...valid, edits: Array(3001).fill(valid.edits[0]) }));
  assert.equal(upsertLayoutDocument(fixture, { version: 1, edits: [], preferences: [] }), fixture);
});
