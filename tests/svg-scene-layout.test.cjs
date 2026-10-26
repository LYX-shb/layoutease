const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { installLayoutRuntime, normalizeLayoutConfig, upsertLayoutDocument } = require('../electron/edit-scopes.cjs');
const { installSvgSceneLayout } = require('../electron/svg-scene-layout.cjs');

function environment(ambiguous = false) {
  const scene = (id, duplicate = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><defs><image id="asset" href="panel.webp"/></defs><g data-node="${id}"><use href="#asset"/></g>${duplicate ? '<g data-node="duplicate"><use href="#asset"/></g>' : ''}</svg>`;
  const scenes = [scene('first'), scene('second', ambiguous), scene('third')];
  const dom = new JSDOM('<main id="stage" data-phase="figma-scene-1"><div id="scene">'+scenes[0]+'</div></main>', { runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  Object.defineProperty(w, 'innerWidth', { value: 1440 });
  Object.defineProperty(w.SVGElement.prototype, 'viewBox', { get: () => ({ baseVal: { width: 1000, height: 500 } }) });
  w.matchMedia = () => ({ matches: false });
  w.Element.prototype.getBoundingClientRect = function () { return this.matches('svg') ? { left: 0, top: 0, width: 1000, height: 500 } : { left: 10, top: 20, width: 100, height: 50 }; };
  w.FIGMA = { scenes };
  w.eval('(' + installLayoutRuntime.toString() + ')()');
  w.eval('(' + installSvgSceneLayout.toString() + ')()');
  const identity = id => ({ selector: 'div#scene > svg [data-node="'+id+'"]', baseStyleSelector: 'div#scene > svg [data-node="'+id+'"]', styleSelector: 'div#scene > svg [data-node="'+id+'"]', editScope: { mode: 'all', states: [] }, sceneContext: { ownerSelector: 'main#stage', attribute: 'data-phase', value: d.querySelector('main').dataset.phase } });
  return { dom, w, d, scenes, api: w.__editorLayoutRuntime, identity, element: () => d.querySelector('#scene g[data-node]') };
}

test('SVG scope snapshots actual geometry and matches unique artwork despite different scene node IDs', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  const before = e.api.snapshot();
  e.api.setSvgScope(e.element(), e.identity('first'), 'position', 'all', []);
  e.api.setSvgScope(e.element(), e.identity('first'), 'size', 'all', []);
  const saved = normalizeLayoutConfig(e.api.snapshot());
  assert.equal(saved.edits.length, 0, 'locking current values does not require a prior style edit');
  assert.equal(saved.svgPins.length, 2);
  assert.deepEqual(saved.svgPins[0].nodes, ['first', 'second', 'third']);
  assert.deepEqual(saved.svgPins[0].box, { x: .01, y: .04, width: .1, height: .1 });
  e.d.querySelector('#scene').innerHTML = e.scenes[1]; e.d.querySelector('main').dataset.phase = 'figma-scene-2';
  assert.equal(e.api.preference(e.identity('second').selector, 'size', 'figma-scene-2').mode, 'all');
  e.api.writeMany(e.identity('second'), { width: '400px', height: '200px' });
  assert.equal(e.api.snapshot().svgPins.find(pin => pin.group === 'size').box.width, .4);
  assert.equal(e.api.snapshot().svgPins.find(pin => pin.group === 'size').box.height, .4);
  e.api.restore(before);
  assert.equal(e.api.snapshot().svgPins.length, 0, 'undo restores an unpinned layout');
  e.api.restore(saved);
  assert.equal(e.api.snapshot().svgPins.length, 2);
});

test('SVG selected-scene settings preserve independent scopes and reject ambiguous duplicate artwork', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.api.setSvgScope(e.element(), e.identity('first'), 'position', 'selected', ['figma-scene-1', 'figma-scene-3']);
  e.d.querySelector('#scene').innerHTML = e.scenes[1]; e.d.querySelector('main').dataset.phase = 'figma-scene-2';
  assert.equal(e.api.preference(e.identity('second').selector, 'position', 'figma-scene-2').mode, 'original');
  const duplicate = environment(true); t.after(() => duplicate.dom.window.close());
  assert.throws(() => duplicate.api.setSvgScope(duplicate.element(), duplicate.identity('first'), 'position', 'all', []), /多个相同素材/);
  assert.equal(duplicate.api.snapshot().svgPins.length, 0, 'failed matching never saves a partial lock');
});

test('SVG locks save beside the existing renderer and reject invalid geometry', t => {
  const e = environment(); t.after(() => e.dom.window.close());
  e.api.setSvgScope(e.element(), e.identity('first'), 'size', 'all', []);
  const old = '<script data-editor-layout-runtime>window.existingRenderer=true;</script>';
  const html = upsertLayoutDocument('<body>'+old+'</body>', e.api.snapshot());
  assert.ok(html.includes(old));
  assert.match(html, /data-editor-svg-layout-runtime/);
  const invalid = e.api.snapshot(); invalid.svgPins[0].box.width = -1;
  assert.throws(() => normalizeLayoutConfig(invalid), /SVG/);
});
