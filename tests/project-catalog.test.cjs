const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { discoverProjects } = require('../electron/project-catalog.cjs');

test('local discovery finds HTML projects, prefers index, restores recent files and skips dependency folders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-catalog-'));
  try {
    for (const dir of ['lesson', 'standalone', 'recent/pages', 'node_modules/library', '.hidden', 'empty']) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
    }
    for (const name of ['lesson/a.html', 'lesson/index.html', 'standalone/page.htm', 'recent/pages/screen.html', 'node_modules/library/index.html', '.hidden/index.html']) {
      await fs.writeFile(path.join(root, name), '<html></html>');
    }
    const recent = [{ rootPath: path.join(root, 'recent'), entryPath: 'pages/screen.html' }, { rootPath: path.join(root, 'deleted'), entryPath: 'index.html' }];
    const result = await discoverProjects([root, root], recent);
    const lesson = result.items.find((item) => item.name === 'lesson');
    assert.equal(lesson.entryPath, 'index.html');
    assert.equal(result.items.find((item) => item.name === 'standalone').entryPath, 'page.htm');
    assert.equal(result.items[0].entryPath, 'pages/screen.html');
    assert.equal(result.items[0].recent, true);
    assert.equal(result.items.length, 3);
    assert.equal(new Set(result.items.map((item) => item.key)).size, 3);
    const again = await discoverProjects([root], recent);
    assert.equal(again.items.find((item) => item.name === 'lesson').key, lesson.key);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('discovery stops at its directory budget and rejects preferred entries outside the project', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-catalog-limits-'));
  try {
    await fs.mkdir(path.join(root, 'one'));
    await fs.mkdir(path.join(root, 'two'));
    await fs.writeFile(path.join(root, 'one/index.html'), '<html></html>');
    const limited = await discoverProjects([root], [], { maxDirectories: 1 });
    assert.equal(limited.limited, true);
    assert.equal(limited.items.length, 0);
    const result = await discoverProjects([], [{ rootPath: path.join(root, 'two'), entryPath: '../one/index.html' }]);
    assert.equal(result.items.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
