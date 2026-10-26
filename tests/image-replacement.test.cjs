const assert = require('node:assert/strict');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { upsertImageReplacementOverride } = require('../electron/image-replacement.cjs');

const waitForRuntime = () => new Promise(resolve => setTimeout(resolve, 10));

function openPage(html, device) {
  return new JSDOM(html, {
    url: 'https://example.test/lesson.html',
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: device === 'desktop' ? 1440 : device === 'tablet' ? 1024 : 390 });
      window.__editorLayoutRuntime = { isPhone: () => device === 'phone' };
    },
  });
}

test('phone-only image replacement survives source changes without changing desktop', async () => {
  const original = '<html><body><img id="picture" src="./old.png"></body></html>';
  const saved = upsertImageReplacementOverride(original, {
    selector: 'img#picture', kind: 'src', index: 0, src: './phone.png', viewport: 'phone',
  });
  assert.match(saved, /src="\.\/old\.png"/, 'the authored desktop source stays unchanged');
  for (const device of ['phone', 'desktop']) {
    const dom = openPage(saved, device);
    try {
      const image = dom.window.document.querySelector('#picture');
      await waitForRuntime();
      assert.equal(image.getAttribute('src'), device === 'phone' ? './phone.png' : './old.png');
      if (device === 'phone') {
        image.setAttribute('src', './old.png');
        await waitForRuntime();
        assert.equal(image.getAttribute('src'), './phone.png', 'page code cannot reset the saved replacement');
      }
    } finally { dom.window.close(); }
  }
});

test('replacing all devices supersedes an older phone-only replacement', async () => {
  const original = '<html><body><img id="picture" src="./old.png"></body></html>';
  const phone = upsertImageReplacementOverride(original, {
    selector: 'img#picture', kind: 'src', index: 0, src: './phone.png', viewport: 'phone',
  });
  const all = upsertImageReplacementOverride(phone, {
    selector: 'img#picture', kind: 'src', index: 0, src: './everywhere.png', viewport: 'all',
  });
  assert.equal((all.match(/data-editor-image-replacement=/g) || []).length, 1);
  for (const device of ['phone', 'tablet', 'desktop']) {
    const dom = openPage(all, device);
    try {
      await waitForRuntime();
      assert.equal(dom.window.document.querySelector('#picture').getAttribute('src'), './everywhere.png');
    } finally { dom.window.close(); }
  }
});

test('nested button image and background replacement survive resets and regenerated elements', async () => {
  let saved = '<html><body><button id="control"><img src="./old.png"></button><div id="card" style="background-image:url(./old.png)"></div></body></html>';
  saved = upsertImageReplacementOverride(saved, {
    selector: 'button#control', kind: 'nested', index: 0, src: './new-button.png', viewport: 'all',
  });
  saved = upsertImageReplacementOverride(saved, {
    selector: 'div#card', kind: 'background', index: 0, src: './new-background.png', viewport: 'all',
  });
  const dom = openPage(saved, 'desktop');
  try {
    await waitForRuntime();
    const button = dom.window.document.querySelector('#control');
    const card = dom.window.document.querySelector('#card');
    assert.equal(button.querySelector('img').getAttribute('src'), './new-button.png');
    assert.match(card.style.backgroundImage, /new-background\.png/);
    button.querySelector('img').setAttribute('src', './old.png');
    card.style.backgroundImage = 'url("./old.png")';
    await waitForRuntime();
    assert.equal(button.querySelector('img').getAttribute('src'), './new-button.png');
    assert.match(card.style.backgroundImage, /new-background\.png/);
    button.innerHTML = '<img src="./old.png">';
    await waitForRuntime();
    assert.equal(button.querySelector('img').getAttribute('src'), './new-button.png');
  } finally { dom.window.close(); }
});
