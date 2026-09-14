const NS = 'http://www.w3.org/2000/svg';
const STORAGE = 'voidbelt-test-skills-v1';
const branches = [
  {id:'precision',name:'Précision',color:'#82b6df',shade:'#17232f',icon:'♞',subtitle:'ESPRIT · MOUVEMENT · MAÎTRISE',angle:-90},
  {id:'vitality',name:'Vitalité',color:'#97c985',shade:'#1b2b1b',icon:'♧',subtitle:'SURVIE · RÉSILIENCE · RENAISSANCE',angle:150},
  {id:'power',name:'Puissance',color:'#d68277',shade:'#301c1a',icon:'♜',subtitle:'ATTAQUE · CONTRÔLE · DESTRUCTION',angle:30}
];
// Each child requires its parent at maximum rank. Multiple children create forks.
const layout = [
  [100,0,-1,3,'active'],[175,-65,0,2,'passive'],[175,65,0,3,'passive'],
  [245,-105,1,5,'active'],[250,-25,1,1,'passive'],[250,55,2,3,'active'],[245,130,2,2,'passive'],
  [325,-160,3,3,'passive'],[330,-90,3,2,'passive'],[320,-20,4,4,'passive'],[325,65,5,3,'passive'],[320,145,6,1,'active'],
  [405,-205,7,1,'mastery'],[400,-130,8,3,'passive'],[395,-55,9,2,'active'],[395,80,10,5,'passive'],[400,180,11,3,'mastery']
];
const names = [
 ['Instinct','Œil du faucon','Pas léger','Tir pénétrant','Concentration','Lame dansante','Réflexes','Vision lointaine','Point faible','Sang-froid','Évasion','Ombre fugace','Œil absolu','Embuscade','Temps suspendu','Contre-attaque','Maître des ombres'],
 ['Sève de vie','Peau de pierre','Second souffle','Régénération','Enracinement','Cœur sauvage','Herboriste','Écorce ancienne','Vitalité profonde','Résilience','Élixir','Symbiose','Arbre éternel','Rempart vivant','Renaissance','Force de la nature','Gardien ancestral'],
 ['Étincelle','Frappe lourde','Fureur','Brise-armure','Brasier','Onde de choc','Domination','Incandescence','Exécution','Combustion','Séisme','Soif de bataille','Avatar de guerre','Ravage','Météore','Destruction','Flamme éternelle']
];
const icons = [['⌖','◉','➶','➳','✧','⚔','↯','◎','⌾','☽','⟡','♟','✵','➴','⌛','⚔','♞'],['✚','⬡','♡','❧','♧','♥','⚘','♠','❀','⚓','⚗','♧','♜','✥','✦','♧','♧'],['ϟ','⚒','♨','⚔','♨','✴','♜','☀','⚔','✹','✧','♠','♜','✺','☄','✷','♨']];
const effects = ['de chance de coup critique','de vitalité','de dégâts'];
const nodes = branches.flatMap((b,bi)=>layout.map(([distance,side,parent,max,type],i)=>{
  const a=b.angle*Math.PI/180;
  return {id:`${b.id}-${i}`,branch:bi,name:names[bi][i],icon:icons[bi][i],parent:parent<0?null:`${b.id}-${parent}`,max,type,x:750+Math.cos(a)*distance-Math.sin(a)*side,y:465+Math.sin(a)*distance+Math.cos(a)*side};
}));
let state={points:12,ranks:{}};
try{const saved=JSON.parse(localStorage.getItem(STORAGE));if(saved&&Number.isSafeInteger(saved.points)&&saved.points>=0&&saved.ranks&&typeof saved.ranks==='object'){state.points=saved.points;for(const n of nodes){const rank=saved.ranks[n.id];if(Number.isInteger(rank)&&rank>=0&&rank<=n.max&&(!n.parent||state.ranks[n.parent]===nodes.find(p=>p.id===n.parent).max))state.ranks[n.id]=rank;}}}catch{}
let selected=null,toastTimer;
const $=id=>document.getElementById(id);
function svg(tag,attrs={},parent=$('tree')){const el=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);parent.append(el);return el;}
function label(text,attrs,parent){const el=svg('text',attrs,parent);el.textContent=text;return el;}
function rank(n){return state.ranks[n.id]||0;}
function available(n){return !n.parent||rank(nodes.find(p=>p.id===n.parent))===nodes.find(p=>p.id===n.parent).max;}
function save(){try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{notify('Sauvegarde indisponible : la progression reste active dans cet onglet.');}}
function notify(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2800);}
function draw(){
  $('tree').replaceChildren();
  const decor=svg('g',{class:'ornament','aria-hidden':'true'});
  for(const r of [58,66,81,265,355,425,436,447])svg('circle',{cx:750,cy:465,r},decor);
  for(let i=0;i<120;i++){const a=i*Math.PI/60,r=i%5===0?420:430;svg('line',{x1:750+Math.cos(a)*r,y1:465+Math.sin(a)*r,x2:750+Math.cos(a)*442,y2:465+Math.sin(a)*442},decor);}
  for(let i=0;i<12;i++){const a=i*Math.PI/6;svg('line',{x1:750+Math.cos(a)*84,y1:465+Math.sin(a)*84,x2:750+Math.cos(a)*440,y2:465+Math.sin(a)*440},decor);}
  svg('path',{d:'M750 25 L185 775 L1315 775 Z M750 45 L210 760 L1290 760 Z'},decor);
  for(const n of nodes){const p=nodes.find(p=>p.id===n.parent)||{x:750,y:465};svg('line',{x1:p.x,y1:p.y,x2:n.x,y2:n.y,class:`connection ${rank(n)?'lit':''}`,style:`--branch:${branches[n.branch].color}`});}
  const center=svg('g',{'aria-hidden':'true'});svg('circle',{cx:750,cy:465,r:52,fill:'#0d1111',stroke:'#c5b183','stroke-width':2},center);svg('circle',{cx:750,cy:465,r:43,fill:'none',stroke:'#9f916c'},center);label('⟁',{x:750,y:478,'text-anchor':'middle',fill:'#e1cea3','font-size':65},center);label('ÉVEIL',{x:750,y:547,class:'branch-subtitle'},center);
  for(const b of branches){const top=b.angle===-90,x=top?750:b.angle===150?185:1315,y=top?-115:710;const g=svg('g',{style:`--branch:${b.color}`,'aria-hidden':'true'});for(const r of [61,68,77])svg('circle',{cx:x,cy:y,r,fill:'none',stroke:b.color,opacity:r===61?.6:.18},g);svg('path',{d:`M ${x} ${y-51} L ${x+45} ${y-25} L ${x+45} ${y+25} L ${x} ${y+51} L ${x-45} ${y+25} L ${x-45} ${y-25} Z`,class:'emblem'},g);label(b.icon,{x,y,class:'emblem-icon'},g);label(b.name.toUpperCase(),{x,y:y+96,class:'branch-title',fill:b.color},g);label(b.subtitle,{x,y:y+116,class:'branch-subtitle'},g);}
  for(const n of nodes){const b=branches[n.branch],r=n.type==='passive'?18:24;const g=svg('g',{class:`node ${rank(n)?'active':available(n)?'available':'locked'} ${selected===n.id?'selected':''}`,transform:`translate(${n.x} ${n.y})`,style:`--branch:${b.color};--shade:${b.shade}`,tabindex:0,role:'button','aria-label':`${n.name}, rang ${rank(n)} sur ${n.max}, ${available(n)?'disponible':'verrouillée'}`,'aria-haspopup':'dialog'});svg('circle',{r:r+5,class:'outer'},g);if(n.type==='passive')svg('circle',{r,class:'shape'},g);else svg('polygon',{points:n.type==='active'?`0,-${r} ${r},0 0,${r} -${r},0`:`0,-${r} ${r*.87},-${r/2} ${r*.87},${r/2} 0,${r} -${r*.87},${r/2} -${r*.87},-${r/2}`,class:'shape'},g);label(available(n)||rank(n)?n.icon:'·',{y:-1,class:'icon'},g);if(!available(n)&&!rank(n)){svg('rect',{x:-5,y:-1,width:10,height:9,rx:1,fill:'#999e91'},g);svg('path',{d:'M-3-1 V-5 A3 3 0 0 1 3-5 V-1',fill:'none',stroke:'#999e91','stroke-width':1.6},g);}label(`${rank(n)}/${n.max}`,{y:r+17,class:'rank'},g);const title=svg('title',{},g);title.textContent=n.name;g.addEventListener('click',()=>open(n.id));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(n.id);}});}
  $('points').textContent=state.points;const total=nodes.reduce((sum,n)=>sum+rank(n),0);$('progress').textContent=`${total} rang${total>1?'s':''} investi${total>1?'s':''} · ${nodes.filter(n=>rank(n)===n.max).length}/${nodes.length} compétences maîtrisées`;
}
function open(id){selected=id;draw();updatePanel();$('panel').hidden=false;}
function updatePanel(){if(!selected)return;const n=nodes.find(n=>n.id===selected),b=branches[n.branch],parent=nodes.find(p=>p.id===n.parent);$('panel').style.setProperty('--selected',b.color);$('branch-name').textContent=`${b.name} / ${n.type==='passive'?'Passif':n.type==='active'?'Actif':'Maîtrise'}`;$('skill-icon').textContent=n.icon;$('skill-name').textContent=n.name;$('description').textContent=`Développez votre ${b.name.toLowerCase()} en investissant dans ${n.name.toLowerCase()}. Atteignez le rang ${n.max} pour ouvrir les chemins suivants.`;$('ranks').replaceChildren();for(let i=0;i<n.max;i++){const mark=document.createElement('i');mark.className=i<rank(n)?'filled':'';$('ranks').append(mark);}$('effect').textContent=`Rang ${rank(n)} / ${n.max} · +${rank(n)*2} % ${effects[n.branch]}`;const children=nodes.filter(p=>p.parent===n.id);$('requirement').textContent=!available(n)?`Prérequis : ${parent.name} au rang ${parent.max} (${rank(parent)}/${parent.max}).`:children.length?`Ouvre au rang ${n.max} : ${children.map(p=>p.name).join(', ')}.`:'Dernière compétence de ce chemin.';$('invest').disabled=!available(n)||rank(n)===n.max||state.points<1;$('invest').textContent=rank(n)===n.max?'Compétence maîtrisée':!available(n)?'Compétence verrouillée':state.points<1?'Aucun point disponible':`Investir 1 point · Rang ${rank(n)+1}`;}
$('invest').addEventListener('click',()=>{const n=nodes.find(n=>n.id===selected);if(!n||!available(n)||rank(n)>=n.max||state.points<1)return;state.points--;state.ranks[n.id]=rank(n)+1;save();draw();updatePanel();if(rank(n)===n.max)notify(`${n.name} maîtrisée !`);});
$('add').addEventListener('click',()=>{state.points+=5;save();draw();updatePanel();notify('5 points de compétence ajoutés');});
function closePanel(){const id=selected;selected=null;$('panel').hidden=true;draw();if(id){const index=nodes.findIndex(n=>n.id===id);$('tree').querySelectorAll('.node')[index]?.focus();}}
$('close').addEventListener('click',closePanel);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('panel').hidden)closePanel();});
$('reset').addEventListener('click',()=>{state={points:12,ranks:{}};selected=null;$('panel').hidden=true;save();draw();notify('Arbre réinitialisé · 12 points disponibles');});
draw();

