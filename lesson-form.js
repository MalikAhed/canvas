// Native canvas objects remain editable, draggable, and part of the recording.
export function prepareLessonForm(board){
 if(board.nodes.some(n=>n.demoRole)){groupLessonForm(board);return}
 if(board.lessonId!=='lesson-01'||!board.nodes.some(n=>n.type==='text'&&n.text==='النموذج: واجهة سهلة للتعامل'))return;
 const nodes=board.nodes;
 const mark=(test,role)=>{const n=nodes.find(test);if(n)n.demoRole=role;return n};
 mark(n=>n.type==='text'&&n.x>100&&n.y===-50,'name');
 mark(n=>n.type==='text'&&n.x>100&&n.y>70&&n.y<110,'grade');
 mark(n=>n.type==='rect'&&n.x===130&&n.y===-70,'nameBox');
 mark(n=>n.type==='rect'&&n.x===130&&n.y===60,'gradeBox');
 mark(n=>n.type==='rect'&&n.x===170&&n.y===200,'addBox');
 const button=mark(n=>n.type==='text'&&n.text==='حفظ البيانات','add');if(button){button.text='إضافة';const box=nodes.find(n=>n.demoRole==='addBox');if(box){button.w=100;button.x=box.x+(box.w-button.w)/2}}
 mark(n=>n.type==='rect'&&n.x===-810&&n.y===-125,'tableHeader');
 for(const n of nodes){if(n.type==='rect'&&n.x===-810&&n.w===610&&n.y>=-30&&n.y<=65){n.demoRole='row';n.demoRow=n.y===-30?0:1}if(n.type==='text'&&n.x<0&&n.y>=-12&&n.y<=83){n.demoRole='cell';n.demoRow=n.y===-12?0:1;n.demoColumn=n.x>-505?'name':'grade'}}
 const caption=nodes.find(n=>n.type==='text'&&n.text==='الجدول يخزّن');if(caption)caption.y=435;
 board.notes='جرّب النموذج أمام الطالب.\n• انقر حقل الاسم أو الدرجة واكتب القيمة.\n• اضغط «إضافة» لإضافة سجل إلى الجدول؛ يضيء السجل الجديد ثم يتلاشى التمييز.\n• وضّح أن النموذج واجهة، والجدول هو مكان حفظ البيانات.\n• عطّل Interactive form demo من الشريط الجانبي لسحب عناصر النموذج وتعديل تصميمه.';
 groupLessonForm(board);
}
function groupLessonForm(board){
 if(board.nodes.some(n=>n.demoRole==='interfaceRoot'))return;
 const parts=board.nodes.filter(n=>n.y>=-255);
 const root={id:crypto.randomUUID(),type:'rect',x:-840,y:-255,w:1680,h:770,color:'#ffffff',radius:20,demoRole:'interfaceRoot',demoPart:true};
 const ids=new Set(parts.map(n=>n.id));for(const n of parts){n.demoPart=true;if(!ids.has(n.containerId))n.containerId=root.id}
 board.nodes.unshift(root);
}
export function appendDemoRow(nodes,id=()=>crypto.randomUUID(),now=Date.now()){
 const field=role=>nodes.find(n=>n.demoRole===role);
 const name=field('name')?.text.trim().replace(/\s+/g,' '),grade=field('grade')?.text.trim().replace(/[٠-٩۰-۹]/g,d=>String(d.charCodeAt(0)-(d<='٩'?0x660:0x6f0)));
 if(name&&name.length>40)return {error:'استخدم اسمًا قصيرًا (حتى 40 حرفًا).'};
 if(!name)return {error:'اكتب اسم الطالب أولًا.'};
 if(!grade||!/^\d+(\.\d+)?$/.test(grade)||Number(grade)>100)return {error:'أدخل درجة من 0 إلى 100.'};
 const header=field('tableHeader'),rows=nodes.filter(n=>n.demoRole==='row');
 if(!header||!rows.length)return {error:'تعذرت الإضافة: أعد فتح لوحة النموذج الأصلية.'};
 const index=Math.max(...rows.map(n=>n.demoRow))+1,template=rows.at(-1);
 const row={...template,id:id(),demoRow:index,demoFlashUntil:now+1600};
 row.containerId=field('interfaceRoot')?.id;nodes.push(row);
 for(const column of ['name','grade']){
  const original=nodes.find(n=>n.demoRole==='cell'&&n.demoColumn===column);
  if(!original)continue;
  nodes.push({...original,id:id(),text:column==='name'?name:grade,demoRow:index,containerId:row.id});
 }
 const scale=header.w/610,height=Math.min(95,440/(index+1))*scale;
 for(const n of nodes){if(n.demoRole==='row'){n.x=header.x;n.y=header.y+header.h+n.demoRow*height;n.w=header.w;n.h=height}if(n.demoRole==='cell'){n.size=Math.min(34*scale,height*.42);n.w=header.w/2-24*scale;n.h=n.size*1.25;n.x=header.x+(n.demoColumn==='name'?header.w/2:0)+12*scale;n.y=header.y+header.h+n.demoRow*height+(height-n.h)/2;n.direction=n.demoColumn==='name'?'rtl':'ltr'}}
 field('name').text='';field('grade').text='';
 return {row};
}
