const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { repairLegacyEditorSelectors } = require('../electron/editor-selectors.cjs');

const target = path.resolve(process.argv[2] || '');
if (!/\.html?$/i.test(target)) throw new Error('请指定需要修复的 HTML 文件。');
const original = fs.readFileSync(target, 'utf8');
const updated = repairLegacyEditorSelectors(original);
if (updated === original) {
  console.log(JSON.stringify({ changed: false, target }));
} else {
  const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-selector-repair-'));
  const backup = path.join(backupDirectory, path.basename(target));
  fs.writeFileSync(backup, original, 'utf8');
  const staging = path.join(path.dirname(target), '.' + path.basename(target) + '.editor-' + process.pid);
  try {
    fs.writeFileSync(staging, updated, 'utf8');
    if (fs.readFileSync(target, 'utf8') !== original) throw new Error('文件正在被其他程序修改，已停止写入。');
    fs.renameSync(staging, target);
  } finally { if (fs.existsSync(staging)) fs.unlinkSync(staging); }
  console.log(JSON.stringify({ changed: true, target, backup }));
}
