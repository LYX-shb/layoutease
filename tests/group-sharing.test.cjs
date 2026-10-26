const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { registerPageSharing } = require('../electron/page-sharing.cjs');
const { normalizeLayoutConfig } = require('../electron/edit-scopes.cjs');

function scanFixture(html) {
  const records = [];
  const counts = new Map();
  for (const match of html.matchAll(/<(main|img|span)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase(), start = match.index, openEnd = start + match[0].length;
    const closeStart = tag === 'img' ? openEnd : html.indexOf('</' + tag + '>', openEnd);
    const index = counts.get(tag) || 0; counts.set(tag, index + 1);
    records.push({ tag, path: `main:0/${tag}:${index}`, start, openEnd, closeStart, openingTag: match[0] });
  }
  return records;
}

test('a whole group syncs to pages with every unique member, and skips ambiguous pages', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-group-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets', 'frame.png'), 'image');
  const source = '<main id="stage"><img src="assets/frame.png"><span id="title">Hello</span></main>';
  const target = '<main id="stage"><img src="assets/frame.png"><span id="title">Hello</span></main>';
  const ambiguous = '<main id="stage"><img src="assets/frame.png"><img src="assets/frame.png"><span id="title">Hello</span></main>';
  const scripted = '<main id="stage"><img><span id="title">Hello</span></main>';
  await fs.writeFile(path.join(root, 'source.html'), source);
  await fs.writeFile(path.join(root, 'target.html'), target);
  await fs.writeFile(path.join(root, 'ambiguous.html'), ambiguous);
  await fs.writeFile(path.join(root, 'scripted.html'), scripted);
  const handlers = new Map();
  let backups = 0;
  registerPageSharing({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    projects: new Map([['project', root]]), resolveProjectFile: (base, page) => path.join(base, page),
    createProjectSnapshot: async () => { backups++; }, scanHtmlElements: scanFixture });
  const group = { id: 'group-12345678', scope: 'all', states: [], members: [
    { tag: 'img', path: 'main:0/img:0', src: 'assets/frame.png', x: 18.5, y: 32.25 },
    { tag: 'span', path: 'main:0/span:0', id: 'title', text: 'Hello', x: 37.75, y: 40.5 },
  ] };
  const preview = await handlers.get('project:preview-group-sharing')(null, { projectId: 'project', pagePath: 'source.html', pages: ['target.html', 'scripted.html', 'ambiguous.html'], viewport: 'desktop', group });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.items.map(item => item.action), ['update', 'update', 'skip']);
  const applied = await handlers.get('project:apply-page-sharing')(null, { projectId: 'project', planId: preview.planId });
  assert.equal(applied.ok, true); assert.equal(applied.count, 2); assert.equal(backups, 1);
  const updated = await fs.readFile(path.join(root, 'target.html'), 'utf8');
  const config = normalizeLayoutConfig(JSON.parse(updated.match(/<script\b[^>]*data-editor-layout-data[^>]*>(.*?)<\/script>/s)[1]));
  assert.equal(config.anchors.length, 2);
  assert.deepEqual(config.anchors.map(item => [item.x, item.y]), [[18.5, 32.25], [37.75, 40.5]]);
  assert.equal(config.groups[0].members.length, 2);
  assert.match(await fs.readFile(path.join(root, 'scripted.html'), 'utf8'), /data-editor-sync-id=/, 'a script-populated image is matched by its stable element path');
  assert.equal(await fs.readFile(path.join(root, 'ambiguous.html'), 'utf8'), ambiguous);
  group.members[0].x = 21.5;
  const again = await handlers.get('project:preview-group-sharing')(null, { projectId: 'project', pagePath: 'source.html', pages: ['target.html', 'scripted.html', 'ambiguous.html'], viewport: 'desktop', group });
  assert.deepEqual(again.items.map(item => item.action), ['update', 'update', 'skip']);
  const repeated = await handlers.get('project:apply-page-sharing')(null, { projectId: 'project', planId: again.planId });
  assert.equal(repeated.ok, true);
  const movedAgain = await fs.readFile(path.join(root, 'target.html'), 'utf8');
  const secondConfig = normalizeLayoutConfig(JSON.parse(movedAgain.match(/<script\b[^>]*data-editor-layout-data[^>]*>(.*?)<\/script>/s)[1]));
  assert.equal(secondConfig.anchors.length, 2, 'moving again replaces positions without duplicating anchors');
  assert.equal(secondConfig.anchors[0].x, 21.5);
  const revertSecond = await handlers.get('project:restore-page-sharing')(null, { projectId: 'project', transactionId: repeated.transactionId, side: 'before' });
  assert.equal(revertSecond.ok, true);
  assert.equal(await fs.readFile(path.join(root, 'target.html'), 'utf8'), updated);
  const restored = await handlers.get('project:restore-page-sharing')(null, { projectId: 'project', transactionId: applied.transactionId, side: 'before' });
  assert.equal(restored.ok, true);
  assert.equal(await fs.readFile(path.join(root, 'target.html'), 'utf8'), target);
  assert.equal(await fs.readFile(path.join(root, 'scripted.html'), 'utf8'), scripted);
});

