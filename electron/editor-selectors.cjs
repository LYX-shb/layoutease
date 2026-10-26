// Repair only selectors written by older editor versions. Keep the result state
// classes (wrong/correct) and device scopes, but anchor at a unique authored ID.
function stabilizeLegacySelector(selector, html) {
  const parts = String(selector).split(/\s*>\s*/);
  for (let index = parts.length - 1; index >= 0; index--) {
    const match = parts[index].match(/#([A-Za-z_][\w-]*)(?=[.:\s]|$)/);
    if (!match || !/:nth-child\(\d+\)/.test(parts[index])) continue;
    const id = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const authoredIds = html.match(new RegExp(`<[^>]+\\s+id\\s*=\\s*(["'])${id}\\1`, 'g')) || [];
    if (authoredIds.length !== 1) continue;
    parts[index] = parts[index].replace(/:nth-child\(\d+\)/g, '');
    return parts.slice(index).join(' > ');
  }
  return selector;
}

function repairLegacyEditorSelectors(html) {
  return html.replace(/<style\b[^>]*\sdata-editor-dynamic="[^"]+"[^>]*>([\s\S]*?)<\/style>/gi, (block, rules) => {
    const updated = rules.replace(/([^{}]+)\{/g, (opening, selector) => {
      if (selector.trim().startsWith('@')) return opening;
      const stable = stabilizeLegacySelector(selector.trim(), html);
      return stable === selector.trim() ? opening : opening.replace(selector.trim(), stable);
    });
    return block.replace(rules, updated);
  }).replace(/<script\b[^>]*\sdata-editor-dynamic-content="[^"]+"[^>]*>[\s\S]*?<\/script>/gi, (block) => {
    return block.replace(/"(selector|nestedSelector)":("(?:\\.|[^"\\])*")/g, (entry, key, value) => {
      try { return JSON.stringify(key) + ':' + JSON.stringify(stabilizeLegacySelector(JSON.parse(value), html)); }
      catch { return entry; }
    });
  });
}

module.exports = { repairLegacyEditorSelectors };
