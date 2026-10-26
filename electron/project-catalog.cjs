const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ignored = new Set(['node_modules', 'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information', 'appdata', 'vendor', 'snapshots']);
function catalogEntry(rootPath, entryPath, recent = false) {
  rootPath = path.resolve(rootPath);
  return {
    key: crypto.createHash('sha256').update(rootPath.toLowerCase() + '\0' + entryPath).digest('hex').slice(0, 24),
    name: path.basename(rootPath) || rootPath, rootPath, entryPath, recent,
  };
}

async function discoverProjects(roots, recent = [], { maxDirectories = 400, maxDepth = 2 } = {}) {
  const found = new Map();
  const seen = new Set();
  let scanned = 0;
  let limited = false;
  async function inspect(rootPath, depth, preferredEntry) {
    rootPath = path.resolve(rootPath);
    const key = rootPath.toLowerCase();
    if (seen.has(key)) return;
    if (scanned >= maxDirectories) { limited = true; return; }
    seen.add(key); scanned += 1;
    let entries;
    try {
      if ((await fs.lstat(rootPath)).isSymbolicLink()) return;
      entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch { return; }
    const html = entries.filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name)).map((entry) => entry.name).sort();
    const relative = typeof preferredEntry === 'string' ? preferredEntry : '';
    const target = path.resolve(rootPath, relative);
    let validPreferred = false;
    if (/\.html?$/i.test(relative) && target.startsWith(rootPath + path.sep)) {
      try { validPreferred = (await fs.lstat(target)).isFile(); } catch {}
    }
    const entryPath = validPreferred ? relative : html.find((name) => /^index\.html?$/i.test(name)) || html[0];
    if (entryPath) {
      const item = catalogEntry(rootPath, entryPath, Boolean(preferredEntry));
      found.set(item.key, item);
    }
    if (depth <= 0) return;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !ignored.has(entry.name.toLowerCase())) {
        await inspect(path.join(rootPath, entry.name), depth - 1);
      }
    }
  }
  for (const item of recent.slice(0, 30)) {
    if (typeof item?.rootPath === 'string') await inspect(item.rootPath, 0, item.entryPath);
  }
  for (const root of roots) if (typeof root === 'string') await inspect(root, maxDepth);
  return { items: [...found.values()], limited };
}

module.exports = { catalogEntry, discoverProjects };
