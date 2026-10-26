const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { installLayoutRuntime } = require('../electron/edit-scopes.cjs');

test('SVG object sizing scales its painted bounds once and restores authored styles on undo', t => {
  const dom = new JSDOM('<main id="stage" data-phase="one"><svg><g data-node="biscuit" style="scale:1;transform-origin:center"><rect width="200" height="100"/></g><g data-node="candy"/></svg></main>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  w.matchMedia = () => ({ matches: false });
  w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 200, height: 100 });
  w.eval('(' + installLayoutRuntime.toString() + ')()');
  const runtime = w.__editorLayoutRuntime;
  runtime.setViewport('desktop');
  const before = runtime.snapshot();
  const identity = { selector: 'g[data-node="biscuit"]', baseStyleSelector: 'g[data-node="biscuit"]',
    styleSelector: 'main[data-phase="one"] g[data-node="biscuit"]', editScope: { mode: 'current', states: ['one'] },
    sceneContext: { ownerSelector: 'main#stage', attribute: 'data-phase', value: 'one' } };
  runtime.writeMany(identity, { width: '300px', height: '80px' });
  const biscuit = d.querySelector('[data-node="biscuit"]'), candy = d.querySelector('[data-node="candy"]');
  assert.equal(biscuit.style.scale, '1.5 0.8');
  assert.equal(candy.style.scale, '');
  runtime.apply(); runtime.apply();
  assert.equal(biscuit.style.scale, '1.5 0.8', 'recalculation never multiplies the previous result');
  assert.equal(runtime.snapshot().edits.length, 2, 'derived scale stays out of saved editing scopes');
  const after = runtime.snapshot();
  runtime.restore(before);
  assert.equal(biscuit.style.width, '');
  assert.equal(biscuit.style.scale, '1');
  assert.equal(biscuit.style.transformOrigin, 'center');
  assert.equal(biscuit.style.transformBox, '');
  runtime.restore(after);
  assert.equal(biscuit.style.scale, '1.5 0.8');
  d.querySelector('main').dataset.phase = 'two';
  runtime.apply();
  assert.equal(biscuit.style.width, '');
  assert.equal(biscuit.style.scale, '1', 'the next scene keeps authored dimensions');
});
