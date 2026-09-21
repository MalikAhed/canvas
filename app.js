import { prepareLessonForm, appendDemoRow } from './lesson-form.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
const $=id=>document.getElementById(id), stage=$('stage'),ctx=stage.getContext('2d');
const output=document.createElement('canvas');output.width=1920;output.height=1080;const out=output.getContext('2d');
let selection=new Set();
let nodes=[],selected=null,tool='select',camera={x:0,y:0,z:1},view={x:0,y:0,z:1},baseScale=1,frame={},W=0,H=0,gesture=null,space=false,history=[],recorder=null,recording=false,started=0,chunks=[],micStream=null,downloadUrl=null,captureStream=null;
const recordingCanvas=document.createElement('canvas'),recordingContext=recordingCanvas.getContext('2d');
const resolutions={360:[640,360],480:[854,480],720:[1280,720],1080:[1920,1080]};
let restoringLocal=false,localReady=false,localDatabase=null,localSaveTimer=null,localSaving=false,localDirty=false,localSaveFailed=false;
const media=new Map();
let audioContext=null,audioDestination=null,micAudioNode=null;const audioSources=new Map();
let faceClip=null,spacePending=false,spaceDragged=false;
let webcamStream=null,webcamLayout={x:1480,y:640,size:360},webcamGesture=null,webcamLocked=false;
const LESSON_LAYOUT_VERSION=11;
let installedLessons=[],starterLessonDismissed=false,lessonSourceVersion=0;
let editingText=null,transition=null;const motionDefaults=()=>({intro:'none',outro:'none',duration:.6});
let boards=[{id:crypto.randomUUID(),name:'Canvas 1',nodes,camera,background:'#ffffff',history,future:[],motion:motionDefaults()}],activeId=boards[0].id,hovered=null,lastPreview=0;
function activeBoard(){return boards.find(b=>b.id===activeId)}
function storeBoard(){const b=activeBoard();Object.assign(b,{nodes,camera,background:$('background').value,history})}
function switchBoard(id){if(id===activeId)return;resetHighlight();finishTextEdit();endGesture();storeBoard();const b=boards.find(b=>b.id===id);if(!b)return;const previous=activeBoard();startTransition(previous,b);activeId=id;nodes=b.nodes;camera=b.camera;history=b.history;selectNodes([]);hovered=null;$('background').value=b.background;sync();renderBoardList();status(b.name+(recording?' · Recording':''))}
function renderBoardList(){
  clearBoardDrag();
  $('boardList').replaceChildren();
  boards.forEach(b=>{const item=document.createElement('div');item.className='board-preview-item';const button=document.createElement('button');button.className='board-preview';button.setAttribute('aria-label','Switch to '+b.name);button.setAttribute('aria-current',String(b.id===activeId));button.dataset.boardId=b.id;button.title='Drag to reorder · Alt + Left/Right to move';const c=document.createElement('canvas');c.width=192;c.height=108;const label=document.createElement('span');label.textContent=b.name;const remove=document.createElement('button');remove.className='board-delete';remove.type='button';remove.dataset.deleteBoard=b.id;remove.setAttribute('aria-label','Delete '+b.name);remove.title='Delete canvas';remove.textContent='×';button.append(c,label);button.onclick=()=>switchBoard(b.id);remove.onclick=e=>{e.stopPropagation();deleteBoard(b.id)};item.append(button,remove);$('boardList').append(item)});
  $('boardList').querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});paintPreviews();
}
let boardDrag=null,suppressBoardClick=false;
function clearBoardDrag(){
 const drag=boardDrag;if(!drag)return;boardDrag=null;
 cancelAnimationFrame(drag.raf);drag.ghost?.remove();drag.button.classList.remove('reordering');
 $('boardList').querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
 if(drag.button.hasPointerCapture(drag.pointerId))drag.button.releasePointerCapture(drag.pointerId);
 if(drag.started){suppressBoardClick=true;setTimeout(()=>{suppressBoardClick=false},0)}
 return drag;
}
function reorderBoard(id,index){
 const from=boards.findIndex(b=>b.id===id);if(from<0)return;
 index=Math.max(0,Math.min(boards.length-1,index));if(from===index)return;
 storeBoard();const [board]=boards.splice(from,1);boards.splice(index,0,board);
 const scroll=$('boardList').scrollLeft;renderBoardList();$('boardList').scrollLeft=scroll;
 const button=[...$('boardList').querySelectorAll('.board-preview')].find(el=>el.dataset.boardId===id);
 button?.scrollIntoView({block:'nearest',inline:'nearest'});button?.focus({preventScroll:true});
 scheduleLocalSave();status(`${board.name} moved to position ${index+1} of ${boards.length}`);
}
function updateBoardDrop(){
 const drag=boardDrag;if(!drag?.started)return;
 const list=$('boardList'),rect=list.getBoundingClientRect();
 drag.valid=drag.x>=rect.left-24&&drag.x<=rect.right+24&&drag.y>=rect.top-24&&drag.y<=rect.bottom+24;
 const buttons=[...list.querySelectorAll('.board-preview')].filter(el=>el!==drag.button);
 list.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
 drag.index=buttons.findIndex(el=>{const r=el.getBoundingClientRect();return drag.x<r.left+r.width/2});
 if(drag.index<0)drag.index=buttons.length;
 if(drag.valid){if(buttons[drag.index])buttons[drag.index].classList.add('drop-before');else buttons.at(-1)?.classList.add('drop-after')}
 drag.ghost.style.left=(drag.x-drag.offsetX)+'px';drag.ghost.style.top=(drag.y-drag.offsetY)+'px';
}
function scrollBoardDrag(){
 const drag=boardDrag;if(!drag?.started)return;
 const list=$('boardList'),rect=list.getBoundingClientRect();
 if(drag.valid){const edge=Math.min(28,rect.width/3);list.scrollLeft+=drag.x<rect.left+edge?-8:drag.x>rect.right-edge?8:0}
 updateBoardDrop();drag.raf=requestAnimationFrame(scrollBoardDrag);
}
$('boardList').addEventListener('pointerdown',e=>{
 const button=e.target.closest('.board-preview');if(!button||e.button!==0||boardDrag)return;
 const rect=button.getBoundingClientRect();
 boardDrag={button,id:button.dataset.boardId,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top,started:false};
 button.setPointerCapture(e.pointerId);
});
$('boardList').addEventListener('pointermove',e=>{
 const drag=boardDrag;if(!drag||drag.pointerId!==e.pointerId)return;drag.x=e.clientX;drag.y=e.clientY;
 if(!drag.started){
  if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
  drag.started=true;const rect=drag.button.getBoundingClientRect();drag.ghost=drag.button.cloneNode(true);
  drag.ghost.removeAttribute('data-board-id');drag.ghost.removeAttribute('aria-current');drag.ghost.setAttribute('aria-hidden','true');drag.ghost.tabIndex=-1;
  drag.ghost.classList.add('board-drag-ghost');Object.assign(drag.ghost.style,{width:rect.width+'px',height:rect.height+'px'});
  drag.ghost.querySelector('canvas').getContext('2d').drawImage(drag.button.querySelector('canvas'),0,0);
  document.body.append(drag.ghost);drag.button.classList.add('reordering');updateBoardDrop();scrollBoardDrag();
 }
 e.preventDefault();updateBoardDrop();
});
$('boardList').addEventListener('pointerup',e=>{
 if(boardDrag?.pointerId!==e.pointerId)return;
 if(boardDrag.started){boardDrag.x=e.clientX;boardDrag.y=e.clientY;updateBoardDrop()}
 const drag=clearBoardDrag();if(drag?.started&&drag.valid)reorderBoard(drag.id,drag.index);
});
$('boardList').addEventListener('pointercancel',()=>clearBoardDrag());
$('boardList').addEventListener('lostpointercapture',()=>clearBoardDrag());
$('boardList').addEventListener('click',e=>{if(suppressBoardClick){e.preventDefault();e.stopImmediatePropagation()}},true);
$('boardList').addEventListener('dragstart',e=>e.preventDefault());
$('boardList').addEventListener('keydown',e=>{
 const button=e.target.closest('.board-preview');if(!button||!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;
 e.preventDefault();e.stopPropagation();reorderBoard(button.dataset.boardId,boards.findIndex(b=>b.id===button.dataset.boardId)+(e.key==='ArrowLeft'?-1:1));
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&boardDrag){e.preventDefault();e.stopImmediatePropagation();clearBoardDrag()}},true);
window.addEventListener('blur',()=>clearBoardDrag());
function paintPreviews(){storeBoard();$('boardList').querySelectorAll('.board-preview').forEach(button=>{const b=boards.find(b=>b.id===button.dataset.boardId),c=button.querySelector('canvas').getContext('2d');c.fillStyle=b.background;c.fillRect(0,0,192,108);drawScene(c,b.camera.z/10,96,54,b.nodes,b.camera)})}
$('addBoard').onclick=()=>{storeBoard();let i=boards.length+1;while(boards.some(b=>b.name==='Canvas '+i))i++;const b={id:crypto.randomUUID(),name:'Canvas '+i,nodes:[],camera:{x:0,y:0,z:1},background:'#ffffff',history:[],future:[],motion:motionDefaults()};boards.push(b);switchBoard(b.id)};
function deleteBoard(id){
 if(boards.length===1){status('Keep at least one canvas in the project');return}
 const index=boards.findIndex(b=>b.id===id);if(index<0)return;
 const [removed]=boards.splice(index,1);
 for(const n of removed.nodes){const source=audioSources.get(n.id);source?.source.disconnect();source?.gain.disconnect();audioSources.delete(n.id);const item=media.get(n.id);if(item instanceof HTMLVideoElement){item.pause();item.srcObject?.getTracks().forEach(t=>t.stop())}media.delete(n.id)}
 if(activeId===id){const next=boards[Math.min(index,boards.length-1)];activeId=next.id;nodes=next.nodes;camera=next.camera;history=next.history;$('background').value=next.background;selectNodes([]);hovered=null}
 closeBoardMenu();renderBoardList();sync();scheduleLocalSave();status(removed.name+' deleted');
}
function closeBoardMenu(){$('boardMenu').hidden=true;delete $('boardMenu').dataset.boardId}
$('boardList').addEventListener('contextmenu',e=>{const button=e.target.closest('.board-preview');if(!button)return;e.preventDefault();closeObjectMenu();const menu=$('boardMenu');menu.dataset.boardId=button.dataset.boardId;menu.hidden=false;const x=Math.min(e.clientX,innerWidth-menu.offsetWidth-8),y=Math.min(e.clientY,innerHeight-menu.offsetHeight-8);menu.style.left=Math.max(8,x)+'px';menu.style.top=Math.max(8,y)+'px';menu.querySelector('button').focus()});
$('boardMenu').onclick=e=>{if(e.target.closest('[data-board-action="delete"]'))deleteBoard($('boardMenu').dataset.boardId)};
window.addEventListener('pointerdown',e=>{if(!$('boardMenu').hidden&&!$('boardMenu').contains(e.target))closeBoardMenu()},true);
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeBoardMenu()});

