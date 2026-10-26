const { watch } = require('node:fs');

function watchProject(rootPath, changed) {
  let timer;
  const files = new Set();
  let watcher;
  try {
    watcher = watch(rootPath, { recursive: true }, (_event, filename) => {
      const relative = String(filename || '').replaceAll('\\', '/');
      if (!relative || relative.split('/').some(part => part.startsWith('.') || ['node_modules', 'snapshots'].includes(part))
        || !/\.(?:html?|css|m?js|cjs|json|svg|png|jpe?g|webp|gif|woff2?|mp3|wav|ogg)$/i.test(relative)) return;
      files.add(relative);
      clearTimeout(timer);
      timer = setTimeout(() => { const paths = [...files]; files.clear(); changed(paths); }, 500);
    });
    watcher.on('error', () => { watcher.close(); });
  } catch { return () => {}; }
  return () => { clearTimeout(timer); watcher.close(); };
}

module.exports = { watchProject };
