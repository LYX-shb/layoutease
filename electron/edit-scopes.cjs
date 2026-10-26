const { installSceneProvider } = require('./scene-provider.cjs');
const properties = ['display', 'font-size', 'color', 'width', 'height', 'margin', 'padding', 'background-image', 'transform', 'translate'];
const devices = ['desktop', 'tablet', 'mobilePortrait', 'mobileLandscape', 'phone'];

function normalizeLayoutConfig(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.edits) || !Array.isArray(value.preferences)) throw new Error('布局记录格式无效');
  if (value.edits.length > 3000 || value.preferences.length > 1000) throw new Error('布局记录过多');
  const selector = input => {
    if (typeof input !== 'string' || !input.trim() || input.length > 6000 || /[<{};\r\n]/.test(input)) throw new Error('素材定位无效');
    return input;
  };
  const scope = input => {
    if (!input || !['original', 'current', 'selected', 'all'].includes(input.mode) || !Array.isArray(input.states) || input.states.length > 100) throw new Error('画面范围无效');
    const states = [...new Set(input.states.map(state => {
      if (typeof state !== 'string' || !state || state.length > 120 || /[<>\r\n]/.test(state)) throw new Error('画面名称无效');
      return state;
    }))];
    if (input.mode === 'selected' && !states.length) throw new Error('至少选择一个画面');
    return { mode: input.mode, states };
  };
  if ((value.visibility?.length || 0) > 1000 || (value.shared?.length || 0) > 1000) throw new Error('公共素材记录过多');
  if (!Array.isArray(value.groups || []) || (value.groups || []).length > 500 || !Array.isArray(value.anchors || []) || (value.anchors || []).length > 1000) throw new Error('组合记录过多');
  return { version: 1,
    edits: value.edits.map(edit => {
      if (!properties.includes(edit.property) || !devices.includes(edit.viewport) || typeof edit.value !== 'string' || !edit.value.trim() || edit.value.length > 3000 || /[<>{};\r\n]/.test(edit.value)) throw new Error('布局属性无效');
      let scene;
      if (edit.scene) {
        if (!/^data-(phase|state|scene|step|page|slide|screen|question)$/.test(edit.scene.attribute)) throw new Error('画面定位无效');
        scene = { ownerSelector: selector(edit.scene.ownerSelector), attribute: edit.scene.attribute, states: scope({ mode: edit.scene.states?.length ? 'selected' : 'all', states: edit.scene.states }).states };
      }
      return { target: selector(edit.target), selector: selector(edit.selector), property: edit.property, value: edit.value, viewport: edit.viewport, ...(scene ? { scene } : {}) };
    }),
    visibility: (value.visibility || []).map(item => {
      if (!devices.includes(item.viewport) || !/^data-(phase|state|scene|step|page|slide|screen|question)$/.test(item.attribute || 'data-phase')) throw new Error('显示范围无效');
      return { target: selector(item.target), selector: selector(item.selector), viewport: item.viewport, ownerSelector: item.ownerSelector ? selector(item.ownerSelector) : '', attribute: item.attribute || 'data-phase', scope: scope(item.scope), ...(item.deleted === true ? { deleted: true } : {}), display: item.deleted === true ? 'none' : ['block', 'inline-block', 'inline', 'flex', 'grid'].includes(item.display) ? item.display : 'block' };
    }),
    shared: (value.shared || []).map(item => {
      if (!/^[a-z0-9-]{8,80}$/.test(item.id) || typeof item.src !== 'string' || !item.src || /[<>\r\n]/.test(item.src) || /^(?:javascript|vbscript|data):/i.test(item.src) || !devices.includes(item.viewport)) throw new Error('公共素材无效');
      const box = item.box;
      if (!box || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key]) && Math.abs(box[key]) < 10000) || box.width <= 0 || box.height <= 0) throw new Error('公共素材尺寸无效');
      return { id: item.id, src: item.src, alt: String(item.alt || '').slice(0, 1000), transform: ['none', 'scaleX(-1)', 'scaleY(-1)', 'scale(-1, -1)'].includes(item.transform) ? item.transform : 'none', hostSelector: item.hostSelector ? selector(item.hostSelector) : '', existing: item.existing === true, positionOnly: item.positionOnly === true, ...(typeof item.freeResize === 'boolean' ? { freeResize: item.freeResize } : {}), viewport: item.viewport, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    }),
    groups: (value.groups || []).map(item => {
      if (!/^group-[a-z0-9-]{8,80}$/.test(item.id) || !Array.isArray(item.members) || item.members.length < 2 || item.members.length > 50) throw new Error('组合记录无效');
      const members = [...new Set(item.members.map(selector))];
      if (members.length !== item.members.length) throw new Error('组合成员重复');
      const sync = ['current', 'selected', 'all'].includes(item.sync) ? item.sync : 'current';
      const states = scope({ mode: sync, states: item.states || [] }).states;
      const pages = [...new Set((item.pages || []).map(page => {
        if (typeof page !== 'string' || !page || page.length > 500 || /[<>\r\n]/.test(page)) throw new Error('目标网页无效');
        return page;
      }))];
      if (pages.length > 100) throw new Error('目标网页过多');
      return { id: item.id, members, sync, states, pages,
        visibility: item.visibility ? scope(item.visibility) : { mode: 'original', states: [] } };
    }),
    anchors: (value.anchors || []).map(item => {
      if (!/^group-[a-z0-9-]{8,80}:[0-9]{1,2}$/.test(item.id) || !devices.includes(item.viewport)
        || !Number.isFinite(item.x) || !Number.isFinite(item.y) || Math.abs(item.x) > 10000 || Math.abs(item.y) > 10000) throw new Error('跨网页组合位置无效');
      let scene;
      if (item.scene) {
        if (!/^data-(phase|state|scene|step|page|slide|screen|question)$/.test(item.scene.attribute)) throw new Error('组合画面定位无效');
        scene = { ownerSelector: selector(item.scene.ownerSelector), attribute: item.scene.attribute,
          states: scope({ mode: 'selected', states: item.scene.states }).states };
      }
      const positions = item.positions?.map(position => {
        if (!position || typeof position.translate !== 'string' || position.translate.length > 3000 || /[<>{};\r\n]/.test(position.translate)
          || position.transform !== undefined && (typeof position.transform !== 'string' || position.transform.length > 3000 || /[<>{};\r\n]/.test(position.transform))) throw new Error('组合内部位置无效');
        return { selector: selector(position.selector), translate: position.translate, ...(position.transform !== undefined ? { transform: position.transform } : {}) };
      });
      if (positions && positions.length > 50) throw new Error('组合内部素材过多');
      const exclusions = (item.exclusions || []).map(exception => {
        if (!devices.includes(exception.viewport) || !/^data-(phase|state|scene|step|page|slide|screen|question)$/.test(exception.scene?.attribute || '')) throw new Error('独立位置范围无效');
        return { viewport: exception.viewport, scene: { ownerSelector: selector(exception.scene.ownerSelector), attribute: exception.scene.attribute,
          states: scope({ mode: 'selected', states: exception.scene.states }).states } };
      });
      return { id: item.id, selector: selector(item.selector), viewport: item.viewport, x: item.x, y: item.y,
        force: item.force === true, ...(scene ? { scene } : {}), ...(item.reference ? { reference: item.reference === 'visual' ? 'visual' : 'subject' } : {}),
        ...(positions ? { positions } : {}), ...(exclusions.length ? { exclusions } : {}) };
    }),
    preferences: value.preferences.map(preference => {
      const group = preference.group || 'position';
      if (!['position', 'size', 'appearance'].includes(group)) throw new Error('属性范围无效');
      const viewport = preference.viewport || 'desktop';
      if (!devices.includes(viewport)) throw new Error('设备范围无效');
      return { target: selector(preference.target), group, viewport, scope: scope(preference.scope) };
    }),
  };
}

