import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const handlers={},controls=new Map(),history=[],board={name:'Test',motion:{},future:[]};
const $=id=>{if(!controls.has(id))controls.set(id,{value:'',addEventListener(type,fn){this[type]=fn}});return controls.get(id)};
const context=vm.createContext({
 nodes:[],selection:new Set(),selected:null,tool:'marquee',gesture:null,space:false,hovered:null,
 frame:{w:1920},camera:{x:0,y:0,z:1},view:{},structuredClone,history,editingText:null,
 stage:{style:{},setPointerCapture(){},addEventListener(type,fn){handlers[type]=fn}},
 $,local:e=>({x:e.clientX,y:e.clientY}),world:p=>p,sync(){},setTool(t){context.tool=t},
 snapshot(){history.push(JSON.stringify({nodes:context.nodes,camera:context.camera,view:context.view,background:'white'}))},
 beginPan(){context.gesture={kind:'pan'}},updateText(n){n.w=n.text.length*n.size*.5;n.h=n.size*1.25},
 motionDefaults:()=>({}),updateFrame(){},activeBoard:()=>board,renderBoardList(){},finishTextEdit(){},updateHistory(){},
});
vm.runInContext(source.slice(source.indexOf('function selectNodes('),source.indexOf('function paintSelection(')),context);
for(const name of ['state','cardContents','hit','resizeTarget'])vm.runInContext(source.match(new RegExp(`function ${name}\\([^\\n]+`))[0],context);
vm.runInContext(source.slice(source.indexOf("stage.addEventListener('pointerdown',e=>{"),source.indexOf('function zoomContent(')),context);
vm.runInContext(source.slice(source.indexOf("$('delete').onclick="),source.indexOf('// Object clipboard stays')),context);
function event(type,x,y,extra={}){handlers[type]({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){},...extra})}
function fixture(){context.nodes=[{id:'a',type:'image',x:0,y:0,w:100,h:100},{id:'b',type:'image',x:200,y:0,w:100,h:100},{id:'c',type:'rect',x:500,y:0,w:100,h:100}];context.selectNodes([]);context.gesture=null;history.length=0}
const ids=()=>[...context.selection].sort().join(',');
fixture();event('pointerdown',-30,-30);event('pointermove',320,130);event('pointerup',320,130);assert.equal(ids(),'a,b');assert.equal(history.length,0);
event('pointerdown',50,50,{ctrlKey:true});event('pointerup',50,50);assert.equal(ids(),'b');
event('pointerdown',50,50,{metaKey:true});event('pointerup',50,50);assert.equal(ids(),'a,b');
event('pointerdown',50,50);event('pointermove',75,80);event('pointerup',75,80);assert.equal(context.nodes[0].x,25);assert.equal(context.nodes[1].x,225);assert.equal(context.nodes[1].y,30);assert.equal(context.nodes[2].x,500);assert.equal(history.length,1);
$('undo').onclick();assert.equal(context.nodes[0].x,0);assert.equal(context.nodes[1].x,200);
fixture();context.selectNodes(['a','b']);event('pointerdown',300,100);event('pointermove',600,200);event('pointerup',600,200);assert.equal(context.nodes[0].w,200);assert.equal(context.nodes[1].x,400);assert.equal(context.nodes[1].h,200);assert.equal(context.nodes[2].w,100);assert.equal(history.length,1);
$('undo').onclick();assert.equal(context.nodes[1].x,200);assert.equal(context.nodes[0].w,100);
fixture();context.selectNodes(['c']);event('pointerdown',-30,-30,{ctrlKey:true});event('pointermove',320,130);event('pointerup',320,130);assert.equal(ids(),'a,b,c');
fixture();event('pointerdown',320,130);event('pointermove',-30,-30);event('pointerup',-30,-30);assert.equal(ids(),'a,b');
fixture();context.selectNodes(['a','b']);$('front').onclick();assert.equal(context.nodes.map(n=>n.id).join(','),'c,a,b');$('delete').onclick();assert.equal(context.nodes.map(n=>n.id).join(','),'c');$('undo').onclick();assert.equal(context.nodes.length,3);
context.nodes=[{id:'card',type:'rect',x:0,y:0,w:200,h:100},{id:'text',type:'text',containerId:'card',x:20,y:20,w:40,h:25,text:'test',size:20},{id:'draw',type:'draw',x:300,y:0,w:100,h:100,stroke:4,points:[{x:0,y:0},{x:100,y:100}]}];
context.selectNodes(['card','text','draw']);const originals=context.selectionItems().map(n=>({n,original:structuredClone(n)}));assert.equal(originals.length,3);
context.scaleSelection({original:context.selectionBounds(),corner:'se',items:originals},{x:800,y:200});assert.equal(context.nodes[1].size,40);assert.equal(context.nodes[1].x,40);assert.equal(context.nodes[2].stroke,8);assert.equal(context.nodes[2].points[1].x,200);
$('color').value='#123456';$('color').change();assert.ok(context.nodes.every(n=>n.color==='#123456'));
context.selectNodes(['card','draw']);event('pointerdown',50,50);event('pointermove',60,60);event('pointerup',60,60);assert.equal(ids(),'card,draw');assert.equal(context.nodes[0].x,10);assert.equal(context.nodes[1].x,50);
$('fontSize').value='30';$('fontSize').change();assert.equal(context.nodes[1].size,30);assert.equal(context.nodes[0].size,undefined);
console.log('Selection checks passed: box selection in both directions, Ctrl/Cmd toggles, additive box, group movement/scaling, undo, stacking, deletion, mixed styling, and card-child deduplication.');

// Exercise the production clipboard helpers against multi-selection and history.
Object.assign(context,{media:new Map(),crypto:globalThis.crypto,activeId:'board-one',status(){}});
$('delete').click=()=>$('delete').onclick();
vm.runInContext(source.slice(source.indexOf('let objectClipboard='),source.indexOf("const objectMenu=")),context);
fixture();context.selectNodes(['a','b']);context.copySelection();context.pasteSelection();
let copies=context.nodes.slice(3);assert.equal(copies.length,2);assert.equal(copies[0].x,24);assert.equal(copies[1].x-copies[0].x,200);assert.notEqual(copies[0].id,'a');assert.equal(context.selection.size,2);
context.pasteSelection();assert.equal(context.nodes[5].x,48);$('undo').onclick();assert.equal(context.nodes.length,5);
context.activeId='board-two';context.nodes=[];context.selectNodes([]);context.pasteSelection({x:700,y:800});assert.equal(context.nodes[0].x,700);assert.equal(context.nodes[0].y,800);
context.selectNodes(context.nodes.map(n=>n.id));context.copySelection(true);assert.equal(context.nodes.length,0);context.pasteSelection();assert.equal(context.nodes.length,2);
context.nodes=[{id:'card',type:'rect',x:0,y:0,w:200,h:100},{id:'child',containerId:'card',type:'text',text:'hi',x:20,y:20,w:20,h:20}];context.selectNodes(['card','child']);context.copySelection();context.pasteSelection();assert.equal(context.nodes.length,4);assert.equal(context.nodes[3].containerId,context.nodes[2].id);context.nodes[3].text='changed';assert.equal(context.nodes[1].text,'hi');
context.selectNodes(['child']);context.copySelection();context.pasteSelection();assert.equal(context.nodes.at(-1).containerId,undefined);
console.log('Clipboard checks passed: independent copies, repeated offsets, cross-canvas paste, cut, undo, card remapping, and detached child copies.');