const gridTile=document.createElement('canvas');gridTile.width=40;gridTile.height=40;const gridCtx=gridTile.getContext('2d');gridCtx.fillStyle='#d4e1e8';gridCtx.beginPath();gridCtx.arc(1,1,.8,0,Math.PI*2);gridCtx.fill();const gridPattern=ctx.createPattern(gridTile,'repeat');
let statusTimer;function status(s){$('status').textContent=s;const error=/could not|unavailable|failed|declined|no video|needs a browser/i.test(s);$('status').className=error?'error-toast':'sr-only';clearTimeout(statusTimer);if(error)statusTimer=setTimeout(()=>$('status').className='sr-only',8000)}
function state(){return JSON.stringify({nodes,camera,view,background:$('background').value,name:activeBoard().name,motion:activeBoard().motion})}
function snapshot(){const value=state();if(history.at(-1)!==value)history.push(value);if(history.length>60)history.shift();activeBoard().future=[];updateHistory()}
function updateHistory(){$('undo').disabled=!history.length;$('redo').disabled=!activeBoard().future?.length}
function sync(){
 selectNodes([...selection].filter(id=>nodes.some(n=>n.id===id)));
 scheduleLocalSave();
 if(document.activeElement!==$('boardNotes'))$('boardNotes').value=activeBoard().notes||'';
 $('boardNotesTitle').textContent=activeBoard().name+' · Notes';
 const items=selectionNodes(),n=items[0],single=items.length===1?n:null;$('empty').hidden=nodes.length>0||!!webcamStream||!!faceClip;$('delete').disabled=!n;$('front').disabled=!n;$('clearCanvas').disabled=recording||recordingBusy;
 syncPdfControls(single);syncMediaControls(single);$('selectionTitle').textContent=items.length>1?`${items.length} objects selected`:n?({text:'Text',image:'Image',rect:'Card',screen:'Live screen',video:'Video',arrow:'Arrow',draw:'Drawing'}[n.type]):'Drawing style';
 $('textStyle').hidden=!!n&&!items.some(n=>n.type==='text');$('strokeLabel').hidden=!!n&&!items.some(n=>['draw','arrow'].includes(n.type));
 if(n){const colored=items.find(n=>n.color),text=items.find(n=>n.type==='text'),stroked=items.find(n=>['draw','arrow'].includes(n.type));if(colored)$('color').value=colored.color;if(text){$('fontSize').value=Math.round(text.size);$('fontFamily').value=text.font||'DM Sans';$('fontWeight').value=text.weight||'500'}if(stroked)$('stroke').value=stroked.stroke}
 $('strokeValue').textContent=$('stroke').value+' px';$('boardName').value=activeBoard().name;syncMotion();updateHistory();
}
// The view positions the recording frame on screen; camera controls its contents.
// Export uses camera only, so navigating the workspace never changes the video.
function updateFrame(){
  const w=1920*baseScale*view.z,h=w*9/16;
  frame={x:W/2+view.x*baseScale-w/2,y:(H-90)/2+view.y*baseScale-h/2,w,h};
  Object.assign($('frame').style,{left:frame.x+'px',top:frame.y+'px',width:w+'px',height:h+'px'});
  Object.assign($('empty').style,{left:(frame.x+w/2)+'px',top:(frame.y+h/2)+'px',width:Math.min(w*.9,600)+'px'});
  Object.assign(document.querySelector('.canvas-strip').style,{left:(frame.x+w/2)+'px',top:(frame.y+h+10)+'px',maxWidth:w+'px'});$('zoomValue').textContent=Math.round(view.z*100)+'%';
}
function resize(){const r=$('workspace').getBoundingClientRect();W=r.width;H=r.height;const d=devicePixelRatio||1;stage.width=W*d;stage.height=H*d;baseScale=Math.max(80,Math.min(W*.78,(H-220)*16/9))/1920;updateFrame()}
new ResizeObserver(resize).observe($('workspace'));
function world(p){const s=frame.w/1920*camera.z;return{x:(p.x-frame.x-frame.w/2)/s+camera.x,y:(p.y-frame.y-frame.h/2)/s+camera.y}}
function insideFrame(p){return p.x>=frame.x&&p.x<=frame.x+frame.w&&p.y>=frame.y&&p.y<=frame.y+frame.h}
function beginPan(p){if(insideFrame(p)){snapshot();gesture={kind:'contentPan',p,camera:{...camera}}}else gesture={kind:'pan',p,view:{...view}};stage.style.cursor='grabbing'}
function local(e){const r=stage.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function setTool(t){tool=t;document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===t);b.setAttribute('aria-pressed',String(b.dataset.tool===t))});stage.style.cursor=t==='pan'||t==='select'?'grab':'crosshair'}
function selectNodes(ids){const root=nodes.find(n=>n.demoRole==='interfaceRoot');ids=[...ids].flatMap(id=>nodes.find(n=>n.id===id)?.demoPart?(root&&!$('formDemo').checked?[root.id]:[]):[id]);selection=new Set(ids);selected=selection.values().next().value||null}
function selectionNodes(){return nodes.filter(n=>selection.has(n.id))}
function selectionItems(){
 const ids=new Set();for(const n of selectionNodes())for(const item of cardContents(n))ids.add(item.n.id);
 return nodes.filter(n=>ids.has(n.id));
}
function combinedBounds(items){
 if(!items.length)return null;
 const x=Math.min(...items.map(n=>n.x)),y=Math.min(...items.map(n=>n.y));
 return {x,y,w:Math.max(...items.map(n=>n.x+n.w))-x,h:Math.max(...items.map(n=>n.y+n.h))-y};
}
function selectionBounds(){return combinedBounds(selection.size>1?selectionItems():selectionNodes())}
function boxContains(b,p){return b&&p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h}
function marqueeSelection(g,p){
 const box={x:Math.min(g.p.x,p.x),y:Math.min(g.p.y,p.y),w:Math.abs(p.x-g.p.x),h:Math.abs(p.y-g.p.y)};
 g.current=p;const ids=new Set(g.initial);
 if(box.w>0&&box.h>0)for(const n of nodes)if(n.x<=box.x+box.w&&n.x+n.w>=box.x&&n.y<=box.y+box.h&&n.y+n.h>=box.y)ids.add(n.id);
 selectNodes(ids);sync();
}
function scaleSelection(g,p){
 const o=g.original,left=g.corner.includes('w'),top=g.corner.includes('n'),ax=left?o.x+o.w:o.x,ay=top?o.y+o.h:o.y;
 const f=Math.max(.05,Math.max((left?ax-p.x:p.x-ax)/Math.max(o.w,1),(top?ay-p.y:p.y-ay)/Math.max(o.h,1)));
 for(const {n,original:a} of g.items){
  n.x=ax+(a.x-ax)*f;n.y=ay+(a.y-ay)*f;n.w=a.w*f;n.h=a.h*f;
  if(n.type==='text'){n.size=a.size*f;updateText(n)}
  if(n.type==='draw')n.points=a.points.map(q=>({x:q.x*f,y:q.y*f}));
  if(a.stroke)n.stroke=a.stroke*f;if(a.radius!==undefined)n.radius=a.radius*f;if(a.borderWidth)n.borderWidth=a.borderWidth*f;
 }
}
function paintSelection(s){
 const items=selectionNodes(),b=selectionBounds()||bounds(nodes.find(n=>n.id===hovered)||{x:0,y:0,w:0,h:0});
 const screen=p=>({x:frame.x+frame.w/2+(p.x-camera.x)*s,y:frame.y+frame.h/2+(p.y-camera.y)*s});
 ctx.save();ctx.lineWidth=1;
 if(items.length>1){ctx.strokeStyle='#8ac7df';for(const n of items){const p=screen(n);ctx.strokeRect(p.x,p.y,n.w*s,n.h*s)}}
 if((items.length||hovered)&&!(items.length===1&&items[0].id===editingText?.id)){
  const p=screen(b);ctx.strokeStyle=items.length?'#248dc1':'#8ac7df';ctx.strokeRect(p.x-3,p.y-3,b.w*s+6,b.h*s+6);ctx.fillStyle='white';
  for(const [x,y] of [[p.x,p.y],[p.x+b.w*s,p.y],[p.x,p.y+b.h*s],[p.x+b.w*s,p.y+b.h*s]]){ctx.fillRect(x-4,y-4,8,8);ctx.strokeRect(x-4,y-4,8,8)}
 }
 if(gesture?.kind==='marquee'){
  const a=screen(gesture.p),z=screen(gesture.current||gesture.p);ctx.fillStyle='#248dc120';ctx.strokeStyle='#248dc1';ctx.setLineDash([5,3]);
  ctx.fillRect(a.x,a.y,z.x-a.x,z.y-a.y);ctx.strokeRect(a.x,a.y,z.x-a.x,z.y-a.y);
 }
 ctx.restore();
}
function bounds(n){return{x:n.x,y:n.y,w:n.w,h:n.h}}
function paintNode(c,n){c.save();c.translate(n.x,n.y);c.fillStyle=n.color||'#248dc1';c.strokeStyle=n.color||'#248dc1';c.lineWidth=n.stroke||6;c.lineCap='round';c.lineJoin='round';if(n.pdf){paintPdf(c,n)}else if(n.type==='image'||n.type==='screen'||n.type==='video'){const img=media.get(n.pdf?n.src:n.id);if(img&&(n.type==='image'||img.readyState>=2))c.drawImage(img,0,0,n.w,n.h)}else if(n.type==='rect'){c.beginPath();c.roundRect(0,0,n.w,n.h,Math.min(n.radius??20,n.w/2,n.h/2));c.fill();if(n.demoFlashUntil>Date.now()){c.save();c.globalAlpha=Math.min(1,(n.demoFlashUntil-Date.now())/1200)*.5;c.fillStyle='#ffd43b';c.fill();c.restore()}if(n.border){c.strokeStyle=n.border;c.lineWidth=n.borderWidth||2;c.stroke()}}else if(n.type==='text'){c.font=textFont(n);c.textBaseline=n.verticalAlign==='middle'?'middle':'top';c.direction=textDirection(n);c.textAlign=c.direction==='rtl'?'right':'left';n.text.split('\n').forEach((line,i)=>c.fillText(line,c.direction==='rtl'?n.w:0,n.verticalAlign==='middle'?n.h/2:i*n.size*1.25,...(n.demoRole?[n.w]:[])))}else if(n.type==='arrow'){const a=n.flipX?n.w:0,b=n.flipY?n.h:0,x=n.flipX?0:n.w,y=n.flipY?0:n.h,angle=Math.atan2(y-b,x-a),head=Math.max(22,n.stroke*4);c.beginPath();c.moveTo(a,b);c.lineTo(x,y);c.stroke();c.beginPath();c.moveTo(x,y);c.lineTo(x-head*Math.cos(angle-.45),y-head*Math.sin(angle-.45));c.lineTo(x-head*Math.cos(angle+.45),y-head*Math.sin(angle+.45));c.closePath();c.fill()}else if(n.type==='draw'){c.beginPath();n.points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke()}c.restore()}
function drawScene(c,scale,cx,cy,sceneNodes=nodes,sceneCamera=camera){c.save();c.translate(cx,cy);c.scale(scale,scale);c.translate(-sceneCamera.x,-sceneCamera.y);sceneNodes.forEach(n=>{if(c!==ctx||n.id!==editingText?.id)paintNode(c,n)});c.restore()}
function render(){updateAudioRouting();positionTextEditor();positionWebcam();const d=devicePixelRatio||1;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,W,H);ctx.fillStyle='#d4e1e8';const s=frame.w/1920*camera.z,grid=40;const ox=((frame.x+frame.w/2-camera.x*s)%grid+grid)%grid,oy=((frame.y+frame.h/2-camera.y*s)%grid+grid)%grid;ctx.save();ctx.translate(ox,oy);ctx.fillStyle=gridPattern;ctx.fillRect(-ox,-oy,W,H);ctx.restore();ctx.fillStyle=$('background').value;ctx.fillRect(frame.x,frame.y,frame.w,frame.h);drawScene(ctx,s,frame.x+frame.w/2,frame.y+frame.h/2);paintSelection(s);if(recording||transition){const animated=!!transition;paintRecording(out);paintHighlights(out,camera.z,960,540);drawWebcam(out);drawRecordingCursor(out);if(animated){ctx.save();ctx.beginPath();ctx.rect(frame.x,frame.y,frame.w,frame.h);ctx.clip();ctx.drawImage(output,frame.x,frame.y,frame.w,frame.h);ctx.restore()}}paintHighlights(ctx,s,frame.x+frame.w/2,frame.y+frame.h/2);if(recording){const sec=Math.floor(recordedMilliseconds()/1000);$('timer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}if(performance.now()-lastPreview>180){paintPreviews();lastPreview=performance.now()}requestAnimationFrame(render)}
function add(n,target=activeBoard()){
  n.id=crypto.randomUUID();
  if(!boards.includes(target))return n;
  if(target===activeBoard()){snapshot();nodes.push(n);selectNodes([n.id]);sync()}
  else{target.future=[];target.history.push(JSON.stringify({nodes:target.nodes,camera:target.camera,view,background:target.background}));target.nodes.push(n)}
  return n;
}
function textDirection(n){return n.direction||(/[\u0590-\u08ff]/.test(n.text)?'rtl':'ltr')}
function textFont(n){const family=n.font==='monospace'?'monospace':`"${n.font||'DM Sans'}", "Lesson Latin", sans-serif`;return `${n.weight||500} ${n.size}px ${family}`}
function updateText(n){if(['name','grade'].includes(n.demoRole)){const box=nodes.find(b=>b.demoRole===n.demoRole+'Box');if(box){const scale=box.w/355;n.x=box.x+24*scale;n.y=box.y+20*scale;n.w=box.w-48*scale;n.h=n.size*1.25;return}}ctx.font=textFont(n);n.w=Math.max(60,...n.text.split('\n').map(t=>ctx.measureText(t).width));n.h=n.text.split('\n').length*n.size*1.25}
function cardContents(n){const ids=new Set([n.id]);if(n.type==='rect'){let size;do{size=ids.size;for(const item of nodes)if(ids.has(item.containerId))ids.add(item.id)}while(size!==ids.size)}return nodes.filter(item=>ids.has(item.id)).map(item=>({n:item,x:item.x,y:item.y}))}
function hit(p,padding=10){const n=[...nodes].reverse().find(n=>p.x>=n.x-padding&&p.x<=n.x+n.w+padding&&p.y>=n.y-padding&&p.y<=n.y+n.h+padding);return n?.demoPart&&!$('formDemo').checked?(nodes.find(n=>n.demoRole==='interfaceRoot')||n):n}
stage.addEventListener('pointerdown',e=>{
 if(e.button!==0&&e.button!==1)return;stage.setPointerCapture(e.pointerId);const q=local(e),p=world(q);
 if(space||e.button===1){if(space)spaceDragged=true;beginPan(q);return}
 const existing=hit(p),additive=e.ctrlKey||e.metaKey;
 if(!additive&&$('formDemo').checked&&existing?.demoRole){const role=existing.demoRole;if(['name','grade','nameBox','gradeBox'].includes(role)){const field=nodes.find(n=>n.demoRole===role.replace('Box',''));if(field){e.preventDefault();startTextEdit(field,true);return}}if(['add','addBox'].includes(role)){e.preventDefault();finishTextEdit();snapshot();const result=appendDemoRow(nodes);status(result.error||'تمت إضافة الطالب إلى الجدول');selectNodes([]);sync();scheduleLocalSave();return}}
 if($('formDemo').checked&&existing?.demoPart){e.preventDefault();selectNodes([]);hovered=null;sync();return}
 if(additive&&existing){const ids=new Set(selection);if(ids.has(existing.id))ids.delete(existing.id);else ids.add(existing.id);selectNodes(ids);sync();return}
 const corner=!additive&&resizeTarget(p);
 if(corner){sync();snapshot();gesture={kind:'resize',p,corner:corner.corner,original:selectionBounds(),items:(selection.size>1||selectionNodes()[0]?.demoRole==='interfaceRoot'?selectionItems():selectionNodes()).map(n=>({n,original:structuredClone(n)}))};stage.style.cursor=corner.cursor;return}
 if(existing||(!additive&&selection.size>1&&boxContains(selectionBounds(),p))){
  if(existing&&!selection.has(existing.id)&&!(selection.size>1&&selectionItems().some(n=>n.id===existing.id)))selectNodes([existing.id]);sync();snapshot();
  gesture={kind:'move',p,items:selectionItems().map(n=>({n,x:n.x,y:n.y}))};stage.style.cursor='grabbing';return;
 }
 if(tool==='marquee'||additive){gesture={kind:'marquee',p,current:p,initial:additive?[...selection]:[]};selectNodes(gesture.initial);sync();return}
 if(tool==='text'){e.preventDefault();const n=add({type:'text',x:p.x,y:p.y,text:'Your text',size:+$('fontSize').value,font:$('fontFamily').value,weight:$('fontWeight').value,color:$('color').value});updateText(n);sync();setTool('select');startTextEdit(n,true);return}
 if(tool==='arrow'||tool==='draw'){gesture={kind:'pendingCreate',p,q,tool,color:$('color').value,stroke:+$('stroke').value};return}
 selectNodes([]);sync();beginPan(q);
});
stage.addEventListener('pointermove',e=>{if(!gesture){const p=world(local(e)),corner=resizeTarget(p);const over=hit(p);hovered=$('formDemo').checked&&over?.demoPart?null:over?.id||null;if($('formDemo').checked&&over?.demoPart){stage.style.cursor=/^(name|grade)(Box)?$/.test(over.demoRole)?'text':/^(add)(Box)?$/.test(over.demoRole)?'pointer':'default';return}stage.style.cursor=space?'grab':corner?corner.cursor:hovered?($('formDemo').checked&&nodes.find(n=>n.id===hovered)?.demoRole?.match(/^(name|grade|add)(Box)?$/)?'pointer':'move'):tool==='text'?'text':tool==='draw'||tool==='arrow'||tool==='marquee'?'crosshair':'grab';return}const g=gesture,p=world(local(e));if(g.kind==='pendingCreate'){const q=local(e);if(Math.hypot(q.x-g.q.x,q.y-g.q.y)<5)return;g.n=add({type:g.tool,x:g.p.x,y:g.p.y,w:1,h:1,color:g.color,stroke:g.stroke,...(g.tool==='draw'?{points:[{x:0,y:0}]}:{})});g.kind='create'}if(g.kind==='marquee'){marqueeSelection(g,p)}else if(g.kind==='contentPan'){const q=local(e),scale=frame.w/1920*camera.z;camera.x=g.camera.x-(q.x-g.p.x)/scale;camera.y=g.camera.y-(q.y-g.p.y)/scale}else if(g.kind==='pan'){const q=local(e);view.x=g.view.x+(q.x-g.p.x)/baseScale;view.y=g.view.y+(q.y-g.p.y)/baseScale;updateFrame()}else if(g.kind==='move'){for(const item of g.items){item.n.x=item.x+p.x-g.p.x;item.n.y=item.y+p.y-g.p.y}}else if(g.kind==='resize'){scaleSelection(g,p)}else if(g.kind==='create'){const n=g.n;if(n.type==='arrow'){n.x=Math.min(p.x,g.p.x);n.y=Math.min(p.y,g.p.y);n.w=Math.abs(p.x-g.p.x);n.h=Math.abs(p.y-g.p.y);n.flipX=p.x<g.p.x;n.flipY=p.y<g.p.y}else{n.points.push({x:p.x-g.p.x,y:p.y-g.p.y})}}});
function endGesture(){if(gesture?.kind==='pendingCreate'){selectNodes([]);hovered=null;setTool('select')}if(gesture?.kind==='create'&&gesture.n.type==='draw'){const n=gesture.n,minX=Math.min(...n.points.map(p=>p.x)),minY=Math.min(...n.points.map(p=>p.y));n.w=Math.max(1,...n.points.map(p=>p.x-minX));n.h=Math.max(1,...n.points.map(p=>p.y-minY));n.x+=minX;n.y+=minY;n.points=n.points.map(p=>({x:p.x-minX,y:p.y-minY}))}gesture=null;setTool(tool);sync()}
stage.addEventListener('pointerleave',()=>{hovered=null});stage.addEventListener('pointerup',endGesture);stage.addEventListener('pointercancel',endGesture);
function zoomContent(f,p){const before=world(p);camera.z=Math.max(.08,Math.min(8,camera.z*f));const after=world(p);camera.x+=before.x-after.x;camera.y+=before.y-after.y;status('Content zoom · '+Math.round(camera.z*100)+'%')}
function zoomView(f,p={x:W/2,y:(H-90)/2}){
  const z=Math.max(.08,Math.min(8,view.z*f)),ratio=z/view.z;
  view.x=(p.x+(frame.x+frame.w/2-p.x)*ratio-W/2)/baseScale;
  view.y=(p.y+(frame.y+frame.h/2-p.y)*ratio-(H-90)/2)/baseScale;
  view.z=z;updateFrame();
}
stage.addEventListener('wheel',e=>{e.preventDefault();if(gesture)return;const p=local(e),n=hit(world(p),0);if(n?.pdf){scrollPdf(n,e);return}const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?H:1),f=Math.exp(-delta*.0015);if(insideFrame(p))zoomContent(f,p);else zoomView(f,p)},{passive:false});
$('zoomIn').onclick=()=>zoomView(1.2);$('zoomOut').onclick=()=>zoomView(1/1.2);
$('reset').onclick=()=>{view={x:0,y:0,z:1};updateFrame()};
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('delete').onclick=()=>{const ids=new Set(selectionItems().map(n=>n.id));if(!ids.size)return;snapshot();nodes=nodes.filter(n=>!ids.has(n.id));selectNodes([]);sync()};
$('clearCanvas').onclick=()=>{
 if(recording||recordingBusy||!confirm('Start a new project? This will replace every canvas and cannot be undone.'))return;
 finishTextEdit();endGesture();transition=null;resetHighlight();highlights=[];
 if(webcamStream||faceClip)stopWebcam();
 for(const source of audioSources.values()){source.source.disconnect();source.gain.disconnect()}audioSources.clear();
 for(const item of media.values())if(item instanceof HTMLVideoElement){item.pause();item.srcObject?.getTracks().forEach(track=>track.stop())}media.clear();
 nodes=[];camera={x:0,y:0,z:1};view={x:0,y:0,z:1};history=[];
 const board={id:crypto.randomUUID(),name:'Canvas 1',nodes,camera,background:'#ffffff',history,future:[],motion:motionDefaults(),notes:''};
 boards=[board];activeId=board.id;installedLessons=[];starterLessonDismissed=true;lessonSourceVersion=LESSON_LAYOUT_VERSION;selection=new Set();selected=null;hovered=null;
 $('background').value='#ffffff';$('notes').value='';webcamLayout={x:1480,y:640,size:360};recordingPointer=null;
 if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null}$('downloads').hidden=true;
 setPanel('style');updateFrame();sync();renderBoardList();scheduleLocalSave();status('New project ready');
};
$('front').onclick=()=>{const items=selectionItems();if(!items.length)return;snapshot();const ids=new Set(items.map(n=>n.id));nodes=[...nodes.filter(n=>!ids.has(n.id)),...items];sync()};
function restoreState(value){const h=JSON.parse(value);nodes=h.nodes;camera=h.camera;view=h.view||view;$('background').value=h.background;activeBoard().name=h.name||activeBoard().name;activeBoard().motion=h.motion||motionDefaults();selectNodes([]);hovered=null;updateFrame();sync();renderBoardList()}
$('undo').onclick=()=>{finishTextEdit();const current=state();let previous;while(history.length){previous=history.pop();if(previous!==current)break;previous=null}if(previous){(activeBoard().future??=[]).push(current);restoreState(previous)}updateHistory()};
$('redo').onclick=()=>{finishTextEdit();const future=activeBoard().future;if(!future?.length)return;history.push(state());restoreState(future.pop());updateHistory()};
for(const id of ['color','fontSize','stroke','fontFamily','fontWeight']){$(id).addEventListener('change',()=>{
 const items=selectionItems();if(!items.length)return;snapshot();
 for(const n of items){
  if(id==='color'&&['text','rect','draw','arrow'].includes(n.type))n.color=$(id).value;
  if(id==='stroke'&&['draw','arrow'].includes(n.type))n.stroke=+$(id).value;
  if(n.type==='text'){if(id==='fontSize')n.size=Math.min(400,Math.max(8,+$(id).value||48));if(id==='fontFamily')n.font=$(id).value;if(id==='fontWeight')n.weight=$(id).value;updateText(n)}
 }
 sync();
})}
// Object clipboard stays available when switching canvases.
let objectClipboard=null,pasteCount=0;
function copySelection(cut=false){
 const items=selectionItems();if(!items.length)return;
 objectClipboard={items:structuredClone(items),assets:new Map(items.map(n=>[n.id,media.get(n.id)])),boardId:activeId};pasteCount=0;
 if(cut)$('delete').click();
 status(`${items.length} object${items.length===1?'':'s'} ${cut?'cut':'copied'}`);
}
function pasteSelection(point=null){
 if(!objectClipboard)return;
 finishTextEdit();endGesture();
 const clip=objectClipboard,items=structuredClone(clip.items),box=combinedBounds(items),ids=new Map(items.map(n=>[n.id,crypto.randomUUID()]));
 const offset=24*(++pasteCount),dx=point?point.x-box.x:clip.boardId===activeId?offset:camera.x-box.x-box.w/2+offset,dy=point?point.y-box.y:clip.boardId===activeId?offset:camera.y-box.y-box.h/2+offset;
 snapshot();
 for(const n of items){const originalId=n.id;n.id=ids.get(originalId);n.x+=dx;n.y+=dy;
  if(n.containerId){if(ids.has(n.containerId))n.containerId=ids.get(n.containerId);else delete n.containerId}
  const asset=clip.assets.get(originalId);
  if(n.type==='video'&&n.src){loadVideo(n.src).then(async video=>{media.set(n.id,video);await connectVideoAudio(n.id,video)}).catch(()=>status('Copied video could not be loaded'))}
  else if(asset)media.set(n.id,asset);
 }
 nodes.push(...items);selectNodes(items.map(n=>n.id));setTool('select');sync();status(`${items.length} object${items.length===1?'':'s'} pasted`);
}
const objectMenu=$('objectMenu');let menuPoint=null;
function closeObjectMenu(restoreFocus=false){objectMenu.hidden=true;if(restoreFocus)stage.focus({preventScroll:true})}
stage.addEventListener('contextmenu',e=>{
 if(highlighter.binding.type==='mouse'&&e.button===highlighter.binding.button)return;
 e.preventDefault();finishTextEdit();endGesture();menuPoint=world(local(e));const n=hit(menuPoint,0);
 if(n&&!selectionItems().some(item=>item.id===n.id)){selectNodes([n.id]);sync()}
 objectMenu.querySelectorAll('[data-object-action]').forEach(button=>{button.disabled=button.dataset.objectAction==='paste'?!objectClipboard:!selection.size});
 objectMenu.hidden=false;objectMenu.style.left=Math.max(4,Math.min(e.clientX,window.innerWidth-objectMenu.offsetWidth-4))+'px';objectMenu.style.top=Math.max(4,Math.min(e.clientY,window.innerHeight-objectMenu.offsetHeight-4))+'px';
 objectMenu.querySelector('button:not(:disabled)')?.focus();
});
objectMenu.addEventListener('click',e=>{const action=e.target.closest('[data-object-action]')?.dataset.objectAction;if(!action)return;closeObjectMenu(true);if(action==='copy'||action==='cut')copySelection(action==='cut');else if(action==='paste')pasteSelection(menuPoint);else $(action).click()});
objectMenu.addEventListener('keydown',e=>{
 if(e.key==='Escape'||e.key==='Tab'){closeObjectMenu(e.key==='Escape');e.stopPropagation();if(e.key==='Escape')e.preventDefault();return}
 if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const buttons=[...objectMenu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus()}
});
document.addEventListener('pointerdown',e=>{if(!objectMenu.contains(e.target))closeObjectMenu()},true);
window.addEventListener('blur',()=>closeObjectMenu());window.addEventListener('resize',()=>closeObjectMenu());
document.addEventListener('wheel',()=>closeObjectMenu(),{capture:true,passive:true});
function positionTextEditor(){
  if(!editingText)return;
  const n=editingText,s=frame.w/1920*camera.z;
  Object.assign($('inlineText').style,{left:(frame.x+frame.w/2+(n.x-camera.x)*s)+'px',top:(frame.y+frame.h/2+(n.y-camera.y)*s)+'px',width:(n.w+24)+'px',height:(n.h+n.size*.25)+'px',fontSize:n.size+'px',fontFamily:`"${n.font||'DM Sans'}", "Lesson Latin", sans-serif`,fontWeight:n.weight||'500',direction:textDirection(n),textAlign:textDirection(n)==='rtl'?'right':'left',color:n.color,transform:`scale(${s})`});
}
function startTextEdit(n,selectAll=false){
  finishTextEdit();gesture=null;snapshot();selectNodes([n.id]);editingText=n;hovered=null;if(['name','grade'].includes(n.demoRole))updateText(n);
  $('inlineText').classList.toggle('demo-field',['name','grade'].includes(n.demoRole)&&$('formDemo').checked);$('inlineText').maxLength=['name','grade'].includes(n.demoRole)?40:524288;$('inlineText').value=n.text;$('inlineText').hidden=false;positionTextEditor();$('inlineText').focus({preventScroll:true});
  if(selectAll)$('inlineText').select();else $('inlineText').setSelectionRange(n.text.length,n.text.length);
}
function finishTextEdit(){
  if(!editingText)return;
  editingText.text=$('inlineText').value;updateText(editingText);editingText=null;$('inlineText').hidden=true;sync();
}
$('inlineText').addEventListener('input',()=>{if(editingText){editingText.text=$('inlineText').value;updateText(editingText);positionTextEditor()}});
$('inlineText').addEventListener('blur',finishTextEdit);
$('inlineText').addEventListener('keydown',e=>{if(e.isComposing)return;if($('formDemo').checked&&['name','grade'].includes(editingText?.demoRole)&&['Tab','Enter'].includes(e.key)){e.preventDefault();e.stopPropagation();const role=editingText.demoRole;finishTextEdit();if(role==='name'){const grade=nodes.find(n=>n.demoRole==='grade');if(grade)startTextEdit(grade,true)}else{snapshot();const result=appendDemoRow(nodes);status(result.error||'تمت إضافة الطالب إلى الجدول');selectNodes([]);sync();scheduleLocalSave()}return}if(e.key==='Escape'||(e.key==='Enter'&&(e.ctrlKey||e.metaKey))){e.preventDefault();finishTextEdit();setTool('select')}e.stopPropagation()});
document.addEventListener('pointerdown',e=>{if(editingText&&e.target!==$('inlineText'))finishTextEdit()},true);
stage.addEventListener('dblclick',e=>{const n=hit(world(local(e)));if(n?.type==='text'&&!n.demoPart){e.preventDefault();startTextEdit(n)}});
window.addEventListener('keydown',e=>{if(typingTarget(e))return;if(e.code==='Space'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!e.repeat){space=true;spacePending=true;spaceDragged=false}return}if(e.ctrlKey||e.metaKey){const key=e.key.toLowerCase();if(key==='a'){e.preventDefault();selectNodes(nodes.map(n=>n.id));sync();return}if(['c','x','v'].includes(key)){e.preventDefault();closeObjectMenu();if(key==='v')pasteSelection();else copySelection(key==='x');return}if(key==='z'||key==='y'){e.preventDefault();$(key==='z'&&!e.shiftKey?'undo':'redo').click();return}}if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.key===','||e.key==='.'){const video=playbackTarget();if(video){e.preventDefault();seekVideo(video,e.key===','?-5:5)}return}if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const i=boards.findIndex(b=>b.id===activeId),next=boards[i+(e.key==='ArrowRight'?1:-1)];if(next)switchBoard(next.id);return;}if(e.key==='Escape'){endGesture();setTool('select');selectNodes([]);sync()}if(e.key==='Delete'||e.key==='Backspace'){$('delete').click();e.preventDefault()}const t={v:'select',m:'marquee',h:'pan',t:'text',a:'arrow',d:'draw'}[e.key.toLowerCase()];if(t)setTool(t);if(e.key.toLowerCase()==='i')$('imageFile').click()});window.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;if(spacePending&&!spaceDragged&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)){e.preventDefault();toggleVideo(playbackTarget())}spacePending=false}});window.addEventListener('blur',()=>{space=false;spacePending=false;endGesture()});
async function imageFrom(src){const img=new Image();img.src=src.startsWith('/lessons/')?new URL(src.slice(1),document.baseURI).href:src;await img.decode();return img}
async function addImages(files,point={x:camera.x,y:camera.y}){storeBoard();const target=activeBoard();for(const file of files){if(!file.type.startsWith('image/'))continue;try{const src=await readDataURL(file),img=await imageFrom(src),w=Math.min(850,img.width),h=w*img.height/img.width;const n=add({type:'image',x:point.x-w/2,y:point.y-h/2,w,h,src},target);media.set(n.id,img);scheduleLocalSave();status('Image added and saved locally')}catch{status('Could not open that image. Try PNG, JPG, or WebP.')}}}
async function addDroppedImageUrls(urls,point){let added=false;for(const url of [...new Set(urls)]){try{if(!/^(https?:|data:image\/)/i.test(url))continue;const blob=url.startsWith('data:image/')?await(await fetch(url)).blob():await(await fetch(url,{mode:'cors'})).blob();if(!blob.type.startsWith('image/'))continue;await addImages([new File([blob],'dropped-image',{type:blob.type})],point);added=true}catch{status('That website blocked saving its image. Download it, then drop the file here.')}}if(!added&&urls.length)status('Could not save the dropped image locally.')}
function droppedImageUrls(transfer){const urls=[];const uri=transfer.getData('text/uri-list').split(/\r?\n/).find(line=>line&&!line.startsWith('#'));if(uri)urls.push(uri);const html=transfer.getData('text/html');if(html){const doc=new DOMParser().parseFromString(html,'text/html');doc.querySelectorAll('img[src]').forEach(img=>urls.push(img.src))}const plain=transfer.getData('text/plain').trim();if(/^(https?:|data:image\/)/i.test(plain))urls.push(plain);return urls}
$('image').onclick=$('emptyImage').onclick=()=>$('imageFile').click();$('imageFile').onchange=async e=>{await addImages(e.target.files);e.target.value=''};stage.ondragover=e=>e.preventDefault();stage.ondrop=async e=>{e.preventDefault();const point=world(local(e)),files=[...e.dataTransfer.files];if(files.length)await importCanvasFiles(files,point);else await addDroppedImageUrls(droppedImageUrls(e.dataTransfer),point)};
async function shareScreen(){
 storeBoard();const target=activeBoard(),origin={...camera};let stream;
 if(!window.isSecureContext||!navigator.mediaDevices?.getDisplayMedia){$('shareStatus').textContent='Screen sharing needs a supported desktop browser on HTTPS or localhost. You can add a video file instead.';setPanel('recording');return}
 try{
 stream=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:true,systemAudio:'include',surfaceSwitching:'include',selfBrowserSurface:'exclude'});
 const video=document.createElement('video');video.srcObject=stream;video.muted=true;video.playsInline=true;await video.play();
 if(!video.videoWidth||!video.videoHeight)throw new Error('The selected screen did not provide video. Try sharing a browser tab.');
 if(!boards.includes(target)){stream.getTracks().forEach(t=>t.stop());return}
 const w=1100,h=w*video.videoHeight/video.videoWidth,n=add({type:'screen',x:origin.x-w/2,y:origin.y-h/2,w,h,volume:1},target);media.set(n.id,video);
 const hasAudio=stream.getAudioTracks().length>0;if(hasAudio){await ensureAudio();connectStreamAudio(n.id,stream)}
 stream.getVideoTracks()[0].onended=()=>{removeSharedSource(n.id);$('shareStatus').textContent='Screen sharing ended.'};
 $('shareStatus').textContent=hasAudio?'Screen connected. Shared audio will be included in your recording.':'Screen connected without audio. Share a browser tab and enable Share audio, or add your video file.';sync();setPanel('recording');
 }catch(e){stream?.getTracks().forEach(t=>t.stop());const messages={NotAllowedError:'Screen sharing was canceled or blocked. Try again and allow access in the browser picker.',NotReadableError:'The browser could not read that screen. Try sharing a browser tab, or add your video file.',InvalidStateError:'Focus this page and click Share screen again.',AbortError:'Screen sharing was interrupted. Try again or add your video file.'};$('shareStatus').textContent=messages[e.name]||e.message||'Screen sharing is unavailable. Add a video file instead.';setPanel('recording')}
}
$('screen').onclick=$('shareScreen').onclick=shareScreen;
function removeSharedSource(id){const video=media.get(id);video?.srcObject?.getTracks().forEach(t=>t.stop());const source=audioSources.get(id);source?.source.disconnect();source?.gain.disconnect();audioSources.delete(id);media.delete(id);storeBoard();boards.forEach(b=>{b.nodes=b.nodes.filter(n=>n.id!==id)});nodes=activeBoard().nodes;sync()}
async function ensureAudio(){if(!audioContext){audioContext=new AudioContext();audioDestination=audioContext.createMediaStreamDestination()}if(audioContext.state==='suspended'&&!restoringLocal)await audioContext.resume()}
function connectStreamAudio(id,stream){if(!stream.getAudioTracks().length)return;const source=audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks())),gain=audioContext.createGain();gain.gain.value=0;source.connect(gain);gain.connect(audioDestination);audioSources.set(id,{source,gain})}
async function connectVideoAudio(id,video){await ensureAudio();const source=audioContext.createMediaElementSource(video),gain=audioContext.createGain();gain.gain.value=0;source.connect(gain);gain.connect(audioDestination);gain.connect(audioContext.destination);audioSources.set(id,{source,gain})}
function updateAudioRouting(){if(faceClip)$('facePlay').textContent=$('cameraVideo').paused?'▷ Play':'Ⅱ Pause';for(const [id,source] of audioSources){if(id==='@face'){source.gain.gain.value=faceClip?.volume??0;continue}const n=nodes.find(n=>n.id===id),visible=n&&n.x+n.w>camera.x-960/camera.z&&n.x<camera.x+960/camera.z&&n.y+n.h>camera.y-540/camera.z&&n.y<camera.y+540/camera.z;source.gain.gain.value=visible?(n.volume??1):0}const n=nodes.find(n=>n.id===selected),video=n?.type==='video'?media.get(n.id):null;if(video){$('mediaPlay').textContent=video.paused?'▷ Play video':'Ⅱ Pause video';if(document.activeElement!==$('mediaSeek'))$('mediaSeek').value=video.duration?video.currentTime/video.duration*100:0}}
function syncMediaControls(n){const isVideo=n?.type==='video',isScreen=n?.type==='screen';$('mediaControls').hidden=!isVideo&&!isScreen;$('mediaPlay').hidden=$('mediaRestart').hidden=$('mediaSeekLabel').hidden=!isVideo;$('stopShare').hidden=!isScreen;if(isVideo||isScreen){$('mediaVolume').value=(n.volume??1)*100;$('mediaVolumeValue').textContent=Math.round((n.volume??1)*100)+'%'}}
$('mediaPlay').onclick=async()=>{const v=media.get(selected);if(!v)return;try{await ensureAudio();if(v.paused)await v.play();else v.pause()}catch{status('Video playback failed. Try an MP4 file with H.264 video and AAC audio.')}};
$('mediaRestart').onclick=()=>{const v=media.get(selected);if(v)v.currentTime=0};$('mediaSeek').oninput=()=>{const v=media.get(selected);if(v&&Number.isFinite(v.duration))v.currentTime=v.duration*+$('mediaSeek').value/100};$('mediaVolume').oninput=()=>{const n=nodes.find(n=>n.id===selected);if(n){n.volume=+$('mediaVolume').value/100;$('mediaVolumeValue').textContent=$('mediaVolume').value+'%'}};
$('stopShare').onclick=()=>removeSharedSource(selected);
$('addVideo').onclick=()=>$('videoFile').click();
async function loadVideo(src){const v=document.createElement('video');v.playsInline=true;v.preload='auto';await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Video load timed out')),20000);v.onloadeddata=()=>{clearTimeout(timeout);resolve()};v.onerror=()=>{clearTimeout(timeout);reject(new Error('Unsupported video format'))};v.src=src});return v}
$('videoFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;storeBoard();const target=activeBoard(),origin={...camera};try{await ensureAudio();const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)}),v=await loadVideo(src),w=Math.min(1100,v.videoWidth),h=w*v.videoHeight/v.videoWidth;if(!boards.includes(target))return;const n=add({type:'video',src,name:file.name,x:origin.x-w/2,y:origin.y-h/2,w,h,volume:1},target);media.set(n.id,v);await connectVideoAudio(n.id,v);sync();setPanel('style');$('shareStatus').textContent='Video added. Select it to play, seek, or adjust sound.'}catch{status('Video could not be opened. Try an MP4 file with H.264 video and AAC audio.')}finally{e.target.value=''}};
function lock(on){webcamLocked=on;webcamGesture=null;$('cameraToggle').disabled=on;$('faceVideoButton').disabled=on;$('faceRemove').disabled=on;$('cameraTile').classList.toggle('locked',on);$('cameraTile').querySelectorAll('button').forEach(b=>b.disabled=on);for(const id of ['resolution','fps','quality','mic','open'])$(id).disabled=on;$('record').hidden=on;$('stop').hidden=!on}
function selectedFps(){const value=Number($('fps').value);return Number.isInteger(value)&&value>=1&&value<=240?value:null}
function selectedQuality(){const value=Number($('quality').value);return Number.isFinite(value)&&value>=.5&&value<=100?value:null}
$('fps').onchange=()=>{const fps=selectedFps();$('fps').setCustomValidity(fps?'':'Choose a whole number from 1 to 240.');if(!fps)$('fps').reportValidity()};
$('quality').onchange=()=>{const quality=selectedQuality();$('quality').setCustomValidity(quality?'':'Choose a value from 0.5 to 100 Mbps.');if(!quality)$('quality').reportValidity()};
let recordingBusy=false,pausedAt=null,pausedTime=0,recordingPulse=null,silentSource=null,silentGain=null;
function recordedMilliseconds(){return Math.max(0,(pausedAt??performance.now())-started-pausedTime)}
function captureRecordingFrame(){paintRecording(out);paintHighlights(out,camera.z,960,540);drawWebcam(out);drawRecordingCursor(out);recordingContext.drawImage(output,0,0,recordingCanvas.width,recordingCanvas.height);captureStream?.getVideoTracks()[0]?.requestFrame?.()}
$('record').onclick=async()=>{
 if(recording||recordingBusy)return;
 const fps=selectedFps(),quality=selectedQuality();
 if(!fps||!quality){setPanel('recording');const input=$(fps?'quality':'fps');input.setCustomValidity(fps?'Choose a value from 0.5 to 100 Mbps.':'Choose a whole number from 1 to 240.');input.reportValidity();return}
 if(!window.MediaRecorder||!output.captureStream){status('Recording needs a browser with MediaRecorder support, such as Chrome.');return}
 recordingBusy=true;lock(true);$('stop').disabled=true;
 try{
  finishTextEdit();await ensureAudio();
  if($('mic').checked){micStream=await navigator.mediaDevices.getUserMedia({audio:true});micAudioNode=audioContext.createMediaStreamSource(micStream);micAudioNode.connect(audioDestination)}
  // Keep the audio track producing samples even when no microphone or video is playing.
  silentSource=audioContext.createOscillator();silentGain=audioContext.createGain();silentGain.gain.value=0;silentSource.connect(silentGain);silentGain.connect(audioDestination);silentSource.start();
  const resolution=$('resolution').value,[width,height]=resolutions[resolution]||resolutions[1080];
  recordingCanvas.width=width;recordingCanvas.height=height;
  const stream=recordingCanvas.captureStream(fps);captureStream=stream;
  audioDestination.stream.getAudioTracks().forEach(t=>stream.addTrack(t.clone()));
  const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
  if(!mime)throw new Error('No supported video encoder found.');
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:quality*1000000});chunks=[];
  let recordingError=null;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  recorder.onerror=e=>{recordingError=e.error?.message||'The video encoder stopped unexpectedly.';if(recorder.state!=='inactive')recorder.stop()};
  recorder.onstop=()=>{
   const seconds=recordedMilliseconds()/1000;cleanup(stream);
   if(!chunks.length){status(recordingError||'The encoder produced no video. Try recording again at 30 FPS and 6 Mbps.');return}
   const blob=new Blob(chunks,{type:recorder.mimeType||mime});
   if(downloadUrl)URL.revokeObjectURL(downloadUrl);
   downloadUrl=URL.createObjectURL(blob);$('download').href=downloadUrl;
   $('download').download=`canvas-${new Date().toISOString().replace(/[:.]/g,'-')}-${resolution}p-${fps}fps.${mime.includes('mp4')?'mp4':'webm'}`;
   $('videoInfo').textContent=`${width} × ${height} · ${fps} fps target · ${quality} Mbps · ${seconds.toFixed(1)}s · ${(blob.size/1e6).toFixed(1)} MB`;
   $('downloads').hidden=false;status(recordingError?'Recording interrupted. The captured portion is ready to download.':'Recording ready. Download it below.');
  };
  recorder.start(250);recording=true;setPanel('notes');started=performance.now();pausedAt=null;pausedTime=0;
  $('timer').textContent='00:00';$('pauseRecording').hidden=false;$('pauseRecording').disabled=false;$('pauseRecording').textContent='Ⅱ Pause';
  captureRecordingFrame();
  recordingPulse=setInterval(()=>{if(recorder?.state==='recording')captureRecordingFrame()},Math.max(4,1000/fps));
  // Allow the initial audio/video samples to reach the encoder before pausing or stopping.
  await new Promise(resolve=>setTimeout(resolve,300));
  recordingBusy=false;$('stop').disabled=false;status('Recording — only the frame is captured');
 }catch(e){cleanup(captureStream);status(e.name==='NotAllowedError'?'Microphone permission was declined. Turn it off to record without audio.':`Could not start: ${e.message}`)}
};
$('pauseRecording').onclick=()=>{
 if(recordingBusy||!recording)return;
 if(recorder.state==='recording'){recorder.pause();pausedAt=performance.now();$('pauseRecording').textContent='▶ Resume';status('Recording paused')}
 else if(recorder.state==='paused'){pausedTime+=performance.now()-pausedAt;pausedAt=null;recorder.resume();captureRecordingFrame();$('pauseRecording').textContent='Ⅱ Pause';status('Recording resumed')}
};
function cleanup(stream){
 clearInterval(recordingPulse);recordingPulse=null;
 silentSource?.stop();silentSource?.disconnect();silentGain?.disconnect();silentSource=null;silentGain=null;
 micAudioNode?.disconnect();micAudioNode=null;micStream?.getTracks().forEach(t=>t.stop());
 stream?.getTracks().forEach(t=>t.stop());captureStream=null;micStream=null;recording=false;recordingBusy=false;
 $('pauseRecording').hidden=true;$('stop').disabled=false;lock(false);
}
$('stop').onclick=()=>{if(recordingBusy||!recorder||recorder.state==='inactive')return;recordingBusy=true;$('stop').disabled=true;$('pauseRecording').disabled=true;recorder.stop()};
$('dismiss').onclick=()=>$('downloads').hidden=true;
function downloadJSON(data){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='canvas-project.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function projectData(){storeBoard();return {version:2,installedLessons,starterLessonDismissed,lessonSourceVersion,showCursor:$('showCursor').checked,notes:$('notes').value,highlighter:{...highlighter},boards:boards.map(({id,name,notes,lessonId,lessonLayoutVersion,nodes,camera,background,motion})=>({id,name,notes,lessonId,lessonLayoutVersion,nodes:nodes.filter(n=>n.type!=='screen'),camera,background,motion})),activeId,view,webcamLayout,faceClip,resolution:$('resolution').value,fps:$('fps').value,quality:$('quality').value}}
$('save').onclick=()=>{downloadJSON(projectData());status('All canvases saved. Live screens need to be shared again when reopening.')};$('open').onclick=()=>$('projectFile').click();
function validCamera(c){return c&&[c.x,c.y,c.z].every(Number.isFinite)&&c.z>=.08&&c.z<=8}
// Upgrade saved lesson canvases in place, keeping edits and object positions.
function updateLessonLayout(b){
 if(b.lessonId!=='lesson-01'||b.lessonLayoutVersion>=2)return;
 const digits=value=>value.replace(/[٠-٩۰-۹]/g,d=>String(d.charCodeAt(0)-(d<='٩'?0x660:0x6f0)));
 b.nodes=b.nodes.filter(n=>!(n.type==='text'&&(/^خطوة\s*•\s*تكنولوجيا\s*•\s*المستوى\s*[1١]$/.test(n.text)||/^0?[0-9٠-٩]+\s*\/\s*(20|٢٠)$/.test(n.text)&&n.y===470))&&!(n.type==='rect'&&n.x===-840&&n.y===450&&n.w===1680&&n.h===2&&n.color==='#edf2f5'));
 for(const n of b.nodes)if(n.type==='text'){n.text=digits(n.text);n.direction=textDirection({...n,direction:undefined})}
 b.name=digits(b.name);if(typeof b.notes==='string')b.notes=digits(b.notes);
 b.lessonLayoutVersion=2;
}
async function restoreProject(data){
  const incoming=data.version===1?[{id:crypto.randomUUID(),name:'Canvas 1',nodes:data.nodes,camera:data.camera,background:data.background}]:data.version===2?data.boards:null;
  if(!Array.isArray(incoming)||!incoming.length||data.view&&!validCamera(data.view))throw new Error('Invalid project');
  const loaded=new Map(),ids=new Set();
  for(const b of incoming){
    if(typeof b.id!=='string'||ids.has(b.id)||typeof b.name!=='string'||!Array.isArray(b.nodes)||!validCamera(b.camera)||!/^#[\da-f]{6}$/i.test(b.background))throw new Error('Invalid canvas');ids.add(b.id);updateLessonLayout(b);prepareLessonForm(b);
    for(const n of b.nodes){
      if(!['image','text','arrow','draw','video','rect'].includes(n.type)||!['x','y','w','h'].every(k=>Number.isFinite(n[k]))||typeof n.id!=='string')throw new Error('Invalid object');
      if(n.type==='rect'&&((n.radius!==undefined&&(!Number.isFinite(n.radius)||n.radius<0))||(n.border!==undefined&&!/^#[\da-f]{6}$/i.test(n.border))))throw new Error('Invalid card');
      if(n.pdf&&(n.type!=='image'||typeof n.pdf.source!=='string'||!/^data:application\/pdf;base64,/.test(n.pdf.source)||typeof n.pdf.name!=='string'||!Number.isInteger(n.pdf.page)||!Number.isInteger(n.pdf.count)||n.pdf.page<1||n.pdf.page>n.pdf.count))throw new Error('Invalid PDF');
      if(n.type==='text'&&(typeof n.text!=='string'||!Number.isFinite(n.size)))throw new Error('Invalid text');
      if(n.type==='draw'&&(!Array.isArray(n.points)||!n.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))))throw new Error('Invalid drawing');
      if(n.type==='video'){if(typeof n.src!=='string'||!n.src.startsWith('data:video/'))throw new Error('Invalid video');loaded.set(n.id,await loadVideo(n.src))}if(n.type==='image'){if(typeof n.src!=='string'||!n.src.startsWith('data:image/')&&!/^\/lessons\/assets\/[\w.-]+\.svg$/.test(n.src))throw new Error('Invalid image');loaded.set(n.pdf?n.src:n.id,await imageFrom(n.src))}
    }
    b.notes=typeof b.notes==='string'?b.notes:'';b.history=[];b.future=[];b.motion={...motionDefaults(),...b.motion};if(!['none','fade','slide','zoom'].includes(b.motion.intro)||!['none','fade','slide','zoom'].includes(b.motion.outro)||!Number.isFinite(b.motion.duration)||b.motion.duration<.2||b.motion.duration>2)throw new Error('Invalid motion');
  }
  let loadedFace=null;if(data.faceClip){if(typeof data.faceClip.src!=='string'||!data.faceClip.src.startsWith('data:video/')||!Number.isFinite(data.faceClip.volume)||data.faceClip.volume<0||data.faceClip.volume>1)throw new Error('Invalid face video');loadedFace=await loadVideo(data.faceClip.src)}if(data.webcamLayout){const l=data.webcamLayout;if(![l.x,l.y,l.size].every(Number.isFinite)||l.size<120||l.size>900||l.x<0||l.y<0||l.x+l.size>1920||l.y+l.size>1080)throw new Error('Invalid camera layout')}finishTextEdit();endGesture();transition=null;webcamLayout=data.webcamLayout||{x:1480,y:640,size:360};boards=incoming;activeId=ids.has(data.activeId)?data.activeId:boards[0].id;
  installedLessons=Array.isArray(data.installedLessons)?data.installedLessons.filter(id=>typeof id==='string'):[];starterLessonDismissed=data.starterLessonDismissed===true;lessonSourceVersion=Number.isInteger(data.lessonSourceVersion)?data.lessonSourceVersion:0;
  $('showCursor').checked=data.showCursor!==false;recordingPointer=null;
  $('notes').value=typeof data.notes==='string'?data.notes:'';restoreHighlighter(data.highlighter);highlights=[];
  const b=activeBoard();nodes=b.nodes;camera=b.camera;history=b.history;view=data.view||{x:0,y:0,z:1};$('background').value=b.background;updateFrame();
  $('resolution').value=Object.hasOwn(resolutions,data.resolution)?String(data.resolution):'1080';
  const savedFps=Number(data.fps);if(Number.isInteger(savedFps)&&savedFps>=1&&savedFps<=240)$('fps').value=savedFps;const rawQuality=Number(data.quality),savedQuality=rawQuality>100?rawQuality/1000000:rawQuality;if(Number.isFinite(savedQuality)&&savedQuality>=.5&&savedQuality<=100)$('quality').value=savedQuality;
  for(const source of audioSources.values()){source.source.disconnect();source.gain.disconnect()}audioSources.clear();for(const v of media.values())if(v instanceof HTMLVideoElement){v.pause();v.srcObject?.getTracks().forEach(t=>t.stop())}loaded.forEach((v,k)=>media.set(k,v));for(const [id,v] of loaded)if(v instanceof HTMLVideoElement)await connectVideoAudio(id,v);if(faceClip||loadedFace)stopWebcam();if(loadedFace)await installFaceVideo(loadedFace,data.faceClip);selectNodes([]);hovered=null;sync();renderBoardList();status('Project opened');
}
$('projectFile').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;await restoreProject(JSON.parse(await file.text()));scheduleLocalSave()}catch{status('Could not open this project. Choose a Canvas project JSON file.')}finally{e.target.value=''}};

function resizeTarget(p){const n=selectionBounds();if(!n)return null;const threshold=9/(frame.w/1920*camera.z);for(const [corner,x,y] of [['nw',n.x,n.y],['ne',n.x+n.w,n.y],['sw',n.x,n.y+n.h],['se',n.x+n.w,n.y+n.h]])if(Math.hypot(p.x-x,p.y-y)<threshold)return{corner,cursor:corner==='nw'||corner==='se'?'nwse-resize':'nesw-resize'};return null}
function setPanel(name){document.querySelectorAll('[data-panel]').forEach(b=>{const on=b.dataset.panel===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;$('panel-'+b.dataset.panel).hidden=!on})}
document.querySelectorAll('[data-panel]').forEach((b,i,buttons)=>{b.onclick=()=>setPanel(b.dataset.panel);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();const next=buttons[(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length];setPanel(next.dataset.panel);next.focus()}}});
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{$('color').value=b.dataset.color;$('color').dispatchEvent(new Event('change'))});
$('stroke').addEventListener('input',()=>$('strokeValue').textContent=$('stroke').value+' px');
$('background').addEventListener('pointerdown',()=>snapshot());$('background').addEventListener('keydown',()=>snapshot());
$('boardName').addEventListener('focus',()=>snapshot());$('boardName').addEventListener('change',()=>{activeBoard().name=$('boardName').value.trim()||'Untitled canvas';renderBoardList();sync()});
function syncMotion(){const m=activeBoard().motion||motionDefaults();$('intro').value=m.intro;$('outro').value=m.outro;$('duration').value=m.duration;$('durationValue').textContent=m.duration.toFixed(1)+' s';document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(m.intro===b.dataset.preset&&m.outro===b.dataset.preset)))}
for(const id of ['intro','outro'])$(id).onchange=()=>{snapshot();activeBoard().motion[id]=$(id).value;syncMotion()};
$('duration').addEventListener('pointerdown',()=>snapshot());$('duration').addEventListener('keydown',()=>snapshot());$('duration').oninput=()=>{activeBoard().motion.duration=+$('duration').value;syncMotion()};
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{snapshot();activeBoard().motion={intro:b.dataset.preset,outro:b.dataset.preset,duration:b.dataset.preset==='slide'?.5:.6};syncMotion();previewMotion()});
function captureBoard(b){const c=document.createElement('canvas');c.width=1920;c.height=1080;const g=c.getContext('2d');g.fillStyle=b.background;g.fillRect(0,0,1920,1080);drawScene(g,b.camera.z,960,540,b.nodes,b.camera);return c}
function startTransition(previous,next){const intro=next.motion||motionDefaults(),outro=previous.motion||motionDefaults();if(intro.intro==='none'&&outro.outro==='none'){transition=null;return}transition={image:captureBoard(previous),intro:intro.intro,outro:outro.outro,inTime:intro.duration*1000,outTime:outro.duration*1000,start:performance.now()}}
function previewMotion(){finishTextEdit();storeBoard();const b=activeBoard();startTransition(b,b)}
$('previewMotion').onclick=previewMotion;
function animateLayer(c,type,progress,enter,paint){const t=1-Math.pow(1-progress,3),amount=enter?1-t:t;c.save();if(type==='fade')c.globalAlpha=1-amount;if(type==='slide'){c.translate((enter?1:-1)*1920*amount,0)}if(type==='zoom'){c.globalAlpha=1-amount;const scale=1+(enter?.12:-.12)*amount;c.translate(960,540);c.scale(scale,scale);c.translate(-960,-540)}paint();c.restore()}
function paintRecording(c){
 const t=transition;c.fillStyle=$('background').value;c.fillRect(0,0,1920,1080);
 if(!t){drawScene(c,camera.z,960,540);return}
 const elapsed=performance.now()-t.start,pi=Math.min(1,elapsed/t.inTime),po=Math.min(1,elapsed/t.outTime);
 const incoming=()=>animateLayer(c,t.intro,pi,true,()=>{c.fillStyle=$('background').value;c.fillRect(0,0,1920,1080);drawScene(c,camera.z,960,540)});
 const outgoing=()=>{if(t.outro!=='none'&&po<1)animateLayer(c,t.outro,po,false,()=>c.drawImage(t.image,0,0))};
 if(t.intro==='none'){incoming();outgoing()}else{outgoing();incoming()}
 if(elapsed>=Math.max(t.inTime,t.outTime))transition=null;
}

