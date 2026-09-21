import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the production wheel handler and PDF viewport with controlled page renders.
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const wheel=source.match(/stage\.addEventListener\('wheel',[^\n]+/)[0];
const helpers=source.slice(source.indexOf('function pdfScrollPosition('),source.indexOf('async function addPdf('));
const hit=source.match(/function hit\(p,padding=10\)[^\n]+/)[0];
const pdf={id:'pdf',type:'image',x:0,y:0,w:100,h:100,src:'page1',pdf:{source:'document',page:1,count:3}};
const layout={ready:true,height:3.04,pages:[0,1.02,2.04].map((top,i)=>({number:i+1,top,height:1,src:`page${i+1}`}))};
const calls=[];
const context=vm.createContext({
 nodes:[pdf],selection:new Set(),selected:null,gesture:null,frame:{w:1920},camera:{z:1},H:500,
 stage:{addEventListener(_,handler){this.wheel=handler}},local:e=>({x:e.clientX,y:e.clientY}),world:p=>p,
 insideFrame:p=>p.x<500,zoomContent:()=>calls.push('content zoom'),zoomView:()=>calls.push('view zoom'),
 pdfLayout:()=>layout,renderPdfPage:async(_,number)=>({src:`page${number}`}),
 media:new Map(layout.pages.map(p=>[p.src,p.src])),syncPdfControls(){},scheduleLocalSave(){},status(){},
});
vm.runInContext(hit+'\n'+helpers+'\n'+wheel,context);
function scroll(deltaY,x=50,y=50,deltaMode=0){let prevented=false;context.stage.wheel({clientX:x,clientY:y,deltaY,deltaMode,preventDefault(){prevented=true}});assert.ok(prevented)}
scroll(12);assert.equal(pdf.pdf.scroll,.12);assert.equal(pdf.pdf.page,1);assert.equal(pdf.h,100);assert.deepEqual(calls,[]);
scroll(12);assert.equal(pdf.pdf.scroll,.24); // Small deltas accumulate continuously.
scroll(-8);assert.ok(Math.abs(pdf.pdf.scroll-.16)<1e-10);
scroll(10000);assert.equal(pdf.pdf.scroll,2.04);assert.equal(pdf.pdf.page,3);
scroll(12);assert.equal(pdf.pdf.scroll,2.04);assert.deepEqual(calls,[]); // No zoom at document ends.
scroll(-10000);assert.equal(pdf.pdf.scroll,0);
scroll(1,50,50,1);assert.equal(pdf.pdf.scroll,.16); // Line-mode wheel.
scroll(-10000);scroll(1,50,50,2);assert.equal(pdf.pdf.scroll,1); // Page-mode wheel.
scroll(-10000);context.camera.z=2;scroll(20);assert.equal(pdf.pdf.scroll,.1);context.camera.z=1;
scroll(20,101);assert.deepEqual(calls,['content zoom']); // Exact PDF bounds, no selection padding.
scroll(20,600);assert.deepEqual(calls,['content zoom','view zoom']);
context.nodes.push({id:'overlay',x:25,y:25,w:50,h:50});scroll(20);assert.equal(calls.at(-1),'content zoom');context.nodes.pop();
context.gesture={kind:'move'};const before=pdf.pdf.scroll;scroll(20);assert.equal(pdf.pdf.scroll,before);context.gesture=null;
pdf.pdf.scroll=.75;const drawing=[];
const paint={save(){drawing.push('save')},beginPath(){},rect(...args){drawing.push(['clip rect',...args])},clip(){drawing.push('clip')},fillRect(){},drawImage(...args){drawing.push(args)},restore(){drawing.push('restore')}};
context.paintPdf(paint,pdf);
assert.deepEqual(drawing[1],['clip rect',0,0,100,100]);assert.equal(drawing[2],'clip');
assert.deepEqual(drawing[3],['page1',0,-75,100,100]);assert.ok(Math.abs(drawing[4][2]-27)<1e-10);assert.equal(drawing.at(-1),'restore');
pdf.w=200;pdf.h=200;assert.equal(context.pdfScrollPosition(pdf,layout),.75); // Resizing preserves position.
delete pdf.pdf.scroll;pdf.pdf.page=2;assert.equal(context.pdfScrollPosition(pdf,layout),1.02); // Older saved PDFs.
await Promise.resolve();
console.log('PDF scrolling checks passed: continuous motion, limits, wheel units, zoom scaling, hit routing, clipping, resizing, and saved pages.');
