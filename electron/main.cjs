const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'editor-project',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const projects = new Map();

const previewBridgeScript = String.raw`<script>
(() => {
  const editorSource = 'theme-unit-editor';
  let selected = null;
  let drag = null;
  let autoId = 0;
  let editingEnabled = true;

  function editableElement(target) {
    if (!(target instanceof Element)) return null;
    // Interactive controls must win over a previously marked parent. Vue/React
    // pages often put every control inside one dynamic section; if the section
    // was selected first, the old rule kept returning that section forever.
    // Resolve the actual control before falling back to a marked container.
    const interactive = target.closest('button, a, input, textarea, select, video, audio, [role="button"]');
    const marked = target.closest('[data-editor-id]');
    const candidate = interactive || target.closest('img') || marked || target.closest('body *');
    if (!candidate || ['SCRIPT', 'STYLE', 'HTML', 'HEAD', 'BODY'].includes(candidate.tagName)) return null;
    if (!candidate.dataset.editorId) {
      autoId += 1;
      candidate.dataset.editorId = 'auto-' + autoId;
      candidate.dataset.editorAuto = 'true';
    }
    return candidate;
  }

  function send(type, payload) {
    window.parent.postMessage({ source: editorSource, type, ...payload }, '*');
  }

  function reportReady() {
    const pagePath = decodeURIComponent(window.location.pathname.replace(/^\/+/, '')) || 'index.html';
    send('ready', { pagePath });
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      const index = Array.prototype.indexOf.call(parent.children, current);
      parts.unshift(current.tagName.toLowerCase() + ':' + index);
      current = parent;
    }
    return parts.join('/');
  }

  function cssPath(element) {
    const parts = [];
    let current = element;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      let segment = current.tagName.toLowerCase();
      if (current.id) segment += '#' + CSS.escape(current.id);
      const classes = Array.from(current.classList || []).filter(Boolean).slice(0, 3);
      if (classes.length) segment += classes.map((name) => '.' + CSS.escape(name)).join('');
      const index = Array.prototype.indexOf.call(parent.children, current) + 1;
      segment += ':nth-child(' + index + ')';
      parts.unshift(segment);
      current = parent;
    }
    return parts.join(' > ');
  }

  function transformOffset(transform) {
    const value = String(transform || '');
    const matrix = value.match(/^matrix\(([^)]+)\)$/);
    if (matrix) {
      const parts = matrix[1].split(',').map((part) => Number(part.trim()));
      if (parts.length === 6 && parts.every(Number.isFinite)) return { x: parts[4], y: parts[5] };
    }
    const matrix3d = value.match(/^matrix3d\(([^)]+)\)$/);
    if (matrix3d) {
      const parts = matrix3d[1].split(',').map((part) => Number(part.trim()));
      if (parts.length === 16 && parts.every(Number.isFinite)) return { x: parts[12], y: parts[13] };
    }
    const translate = value.match(/translate(?:3d)?\(\s*(-?[\d.]+)px\s*,?\s*(-?[\d.]+)?px?/i);
    return translate ? { x: Number(translate[1]) || 0, y: Number(translate[2]) || 0 } : { x: 0, y: 0 };
  }

  function select(element) {
    if (selected && selected !== element) selected.style.outline = selected.dataset.editorPreviousOutline || '';
    if (!element) { selected = null; return; }
    if (!element.dataset.editorPreviousOutline) element.dataset.editorPreviousOutline = element.style.outline || '';
    element.style.outline = '2px solid #3867d6';
    element.style.outlineOffset = '2px';
    selected = element;
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    send('selected', {
      id: element.dataset.editorId,
      auto: element.dataset.editorAuto === 'true',
      tag: element.tagName.toLowerCase(),
      path: elementPath(element),
      tagIndex: Array.from(document.querySelectorAll(element.tagName.toLowerCase())).indexOf(element),
      selector: cssPath(element),
      text: (element.textContent || '').trim().slice(0, 1000),
      className: element.getAttribute('class') || '',
      outerHTML: element.outerHTML.slice(0, 2000),
      src: element instanceof HTMLImageElement ? element.getAttribute('src') || '' : '',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: {
        fontSize: styles.fontSize,
        color: styles.color,
        width: styles.width,
        height: styles.height,
        margin: styles.margin,
        padding: styles.padding,
        backgroundImage: styles.backgroundImage,
        transform: element.style.transform || '',
      },
      sourceType: element.dataset.editorAuto === 'true' ? 'dynamic' : 'html',
    });
  }

  document.addEventListener('pointerdown', (event) => {
    if (!editingEnabled) return;
    if (event.button !== 0) return;
    const element = editableElement(event.target);
    if (!element) return;
    select(element);
    const inlineTransform = element.style.transform || '';
    const computedTransform = getComputedStyle(element).transform;
    const offset = transformOffset(computedTransform);
    drag = {
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      beforeTransform: inlineTransform || (computedTransform !== 'none' ? computedTransform : ''),
      baseX: offset.x,
      baseY: offset.y,
      moved: false,
    };
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = Math.round(event.clientX - drag.startX);
    const deltaY = Math.round(event.clientY - drag.startY);
    if (Math.abs(deltaX) + Math.abs(deltaY) < 2) return;
    drag.moved = true;
    // Use one editor-owned translation instead of appending a new transform on
    // every drag. The important priority also lets us replace older saved
    // dynamic rules that used !important.
    const nextTransform = 'translate(' + Math.round(drag.baseX + deltaX) + 'px, ' + Math.round(drag.baseY + deltaY) + 'px)';
    drag.element.style.setProperty('transform', nextTransform, 'important');
    select(drag.element);
    event.preventDefault();
  }, true);

  document.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const finished = drag;
    drag = null;
    if (finished.moved) {
      send('changed', {
        id: finished.element.dataset.editorId,
        property: 'transform',
        before: finished.beforeTransform,
        after: finished.element.style.getPropertyValue('transform'),
      });
    }
  }, true);

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== editorSource) return;
    if (event.data.type === 'set-mode') {
      editingEnabled = event.data.mode === 'edit';
      if (!editingEnabled && selected) selected.style.outline = selected.dataset.editorPreviousOutline || '';
      return;
    }
    const element = document.querySelector('[data-editor-id="' + CSS.escape(event.data.id) + '"]');
    if (!element) return;
    if (event.data.type === 'apply-text') {
      element.textContent = event.data.value || '';
      select(element);
      return;
    }
    if (event.data.type === 'apply-attribute') {
      if (['src', 'poster'].includes(event.data.name)) element.setAttribute(event.data.name, event.data.value || '');
      select(element);
      return;
    }
    if (event.data.type !== 'apply-style') return;
    const allowedProperties = ['fontSize', 'color', 'width', 'height', 'margin', 'padding', 'backgroundImage', 'transform'];
    if (!allowedProperties.includes(event.data.property)) return;
    element.style.setProperty(event.data.property, event.data.value || '', event.data.property === 'transform' ? 'important' : '');
    select(element);
  });
  window.addEventListener('load', reportReady);
  window.addEventListener('pageshow', reportReady);
  reportReady();
})();
</script>`;

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
  }[extension] || 'application/octet-stream';
}