function positionWebcam(){if(!webcamStream&&!faceClip)return;const s=frame.w/1920,l=webcamLayout;Object.assign($('cameraTile').style,{left:(frame.x+l.x*s)+'px',top:(frame.y+l.y*s)+'px',width:(l.size*s)+'px',height:(l.size*s)+'px'})}
function stopWebcam(){const faceSource=audioSources.get('@face');faceSource?.source.disconnect();faceSource?.gain.disconnect();audioSources.delete('@face');faceClip=null;$('cameraVideo').pause();$('cameraVideo').removeAttribute('src');$('faceVideoControls').hidden=true;const stream=webcamStream;webcamStream=null;stream?.getTracks().forEach(t=>t.stop());$('cameraVideo').srcObject=null;$('cameraTile').hidden=true;$('cameraHint').hidden=true;$('cameraToggle').classList.remove('active');$('cameraToggle').setAttribute('aria-label','Enable camera');$('cameraToggle').title='Enable camera';$('cameraToggle').setAttribute('aria-pressed','false');sync()}
$('cameraToggle').onclick=async()=>{
 if(webcamLocked)return;if(webcamStream){stopWebcam();return}if(faceClip)stopWebcam();
 $('cameraToggle').disabled=true;
 try{const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:720},height:{ideal:720},facingMode:'user'},audio:false});
 if(webcamLocked){stream.getTracks().forEach(t=>t.stop());return}
 webcamStream=stream;$('cameraVideo').muted=true;$('cameraVideo').srcObject=stream;await $('cameraVideo').play();$('cameraTile').hidden=false;$('cameraHint').hidden=false;$('cameraToggle').classList.add('active');$('cameraToggle').setAttribute('aria-label','Turn camera off');$('cameraToggle').title='Turn camera off';$('cameraToggle').setAttribute('aria-pressed','true');positionWebcam();sync();
 stream.getVideoTracks()[0].onended=()=>{stopWebcam();status('Camera disconnected. Enable it again before your next recording.')};
 }catch(e){stopWebcam();status(e.name==='NotAllowedError'?'Camera permission was declined. Allow camera access to add your video.':'Camera unavailable. Check that it is connected and not in use.')}
 finally{$('cameraToggle').disabled=webcamLocked}
};
$('cameraTile').addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();if(faceClip){selectNodes([]);sync()}if(webcamLocked||e.button!==0)return;finishTextEdit();$('cameraTile').setPointerCapture(e.pointerId);webcamGesture={x:e.clientX,y:e.clientY,layout:{...webcamLayout},corner:e.target.dataset.corner};$('cameraTile').classList.add('moving')});
$('cameraTile').addEventListener('pointermove',e=>{if(!webcamGesture||webcamLocked)return;const g=webcamGesture,o=g.layout,s=frame.w/1920,dx=(e.clientX-g.x)/s,dy=(e.clientY-g.y)/s;
 if(!g.corner){webcamLayout.x=Math.max(0,Math.min(1920-o.size,o.x+dx));webcamLayout.y=Math.max(0,Math.min(1080-o.size,o.y+dy))}
 else{const left=g.corner.includes('w'),top=g.corner.includes('n'),ax=left?o.x+o.size:o.x,ay=top?o.y+o.size:o.y,max=Math.min(900,left?ax:1920-ax,top?ay:1080-ay),size=Math.max(120,Math.min(max,o.size+Math.max(left?-dx:dx,top?-dy:dy)));webcamLayout={x:left?ax-size:ax,y:top?ay-size:ay,size}}
 positionWebcam();
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('cameraTile').addEventListener(event,()=>{webcamGesture=null;$('cameraTile').classList.remove('moving')});
function drawWebcam(c){const video=$('cameraVideo');if((!webcamStream&&!faceClip)||video.readyState<2)return;const l=webcamLayout,side=Math.min(video.videoWidth,video.videoHeight);c.save();c.beginPath();c.roundRect(l.x,l.y,l.size,l.size,l.size*.12);c.clip();c.drawImage(video,(video.videoWidth-side)/2,(video.videoHeight-side)/2,side,side,l.x,l.y,l.size,l.size);c.restore()}

function playbackTarget(){const n=nodes.find(n=>n.id===selected&&n.type==='video');if(n)return media.get(n.id);if(faceClip)return $('cameraVideo');const first=nodes.find(n=>n.type==='video');return first?media.get(first.id):null}
async function toggleVideo(video){if(!video)return;try{await ensureAudio();if(video.paused){if(video.ended)video.currentTime=0;await video.play()}else video.pause()}catch{status('Video playback failed. Try an MP4 video.')}}
function seekVideo(video,seconds){if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+seconds))}
async function installFaceVideo(video,clip){
 stopWebcam();const old=$('cameraVideo');video.id='cameraVideo';video.muted=false;old.replaceWith(video);faceClip={src:clip.src,name:clip.name||'Face video',volume:clip.volume??1};await connectVideoAudio('@face',video);
 $('cameraTile').hidden=false;$('cameraHint').hidden=false;$('faceVideoControls').hidden=false;$('faceVideoName').textContent=faceClip.name;$('faceVolume').value=faceClip.volume*100;selectNodes([]);positionWebcam();sync();
}
$('faceVideoButton').onclick=()=>{if(!webcamLocked)$('faceVideoFile').click()};
$('faceVideoFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(webcamLocked){e.target.value='';return}try{await ensureAudio();const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)}),video=await loadVideo(src);if(webcamLocked)return;await installFaceVideo(video,{src,name:file.name,volume:1})}catch{status('Face video could not be opened. Try an MP4 with H.264 video and AAC audio.')}finally{e.target.value=''}};
$('facePlay').onclick=()=>toggleVideo($('cameraVideo'));
$('faceRemove').onclick=()=>{if(!webcamLocked)stopWebcam()};
$('faceVolume').oninput=()=>{if(faceClip)faceClip.volume=+$('faceVolume').value/100};

// Track screen coordinates so the pointer stays under the mouse during pan/zoom.
let recordingPointer=null;
function trackRecordingPointer(e){
 if(e.pointerType==='touch'){recordingPointer=null;return}
 const overCanvas=e.target===stage||e.target===$('inlineText')||$('cameraTile').contains(e.target);
 recordingPointer=overCanvas?{clientX:e.clientX,clientY:e.clientY}:null;
}
for(const event of ['pointermove','pointerdown','pointerover'])window.addEventListener(event,trackRecordingPointer,true);
window.addEventListener('pointerout',e=>{if(!e.relatedTarget)recordingPointer=null},true);
window.addEventListener('pointercancel',()=>{recordingPointer=null},true);
window.addEventListener('blur',()=>{recordingPointer=null});
document.addEventListener('visibilitychange',()=>{if(document.hidden)recordingPointer=null});
function drawRecordingCursor(c){
 if(!$('showCursor').checked||!recordingPointer||!frame.w||!frame.h)return;
 const p=local(recordingPointer);if(!insideFrame(p))return;
 const x=(p.x-frame.x)*1920/frame.w,y=(p.y-frame.y)*1080/frame.h;
 c.save();c.translate(x,y);c.globalAlpha=1;c.setLineDash([]);
 // A light outline keeps the arrow readable over both light and dark content.
 c.fillStyle='#182b39';c.strokeStyle='#ffffff';c.lineWidth=2.5;c.lineJoin='round';
 c.beginPath();c.moveTo(0,0);c.lineTo(0,32);c.lineTo(8,25);
 c.lineTo(14,38);c.lineTo(21,35);c.lineTo(15,22);c.lineTo(26,22);c.closePath();
 c.fill();c.stroke();c.restore();
}
$('showCursor').addEventListener('change',scheduleLocalSave);

const highlighterDefaults=()=>({binding:{type:'key',code:'KeyL',label:'L'},delay:0,fade:1,color:'#ffd43b',width:64,opacity:40,brushVersion:2});
let highlighter=highlighterDefaults(),bindingHighlight=false,highlightHeld=false,highlightPointer=null,highlightLast=null,highlights=[];
function syncHighlighter(){$('highlightOpacityValue').textContent=highlighter.opacity+'%';$('highlightWidthValue').textContent=highlighter.width+' px';const label=highlighter.binding.label;$('bindHighlight').textContent=bindingHighlight?'Press a key or mouse button…':`Bind: ${label}`;$('bindHighlight').setAttribute('aria-pressed',String(bindingHighlight));$('highlightHint').textContent=bindingHighlight?'Press a key or click a mouse button anywhere. Escape cancels.':`Hold ${label} and move over the canvas to highlight.`;for(const [id,key] of [['highlightDelay','delay'],['highlightFade','fade'],['highlightColor','color'],['highlightWidth','width'],['highlightOpacity','opacity']])$(id).value=highlighter[key]}
function restoreHighlighter(value){highlighter=highlighterDefaults();if(value){for(const key of ['delay','fade','width']){const n=value[key],min=key==='delay'?0:key==='fade'?.1:4,max=key==='width'?400:30;if(Number.isFinite(n)&&n>=min&&n<=max)highlighter[key]=n}if(Number.isFinite(value.opacity)&&value.opacity>=0&&value.opacity<=100)highlighter.opacity=value.opacity;if(value.brushVersion!==2&&Number.isFinite(value.width))highlighter.width=Math.min(400,Math.max(4,value.width*64/24));if(/^#[\da-f]{6}$/i.test(value.color))highlighter.color=value.color;const b=value.binding;if(b&&typeof b.label==='string'&&((b.type==='key'&&typeof b.code==='string'&&b.code!=='Escape')||(b.type==='mouse'&&Number.isInteger(b.button)&&b.button>=0&&b.button<=4)))highlighter.binding={...b}}resetHighlight();syncHighlighter()}
function resetHighlight(){highlightHeld=false;highlightPointer=null;highlightLast=null}
function typingTarget(e){return /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable}
function addHighlight(e){
 const p=world(local(e)),now=performance.now();
 // One path per gesture keeps translucent joins from piling up into dark dots.
 if(!highlightLast||!highlights.includes(highlightLast)){
  highlightLast={points:[p],time:now,board:activeId,delay:highlighter.delay*1000,fade:highlighter.fade*1000,color:highlighter.color,width:highlighter.width,opacity:highlighter.opacity};
  highlights.push(highlightLast);
 }else{
  const last=highlightLast.points.at(-1);
  if(Math.hypot(p.x-last.x,p.y-last.y)>.25){highlightLast.points.push(p);highlightLast.time=now}
 }
}
function paintHighlights(c,scale,x,y){
 const now=performance.now();highlights=highlights.filter(h=>now-h.time<h.delay+h.fade);
 c.save();c.translate(x,y);c.scale(scale,scale);c.translate(-camera.x,-camera.y);
 c.setLineDash([]);c.lineCap='round';c.lineJoin='round';
 for(const h of highlights){
  if(h.board!==activeId)continue;
  c.globalAlpha=(h.opacity??40)/100*Math.min(1,Math.max(0,1-(now-h.time-h.delay)/h.fade));
  c.strokeStyle=h.color;c.fillStyle=h.color;c.lineWidth=h.width;
  const points=h.points,first=points[0];
  if(points.length===1){c.beginPath();c.roundRect(first.x-h.width/2,first.y-h.width/2,h.width,h.width,h.width*.18);c.fill();continue}
  c.beginPath();c.moveTo(first.x,first.y);
  for(let i=1;i<points.length-1;i++){
   const p=points[i],next=points[i+1];c.quadraticCurveTo(p.x,p.y,(p.x+next.x)/2,(p.y+next.y)/2);
  }
  const last=points.at(-1);c.lineTo(last.x,last.y);c.stroke();
 }
 c.restore();
}
$('bindHighlight').onclick=()=>{bindingHighlight=true;resetHighlight();syncHighlighter()};
window.addEventListener('keydown',e=>{if(bindingHighlight){e.preventDefault();e.stopImmediatePropagation();if(e.code!=='Escape')highlighter.binding={type:'key',code:e.code,label:e.key.length===1?e.key.toUpperCase():e.key};bindingHighlight=false;syncHighlighter();scheduleLocalSave();return}if(!typingTarget(e)&&highlighter.binding.type==='key'&&e.code===highlighter.binding.code&&(!e.ctrlKey||e.code.startsWith('Control'))&&(!e.metaKey||e.code.startsWith('Meta'))&&(!e.altKey||e.code.startsWith('Alt'))){e.preventDefault();e.stopImmediatePropagation();if(!highlightHeld){endGesture();highlightLast=null}highlightHeld=true}},true);
window.addEventListener('keyup',e=>{if(highlighter.binding.type==='key'&&e.code===highlighter.binding.code&&highlightHeld){e.preventDefault();e.stopImmediatePropagation();resetHighlight()}},true);
window.addEventListener('pointerdown',e=>{if(!bindingHighlight)return;e.preventDefault();e.stopImmediatePropagation();highlighter.binding={type:'mouse',button:e.button,label:['Left mouse','Middle mouse','Right mouse','Mouse back','Mouse forward'][e.button]||`Mouse ${e.button}`};bindingHighlight=false;syncHighlighter();scheduleLocalSave();const suppressClick=event=>{event.preventDefault();event.stopImmediatePropagation()};window.addEventListener('click',suppressClick,{capture:true,once:true});setTimeout(()=>window.removeEventListener('click',suppressClick,true),600)},true);
stage.addEventListener('pointerdown',e=>{if(highlightHeld||(highlighter.binding.type==='mouse'&&e.button===highlighter.binding.button)){e.preventDefault();e.stopImmediatePropagation();endGesture();highlightHeld=true;highlightPointer=e.pointerId;highlightLast=null;stage.setPointerCapture(e.pointerId);addHighlight(e)}},true);
stage.addEventListener('pointermove',e=>{if(!highlightHeld)return;e.preventDefault();e.stopImmediatePropagation();stage.style.cursor='crosshair';addHighlight(e)},true);
for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,e=>{if(highlightPointer===e.pointerId){e.preventDefault();e.stopImmediatePropagation();if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);resetHighlight()}},true);
document.addEventListener('focusin',e=>{if(typingTarget(e))resetHighlight()});
stage.addEventListener('pointerleave',()=>{highlightLast=null});window.addEventListener('blur',()=>{resetHighlight();bindingHighlight=false;syncHighlighter()});
for(const type of ['contextmenu','auxclick'])stage.addEventListener(type,e=>{if(highlighter.binding.type==='mouse'&&e.button===highlighter.binding.button)e.preventDefault()});
for(const [id,key] of [['highlightDelay','delay'],['highlightFade','fade'],['highlightColor','color'],['highlightWidth','width'],['highlightOpacity','opacity']])$(id).onchange=()=>{if(!$(id).checkValidity()||$(id).value===''){syncHighlighter();return}highlighter[key]=key==='color'?$(id).value:Number($(id).value);scheduleLocalSave()};
$('highlightOpacity').addEventListener('input',()=>{highlighter.opacity=Number($('highlightOpacity').value);$('highlightOpacityValue').textContent=highlighter.opacity+'%';scheduleLocalSave()});
$('highlightWidth').addEventListener('input',()=>{highlighter.width=Number($('highlightWidth').value);$('highlightWidthValue').textContent=highlighter.width+' px';scheduleLocalSave()});
$('notes').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const field=e.target;field.setRangeText('\t',field.selectionStart,field.selectionEnd,'end');scheduleLocalSave()}});
syncHighlighter();

