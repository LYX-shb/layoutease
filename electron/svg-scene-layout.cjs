// An additive renderer: existing saved layout code keeps ownership of authored
// styles. Explicit SVG geometry locks live on separate, reversible SVG groups.
function installSvgSceneLayout() {
  if (window.__editorSvgSceneLayout) return window.__editorSvgSceneLayout.wrap(window.__editorLayoutRuntime);
  const clone = value => JSON.parse(JSON.stringify(value));
  const records = new Map(), virtualTranslations = new WeakMap(), wrapped = new WeakSet();
  let pins = [], source, scenes = [], latest;
  function sceneList() {
    if (source !== window.FIGMA?.scenes) {
      source = window.FIGMA?.scenes;
      scenes = Array.isArray(source) ? source.map(html => {
        const template = document.createElement('template');
        template.innerHTML = typeof html === 'string' ? html : '';
        return template.content.querySelector('svg');
      }) : [];
    }
    return scenes;
  }
  function reference(root, value) {
    if (!value?.startsWith('#')) return value || '';
    return Array.from(root.querySelectorAll('[id]')).find(node => node.id === value.slice(1));
  }
  function fingerprint(node, root, detailed = false) {
    const uses = Array.from(node.querySelectorAll('use'), use => {
      const resource = reference(root, use.getAttribute('href') || use.getAttribute('xlink:href'));
      return resource instanceof Element ? resource.getAttribute('href') || resource.getAttribute('xlink:href') || resource.outerHTML.replace(/\sid="[^"]*"/g, '') : resource;
    });
    const paths = Array.from(node.querySelectorAll('path'), path => [path.getAttribute('d'), path.getAttribute('fill')]);
    if (!uses.length && !paths.length) return null;
    let detail = '';
    if (detailed) {
      detail = node.outerHTML.replace(/\sdata-node="[^"]*"/g, '').replace(/url\(#([^)]*)\)/g, (_match, id) => {
        const resource = reference(root, '#' + id);
        return resource instanceof Element ? resource.outerHTML.replace(/\sid="[^"]*"/g, '') : id;
      });
    }
    return JSON.stringify({ uses, paths, detail });
  }
  function describe(element, rootSelector, mode, states) {
    const roots = sceneList(), id = element.getAttribute('data-node');
    const original = roots.find(root => root?.querySelector('[data-node=' + JSON.stringify(id) + ']'));
    const originalNode = original?.querySelector('[data-node=' + JSON.stringify(id) + ']');
    if (!originalNode) throw Error('该素材没有可核对的画面来源，无法同步到其他画面');
    const key = fingerprint(originalNode, original);
    const detail = fingerprint(originalNode, original, true);
    const ids = [], matched = [];
    roots.forEach((root, index) => {
      if (!root) return;
      let candidates = Array.from(root.querySelectorAll('g[data-node]')).filter(node => fingerprint(node, root) === key && key !== null);
      if (candidates.length > 1) candidates = candidates.filter(node => fingerprint(node, root, true) === detail);
      const state = 'figma-scene-' + (index + 1);
      const requested = mode === 'all' || states.includes(state);
      if (requested && candidates.length > 1) throw Error('画面 ' + (index + 1) + ' 有多个相同素材，无法唯一对应；请先为组件设置唯一标识');
      if (candidates.length === 1) { ids.push(candidates[0].getAttribute('data-node')); matched.push(state); }
    });
    if (!ids.includes(id)) throw Error('无法唯一识别当前组件，未应用跨画面同步');
    if (mode === 'all' && matched.length < 2) throw Error('其他画面未找到同一组件，无法同步；请选择当前画面或接入组件对应标识');
    if (mode === 'selected' && states.some(state => !matched.includes(state))) throw Error('部分所选画面没有唯一对应组件，未应用同步');
    const nodes = [...new Set(ids)];
    return { nodes, rootSelector, selector: rootSelector + ' :is(' + nodes.map(id => '[data-node=' + JSON.stringify(id) + ']').join(',') + ')' };
  }
  function rootOf(element) { return element instanceof SVGElement && element.matches('g[data-node]') ? element.ownerSVGElement : null; }
  function currentViewport(base) {
    if (base.isPhone?.()) return 'phone';
    return innerWidth <= 500 ? 'mobilePortrait' : innerWidth <= 900 ? 'mobileLandscape' : innerWidth <= 1200 ? 'tablet' : 'desktop';
  }
  function active(pin) {
    const phone = latest?.isPhone?.();
    const viewport = phone ? 'phone' : innerWidth <= 500 ? 'mobilePortrait' : innerWidth <= 900 ? 'mobileLandscape' : innerWidth <= 1200 ? 'tablet' : 'desktop';
    const device = pin.viewport === 'desktop' || pin.viewport === viewport || phone && ['mobilePortrait', 'mobileLandscape'].includes(pin.viewport);
    let owner; try { owner = document.querySelector(pin.ownerSelector); } catch { return false; }
    return device && owner && (pin.scope.mode === 'all' || pin.scope.states.includes(owner.getAttribute(pin.attribute)));
  }
  function matches(pin, element) { try { return element.matches(pin.selector); } catch { return false; } }
  function forElement(element, group) {
    const candidates = pins.filter(pin => pin.group === group && active(pin) && matches(pin, element));
    return candidates.findLast(pin => pin.viewport !== 'desktop') || candidates.at(-1);
  }
  function boxOf(element) {
    const root = rootOf(element), bounds = root?.getBoundingClientRect(), rect = element.getBoundingClientRect();
    if (!bounds?.width || !bounds.height || !rect.width || !rect.height) throw Error('组件尚未显示，无法固定位置与尺寸');
    return { x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height, width: rect.width / bounds.width, height: rect.height / bounds.height };
  }
  function release(element, record) {
    if (record.wrapper.isConnected && record.wrapper.contains(element)) record.wrapper.replaceWith(element);
    records.delete(element);
  }
  function applyPins() {
    if (typeof DOMMatrix === 'undefined') return;
    const candidates = new Set();
    for (const pin of pins) if (active(pin)) try { document.querySelectorAll(pin.selector).forEach(element => candidates.add(element)); } catch {}
    for (const [element, record] of records) if (!element.isConnected || !candidates.has(element)) release(element, record);
    for (const element of candidates) {
      const root = rootOf(element);
      if (!root || !element.getClientRects().length || getComputedStyle(element).display === 'none') continue;
      const position = forElement(element, 'position'), size = forElement(element, 'size');
      const signature = JSON.stringify([position, size]);
      let record = records.get(element);
      if (!record) {
        const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapper.setAttribute('data-editor-svg-lock', 'true');
        element.before(wrapper); wrapper.appendChild(element);
        records.set(element, record = { wrapper, matrix: new DOMMatrix(), signature: '' });
      }
      if (record.signature !== signature) {
        record.matrix = new DOMMatrix(); record.wrapper.removeAttribute('transform'); record.signature = signature;
      }
      const bounds = root.getBoundingClientRect(), rect = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !rect.width || !rect.height) continue;
      const width = size ? size.box.width * bounds.width : rect.width, height = size ? size.box.height * bounds.height : rect.height;
      const x = position ? bounds.left + position.box.x * bounds.width : rect.left, y = position ? bounds.top + position.box.y * bounds.height : rect.top;
      if (Math.max(Math.abs(width - rect.width), Math.abs(height - rect.height), Math.abs(x - rect.left), Math.abs(y - rect.top)) < 0.05) continue;
      const p = record.wrapper.parentElement.getScreenCTM?.();
      if (!p) continue;
      const parent = new DOMMatrix([p.a, p.b, p.c, p.d, p.e, p.f]);
      const sx = width / rect.width, sy = height / rect.height;
      const correction = new DOMMatrix([sx, 0, 0, sy, x - sx * rect.left, y - sy * rect.top]);
      const matrix = parent.inverse().multiply(correction).multiply(parent).multiply(record.matrix);
      if (![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)) continue;
      record.matrix = matrix;
      record.wrapper.setAttribute('transform', 'matrix(' + [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(' ') + ')');
    }
  }
  function geometry(element) {
    const root = rootOf(element), pin = root && forElement(element, 'size');
    if (!pin) return null;
    const view = root.viewBox.baseVal;
    return { width: pin.box.width * view.width, height: pin.box.height * view.height, matrix: root.getScreenCTM() };
  }
  function translation(element) {
    return virtualTranslations.get(element) || (getComputedStyle(element).translate || 'none').split(/\s+/).map(value => parseFloat(value) || 0);
  }
  function wrap(base) {
    if (!base || wrapped.has(base)) return base;
    pins = clone(base.snapshot().svgPins || pins);
    let applying = false;
    const persist = () => { base.restore({ ...base.snapshot(), svgPins: clone(pins) }); applyPins(); };
    const api = { ...base,
      snapshot: () => ({ ...base.snapshot(), svgPins: clone(pins) }),
      restore(value) { pins = clone(value.svgPins || []); base.restore(value); applyPins(); },
      apply() { if (applying) return; applying = true; try { base.apply(); applyPins(); } finally { applying = false; } },
      svgGeometry: geometry,
      svgTranslation: element => forElement(element, 'position') ? translation(element) : null,
      setSvgScope(element, identity, group, mode, states) {
        const root = rootOf(element);
        if (!root || !identity.sceneContext || !sceneList().length || !['position', 'size'].includes(group)) return false;
        const rootSelector = identity.selector.replace(/\s+\[data-node=.*$/, '');
        const mapping = describe(element, rootSelector, mode, states);
        const box = boxOf(element), device = currentViewport(base);
        pins = pins.filter(pin => !(pin.group === group && pin.rootSelector === rootSelector && pin.viewport === device && pin.nodes.some(node => mapping.nodes.includes(node))));
        if (mode !== 'original') pins.push({ ...mapping, group, viewport: device, scope: { mode, states: mode === 'all' ? [] : [...states] },
          ownerSelector: identity.sceneContext.ownerSelector, attribute: identity.sceneContext.attribute, box });
        base.setPreference(identity.selector, { mode, states }, group, identity.sceneContext?.value || '');
        persist(); return true;
      },
      preference(target, group, state) {
        let element; try { element = document.querySelector(target); } catch {}
        const pin = element && forElement(element, group);
        return pin ? clone(pin.scope) : base.preference(target, group, state);
      },
      writeMany(identity, styles) {
        let element; try { element = document.querySelector(identity.selector); } catch {}
        const rest = { ...styles };
        let changed = false;
        const position = element && forElement(element, 'position'), size = element && forElement(element, 'size');
        if (position && typeof styles.translate === 'string' && /^-?[\d.]+px\s+-?[\d.]+px$/.test(styles.translate)) {
          const before = translation(element), after = styles.translate.split(/\s+/).map(parseFloat), matrix = element.parentElement.getScreenCTM();
          const bounds = element.ownerSVGElement.getBoundingClientRect(), dx = after[0] - (before[0] || 0), dy = after[1] - (before[1] || 0);
          position.box.x += (matrix.a * dx + matrix.c * dy) / bounds.width;
          position.box.y += (matrix.b * dx + matrix.d * dy) / bounds.height;
          virtualTranslations.set(element, after); delete rest.translate; changed = true;
        }
        if (size) for (const name of ['width', 'height']) if (/^\d+(?:\.\d+)?px$/.test(styles[name] || '')) {
          size.box[name] = parseFloat(styles[name]) / element.ownerSVGElement.viewBox.baseVal[name];
          delete rest[name]; changed = true;
        }
        const updated = changed ? clone(pins) : null;
        if (Object.keys(rest).length) base.writeMany(identity, rest);
        if (updated) pins = updated;
        if (changed) persist();
      },
      write(identity, property, value) { api.writeMany(identity, { [property]: value }); },
    };
    latest = api; wrapped.add(api); window.__editorLayoutRuntime = api; applyPins(); return api;
  }
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; applyPins(); }); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  window.addEventListener('resize', schedule);
  window.__editorSvgSceneLayout = { wrap };
  return wrap(window.__editorLayoutRuntime);
}

module.exports = { installSvgSceneLayout };
