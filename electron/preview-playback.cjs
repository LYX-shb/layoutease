// Preview only. Install before authored scripts so even early timers are owned.
// The editing bridge uses `native` scheduling and keeps working while paused.
function installPreviewPlayback() {
  if (window.__editorPlaybackRuntime) return window.__editorPlaybackRuntime;
  const native = Object.fromEntries(['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame'].map(name => [name, window[name].bind(window)]));
  const now = () => performance.now();
  const timers = new Map(), frames = new Map(), animations = new Set(), media = new Map();
  const knownMedia = new Set();
  const mediaPlay = HTMLMediaElement.prototype.play, mediaPause = HTMLMediaElement.prototype.pause;
  let paused = false, armed = false, capturing = false, initialized = false, requestedMode = 'test';
  let pausedAt = 0, elapsedPause = 0, initializeFrame = 0, captureRevision = 0;
  const subscribers = new Set();
  const notify = () => { for (const callback of subscribers) callback({ paused, armed, capturing }); };
  const editorElement = element => element instanceof Element && !!element.closest('[data-editor-tools]');

  function schedule(timer) {
    timer.started = now();
    timer.handle = native.setTimeout(() => {
      if (paused || !timers.has(timer.id)) return;
      if (!timer.repeat) timers.delete(timer.id);
      else { timer.remaining = timer.delay; schedule(timer); }
      if (typeof timer.callback === 'function') timer.callback.apply(window, timer.args);
      else (0, eval)(String(timer.callback));
    }, timer.remaining);
  }
  function createTimer(callback, delay, repeat, args) {
    // Allocate a Chromium timer id, retaining it across suspension/rescheduling.
    const id = native.setTimeout(() => {}, 2147483647);
    native.clearTimeout(id);
    const duration = Math.max(0, Math.min(Number(delay) || 0, 2147483647));
    const timer = { id, callback, args, delay: duration, remaining: duration, repeat, handle: 0, started: now() };
    timers.set(id, timer);
    if (!paused) schedule(timer);
    return id;
  }
  function clearTimer(id) {
    const timer = timers.get(Number(id));
    if (timer) { native.clearTimeout(timer.handle); timers.delete(timer.id); }
    else native.clearTimeout(id);
  }
  window.setTimeout = (callback, delay, ...args) => createTimer(callback, delay, false, args);
  window.setInterval = (callback, delay, ...args) => createTimer(callback, delay, true, args);
  window.clearTimeout = window.clearInterval = clearTimer;

  function scheduleFrame(frame) {
    frame.handle = native.requestAnimationFrame(timestamp => {
      if (paused && !capturing || !frames.has(frame.id)) return;
      frames.delete(frame.id);
      frame.callback.call(window, timestamp - elapsedPause);
    });
  }
  window.requestAnimationFrame = callback => {
    const id = native.requestAnimationFrame(() => {});
    native.cancelAnimationFrame(id);
    const frame = { id, callback, handle: 0 };
    frames.set(id, frame);
    if (!paused || capturing) scheduleFrame(frame);
    return id;
  };
  window.cancelAnimationFrame = id => {
    const frame = frames.get(Number(id));
    if (frame) { native.cancelAnimationFrame(frame.handle); frames.delete(frame.id); }
    else native.cancelAnimationFrame(id);
  };

  function pauseVisuals() {
    for (const animation of document.getAnimations()) {
      if (!editorElement(animation.effect?.target) && animation.playState === 'running') {
        animations.add(animation);
        animation.pause();
      }
    }
    for (const element of document.querySelectorAll('audio,video')) knownMedia.add(element);
    for (const element of knownMedia) if (!element.paused && !editorElement(element)) {
      media.set(element, element.isConnected);
      mediaPause.call(element);
    }
  }
  const animate = Element.prototype.animate;
  if (animate) Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args);
    if (paused && !editorElement(this)) { animations.add(animation); animation.pause(); }
    return animation;
  };
  HTMLMediaElement.prototype.play = function (...args) {
    knownMedia.add(this);
    if (paused && !editorElement(this)) { media.set(this, this.isConnected); return Promise.resolve(); }
    return mediaPlay.apply(this, args);
  };
  HTMLMediaElement.prototype.pause = function (...args) {
    media.delete(this);
    return mediaPause.apply(this, args);
  };
  document.addEventListener('play', () => { if (paused) pauseVisuals(); }, true);
  new MutationObserver(() => { if (paused) pauseVisuals(); }).observe(document.documentElement,
    { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });

  function pause() {
    if (paused) return;
    paused = true; pausedAt = now();
    for (const timer of timers.values()) {
      native.clearTimeout(timer.handle);
      timer.remaining = Math.max(0, timer.remaining - (pausedAt - timer.started));
    }
    for (const frame of frames.values()) native.cancelAnimationFrame(frame.handle);
    pauseVisuals();
    notify();
  }
  function resume() {
    if (!paused) return;
    elapsedPause += now() - pausedAt;
    paused = false;
    for (const timer of timers.values()) schedule(timer);
    for (const frame of frames.values()) scheduleFrame(frame);
    for (const animation of animations) if (animation.playState === 'paused') {
      try { animation.play(); } catch {}
    }
    animations.clear();
    for (const [element, wasConnected] of media) if (!wasConnected || element.isConnected) {
      try { mediaPlay.call(element)?.catch(() => {}); } catch {}
    }
    media.clear();
    notify();
  }
  function setMode(mode) {
    if (capturing && mode === 'test') { captureRevision++; capturing = false; }
    requestedMode = mode;
    armed = false;
    if (initializeFrame) { native.cancelAnimationFrame(initializeFrame); initializeFrame = 0; }
    if (mode === 'test') { resume(); notify(); return; }
    if (initialized) { pause(); notify(); return; }
    // Let initial image decoding and the first layout frames finish before freezing.
    const initialize = () => {
      initializeFrame = native.requestAnimationFrame(() => {
        initializeFrame = native.requestAnimationFrame(() => {
          initializeFrame = 0; initialized = true;
          if (requestedMode === 'edit') pause();
        });
      });
    };
    if (document.readyState === 'complete') initialize();
    else window.addEventListener('load', () => { if (requestedMode === 'edit' && !initializeFrame) initialize(); }, { once: true });
    notify();
  }
  function arm() {
    captureRevision++; capturing = false;
    requestedMode = 'test';
    if (initializeFrame) { native.cancelAnimationFrame(initializeFrame); initializeFrame = 0; }
    initialized = true; armed = true;
    resume(); notify();
  }
  function freeze() {
    // An explicit freeze never waits for another click or an initialization frame.
    captureRevision++; capturing = false; armed = false;
    requestedMode = 'edit'; initialized = true;
    if (initializeFrame) { native.cancelAnimationFrame(initializeFrame); initializeFrame = 0; }
    pause();
    window.__editorSceneProvider?.sync();
    for (const callback of subscribers) callback({ paused: true, armed: false, capturing: false, frozen: true });
  }
  // Capture starts before authored click handlers. Microtasks may render the
  // response, but even setTimeout(..., 0) is suspended before it can advance it.
  window.addEventListener('click', event => {
    if (!armed || editorElement(event.target)) return;
    armed = false; capturing = true;
    const revision = ++captureRevision;
    pause();
    native.setTimeout(() => {
      native.requestAnimationFrame(() => native.requestAnimationFrame(() => {
        if (revision !== captureRevision) return;
        capturing = false; requestedMode = 'edit';
        for (const frame of frames.values()) native.cancelAnimationFrame(frame.handle);
        pauseVisuals();
        window.__editorSceneProvider?.sync();
        for (const callback of subscribers) callback({ paused: true, armed: false, capturing: false, captured: true });
      }));
    }, 0);
  }, true);
  window.__editorPlaybackRuntime = { version: 2, native, setMode, arm, freeze,
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    state: () => ({ paused, armed, capturing }) };
  return window.__editorPlaybackRuntime;
}

module.exports = { installPreviewPlayback };