test('a group can target named scenes on selected webpages only', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-group-scenes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const page = phase => `<main id="stage"${phase ? ` data-phase="${phase}"` : ''}><img id="frame"><span id="label">Hello</span></main>`;
  await Promise.all(['source.html', 'target.html', 'other.html'].map(name => fs.writeFile(path.join(root, name), page('intro'))));
  await fs.writeFile(path.join(root, 'no-scene.html'), page(''));
  const handlers = new Map();
  registerPageSharing({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projects: new Map([['project', root]]),
    resolveProjectFile: (base, name) => path.join(base, name), createProjectSnapshot: async () => {}, scanHtmlElements: scanFixture });
  const group = { id: 'group-87654321', scope: 'selected', states: ['intro', 'question'],
    scene: { ownerSelector: 'main#stage', attribute: 'data-phase', states: ['intro', 'question'] },
    visibility: { mode: 'selected', states: ['intro', 'question'] },
    visibilityScene: { ownerSelector: 'main#stage', attribute: 'data-phase', states: ['intro', 'question'] },
    members: [{ tag: 'img', id: 'frame', path: 'main:0/img:0', x: 12, y: 20 },
      { tag: 'span', id: 'label', path: 'main:0/span:0', text: 'Hello', x: 18, y: 24 }] };
  const plan = await handlers.get('project:preview-group-sharing')(null, { projectId: 'project', pagePath: 'source.html',
    pages: ['target.html', 'no-scene.html'], viewport: 'desktop', group });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.items.map(item => item.action), ['update', 'skip']);
  const applied = await handlers.get('project:apply-page-sharing')(null, { projectId: 'project', planId: plan.planId });
  assert.equal(applied.ok, true);
  const updated = await fs.readFile(path.join(root, 'target.html'), 'utf8');
  const config = normalizeLayoutConfig(JSON.parse(updated.match(/<script\b[^>]*data-editor-layout-data[^>]*>(.*?)<\/script>/s)[1]));
  assert.equal(config.groups[0].sync, 'selected');
  assert.deepEqual(config.groups[0].states, ['intro', 'question']);
  assert.deepEqual(config.groups[0].visibility, { mode: 'selected', states: ['intro', 'question'] });
  assert.equal(config.visibility.length, 2);
  assert.ok(config.anchors.every(item => item.force && item.scene.ownerSelector === 'main[id="stage"]'
    && item.scene.attribute === 'data-phase' && item.scene.states.includes('question')));
  assert.equal(await fs.readFile(path.join(root, 'other.html'), 'utf8'), page('intro'), 'an unselected webpage is untouched');
  assert.equal(await fs.readFile(path.join(root, 'no-scene.html'), 'utf8'), page(''), 'a webpage without the named scene is skipped');
  group.scope = 'current'; group.states = ['intro']; group.scene.states = ['intro'];
  const currentPlan = await handlers.get('project:preview-group-sharing')(null, { projectId: 'project', pagePath: 'source.html',
    pages: ['other.html'], viewport: 'desktop', group });
  assert.equal(currentPlan.ok, true);
  assert.deepEqual(currentPlan.items.map(item => item.action), ['update']);
  assert.equal((await handlers.get('project:apply-page-sharing')(null, { projectId: 'project', planId: currentPlan.planId })).ok, true);
  const currentConfig = normalizeLayoutConfig(JSON.parse((await fs.readFile(path.join(root, 'other.html'), 'utf8')).match(/<script\b[^>]*data-editor-layout-data[^>]*>(.*?)<\/script>/s)[1]));
  assert.equal(currentConfig.groups[0].sync, 'selected', 'the target page can still edit its anchored current scene');
  assert.deepEqual(currentConfig.groups[0].states, ['intro']);
});

test('repeated image files match by unique member data without moving sibling copies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-group-repeated-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'same.png'), 'image');
  const html = '<main id="stage"><img src="same.png" data-index="0"><img src="same.png" data-index="1"><img src="same.png" data-index="2"></main>';
  await fs.writeFile(path.join(root, 'source.html'), html);
  await fs.writeFile(path.join(root, 'target.html'), html);
  const handlers = new Map();
  registerPageSharing({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, projects: new Map([['project', root]]),
    resolveProjectFile: (base, name) => path.join(base, name), createProjectSnapshot: async () => {}, scanHtmlElements: scanFixture });
  const group = { id: 'group-12121212', scope: 'all', states: [], members: [
    { tag: 'img', src: 'same.png', data: { 'data-index': '0' }, x: 10, y: 20 },
    { tag: 'img', src: 'same.png', data: { 'data-index': '1' }, x: 30, y: 20 },
  ] };
  const plan = await handlers.get('project:preview-group-sharing')(null, { projectId: 'project', pagePath: 'source.html',
    pages: ['target.html'], viewport: 'desktop', group });
  assert.equal(plan.ok, true);
  assert.equal(plan.items[0].action, 'update');
  const applied = await handlers.get('project:apply-page-sharing')(null, { projectId: 'project', planId: plan.planId });
  assert.equal(applied.ok, true);
  const updated = await fs.readFile(path.join(root, 'target.html'), 'utf8');
  const authoredMarkup = updated.split('<script')[0];
  assert.equal((authoredMarkup.match(/data-editor-sync-id=/g) || []).length, 2);
  assert.match(authoredMarkup, /data-index="2">/);
});
