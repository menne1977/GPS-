// Layout-Editor, Instrumenten-Baukasten, Profile (Auto/Motorrad), Zähler. Nutzt die Daten der Hauptdatei.
(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc2=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const orient=()=>innerWidth>innerHeight?'land':'port';
const app=$('#app');

// ---------- Zustand ----------
S.prof=S.prof||'car';S.lay=S.lay||{};S.cd=S.cd||null;S.altst=S.altst||{max:null,min:null};S.grid=S.grid!==false;S.instSeq=S.instSeq||0;
const st={editing:false,ied:false,box:null};

// ---------- Datenquellen ----------
const nn=()=>(alt!=null&&lat!=null)?alt-geoid(lat,lon):null;
const ob=k=>(typeof OBD!=='undefined'&&OBD.vals&&OBD.vals[k]!=null)?OBD.vals[k]:null;
const nowStr=()=>new Date().toTimeString().slice(0,5);
const SRC={
 speed:{l:'Geschwindigkeit',u:'km/h',g:()=>speedKmh,max:220},
 limit:{l:'Erlaubt (Limit)',u:'km/h',g:()=>limit,max:130},
 accel:{l:'Beschleunigung',u:'m/s²',g:()=>accel,dec:1,max:6,min:-6},
 brake:{l:'Bremsen',u:'m/s²',g:()=>(accel!=null&&accel<0)?-accel:0,dec:1,max:8},
 zero100:{l:'0–100 Zeit',u:'s',g:()=>zeroRes,dec:1,max:15},
 dayMax:{l:'Heute Höchstwert',u:'km/h',g:()=>S.day.max,max:250,reset:()=>{S.day.max=0}},
 dayKm:{l:'Tageszähler',u:'km',g:()=>S.day.dist,dec:1,max:500,reset:()=>{S.day.dist=0}},
 dayAvg:{l:'Ø Tempo heute',u:'km/h',g:()=>S.day.mt>0?S.day.dist/(S.day.mt/3600000):0,max:150},
 tripKm:{l:'Trip',u:'km',g:()=>S.trip.trip,dec:1,max:500,reset:()=>{S.trip.trip=0}},
 totalKm:{l:'Gesamtzähler',u:'km',g:()=>S.trip.total,dec:0,max:100000},
 tourKm:{l:'Tourenzähler',u:'km',g:()=>S.tour.dist,dec:1,max:1000,reset:()=>{S.tour.dist=0;S.tour.mt=0;S.tour.max=0;if(S.tour.on)S.tour.start=Date.now()}},
 tourMin:{l:'Tour-Zeit',u:'min',g:()=>S.tour.on?(Date.now()-S.tour.start)/60000:null,max:600},
 countdown:{l:'Rückwärtszähler (Rest)',u:'km',g:()=>S.cd&&S.cd.target?Math.max(0,S.cd.target-(S.trip.total-S.cd.ref)):null,dec:1,max:500,reset:()=>{if(S.cd)S.cd.ref=S.trip.total}},
 alt:{l:'Höhe NN',u:'m',g:nn,max:2000},
 altMax:{l:'Höchste Höhe',u:'m',g:()=>S.altst.max,max:2000,reset:()=>{const a=nn();S.altst={max:a,min:a}}},
 altMin:{l:'Tiefste Höhe',u:'m',g:()=>S.altst.min,max:2000,reset:()=>{const a=nn();S.altst={max:a,min:a}}},
 altGps:{l:'Höhe GPS (Ellipsoid)',u:'m',g:()=>alt,max:2000},
 heading:{l:'Kurs',u:'°',g:()=>(typeof cmpCur==='number')?cmpCur:null,max:360},
 temp:{l:'Temperatur',u:'°C',g:()=>wx?wx.cur.temperature_2m:null,min:-10,max:40},
 gust:{l:'Böen',u:'km/h',g:()=>wx?wx.cur.wind_gusts_10m:null,max:120},
 rain:{l:'Regenwahrscheinlichkeit',u:'%',g:()=>wx?wx.pp[0]:null,max:100},
 sats:{l:'Satelliten im Fix',u:'',g:()=>sats?sats.sats.filter(x=>x.used).length:null,max:30},
 gpsAcc:{l:'GPS-Genauigkeit',u:'m',g:()=>gpsAcc,max:50},
 range:{l:'Tankreichweite',u:'km',g:()=>{const r=rangeInfo();return r?r.km:null},max:600},
 fuelNext:{l:'Nächste Tankstelle',u:'km',g:()=>{const L=fuelSorted();return L.length?L[0].d:null},dec:1,max:30},
 rpm:{l:'OBD Drehzahl',u:'U/min',g:()=>ob('rpm'),max:8000},
 cool:{l:'OBD Kühlmittel',u:'°C',g:()=>ob('cool'),min:40,max:130},
 oil:{l:'OBD Öltemperatur',u:'°C',g:()=>ob('oil'),min:40,max:150},
 iat:{l:'OBD Ansaugluft',u:'°C',g:()=>ob('iat'),min:-10,max:80},
 thr:{l:'OBD Gaspedal',u:'%',g:()=>ob('thr'),max:100},
 load:{l:'OBD Motorlast',u:'%',g:()=>ob('load'),max:100},
 fuelLvl:{l:'OBD Tankfüllung',u:'%',g:()=>ob('fuel'),max:100},
 volt:{l:'OBD Bordspannung',u:'V',g:()=>ob('volt'),dec:1,min:10,max:15},
 rate:{l:'OBD Verbrauch',u:'l/h',g:()=>ob('rate'),dec:1,max:30},
 time:{l:'Uhrzeit',str:true,g:()=>null,s:nowStr},
 dir:{l:'Himmelsrichtung',str:true,g:()=>null,s:()=>{const h=(typeof cmpCur==='number')?cmpCur:null;return h==null?'–':['N','NO','O','SO','S','SW','W','NW'][Math.round(h/45)%8]}},
 road:{l:'Straßenart',str:true,g:()=>null,s:()=>roadType||'–'}
};
(()=>{const have=new Set(['rpm','cool','oil','iat','thr','load','volt','rate']);
 PIDS.forEach(p=>{if(have.has(p[1])||p[1]==='fuel')return;const mn=p[1]==='stft1'||p[1]==='ltft1'||p[1]==='stft2'||p[1]==='ltft2'||p[1]==='egre'?-25:0;SRC['o_'+p[1]]={l:'OBD '+p[3],u:p[4],g:()=>ob(p[1]),dec:p[5],max:p[6],min:mn}});
 OBDX.forEach(x=>{SRC['o_'+x[0]]={l:'OBD '+x[1],u:x[2],g:()=>ob(x[0]),dec:x[3],max:x[4]}});
})();
const SRCKEYS=Object.keys(SRC);
const srcOpts=()=>SRCKEYS.map(k=>[k,SRC[k].l]);
function fmt(v,e,k){
 const d=e.dec!=null&&e.dec!==''?+e.dec:(SRC[k]&&SRC[k].dec||0);
 if(v==null||isNaN(v))return e.pad?'-'.repeat(Math.max(1,+e.digits||1))+(d?','+'-'.repeat(d):''):'–';
 const s=Math.abs(v).toFixed(d),p=s.split('.');let i=p[0];
 if(e.pad)i=i.padStart(+e.digits||1,'0');
 return (v<0?'-':'')+i+(p[1]?','+p[1]:'');
}
function curSrc(e){const l=[e.src].concat(e.cyc||[]).filter(Boolean);return l[(e._ci||0)%Math.max(1,l.length)]||e.src}

// ---------- Vorlagen ----------
const TXT=(x,y,w,h,text,size,color,align)=>({t:'text',x,y,w,h,text,size,color:color||'#7d8a99',align:align||'left'});
const CARD=(x,y,w,h)=>({t:'rect',x,y,w,h,fill:'#121b26',stroke:'#1d2733',sw:1,r:8});
const VAL=(x,y,w,h,src,o)=>Object.assign({t:'value',x,y,w,h,src,digits:1,dec:'',pad:false,unit:'',size:20,color:'#ffffff',align:'left',mono:false,showl:false,dt:'',cyc:[]},o||{});
const PRESETS=[
 {n:'Fein-Tacho (3 Ziffern + 2 Nachkommastellen)',ar:1.7778,els:[
  {t:'rect',x:0,y:0,w:100,h:100,fill:'#0b1118',stroke:'#1d2733',sw:0,r:6},
  {t:'arc',x:2,y:6,w:44,h:88,src:'speed',min:0,max:220,a0:-135,sweep:270,th:9,color:'#3aa0ff',bg:'#17324d',warn:130,color2:'#ff5a4a',ticks:true},
  VAL(48,6,50,50,'speed',{digits:3,dec:0,pad:true,size:40,mono:true,align:'right',dt:'zoom'}),
  TXT(48,54,50,8,'km/h',6,'#7d8a99','right'),
  VAL(48,62,50,20,'speed',{digits:3,dec:2,pad:true,size:15,mono:true,align:'right',color:'#ffb13b'}),
  {t:'bar',x:48,y:86,w:50,h:6,src:'speed',min:0,max:220,dir:'h',rev:false,color:'#3dd68c',bg:'#17324d',warn:130,color2:'#ff5a4a'}]},
 {n:'Zähler (Tag, Tour, Gesamt, Rückwärts)',ar:1.7778,els:[
  {t:'rect',x:0,y:0,w:100,h:100,fill:'#0b1118',stroke:'#1d2733',sw:0,r:6},
  CARD(2,4,47,44),TXT(5,7,40,9,'Tageszähler (2× tippen: Null)',6),VAL(5,18,42,26,'dayKm',{dec:1,size:20,unit:'km',dt:'reset',color:'#ff5a4a'}),
  CARD(51,4,47,44),TXT(54,7,40,9,'Tour (2× tippen: Null)',6),VAL(54,18,42,26,'tourKm',{dec:1,size:20,unit:'km',dt:'reset',color:'#3dd68c'}),
  CARD(2,52,47,44),TXT(5,55,40,9,'Gesamt',6),VAL(5,66,42,26,'totalKm',{dec:0,size:20,unit:'km',color:'#3aa0ff'}),
  CARD(51,52,47,44),TXT(54,55,40,9,'Rückwärts bis Ziel',6),VAL(54,66,42,26,'countdown',{dec:1,size:20,unit:'km',dt:'reset',color:'#ffb13b'})]},
 {n:'Wetter und Höhe (mit Höchst- und Tiefstwert)',ar:1.7778,els:[
  {t:'rect',x:0,y:0,w:100,h:100,fill:'#0b1118',stroke:'#1d2733',sw:0,r:6},
  CARD(2,4,47,44),TXT(5,7,40,9,'Temperatur',6),VAL(5,18,42,26,'temp',{dec:0,size:22,unit:'°C',color:'#3dd68c'}),
  CARD(51,4,47,44),TXT(54,7,40,9,'Höhe NN',6),VAL(54,18,42,26,'alt',{dec:0,size:22,unit:'m',color:'#3aa0ff'}),
  CARD(2,52,47,44),TXT(5,55,40,9,'Höchste (2× tippen: neu)',6),VAL(5,66,42,26,'altMax',{dec:0,size:20,unit:'m',dt:'reset',color:'#ff5a4a'}),
  CARD(51,52,47,44),TXT(54,55,40,9,'Tiefste (2× tippen: neu)',6),VAL(54,66,42,26,'altMin',{dec:0,size:20,unit:'m',dt:'reset',color:'#7fe0ff'})]},
 {n:'Hochformat-Tacho',ar:0.5625,els:[
  {t:'rect',x:0,y:0,w:100,h:100,fill:'#0b1118',stroke:'#1d2733',sw:0,r:6},
  VAL(4,3,92,22,'speed',{digits:3,dec:0,pad:true,size:22,mono:true,align:'center'}),
  TXT(4,24,92,5,'km/h',3.5,'#7d8a99','center'),
  {t:'arc',x:6,y:31,w:88,h:34,src:'speed',min:0,max:220,a0:-135,sweep:270,th:9,color:'#3aa0ff',bg:'#17324d',warn:130,color2:'#ff5a4a',ticks:true},
  VAL(4,66,92,9,'speed',{digits:3,dec:2,pad:true,size:5.5,mono:true,align:'center',color:'#ffb13b'}),
  VAL(4,78,44,9,'temp',{dec:0,size:6,unit:'°C',color:'#3dd68c'}),VAL(52,78,44,9,'alt',{dec:0,size:6,unit:'m',color:'#3aa0ff',align:'right'}),
  {t:'bar',x:4,y:90,w:92,h:4,src:'speed',min:0,max:220,dir:'h',rev:false,color:'#3dd68c',bg:'#17324d',warn:130,color2:'#ff5a4a'}]}
];
const clone=o=>JSON.parse(JSON.stringify(o));
function addInst(p,name){const id='i'+(++S.instSeq);const i={id,name:name||p.n,ar:p.ar,els:clone(p.els)};S.inst.push(i);save();return i}
const OLDN=['Fein-Tacho (3 Ziffern + 2 Nachkommastellen)','Zähler (Tag, Tour, Gesamt, Rückwärts)','Wetter und Höhe (mit Höchst- und Tiefstwert)','Hochformat-Tacho'];
if(!Array.isArray(S.inst))S.inst=[];
if(S.simpleV!==2){S.simpleV=2;S.lay={};S.biV=[];S.inst=S.inst.filter(i=>!i.bk&&!OLDN.includes(i.name));
 S.widgets&&WIDGETS.forEach(w=>{if(S.widgets[w.id])S.widgets[w.id].scale=1})}
PRESETS.splice(0,4);
const instById=id=>S.inst.find(i=>i.id===id);

// ---------- Layout ----------
const CAR_ON=['speed','limit','accel','trip','day','compass','weather','warn','heat','sat','fuel','traffic','custom','range','obd','tour'];
const MOTO_ON=['speed','all','compass','weather','warn','tour','range'];
function sizeFor(k,id,o){
 const ref=o==='land'?820:390;
 if(k==='i'){const i=instById(id),ww=o==='land'?50:100;return{w:ww,h:Math.round(ww/(i?i.ar:1.78))}}
 const wd=WIDGETS.find(x=>x.id===id);let w=Math.min(100,Math.round(wd.base/ref*100));
 if(id==='speed'||id==='all')w=100;
 let h=Math.max(Math.round(w*0.6),Math.round(150/ref*100));
 if(id==='speed')h=o==='land'?38:Math.round(w*0.75);
 if(id==='all')h=o==='land'?48:130;
 return{w,h};
}
function newItem(k,id,o,on){const s=sizeFor(k,id,o);return{k,id,x:0,y:0,w:s.w,h:s.h,rot:0,z:1,on}}
function repack(L,o){
 let x=0,y=0,rowH=0;const vis=L.items.filter(i=>i.on),hid=L.items.filter(i=>!i.on);
 vis.forEach(it=>{if(x+it.w>100.5&&x>0){x=0;y+=rowH+1;rowH=0}it.x=x;it.y=y;it.rot=0;x+=it.w+1;rowH=Math.max(rowH,it.h)});
 y+=rowH+1;hid.forEach(it=>{it.x=0;it.y=y});
}
function sync(L,p,o,fresh){
 const have=new Set(L.items.map(i=>i.k+':'+i.id));
 WIDGETS.forEach(w=>{if(!have.has('w:'+w.id)){const on=(fresh&&['warn'].includes(w.id));const it=newItem('w',w.id,o,on);L.items.push(it)}});
 S.inst.forEach(i=>{if(!have.has('i:'+i.id))L.items.push(newItem('i',i.id,o,false))});
 const ok=new Set(WIDGETS.map(w=>'w:'+w.id).concat(S.inst.map(i=>'i:'+i.id)));
 L.items=L.items.filter(i=>ok.has(i.k+':'+i.id));
 if(fresh)repack(L,o);
 else L.items.forEach(it=>{if(!have.has(it.k+':'+it.id)){const mb=Math.max(0,...L.items.filter(x=>x!==it).map(x=>x.y+x.h));it.x=0;it.y=mb+1}});
}
function layFor(p,o){
 S.lay[p]=S.lay[p]||{};let fresh=false;
 if(!S.lay[p][o]){S.lay[p][o]={items:[]};fresh=true}
 sync(S.lay[p][o],p,o,fresh);return S.lay[p][o];
}
const getLay=()=>layFor(S.prof,orient());
const keyOf=it=>it.k+':'+it.id;
function itemEl(it){
 if(it.k==='w')return $('#w-'+it.id);
 let el=$('#i-'+it.id);
 if(!el){el=document.createElement('div');el.className='w inst';el.id='i-'+it.id;el.innerHTML='<div class="ib"></div>';app.appendChild(el)}
 return el;
}
function itemByEl(el){return getLay().items.find(it=>itemEl(it)===el)}
function nameOf(it){if(it.k==='w')return WIDGETS.find(w=>w.id===it.id).name;const i=instById(it.id);return i?i.name:it.id}

function ensureOv(el){
 if(el.querySelector(':scope>.ov'))return;
 const ov=document.createElement('div');ov.className='ov';
 ov.innerHTML='<div class="hl"></div><div class="hx" data-a="x">✕</div><div class="he" data-a="e" style="display:none">✎</div><div class="hrot" data-a="r">⟳</div><div class="hr" data-a="s"></div>';
 el.appendChild(ov);
}
function applyItem(it){
 const el=itemEl(it),u=app.clientWidth/100;if(!el)return;
 ensureOv(el);
 el.style.display=it.on?'':'none';
 el.style.left=(it.x*u)+'px';el.style.top=(48+it.y*u)+'px';el.style.width=(it.w*u)+'px';el.style.height=(it.h*u)+'px';
 el.style.transform=it.rot?`rotate(${it.rot}deg)`:'';el.style.zIndex=it.z||1;
 if(it.k==='w'){const wd=WIDGETS.find(w=>w.id===it.id),c=S.widgets[it.id];el.style.color=c.color;
  el.style.setProperty('--s',clamp(Math.sqrt((it.w*u*it.h*u)/(wd.base*140)),0.45,3.5).toFixed(2))}
 const ov=el.querySelector(':scope>.ov');ov.querySelector('.hl').textContent=nameOf(it);
 ov.querySelector('.he').style.display=it.k==='i'?'block':'none';
}
function applyCfgNew(){
 const L=getLay();L.items.forEach(applyItem);
 let pad=$('#pad');if(!pad){pad=document.createElement('div');pad.id='pad';app.appendChild(pad)}
 const u=app.clientWidth/100,mb=Math.max(0,...L.items.filter(i=>i.on).map(i=>i.y+i.h));
 pad.style.top=(48+mb*u+(st.editing?260:24))+'px';
 document.body.classList.toggle('edit',!!st.editing);$('#edbar').style.display=st.editing?'flex':'none';
 const pb=$('#prof');if(pb)pb.textContent=S.prof==='moto'?'🏍':'🚗';
}
window.applyCfg=applyCfgNew;

// ---------- Instrument zeichnen ----------
const D2R=Math.PI/180;
function arcPath(r,a0,sw){
 if(sw<0.5)return '';const p=a=>[50+r*Math.sin(a*D2R),50-r*Math.cos(a*D2R)];
 const A=p(a0),B=p(a0+sw);return `M${A[0].toFixed(2)} ${A[1].toFixed(2)}A${r} ${r} 0 ${sw>180?1:0} 1 ${B[0].toFixed(2)} ${B[1].toFixed(2)}`;
}
function buildInst(box,inst){
 box.innerHTML='';box._ups=[];
 inst.els.forEach((e,idx)=>{
  const n=document.createElement('div');n.className='ie';n.dataset.i=idx;
  n.style.cssText=`position:absolute;left:${e.x}%;top:${e.y}%;width:${e.w}%;${e.t==='sq'?'aspect-ratio:1/1;':'height:'+e.h+'%;'}z-index:${idx};${e.rot?'transform:rotate('+e.rot+'deg);':''}`;
  if(e.t==='rect'||e.t==='sq'||e.t==='circle'){
   n.style.background=e.fill||'transparent';n.style.border=(e.sw?`${e.sw}px solid ${e.stroke||'#fff'}`:'0');
   n.style.borderRadius=e.t==='circle'?'50%':((e.r||0)+'%');
  }else if(e.t==='text'){
   n.textContent=e.text||'';n.style.cssText+=`font-size:${e.size||8}cqh;color:${e.color||'#fff'};text-align:${e.align||'left'};font-weight:${e.bold?700:400};line-height:1.1;overflow:hidden;`;
  }else if(e.t==='value'){
   n.style.cssText+=`display:flex;flex-direction:column;justify-content:center;align-items:${e.align==='right'?'flex-end':e.align==='center'?'center':'flex-start'};font-size:${e.size||20}cqh;color:${e.color||'#fff'};font-weight:700;line-height:1;white-space:nowrap;overflow:hidden;${e.mono?'font-family:ui-monospace,Menlo,monospace;':''}`;
   const v=document.createElement('div'),l=document.createElement('div');l.style.cssText='font-size:.28em;font-weight:400;color:#7d8a99;margin-top:.1em';n.appendChild(v);if(e.showl)n.appendChild(l);
   box._ups.push(()=>{
    const k=curSrc(e),s=SRC[k]||SRC.speed;let txt;
    if(s.str)txt=s.s();else{const val=s.g();txt=fmt(val,e,k);if(e.warn!=null&&e.warn!==''&&val!=null&&val>+e.warn)n.style.color=e.wcolor||'#ff5a4a';else n.style.color=e.color||'#fff'}
    v.innerHTML=esc2(txt)+(e.unit?`<span style="font-size:.4em;font-weight:400;margin-left:.2em;color:#9fb0c3">${esc2(e.unit)}</span>`:'');
    if(e.showl)l.textContent=s.l;
   });
  }else if(e.t==='bar'){
   n.style.background=e.bg||'#17324d';n.style.borderRadius='3px';n.style.overflow='hidden';
   const f=document.createElement('i');f.style.cssText='position:absolute;display:block;';
   if(e.dir==='v'){f.style.left='0';f.style.right='0';f.style[e.rev?'top':'bottom']='0'}else{f.style.top='0';f.style.bottom='0';f.style[e.rev?'right':'left']='0'}
   n.appendChild(f);e._s=e._s||0;
   box._ups.push(()=>{
    const s=SRC[e.src]||SRC.speed,val=s.g(),lo=e.min!=null&&e.min!==''?+e.min:(s.min||0),hi=e.max!=null&&e.max!==''?+e.max:(s.max||100);
    const fr=val==null?0:clamp((val-lo)/(hi-lo||1),0,1);e._s+=(fr-e._s)*0.4;
    f.style[e.dir==='v'?'height':'width']=(e._s*100).toFixed(1)+'%';
    f.style.background=(e.warn!=null&&e.warn!==''&&val!=null&&val>+e.warn)?(e.color2||'#ff5a4a'):(e.color||'#3dd68c');
   });
  }else if(e.t==='arc'){
   const th=e.th||9,r=50-th/2,a0=e.a0!=null?+e.a0:-135,sw=e.sweep!=null?+e.sweep:270;
   let tk='';if(e.ticks)for(let i=0;i<=10;i++){const a=(a0+sw*i/10)*D2R,r1=50-th-1.5,r2=50-th-(i%5?3.5:6);tk+=`<line x1="${50+r1*Math.sin(a)}" y1="${50-r1*Math.cos(a)}" x2="${50+r2*Math.sin(a)}" y2="${50-r2*Math.cos(a)}" stroke="#7d8a99" stroke-width="${i%5?0.6:1}"/>`}
   n.innerHTML=`<svg viewBox="0 0 100 100" style="width:100%;height:100%;display:block"><path d="${arcPath(r,a0,sw)}" fill="none" stroke="${e.bg||'#17324d'}" stroke-width="${th}" stroke-linecap="round"/><path class="av" d="" fill="none" stroke="${e.color||'#3aa0ff'}" stroke-width="${th}" stroke-linecap="round"/>${tk}</svg>`;
   const av=n.querySelector('.av');e._s=e._s||0;
   box._ups.push(()=>{
    const s=SRC[e.src]||SRC.speed,val=s.g(),lo=e.min!=null&&e.min!==''?+e.min:(s.min||0),hi=e.max!=null&&e.max!==''?+e.max:(s.max||100);
    const fr=val==null?0:clamp((val-lo)/(hi-lo||1),0,1);e._s+=(fr-e._s)*0.4;
    av.setAttribute('d',arcPath(r,a0,sw*e._s));
    av.setAttribute('stroke',(e.warn!=null&&e.warn!==''&&val!=null&&val>+e.warn)?(e.color2||'#ff5a4a'):(e.color||'#3aa0ff'));
   });
  }else if(e.t==='list'){
   n.style.cssText+=`overflow-y:auto;touch-action:pan-y;font-size:${e.size||7}cqh;color:${e.color||'#fff'};line-height:1.35;padding:0 2%;`;
   const rows=(e.srcs||[]).map(k=>{const r=document.createElement('div');r.style.cssText='display:flex;justify-content:space-between;gap:.6em;border-bottom:1px solid #1d2733';const a=document.createElement('span'),b=document.createElement('b');a.style.color='#9fb0c3';a.textContent=(SRC[k]||{}).l||k;r.appendChild(a);r.appendChild(b);n.appendChild(r);return[k,b]});
   box._ups.push(()=>rows.forEach(([k,b])=>{const s=SRC[k];if(!s)return;b.textContent=s.str?s.s():(fmt(s.g(),{},k)+(s.u?' '+s.u:''))}));
  }
  box.appendChild(n);
 });
 box._ups.forEach(f=>f());
}
function tickInst(){
 const L=getLay();
 L.items.forEach(it=>{
  if(it.k!=='i'||!it.on)return;
  const inst=instById(it.id),el=itemEl(it),box=el&&el.querySelector('.ib');if(!inst||!box)return;
  const sig=JSON.stringify(inst.els.map(e=>Object.assign({},e,{_s:0,_ci:0})));
  if(box._sig!==sig){buildInst(box,inst);box._sig=sig}else box._ups.forEach(f=>f());
 });
}
function tickAll(){
 const a=nn();if(a!=null&&(altAcc==null||altAcc<20)&&(gpsAcc==null||gpsAcc<30)){const st=S.altst;let ch=false;if(st.max==null||a>st.max){st.max=a;ch=true}if(st.min==null||a<st.min){st.min=a;ch=true}if(ch)tickAll._dirty=true}
 tickInst();if(st.box)edTick();
}
setInterval(tickAll,100);
setInterval(()=>{if(tickAll._dirty){tickAll._dirty=false;save()}},5000);
setInterval(()=>{if(!st.editing&&!st.ied)renderAll()},500);

// ---------- Layout bearbeiten (verschieben, Größe, Drehung) ----------
let drag=null;
app.addEventListener('pointerdown',e=>{
 if(!st.editing)return;const ov=e.target.closest('.ov');if(!ov)return;
 const el=ov.parentElement,it=itemByEl(el);if(!it)return;e.preventDefault();
 const a=e.target.dataset&&e.target.dataset.a;
 if(a==='x'){it.on=false;save();applyCfgNew();return}
 if(a==='e'){openIED(it.id);return}
 const L=getLay();it.z=Math.max(1,...L.items.map(x=>x.z||1))+1;el.style.zIndex=it.z;
 const u=app.clientWidth/100,r=el.getBoundingClientRect();
 drag={it,el,a,u,sx:e.clientX,sy:e.clientY,x0:it.x,y0:it.y,w0:it.w,h0:it.h,r0:it.rot||0,cx:r.left+r.width/2,cy:r.top+r.height/2,ang0:Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2))};
 try{ov.setPointerCapture(e.pointerId)}catch(_){}
},{passive:false});
app.addEventListener('pointermove',e=>{
 if(!drag)return;const d=drag,snap=S.grid?1:0.1,q=v=>Math.round(v/snap)*snap;
 const dx=(e.clientX-d.sx),dy=(e.clientY-d.sy);
 if(d.a==='s'){const c=Math.cos(d.r0*D2R),s=Math.sin(d.r0*D2R),lx=dx*c+dy*s,ly=-dx*s+dy*c;d.it.w=Math.max(8,q(d.w0+lx/d.u));d.it.h=Math.max(6,q(d.h0+ly/d.u))}
 else if(d.a==='r'){const ang=Math.atan2(e.clientY-d.cy,e.clientX-d.cx);let r=d.r0+(ang-d.ang0)/D2R;r=Math.round(r/(S.grid?5:1))*(S.grid?5:1);d.it.rot=((r%360)+540)%360-180}
 else{d.it.x=Math.max(-d.it.w+10,Math.min(100-10,q(d.x0+dx/d.u)));d.it.y=Math.max(0,q(d.y0+dy/d.u))}
 applyItem(d.it);
},{passive:true});
const endDrag=()=>{if(drag){drag=null;save();applyCfgNew()}};
app.addEventListener('pointerup',endDrag);app.addEventListener('pointercancel',endDrag);