const pdfDocuments=new Map(),pdfLayouts=new Map(),pdfPages=new Map();let pdfBusy=false;
function readDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)})}
async function pdfDocument(source){if(!pdfDocuments.has(source)){const bytes=Uint8Array.from(atob(source.split(',')[1]),c=>c.charCodeAt(0));const task=getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('pdfjs/cmaps/',document.baseURI).href,standardFontDataUrl:new URL('pdfjs/standard_fonts/',document.baseURI).href,wasmUrl:new URL('pdfjs/wasm/',document.baseURI).href,iccUrl:new URL('pdfjs/iccs/',document.baseURI).href});task.onPassword=()=>task.destroy();const promise=task.promise.catch(error=>{pdfDocuments.delete(source);throw error});pdfDocuments.set(source,promise)}return pdfDocuments.get(source)}
async function rasterPdfPage(source,number){const doc=await pdfDocument(source),page=await doc.getPage(number),natural=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,2000/Math.max(natural.width,natural.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;const src=canvas.toDataURL('image/png');media.set(src,await imageFrom(src));page.cleanup();return {src,width:viewport.width,height:viewport.height,count:doc.numPages}}
// Page positions and scroll offsets are measured in multiples of the object's width.
// Resizing or zooming therefore preserves the reading position.
function renderPdfPage(source,number){
 let pages=pdfPages.get(source);if(!pages){pages=new Map();pdfPages.set(source,pages)}
 if(!pages.has(number))pages.set(number,rasterPdfPage(source,number).catch(error=>{pages.delete(number);throw error}));
 return pages.get(number);
}
function pdfLayout(source){
 if(!pdfLayouts.has(source)){
  const layout={pages:[],height:0,ready:false,failed:false};pdfLayouts.set(source,layout);
  layout.promise=(async()=>{
   const doc=await pdfDocument(source);let top=0;
   for(let number=1;number<=doc.numPages;number++){
    const page=await doc.getPage(number),size=page.getViewport({scale:1}),height=size.height/size.width;
    layout.pages.push({number,top,height,src:null,pending:false,failed:false});top+=height+.02;
   }
   layout.height=top-.02;layout.ready=true;return layout;
  })().catch(()=>{layout.failed=true;status('Could not load this PDF.');return null});
 }
 return pdfLayouts.get(source);
}
function pdfScrollPosition(n,layout){
 const saved=Number.isFinite(n.pdf.scroll)?n.pdf.scroll:(layout.pages[n.pdf.page-1]?.top||0);
 return Math.max(0,Math.min(Math.max(0,layout.height-n.h/n.w),saved));
}
function paintPdf(c,n){
 const layout=pdfLayout(n.pdf.source);
 if(!layout.ready){const img=media.get(n.src);if(img)c.drawImage(img,0,0,n.w,n.h);return}
 const scroll=pdfScrollPosition(n,layout);
 c.save();c.beginPath();c.rect(0,0,n.w,n.h);c.clip();c.fillStyle='#e2e6eb';c.fillRect(0,0,n.w,n.h);
 for(const page of layout.pages){
  const y=(page.top-scroll)*n.w,h=page.height*n.w;if(y+h < -n.h||y > n.h*2)continue;
  if(!page.src&&!page.pending&&!page.failed){
   page.pending=true;renderPdfPage(n.pdf.source,page.number).then(result=>{page.src=result.src}).catch(()=>{page.failed=true;status('Could not load this PDF page.')}).finally(()=>{page.pending=false});
  }
  if(y+h<0||y>n.h)continue;
  const img=media.get(page.src);
  c.fillStyle='white';c.fillRect(0,y,n.w,h);
  if(img)c.drawImage(img,0,y,n.w,h);
  else{c.fillStyle='#64748b';c.font=`${Math.max(12,n.w*.02)}px sans-serif`;c.textAlign='center';c.fillText(page.failed?'Could not load page':`Loading page ${page.number}…`,n.w/2,Math.max(y+30,30))}
 }
 c.restore();
}
function setPdfScroll(n,layout,position){
 const scroll=Math.max(0,Math.min(Math.max(0,layout.height-n.h/n.w),position));
 if(scroll===pdfScrollPosition(n,layout)&&Number.isFinite(n.pdf.scroll))return;
 const middle=scroll+n.h/n.w/2,page=layout.pages.find(p=>p.top+p.height>middle)||layout.pages.at(-1);
 const pageChanged=n.pdf.page!==page.number;
 n.pdf={...n.pdf,scroll,page:page.number};
 // Retain a matching preview for saved projects while visible pages render lazily.
 if(pageChanged)renderPdfPage(n.pdf.source,page.number).then(result=>{if(nodes.includes(n)&&n.pdf.page===page.number){n.src=result.src;scheduleLocalSave()}}).catch(()=>{});
 syncPdfControls(selection.size===1?nodes.find(node=>node.id===selected):null);scheduleLocalSave();
}
function scrollPdf(n,e){
 const layout=pdfLayout(n.pdf.source);if(!layout.ready)return;
 const scale=frame.w/1920*camera.z,delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?n.h*scale:1);
 if(!delta)return;
 setPdfScroll(n,layout,pdfScrollPosition(n,layout)+delta/(scale*n.w));
}
async function addPdf(file,point={x:camera.x,y:camera.y}){storeBoard();const target=activeBoard();$('pdf').disabled=true;try{status('Opening PDF…');const source=(await readDataURL(file)).replace(/^data:[^;]*;/,'data:application/pdf;'),page=await renderPdfPage(source,1);if(!boards.includes(target))return;const w=Math.min(850,page.width),h=w*page.height/page.width;add({type:'image',src:page.src,pdf:{source,page:1,count:page.count,name:file.name},x:point.x-w/2,y:point.y-h/2,w,h},target);sync();if(target===activeBoard())setPanel('style');status('PDF added. Scroll over it to read; drag or resize it like any object.')}catch{status('Could not open this PDF. Choose a valid PDF without a password.')}finally{$('pdf').disabled=false}}
function syncPdfControls(n){$('pdfControls').hidden=!n?.pdf;if(!n?.pdf)return;$('pdfName').textContent=n.pdf.name;$('pdfPageStatus').textContent=`Page ${n.pdf.page} of ${n.pdf.count}`;$('pdfPrevious').disabled=pdfBusy||n.pdf.page<=1;$('pdfNext').disabled=pdfBusy||n.pdf.page>=n.pdf.count}
async function changePdfPage(delta){
 const n=nodes.find(n=>n.id===selected);if(!n?.pdf||pdfBusy)return;
 const number=n.pdf.page+delta;if(number<1||number>n.pdf.count)return;
 pdfBusy=true;syncPdfControls(n);
 try{const layout=await pdfLayout(n.pdf.source).promise;if(!layout||!nodes.includes(n))return;snapshot();setPdfScroll(n,layout,layout.pages[number-1].top);sync()}
 catch{status('Could not load this PDF page.')}
 finally{pdfBusy=false;syncPdfControls(selection.size===1?nodes.find(n=>n.id===selected):null)}
}
$('pdf').onclick=()=>$('pdfFile').click();$('pdfFile').onchange=async e=>{const file=e.target.files[0];if(file)await addPdf(file);e.target.value=''};$('pdfPrevious').onclick=()=>changePdfPage(-1);$('pdfNext').onclick=()=>changePdfPage(1);
async function importCanvasFiles(files,point){for(const file of files){if(file.type==='application/pdf'||/\.pdf$/i.test(file.name))await addPdf(file,point);else await addImages([file],point)}}
// Prepared lessons merge into the workspace; existing canvases and settings remain intact.
async function loadLessonOne(activate=true){
 const existingBoards=boards.filter(b=>b.lessonId==='lesson-01'),existing=existingBoards[0];
 if(existing&&existing.lessonLayoutVersion>=LESSON_LAYOUT_VERSION){if(!installedLessons.includes('lesson-01'))installedLessons.push('lesson-01');lessonSourceVersion=LESSON_LAYOUT_VERSION;if(activate){switchBoard(existing.id);setPanel('notes')}return}
 if(recording||recordingBusy)return;
 $('lessonOne').disabled=true;
 try{
  const response=await fetch(new URL('lessons/lesson-01.canvas.json',document.baseURI));if(!response.ok)throw new Error('Lesson file unavailable');
  const project=await response.json(),loaded=new Map();project.boards.forEach(prepareLessonForm);
  await Promise.all(project.boards.flatMap(b=>b.nodes).filter(n=>n.type==='image').map(async n=>{if(!loaded.has(n.src))loaded.set(n.src,imageFrom(n.src));await loaded.get(n.src)}));
  finishTextEdit();endGesture();storeBoard();
  const incoming=project.boards.map(b=>{const ids=new Map(b.nodes.map(n=>[n.id,crypto.randomUUID()]));return {...b,id:crypto.randomUUID(),nodes:b.nodes.map(n=>({...n,id:ids.get(n.id),...(n.containerId?{containerId:ids.get(n.containerId)}:{})})),history:[],future:[]}});
  for(const b of incoming)for(const n of b.nodes)if(n.type==='image')media.set(n.id,await loaded.get(n.src));
  const replacedIds=new Set(existingBoards.map(b=>b.id)),insertAt=existing?boards.indexOf(existing):boards.length,activeWasReplaced=replacedIds.has(activeId);
  for(const old of existingBoards)for(const n of old.nodes){const source=audioSources.get(n.id);source?.source.disconnect();source?.gain.disconnect();audioSources.delete(n.id);media.delete(n.id)}
  boards=boards.filter(b=>!replacedIds.has(b.id));boards.splice(insertAt,0,...incoming);
  if(!installedLessons.includes('lesson-01'))installedLessons.push('lesson-01');starterLessonDismissed=false;lessonSourceVersion=LESSON_LAYOUT_VERSION;
  if(activeWasReplaced){const next=incoming[incoming.length-1];activeId=next.id;nodes=next.nodes;camera=next.camera;history=next.history;$('background').value=next.background;selectNodes([]);hovered=null;sync();renderBoardList()}
  else if(activate)switchBoard(incoming[0].id);else renderBoardList();
  if(activate)setPanel('notes');scheduleLocalSave();status('Lesson 1 is ready — all text and objects are editable.');
 }catch(e){status('Could not load Lesson 1: '+e.message)}finally{$('lessonOne').disabled=false}
}
$('lessonOne').onclick=()=>loadLessonOne();
$('boardNotes').addEventListener('input',()=>{activeBoard().notes=$('boardNotes').value;scheduleLocalSave()});

