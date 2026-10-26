const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {installCourseComponents}=require('../electron/course-components.cjs');
const definitions=[
  ['1:928',[],'5915081f51066562ea6787130c8042220867c339'],
  ['1:927',['1:587','1:588'],'b27288bb2baab6add46d067da2d795b32dd6f5b7'],
  ['1:929',['1:644','1:645'],'ec33476a3005f05312c5af8d36235be15dd60f25'],
  ['1:688',['1:701','1:702','1:703'],'39a3243c333e0fc752c6a504807b03467530fa34'],
  ['1:781',['1:794','1:795','1:796'],'39a3243c333e0fc752c6a504807b03467530fa34'],
  ['1:873',['1:890','1:891','1:892'],'39a3243c333e0fc752c6a504807b03467530fa34'],
];
function environment(){
  const dom=new JSDOM('<div id="scene"></div>',{runScripts:'outside-only'}),w=dom.window;
  w.FIGMA={scenes:definitions.map(([id,parts,asset])=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><defs><image id="im-${asset}" href="${asset}.webp"/></defs>${[id,...parts].map(node=>`<g transform="matrix(1 0 0 1 975 298)"><g data-node="${node}"><use href="#im-${asset}" transform="matrix(407 0 0 509 0 0)"/></g></g>`).join('')}</svg>`)};
  w.document.querySelector('#scene').innerHTML=w.FIGMA.scenes[0];return {dom,w};
}
test('verified basket states form one stable component including food and front rim',t=>{
  const {dom,w}=environment();t.after(()=>dom.window.close());
  const pins=[{nodes:['1:928']}];let retired=false;
  w.__editorLayoutRuntime={snapshot:()=>({svgPins:pins}),restore:value=>{assert.equal(w.document.querySelector('[data-editor-component]'),null);assert.equal(value.svgPins.length,0);retired=true}};
  w.eval('('+installCourseComponents.toString()+')()');
  assert.ok(retired);assert.deepEqual(w.__editorPendingSvgPins,pins);
  for(let i=0;i<6;i++){
    const template=w.document.createElement('template');template.innerHTML=w.FIGMA.scenes[i];
    const component=template.content.querySelector('[data-node="component-shopping-basket"]');
    assert.ok(component);assert.equal(component.querySelectorAll('g[data-node]').length,1+definitions[i][1].length);
    assert.ok(component.querySelector('[data-editor-component-bounds]'));
  }
});
test('component adapter leaves unrelated courses unchanged',t=>{
  const {dom,w}=environment();t.after(()=>dom.window.close());
  w.FIGMA.scenes[2]=w.FIGMA.scenes[2].replaceAll('ec33476a3005f05312c5af8d36235be15dd60f25','unrelated');
  const before=[...w.FIGMA.scenes];w.eval('('+installCourseComponents.toString()+')()');
  assert.deepEqual(w.FIGMA.scenes,before);assert.equal(w.__editorCourseComponents,undefined);
});