// ---------- Doppeltippen: vergrößern oder Unterfunktion ----------
let lastTap={t:0,x:0,y:0,el:null};
app.addEventListener('pointerup',e=>{
 if(st.editing)return;const w=e.target.closest('.w');if(!w)return;
 if(e.target.closest('button,input,select,textarea,a,summary,label'))return;
 const now=Date.now();
 if(lastTap.el===w&&now-lastTap.t<320&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<30){lastTap.t=0;onDouble(w,e)}
 else lastTap={t:now,x:e.clientX,y:e.clientY,el:w};
});
function onDouble(w,e){
 const it=itemByEl(w),ie=e.target.closest('.ie');
 if(it&&it.k==='i'&&ie){
  const inst=instById(it.id),el=inst&&inst.els[+ie.dataset.i];
  if(el&&el.dt==='reset'){const k=curSrc(el);if(SRC[k]&&SRC[k].reset){SRC[k].reset();save();toast(SRC[k].l+' zurückgesetzt',2500)}else toast('Dieser Wert lässt sich nicht zurücksetzen',2500);return}
  if(el&&el.dt==='cycle'){el._ci=(el._ci||0)+1;save();return}
 }
 w.classList.toggle('zoom');
}

// ---------- Instrumenten-Editor ----------
const EP={
 common:[['x','Links %','n',0,100,1],['y','Oben %','n',0,100,1],['w','Breite %','n',1,100,1],['h','Höhe %','n',1,100,1],['rot','Drehung °','n',-180,180,5]],
 rect:[['fill','Füllfarbe','c'],['stroke','Randfarbe','c'],['sw','Randdicke px','n',0,20,1],['r','Rundung %','n',0,50,1]],
 sq:[['fill','Füllfarbe','c'],['stroke','Randfarbe','c'],['sw','Randdicke px','n',0,20,1],['r','Rundung %','n',0,50,1]],
 circle:[['fill','Füllfarbe','c'],['stroke','Randfarbe','c'],['sw','Randdicke px','n',0,20,1]],
 text:[['text','Text','t'],['size','Größe','n',2,60,0.5],['color','Farbe','c'],['align','Ausrichtung','s',[['left','links'],['center','Mitte'],['right','rechts']]],['bold','Fett','b']],
 value:[['src','Wert','src'],['digits','Ziffern vor dem Komma','n',1,6,1],['dec','Nachkommastellen','n0',0,3,1],['pad','Mit Nullen auffüllen','b'],['unit','Einheit','t'],['size','Größe','n',2,80,0.5],['color','Farbe','c'],['warn','Warnen ab','nn'],['wcolor','Warnfarbe','c'],['align','Ausrichtung','s',[['left','links'],['center','Mitte'],['right','rechts']]],['mono','Digital-Schrift','b'],['showl','Name anzeigen','b'],['dt','Doppeltippen','s',[['','Vergrößern'],['reset','Auf Null setzen'],['cycle','Wert umschalten']]],['cyc','Umschalten auf','srcs']],
 bar:[['src','Wert','src'],['min','Von','nn'],['max','Bis','nn'],['dir','Richtung','s',[['h','waagerecht'],['v','senkrecht']]],['rev','Umkehren','b'],['color','Farbe','c'],['bg','Hintergrund','c'],['warn','Warnen ab','nn'],['color2','Warnfarbe','c']],
 arc:[['src','Wert','src'],['min','Von','nn'],['max','Bis','nn'],['a0','Startwinkel °','n',-360,360,5],['sweep','Bogen °','n',10,360,5],['th','Dicke','n',2,30,1],['color','Farbe','c'],['bg','Hintergrund','c'],['warn','Warnen ab','nn'],['color2','Warnfarbe','c'],['ticks','Skalenstriche','b']],
 list:[['srcs','Werte (scrollbar)','srcs'],['size','Größe','n',2,30,0.5],['color','Farbe','c']]
};
const TYPENAME={rect:'Rechteck',sq:'Quadrat',circle:'Kreis',text:'Text',value:'Wert',bar:'Balken',arc:'Bogen',list:'Liste'};
const NEWEL={
 rect:()=>({t:'rect',x:10,y:10,w:30,h:20,fill:'#1d2733',stroke:'#3aa0ff',sw:0,r:6}),
 sq:()=>({t:'sq',x:10,y:10,w:20,fill:'#1d2733',stroke:'#3aa0ff',sw:0,r:6}),
 circle:()=>({t:'circle',x:10,y:10,w:25,h:25,fill:'#1d2733',stroke:'#3aa0ff',sw:2}),
 text:()=>TXT(10,10,30,10,'Text',8,'#ffffff','left'),
 value:()=>VAL(10,10,40,25,'speed',{digits:3,dec:0,pad:true,size:22,mono:true}),
 bar:()=>({t:'bar',x:10,y:10,w:50,h:8,src:'speed',min:0,max:220,dir:'h',rev:false,color:'#3dd68c',bg:'#17324d',warn:130,color2:'#ff5a4a'}),
 arc:()=>({t:'arc',x:10,y:10,w:35,h:60,src:'speed',min:0,max:220,a0:-135,sweep:270,th:9,color:'#3aa0ff',bg:'#17324d',warn:130,color2:'#ff5a4a',ticks:true}),
 list:()=>({t:'list',x:10,y:10,w:45,h:50,srcs:['dayKm','tourKm','totalKm','countdown'],size:8,color:'#ffffff'})
};
let ed=null; // {inst,sel}
function openIED(id){
 const inst=instById(id);if(!inst)return;st.ied=true;ed={inst,sel:-1};
 let m=$('#ied');if(m)m.remove();
 m=document.createElement('div');m.id='ied';
 m.innerHTML=`<div class="ibar"><input id="ied-name" value="${esc2(inst.name)}" style="flex:1;min-width:0"><select id="ied-ar">${[[1.7778,'Querformat 16:9'],[1.3333,'Quer 4:3'],[1,'Quadrat'],[0.75,'Hoch 3:4'],[0.5625,'Hochformat 9:16']].map(([v,l])=>`<option value="${v}" ${Math.abs(inst.ar-v)<0.01?'selected':''}>${l}</option>`).join('')}</select><button id="ied-done">Fertig</button></div>
 <div id="ied-stage"><div id="ied-box" class="ib"></div></div>
 <div id="ied-pal">${Object.keys(NEWEL).map(k=>`<button data-add="${k}">+ ${TYPENAME[k]}</button>`).join('')}</div>
 <div id="ied-props"></div>`;
 document.body.appendChild(m);st.box=$('#ied-box');
 $('#ied-done').onclick=closeIED;
 $('#ied-name').oninput=e=>{inst.name=e.target.value;save()};
 $('#ied-ar').onchange=e=>{inst.ar=+e.target.value;save();edSize();edRebuild()};
 $('#ied-pal').onclick=e=>{const k=e.target.dataset.add;if(!k)return;inst.els.push(NEWEL[k]());ed.sel=inst.els.length-1;save();edRebuild();edProps()};
 edSize();edRebuild();edProps();
 $('#menu').classList.remove('open');
}
function closeIED(){const m=$('#ied');if(m)m.remove();st.ied=false;st.box=null;ed=null;save();getLay().items.forEach(it=>{if(it.k==='i'){const b=itemEl(it).querySelector('.ib');if(b)b._sig=null}});applyCfgNew()}
function edSize(){
 const st=$('#ied-stage'),box=$('#ied-box');if(!st||!ed)return;
 const aw=st.clientWidth-16,ah=st.clientHeight-16,w=Math.min(aw,ah*ed.inst.ar);box.style.width=w+'px';box.style.height=(w/ed.inst.ar)+'px';
}
function edRebuild(){
 const box=st.box;if(!box||!ed)return;buildInst(box,ed.inst);
 box.querySelectorAll('.ie').forEach(n=>{
  const i=+n.dataset.i;n.style.touchAction='none';
  if(i===ed.sel){n.style.outline='2px dashed #ffb13b';const h=document.createElement('div');h.className='rh';h.dataset.a='s';n.appendChild(h)}
  n.addEventListener('pointerdown',ev=>edDown(ev,i,n),{passive:false});
 });
}
function edTick(){if(st.box&&st.box._ups)st.box._ups.forEach(f=>f())}
let ed0=null;
function edDown(ev,i,n){
 ev.preventDefault();ev.stopPropagation();const box=st.box,r=box.getBoundingClientRect(),e=ed.inst.els[i];
 const was=ed.sel;ed.sel=i;
 ed0={i,e,r,sx:ev.clientX,sy:ev.clientY,x0:e.x,y0:e.y,w0:e.w,h0:e.h,a:ev.target.dataset&&ev.target.dataset.a,moved:false};
 if(was!==i){edRebuild();edProps();const nn2=box.querySelector(`.ie[data-i="${i}"]`);if(nn2)try{nn2.setPointerCapture(ev.pointerId)}catch(_){}}
 else try{n.setPointerCapture(ev.pointerId)}catch(_){}
}
document.addEventListener('pointermove',ev=>{
 if(!ed0||!ed)return;const d=ed0,dx=(ev.clientX-d.sx)/d.r.width*100,dy=(ev.clientY-d.sy)/d.r.height*100;
 if(Math.abs(dx)+Math.abs(dy)>0.4)d.moved=true;
 if(d.a==='s'){d.e.w=Math.max(2,Math.round(d.w0+dx));if(d.e.t!=='sq')d.e.h=Math.max(2,Math.round(d.h0+dy))}
 else{d.e.x=Math.round(d.x0+dx);d.e.y=Math.round(d.y0+dy)}
 const n=st.box.querySelector(`.ie[data-i="${d.i}"]`);
 if(n){n.style.left=d.e.x+'%';n.style.top=d.e.y+'%';n.style.width=d.e.w+'%';if(d.e.t!=='sq')n.style.height=d.e.h+'%'}
},{passive:true});
document.addEventListener('pointerup',()=>{if(ed0){const m=ed0.moved;ed0=null;if(ed){save();if(m){edRebuild();edProps()}}}});
function edProps(){
 const P=$('#ied-props');if(!P||!ed)return;const e=ed.inst.els[ed.sel];
 if(!e){P.innerHTML='<div class="small" style="padding:8px">Element antippen zum Bearbeiten, ziehen zum Verschieben, Ecke unten rechts zum Vergrößern. Oben „+“ fügt Elemente hinzu.</div>';return}
 const rows=EP.common.filter(c=>!(e.t==='sq'&&c[0]==='h')).concat(EP[e.t]||[]);
 let h=`<div class="row" style="margin:4px 8px"><b>${TYPENAME[e.t]}</b><span><button data-act="dup">Kopie</button><button data-act="front">Nach vorn</button><button data-act="back">Nach hinten</button><button data-act="del" style="background:#7a1f1f">Löschen</button></span></div>`;
 rows.forEach(c=>{
  const [k,l,kind,a,b,st]=c,v=e[k];let inp='';
  if(kind==='n'||kind==='n0'||kind==='nn')inp=`<input type="number" data-k="${k}" data-kind="${kind}" value="${v==null?'':v}" ${kind==='n'||kind==='n0'?`min="${a}" max="${b}" step="${st}"`:'step="any"'} style="width:90px">`;
  else if(kind==='c')inp=`<input type="color" data-k="${k}" data-kind="c" value="${/^#[0-9a-f]{6}$/i.test(v||'')?v:'#ffffff'}">`;
  else if(kind==='t')inp=`<input type="text" data-k="${k}" data-kind="t" value="${esc2(v||'')}" style="width:150px">`;
  else if(kind==='b')inp=`<input type="checkbox" data-k="${k}" data-kind="b" ${v?'checked':''}>`;
  else if(kind==='s')inp=`<select data-k="${k}" data-kind="s">${a.map(([o,t])=>`<option value="${o}" ${(v||'')===o?'selected':''}>${t}</option>`).join('')}</select>`;
  else if(kind==='src')inp=`<select data-k="${k}" data-kind="s" style="max-width:190px">${srcOpts().map(([o,t])=>`<option value="${o}" ${v===o?'selected':''}>${t}</option>`).join('')}</select>`;
  else if(kind==='srcs')inp=`<div style="max-height:110px;overflow:auto;width:100%;font-size:12px">${srcOpts().map(([o,t])=>`<label style="display:block"><input type="checkbox" data-k="${k}" data-kind="m" value="${o}" ${(v||[]).includes(o)?'checked':''}> ${t}</label>`).join('')}</div>`;
  h+=`<div class="row" style="margin:4px 8px"><label>${l}</label>${inp}</div>`;
 });
 P.innerHTML=h;
}
document.addEventListener('input',ev=>{
 const t=ev.target;if(!ed||!t.closest||!t.closest('#ied-props'))return;
 const e=ed.inst.els[ed.sel];if(!e||!t.dataset.k)return;const k=t.dataset.k,kind=t.dataset.kind;
 if(kind==='n')e[k]=+t.value;else if(kind==='n0')e[k]=t.value===''?'':+t.value;else if(kind==='nn')e[k]=t.value===''?null:+t.value;
 else if(kind==='b')e[k]=t.checked;else if(kind==='m'){const set=new Set(e[k]||[]);t.checked?set.add(t.value):set.delete(t.value);e[k]=[...set]}
 else e[k]=t.value;
 save();edRebuild();
});
document.addEventListener('click',ev=>{
 const a=ev.target.dataset&&ev.target.dataset.act;if(!a||!ed||!ev.target.closest('#ied-props'))return;
 const els=ed.inst.els,i=ed.sel;
 if(a==='del'){els.splice(i,1);ed.sel=-1}
 else if(a==='dup'){els.push(clone(els[i]));ed.sel=els.length-1;els[ed.sel].x+=3;els[ed.sel].y+=3}
 else if(a==='front'){const x=els.splice(i,1)[0];els.push(x);ed.sel=els.length-1}
 else if(a==='back'){const x=els.splice(i,1)[0];els.unshift(x);ed.sel=0}
 save();edRebuild();edProps();
});
addEventListener('resize',()=>{edSize()});