function resolveProjectFile(rootPath, requestedPath) {
  const root = path.resolve(rootPath);
  const cleanPath = decodeURIComponent(requestedPath).replace(/^[/\\]+/, '');
  const candidate = path.resolve(root, cleanPath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function projectUrl(projectId, relativePath) {
  const encodedPath = relativePath.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/');
  return `editor-project://${projectId}/${encodedPath}`;
}

function snapshotDirectory(projectId) {
  return path.join(app.getPath('userData'), 'snapshots', projectId);
}

function snapshotFileName(pagePath) {
  return Buffer.from(pagePath, 'utf8').toString('base64url');
}

function snapshotPagePath(fileName) {
  const encoded = fileName.replace(/\.html$/i, '').split('-').slice(1).join('-');
  if (!encoded) return 'index.html';
  if (encoded === 'index') return 'index.html';
  try { return Buffer.from(encoded, 'base64url').toString('utf8') || 'index.html'; } catch { return 'index.html'; }
}

async function createSnapshot(projectId, entryPath, pagePath) {
  const directory = snapshotDirectory(projectId);
  await fs.mkdir(directory, { recursive: true });
  const timestamp = Date.now();
  const snapshotPath = path.join(directory, `${timestamp}-${snapshotFileName(pagePath)}.html`);
  await fs.copyFile(entryPath, snapshotPath);
  return snapshotPath;
}

async function readProjectSettings(rootPath) {
  try {
    const settings = JSON.parse(await fs.readFile(path.join(rootPath, '.editor-settings.json'), 'utf8'));
    return settings && typeof settings === 'object' ? settings : {};
  } catch { return {}; }
}

async function findHtmlPages(rootPath, currentPath = '') {
  const directory = path.join(rootPath, currentPath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const pages = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
    const relativePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) pages.push(...await findHtmlPages(rootPath, relativePath));
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) pages.push(relativePath.replaceAll(path.sep, '/'));
  }
  return pages.sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSourceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasElementMarker(html, id) {
  return new RegExp(`data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`, 'i').test(html);
}

function updateElementText(html, id, text) {
  const marker = `data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`;
  const elementPattern = new RegExp(`(<([a-zA-Z][\\w:-]*)\\b[^>]*${marker}[^>]*>)[\\s\\S]*?(</\\2\\s*>)`, 'i');
  return html.replace(elementPattern, (_match, openingTag, _tagName, closingTag) => `${openingTag}${text}${closingTag}`);
}

function responsiveMedia(viewport) {
  return {
    tablet: '(min-width: 901px) and (max-width: 1200px)',
    mobilePortrait: '(max-width: 500px)',
    mobileLandscape: '(min-width: 501px) and (max-width: 900px)',
  }[viewport] || '';
}

function updateResponsiveStyles(html, id, styles, viewport) {
  const media = responsiveMedia(viewport);
  if (!media) return html;
  const names = { fontSize: 'font-size', color: 'color', width: 'width', height: 'height', margin: 'margin', padding: 'padding', backgroundImage: 'background-image', transform: 'transform' };
  const styleText = Object.entries(styles || {})
    .filter(([name, value]) => names[name] && value !== undefined && String(value) !== '')
    .map(([name, value]) => `${names[name]}: ${String(value).replace(/<\/style/gi, '<\\/style')};`)
    .join(' ');
  if (!styleText) return html;
  const safeId = String(id).replace(/(["\\])/g, '\\$1');
  const styleKey = `${viewport}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const styleMarker = `data-editor-responsive="${escapeRegExp(styleKey)}"`;
  const block = `<style data-editor-responsive="${styleKey}">@media ${media} { [data-editor-id="${safeId}"] { ${styleText} } }</style>`;
  const existingPattern = new RegExp(`<style\\b[^>]*${styleMarker}[^>]*>[\\s\\S]*?</style>`, 'i');
  if (existingPattern.test(html)) return html.replace(existingPattern, block);
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}</body>`);
  return `${html}${block}`;
}

function updateElementStyles(html, id, styles, viewport = 'desktop') {
  if (viewport !== 'desktop') return updateResponsiveStyles(html, id, styles, viewport);
  const marker = `data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`;
  const openingPattern = new RegExp(`<([a-zA-Z][\\w:-]*)\\b[^>]*${marker}[^>]*>`, 'i');
  const updated = html.replace(openingPattern, (openingTag) => {
    const styleValues = new Map();
    const styleMatch = openingTag.match(/\bstyle\s*=\s*(["'])(.*?)\1/i);
    if (styleMatch) {
      styleMatch[2].split(';').forEach((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator > 0) styleValues.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
      });
    }

    const names = {
      fontSize: 'font-size',
      color: 'color',
      width: 'width',
      height: 'height',
      margin: 'margin',
      padding: 'padding',
      backgroundImage: 'background-image',
      transform: 'transform',
    };
    Object.entries(styles || {}).forEach(([name, value]) => {
      if (value !== undefined && names[name]) styleValues.set(names[name], String(value));
    });

    const styleText = Array.from(styleValues.entries()).map(([name, value]) => `${name}: ${value}`).join('; ');
    if (styleMatch) return openingTag.replace(styleMatch[0], `style="${styleText}"`);
    return openingTag.replace(/>$/, ` style="${styleText}">`);
  });
  return updated;
}

function updateElementAttributes(html, id, attributes) {
  const marker = `data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`;
  const openingPattern = new RegExp(`<([a-zA-Z][\\w:-]*)\\b[^>]*${marker}[^>]*>`, 'i');
  return html.replace(openingPattern, (openingTag) => {
    let updated = openingTag;
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (!['src', 'poster'].includes(name) || typeof value !== 'string') return;
      const attributePattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
      const safeValue = value.replace(/"/g, '&quot;');
      if (attributePattern.test(updated)) updated = updated.replace(attributePattern, `${name}="${safeValue}"`);
      else updated = updated.replace(/>$/, ` ${name}="${safeValue}">`);
    });
    return updated;
  });
}

function findHtmlTagEnd(html, start) {
  let quote = '';
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '>') return index;
  }
  return -1;
}

function scanHtmlElements(html) {
  const elements = [];
  const stack = [];
  const roots = { count: 0 };
  const tagCounts = new Map();
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let position = 0;
  while (position < html.length) {
    const start = html.indexOf('<', position);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const commentEnd = html.indexOf('-->', start + 4);
      position = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    const end = findHtmlTagEnd(html, start + 1);
    if (end < 0) break;
    const token = html.slice(start, end + 1);
    const closing = /^<\/\s*([a-zA-Z][\w:-]*)/.exec(token);
    if (closing) {
      const name = closing[1].toLowerCase();
      let record = stack.pop();
      while (record && record.tag !== name) record = stack.pop();
      if (record) { record.end = end + 1; record.closeStart = start; }
      position = end + 1;
      continue;
    }
    const opening = /^<\s*([a-zA-Z][\w:-]*)/.exec(token);
    if (!opening || /^<!|^<\?/.test(token)) { position = end + 1; continue; }
    const tag = opening[1].toLowerCase();
    const tagIndex = tagCounts.get(tag) || 0;
    tagCounts.set(tag, tagIndex + 1);
    const parent = stack[stack.length - 1];
    const index = parent ? parent.childCount++ : roots.count++;
    const pathValue = parent ? `${parent.path}/${tag}:${index}` : `${tag}:${index}`;
    const record = { tag, tagIndex, path: parent?.tag === 'body' ? `${tag}:${index}` : pathValue, start, openEnd: end + 1, closeStart: end + 1, end: end + 1, openingTag: token, childCount: 0 };
    elements.push(record);
    const selfClosing = /\/\s*>$/.test(token) || voidTags.has(tag);
    if (!selfClosing) stack.push(record);
    position = end + 1;
  }
  return elements;
}

function markElementByHint(html, payload) {
  const tag = String(payload.tag || '').replace(/[^a-zA-Z0-9:-]/g, '').toLowerCase();
  if (!tag) return html;
  const scanned = scanHtmlElements(html);
  const wantedPath = String(payload.path || '');
  let candidates = scanned.filter((item) => item.tag === tag && !/\bdata-editor-id\s*=/.test(item.openingTag));
  const pathCandidates = wantedPath ? candidates.filter((item) => item.path === wantedPath) : [];
  if (pathCandidates.length === 1) candidates = pathCandidates;
  else if (Number.isInteger(payload.tagIndex)) {
    const indexCandidates = candidates.filter((item) => item.tagIndex === payload.tagIndex);
    if (indexCandidates.length === 1) candidates = indexCandidates;
  }
  const wantedText = normalizeSourceText(payload.text);
  const wantedClass = normalizeSourceText(payload.className);
  const sourceMatch = String(payload.outerHTML || '').match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
  const wantedSource = String(payload.src || sourceMatch?.[2] || '').trim();
  if (candidates.length !== 1 && wantedText) candidates = candidates.filter((item) => normalizeSourceText(html.slice(item.openEnd, item.closeStart).replace(/<[^>]*>/g, ' ')).includes(wantedText));
  if (candidates.length !== 1 && wantedClass) candidates = candidates.filter((item) => new RegExp(`\\bclass\\s*=\\s*["'][^"']*${escapeRegExp(wantedClass)}[^"']*["']`, 'i').test(item.openingTag));
  if (candidates.length !== 1 && wantedSource) candidates = candidates.filter((item) => new RegExp(`\\bsrc\\s*=\\s*["']${escapeRegExp(wantedSource)}["']`, 'i').test(item.openingTag));
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const nextOpeningTag = candidate.openingTag.replace(/>$/, ` data-editor-id="${payload.id}">`);
    return html.slice(0, candidate.start) + nextOpeningTag + html.slice(candidate.openEnd);
  }
  return html;
}

function upsertDynamicOverride(html, payload) {
  const selector = String(payload.selector || '').trim().replace(/[{};]/g, '');
  if (!selector) return html;
  const names = { fontSize: 'font-size', color: 'color', width: 'width', height: 'height', margin: 'margin', padding: 'padding', transform: 'transform' };
  const declarations = Object.entries(payload.styles || {})
    .filter(([name, value]) => names[name] && value !== undefined && String(value) !== '')
    .map(([name, value]) => `${names[name]}: ${String(value).replace(/<\/style/gi, '<\\/style')}${name === 'transform' ? '' : ' !important'};`)
    .join(' ');
  if (!declarations) return html;
  const safeKey = `dynamic-${String(payload.id || 'element')}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const media = responsiveMedia(payload.viewport || 'desktop');
  const rule = media ? `@media ${media} { ${selector} { ${declarations} } }` : `${selector} { ${declarations} }`;
  const block = `<style data-editor-dynamic="${safeKey}">${rule}</style>`;
  const existing = new RegExp(`<style\\b[^>]*data-editor-dynamic="${escapeRegExp(safeKey)}"[^>]*>[\\s\\S]*?</style>`, 'i');
  let cleaned = html.replace(existing, '');
  // Older builds used an auto id as the block key. If the same dynamic
  // control receives a different auto id after reload, remove its old rule by
  // selector too, otherwise several transform rules accumulate forever.
  const selectorRule = new RegExp(`<style\\b[^>]*data-editor-dynamic="[^"]+"[^>]*>[\\s\\S]*?${escapeRegExp(selector)}[\\s\\S]*?<\\/style>`, 'gi');
  cleaned = cleaned.replace(selectorRule, '');
  if (/<\/head>/i.test(cleaned)) return cleaned.replace(/<\/head>/i, `${block}</head>`);
  if (/<\/body>/i.test(cleaned)) return cleaned.replace(/<\/body>/i, `${block}</body>`);
  return `${cleaned}${block}`;
}

