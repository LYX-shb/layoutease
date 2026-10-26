// Serialized into saved HTML as well as the editor. Read only the course's
// explicit public state API or an exact match in its authored Figma scene list.
function installSceneProvider() {
  if (window.__editorSceneProvider?.version >= 3) return window.__editorSceneProvider;
  const sceneNodes = new WeakMap();
  let sceneSource, sceneSignatures = [];
  function signature(svg) {
    const copy = svg.cloneNode(true);
    for (const element of [copy, ...copy.querySelectorAll('*')]) {
      // Editor layout/selection styles do not change the authored scene identity.
      for (const attribute of [...element.attributes]) {
        if (attribute.name === 'style' || attribute.name.startsWith('data-editor-')) element.removeAttribute(attribute.name);
      }
    }
    return copy.outerHTML;
  }
  function figmaScene() {
    const scenes = window.FIGMA?.scenes;
    const svg = document.querySelector('#scene > svg');
    if (!Array.isArray(scenes) || !scenes.length || !svg) return;
    if (sceneSource !== scenes) {
      sceneSource = scenes;
      sceneSignatures = scenes.map(source => {
        if (typeof source !== 'string') return null;
        const template = document.createElement('template');
        template.innerHTML = source;
        const root = template.content.firstElementChild;
        return root?.matches('svg') ? signature(root) : null;
      });
    }
    let index = sceneNodes.get(svg);
    if (index === undefined) {
      index = sceneSignatures.indexOf(signature(svg));
      if (index >= 0 && sceneSignatures.lastIndexOf(sceneSignatures[index]) !== index) return;
      if (index >= 0) sceneNodes.set(svg, index);
    }
    return index >= 0 ? 'figma-scene-' + (index + 1) : undefined;
  }
  function sync() {
    try {
      let name;
      for (const provider of [window.CoursewareApp, window.CoursewareDebug]) {
        if (typeof provider?.getState !== 'function') continue;
        const state = provider.getState();
        const value = state?.phase || state?.name;
        if (typeof value === 'string' && value) { name = value; break; }
      }
      if (!name) name = figmaScene();
      const owner = document.querySelector('main');
      if (!owner) return;
      const owned = owner.getAttribute('data-editor-scene-owner') === 'course-state-api';
      if (typeof name !== 'string' || !name || name.length > 100) {
        if (owned) { owner.removeAttribute('data-phase'); owner.removeAttribute('data-editor-scene-owner'); }
        return;
      }
      if (!owned && ['phase', 'state', 'scene', 'step', 'page', 'slide', 'screen', 'question'].some(key => owner.hasAttribute('data-' + key))) return;
      if (!owned) owner.setAttribute('data-editor-scene-owner', 'course-state-api');
      if (owner.getAttribute('data-phase') !== name) owner.setAttribute('data-phase', name);
    } catch {}
  }
  window.__editorSceneProvider = { version: 3, sync };
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; sync(); });
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['hidden', 'class'] });
  for (const event of ['load', 'pageshow', 'click', 'pointerup']) window.addEventListener(event, schedule);
  sync();
  return window.__editorSceneProvider;
}

module.exports = { installSceneProvider };