// ---------- Menü ----------
function visHtml(){
 const L=getLay();
 return L.items.slice().sort((a,b)=>(a.k==='i'?0:1)-(b.k==='i'?0:1)).map(it=>{
  const key=keyOf(it),c=it.k==='w'?`<input type="color" data-w="${it.id}" data-k="color" value="${S.widgets[it.id].color}">`:`<button data-ied="${it.id}">Bearbeiten</button>`;
  return `<div class="row"><label><input type="checkbox" data-vis="${key}" ${it.on?'checked':''}> ${it.k==='w'?'Klassisch: ':''}${esc2(nameOf(it))}</label>${c}</div>`;
 }).join('');
}
function menuHtml(){
 const o=orient();
 return `<h3>Profil &amp; Layout</h3>
 <div class="row"><label>Profil</label><select id="dz-prof"><option value="car" ${S.prof==='car'?'selected':''}>1 · Auto</option><option value="moto" ${S.prof==='moto'?'selected':''}>2 · Motorrad</option></select></div>
 <div class="row"><button id="dz-edit">Fenster verschieben und anpassen</button></div>
 <div class="row"><label>Am Raster einrasten</label><input type="checkbox" id="dz-grid" ${S.grid?'checked':''}></div>
 <div class="row"><button id="dz-lreset">Layout dieses Profils zurücksetzen (${o==='land'?'Querformat':'Hochformat'})</button></div>
 <div class="row"><label>App neben KITT</label><select id="dz-splitapp" style="max-width:190px">${(S.splitApps||[]).map(a=>`<option value="${esc2(a.p)}" ${S.splitPkg===a.p?'selected':''}>${esc2(a.l)}</option>`).join('')||'<option value="">(Liste laden)</option>'}</select></div>
 <div class="row"><button id="dz-splitload">App-Liste laden</button><button id="dz-split">Geteilt starten</button></div>
 <h3>Instrumente</h3>
 ${S.inst.map(i=>`<div class="row"><label>${esc2(i.name)}</label><span><button data-ied="${i.id}">Bearbeiten</button><button data-idup="${i.id}">Kopie</button><button data-idel="${i.id}">Löschen</button></span></div>`).join('')||'<div class="small">Noch keine Instrumente.</div>'}
 <div class="row"><button id="dz-new">Neues leeres Instrument</button></div>
 <div class="row"><select id="dz-preset" style="max-width:210px">${PRESETS.map((p,i)=>`<option value="${i}">${esc2(p.n)}</option>`).join('')}</select><button id="dz-addpreset">Vorlage hinzufügen</button></div>
 <h3>Zähler &amp; Höhe</h3>
 <div class="row"><label>Tageszähler ${(S.day.dist).toFixed(1)} km</label><button data-rs="dayKm">Auf 0</button></div>
 <div class="row"><label>Tourenzähler ${S.tour.dist.toFixed(1)} km</label><button data-rs="tourKm">Auf 0</button></div>
 <div class="row"><label>Trip ${S.trip.trip.toFixed(1)} km</label><button data-rs="tripKm">Auf 0</button></div>
 <div class="row"><label>Gesamtzähler ${Math.round(S.trip.total)} km</label></div>
 <div class="row"><label>Rückwärtszähler: Strecke (km)</label><input type="number" id="dz-cd" min="0" step="0.1" value="${S.cd?S.cd.target:''}" style="width:90px"></div>
 <div class="row"><button id="dz-cdset">Rückwärts zählen starten</button><button id="dz-cdoff">Aus</button></div>
 <div class="small">${S.cd&&S.cd.target?'Rest: '+SRC.countdown.g().toFixed(1)+' km':'Nicht aktiv'}</div>
 <div class="row"><label>Höhe höchste ${S.altst.max==null?'–':Math.round(S.altst.max)} m, tiefste ${S.altst.min==null?'–':Math.round(S.altst.min)} m</label><button data-rs="altMax">Zurücksetzen</button></div>`;
}
const OPEN=new Set(['Ansicht & Layout']);
const GROUPS=[['Ansicht & Layout',['Profil & Layout','Anzeigen','Allgemein']],['Tachos & Übersichten',['Instrumente']],['Zähler, Tour & Tank',['Zähler & Höhe','Tank & Reichweite']],['Fahrzeug & Apps',['Fahrzeug & Apps']],['Stimme (KITT)',['Sprachassistent (KITT)']],['Internet & Daten',['Datenquellen (Abruf nur im Intervall)','Stau-Meldung','Daten & Sensoren']]];
const SHOWN={'Anzeigen':'Fenster ein/aus','Allgemein':'Anzeige','Datenquellen (Abruf nur im Intervall)':'Datenquellen','Daten & Sensoren':'Sensoren & Zurücksetzen','Zähler & Höhe':'Zähler & Höhe','Tank & Reichweite':'Tank'};
function collapse(h){
 const parts=h.split('<h3>');let out=parts[0];const sec={};
 for(let i=1;i<parts.length;i++){const j=parts[i].indexOf('</h3>'),title=parts[i].slice(0,j).replace(/&amp;/g,'&');sec[title]=parts[i].slice(j+5)}
 GROUPS.forEach(([g,list])=>{
  const body=list.filter(t=>sec[t]!=null).map(t=>(list.length>1?`<div class="sech">${esc2(SHOWN[t]||t)}</div>`:'')+sec[t]).join('');
  out+=`<details class="sub" data-t="${esc2(g)}" ${OPEN.has(g)?'open':''}><summary>${esc2(g)}</summary>${body}</details>`;
 });
 return out;
}
document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.classList&&d.classList.contains('sub')){d.open?OPEN.add(d.dataset.t):OPEN.delete(d.dataset.t)}},true);
function refreshMenu(){buildPanel()}
$('#panel').addEventListener('input',e=>{
 const t=e.target;
 if(t.dataset.vis){const [k,id]=t.dataset.vis.split(':');['port','land'].forEach(o=>{const L=layFor(S.prof,o),it=L.items.find(x=>x.k===k&&x.id===id);if(it){it.on=t.checked;if(t.checked&&o===orient()){it.z=Math.max(1,...L.items.map(x=>x.z||1))+1}}});save();applyCfgNew()}
 if(t.id==='dz-prof'){S.prof=t.value;save();applyCfgNew();renderAll();refreshMenu()}
 if(t.id==='dz-splitapp'){S.splitPkg=t.value;save()}
 if(t.id==='dz-grid'){S.grid=t.checked;save()}
});
$('#panel').addEventListener('click',e=>{
 const t=e.target,id=t.id,d=t.dataset||{};
 if(d.ied){openIED(d.ied)}
 if(d.idup){const i=instById(d.idup);if(i){addInst({n:i.name+' (Kopie)',ar:i.ar,els:i.els});refreshMenu();applyCfgNew()}}
 if(d.idel){const i=instById(d.idel);if(i&&confirm('Instrument „'+i.name+'“ löschen?')){S.inst=S.inst.filter(x=>x!==i);save();applyCfgNew();refreshMenu()}}
 if(d.rs){const k=d.rs;if(SRC[k]&&SRC[k].reset){SRC[k].reset();save();refreshMenu();toast(SRC[k].l+' zurückgesetzt',2000)}}
 if(id==='dz-edit'){st.editing=true;$('#menu').classList.remove('open');applyCfgNew()}
 if(id==='dz-lreset'&&confirm('Layout dieses Profils zurücksetzen?')){delete S.lay[S.prof][orient()];save();applyCfgNew()}
 if(id==='dz-new'){const i=addInst({n:'Mein Instrument',ar:1.7778,els:[{t:'rect',x:0,y:0,w:100,h:100,fill:'#0b1118',stroke:'#1d2733',sw:0,r:6}]});applyCfgNew();openIED(i.id)}
 if(id==='dz-addpreset'){const p=PRESETS[+$('#dz-preset').value];if(p){addInst(p);applyCfgNew();refreshMenu();toast('Vorlage hinzugefügt. Unter „Anzeigen“ einschalten.',4000)}}
 if(id==='dz-cdset'){const v=+$('#dz-cd').value;if(v>0){S.cd={target:v,ref:S.trip.total};save();refreshMenu();toast('Rückwärtszähler läuft: '+v+' km',3000)}else toast('Bitte eine Strecke in km eintragen',3000)}
 if(id==='dz-cdoff'){S.cd=null;save();refreshMenu()}
 if(id==='dz-split'){splitNav()}
 if(id==='dz-splitload'){if(!AppCtl){toast('Nur in der APK');return}AppCtl.apps().then(r=>{S.splitApps=(r.list||[]).sort((a,b)=>a.l.localeCompare(b.l));if(!S.splitPkg&&S.splitApps.length)S.splitPkg=S.splitApps[0].p;save();refreshMenu();toast(S.splitApps.length+' Apps geladen. Jetzt oben auswählen.',3000)}).catch(()=>toast('Liste nicht verfügbar'))}
});
function splitNav(){
 if(!AppCtl){toast('Nur in der APK');return}
 AppCtl.accessEnabled().then(r=>{
  if(r.enabled){AppCtl.ui({action:'split'}).catch(()=>{});setTimeout(()=>AppCtl.adjacent({pkg:S.splitPkg||undefined}).catch(()=>toast('App nicht gefunden')),1300);$('#menu').classList.remove('open')}
  else{AppCtl.adjacent({pkg:S.splitPkg||undefined}).catch(()=>toast('App nicht gefunden'));toast('Zum Teilen: in Android „Letzte Apps“ öffnen, bei KITT auf das Symbol tippen und „Geteilter Bildschirm“ wählen. Mit eingeschalteter Bedienungshilfe geht es automatisch.',9000)}
 });
}

