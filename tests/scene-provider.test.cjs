const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { installSceneProvider } = require('../electron/scene-provider.cjs');

test('authored Figma scenes identify current-only edits across reconstruction', t => {
  const dom = new JSDOM('<main><div id="scene"></div></main>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document, owner = d.querySelector('main'), host = d.querySelector('#scene');
  const scenes = [1, 2].map(value => `<svg xmlns="http://www.w3.org/2000/svg"><g data-node="object"><path d="M0 0h${value * 20}v20z"/></g></svg>`);
  w.FIGMA = { scenes };
  host.innerHTML = scenes[0];
  w.eval('(' + installSceneProvider.toString() + ')()');
  assert.equal(owner.dataset.phase, 'figma-scene-1');
  d.querySelector('g').style.translate = '20px 10px';
  d.querySelector('g').dataset.editorId = 'auto-1';
  w.__editorSceneProvider.sync();
  assert.equal(owner.dataset.phase, 'figma-scene-1');
  host.innerHTML = scenes[1];
  w.__editorSceneProvider.sync();
  assert.equal(owner.dataset.phase, 'figma-scene-2');
  host.innerHTML = scenes[0];
  w.__editorSceneProvider.sync();
  assert.equal(owner.dataset.phase, 'figma-scene-1');
  host.innerHTML = '<svg><g data-node="unknown"/></svg>';
  w.__editorSceneProvider.sync();
  assert.equal(owner.hasAttribute('data-phase'), false, 'unknown artwork cannot retain a previous scene scope');
});

test('scene recognition respects authored markers and prefers the public state API', t => {
  const dom = new JSDOM('<main data-state="authored"><div id="scene"></div></main>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, owner = w.document.querySelector('main');
  w.CoursewareApp = { getState: () => ({ phase: 'answer' }) };
  w.eval('(' + installSceneProvider.toString() + ')()');
  assert.equal(owner.dataset.state, 'authored');
  assert.equal(owner.hasAttribute('data-phase'), false);
  owner.removeAttribute('data-state');
  w.__editorSceneProvider.sync();
  assert.equal(owner.dataset.phase, 'answer');
});

test('native presentation changes preserve scene identity and retire old marker ownership', t => {
  const dom = new JSDOM('<main data-editor-scene-owner="course-state-api"><div id="scene"></div></main>', { runScripts:'outside-only' });
  t.after(()=>dom.window.close());
  const w=dom.window,d=w.document;
  w.FIGMA={scenes:['<svg><g data-node="one"><path d="M0 0h20v20z"/></g></svg>','<svg><g data-node="two"><path d="M0 0h40v20z"/></g></svg>']};
  d.querySelector('#scene').innerHTML=w.FIGMA.scenes[1];
  d.querySelector('g').setAttribute('display','none');
  w.eval('('+installSceneProvider.toString()+')()');
  assert.equal(d.querySelector('main').dataset.phase,'figma-scene-2');
  assert.equal(d.querySelector('main').dataset.editorSceneOwner,'course-state-api-v5');
});