// Runs both inside the editor preview and in an exported standalone page.
// Keep it self-contained: the saved page must not depend on the installed editor.
function installLayoutRuntime(options) {
  // The editor supplies a controller around the page's saved renderer. Opening a
  // page must not silently replace the rules used by its standalone HTML.
  const savedRenderer = options?.renderer;
  if (window.__editorLayoutRuntime && !savedRenderer) return window.__editorLayoutRuntime;
  const allowed = ['display', 'font-size', 'color', 'width', 'height', 'margin', 'padding', 'background-image', 'transform', 'translate'];
  const media = { tablet: '(min-width:901px) and (max-width:1200px)', mobilePortrait: '(max-width:500px)', mobileLandscape: '(min-width:501px) and (max-width:900px)' };
  let config = { version: 1, edits: [], preferences: [] };
  try {
    const saved = JSON.parse(document.querySelector('script[data-editor-layout-data]')?.textContent || 'null');
    if (saved?.version === 1 && Array.isArray(saved.edits) && Array.isArray(saved.preferences)) config = saved;
  } catch {}
  if (savedRenderer) config = savedRenderer.snapshot();
  for (const item of config.visibility || []) {
    if (['current', 'selected'].includes(item.scope?.mode) && !item.scope.states?.length) item.scope = { mode: 'original', states: [] };
  }
  const clone = value => JSON.parse(JSON.stringify(value));
  const tracked = new Map();
  const hiddenRecords = new Map();
  const sharedNodes = new Map();
  const sharedSignatures = new Map();
  const selectorCache = new Map();
  const translationBases = new WeakMap();
  const appliedTranslations = new WeakMap();
  let groupBindings = [];
  const suspendedAnchors = new Set();
  const nativeTranslate = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports('translate', '1px 1px') : 'translate' in document.documentElement.style;
  let applying = false;
  let queued = false;
  let viewport = '';
  function isPhone() {
    if (savedRenderer?.isPhone) return savedRenderer.isPhone();
    // A write-back range is not evidence of a mobile browser. In particular a
    // 601–900px custom desktop viewport must not acquire phone-only overrides.
    if (viewport && !options) return ['phone', 'mobilePortrait', 'mobileLandscape'].includes(viewport);
    const ua = navigator.userAgent || '';
    if (navigator.userAgentData?.mobile === true || /iPhone|iPod|Android.*Mobile|Windows Phone|HarmonyOS.*Mobile/i.test(ua)) return true;
    const width = window.visualViewport?.width || innerWidth;
    const height = window.visualViewport?.height || innerHeight;
    if (width <= 600) return true;
    const shortScreen = Math.min(screen.width || width, screen.height || height);
    return !/iPad/i.test(ua) && Math.min(shortScreen, width, height) <= 600 && (/Android|HarmonyOS/i.test(ua) || matchMedia('(pointer: coarse)').matches);
  }
  const currentViewport = () => viewport || (isPhone() ? 'phone' : innerWidth <= 900 ? 'mobileLandscape' : innerWidth <= 1200 ? 'tablet' : 'desktop');
  const matchesDevice = edit => edit.viewport === 'desktop' || (edit.viewport === 'phone' ? isPhone() : media[edit.viewport] && matchMedia(media[edit.viewport]).matches);
  const deviceRank = item => item.viewport === 'desktop' ? 0 : item.viewport === 'phone' ? 2 : 1;
  const deviceOrder = items => [...items].sort((a, b) => deviceRank(a) - deviceRank(b));
  function groupEnd(text, start) {
    let depth = 1, quote = '', escaped = false;
    for (let index = start + 4; index < text.length; index++) {
      const character = text[index];
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (quote) { if (character === quote) quote = ''; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '(') depth++;
      if (character === ')') { depth--; if (depth === 0) return index; }
    }
    throw Error('Invalid selector group');
  }
  function splitChoices(text) {
    const result = []; let start = 0, depth = 0, quote = '', escaped = false;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (escaped) { escaped = false; continue; }
      if (character === '\\') { escaped = true; continue; }
      if (quote) { if (character === quote) quote = ''; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === '(' || character === '[') depth++;
      if (character === ')' || character === ']') depth--;
      if (character === ',' && depth === 0) { result.push(text.slice(start, index)); start = index + 1; }
    }
    result.push(text.slice(start)); return result;
  }
  function expandIs(text) {
    const start = text.indexOf(':is(');
    if (start < 0) return [text];
    const end = groupEnd(text, start);
    return splitChoices(text.slice(start + 4, end)).flatMap(choice => expandIs(text.slice(0, start) + choice + text.slice(end + 1)));
  }
  function compatibleSelector(selector) {
    if (selectorCache.has(selector)) return selectorCache.get(selector);
    let result = null;
    try {
      if (!selector.startsWith(':is(')) throw Error('Unsupported selector');
      const end = groupEnd(selector, 0);
      let base = selector.slice(4, end), remaining = selector.slice(end + 1);
      const ancestors = [];
      while (remaining) {
        const start = remaining.indexOf(':is(');
        if (start < 0) { base += remaining; break; }
        base += remaining.slice(0, start);
        const finish = groupEnd(remaining, start);
        const guard = remaining.slice(start + 4, finish).trim();
        if (!guard.endsWith(' *')) throw Error('Unsupported guard');
        ancestors.push(expandIs(guard.slice(0, -2)).join(','));
        remaining = remaining.slice(finish + 1);
      }
      result = { base, ancestors };
    } catch {}
    selectorCache.set(selector, result); return result;
  }
  function matchesCompatible(element, selector) {
    try { return element.matches(selector); } catch {}
    const compiled = compatibleSelector(selector);
    if (!compiled) return false;
    try {
      if (!element.matches(compiled.base)) return false;
      return compiled.ancestors.every(guard => {
        for (let owner = element.parentElement; owner; owner = owner.parentElement) if (owner.matches(guard)) return true;
        return false;
      });
    } catch { return false; }
  }
  function queryCompatible(selector) {
    try { return document.querySelectorAll(selector); } catch {}
    const compiled = compatibleSelector(selector);
    if (!compiled) return [];
    try { return Array.from(document.querySelectorAll(compiled.base)).filter(element => matchesCompatible(element, selector)); } catch { return []; }
  }
  function visibilityOf(element) {
    let result = null;
    for (const item of deviceOrder(config.visibility || [])) {
      if (!matchesDevice(item)) continue;
      try { if (element.matches(item.selector)) result = item; } catch {}
    }
    if (!result || result.scope.mode === 'original') return null;
    // Older versions stored "current" without any screen name. Such a record
    // cannot decide visibility after the lesson gains real state markers: an
    // empty whitelist would otherwise hide the entire interaction container.
    if (result.scope.mode !== 'all' && !result.scope.states.length) return null;
    const owner = (result.ownerSelector && document.querySelector(result.ownerSelector)) || element.closest('[data-phase],[data-state],[data-scene],[data-step],[data-page],[data-slide],[data-screen],[data-question]');
    if (result.scope.mode !== 'all' && !owner) return null;
    return { show: result.scope.mode === 'all' || result.scope.states.includes(owner.getAttribute(result.attribute)), display: result.display };
  }
  function applyShared() {
    const active = new Set();
    const effective = new Map();
    for (const item of deviceOrder(config.shared || [])) if (matchesDevice(item)) effective.set(item.id, item);
    for (const item of effective.values()) {
      active.add(item.id);
      let element = sharedNodes.get(item.id);
      if (!element?.isConnected) {
        sharedSignatures.delete(item.id);
        element = document.querySelector('img[data-editor-shared-id="' + item.id + '"]');
        if (!element) {
          let host = (item.hostSelector && document.querySelector(item.hostSelector)) || document.querySelector('main[id]') || document.body;
          if (!host) continue;
          if (host === document.body) {
            let layer = document.querySelector('[data-editor-shared-layer]');
            if (!layer) {
              layer = document.createElement('div');
              layer.dataset.editorSharedLayer = 'true';
              layer.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000;';
              document.body.appendChild(layer);
            }
            host = layer;
          }
          if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
          element = document.createElement('img');
          element.dataset.editorSharedId = item.id;
          element.draggable = false;
          host.appendChild(element);
        }
        sharedNodes.set(item.id, element);
      }
      const signature = JSON.stringify(item);
      if (sharedSignatures.get(item.id) === signature) continue;
      sharedSignatures.set(item.id, signature);
      if (element.getAttribute('src') !== item.src) element.setAttribute('src', item.src);
      if (element.alt !== item.alt) element.alt = item.alt;
      const styles = { position: 'absolute', left: item.box.x + '%', top: item.box.y + '%', 'z-index': '50' };
      if (!item.positionOnly) Object.assign(styles, { width: item.box.width + '%', height: item.box.height + '%', transform: item.transform || 'none' });
      if (!item.existing) styles['pointer-events'] = 'none';
      for (const [name, value] of Object.entries(styles)) if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
    }
    for (const [id, element] of sharedNodes) if (!active.has(id)) { element.remove(); sharedNodes.delete(id); sharedSignatures.delete(id); }
  }
  // A single-image control is one movable object. Moving its image alone leaves
  // its hit area behind and lets saved offsets inside it change between scenes.
  function groupSubject(element) {
    if (!(element instanceof Element)) return element;
    const owner = element.closest('[data-group][data-index],button,a,[role="button"],[role="img"]');
    if (!owner || owner.textContent.trim()) return element;
    const visuals = owner.querySelectorAll('img,svg,canvas');
    return visuals.length === 1 && (element === owner || element.contains(visuals[0]) || visuals[0] === element) ? owner : element;
  }
  function groupVisual(element) {
    if (element.matches('img,svg,canvas')) return element;
    const visuals = element.querySelectorAll('img,svg,canvas');
    return visuals.length === 1 && !element.textContent.trim() ? visuals[0] : element;
  }
  function captureGroupPositions(subject) {
    if (savedRenderer?.captureGroupPositions) return savedRenderer.captureGroupPositions(subject);
    const visual = groupVisual(subject);
    if (visual === subject) return [];
    const existing = [...groupBindings].reverse().find(binding => binding.subject === subject && binding.positions.some(position => position.element === visual));
    if (existing) return existing.positions.map(({ element: _element, ...position }) => clone(position));
    const styles = resolved(visual, true), computed = getComputedStyle(visual);
    const original = tracked.get(visual)?.get('translate');
    return [{ selector: visual.tagName.toLowerCase(),
      translate: styles.get('translate') || (original?.applied ? original.original.value || 'none' : computed.translate || 'none'),
      transform: styles.get('transform') || (!nativeTranslate && translationBases.get(visual)) || computed.transform || 'none' }];
  }
  function prepareGroupBindings() {
    groupBindings = [];
    for (const anchor of deviceOrder(config.anchors || [])) {
      if (!matchesDevice(anchor) || !matchesScene(anchor.scene)) continue;
      if ((anchor.exclusions || []).some(item => (item.viewport === 'phone' ? isPhone() : item.viewport === currentViewport()) && matchesScene(item.scene))) continue;
      try {
        const matches = document.querySelectorAll(anchor.selector);
        if (matches.length !== 1) continue;
        const source = matches[0], subject = anchor.force ? groupSubject(source) : source;
        const reference = anchor.reference === 'visual' ? groupVisual(subject) : anchor.reference === 'subject' ? subject : source;
        if (anchor.force && !anchor.positions && !subject.closest('[hidden]') && getComputedStyle(subject).display !== 'none') anchor.positions = captureGroupPositions(subject);
        const positions = (anchor.positions || []).flatMap(position => {
          const nodes = subject.querySelectorAll(position.selector);
          return nodes.length === 1 ? [{ element: nodes[0], ...position }] : [];
        });
        groupBindings.push({ anchor, subject, reference, positions });
      } catch {}
    }
  }
  function resolved(element, withoutGroup = false) {
    const result = new Map();
    const positionScopes = new Map();
    // A device-specific setting retains priority over the desktop/default style.
    for (const edit of deviceOrder(config.edits)) {
      if (!matchesDevice(edit)) continue;
      if (matchesCompatible(element, edit.selector) && matchesScene(edit.scene)) {
        result.set(edit.property, edit.value);
        if (['translate', 'transform'].includes(edit.property)) positionScopes.set(edit.property, edit.scene ? edit.scene.states.length > 0 : edit.selector !== edit.target && /data-(phase|state|scene|step|page|slide|screen|question)=/.test(edit.selector));
      }
    }
    const visibility = visibilityOf(element);
    if (visibility) result.set('display', visibility.show ? visibility.display : 'none');
    if (withoutGroup) return result;
    for (const binding of groupBindings) for (const position of binding.positions) if (position.element === element) {
      result.set('translate', position.translate);
      if (position.transform !== undefined) result.set('transform', position.transform);
    }
    const binding = [...groupBindings].reverse().find(item => item.subject === element && ![...suspendedAnchors].some(id => item.anchor.id.startsWith(id + ':')));
    const anchor = binding?.anchor;
    if (anchor && (anchor.force || ![...positionScopes.values()].some(Boolean)) && getComputedStyle(element).display !== 'none' && !element.closest('[hidden]')) {
      const host = document.querySelector('main[id]') || document.querySelector('main') || document.body;
      const hostRect = host.getBoundingClientRect(), rect = binding.reference.getBoundingClientRect();
      if (hostRect.width > 0 && hostRect.height > 0) {
        const screenX = hostRect.left + hostRect.width * anchor.x / 100 - rect.left;
        const screenY = hostRect.top + hostRect.height * anchor.y / 100 - rect.top;
        let matrix = { m11: 1, m12: 0, m21: 0, m22: 1 };
        try { if (typeof DOMMatrix !== 'undefined') {
          matrix = new DOMMatrix();
          const ancestors = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
          for (const parent of ancestors.reverse()) {
            const style = getComputedStyle(parent);
            const parts = [style.rotate && style.rotate !== 'none' ? 'rotate(' + style.rotate + ')' : '', style.scale && style.scale !== 'none' ? 'scale(' + style.scale + ')' : '', style.transform && style.transform !== 'none' ? style.transform : ''].filter(Boolean);
            const zoom = parseFloat(style.zoom);
            const local = parts.length ? new DOMMatrix(parts.join(' ')) : new DOMMatrix();
            matrix = matrix.multiply(Number.isFinite(zoom) && zoom > 0 && zoom !== 1 ? new DOMMatrix().scale(zoom).multiply(local) : local);
          }
        } } catch { matrix = { m11: 1, m12: 0, m21: 0, m22: 1 }; }
        const determinant = matrix.m11 * matrix.m22 - matrix.m12 * matrix.m21;
        const deltaX = Math.abs(determinant) > 1e-10 ? (matrix.m22 * screenX - matrix.m21 * screenY) / determinant : screenX;
        const deltaY = Math.abs(determinant) > 1e-10 ? (-matrix.m12 * screenX + matrix.m11 * screenY) / determinant : screenY;
        const translate = (nativeTranslate ? getComputedStyle(element).translate || 'none' : appliedTranslations.get(element) || 'none').split(/\s+/);
        const width = element.offsetWidth || rect.width || 1, height = element.offsetHeight || rect.height || 1;
        const length = (value, size) => (parseFloat(value) || 0) * (value?.endsWith('%') ? size / 100 : 1);
        const x = Math.round((length(translate[0], width) + deltaX) * 100) / 100;
        const y = Math.round((length(translate[1], height) + deltaY) * 100) / 100;
        result.set('translate', x + 'px ' + y + 'px');
      }
    }
    if (!nativeTranslate && result.has('translate')) {
      result.translationValue = result.get('translate');
      const record = tracked.get(element)?.get('transform');
      if (!record?.applied || element.style.getPropertyValue('transform') !== record.applied.value) translationBases.set(element, getComputedStyle(element).transform || 'none');
      const base = result.get('transform') || translationBases.get(element) || 'none';
      const value = result.get('translate').trim();
      const parts = value === 'none' ? ['0px', '0px'] : value.split(/\s+/);
      result.set('transform', 'translate(' + parts[0] + ', ' + (parts[1] || '0px') + ')' + (base === 'none' ? '' : ' ' + base));
      result.delete('translate');
    }
    return result;
  }
  function apply() {
    if (savedRenderer) { savedRenderer.restore(clone(config)); config = savedRenderer.snapshot(); return; }
    if (applying) return;
    applying = true;
    try {
      applyShared();
      prepareGroupBindings();
      const candidates = new Set(tracked.keys());
      hiddenRecords.forEach((_record, element) => candidates.add(element));
      for (const binding of groupBindings) { candidates.add(binding.subject); for (const position of binding.positions) candidates.add(position.element); }
      for (const item of config.visibility || []) try { document.querySelectorAll(item.selector).forEach(element => candidates.add(element)); } catch {}
      for (const item of config.anchors || []) if (matchesDevice(item)) try { document.querySelectorAll(item.selector).forEach(element => candidates.add(element)); } catch {}
      for (const edit of config.edits) {
        if (!matchesDevice(edit)) continue;
        queryCompatible(edit.selector).forEach(element => candidates.add(element));
      }
      for (const element of candidates) {
        if (!element.isConnected) { tracked.delete(element); hiddenRecords.delete(element); continue; }
        const visibility = visibilityOf(element);
        let hidden = hiddenRecords.get(element);
        if (hidden && element.hidden !== hidden.applied) hidden.original = element.hidden;
        if (visibility) {
          if (!hidden) hidden = { original: element.hidden, applied: element.hidden };
          if (element.hidden !== !visibility.show) element.hidden = !visibility.show;
          hidden.applied = element.hidden;
          hiddenRecords.set(element, hidden);
        } else if (hidden) {
          if (element.hidden !== hidden.original) element.hidden = hidden.original;
          hiddenRecords.delete(element);
        }
        const next = resolved(element);
        const previous = tracked.get(element) || new Map();
        // SVG groups have no CSS layout box. Interpret inspector dimensions in
        // SVG user units and derive a reversible visual scale for this object.
        if (element.matches('g[data-node]') && typeof element.getBBox === 'function' && (next.has('width') || next.has('height'))) {
          const box = element.getBBox();
          if (box.width > 0 && box.height > 0) {
            const originalScale = previous.get('scale')?.original.value ?? getComputedStyle(element).scale;
            const scales = (originalScale || 'none').split(/\s+/);
            const sx = parseFloat(scales[0]) || 1, sy = parseFloat(scales[1]) || sx;
            const width = next.get('width'), height = next.get('height');
            if ((!width || /^\d+(?:\.\d+)?px$/.test(width)) && (!height || /^\d+(?:\.\d+)?px$/.test(height))) {
              next.set('scale', (width ? parseFloat(width) / box.width : sx) + ' ' + (height ? parseFloat(height) / box.height : sy));
              next.set('transform-box', 'fill-box');
              next.set('transform-origin', '0 0');
            }
          }
        }
        for (const property of new Set([...previous.keys(), ...next.keys()])) {
          const current = { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) };
          let record = previous.get(property);
          if (!record) record = { original: current, applied: null };
          else if (record.applied && (current.value !== record.applied.value || current.priority !== record.applied.priority)) record.original = current;
          const value = next.get(property);
          if (value !== undefined) {
            const unchanged = record.desired === value && record.applied && current.value === record.applied.value && current.priority === record.applied.priority;
            if (!unchanged && (current.value !== value || current.priority !== 'important')) element.style.setProperty(property, value, 'important');
            record.desired = value;
            record.applied = { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) };
            previous.set(property, record);
          } else {
            const original = record.original;
            if (current.value !== original.value || current.priority !== original.priority) {
              if (original.value) element.style.setProperty(property, original.value, original.priority);
              else element.style.removeProperty(property);
            }
            previous.delete(property);
          }
        }
        if (previous.size) tracked.set(element, previous); else tracked.delete(element);
        if (next.translationValue) appliedTranslations.set(element, next.translationValue); else appliedTranslations.delete(element);
      }
    } finally { applying = false; }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; apply(); });
  }
  function matchesScene(scene) {
    if (!scene) return true;
    try {
      const owner = document.querySelector(scene.ownerSelector);
      return !!owner && owner.hasAttribute(scene.attribute) && (!scene.states.length || scene.states.includes(owner.getAttribute(scene.attribute)));
    } catch { return false; }
  }
  function identityScene(identity) {
    const scene = identity.sceneContext;
    if (!scene) return undefined;
    return { ownerSelector: scene.ownerSelector, attribute: scene.attribute, states: identity.editScope?.mode === 'all' ? [] : identity.editScope?.mode === 'selected' ? [...identity.editScope.states] : [scene.value] };
  }
  function writeMany(identity, styles) {
    if (!identity.styleSelector) return;
    const entries = Object.entries(styles).filter(([property]) => allowed.includes(property));
    const names = new Set(entries.map(([property]) => property));
    const groups = new Set(entries.map(([property]) => ['translate', 'transform'].includes(property) ? 'position' : ['width', 'height'].includes(property) ? 'size' : 'appearance'));
    const device = currentViewport();
    const target = identity.baseStyleSelector || identity.selector;
    const scene = identityScene(identity);
    // Old "current page" records could have been stored without a state. Once
    // the lesson supplies its state, bind those properties to the screen being
    // edited rather than leaving their old unguarded override on every screen.
    const legacyCurrent = scene?.states.length && config.preferences.some(item => item.target === identity.selector && groups.has(item.group || 'position') && (item.viewport || 'desktop') === device && item.scope.mode === 'current' && !item.scope.states.length);
    if (legacyCurrent) config.edits = config.edits.filter(edit => !(edit.target === target && edit.selector === target && !edit.scene && edit.viewport === device && names.has(edit.property)));
    config.edits = config.edits.filter(edit => !(edit.target === target && edit.selector === identity.styleSelector && JSON.stringify(edit.scene) === JSON.stringify(scene) && names.has(edit.property) && edit.viewport === device));
    for (const [property, value] of entries) if (value) config.edits.push({ target, selector: identity.styleSelector, property, value, viewport: device, ...(scene ? { scene } : {}) });
    apply();
  }
  function write(identity, property, value) { writeMany(identity, { [property]: value }); }
  const api = {
    snapshot: () => clone(config),
    isPhone,
    restore(value) { config = clone(value); apply(); },
    groups: () => clone(config.groups || []),
    addImage(item) {
      config.shared = (config.shared || []).filter(image => image.id !== item.id);
      config.shared.push(clone(item));
      apply();
    },
    deleteElements(identities) {
      const device = currentViewport();
      // A scoped visibility mask wins over an existing "show this image" rule.
      // Older saved renderers also understand scope=all + display=none, with
      // the actual scene guard carried by the selector itself.
      for (const identity of identities) {
        config.visibility = (config.visibility || []).filter(item => !(item.deleted && item.target === identity.selector && item.selector === identity.styleSelector && item.viewport === device));
        config.visibility.push({ target: identity.selector, selector: identity.styleSelector, viewport: device,
          ownerSelector: '', attribute: 'data-phase', scope: { mode: 'all', states: [] }, display: 'none', deleted: true });
      }
      apply();
    },
    setImageResizeLock(id, locked) {
      for (const item of config.shared || []) if (item.id === id) item.freeResize = !locked;
    },
    groupSubject,
    groupVisual,
    captureGroupPositions,
    excludeGroupMember(element, scene, states) {
      if (!scene) return;
      const subject = groupSubject(element), viewport = isPhone() ? 'phone' : currentViewport();
      for (const anchor of config.anchors || []) {
        let source;
        try { source = document.querySelector(anchor.selector); } catch { continue; }
        if (!source || groupSubject(source) !== subject || !matchesDevice(anchor)) continue;
        anchor.exclusions = (anchor.exclusions || []).filter(item => !(item.viewport === viewport && item.scene.ownerSelector === scene.ownerSelector && item.scene.attribute === scene.attribute && (!states.length || item.scene.states.some(state => states.includes(state)))));
        anchor.exclusions.push({ viewport, scene: { ownerSelector: scene.ownerSelector, attribute: scene.attribute, states: [...states] } });
      }
    },
    addGroup(id, members, sync = 'current', states = []) {
      const memberSet = new Set(members);
      config.groups = (config.groups || []).filter(group => !group.members.some(member => memberSet.has(member)));
      config.groups.push({ id, members: [...members], sync, states: [...states], pages: [], visibility: { mode: 'original', states: [] } });
    },
    removeGroup(id) {
      config.groups = (config.groups || []).filter(group => group.id !== id);
      config.anchors = (config.anchors || []).filter(item => !item.id.startsWith(id + ':'));
      apply();
    },
    setGroupSync(id, sync, states = []) {
      const group = (config.groups || []).find(item => item.id === id);
      if (group) { group.sync = sync; group.states = [...states]; }
      if (sync === 'current') config.anchors = (config.anchors || []).filter(item => !item.id.startsWith(id + ':'));
    },
    setGroupPages(id, pages) {
      const group = (config.groups || []).find(item => item.id === id);
      if (group) group.pages = [...new Set(pages)];
    },
    setGroupVisibility(id, scope) {
      const group = (config.groups || []).find(item => item.id === id);
      if (group) group.visibility = clone(scope);
    },
    setGroupAnchors(id, members) {
      const device = currentViewport();
      config.anchors = (config.anchors || []).filter(item => !(item.id.startsWith(id + ':') && item.viewport === device));
      for (const [index, member] of members.entries()) config.anchors.push({ id: id + ':' + index, selector: member.selector, viewport: device, x: member.x, y: member.y,
        force: true, reference: member.reference || 'visual', ...(member.positions ? { positions: clone(member.positions) } : {}), ...(member.scene ? { scene: clone(member.scene) } : {}) });
    },
    suspendGroupAnchors(id) { suspendedAnchors.add(id); savedRenderer?.suspendGroupAnchors?.(id); },
    resumeGroupAnchors(id) { suspendedAnchors.delete(id); apply(); savedRenderer?.resumeGroupAnchors?.(id); },
    write,
    writeMany,
    apply,
    getStyles(element) { return savedRenderer ? savedRenderer.getStyles(element) : Object.fromEntries(resolved(element)); },
    preference(target, group = 'position', state = '') {
      const device = currentViewport();
      const candidates = [...config.preferences].reverse();
      const match = item => item.target === target && (item.group || 'position') === group && (item.scope.mode === 'all' || !state || item.scope.mode === 'current' && !item.scope.states.length || item.scope.states.includes(state));
      const item = candidates.find(item => (item.viewport || 'desktop') === device && match(item)) || (device === 'phone' && candidates.find(item => ['mobilePortrait', 'mobileLandscape'].includes(item.viewport) && match(item))) || candidates.find(item => (item.viewport || 'desktop') === 'desktop' && match(item));
      return clone(item?.scope || { mode: 'original', states: [] });
    },
    setPreference(target, scope, group = 'position', state = '', device = currentViewport()) {
      config.preferences = config.preferences.filter(item => (item.viewport || 'desktop') !== device || item.target !== target || (item.group || 'position') !== group || (scope.mode !== 'all' && state && item.scope.mode !== 'all' && !item.scope.states.includes(state)));
      config.preferences.push({ target, group, viewport: device, scope: clone(scope) });
    },
    visibility(target) {
      const items = [...(config.visibility || [])].filter(item => !item.deleted).reverse();
      const device = currentViewport();
      const scope = (items.find(item => item.target === target && item.viewport === device) || (device === 'phone' && items.find(item => item.target === target && ['mobilePortrait', 'mobileLandscape'].includes(item.viewport))) || items.find(item => item.target === target && item.viewport === 'desktop'))?.scope;
      return clone(!scope || ['current', 'selected'].includes(scope.mode) && !scope.states.length ? { mode: 'original', states: [] } : scope);
    },
    setVisibility(identity, scope, display, device = currentViewport()) {
      const deleted = (config.visibility || []).filter(item => item.deleted);
      config.visibility = (config.visibility || []).filter(item => !item.deleted && (item.target !== identity.selector || item.viewport !== device));
      config.visibility.push({ target: identity.selector, selector: identity.baseStyleSelector, viewport: device, ownerSelector: identity.sceneContext?.ownerSelector || '', attribute: identity.sceneContext?.attribute || 'data-phase', scope: clone(scope), display });
      config.visibility.push(...deleted);
      apply();
    },
    removeScope(identity, group) {
      const device = currentViewport();
      const names = group === 'position' ? ['translate', 'transform'] : group === 'size' ? ['width', 'height'] : allowed.filter(name => !['translate', 'transform', 'width', 'height'].includes(name));
      const scene = identityScene(identity);
      const legacyCurrent = scene?.states.length && config.preferences.some(item => item.target === identity.selector && (item.group || 'position') === group && (item.viewport || 'desktop') === device && item.scope.mode === 'current' && !item.scope.states.length);
      config.edits = config.edits.filter(edit => !(edit.target === identity.baseStyleSelector && (edit.selector === identity.styleSelector && (!edit.scene || JSON.stringify(edit.scene) === JSON.stringify(scene)) || legacyCurrent && edit.selector === edit.target && !edit.scene) && edit.viewport === device && names.includes(edit.property)));
    },
    setViewport(value) { if (['desktop', 'tablet', 'mobilePortrait', 'mobileLandscape', 'phone'].includes(value)) viewport = value; },
    remapSource(before, after, target) {
      if (!before || before === after) return;
      const oldFilter = '[src=' + JSON.stringify(before) + ']';
      const newFilter = '[src=' + JSON.stringify(after) + ']';
      for (const edit of config.edits) {
        if (edit.target !== target) continue;
        edit.selector = edit.selector.split(oldFilter).join(newFilter);
        edit.target = edit.target.split(oldFilter).join(newFilter);
      }
      for (const item of config.visibility || []) if (item.selector === target || item.target === target.split(oldFilter).join('')) item.selector = item.selector.split(oldFilter).join(newFilter);
      const element = document.querySelector(target);
      if (element?.dataset.editorSharedId) for (const item of config.shared || []) if (item.id === element.dataset.editorSharedId) item.src = after;
    },
  };
  window.__editorLayoutRuntime = api;
  // The saved renderer already observes authored layout changes. A second
  // observer here would repeatedly restore stale controller data over the page.
  if (savedRenderer) return api;
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  window.addEventListener('pageshow', schedule);
  apply();
  return api;
}