// ---------- Schaltflächen ----------
$('#prof').onclick=()=>{S.prof=S.prof==='moto'?'car':'moto';save();applyCfgNew();renderAll();toast(S.prof==='moto'?'Profil 2: Motorrad':'Profil 1: Auto',2000)};
$('#edt').onclick=()=>{st.editing=!st.editing;applyCfgNew()};
$('#ed-done').onclick=()=>{st.editing=false;save();applyCfgNew()};
$('#ed-add').onclick=()=>{st.editing=false;applyCfgNew();OPEN.add('Tachos & Übersichten');buildPanel();$('#menu').classList.add('open')};
$('#ed-show').onclick=()=>{st.editing=false;applyCfgNew();OPEN.add('Ansicht & Layout');buildPanel();$('#menu').classList.add('open')};
$('#ed-reset').onclick=()=>{if(confirm('Layout dieses Profils zurücksetzen?')){delete S.lay[S.prof][orient()];save();applyCfgNew()}};
new ResizeObserver(()=>{if(!drag)applyCfgNew()}).observe(app);
addEventListener('orientationchange',()=>setTimeout(applyCfgNew,200));


// ---------- Fertige Tachos Auto / Motorrad ----------
const BG={t:'rect',x:0,y:0,w:100,h:100,fill:'#0b1118',stroke:'#1d2733',sw:0,r:4};
const CELL=(x,y,w,h,lab,src,o)=>{o=o||{};const c=o.color||'#ffffff';return[CARD(x,y,w,h),TXT(x+w*0.06,y+h*0.07,w*0.88,h*0.24,lab,h*0.2,'#8fa3b8','left'),VAL(x+w*0.06,y+h*0.33,w*0.88,h*0.6,src,{dec:o.dec!=null?o.dec:0,size:h*(o.sz||0.46),unit:o.unit||'',color:c,dt:o.dt||'',warn:o.warn,align:'left'})]};
const SPD=(ac)=>({t:'arc',x:2,y:6,w:36,h:88,src:'speed',min:0,max:220,a0:-135,sweep:270,th:8,color:ac,bg:'#17324d',warn:130,color2:'#ff5a4a',ticks:true});
function grid(cells,x0,y0,W,H,cols,rows,gap){const cw=(W-gap*(cols-1))/cols,ch=(H-gap*(rows-1))/rows;let r=[];cells.forEach((c,i)=>{const cx=i%cols,cy=Math.floor(i/cols);r=r.concat(CELL(x0+cx*(cw+gap),y0+cy*(ch+gap),cw,ch,c[0],c[1],c[2]))});return r}
const CARQ=[['Erlaubt','limit',{unit:'km/h',color:'#ff5a4a'}],['Außen','temp',{unit:'°C',color:'#3dd68c'}],['Höhe NN','alt',{unit:'m',color:'#3aa0ff'}],['Kurs','dir',{color:'#ffb13b'}],
 ['Tag','dayKm',{dec:1,unit:'km',color:'#ff5a4a',dt:'reset'}],['Tour','tourKm',{dec:1,unit:'km',color:'#3dd68c',dt:'reset'}],['Gesamt','totalKm',{unit:'km',color:'#3aa0ff'}],['Rückwärts','countdown',{dec:1,unit:'km',color:'#ffb13b',dt:'reset'}],
 ['Beschl.','accel',{dec:1,unit:'m/s²'}],['Reichweite','range',{unit:'km',color:'#3dd68c'}],['Drehzahl','rpm',{unit:'U/min',color:'#ff5a4a'}],['Uhrzeit','time',{color:'#ffffff'}]];
