const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { installPreviewPlayback } = require('../electron/preview-playback.cjs');

function setup(t) {
  const dom = new JSDOM('<!doctype html><html><body><button>答案</button><p>题目</p></body></html>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  let clock = 0, next = 0;
  const scheduled = new Map();
  w.performance.now = () => clock;
  w.setTimeout = (callback, delay = 0) => { const id = ++next; scheduled.set(id, { callback, due: clock + Math.max(1, Number(delay)) }); return id; };
  w.clearTimeout = id => scheduled.delete(id);
  w.setInterval = w.setTimeout; w.clearInterval = w.clearTimeout;
  const nativeTimeout = w.setTimeout;
  w.requestAnimationFrame = callback => nativeTimeout(() => callback(clock), 16);
  w.cancelAnimationFrame = w.clearTimeout;
  w.document.getAnimations = () => [];
  Object.defineProperty(w.HTMLMediaElement.prototype, 'paused', { get() { return !this.testPlaying; } });
  w.HTMLMediaElement.prototype.play = function () { this.testPlaying = true; return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () { this.testPlaying = false; };
  Object.defineProperty(w.document, 'readyState', { get: () => 'complete' });
  w.eval('(' + installPreviewPlayback.toString() + ')()');
  function advance(duration) {
    const end = clock + duration;
    let count = 0;
    while (true) {
      const entry = [...scheduled].filter(([, item]) => item.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      assert.ok(++count < 10000, 'scheduler must make progress');
      clock = entry[1].due; scheduled.delete(entry[0]); entry[1].callback();
    }
    clock = end;
  }
  const runtime = w.__editorPlaybackRuntime;
  const freeze = () => { runtime.setMode('edit'); advance(32); };
  return { w, runtime, advance, freeze };
}

test('edit suspends early timers, resumes remaining time and keeps native editor work alive', t => {
  const { w, runtime, advance, freeze } = setup(t);
  let jumps = 0, editorWork = 0;
  w.setTimeout(() => jumps++, 2000);
  advance(468); freeze();
  runtime.native.setTimeout(() => editorWork++, 10);
  advance(5000);
  assert.equal(jumps, 0); assert.equal(editorWork, 1);
  runtime.setMode('test'); advance(1499); assert.equal(jumps, 0);
  advance(1); assert.equal(jumps, 1);
});

test('explicit freeze pauses immediately before the next task or frame, even before initialization', t => {
  const { w, runtime, advance } = setup(t);
  let advanced = false, painted = false, editorRan = false, acknowledged = false;
  w.setTimeout(() => { advanced = true; }, 0);
  w.requestAnimationFrame(() => { painted = true; });
  runtime.subscribe(state => { if (state.frozen) acknowledged = state.paused && !state.armed; });
  runtime.freeze();
  assert.equal(runtime.state().paused, true, 'freeze is synchronous');
  assert.equal(acknowledged, true);
  runtime.native.setTimeout(() => { editorRan = true; }, 1);
  advance(5000);
  assert.equal(advanced, false); assert.equal(painted, false); assert.equal(editorRan, true);
  runtime.setMode('test'); advance(16);
  assert.equal(advanced, true); assert.equal(painted, true);
});

test('explicit freeze cancels deferred initialization and repeated freezes retain remaining time', t => {
  const { w, runtime, advance } = setup(t);
  let advanced = false;
  w.setTimeout(() => { advanced = true; }, 100);
  runtime.setMode('edit');
  advance(5); runtime.freeze();
  advance(500); runtime.freeze(); advance(500);
  assert.equal(advanced, false);
  runtime.setMode('test'); advance(94); assert.equal(advanced, false);
  advance(1); assert.equal(advanced, true);
});

test('explicit freeze cancels an in-flight legacy capture without allowing more frames', t => {
  const { w, runtime, advance, freeze } = setup(t);
  freeze(); runtime.arm();
  let painted = false, captured = false;
  runtime.subscribe(state => { if (state.captured) captured = true; });
  w.document.querySelector('button').onclick = () => w.requestAnimationFrame(() => { painted = true; });
  w.document.querySelector('button').click();
  runtime.freeze(); advance(100);
  assert.equal(captured, false); assert.equal(painted, false); assert.equal(runtime.state().paused, true);
});

test('click capture lets synchronous, microtask and frame rendering finish but blocks automatic transitions', async t => {
  const { w, runtime, advance, freeze } = setup(t);
  freeze();
  let captured = 0;
  runtime.subscribe(state => { if (state.captured) captured++; });
  w.document.querySelector('button').onclick = () => {
    w.document.querySelector('p').textContent = '正确';
    w.queueMicrotask(() => { w.document.querySelector('p').dataset.ready = 'yes'; });
    w.requestAnimationFrame(() => w.requestAnimationFrame(() => { w.document.querySelector('p').dataset.painted = 'yes'; }));
    w.setTimeout(() => { w.document.querySelector('p').textContent = '下一题'; }, 0);
  };
  runtime.arm(); w.document.querySelector('button').click();
  await Promise.resolve(); advance(50);
  assert.equal(captured, 1);
  assert.equal(w.document.querySelector('p').textContent, '正确');
  assert.equal(w.document.querySelector('p').dataset.ready, 'yes');
  assert.equal(w.document.querySelector('p').dataset.painted, 'yes');
  advance(5000); assert.equal(w.document.querySelector('p').textContent, '正确');
  runtime.setMode('test'); advance(1);
  assert.equal(w.document.querySelector('p').textContent, '下一题');
});

test('intervals keep their phase, do not burst after resume, and support cross-API cancellation', t => {
  const { w, runtime, advance, freeze } = setup(t);
  let ticks = 0;
  const interval = w.setInterval(() => ticks++, 100);
  advance(18); freeze(); advance(5000); assert.equal(ticks, 0);
  runtime.setMode('test'); advance(49); assert.equal(ticks, 0);
  advance(1); assert.equal(ticks, 1);
  advance(200); assert.equal(ticks, 3);
  w.clearTimeout(interval); advance(500); assert.equal(ticks, 3);
  freeze();
  const timeout = w.setTimeout(() => ticks++, 1);
  w.clearInterval(timeout); runtime.setMode('test'); advance(100); assert.equal(ticks, 3);
});

test('rAF pauses without starving the editor, can be cancelled while frozen, and excludes paused time', t => {
  const { w, runtime, advance, freeze } = setup(t);
  freeze();
  let timestamp = -1, cancelled = false;
  w.requestAnimationFrame(time => { timestamp = time; });
  const id = w.requestAnimationFrame(() => { cancelled = true; });
  w.cancelAnimationFrame(id);
  advance(5000); assert.equal(timestamp, -1);
  runtime.setMode('test'); advance(16);
  assert.equal(timestamp, 48); assert.equal(cancelled, false);
});

test('repeated edit commands do not change remaining delay; cancelling capture cannot refreeze test mode', t => {
  const { w, runtime, advance, freeze } = setup(t);
  freeze();
  let done = false, captured = false;
  w.setTimeout(() => { done = true; }, 100);
  advance(500); runtime.setMode('edit'); advance(500);
  runtime.setMode('test'); advance(99); assert.equal(done, false);
  advance(1); assert.equal(done, true);
  runtime.subscribe(state => { if (state.captured) captured = true; });
  runtime.arm(); w.document.querySelector('button').click();
  runtime.setMode('test'); advance(100);
  assert.equal(captured, false); assert.equal(runtime.state().paused, false);
});

test('only running authored animations resume; editor and already paused animations are preserved', t => {
  const { w, runtime, advance } = setup(t);
  const make = (target, state) => ({ effect: { target }, playState: state,
    pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; } });
  const tool = w.document.createElement('div'); tool.dataset.editorTools = ''; w.document.body.append(tool);
  const authored = make(w.document.querySelector('p'), 'running');
  const alreadyPaused = make(w.document.querySelector('p'), 'paused');
  const editor = make(tool, 'running');
  w.document.getAnimations = () => [authored, alreadyPaused, editor];
  runtime.setMode('edit'); advance(32);
  assert.equal(authored.playState, 'paused'); assert.equal(editor.playState, 'running');
  runtime.setMode('test');
  assert.equal(authored.playState, 'running'); assert.equal(alreadyPaused.playState, 'paused');
});

test('media pauses and resumes, while authored pauses and removed media remain stopped', t => {
  const { w, runtime, freeze } = setup(t);
  const first = w.document.createElement('audio'), removed = w.document.createElement('video');
  w.document.body.append(first, removed);
  first.play(); removed.play();
  freeze(); assert.equal(first.paused, true); assert.equal(removed.paused, true);
  removed.remove();
  const detached = new w.Audio(); detached.play();
  assert.equal(detached.paused, true, 'play requests during edit are deferred');
  runtime.setMode('test');
  assert.equal(first.paused, false); assert.equal(removed.paused, true); assert.equal(detached.paused, false);
  freeze(); first.pause(); runtime.setMode('test'); assert.equal(first.paused, true);
});