function upsertLayoutDocument(html, input) {
  const config = normalizeLayoutConfig(input);
  const savedRuntime = html.match(/<script\b[^>]*\bdata-editor-layout-runtime(?:\s|=|>)[\s\S]*?<\/script\s*>/i)?.[0];
  const cleaned = html.replace(/<script\b[^>]*\bdata-editor-layout-(?:data|runtime)(?:\s|=|>)[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\bdata-editor-scene-runtime(?:\s|=|>)[\s\S]*?<\/script\s*>/gi, '');
  if (!config.edits.length && !config.preferences.length && !config.visibility.length && !config.shared.length && !config.groups.length && !config.anchors.length) return cleaned;
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  const runtime = savedRuntime || `<script data-editor-layout-runtime data-editor-runtime-version="phone-v2">(${installLayoutRuntime.toString()})();</script>`;
  const sceneRuntime = `<script data-editor-scene-runtime>(${installSceneProvider.toString()})();</script>`;
  const block = `${sceneRuntime}<script type="application/json" data-editor-layout-data>${json}</script>${runtime}`;
  return /<\/body>/i.test(cleaned) ? cleaned.replace(/<\/body>/i, `${block}</body>`) : cleaned + block;
}

module.exports = { normalizeLayoutConfig, installLayoutRuntime, upsertLayoutDocument };