// Camera coordinates stay independent of redraws and skill progression.
const tree = $('tree');
const initialView = {x:0,y:-210,width:1500,height:1100};
let camera = {...initialView}, gesture = null, suppressClick = false;
function renderCamera(){
  tree.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.width} ${camera.height}`);
  $('zoom-level').textContent = `${Math.round(initialView.width / camera.width * 100)} %`;
}
function worldPoint(clientX,clientY){
  return new DOMPoint(clientX,clientY).matrixTransform(tree.getScreenCTM().inverse());
}
function zoomAt(factor,point){
  const width=Math.max(initialView.width/4,Math.min(initialView.width/0.6,camera.width*factor));
  const ratio=width/camera.width;
  camera={x:point.x-(point.x-camera.x)*ratio,y:point.y-(point.y-camera.y)*ratio,width,height:camera.height*ratio};
  renderCamera();
}
tree.addEventListener('wheel',event=>{
  event.preventDefault();
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?tree.clientHeight:1);
  zoomAt(Math.exp(Math.max(-0.4,Math.min(0.4,delta*0.0015))),worldPoint(event.clientX,event.clientY));
},{passive:false});
tree.addEventListener('pointerdown',event=>{
  if(event.button!==0||gesture)return;
  suppressClick=false;
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,camera:{...camera},inverse:tree.getScreenCTM().inverse(),dragging:false};
});
window.addEventListener('pointermove',event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  if(!gesture.dragging&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<5)return;
  gesture.dragging=true;
  suppressClick=true;
  if(!tree.hasPointerCapture(event.pointerId))tree.setPointerCapture(event.pointerId);
  tree.classList.add('dragging');
  const start=new DOMPoint(gesture.x,gesture.y).matrixTransform(gesture.inverse);
  const current=new DOMPoint(event.clientX,event.clientY).matrixTransform(gesture.inverse);
  camera={...gesture.camera,x:gesture.camera.x+start.x-current.x,y:gesture.camera.y+start.y-current.y};
  renderCamera();
});
function endGesture(event){
  if(!gesture||event.pointerId!==gesture.id)return;
  gesture=null;
  tree.classList.remove('dragging');
  if(tree.hasPointerCapture(event.pointerId))tree.releasePointerCapture(event.pointerId);
}
window.addEventListener('pointerup',endGesture);
window.addEventListener('pointercancel',endGesture);
tree.addEventListener('lostpointercapture',endGesture);
tree.addEventListener('click',event=>{
  if(suppressClick&&event.detail!==0){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}
},true);
$('zoom-in').addEventListener('click',()=>zoomAt(1/1.2,{x:camera.x+camera.width/2,y:camera.y+camera.height/2}));
$('zoom-out').addEventListener('click',()=>zoomAt(1.2,{x:camera.x+camera.width/2,y:camera.y+camera.height/2}));
$('recenter').addEventListener('click',()=>{camera={...initialView};renderCamera();});
renderCamera();
