const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { after, before, test } = require('node:test');

const projectRoot = path.join(os.tmpdir(), `theme-unit-acceptance-${process.pid}`);
const userDataRoot = path.join(os.tmpdir(), `theme-unit-acceptance-userdata-${process.pid}`);
const handlers = new Map();
let mainModulePath;

before(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(userDataRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'styles'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'index.html'), `<!doctype html>
<html><head><link rel="stylesheet" href="./styles/app.css"><style data-editor-dynamic="dynamic-auto-old">@media (min-width: 501px) and (max-width: 900px) { button.sound { transform: translate(1px, 1px); } }</style></head><body>
<main><button class="next">下一题</button><button class="back">返回</button><div id="feedback">结果</div></main>
<script src="./scripts/app.js"></script>
</body></html>`, 'utf8');
  await fs.writeFile(path.join(projectRoot, 'next.html'), '<!doctype html><html><body><h1>下一页</h1></body></html>', 'utf8');
  await fs.writeFile(path.join(projectRoot, 'styles/app.css'), '.sound { position: absolute; }\n', 'utf8');
  await fs.writeFile(path.join(projectRoot, 'scripts/app.js'), `window.addEventListener('load', () => {
  const button = document.createElement('button');
  button.className = 'sound';
  button.innerHTML = '<img class="icon" src="./assets/sound.png" alt="声音">';
  document.body.appendChild(button);
});\n`, 'utf8');
  await fs.writeFile(path.join(projectRoot, 'assets/sound.png'), 'original image bytes');

  const electronMock = {
    app: {
      commandLine: { appendSwitch() {} },
      setAppUserModelId() {},
      getPath(name) {
        assert.equal(name, 'userData');
        return userDataRoot;
      },
      whenReady: () => Promise.resolve(),
      on() {},
      quit() {},
    },
    BrowserWindow: class {
      constructor() { this.webContents = { on() {} }; }
      on() {}
      loadFile() { return Promise.resolve(); }
      loadURL() { return Promise.resolve(); }
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [projectRoot] }),
    },
    ipcMain: {
      handle(name, handler) { handlers.set(name, handler); },
    },
    net: { fetch: async () => new Response('') },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
  };

  const originalLoad = Module._load;
  const originalDevUrl = process.env.VITE_DEV_SERVER_URL;
  delete process.env.VITE_DEV_SERVER_URL;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  mainModulePath = require.resolve('../electron/main.cjs');
  try {
    require(mainModulePath);
  } finally {
    Module._load = originalLoad;
    if (originalDevUrl === undefined) delete process.env.VITE_DEV_SERVER_URL;
    else process.env.VITE_DEV_SERVER_URL = originalDevUrl;
  }
  await new Promise((resolve) => setImmediate(resolve));
});

after(async () => {
  if (mainModulePath) delete require.cache[mainModulePath];
  await fs.rm(projectRoot, { recursive: true, force: true });
  await fs.rm(userDataRoot, { recursive: true, force: true });
});

function handler(name) {
  const registered = handlers.get(name);
  assert.equal(typeof registered, 'function', `IPC handler registered: ${name}`);
  return registered;
}