$('formDemo').onchange=()=>{finishTextEdit();selectNodes([]);hovered=null;sync()};
const preferenceIds=['color','fontFamily','fontWeight','fontSize','stroke','mic'];
function localSnapshot(){
 const project=projectData();
 if(editingText){const node=project.boards.flatMap(b=>b.nodes).find(n=>n.id===editingText.id);if(node)node.text=$('inlineText').value}
 return {project,preferences:Object.fromEntries(preferenceIds.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value])),panel:document.querySelector('[data-panel][aria-selected="true"]')?.dataset.panel};
}
function scheduleLocalSave(){
 if(!localReady||restoringLocal)return;
 localDirty=true;clearTimeout(localSaveTimer);localSaveTimer=setTimeout(saveLocal,500);
}
function saveLocal(){
 clearTimeout(localSaveTimer);
 if(!localReady||!localDatabase||!localDirty||localSaving)return;
 localSaving=true;localDirty=false;
 try{
  const transaction=localDatabase.transaction('workspace','readwrite');
  transaction.objectStore('workspace').put(localSnapshot(),'latest');
  transaction.oncomplete=()=>{localSaving=false;localSaveFailed=false;if(localDirty)saveLocal()};
  transaction.onabort=transaction.onerror=()=>{localSaving=false;localDirty=true;if(!localSaveFailed)status('Local save failed. Use Save project to keep a backup.');localSaveFailed=true};
 }catch{localSaving=false;localDirty=true;localSaveFailed=true;status('Local save failed. Use Save project to keep a backup.')}
}
async function restoreLocal(){
 restoringLocal=true;document.querySelector('main').inert=true;document.querySelector('header').inert=true;
 try{
  await Promise.all([document.fonts.load('400 48px "Lesson Arabic"'),document.fonts.load('700 48px "Lesson Arabic"'),document.fonts.load('400 48px "Lesson Latin"'),document.fonts.load('700 48px "Lesson Latin"')]);
  localDatabase=await new Promise((resolve,reject)=>{const request=indexedDB.open('canvas-local-workspace',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspace');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Storage blocked'))});
  const saved=await new Promise((resolve,reject)=>{const request=localDatabase.transaction('workspace').objectStore('workspace').get('latest');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  if(saved){
   await restoreProject(saved.project);
   for(const id of preferenceIds){const value=saved.preferences?.[id];if(value!==undefined){if($(id).type==='checkbox')$(id).checked=!!value;else $(id).value=value}}
   $('strokeValue').textContent=$('stroke').value+' px';
   if(['style','motion','recording','notes'].includes(saved.panel))setPanel(saved.panel);
   status('Previous workspace restored');
  }
  localReady=true;
  if(lessonSourceVersion<LESSON_LAYOUT_VERSION||!starterLessonDismissed&&!installedLessons.includes('lesson-01'))await loadLessonOne(false);
 }catch{localSaveFailed=true;status('Could not restore local storage. Use Open project to load a saved backup.')}
 finally{restoringLocal=false;document.querySelector('main').inert=false;document.querySelector('header').inert=false;if(localReady)scheduleLocalSave()}
}
for(const event of ['input','change','pointerup','keyup','wheel','click'])document.addEventListener(event,scheduleLocalSave,{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveLocal()});
window.addEventListener('pagehide',saveLocal);
window.addEventListener('beforeunload',e=>{saveLocal();if(recording||localSaveFailed||localDirty||localSaving){e.preventDefault();e.returnValue=''}});
setTool('select');sync();resize();renderBoardList();render();restoreLocal();
