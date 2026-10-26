// A verified adapter for this course's exported component states. Asset hashes
// and node membership are checked before changing anything. No positional guess
// is used to associate unrelated artwork.
function installCourseComponents() {
  if (window.__editorCourseComponents?.version >= 1) return;
  const data = window.FIGMA;
  if (!Array.isArray(data?.scenes) || data.scenes.length !== 6) return;
  const bindings = [
    { node: '1:928', members: [], asset: '5915081f51066562ea6787130c8042220867c339', crop: [0, .1369472182596291, 1, .7353780313837375] },
    { node: '1:927', members: ['1:587', '1:588'], asset: 'b27288bb2baab6add46d067da2d795b32dd6f5b7', crop: [0, .006926406926406926, .9933920704845814, .9878787878787879] },
    { node: '1:929', members: ['1:644', '1:645'], asset: 'ec33476a3005f05312c5af8d36235be15dd60f25', crop: [.026243093922651933, 0, .9406077348066298, 1] },
    { node: '1:688', members: ['1:701', '1:702', '1:703'], asset: '39a3243c333e0fc752c6a504807b03467530fa34', crop: [0, 0, 1, .9974048442906575] },
    { node: '1:781', members: ['1:794', '1:795', '1:796'], asset: '39a3243c333e0fc752c6a504807b03467530fa34', crop: [0, 0, 1, .9974048442906575] },
    { node: '1:873', members: ['1:890', '1:891', '1:892'], asset: '39a3243c333e0fc752c6a504807b03467530fa34', crop: [0, 0, 1, .9974048442906575] },
  ];
  const templates = data.scenes.map(source => {
    const template = document.createElement('template'); template.innerHTML = source;
    return template.content.querySelector('svg');
  });
  const select = (root, id) => root?.querySelector('[data-node=' + JSON.stringify(id) + ']');
  const matrix = value => {
    const match = value?.match(/^matrix\(([^)]+)\)$/);
    const values = match?.[1].trim().split(/[ ,]+/).map(Number);
    return values?.length === 6 && values.every(Number.isFinite) ? values : null;
  };
  const prepared = bindings.map((binding, index) => {
    const root = templates[index], node = select(root, binding.node), use = node?.querySelector('use');
    if (!use || use.getAttribute('href') !== '#im-' + binding.asset) return null;
    const nodes = [binding.node, ...binding.members].map(id => select(root, id)?.parentElement);
    if (nodes.some(node => !node || node.parentElement !== root)) return null;
    const outer = matrix(node.parentElement.getAttribute('transform')), inner = matrix(use.getAttribute('transform'));
    if (!outer || !inner || outer[0] !== 1 || outer[3] !== 1 || outer[1] || outer[2] || inner[1] || inner[2]) return null;
    const [x, y, width, height] = binding.crop;
    return { root, nodes, box: [outer[4] + inner[4] + inner[0] * x, outer[5] + inner[5] + inner[3] * y, inner[0] * width, inner[3] * height] };
  });
  if (prepared.some(item => !item)) return;
  // Retire the old renderer's raw-node pins before introducing a component
  // viewport. Otherwise it can chase its own moving nested SVG bounds forever.
  const layout = window.__editorLayoutRuntime;
  if (layout?.snapshot && layout?.restore) {
    const saved = layout.snapshot();
    if (saved.svgPins?.length) {
      window.__editorPendingSvgPins = saved.svgPins;
      layout.restore({ ...saved, svgPins: [] });
    }
  }
  const rendered = document.querySelector('#scene > svg');
  const current = bindings.findIndex(binding => select(rendered, binding.node));
  prepared.forEach(({ root, nodes, box }) => {
    const component = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    component.setAttribute('data-node', 'component-shopping-basket');
    component.setAttribute('data-editor-component', 'shopping-basket');
    component.setAttribute('aria-label', '购物篮（包含篮内食品）');
    for (const [name, value] of [['x', box[0]], ['y', box[1]], ['width', box[2]], ['height', box[3]], ['viewBox', box.join(' ')]]) component.setAttribute(name, String(value));
    component.setAttribute('overflow', 'visible');
    const bounds = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bounds.setAttribute('data-editor-component-bounds', 'true');
    for (const [name, value] of [['x', box[0]], ['y', box[1]], ['width', box[2]], ['height', box[3]]]) bounds.setAttribute(name, String(value));
    bounds.setAttribute('fill', 'none'); bounds.setAttribute('pointer-events', 'none'); component.appendChild(bounds);
    const members = Array.from(root.children).filter(node => nodes.includes(node));
    members[0].before(component); members.forEach(node => component.appendChild(node));
  });
  data.scenes = prepared.map(item => item.root.outerHTML);
  if (current >= 0) rendered.replaceWith(prepared[current].root.cloneNode(true));
  window.__editorCourseComponents = { version: 1, bindings: bindings.map(binding => ({ node: binding.node, crop: binding.crop, component: 'component-shopping-basket' })) };
}

module.exports = { installCourseComponents };