function upsertDynamicContentOverride(html, payload) {
  const selector = String(payload.selector || '').trim().replace(/[{};]/g, '');
  if (!selector) return html;
  const attributes = payload.attributes || {};
  const text = typeof payload.text === 'string' ? payload.text : '';
  const src = typeof attributes.src === 'string' ? attributes.src : '';
  if (!text && !src) return html;
  const safeKey = `dynamic-content-${String(payload.id || 'element')}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const config = JSON.stringify({ selector, text, src }).replace(/<\/script/gi, '<\\/script');
  const block = `<script data-editor-dynamic-content="${safeKey}">(()=>{const c=${config};const apply=()=>{document.querySelectorAll(c.selector).forEach((e)=>{if(c.text&&e.textContent!==c.text)e.textContent=c.text;if(c.src&&e.tagName==='IMG'&&e.getAttribute('src')!==c.src)e.setAttribute('src',c.src);});};new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',apply);setTimeout(apply,0);})();</script>`;
  const existing = new RegExp(`<script\\b[^>]*data-editor-dynamic-content="${escapeRegExp(safeKey)}"[^>]*>[\\s\\S]*?</script>`, 'i');
  if (existing.test(html)) return html.replace(existing, block);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}</body>`);
  return `${html}${block}`;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDevelopment) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择主题单元项目',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: '尚未选择项目' };
  }

  const rootPath = path.resolve(result.filePaths[0]);
  const entryPath = path.join(rootPath, 'index.html');

  try {
    const entryStat = await fs.stat(entryPath);
    if (!entryStat.isFile()) throw new Error('index.html 不是文件');
  } catch {
    return { ok: false, error: '项目根目录中没有找到 index.html' };
  }

  const projectId = crypto.randomUUID();
  projects.set(projectId, rootPath);
  const pagePaths = await findHtmlPages(rootPath);
  const settings = await readProjectSettings(rootPath);

  return {
    ok: true,
    id: projectId,
    name: path.basename(rootPath),
    rootPath,
    settings,
    entryUrl: projectUrl(projectId, 'index.html'),
    pages: pagePaths.map((pagePath) => ({ path: pagePath, url: projectUrl(projectId, pagePath) })),
  };
});

ipcMain.handle('project:save-element', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.id !== 'string') {
    return { ok: false, error: '保存参数无效' };
  }

  const rootPath = projects.get(payload.projectId);
  if (!rootPath) return { ok: false, error: '项目会话已失效，请重新打开项目' };

  const entryPath = resolveProjectFile(rootPath, payload.pagePath || 'index.html');
  if (!entryPath || path.extname(entryPath).toLowerCase() !== '.html') return { ok: false, error: '当前页面路径无效' };
  try {
    const original = await fs.readFile(entryPath, 'utf8');
    let updated = original;
    let dynamicOverride = false;
    const isDynamicElement = payload.auto === true || payload.sourceType === 'dynamic';
    if (isDynamicElement && !hasElementMarker(updated, payload.id)) {
      updated = markElementByHint(updated, payload);
      if (updated === original) {
        let withOverride = upsertDynamicOverride(updated, payload);
        withOverride = upsertDynamicContentOverride(withOverride, payload);
        if (withOverride === updated) return { ok: false, error: '这个元素由网页脚本动态生成，当前没有可保存的定位信息。' };
        updated = withOverride;
        dynamicOverride = true;
      }
    }
    if (!dynamicOverride) {
      if (typeof payload.text === 'string') updated = updateElementText(updated, payload.id, payload.text);
      updated = updateElementStyles(updated, payload.id, payload.styles || {}, payload.viewport || 'desktop');
      updated = updateElementAttributes(updated, payload.id, payload.attributes || {});
    }
    if (updated === original) return { ok: false, error: '没有找到可保存的元素修改' };

    await createSnapshot(payload.projectId, entryPath, payload.pagePath || 'index.html');
    await fs.writeFile(entryPath, updated, 'utf8');
    return { ok: true };
  } catch {
    return { ok: false, error: '保存失败，原文件未完成写回' };
  }
});

ipcMain.handle('project:mark-element', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.pagePath !== 'string' || typeof payload.id !== 'string') {
    return { ok: false, error: '标记参数无效' };
  }
  const rootPath = projects.get(payload.projectId);
  const entryPath = rootPath && resolveProjectFile(rootPath, payload.pagePath);
  if (!entryPath || path.extname(entryPath).toLowerCase() !== '.html') return { ok: false, error: '当前页面路径无效' };
  try {
    const original = await fs.readFile(entryPath, 'utf8');
    let updated = markElementByHint(original, payload);
    if (updated === original) return { ok: false, error: '没有找到唯一的当前元素，请先为它添加文字或标识' };
    updated = updateElementText(updated, payload.id, payload.text || '');
    updated = updateElementStyles(updated, payload.id, payload.styles || {}, payload.viewport || 'desktop');
    updated = updateElementAttributes(updated, payload.id, payload.attributes || {});
    await createSnapshot(payload.projectId, entryPath, payload.pagePath);
    await fs.writeFile(entryPath, updated, 'utf8');
    return { ok: true };
  } catch {
    return { ok: false, error: '标记保存失败，原文件未完成写回' };
  }
});

ipcMain.handle('project:list-versions', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string') return { ok: false, error: '版本参数无效' };
  if (!projects.has(payload.projectId)) return { ok: false, error: '项目会话已失效，请重新打开项目' };
  try {
    const directory = snapshotDirectory(payload.projectId);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const versions = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.html$/i.test(entry.name)) continue;
      const timestamp = Number(entry.name.split('-')[0]);
      if (!Number.isFinite(timestamp)) continue;
      const pagePath = snapshotPagePath(entry.name);
      if (payload.pagePath && pagePath !== payload.pagePath) continue;
      versions.push({ id: entry.name, pagePath, createdAt: new Date(timestamp).toISOString() });
    }
    versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, versions };
  } catch {
    return { ok: true, versions: [] };
  }
});

ipcMain.handle('project:restore-version', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.pagePath !== 'string' || typeof payload.versionId !== 'string') {
    return { ok: false, error: '恢复参数无效' };
  }
  const rootPath = projects.get(payload.projectId);
  const entryPath = rootPath && resolveProjectFile(rootPath, payload.pagePath);
  const directory = snapshotDirectory(payload.projectId);
  const snapshotPath = path.resolve(directory, path.basename(payload.versionId));
  if (!entryPath || !snapshotPath.startsWith(`${path.resolve(directory)}${path.sep}`) || path.extname(entryPath).toLowerCase() !== '.html') {
    return { ok: false, error: '恢复路径无效' };
  }
  try {
    const snapshotStat = await fs.stat(snapshotPath);
    if (!snapshotStat.isFile() || snapshotPagePath(path.basename(snapshotPath)) !== payload.pagePath) return { ok: false, error: '版本与当前页面不匹配' };
    await createSnapshot(payload.projectId, entryPath, payload.pagePath);
    await fs.copyFile(snapshotPath, entryPath);
    return { ok: true };
  } catch {
    return { ok: false, error: '版本恢复失败，当前文件未修改' };
  }
});

ipcMain.handle('project:save-settings', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string' || !['mobilePortrait', 'mobileLandscape'].includes(payload.mobileOrientation)) {
    return { ok: false, error: '设置参数无效' };
  }
  const rootPath = projects.get(payload.projectId);
  if (!rootPath) return { ok: false, error: '项目会话已失效，请重新打开项目' };
  try {
    await fs.writeFile(path.join(rootPath, '.editor-settings.json'), JSON.stringify({ mobileOrientation: payload.mobileOrientation }, null, 2), 'utf8');
    return { ok: true };
  } catch { return { ok: false, error: '设备方向保存失败' }; }
});

ipcMain.handle('asset:choose', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要替换的图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('asset:copy', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.pagePath !== 'string' || typeof payload.sourcePath !== 'string') return { ok: false, error: '素材参数无效' };
  const rootPath = projects.get(payload.projectId);
  const pagePath = rootPath && resolveProjectFile(rootPath, payload.pagePath);
  if (!rootPath || !pagePath) return { ok: false, error: '项目会话已失效' };
  try {
    const sourceStat = await fs.stat(payload.sourcePath);
    if (!sourceStat.isFile()) return { ok: false, error: '素材文件无效' };
    const extension = path.extname(payload.sourcePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) return { ok: false, error: '暂不支持这种素材格式' };
    const destinationDirectory = path.join(rootPath, 'assets', 'editor');
    await fs.mkdir(destinationDirectory, { recursive: true });
    const safeBaseName = path.basename(payload.sourcePath, extension).replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
    const destinationPath = path.join(destinationDirectory, `${safeBaseName}-${Date.now()}${extension}`);
    await fs.copyFile(payload.sourcePath, destinationPath);
    const relativePath = path.relative(path.dirname(pagePath), destinationPath).replaceAll(path.sep, '/');
    return { ok: true, relativePath: relativePath.startsWith('.') ? relativePath : `./${relativePath}` };
  } catch {
    return { ok: false, error: '素材复制失败' };
  }
});

app.whenReady().then(() => {
  protocol.handle('editor-project', async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const rootPath = projects.get(requestUrl.hostname);
      if (!rootPath) return new Response('Project not found', { status: 404 });

      const filePath = resolveProjectFile(rootPath, requestUrl.pathname);
      if (!filePath) return new Response('Forbidden', { status: 403 });

      const fileStat = await fs.stat(filePath);
      if (!fileStat.isFile()) return new Response('Not found', { status: 404 });

      if (path.extname(filePath).toLowerCase() === '.html') {
        let html = await fs.readFile(filePath, 'utf8');
        const injectedHtml = html.replace(/<\/body>/i, `${previewBridgeScript}</body>`);
        html = injectedHtml === html ? `${html}${previewBridgeScript}` : injectedHtml;
        return new Response(html, { status: 200, headers: { 'content-type': contentType(filePath) } });
      }

      const response = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(response.headers);
      headers.set('content-type', contentType(filePath));
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
