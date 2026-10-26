import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewUrlWithMobileEnvironment, readPreviewConfig, resolvePageViewport, resolvePreview, saveViewportForPreview, selectPreviewPreset, shouldEmulateMobilePreview } from '../src/preview-presets.ts';

test('custom widths select a save range that includes the actual preview, including boundaries', () => {
  const config = readPreviewConfig(null, 'desktop');
  for (const [width, expected] of [[500, 'phone'], [600, 'phone'], [601, 'mobileLandscape'], [900, 'mobileLandscape'], [901, 'tablet'], [1200, 'tablet'], [1201, 'desktop']]) {
    const custom = { ...config, preset: 'custom', customWidth: width, customHeight: 1000 };
    assert.equal(saveViewportForPreview(custom), expected);
    assert.equal(resolvePreview(custom).width, width);
  }
});

test('stored preview settings survive reopening; corrupt or out-of-range data falls back safely', () => {
  const original = { preset: 'custom', huaweiOrientation: 'rotatedPortrait', customWidth: 915, customHeight: 412 };
  assert.deepEqual(readPreviewConfig(JSON.stringify(original), 'desktop'), original);
  for (const raw of ['{', 'null', JSON.stringify({ ...original, customWidth: 0 }), JSON.stringify({ ...original, customHeight: 100.5 }), JSON.stringify({ ...original, preset: '__proto__' })]) {
    const restored = readPreviewConfig(raw, 'mobileLandscape');
    assert.equal(restored.preset, 'mobileLandscape');
    assert.deepEqual(resolvePreview(restored), { label: '手机横屏', width: 844, height: 390 });
  }
});

test('Huawei default shows the portrait phone webpage upright in a landscape-sized editor frame', () => {
  const defaults = readPreviewConfig(null, 'desktop');
  assert.equal(defaults.huaweiOrientation, 'rotatedPortrait');
  const selected = selectPreviewPreset(defaults, 'huaweiP70ProPlus');
  assert.deepEqual(resolvePreview(selected), { label: '华为 Pura 70 Pro+ · 横屏显示', width: 763, height: 378 });
  assert.deepEqual(resolvePageViewport(selected), { label: '手机网页视口（横屏显示）', width: 378, height: 763 });
  assert.equal(saveViewportForPreview(selected), 'phone');
  const legacy = readPreviewConfig(JSON.stringify({ preset: 'huaweiP70ProPlus', huaweiOrientation: 'wechatLandscape', customWidth: 843, customHeight: 374 }), 'desktop');
  assert.equal(legacy.huaweiOrientation, 'rotatedPortrait');
  const oldPortrait = readPreviewConfig(JSON.stringify({ preset: 'huaweiP70ProPlus', huaweiOrientation: 'portrait', customWidth: 843, customHeight: 374 }), 'desktop');
  assert.equal(oldPortrait.huaweiOrientation, 'rotatedPortrait');
  const oldDefault = readPreviewConfig(JSON.stringify({ preset: 'huaweiP70ProPlus', huaweiOrientation: 'landscape', customWidth: 843, customHeight: 374 }), 'desktop');
  assert.equal(oldDefault.huaweiOrientation, 'rotatedPortrait');
});

test('Huawei native landscape option uses a direct landscape page viewport', () => {
  const selected = { preset: 'huaweiP70ProPlus', huaweiOrientation: 'nativeLandscape', customWidth: 763, customHeight: 378 };
  assert.deepEqual(resolvePreview(selected), { label: '华为 Pura 70 Pro+ · 横屏显示', width: 763, height: 378 });
  assert.deepEqual(resolvePageViewport(selected), { label: '华为 Pura 70 Pro+ · 横屏显示', width: 763, height: 378 });
  assert.equal(saveViewportForPreview(selected), 'phone');
  const desktop = { preset: 'desktop', huaweiOrientation: 'nativeLandscape', customWidth: 763, customHeight: 378 };
  const newlySelected = selectPreviewPreset(desktop, 'huaweiP70ProPlus');
  assert.equal(newlySelected.huaweiOrientation, 'rotatedPortrait');
  assert.equal(selectPreviewPreset(selected, 'desktop').huaweiOrientation, 'nativeLandscape');
});

test('phone and narrow custom previews enable mobile environment; desktop and tablet do not', () => {
  const base = readPreviewConfig(null, 'desktop');
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'mobilePortrait' }), true);
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'mobileLandscape' }), true);
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'huaweiP70ProPlus' }), true);
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'custom', customWidth: 420, customHeight: 900 }), true);
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'desktop' }), false);
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'tablet' }), false);
  assert.equal(shouldEmulateMobilePreview({ ...base, preset: 'custom', customWidth: 800, customHeight: 1000 }), false);
});

test('mobile preview URL keeps page parameters and adds an editor-only mode flag', () => {
  const url = previewUrlWithMobileEnvironment('editor-project://project/index.html?scene=2#page', true);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('scene'), '2');
  assert.equal(parsed.searchParams.get('__editor_mobile_preview'), '1');
  assert.equal(parsed.hash, '#page');
});
