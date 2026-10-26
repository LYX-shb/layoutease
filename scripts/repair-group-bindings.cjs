// Prepare a reviewable repair without writing the lesson. Apply only after the
// original file still matches its recorded hash; keep the complete original.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { upsertLayoutDocument } = require('../electron/edit-scopes.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const dataPattern = /<script\b[^>]*data-editor-layout-data[^>]*>([\s\S]*?)<\/script>/i;

function repair(config) {
  const changes = [];
  const rootOf = selector => selector.match(/^(.*(?:button|div)\[data-group="[^"]+"\]\[data-index="[^"]+"\])(?: >.*)?$/)?.[1];
  for (const group of config.groups || []) {
    if (!['selected', 'all'].includes(group.sync)) continue;
    const original = [...group.members];
    const roots = original.map(rootOf);
    if (roots.some(root => !root) || new Set(roots).size !== roots.length) continue;
    const phase = group.states?.[0] || 'hint';
    for (const anchor of config.anchors || []) {
      if (!anchor.id.startsWith(group.id + ':')) continue;
      const index = Number(anchor.id.slice(group.id.length + 1));
      const root = roots[index];
      if (!root || anchor.positions?.length) continue;
      const source = original[index];
      const image = source === root ? root + ' > span.bee-motion > img' : source;
      const rules = config.edits.filter(edit => {
        if (edit.target !== image && !edit.target.startsWith(image + '[src=')) return false;
        const device = anchor.viewport === 'phone' ? ['desktop', 'mobilePortrait', 'mobileLandscape', 'phone'].includes(edit.viewport) : ['desktop', anchor.viewport].includes(edit.viewport);
        if (!device) return false;
        const states = edit.scene?.states || [...edit.selector.matchAll(/\[data-phase=("(?:[^"\\]|\\.)*")\]/g)].map(match => JSON.parse(match[1]));
        return !states.length || states.includes(phase);
      }).sort((a, b) => (a.viewport === 'desktop' ? 0 : a.viewport === 'phone' ? 2 : 1) - (b.viewport === 'desktop' ? 0 : b.viewport === 'phone' ? 2 : 1));
      const effective = Object.fromEntries(rules.map(edit => [edit.property, edit.value]));
      anchor.selector = root;
      anchor.reference = source === root ? 'subject' : 'visual';
      anchor.force = true;
      anchor.positions = [{ selector: 'img', translate: effective.translate || 'none', ...(effective.transform ? { transform: effective.transform } : {}) }];
      changes.push({ group: group.id, member: index, viewport: anchor.viewport, originalSelector: source, subject: root, reference: anchor.reference, positions: anchor.positions, baselineScene: phase });
    }
    if (changes.some(change => change.group === group.id)) group.members = roots;
  }
  return changes;
}

function main() {
  const [mode, input] = process.argv.slice(2);
  if (mode === '--prepare' && input) {
    const target = path.resolve(input), before = fs.readFileSync(target, 'utf8');
    const match = before.match(dataPattern);
    if (!match) throw Error('没有已保存的布局记录');
    const config = JSON.parse(match[1]);
    const changes = repair(config);
    if (!changes.length) throw Error('没有需要修复的混合组合记录');
    const after = upsertLayoutDocument(before, config);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-group-binding-repair-'));
    const backup = path.join(directory, 'original.html'), output = path.join(directory, 'repaired.html');
    fs.writeFileSync(backup, before); fs.writeFileSync(output, after);
    const manifest = path.join(directory, 'repair.json');
    fs.writeFileSync(manifest, JSON.stringify({ target, beforeHash: hash(before), afterHash: hash(after), backup, output, changes }, null, 2));
    console.log(JSON.stringify({ manifest, target, backup, count: changes.length, internalOffsets: changes.map(change => ({ member: change.member, viewport: change.viewport, baselineScene: change.baselineScene, translate: change.positions[0].translate })), editsPreserved: config.edits.length }, null, 2));
  } else if (mode === '--apply' && input) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
    const current = fs.readFileSync(manifest.target, 'utf8'), after = fs.readFileSync(manifest.output, 'utf8');
    if (hash(current) !== manifest.beforeHash) throw Error('课件在准备后已被修改，已取消写入，请重新准备修复');
    if (hash(after) !== manifest.afterHash || hash(fs.readFileSync(manifest.backup, 'utf8')) !== manifest.beforeHash) throw Error('修复文件或备份校验不符');
    fs.writeFileSync(manifest.target, after);
    console.log(JSON.stringify({ target: manifest.target, repairedMembers: manifest.changes.length, backup: manifest.backup }));
  } else throw Error('用法：--prepare <index.html> 或 --apply <repair.json>');
}
if (require.main === module) main();
module.exports = { repair };
