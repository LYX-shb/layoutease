const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repairLegacyEditorSelectors } = require('../electron/editor-selectors.cjs');

test('legacy saved result selectors survive inserted siblings and retain device and result scopes', () => {
  const selector = 'main#stage.answering:nth-child(2) > div#feedback.feedback.visible.wrong:nth-child(13) > img:nth-child(1)';
  const authored = `<style>${selector} {color:red}</style>`;
  const input = `${authored}<main id="stage"><div id="feedback"></div></main>
<style data-editor-dynamic="dynamic-old" data-editor-viewport="mobilePortrait">@media (max-width: 500px) { ${selector} { transform: translate(3px, -17px); } }</style>
<script data-editor-dynamic-content="old">apply({"selector":${JSON.stringify(selector)},"src":"./error.png"});</script>`;
  const repaired = repairLegacyEditorSelectors(input);
  assert.ok(repaired.includes(authored), 'authored styles are not rewritten');
  assert.match(repaired, /@media \(max-width: 500px\) \{ div#feedback\.feedback\.visible\.wrong > img:nth-child\(1\) \{ transform: translate\(3px, -17px\);/);
  assert.ok(repaired.includes('"selector":"div#feedback.feedback.visible.wrong > img:nth-child(1)"'));
  assert.equal(repairLegacyEditorSelectors(repaired), repaired, 'opening again makes no additional changes');
});

test('duplicate IDs and unrelated styles are left intact during legacy selector repair', () => {
  const input = '<div id="same"></div><div id="same"></div><style data-editor-dynamic="old">div#same:nth-child(2) > img:nth-child(1) {transform:translate(0,-10px)}</style>';
  assert.equal(repairLegacyEditorSelectors(input), input);
});
