const crypto = require('node:crypto');

const devices = new Set(['all', 'desktop', 'tablet', 'phone']);
const kinds = new Set(['src', 'nested', 'background']);

function replacementKey(selector, kind, index) {
  return 'image-replacement-' + crypto.createHash('sha256').update(JSON.stringify([selector, kind, index])).digest('hex').slice(0, 16);
}

// Serialized into saved HTML and the editor preview. Keep this function self-contained.
function installImageReplacementRuntime() {
  if (window.__editorImageReplacementRuntime) return window.__editorImageReplacementRuntime;
  const preview = new Map();
  let configs = null;
  let queued = false;

  const keyOf = item => JSON.stringify([item.selector, item.kind, item.index || 0]);
  const readConfigs = () => {
    if (configs) return configs;
    configs = [];
    for (const script of document.querySelectorAll('script[data-editor-image-replacement]')) {
      try {
        const item = JSON.parse(script.textContent || 'null');
        if (item && typeof item.selector === 'string' && ['src', 'nested', 'background'].includes(item.kind)
          && item.sources && typeof item.sources === 'object') configs.push(item);
      } catch {}
    }
    return configs;
  };
  const isPhone = () => {
    if (typeof window.__editorLayoutRuntime?.isPhone === 'function') return window.__editorLayoutRuntime.isPhone();
    const ua = navigator.userAgent || '';
    if (navigator.userAgentData?.mobile === true || /iPhone|iPod|Android.*Mobile|Windows Phone|HarmonyOS.*Mobile/i.test(ua)) return true;
    const width = window.visualViewport?.width || innerWidth;
    const height = window.visualViewport?.height || innerHeight;
    if (width <= 600) return true;
    const shortScreen = Math.min(screen.width || width, screen.height || height);
    return !/iPad/i.test(ua) && Math.min(shortScreen, width, height) <= 600
      && (/Android|HarmonyOS/i.test(ua) || matchMedia('(pointer: coarse)').matches);
  };
  const currentDevice = () => isPhone() ? 'phone' : innerWidth <= 1200 ? 'tablet' : 'desktop';
  const applyOne = (item, source) => {
    if (!source) return;
    let elements;
    try { elements = document.querySelectorAll(item.selector); } catch { return; }
    for (const element of elements) {
      const target = item.kind === 'nested' ? element.querySelectorAll('img')[item.index || 0] : element;
      if (!target) continue;
      if (item.kind === 'background') {
        const value = 'url(' + JSON.stringify(source) + ')';
        if (target.style.getPropertyValue('background-image') !== value
          || target.style.getPropertyPriority('background-image') !== 'important') {
          target.style.setProperty('background-image', value, 'important');
        }
      } else if (target.tagName === 'IMG' && target.getAttribute('src') !== source) {
        target.setAttribute('src', source);
      }
    }
  };
  const apply = () => {
    const device = currentDevice();
    const seen = new Set();
    for (const item of readConfigs()) {
      const key = keyOf(item);
      seen.add(key);
      const pending = preview.get(key);
      const source = pending || item.sources[device] || item.sources.all;
      applyOne(item, source);
    }
    for (const [key, item] of preview) if (!seen.has(key)) applyOne(item, item.src);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; apply(); });
  };
  const api = {
    preview(item) {
      if (!item || typeof item.selector !== 'string' || !['src', 'nested', 'background'].includes(item.kind)
        || typeof item.src !== 'string' || !item.src) return;
      const normalized = { selector: item.selector, kind: item.kind, index: Number(item.index) || 0, src: item.src };
      preview.set(keyOf(normalized), normalized);
      schedule();
    },
    refresh: schedule,
  };
  window.__editorImageReplacementRuntime = api;
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'],
  });
  window.addEventListener('load', schedule);
  window.addEventListener('pageshow', schedule);
  window.addEventListener('resize', schedule);
  schedule();
  return api;
}

function upsertImageReplacementOverride(html, input) {
  if (!input || typeof input.selector !== 'string' || !input.selector.trim()
    || !kinds.has(input.kind) || !devices.has(input.viewport)
    || typeof input.src !== 'string' || !input.src.trim()) throw new Error('图片替换参数无效');
  const selector = input.selector.trim();
  const kind = input.kind;
  const index = kind === 'nested' && Number.isInteger(input.index) && input.index >= 0 && input.index < 100 ? input.index : 0;
  const src = input.src.trim();
  if (/[<>\r\n]/.test(selector + src) || /^(?:javascript|data|https?):/i.test(src)) throw new Error('图片路径无效');
  const key = replacementKey(selector, kind, index);
  const existing = new RegExp('<script\\b[^>]*\\bdata-editor-image-replacement="' + key + '"[^>]*>([\\s\\S]*?)<\\/script\\s*>', 'i');
  const match = html.match(existing);
  let sources = {};
  if (match) {
    try {
      const previous = JSON.parse(match[1]);
      if (previous?.selector === selector && previous?.kind === kind && previous?.index === index && previous?.sources) {
        sources = { ...previous.sources };
      }
    } catch {}
  }
  if (input.viewport === 'all') sources = { all: src };
  else sources[input.viewport] = src;
  const config = JSON.stringify({ selector, kind, index, sources }).replace(/</g, '\\u003c');
  const data = '<script type="application/json" data-editor-image-replacement="' + key + '">' + config + '</script>';
  let updated = match ? html.replace(existing, data) : html.replace(/<\/body\s*>/i, data + '</body>');
  if (updated === html && !match) updated += data;
  if (!/<script\b[^>]*\bdata-editor-image-runtime(?:\s|=|>)/i.test(updated)) {
    const runtime = '<script data-editor-image-runtime>(' + installImageReplacementRuntime.toString() + ')();</script>';
    const next = updated.replace(/<\/body\s*>/i, runtime + '</body>');
    updated = next === updated ? updated + runtime : next;
  }
  return updated;
}

module.exports = { installImageReplacementRuntime, upsertImageReplacementOverride };
