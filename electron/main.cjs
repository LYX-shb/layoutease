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
  let targetPicking = false;

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
    const nestedImage = element.tagName === 'IMG' ? null : element.querySelector('img');
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
      nestedImage: nestedImage ? {
        selector: cssPath(nestedImage),
        src: nestedImage.getAttribute('src') || '',
        index: Array.from(element.querySelectorAll('img')).indexOf(nestedImage),
      } : null,
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
    if (targetPicking) {
      targetPicking = false;
      const previousOutline = element.style.outline || '';
      const previousOutlineOffset = element.style.outlineOffset || '';
      element.style.outline = '2px dashed #12a66a';
      element.style.outlineOffset = '2px';
      setTimeout(() => {
        element.style.outline = previousOutline;
        element.style.outlineOffset = previousOutlineOffset;
      }, 900);
      send('target-selected', {
        selector: cssPath(element),
        tag: element.tagName.toLowerCase(),
      });
      event.preventDefault();
      return;
    }
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
      targetPicking = false;
      if (!editingEnabled && selected) selected.style.outline = selected.dataset.editorPreviousOutline || '';
      if (editingEnabled && selected) {
        selected.style.outline = '2px solid #3867d6';
        selected.style.outlineOffset = '2px';
      }
      return;
    }
    if (event.data.type === 'set-interaction-target') {
      targetPicking = Boolean(event.data.enabled);
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
    if (event.data.type === 'apply-nested-attribute') {
      const nested = typeof event.data.selector === 'string' ? document.querySelector(event.data.selector) : null;
      if (nested && element.contains(nested) && ['src', 'poster'].includes(event.data.name)) {
        nested.setAttribute(event.data.name, event.data.value || '');
        select(element);
      }
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

  document.addEventListener('click', (event) => {
    if (!editingEnabled || targetPicking) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
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

async function createProjectSnapshot(projectId, rootPath, pagePath, reason = '编辑保存') {
  const directory = snapshotDirectory(projectId);
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const snapshotPath = path.join(directory, id);
  const filesPath = path.join(snapshotPath, 'files');
  await fs.mkdir(filesPath, { recursive: true });
  await fs.cp(rootPath, filesPath, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(rootPath, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return !parts.includes('node_modules') && !parts.includes('.git') && !parts.includes('.editor-snapshots');
    },
  });
  await fs.writeFile(path.join(snapshotPath, 'meta.json'), JSON.stringify({
    id,
    pagePath,
    reason,
    createdAt: new Date(Number(id.split('-')[0])).toISOString(),
  }, null, 2), 'utf8');
  return snapshotPath;
}

function isIgnoredProjectRelative(relative) {
  if (!relative) return false;
  const parts = relative.split(path.sep);
  return parts.includes('node_modules') || parts.includes('.git') || parts.includes('.editor-snapshots');
}

async function removeStaleProjectFiles(snapshotFilesPath, rootPath, relative = '') {
  const sourceEntries = new Set(await fs.readdir(path.join(snapshotFilesPath, relative), { withFileTypes: true }).then((entries) => entries.map((entry) => entry.name)));
  const targetDirectory = path.join(rootPath, relative);
  const targetEntries = await fs.readdir(targetDirectory, { withFileTypes: true });
  for (const entry of targetEntries) {
    const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (isIgnoredProjectRelative(entryRelative) || sourceEntries.has(entry.name) === false) {
      if (sourceEntries.has(entry.name) === false && !isIgnoredProjectRelative(entryRelative)) await fs.rm(path.join(targetDirectory, entry.name), { recursive: true, force: true });
      continue;
    }
    const sourcePath = path.join(snapshotFilesPath, entryRelative);
    if (entry.isDirectory()) {
      const sourceStat = await fs.stat(sourcePath).catch(() => null);
      if (sourceStat?.isDirectory()) await removeStaleProjectFiles(snapshotFilesPath, rootPath, entryRelative);
    }
  }
}

async function restoreProjectSnapshot(filesPath, rootPath) {
  await removeStaleProjectFiles(filesPath, rootPath);
  await fs.cp(filesPath, rootPath, {
    recursive: true,
    force: true,
    filter: (source) => !isIgnoredProjectRelative(path.relative(filesPath, source)),
  });
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

function sanitizeCssValue(value) {
  const text = String(value ?? '').trim();
  if (!text || /[<>{};\r\n]/.test(text)) return '';
  return text;
}

function escapeHtmlText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value) {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function hasElementMarker(html, id) {
  return new RegExp(`data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`, 'i').test(html);
}

function updateElementText(html, id, text) {
  const marker = `data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`;
  const elementPattern = new RegExp(`(<([a-zA-Z][\\w:-]*)\\b[^>]*${marker}[^>]*>)([\\s\\S]*?)(</\\2\\s*>)`, 'i');
  return html.replace(elementPattern, (_match, openingTag, _tagName, innerHTML, closingTag) => {
    const replacement = escapeHtmlText(text);
    let changed = false;
    const preservedChildren = innerHTML.replace(/(^|>)([^<]+)(?=<|$)/g, (part, prefix, content) => {
      if (changed || !String(content).trim()) return part;
      changed = true;
      return `${prefix}${replacement}`;
    });
    return `${openingTag}${changed ? preservedChildren : `${innerHTML}${replacement}`}${closingTag}`;
  });
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
    .map(([name, value]) => [name, sanitizeCssValue(value)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${names[name]}: ${value};`)
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
      const safeValue = sanitizeCssValue(value);
      if (safeValue && names[name]) styleValues.set(names[name], safeValue);
    });

    const styleText = Array.from(styleValues.entries()).map(([name, value]) => `${name}: ${value}`).join('; ');
    if (styleMatch) return openingTag.replace(styleMatch[0], `style="${escapeHtmlAttribute(styleText)}"`);
    return openingTag.replace(/>$/, ` style="${escapeHtmlAttribute(styleText)}">`);
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

function updateNestedImageAttribute(html, id, nestedImage) {
  if (!nestedImage || typeof nestedImage !== 'object') return html;
  const marker = `data-editor-id\\s*=\\s*["']${escapeRegExp(id)}["']`;
  const parentPattern = new RegExp(`(<([a-zA-Z][\\w:-]*)\\b[^>]*${marker}[^>]*>)([\\s\\S]*?)(</\\2\\s*>)`, 'i');
  const wantedIndex = Number.isInteger(nestedImage.index) && nestedImage.index >= 0 ? nestedImage.index : 0;
  return html.replace(parentPattern, (_match, openingTag, _tagName, innerHTML, closingTag) => {
    let imageIndex = 0;
    const updatedInner = innerHTML.replace(/<img\b[^>]*>/gi, (imageTag) => {
      if (imageIndex++ !== wantedIndex) return imageTag;
      const source = typeof nestedImage.src === 'string' ? nestedImage.src : '';
      if (!source) return imageTag;
      const sourcePattern = /\bsrc\s*=\s*(["'])(.*?)\1/i;
      const safeSource = escapeHtmlAttribute(source);
      if (sourcePattern.test(imageTag)) return imageTag.replace(sourcePattern, `src="${safeSource}"`);
      return imageTag.replace(/>$/, ` src="${safeSource}">`);
    });
    return `${openingTag}${updatedInner}${closingTag}`;
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
  const names = { fontSize: 'font-size', color: 'color', width: 'width', height: 'height', margin: 'margin', padding: 'padding', backgroundImage: 'background-image', transform: 'transform' };
  const declarations = Object.entries(payload.styles || {})
    .filter(([name, value]) => names[name] && value !== undefined && String(value) !== '')
    .map(([name, value]) => [name, sanitizeCssValue(value)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${names[name]}: ${value}${name === 'transform' ? '' : ' !important'};`)
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
  const hasText = Object.prototype.hasOwnProperty.call(payload, 'text') && typeof payload.text === 'string';
  const text = hasText ? payload.text : '';
  const src = typeof attributes.src === 'string' ? attributes.src : '';
  const nestedImage = payload.nestedImage && typeof payload.nestedImage === 'object' ? payload.nestedImage : null;
  const nestedSelector = nestedImage && typeof nestedImage.selector === 'string' ? nestedImage.selector : '';
  const nestedSrc = nestedImage && typeof nestedImage.src === 'string' ? nestedImage.src : '';
  if (!hasText && !src && !nestedSelector) return html;
  const safeKey = `dynamic-content-${interactionHash(selector)}`;
  const config = JSON.stringify({ selector, text: hasText ? text : null, src: src || null, nestedSelector: nestedSelector || null, nestedSrc: nestedSrc || null }).replace(/<\/script/gi, '<\\/script');
  const block = `<script data-editor-dynamic-content="${safeKey}">(()=>{const c=${config};const apply=()=>{document.querySelectorAll(c.selector).forEach((e)=>{if(c.text!==null){if(e.childElementCount===0){if(e.textContent!==c.text)e.textContent=c.text}else{const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node;let changed=false;while((node=walker.nextNode())){if(String(node.textContent||'').trim()){if(node.textContent!==c.text)node.textContent=c.text;changed=true;break}}if(!changed&&c.text)e.appendChild(document.createTextNode(c.text))}}if(c.src&&e.tagName==='IMG'&&e.getAttribute('src')!==c.src)e.setAttribute('src',c.src);if(c.nestedSelector&&c.nestedSrc){const image=e.querySelector(c.nestedSelector)||document.querySelector(c.nestedSelector);if(image&&e.contains(image)&&image.tagName==='IMG'&&image.getAttribute('src')!==c.nestedSrc)image.setAttribute('src',c.nestedSrc);}});};new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('load',apply);setTimeout(apply,0);})();</script>`;
  const existing = new RegExp(`<script\\b[^>]*data-editor-dynamic-content="${escapeRegExp(safeKey)}"[^>]*>[\\s\\S]*?</script>`, 'i');
  const selectorSignature = `"selector":${JSON.stringify(selector)}`;
  const existingBySelector = new RegExp(`<script\\b[^>]*data-editor-dynamic-content="[^"]+"[^>]*>[\\s\\S]*?${escapeRegExp(selectorSignature)}[\\s\\S]*?</script>`, 'gi');
  const withoutExisting = html.replace(existing, '').replace(existingBySelector, '');
  if (/<\/body>/i.test(withoutExisting)) return withoutExisting.replace(/<\/body>/i, `${block}</body>`);
  return `${withoutExisting}${block}`;
}

function interactionHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function upsertInteractionScript(html, payload) {
  const actions = new Set(['navigate', 'back', 'show', 'hide', 'toggle', 'classToggle', 'play', 'pause']);
  const action = String(payload.action || '').trim();
  if (!actions.has(action)) return html;
  const sourceSelector = String(payload.sourceSelector || '').trim().replace(/[{};]/g, '');
  const targetSelector = String(payload.targetSelector || '').trim().replace(/[{};]/g, '');
  const targetPage = String(payload.targetPage || '').trim().replace(/[<>"']/g, '');
  const className = String(payload.className || '').trim().replace(/[^\w\-\u4e00-\u9fff]/g, '');
  if (!sourceSelector) return html;
  if (['show', 'hide', 'toggle', 'classToggle', 'play', 'pause'].includes(action) && !targetSelector) return html;
  if (action === 'navigate' && !targetPage) return html;
  if (action === 'classToggle' && !className) return html;

  // One source element owns one interaction rule. Changing its action or
  // target replaces the previous rule instead of stacking multiple clicks.
  const key = `interaction-${interactionHash(`${payload.pagePath || ''}|${sourceSelector}`)}`;
  const config = JSON.stringify({ key, sourceSelector, targetSelector, action, targetPage, className }).replace(/<\/script/gi, '<\\/script');
  const block = `<script data-editor-interaction="${key}">(()=>{const c=${config};const show=(e)=>{e.hidden=false;const previous=e.dataset.editorPreviousDisplay;if(previous&&previous!=='none'){e.style.display=previous;return}delete e.dataset.editorPreviousDisplay;e.style.removeProperty('display');if(getComputedStyle(e).display==='none')e.style.display='block'};const hide=(e)=>{const current=e.style.display||'';if(e.dataset.editorPreviousDisplay===undefined)e.dataset.editorPreviousDisplay=current==='none'?'':current;e.hidden=true};const bind=()=>{try{document.querySelectorAll(c.sourceSelector).forEach((source)=>{if(source.dataset.editorInteractionBound===c.key)return;source.dataset.editorInteractionBound=c.key;source.addEventListener('click',()=>{try{if(c.action==='navigate'){window.location.href=c.targetPage;return}if(c.action==='back'){window.history.back();return}const targets=c.targetSelector?Array.from(document.querySelectorAll(c.targetSelector)):[source];if(c.action==='show')targets.forEach(show);if(c.action==='hide')targets.forEach(hide);if(c.action==='toggle')targets.forEach((e)=>e.hidden?show(e):hide(e));if(c.action==='classToggle')targets.forEach((e)=>e.classList.toggle(c.className));if(c.action==='play')targets.forEach((e)=>{if(typeof e.play==='function')void e.play()});if(c.action==='pause')targets.forEach((e)=>{if(typeof e.pause==='function')e.pause()})}catch(error){console.error('[主题单元编辑器] 交互执行失败',error)}})})}catch(error){console.error('[主题单元编辑器] 交互选择器无效',error)}};bind();new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});})();</script>`;
  const existing = new RegExp(`<script\\b[^>]*data-editor-interaction="${escapeRegExp(key)}"[^>]*>[\\s\\S]*?</script>`, 'i');
  const sourceSignature = `"sourceSelector":${JSON.stringify(sourceSelector)}`;
  const existingBySource = new RegExp(`<script\\b[^>]*data-editor-interaction="[^"]+"[^>]*>[\\s\\S]*?${escapeRegExp(sourceSignature)}[\\s\\S]*?</script>`, 'gi');
  const withoutExisting = html.replace(existing, '').replace(existingBySource, '');
  if (/<\/body>/i.test(withoutExisting)) return withoutExisting.replace(/<\/body>/i, `${block}</body>`);
  return `${withoutExisting}${block}`;
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
      updated = updateNestedImageAttribute(updated, payload.id, payload.nestedImage);
    }
    if (updated === original) return { ok: false, error: '没有找到可保存的元素修改' };

    await createProjectSnapshot(payload.projectId, rootPath, payload.pagePath || 'index.html', '元素保存');
    await fs.writeFile(entryPath, updated, 'utf8');
    return { ok: true };
  } catch {
    return { ok: false, error: '保存失败，原文件未完成写回' };
  }
});

ipcMain.handle('project:save-interaction', async (_event, payload) => {
  const actions = new Set(['navigate', 'back', 'show', 'hide', 'toggle', 'classToggle', 'play', 'pause']);
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.pagePath !== 'string' || typeof payload.sourceSelector !== 'string' || !actions.has(payload.action)) {
    return { ok: false, error: '交互参数无效' };
  }
  const rootPath = projects.get(payload.projectId);
  const entryPath = rootPath && resolveProjectFile(rootPath, payload.pagePath);
  if (!entryPath || path.extname(entryPath).toLowerCase() !== '.html') return { ok: false, error: '当前页面路径无效' };
  let interactionPayload = { ...payload };
  if (payload.action === 'navigate') {
    const rawTargetPage = String(payload.targetPage || '').trim();
    if (!rawTargetPage || path.isAbsolute(rawTargetPage) || rawTargetPage.startsWith('/') || rawTargetPage.startsWith('\\') || /^[a-z][a-z\d+.-]*:/i.test(rawTargetPage)) {
      return { ok: false, error: '目标页面必须是项目内的相对 HTML 路径' };
    }
    const targetPath = rootPath && resolveProjectFile(rootPath, rawTargetPage);
    if (!targetPath || path.extname(targetPath).toLowerCase() !== '.html') return { ok: false, error: '目标页面路径无效' };
    try {
      const targetStat = await fs.stat(targetPath);
      if (!targetStat.isFile()) return { ok: false, error: '目标页面不存在' };
    } catch {
      return { ok: false, error: '目标页面不存在' };
    }
    const relativeTarget = path.relative(rootPath, targetPath).replaceAll(path.sep, '/');
    interactionPayload.targetPage = `/${relativeTarget}`;
  }
  if (['show', 'hide', 'toggle', 'classToggle', 'play', 'pause'].includes(payload.action) && typeof payload.targetSelector !== 'string') {
    return { ok: false, error: '请先选择交互目标' };
  }
  if (payload.action === 'classToggle' && !String(payload.className || '').trim()) return { ok: false, error: '请提供要切换的样式类名' };
  try {
    const original = await fs.readFile(entryPath, 'utf8');
    const updated = upsertInteractionScript(original, interactionPayload);
    if (updated === original) return { ok: false, error: '交互配置不完整或未发生变化' };
    await createProjectSnapshot(payload.projectId, rootPath, payload.pagePath, '交互保存');
    await fs.writeFile(entryPath, updated, 'utf8');
    return { ok: true };
  } catch {
    return { ok: false, error: '交互保存失败，原文件未完成写回' };
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
    await createProjectSnapshot(payload.projectId, rootPath, payload.pagePath, '标识保存');
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
      if (entry.isDirectory()) {
        try {
          const metadata = JSON.parse(await fs.readFile(path.join(directory, entry.name, 'meta.json'), 'utf8'));
          const pagePath = typeof metadata.pagePath === 'string' ? metadata.pagePath : 'index.html';
          if (payload.pagePath && pagePath !== payload.pagePath) continue;
          versions.push({ id: entry.name, pagePath, reason: metadata.reason || '项目快照', files: '项目全部文件', createdAt: metadata.createdAt || new Date(Number(entry.name.split('-')[0])).toISOString() });
        } catch {
          continue;
        }
      } else if (entry.isFile() && /\.html$/i.test(entry.name)) {
        const timestamp = Number(entry.name.split('-')[0]);
        if (!Number.isFinite(timestamp)) continue;
        const pagePath = snapshotPagePath(entry.name);
        if (payload.pagePath && pagePath !== payload.pagePath) continue;
        versions.push({ id: entry.name, pagePath, reason: '旧版页面快照', files: '当前 HTML', createdAt: new Date(timestamp).toISOString() });
      }
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
    if (snapshotStat.isDirectory()) {
      const metadata = JSON.parse(await fs.readFile(path.join(snapshotPath, 'meta.json'), 'utf8'));
      const filesPath = path.join(snapshotPath, 'files');
      const filesStat = await fs.stat(filesPath);
      if (!filesStat.isDirectory()) return { ok: false, error: '版本文件不完整' };
      await createProjectSnapshot(payload.projectId, rootPath, payload.pagePath, '恢复前自动备份');
      await restoreProjectSnapshot(filesPath, rootPath);
      return { ok: true, reason: metadata.reason || '项目快照' };
    }
    if (!snapshotStat.isFile() || snapshotPagePath(path.basename(snapshotPath)) !== payload.pagePath) return { ok: false, error: '版本与当前页面不匹配' };
    await createProjectSnapshot(payload.projectId, rootPath, payload.pagePath, '恢复前自动备份');
    await fs.copyFile(snapshotPath, entryPath);
    return { ok: true };
  } catch {
    return { ok: false, error: '版本恢复失败，当前文件未修改' };
  }
});

ipcMain.handle('project:delete-version', async (_event, payload) => {
  if (!payload || typeof payload.projectId !== 'string' || typeof payload.versionId !== 'string') return { ok: false, error: '删除参数无效' };
  if (!projects.has(payload.projectId)) return { ok: false, error: '项目会话已失效，请重新打开项目' };
  const directory = path.resolve(snapshotDirectory(payload.projectId));
  const snapshotPath = path.resolve(directory, path.basename(payload.versionId));
  if (!snapshotPath.startsWith(`${directory}${path.sep}`)) return { ok: false, error: '版本路径无效' };
  try {
    const snapshotStat = await fs.stat(snapshotPath);
    if (!snapshotStat.isDirectory() && !snapshotStat.isFile()) return { ok: false, error: '版本不存在' };
    await fs.rm(snapshotPath, { recursive: true, force: false });
    return { ok: true };
  } catch {
    return { ok: false, error: '版本删除失败' };
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
    await createProjectSnapshot(payload.projectId, rootPath, payload.pagePath, '素材替换前');
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