test('dynamic image element saves, interaction navigates, and full project versions restore', async (t) => {
  const opened = await handler('project:open')();
  assert.equal(opened.ok, true, opened.error);
  assert.deepEqual(opened.pages.map((page) => page.path).sort(), ['index.html', 'next.html']);
  const projectId = opened.id;

  await t.test('a script-created image button can be moved and saved repeatedly without duplicate patches', async () => {
    const payload = {
      projectId,
      pagePath: 'index.html',
      id: 'auto-sound-test',
      auto: true,
      sourceType: 'dynamic',
      tag: 'button',
      className: 'sound',
      selector: 'button.sound',
      styles: { transform: 'translate(-160px, 64px)' },
      text: '声音按钮',
      nestedImage: { selector: 'img.icon', src: './assets/sound-replaced.png' },
    };
    const firstSave = await handler('project:save-element')(null, payload);
    assert.equal(firstSave.ok, true, firstSave.error);

    const mobileSave = await handler('project:save-element')(null, {
      ...payload,
      viewport: 'mobileLandscape',
      styles: { transform: 'translate(12px, 14px)' },
    });
    assert.equal(mobileSave.ok, true, mobileSave.error);

    const tabletSave = await handler('project:save-element')(null, {
      ...payload,
      viewport: 'tablet',
      styles: { transform: 'translate(3px, 4px)' },
    });
    assert.equal(tabletSave.ok, true, tabletSave.error);

    const portraitSave = await handler('project:save-element')(null, {
      ...payload,
      viewport: 'mobilePortrait',
      styles: { transform: 'translate(5px, 6px)' },
    });
    assert.equal(portraitSave.ok, true, portraitSave.error);

    const changedSave = await handler('project:save-element')(null, {
      ...payload,
      styles: { transform: 'translate(-120px, 48px)' },
    });
    assert.equal(changedSave.ok, true, changedSave.error);

    const html = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
    assert.match(html, /data-editor-dynamic="dynamic-auto-sound-test"/);
    assert.match(html, /transform: translate\(-120px, 48px\)/);
    assert.match(html, /data-editor-viewport="desktop">button\.sound \{ transform: translate\(-120px, 48px\); \}<\/style>/);
    assert.match(html, /data-editor-viewport="tablet">@media \(min-width: 901px\) and \(max-width: 1200px\) \{ button\.sound \{ transform: translate\(3px, 4px\); \} \}<\/style>/);
    assert.match(html, /data-editor-viewport="mobilePortrait">@media \(max-width: 500px\) \{ button\.sound \{ transform: translate\(5px, 6px\); \} \}<\/style>/);
    assert.match(html, /data-editor-viewport="mobileLandscape">@media \(min-width: 501px\) and \(max-width: 900px\) \{ button\.sound \{ transform: translate\(12px, 14px\); \} \}<\/style>/);
    assert.doesNotMatch(html, /transform: translate\(-160px, 64px\)/);
    assert.doesNotMatch(html, /transform: translate\(1px, 1px\)/);
    assert.equal((html.match(/data-editor-dynamic="dynamic-auto-sound-test"/g) || []).length, 4);
    assert.equal((html.match(/data-editor-dynamic-content=/g) || []).length, 1);
    assert.match(html, /"nestedSrc":"\.\/assets\/sound-replaced\.png"/);
    assert.match(html, /"text":"声音按钮"/);
  });

  await t.test('navigation interaction reads back, updates in place, and can be removed', async () => {
    const sourceSelector = 'button.next';
    const saved = await handler('project:save-interaction')(null, {
      projectId, pagePath: 'index.html', sourceSelector, action: 'navigate', targetPage: 'next.html',
    });
    assert.equal(saved.ok, true, saved.error);

    const readBack = await handler('project:get-interaction')(null, { projectId, pagePath: 'index.html', sourceSelector });
    assert.deepEqual(readBack, { ok: true, interaction: { action: 'navigate', targetSelector: '', targetPage: 'next.html', className: '' } });

    const updated = await handler('project:save-interaction')(null, {
      projectId, pagePath: 'index.html', sourceSelector, action: 'show', targetSelector: '#feedback',
    });
    assert.equal(updated.ok, true, updated.error);
    const updatedReadBack = await handler('project:get-interaction')(null, { projectId, pagePath: 'index.html', sourceSelector });
    assert.deepEqual(updatedReadBack.interaction, { action: 'show', targetSelector: '#feedback', targetPage: '', className: '' });

    for (let editIndex = 0; editIndex < 10; editIndex += 1) {
      const action = editIndex % 2 === 0 ? 'hide' : 'show';
      const repeatedEdit = await handler('project:save-interaction')(null, {
        projectId, pagePath: 'index.html', sourceSelector, action, targetSelector: '#feedback',
      });
      assert.equal(repeatedEdit.ok, true, repeatedEdit.error);
      const repeatedReadBack = await handler('project:get-interaction')(null, { projectId, pagePath: 'index.html', sourceSelector });
      assert.equal(repeatedReadBack.interaction.action, action, 'interaction edit ' + (editIndex + 1) + ' reads back');
    }

    const removed = await handler('project:save-interaction')(null, {
      projectId, pagePath: 'index.html', sourceSelector, action: 'none',
    });
    assert.equal(removed.ok, true, removed.error);
    const cleared = await handler('project:get-interaction')(null, { projectId, pagePath: 'index.html', sourceSelector });
    assert.deepEqual(cleared, { ok: true, interaction: null });
  });

  await t.test('named snapshots include all project files and restore deleted and changed files', async () => {
    const created = await handler('project:create-version')(null, {
      projectId, pagePath: 'index.html', name: '验收基线版本',
    });
    assert.equal(created.ok, true, created.error);

    const listed = await handler('project:list-versions')(null, { projectId, pagePath: 'index.html' });
    assert.equal(listed.ok, true);
    const baseline = listed.versions.find((version) => version.name === '验收基线版本');
    assert.ok(baseline, 'the named version appears in the version list');
    for (const file of ['index.html', 'next.html', 'styles/app.css', 'scripts/app.js', 'assets/sound.png']) {
      assert.ok(baseline.fileList.includes(file), `version contains ${file}`);
    }

    await fs.writeFile(path.join(projectRoot, 'index.html'), '<html><body>mutated</body></html>', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'next.html'), '<html><body>mutated next</body></html>', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'styles/app.css'), 'body { color: red; }', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'scripts/app.js'), 'window.mutated = true;', 'utf8');
    await fs.writeFile(path.join(projectRoot, 'assets/sound.png'), 'changed image bytes');
    await fs.writeFile(path.join(projectRoot, 'temporary.txt'), 'remove me');

    for (let restoreIndex = 0; restoreIndex < 3; restoreIndex += 1) {
      await fs.writeFile(path.join(projectRoot, 'index.html'), '<html><body>mutated again ' + restoreIndex + '</body></html>', 'utf8');
      const restored = await handler('project:restore-version')(null, {
        projectId, pagePath: 'index.html', versionId: baseline.id,
      });
      assert.equal(restored.ok, true, restored.error);
      assert.match(await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8'), /data-editor-dynamic="dynamic-auto-sound-test"/);
    }

    assert.match(await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8'), /data-editor-dynamic="dynamic-auto-sound-test"/);
    assert.match(await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8'), /sound-replaced\.png/);
    assert.match(await fs.readFile(path.join(projectRoot, 'next.html'), 'utf8'), /下一页/);
    assert.match(await fs.readFile(path.join(projectRoot, 'styles/app.css'), 'utf8'), /\.sound/);
    assert.match(await fs.readFile(path.join(projectRoot, 'scripts/app.js'), 'utf8'), /createElement/);
    assert.equal(await fs.readFile(path.join(projectRoot, 'assets/sound.png'), 'utf8'), 'original image bytes');
    await assert.rejects(fs.stat(path.join(projectRoot, 'temporary.txt')), { code: 'ENOENT' });

    const afterRestore = await handler('project:list-versions')(null, { projectId, pagePath: 'index.html' });
    assert.ok(afterRestore.versions.some((version) => version.reason === '恢复前自动备份'));
  });

  await t.test('AI proposals stay isolated until applied and failed writes roll back', async () => {
    const settings = await handler('ai:save-settings')(null, {
      apiBaseUrl: 'http://127.0.0.1:12345/v1',
      apiFormat: 'chat-completions',
      model: 'acceptance-model',
      apiKey: 'local-test-key',
    });
    assert.equal(settings.ok, true, settings.error);
    const savedSettings = await handler('ai:get-settings')();
    assert.equal(savedSettings.apiKeyConfigured, true);
    assert.equal(Object.hasOwn(savedSettings, 'apiKey'), false);

    const originalFetch = global.fetch;
    let proposalContent = '';
    global.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:12345/v1/chat/completions');
      assert.equal(JSON.parse(options.body).model, 'acceptance-model');
      const aiText = JSON.stringify({
        summary: '更新交互课件逻辑',
        files: [{ path: 'scripts/app.js', content: proposalContent }],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: aiText } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    try {
      const sourcePath = path.join(projectRoot, 'scripts/app.js');
      const originalSource = await fs.readFile(sourcePath, 'utf8');
      proposalContent = 'window.aiResult = "discarded";';
      const rejectedProposal = await handler('ai:generate-proposal')(null, {
        projectId, pagePath: 'index.html', request: '生成反馈逻辑', contextFiles: ['scripts/app.js'],
      });
      assert.equal(rejectedProposal.ok, true, rejectedProposal.error);
      const rejectedStage = await handler('ai:create-isolated-preview')(null, {
        projectId, pagePath: 'index.html', summary: rejectedProposal.proposal.summary, files: rejectedProposal.proposal.files,
      });
      assert.equal(rejectedStage.ok, true, rejectedStage.error);
      assert.equal(await fs.readFile(sourcePath, 'utf8'), originalSource, 'opening an AI preview leaves the project untouched');
      assert.equal(await fs.readFile(path.join(userDataRoot, 'ai-preview', rejectedStage.stageId, 'scripts/app.js'), 'utf8'), proposalContent);
      assert.equal((await handler('ai:close-isolated-preview')(null, { projectId, stageId: rejectedStage.stageId })).ok, true);
      assert.equal(await fs.readFile(sourcePath, 'utf8'), originalSource, 'closing an unaccepted preview leaves the project untouched');

      proposalContent = 'window.aiResult = "accepted";';
      const acceptedProposal = await handler('ai:generate-proposal')(null, {
        projectId, pagePath: 'index.html', request: '生成反馈逻辑', contextFiles: ['scripts/app.js'],
      });
      const acceptedStage = await handler('ai:create-isolated-preview')(null, {
        projectId, pagePath: 'index.html', summary: acceptedProposal.proposal.summary, files: acceptedProposal.proposal.files,
      });
      assert.equal(acceptedStage.ok, true, acceptedStage.error);
      assert.equal(await fs.readFile(sourcePath, 'utf8'), originalSource);
      const applied = await handler('ai:apply-proposal')(null, { projectId, stageId: acceptedStage.stageId });
      assert.equal(applied.ok, true, applied.error);
      const acceptedSource = await fs.readFile(sourcePath, 'utf8');
      assert.equal(acceptedSource, proposalContent);

      proposalContent = 'window.aiResult = "failed";';
      const failedProposal = await handler('ai:generate-proposal')(null, {
        projectId, pagePath: 'index.html', request: '生成另一段反馈逻辑', contextFiles: ['scripts/app.js'],
      });
      const failedStage = await handler('ai:create-isolated-preview')(null, {
        projectId, pagePath: 'index.html', summary: failedProposal.proposal.summary, files: failedProposal.proposal.files,
      });
      assert.equal(failedStage.ok, true, failedStage.error);
      const originalRename = fs.rename;
      let failedRenameOnce = false;
      try {
        fs.rename = async (...args) => {
          failedRenameOnce = true;
          throw new Error('simulated disk write failure');
        };
        const failedApply = await handler('ai:apply-proposal')(null, { projectId, stageId: failedStage.stageId });
        assert.equal(failedApply.ok, false);
      } finally {
        fs.rename = originalRename;
      }
      assert.equal(failedRenameOnce, true, 'the simulated write failure was reached');
      assert.equal(await fs.readFile(sourcePath, 'utf8'), acceptedSource, 'a failed AI write restores the previous file');
      await handler('ai:close-isolated-preview')(null, { projectId, stageId: failedStage.stageId });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
