const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeLayoutConfig, upsertLayoutDocument } = require('./edit-scopes.cjs');

function readConfig(html) {
  const match = html.match(/<script\b[^>]*\bdata-editor-layout-data[^>]*>([\s\S]*?)<\/script\s*>/i);
  return normalizeLayoutConfig(match ? JSON.parse(match[1]) : { version: 1, edits: [], preferences: [] });
}

function attribute(openingTag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = openingTag.match(new RegExp('(?:^|\\s)' + escaped + '\\s*=\\s*(["\'])(.*?)\\1', 'i'));
  return match?.[2] || '';
}

function targetGroupScene(scanned, scene) {
  if (!scene) return null;
  const candidates = scanned.filter(item => ['main', 'body', 'html'].includes(item.tag) && attribute(item.openingTag, scene.attribute));
  if (candidates.length !== 1) return null;
  const owner = candidates[0];
  const id = attribute(owner.openingTag, 'id');
  return { ownerSelector: owner.tag + (id ? '[id=' + JSON.stringify(id) + ']' : ''), attribute: scene.attribute, states: scene.states };
}

function normalizedText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

function localAsset(root, pageFile, source) {
  const clean = String(source || '').split(/[?#]/)[0];
  if (!clean || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(clean)) return '';
  try {
    const absolute = path.resolve(path.dirname(pageFile), decodeURIComponent(clean));
    const relative = path.relative(root, absolute);
    return !relative.startsWith('..') && !path.isAbsolute(relative) ? absolute.toLowerCase() : '';
  } catch { return ''; }
}

function findGroupMember(scanned, html, member, root, sourceFile, targetFile, marker) {
  const tag = String(member.tag || '').toLowerCase();
  let candidates = scanned.filter(item => item.tag === tag);
  const unique = matches => matches.length === 1 ? matches[0] : null;
  const marked = unique(candidates.filter(item => attribute(item.openingTag, 'data-editor-sync-id') === marker));
  if (marked) return marked;
  if (tag === 'img') {
    const asset = localAsset(root, sourceFile, member.src);
    if (asset) {
      const assetMatches = candidates.filter(item => localAsset(root, targetFile, attribute(item.openingTag, 'src')) === asset);
      if (assetMatches.length > 1) {
        if (member.id) {
          const byId = unique(assetMatches.filter(item => attribute(item.openingTag, 'id') === member.id));
          if (byId) return byId;
        }
        const stableData = member.data && typeof member.data === 'object'
          ? Object.entries(member.data).filter(([key]) => /^data-(?:group|index|card|slot|editor-shared-id)$/.test(key)) : [];
        if (stableData.length) {
          const byData = unique(assetMatches.filter(item => stableData.every(([name, value]) => attribute(item.openingTag, name) === value)));
          if (byData) return byData;
        }
        return null;
      }
      if (assetMatches.length === 1) return assetMatches[0];
      candidates = candidates.filter(item => !attribute(item.openingTag, 'src') || localAsset(root, targetFile, attribute(item.openingTag, 'src')) === asset);
    }
  }
  if (member.id) {
    const byId = unique(candidates.filter(item => attribute(item.openingTag, 'id') === member.id));
    if (byId) return byId;
  }
  const data = member.data && typeof member.data === 'object' ? Object.entries(member.data).filter(([key]) => /^data-(?:group|index|card|slot|editor-shared-id)$/.test(key)) : [];
  if (data.length) {
    const byData = unique(candidates.filter(item => data.every(([name, value]) => attribute(item.openingTag, name) === value)));
    if (byData) return byData;
  }
  const wantedText = normalizedText(member.text);
  if (wantedText && wantedText.length <= 300) {
    const byText = unique(candidates.filter(item => normalizedText(html.slice(item.openEnd, item.closeStart)) === wantedText));
    if (byText) return byText;
  }
  const classes = Array.isArray(member.classes) ? member.classes.filter(name => /^[a-zA-Z_][\w-]*$/.test(name)).slice(0, 8) : [];
  if (classes.length) {
    const byClass = unique(candidates.filter(item => {
      const names = new Set(attribute(item.openingTag, 'class').split(/\s+/));
      return classes.every(name => names.has(name));
    }));
    if (byClass) return byClass;
  }
  if (member.path) {
    const byPath = unique(candidates.filter(item => item.path === member.path));
    if (byPath && (!wantedText || tag === 'img' || normalizedText(html.slice(byPath.openEnd, byPath.closeStart)) === wantedText)) return byPath;
  }
  return null;
}

function markGroupMember(openingTag, marker) {
  const previous = attribute(openingTag, 'data-editor-sync-id');
  if (previous && previous !== marker) throw Error('目标素材已归属另一个跨网页组合');
  if (previous === marker) return openingTag;
  const at = /\/\s*>$/.test(openingTag) ? openingTag.lastIndexOf('/') : openingTag.length - 1;
  return openingTag.slice(0, at) + ' data-editor-sync-id="' + marker + '"' + openingTag.slice(at);
}

function registerPageSharing({ ipcMain, projects, resolveProjectFile, createProjectSnapshot, scanHtmlElements }) {
  const plans = new Map();
  const transactions = new Map();
  const errorResult = error => ({ ok: false, error: error.message });
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const trimPlans = () => {
    for (const [id, plan] of plans) if (Date.now() - plan.created > 15 * 60 * 1000) plans.delete(id);
    if (plans.size > 20) plans.delete(plans.keys().next().value);
    if (transactions.size > 100) transactions.delete(transactions.keys().next().value);
  };

  ipcMain.handle('project:preview-page-sharing', async (_event, payload) => {
    try {
      trimPlans();
      const root = projects.get(payload?.projectId);
      if (!root) throw Error('项目会话已失效');
      const sourceFile = resolveProjectFile(root, payload.pagePath);
      if (!sourceFile || path.extname(sourceFile).toLowerCase() !== '.html') throw Error('来源网页无效');
      const asset = payload.asset;
      if (!asset || typeof asset.selector !== 'string' || typeof asset.src !== 'string' || !asset.box) throw Error('请选择已加载的图片');
      const sourceUrl = asset.src.split(/[?#]/)[0];
      if (!sourceUrl || /^(?:[a-z]+:|\/\/)/i.test(sourceUrl)) throw Error('跨网页应用需要项目内的图片文件');
      const imageFile = path.resolve(path.dirname(sourceFile), decodeURIComponent(sourceUrl));
      const imageRelative = path.relative(root, imageFile);
      if (imageRelative.startsWith('..') || path.isAbsolute(imageRelative)) throw Error('图片必须位于当前项目内');
      if (!(await fs.stat(imageFile)).isFile()) throw Error('来源图片不存在');
      const pages = [...new Set(payload.pages || [])];
      const groups = [...new Set(payload.groups || [])];
      if (!pages.length || pages.length > 100 || !groups.length || groups.some(group => !['position', 'size', 'image', 'visibility'].includes(group))) throw Error('请选择目标网页和同步内容');
      const id = /^[a-z0-9-]{8,80}$/.test(asset.sharedId || '') ? asset.sharedId : 'shared-' + digest(payload.pagePath + '|' + asset.selector).slice(0, 24);
      const items = [];
      for (const page of pages) {
        if (typeof page !== 'string' || page === payload.pagePath) throw Error('请选择来源以外的目标网页');
        const file = resolveProjectFile(root, page);
        if (!file || path.extname(file).toLowerCase() !== '.html') throw Error('目标网页路径无效');
        const before = await fs.readFile(file, 'utf8');
        let targetHtml = before;
        const config = readConfig(before);
        const existing = config.shared.find(item => item.id === id && item.viewport === payload.viewport);
        const targetMatches = !existing && typeof scanHtmlElements === 'function' ? scanHtmlElements(before).filter(element => {
          if (element.tag !== 'img') return false;
          const match = element.openingTag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
          if (!match) return false;
          try {
            const targetUrl = match[2].split(/[?#]/)[0];
            return targetUrl && !/^(?:[a-z]+:|\/\/)/i.test(targetUrl)
              && path.resolve(path.dirname(file), decodeURIComponent(targetUrl)) === imageFile;
          } catch { return false; }
        }) : [];
        const matchingElement = targetMatches.length === 1 ? targetMatches[0] : null;
        if (!existing && !matchingElement && !payload.addMissing) { items.push({ page, action: 'skip' }); continue; }
        const src = path.relative(path.dirname(file), imageFile).split(path.sep).join('/');
        const item = existing ? JSON.parse(JSON.stringify(existing)) : { id, src, alt: asset.alt || '', transform: asset.transform || 'none', hostSelector: asset.hostSelector || '', existing: Boolean(matchingElement), positionOnly: Boolean(matchingElement && groups.includes('position') && !groups.includes('size') && !groups.includes('image')), viewport: payload.viewport, box: { ...asset.box } };
        const marker = '[data-editor-shared-id="' + id + '"]';
        if (groups.includes('image')) {
          const oldFilter = '[src=' + JSON.stringify(item.src) + ']';
          const newFilter = '[src=' + JSON.stringify(src) + ']';
          for (const edit of config.edits) if (edit.target.includes(marker)) { edit.target = edit.target.split(oldFilter).join(newFilter); edit.selector = edit.selector.split(oldFilter).join(newFilter); }
          for (const entry of config.visibility) if (entry.target.includes(marker)) entry.selector = entry.selector.split(oldFilter).join(newFilter);
          item.src = src; item.alt = asset.alt || ''; item.transform = asset.transform || 'none';
        }
        if (groups.includes('position')) { item.box.x = asset.box.x; item.box.y = asset.box.y; }
        if (groups.includes('size')) { item.box.width = asset.box.width; item.box.height = asset.box.height; }
        if (groups.includes('size') || groups.includes('image')) item.positionOnly = false;
        config.edits = config.edits.filter(edit => !(edit.target.includes(marker) && edit.viewport === payload.viewport && ((groups.includes('position') && ['translate', 'transform'].includes(edit.property)) || (groups.includes('size') && ['width', 'height'].includes(edit.property)))));
        if (matchingElement && groups.includes('position')) {
          const sourceMatch = matchingElement.openingTag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
          const targetSource = sourceMatch ? sourceMatch[2] : src;
          const oldFilter = '[src=' + JSON.stringify(targetSource) + ']';
          config.edits = config.edits.filter(edit => !(edit.viewport === payload.viewport && (edit.target.includes(oldFilter) || edit.selector.includes(oldFilter)) && ['translate', 'transform'].includes(edit.property)));
          const endMatch = /\/\s*>$/.exec(matchingElement.openingTag);
          const insertAt = endMatch ? endMatch.index : matchingElement.openingTag.length - 1;
          const sharedMarker = /\sdata-editor-shared-id\s*=\s*(["'])[^"']*\1/i;
          const markedTag = sharedMarker.test(matchingElement.openingTag)
            ? matchingElement.openingTag.replace(sharedMarker, ' data-editor-shared-id="' + id + '"')
            : matchingElement.openingTag.slice(0, insertAt) + ' data-editor-shared-id="' + id + '"' + matchingElement.openingTag.slice(insertAt);
          targetHtml = before.slice(0, matchingElement.start) + markedTag + before.slice(matchingElement.openEnd);
        }
        config.shared = config.shared.filter(entry => entry.id !== id || entry.viewport !== item.viewport);
        config.shared.push(item);
        if (groups.includes('visibility')) {
          const selector = 'img[data-editor-shared-id="' + id + '"]';
          config.visibility = config.visibility.filter(entry => !entry.target.includes(marker) || entry.viewport !== payload.viewport);
          const visibility = payload.visibility;
          if (visibility?.scope?.mode && visibility.scope.mode !== 'original') config.visibility.push({ target: selector, selector, viewport: payload.viewport, ownerSelector: visibility.ownerSelector || '', attribute: visibility.attribute || 'data-phase', scope: visibility.scope, display: 'block' });
        }
        const after = upsertLayoutDocument(targetHtml, config);
        items.push({ page, file, action: existing || matchingElement ? 'update' : 'add', before, after });
      }
      const planId = crypto.randomUUID();
      plans.set(planId, { projectId: payload.projectId, source: payload.pagePath, root, created: Date.now(), items });
      return { ok: true, planId, items: items.map(({ page, action }) => ({ page, action })) };
    } catch (error) { return errorResult(error); }
  });

  ipcMain.handle('project:preview-group-sharing', async (_event, payload) => {
    try {
      trimPlans();
      const root = projects.get(payload?.projectId);
      if (!root) throw Error('项目会话已失效');
      const sourceFile = resolveProjectFile(root, payload.pagePath);
      const group = payload.group;
      const pages = [...new Set(payload.pages || [])];
      if (!sourceFile || !/\.html?$/i.test(sourceFile) || !group || !/^group-[a-z0-9-]{8,80}$/.test(group.id)
        || !Array.isArray(group.members) || group.members.length < 2 || group.members.length > 50
        || !['current', 'selected', 'all'].includes(group.scope)
        || !Array.isArray(group.states) || group.states.length > 100
        || !['desktop', 'tablet', 'mobilePortrait', 'mobileLandscape', 'phone'].includes(payload.viewport)
        || !pages.length || pages.length > 100) throw Error('跨网页组合参数无效');
      if (group.scope !== 'all' && (!group.scene || !/^data-(phase|state|scene|step|page|slide|screen|question)$/.test(group.scene.attribute)
        || !group.states.length || group.states.some(state => typeof state !== 'string' || !state || state.length > 120))) throw Error('组合画面范围无效');
      const visibility = group.visibility || { mode: 'original', states: [] };
      if (!['original', 'current', 'selected', 'all'].includes(visibility.mode) || !Array.isArray(visibility.states)
        || (visibility.mode === 'selected' && !visibility.states.length)) throw Error('组合出现范围无效');
      for (const member of group.members) if (!/^[a-z][\w:-]*$/i.test(member.tag || '') || !Number.isFinite(member.x) || !Number.isFinite(member.y)
        || Math.abs(member.x) > 10000 || Math.abs(member.y) > 10000) throw Error('组合成员位置无效');
      const items = [];
      for (const page of pages) {
        if (typeof page !== 'string' || page === payload.pagePath) throw Error('目标网页无效');
        const file = resolveProjectFile(root, page);
        if (!file || !/\.html?$/i.test(file)) throw Error('目标网页路径无效');
        const before = await fs.readFile(file, 'utf8');
        const scanned = scanHtmlElements(before);
        const scene = group.scope === 'all' ? null : targetGroupScene(scanned, group.scene);
        if (group.scope !== 'all' && !scene) { items.push({ page, action: 'skip' }); continue; }
        const visibilityScene = ['current', 'selected'].includes(visibility.mode) ? targetGroupScene(scanned, group.visibilityScene) : null;
        if (['current', 'selected'].includes(visibility.mode) && !visibilityScene) { items.push({ page, action: 'skip' }); continue; }
        const matched = group.members.map((member, index) => {
          const marker = 'sync-' + digest(payload.pagePath + '|' + group.id + '|' + index).slice(0, 24);
          return { member, marker, record: findGroupMember(scanned, before, member, root, sourceFile, file, marker), index };
        });
        if (matched.some(item => !item.record) || new Set(matched.map(item => item.record?.start)).size !== matched.length) {
          items.push({ page, action: 'skip' }); continue;
        }
        let targetHtml = before;
        try {
          for (const item of [...matched].sort((a, b) => b.record.start - a.record.start)) {
            const opening = markGroupMember(item.record.openingTag, item.marker);
            targetHtml = targetHtml.slice(0, item.record.start) + opening + targetHtml.slice(item.record.openEnd);
          }
        } catch { items.push({ page, action: 'skip' }); continue; }
        const config = readConfig(targetHtml);
        const ids = new Set(matched.map(item => group.id + ':' + item.index));
        config.anchors = config.anchors.filter(item => !(ids.has(item.id) && item.viewport === payload.viewport));
        for (const item of matched) config.anchors.push({ id: group.id + ':' + item.index, selector: '[data-editor-sync-id="' + item.marker + '"]', viewport: payload.viewport, x: item.member.x, y: item.member.y,
          force: true, reference: item.member.reference === 'visual' ? 'visual' : 'subject',
          ...(item.member.positions ? { positions: item.member.positions } : {}), ...(scene ? { scene } : {}) });
        for (const item of matched) {
          const selector = '[data-editor-sync-id="' + item.marker + '"]';
          config.visibility = config.visibility.filter(record => !(record.target === selector && record.viewport === payload.viewport));
          if (visibility.mode !== 'original') config.visibility.push({ target: selector, selector, viewport: payload.viewport,
            ownerSelector: visibilityScene?.ownerSelector || '', attribute: visibilityScene?.attribute || 'data-phase',
            scope: visibility, display: ['block', 'inline-block', 'inline', 'flex', 'grid'].includes(item.member.display) ? item.member.display : 'block' });
        }
        config.groups = config.groups.filter(item => item.id !== group.id);
        config.groups.push({ id: group.id, members: matched.map(item => '[data-editor-sync-id="' + item.marker + '"]'),
          sync: group.scope === 'current' ? 'selected' : group.scope,
          states: group.scope === 'all' ? [] : group.states, pages: [], visibility });
        const after = upsertLayoutDocument(targetHtml, config);
        items.push(after === before ? { page, action: 'skip' } : { page, file, action: 'update', before, after });
      }
      const planId = crypto.randomUUID();
      plans.set(planId, { projectId: payload.projectId, source: payload.pagePath, root, created: Date.now(), items });
      return { ok: true, planId, items: items.map(({ page, action }) => ({ page, action })) };
    } catch (error) { return errorResult(error); }
  });

  async function commit(items, side) {
    const expected = side === 'after' ? 'before' : 'after';
    const changed = items.filter(item => item.file && item.before !== item.after);
    for (const item of changed) if (await fs.readFile(item.file, 'utf8') !== item[expected]) throw Error(item.page + ' 在预览后已有其他修改，请重新预览');
    const written = [];
    try {
      for (const item of changed) { await fs.writeFile(item.file, item[side], 'utf8'); written.push(item); }
    } catch (error) {
      for (const item of written.reverse()) await fs.writeFile(item.file, item[expected], 'utf8');
      throw error;
    }
  }

  ipcMain.handle('project:apply-page-sharing', async (_event, payload) => {
    try {
      trimPlans();
      const plan = plans.get(payload?.planId);
      if (!plan || plan.projectId !== payload.projectId) throw Error('预览已失效，请重新预览');
      const changes = plan.items.filter(item => item.file && item.before !== item.after);
      if (!changes.length) throw Error('没有需要写入的目标网页；缺少素材时可勾选自动添加');
      await createProjectSnapshot(plan.projectId, plan.root, plan.source, '跨网页应用前自动备份');
      await commit(plan.items, 'after');
      const transactionId = crypto.randomUUID();
      transactions.set(transactionId, { ...plan, side: 'after' });
      plans.delete(payload.planId);
      return { ok: true, transactionId, count: changes.length };
    } catch (error) { return errorResult(error); }
  });

  ipcMain.handle('project:restore-page-sharing', async (_event, payload) => {
    try {
      const transaction = transactions.get(payload?.transactionId);
      if (!transaction || transaction.projectId !== payload.projectId || !['before', 'after'].includes(payload.side)) throw Error('跨网页记录已失效，可从项目版本恢复');
      if (transaction.side !== payload.side) {
        await createProjectSnapshot(transaction.projectId, transaction.root, transaction.source, '跨网页撤销重做前备份');
        await commit(transaction.items, payload.side);
        transaction.side = payload.side;
      }
      return { ok: true };
    } catch (error) { return errorResult(error); }
  });
}

module.exports = { registerPageSharing };