const MOTQ=[['Außen','temp',{unit:'°C',color:'#3dd68c'}],['Kühlmittel','cool',{unit:'°C',color:'#ff5a4a'}],['Öl','oil',{unit:'°C',color:'#ffb13b'}],['Höhe NN','alt',{unit:'m',color:'#3aa0ff'}],
 ['Höchste','altMax',{unit:'m',color:'#ff5a4a',dt:'reset'}],['Tiefste','altMin',{unit:'m',color:'#7fe0ff',dt:'reset'}],['Tag','dayKm',{dec:1,unit:'km',color:'#ff5a4a',dt:'reset'}],['Tour','tourKm',{dec:1,unit:'km',color:'#3dd68c',dt:'reset'}],
 ['Gesamt','totalKm',{unit:'km',color:'#3aa0ff'}],['Rückwärts','countdown',{dec:1,unit:'km',color:'#ffb13b',dt:'reset'}],['Reichweite','range',{unit:'km',color:'#3dd68c'}],['Kurs','dir',{color:'#ffffff'}]];
const CARS=[['Erlaubt','limit',{unit:'km/h',color:'#ff5a4a'}],['Außen','temp',{unit:'°C',color:'#3dd68c'}],['Tag','dayKm',{dec:1,unit:'km',color:'#ff5a4a',dt:'reset'}],['Tour','tourKm',{dec:1,unit:'km',color:'#3dd68c',dt:'reset'}],
 ['Höhe','alt',{unit:'m',color:'#3aa0ff'}],['Rückwärts','countdown',{dec:1,unit:'km',color:'#ffb13b',dt:'reset'}],['Reichweite','range',{unit:'km',color:'#3dd68c'}],['Uhrzeit','time',{}]];
const MOTS=[['Außen','temp',{unit:'°C',color:'#3dd68c'}],['Höhe','alt',{unit:'m',color:'#3aa0ff'}],['Tag','dayKm',{dec:1,unit:'km',color:'#ff5a4a',dt:'reset'}],['Tour','tourKm',{dec:1,unit:'km',color:'#3dd68c',dt:'reset'}],
 ['Höchste','altMax',{unit:'m',color:'#ff5a4a',dt:'reset'}],['Tiefste','altMin',{unit:'m',color:'#7fe0ff',dt:'reset'}],['Rückwärts','countdown',{dec:1,unit:'km',color:'#ffb13b',dt:'reset'}],['Reichweite','range',{unit:'km',color:'#3dd68c'}]];
const speedBlock=(ac,fine)=>[SPD(ac),VAL(7,32,26,30,'speed',{digits:3,dec:0,pad:true,size:26,mono:true,align:'center',dt:'zoom',color:'#ffffff'}),TXT(7,60,26,7,'km/h',6,'#8fa3b8','center'),VAL(7,68,26,12,'speed',{digits:3,dec:2,pad:true,size:10,mono:true,align:'center',color:ac===('#3aa0ff')?'#ffb13b':'#ffd27a'})];

const LST=(srcs)=>[BG,{t:'list',x:2,y:2,w:96,h:96,srcs,size:3.6,color:'#ffffff'}];
const OBDALL=['rpm','cool','oil','iat','thr','load','volt','rate'].concat(SRCKEYS.filter(k=>k.startsWith('o_')));
PRESETS.push(
 {bk:'ov-all',n:'Übersicht: Alle OBD-Werte (scrollbar)',ar:1,els:LST(OBDALL)},
 {bk:'ov-mot',n:'Übersicht: Motor (OBD)',ar:1,els:LST(['rpm','cool','oil','iat','thr','load','volt','o_map','o_maf','o_lam1','rate','o_l100','fuelLvl','o_boost'])},
 {bk:'ov-wx',n:'Übersicht: Wetter, Höhe, Umgebung',ar:1,els:LST(['temp','gust','rain','alt','altMax','altMin','heading','dir','road','sats','gpsAcc','time'])},
 {bk:'ov-fahrt',n:'Übersicht: Fahrt und Zähler',ar:1,show:[['car','port',100],['moto','port',100]],els:LST(['speed','limit','accel','dayKm','dayMax','dayAvg','tourKm','tourMin','tripKm','totalKm','countdown','range','fuelNext'])}
);
PRESETS.push(
 {bk:'car-q',n:'Auto: Quer, alle Daten',ar:1.7778,show:[['car','land',58]],els:[BG].concat(speedBlock('#3aa0ff'),grid(CARQ,40,4,58,92,3,4,2))},
 {bk:'car-g',n:'Auto: Geteilt, gut lesbar',ar:1,show:[['car','port',100]],els:[BG,
  VAL(3,2,60,30,'speed',{digits:3,dec:0,pad:true,size:28,mono:true,align:'left',dt:'zoom'}),TXT(62,20,34,8,'km/h',6,'#8fa3b8','left'),
  VAL(60,6,38,12,'speed',{digits:3,dec:2,pad:true,size:7.5,mono:true,align:'right',color:'#ffb13b'}),
  {t:'bar',x:3,y:33,w:94,h:4,src:'speed',min:0,max:220,dir:'h',rev:false,color:'#3dd68c',bg:'#17324d',warn:130,color2:'#ff5a4a'}].concat(grid(CARS,3,40,94,57,2,4,2))},
 {bk:'mot-q',n:'Motorrad: Quer, alle Daten',ar:1.7778,show:[['moto','land',58]],els:[BG].concat(speedBlock('#ff8a2a'),grid(MOTQ,40,4,58,92,3,4,2))},
 {bk:'mot-g',n:'Motorrad: Geteilt, gut lesbar',ar:1,show:[['moto','port',100]],els:[BG,
  VAL(3,2,60,30,'speed',{digits:3,dec:0,pad:true,size:28,mono:true,align:'left',dt:'zoom',color:'#ffb13b'}),TXT(62,20,34,8,'km/h',6,'#8fa3b8','left'),
  VAL(60,6,38,12,'speed',{digits:3,dec:2,pad:true,size:7.5,mono:true,align:'right',color:'#ffffff'}),
  {t:'bar',x:3,y:33,w:94,h:4,src:'speed',min:0,max:220,dir:'h',rev:false,color:'#ff8a2a',bg:'#3a2412',warn:130,color2:'#ff3a2a'}].concat(grid(MOTS,3,40,94,57,2,4,2))},
 {bk:'car-m',n:'Auto: Mini quer (wenig Daten)',ar:3,els:[BG,VAL(2,6,40,88,'speed',{digits:3,dec:0,pad:true,size:70,mono:true,align:'left',dt:'zoom'}),TXT(40,60,10,20,'km/h',16,'#8fa3b8','left')].concat(grid([['Erlaubt','limit',{unit:'',color:'#ff5a4a'}],['Außen','temp',{unit:'°',color:'#3dd68c'}],['Uhrzeit','time',{}]],52,6,46,88,3,1,2))},
 {bk:'mot-m',n:'Motorrad: Mini quer (wenig Daten)',ar:3,els:[BG,VAL(2,6,40,88,'speed',{digits:3,dec:0,pad:true,size:70,mono:true,align:'left',dt:'zoom',color:'#ffb13b'}),TXT(40,60,10,20,'km/h',16,'#8fa3b8','left')].concat(grid([['Außen','temp',{unit:'°',color:'#3dd68c'}],['Höhe','alt',{unit:'m',color:'#3aa0ff'}],['Tour','tourKm',{dec:1,color:'#3dd68c',dt:'reset'}]],52,6,46,88,3,1,2))}
);
S.biV=S.biV||[];
PRESETS.filter(p=>p.bk&&!S.biV.includes(p.bk)).forEach(p=>{
 const i=addInst(p);i.bk=p.bk;S.biV.push(p.bk);
 (p.show||[]).forEach(([pr,o,w])=>{
  const L=layFor(pr,o),it=L.items.find(x=>x.k==='i'&&x.id===i.id);if(!it)return;
  it.w=w;it.h=Math.round(w/p.ar);it.x=(100-w)/2;it.y=0;it.on=true;
  L.items.forEach(x=>{if(x!==it)x.y+=it.h+1});
 });
});
save();
window.DZ={menu:menuHtml,collapse,vis:visHtml};
applyCfgNew();buildPanel();renderAll();tickAll();
})();
