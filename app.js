const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ls={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const DEF_GRID={cols:5,rows:2,order:'row',gw:732,gh:244,air:30,th:80,bd:11,
  corners:[[138/1920,303/1080],[1815/1920,303/1080],[1815/1920,862/1080],[138/1920,862/1080]],locked:true};
let G=JSON.parse(JSON.stringify(DEF_GRID)); let gridDirty=false;
let db=null, assets=null, sessions=[], unsubS=null;
const PLAN=[1,2,3,4,5,6,7,8,9,10];
const cur={fireball:null,plan:PLAN.slice(),per:5,shots:[],base:null,savedId:null,savedImg:null,dirty:false};
let sel=-1,busy=false;
const fbColor=fb=>getComputedStyle(document.documentElement).getPropertyValue('--fb'+fb).trim()||'#888';

/* ---------- geometry (grid passed explicitly so saved sessions keep their own) ---------- */
function solve(A,b){const n=b.length;A=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];
    for(let r=0;r<n;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<=n;k++)A[r][k]-=f*A[c][k];}}
  return A.map((r,i)=>r[n]/r[i]);}
function homography(src,dst){const A=[],b=[];for(let i=0;i<4;i++){const[x,y]=src[i],[u,v]=dst[i];
  A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}return[...solve(A,b),1];}
const apply=(h,x,y)=>{const w=h[6]*x+h[7]*y+h[8];return[(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];};
function geo(g,W,H){const px=g.corners.map(([u,v])=>[u*W,v*H]),cm=[[0,g.gh],[g.gw,g.gh],[g.gw,0],[0,0]];return{px,toCm:homography(px,cm),toPx:homography(cm,px)};}
function sectorOf(g,x,y){const cw=g.gw/g.cols,rh=g.gh/g.rows;const col=Math.min(g.cols-1,Math.max(0,Math.floor(x/cw))),row=Math.min(g.rows-1,Math.max(0,Math.floor((g.gh-y)/rh)));
  return g.order==='row'?row*g.cols+col+1:col*g.rows+row+1;}
function cellOf(g,s){s-=1;return g.order==='row'?{row:Math.floor(s/g.cols),col:s%g.cols}:{col:Math.floor(s/g.rows),row:s%g.rows};}
function sectorCentre(g,s){const{row,col}=cellOf(g,s),cw=g.gw/g.cols,rh=g.gh/g.rows;return[(col+.5)*cw,g.gh-(row+.5)*rh];}
function lineDist(g,x,y){const cw=g.gw/g.cols,rh=g.gh/g.rows;let d=1e9;for(let i=1;i<g.cols;i++)d=Math.min(d,Math.abs(x-i*cw));for(let j=1;j<g.rows;j++)d=Math.min(d,Math.abs(y-j*rh));return d;}
const nSect=g=>g.cols*g.rows;

/* ---------- detection ---------- */
const work=document.createElement('canvas'),wctx=work.getContext('2d',{willReadFrequently:true});
function minmax(src,w,h,rad,isMin){const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
  for(let y=0;y<h;y++){const o=y*w;for(let x=0;x<w;x++){let m=isMin?1e9:-1e9;const a=Math.max(0,x-rad),b=Math.min(w-1,x+rad);for(let k=a;k<=b;k++){const v=src[o+k];if(isMin?v<m:v>m)m=v;}tmp[o+x]=m;}}
  for(let x=0;x<w;x++){for(let y=0;y<h;y++){let m=isMin?1e9:-1e9;const a=Math.max(0,y-rad),b=Math.min(h-1,y+rad);for(let k=a;k<=b;k++){const v=tmp[k*w+x];if(isMin?v<m:v>m)m=v;}out[y*w+x]=m;}}return out;}
function detect(bmp,gd=G){
  const W=bmp.width,H=bmp.height,s=Math.min(1,960/W),sw=Math.round(W*s),sh=Math.round(H*s);
  work.width=sw;work.height=sh;wctx.drawImage(bmp,0,0,sw,sh);
  const g=geo(gd,W,H),xs=g.px.map(p=>p[0]*s),ys=g.px.map(p=>p[1]*s),gwPx=Math.max(...xs)-Math.min(...xs),rad=Math.max(2,Math.round(gwPx*0.0054));
  const x0=Math.max(0,Math.floor(Math.min(...xs))-rad-2),x1=Math.min(sw-1,Math.ceil(Math.max(...xs))+rad+2),y0=Math.max(0,Math.floor(Math.min(...ys))-rad-2),y1=Math.min(sh-1,Math.ceil(Math.max(...ys))+rad+2);
  const w=x1-x0+1,h=y1-y0+1,d=wctx.getImageData(x0,y0,w,h).data,gr=new Float32Array(w*h);
  for(let i=0;i<w*h;i++)gr[i]=.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2];
  const bl=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let t=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const yy=y+dy,xx=x+dx;if(yy>=0&&yy<h&&xx>=0&&xx<w){t+=gr[yy*w+xx];n++}}bl[y*w+x]=t/n;}
  const op=minmax(minmax(bl,w,h,rad,true),w,h,rad,false),lab=new Int32Array(w*h),stack=[],cands=[],rmin=gwPx*.0085,rmax=gwPx*.022;let id=0;
  for(let i=0;i<w*h;i++){if(lab[i]||op[i]<gd.th)continue;id++;lab[i]=id;stack.push(i);const px=[];
    while(stack.length){const j=stack.pop();px.push(j);const x=j%w,y=(j/w)|0;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const k=yy*w+xx;if(!lab[k]&&op[k]>=gd.th){lab[k]=id;stack.push(k)}}}
    if(px.length<20)continue;let sx=0,sy=0;for(const j of px){sx+=j%w;sy+=(j/w)|0}const cx=sx/px.length,cy=sy/px.length;
    let r=0;for(const j of px){const dx=j%w-cx,dy=((j/w)|0)-cy;r=Math.max(r,dx*dx+dy*dy)}r=Math.sqrt(r)+.5;const circ=px.length/(Math.PI*r*r);
    if(r<rmin||r>rmax||circ<.45)continue;const X=(cx+x0)/s,Y=(cy+y0)/s,[xc,yc]=apply(g.toCm,X,Y);
    if(xc<0||xc>gd.gw||yc>gd.gh||yc<gd.air)continue;cands.push({x:X,y:Y,r:r/s,circ});}
  return cands.sort((a,b)=>b.circ-a.circ);}
function makeCrop(bmp,p){const R=Math.ceil(p.r+3),c=document.createElement('canvas');c.width=c.height=2*R;const x=c.getContext('2d');
  x.drawImage(bmp,p.x-R,p.y-R,2*R,2*R,0,0,2*R,2*R);x.globalCompositeOperation='destination-in';const gd=x.createRadialGradient(R,R,p.r-1,R,R,p.r+2);
  gd.addColorStop(0,'rgba(0,0,0,1)');gd.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=gd;x.fillRect(0,0,2*R,2*R);return c;}

/* ---------- session data ---------- */
const expected=()=>cur.plan.length*cur.per;
const planTarget=i=>cur.plan[Math.floor(i/cur.per)]??null;
function shotRows(){return cur.shots.map((sh,i)=>{const r={i,shot:i+1,file:sh.name,target:sh.target};
  if(!sh.pos){r.flag=sh.manual?'excluded':'no ball';return r;}
  const g=geo(G,sh.W,sh.H),[x,y]=apply(g.toCm,sh.pos.x,sh.pos.y);Object.assign(r,{x,y,sector:sectorOf(G,x,y),line:lineDist(G,x,y),px:sh.pos});
  r.flag=sh.manual?'manual':(sh.auto.length>1?'multiple':(r.line<G.bd?'borderline':'ok'));
  if(sh.target){const[tx,ty]=sectorCentre(G,sh.target);r.hit=r.sector===sh.target;r.miss=Math.hypot(x-tx,y-ty);}return r;});}
function stats(rows){const t=rows.filter(r=>r.target&&r.sector!=null),per={};
  t.forEach(r=>{(per[r.target]??=[]).push(r)});const ps={};let spreads=[];
  for(const[s,a]of Object.entries(per)){const cx=a.reduce((q,r)=>q+r.x,0)/a.length,cy=a.reduce((q,r)=>q+r.y,0)/a.length;
    const sp=a.reduce((q,r)=>q+Math.hypot(r.x-cx,r.y-cy),0)/a.length;if(a.length>1)spreads.push(sp);
    ps[s]={n:a.length,hits:a.filter(r=>r.hit).length,meanMiss:a.reduce((q,r)=>q+r.miss,0)/a.length,cx,cy,spread:a.length>1?sp:null};}
  return{balls:rows.filter(r=>r.sector!=null).length,aimed:t.length,hitRate:t.length?100*t.filter(r=>r.hit).length/t.length:null,
    meanMiss:t.length?t.reduce((q,r)=>q+r.miss,0)/t.length:null,spread:spreads.length?spreads.reduce((a,b)=>a+b,0)/spreads.length:null,perSector:ps};}
const fmt=(v,d=0)=>v==null||isNaN(v)?'–':(+v).toFixed(d);
const PILL={ok:'<span class="pill ok">ok</span>',manual:'<span class="pill">corrected</span>',excluded:'<span class="pill">excluded</span>',borderline:'<span class="pill warn">borderline</span>',multiple:'<span class="pill warn">2+ balls</span>','no ball':'<span class="pill bad">no ball</span>'};

/* ---------- drawing ---------- */
function drawGrid(ctx,g,W,H,handles){const gg=geo(g,W,H),cw=g.gw/g.cols,rh=g.gh/g.rows,lw=Math.max(2,W/700);
  ctx.save();ctx.strokeStyle='rgba(255,196,0,.95)';ctx.lineWidth=lw;
  const L=(a,b)=>{const p=apply(gg.toPx,...a),q=apply(gg.toPx,...b);ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();};
  for(let i=0;i<=g.cols;i++)L([i*cw,0],[i*cw,g.gh]);for(let j=0;j<=g.rows;j++)L([0,j*rh],[g.gw,j*rh]);
  ctx.font=`600 ${Math.round(W/48)}px "Barlow Condensed",sans-serif`;ctx.fillStyle='rgba(255,196,0,.9)';
  for(let s=1;s<=nSect(g);s++){const[cx,cy]=sectorCentre(g,s),p=apply(gg.toPx,cx-cw*.42,cy+rh*.42);ctx.fillText(s,p[0],p[1]+W/48);}
  if(handles)for(const[x,y]of gg.px){ctx.beginPath();ctx.arc(x,y,W/90,0,7);ctx.fillStyle='rgba(255,196,0,.35)';ctx.fill();ctx.lineWidth=lw*1.5;ctx.stroke();}
  ctx.restore();}
function label(ctx,txt,x,y,W,color,k=70){ctx.save();ctx.font=`600 ${Math.round(W/k)}px "IBM Plex Mono",monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.lineWidth=W/300;ctx.strokeStyle='rgba(0,0,0,.85)';ctx.strokeText(txt,x,y);ctx.fillStyle=color;ctx.fillText(txt,x,y);ctx.restore();}
function composeClean(target){const cv=target||document.createElement('canvas');if(!cur.base)return cv;cv.width=cur.base.W;cv.height=cur.base.H;
  const x=cv.getContext('2d');x.drawImage(cur.base.canvas,0,0);cur.shots.forEach(sh=>{if(sh.pos&&sh.crop){const R=sh.crop.width/2;x.drawImage(sh.crop,sh.pos.x-R,sh.pos.y-R);}});return cv;}
function overlay(ctx,g,W,H,pts,opts){if(opts.grid)drawGrid(ctx,g,W,H,opts.edit);if(opts.nums)pts.forEach(p=>label(ctx,String(p.n),p.x,p.y,W,p.hl?'#ffc400':'#ff5a4e',opts.k||70));}
function drawStage(){const cv=$('stageCv');if(!cur.base){const x=cv.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,cv.width,cv.height);
    x.fillStyle='#6b7a70';x.font='500 34px "IBM Plex Sans",sans-serif';x.textAlign='center';x.fillText('The stacked session image appears here',cv.width/2,cv.height/2);return;}
  composeClean(cv);const pts=cur.shots.map((sh,i)=>sh.pos?{n:i+1,x:sh.pos.x,y:sh.pos.y,hl:i===sel}:null).filter(Boolean);
  overlay(cv.getContext('2d'),G,cv.width,cv.height,pts,{grid:$('tGrid').checked,nums:$('tNums').checked,edit:$('tEdit').checked});}
async function drawInspector(){const sh=cur.shots[sel];if(!sh)return;const cv=$('inspCv'),bmp=await createImageBitmap(sh.file);
  cv.width=bmp.width;cv.height=bmp.height;const x=cv.getContext('2d');x.drawImage(bmp,0,0);bmp.close&&bmp.close();drawGrid(x,G,cv.width,cv.height,false);
  sh.auto.forEach(c=>{if(sh.pos&&c.x===sh.pos.x&&c.y===sh.pos.y)return;x.strokeStyle='rgba(255,255,255,.6)';x.setLineDash([8,6]);x.lineWidth=3;x.beginPath();x.arc(c.x,c.y,c.r+8,0,7);x.stroke();});
  x.setLineDash([]);if(sh.pos){x.strokeStyle='#ff3b30';x.lineWidth=5;x.beginPath();x.arc(sh.pos.x,sh.pos.y,sh.pos.r+8,0,7);x.stroke();}
  const r=shotRows()[sel];$('inspTitle').textContent=`Shot ${sel+1} · target ${sh.target??'–'} · landed ${r.sector??'–'}`;}

/* ---------- session UI ---------- */
function renderPlan(){const b=$('planBoard');b.style.gridTemplateColumns=`repeat(${G.cols},minmax(0,1fr))`;b.innerHTML='';
  for(let row=0;row<G.rows;row++)for(let col=0;col<G.cols;col++){const s=G.order==='row'?row*G.cols+col+1:col*G.rows+row+1,k=cur.plan.indexOf(s);
    const d=document.createElement('div');d.className='pcell'+(k>=0?' on':'');d.innerHTML=`${s}${k>=0?`<span class="ord">${k*cur.per+1}–${(k+1)*cur.per}</span>`:''}`;b.appendChild(d);}
  $('planText').textContent='Big number = shot numbers fired at that sector. Name the screenshots in shot order (0001–0050).';}
function afterPlan(){cur.shots.forEach((sh,i)=>{if(!sh.targetManual)sh.target=planTarget(i);});cur.dirty=true;renderPlan();render();}
function gate(){const miss=[];if(!cur.fireball)miss.push('fireball');if(!(+$('sPsi').value>0))miss.push('PSI');if(!(+$('sSpeed').value>0))miss.push('speed');if($('sCyl').value==='')miss.push('cylinder distance');if($('sR1').value==='')miss.push('R1');if($('sR2').value==='')miss.push('R2');
  const ok=!miss.length;$('addBtn').disabled=!ok||busy;$('gateMsg').textContent=ok?(cur.shots.length?'Loading new screenshots replaces the current ones.':''):`Fill in first: ${miss.join(', ')}.`;
  $('fbReq').hidden=!!cur.fireball;return ok;}
function sectorSummary(items,g,per){const N=nSect(g),by={};per=per||5;items.forEach(it=>{if(it.target)(by[it.target]??=[]).push(it)});
  const secs=[];let perfect=0,aimed=0;
  for(let s=1;s<=N;s++){const a=(by[s]||[]).slice().sort((x,y)=>x.n-y.n),hits=a.filter(it=>it.sector===s).length;
    const lvl=!a.length?'empty':hits>=per?'perfect':hits>=Math.ceil(per*.6)?'partial':'poor';
    if(a.length)aimed++;if(lvl==='perfect')perfect++;secs.push({s,shots:a,hits,n:a.length,lvl});}
  return{secs,perfect,aimed};}
function cardsHTML(sum,g,perSector,interactive){let h='';
  for(let row=0;row<g.rows;row++)for(let col=0;col<g.cols;col++){const s=g.order==='row'?row*g.cols+col+1:col*g.rows+row+1,c=sum.secs[s-1],p=perSector&&perSector[s];
    if(!c)continue;const lab=c.lvl==='perfect'?'all in':c.lvl==='empty'?'no shots':`${c.n-c.hits} out`;
    const dots=c.shots.map(it=>{const cls=it.sector===s?'hit':it.sector==null?'none':'miss',tip=`Shot ${it.n}: ${cls==='hit'?'hit':cls==='none'?'no ball found':'landed in sector '+it.sector}`;
      return interactive?`<button type="button" class="dot ${cls}" data-i="${it.i}" title="${tip}" aria-label="${tip}">${cls==='miss'?it.sector:''}</button>`:`<span class="dot ${cls}" title="${tip}">${cls==='miss'?it.sector:''}</span>`;}).join('');
    h+=`<div class="sc ${c.lvl}"><div class="sc-h"><span class="sc-n">S${s}</span><span class="sc-score">${c.n?c.hits+'/'+c.n:'–'}</span></div><div class="sc-lab">${lab}</div><div class="sc-dots">${dots}</div><div class="sc-m">${p?`miss ${fmt(p.meanMiss)} · spread ${fmt(p.spread)}`:''}</div></div>`;}
  return h;}
function perfectOf(s){const g=s.grid||G;return sectorSummary((s.shots||[]).map(q=>({n:q.n,target:q.target,sector:q.sector})),g,s.perSector||5).perfect;}
function render(){
  drawStage();const rows=shotRows(),st=stats(rows),exp=expected();
  $('counter').innerHTML=`${cur.shots.length} <small>/ ${exp||'–'} shots</small>`;$('counter').classList.toggle('off',cur.shots.length>0&&cur.shots.length!==exp);
  if(!busy)$('status').innerHTML=cur.shots.length?`<b>${st.balls}</b> balls in the air`+(rows.some(r=>r.flag==='no ball')?` · <b>${rows.filter(r=>r.flag==='no ball').length}</b> without ball`:''):'';
  $('kHit').textContent=st.hitRate==null?'–':Math.round(st.hitRate)+'%';$('kMiss').textContent=fmt(st.meanMiss);$('kSpread').textContent=fmt(st.spread);
  const N=nSect(G),items=rows.map(r=>({n:r.shot,i:r.i,target:r.target,sector:r.sector??null})),sum=sectorSummary(items,G,cur.per);
  const sg=$('sgrid');sg.style.setProperty('--cols',G.cols);sg.innerHTML=cardsHTML(sum,G,st.perSector,true);
  $('kPerfect').textContent=cur.shots.length?`${sum.perfect}/${sum.aimed}`:'–';
  $('resStatus').textContent=cur.shots.length?`${sum.perfect} of ${sum.aimed} sectors with all ${cur.per} shots in`:'Load screenshots to see how each sector did.';
  $('shotCount').textContent=cur.shots.length?`${cur.shots.length} shots`:'';
  const tb=$('tbody');tb.innerHTML='';$('emptyMsg').hidden=cur.shots.length>0;
  const opt=t=>'<option value="">–</option>'+Array.from({length:N},(_,k)=>`<option${t===k+1?' selected':''}>${k+1}</option>`).join('');
  rows.forEach(r=>{const tr=document.createElement('tr');tr.className='row'+(r.i===sel?' sel':'');
    const pill=PILL[r.flag];
    const hit=r.target&&r.sector?(r.hit?' <span class="pill hit">hit</span>':' <span class="pill bad">miss</span>'):'';
    tr.innerHTML=`<td class="num">${r.shot}</td><td>${esc(r.file)}</td><td><select data-i="${r.i}" aria-label="Target sector">${opt(r.target)}</select></td><td><span class="sec">${r.sector??'–'}</span>${hit}</td>`+
      `<td class="num">${r.sector?Math.round(r.x):''}</td><td class="num">${r.sector?Math.round(r.y):''}</td><td class="num">${r.miss!=null?Math.round(r.miss):''}</td><td>${pill}</td>`;
    tr.onclick=e=>{if(e.target.tagName!=='SELECT')openInspector(r.i)};tb.appendChild(tr);});
  tb.querySelectorAll('select').forEach(s=>s.onchange=e=>{const sh=cur.shots[+e.target.dataset.i];sh.target=e.target.value?+e.target.value:null;sh.targetManual=true;cur.dirty=true;render();});
  // save state
  const canSave=cur.shots.length>0&&cur.fireball&&+$('sPsi').value>0&&+$('sSpeed').value>0&&$('sCyl').value!==''&&$('sR1').value!==''&&$('sR2').value!==''&&db&&!busy;$('saveBtn').disabled=!canSave||(cur.savedId&&!cur.dirty);
  $('saveBtn').textContent=cur.savedId?(cur.dirty?'Update saved session':'Saved'):'Save session';
  if(!cur.shots.length)$('saveState').textContent='Nothing to save yet.';
  else if(cur.savedId&&!cur.dirty)$('saveState').innerHTML='<b>Saved.</b> It is in History.';
  else $('saveState').innerHTML=`FB ${cur.fireball??'?'} · ${cur.shots.length} of ${exp} shots`+(cur.shots.length!==exp?` · <span style="color:var(--warn)">count does not match the plan</span>`:'')+(cur.savedId?' · changed since saving':'');
  $('setupState').textContent=cur.fireball?`FB ${cur.fireball} · ${$('sPsi').value||'?'} PSI · ${$('sSpeed').value||'?'} km/h · cyl ${$('sCyl').value||'?'} · R1 ${$('sR1').value||'?'} · R2 ${$('sR2').value||'?'} · ${exp} shots`:'';
  gate();}
function openInspector(i){sel=i;$('inspector').hidden=false;render();drawInspector();}

/* ---------- loading ---------- */
async function loadFiles(list){if(busy||!gate())return;busy=true;sel=-1;$('inspector').hidden=true;
  const files=[...list].filter(f=>/^image\//.test(f.type)||/\.(png|jpe?g|webp)$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  cur.shots=files.map((f,i)=>({file:f,name:f.name,target:planTarget(i),auto:[],pos:null,manual:false,crop:null}));cur.base=null;cur.savedId=null;cur.savedImg=null;cur.dirty=true;
  renderPlan();await analyseAll();}
async function analyseAll(){busy=true;$('rerunBtn').disabled=true;
  for(let i=0;i<cur.shots.length;i++){$('status').innerHTML=`Analysing <b>${i+1}</b> / ${cur.shots.length}…`;const sh=cur.shots[i],bmp=await createImageBitmap(sh.file);sh.W=bmp.width;sh.H=bmp.height;
    if(i===0){const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d').drawImage(bmp,0,0);cur.base={canvas:c,W:bmp.width,H:bmp.height};}
    sh.auto=detect(bmp);if(!sh.manual)sh.pos=sh.auto[0]||null;sh.crop=sh.pos?makeCrop(bmp,sh.pos):null;bmp.close&&bmp.close();
    if(i%5===4||i===cur.shots.length-1){render();await new Promise(r=>setTimeout(r,0));}}
  busy=false;$('rerunBtn').disabled=G.locked;cur.dirty=true;render();}

/* ---------- save session ---------- */
const canvasBlob=(cv,q=.85)=>new Promise(r=>cv.toBlob(r,'image/jpeg',q));
async function saveSession(){if(!db||!cur.shots.length)return;busy=true;$('saveBtn').disabled=true;$('saveState').textContent='Saving…';
  try{const rows=shotRows(),st=stats(rows),id=cur.savedId||`${$('sDate').value||new Date().toISOString().slice(0,10)}_FB${cur.fireball}_${Math.random().toString(36).slice(2,7)}`;
    let imageId=null,oldImg=cur.savedImg;
    if(assets){try{const up=await assets.upload(await canvasBlob(composeClean()),{type:'image/jpeg'});imageId=up.id;}catch(e){console.warn(e);}}
    const doc={fireball:cur.fireball,psi:+$('sPsi').value,speed:+$('sSpeed').value,cyl:+$('sCyl').value,r1:+$('sR1').value,r2:+$('sR2').value,date:$('sDate').value,operator:$('sOp').value.trim(),notes:$('sNotes').value.trim(),plan:cur.plan.slice(),perSector:cur.per,
      expected:expected(),createdAt:new Date().toISOString(),imageId,W:cur.base.W,H:cur.base.H,
      grid:{cols:G.cols,rows:G.rows,order:G.order,gw:G.gw,gh:G.gh,corners:G.corners,air:G.air,th:G.th},
      stats:{perfect:sectorSummary(rows.map(r=>({n:r.shot,target:r.target,sector:r.sector??null})),G,cur.per).perfect,balls:st.balls,aimed:st.aimed,hitRate:st.hitRate,meanMiss:st.meanMiss,spread:st.spread,perSector:st.perSector},
      shots:rows.map(r=>({n:r.shot,file:r.file,target:r.target??null,sector:r.sector??null,x:r.x!=null?+r.x.toFixed(1):null,y:r.y!=null?+r.y.toFixed(1):null,
        miss:r.miss!=null?+r.miss.toFixed(1):null,px:r.px?{x:Math.round(r.px.x),y:Math.round(r.px.y)}:null,flag:r.flag}))};
    await db.collection('sessions').doc(id).set(doc);
    if(oldImg&&imageId&&assets){try{await assets.delete(oldImg)}catch(e){}}
    cur.savedId=id;cur.savedImg=imageId;cur.dirty=false;busy=false;render();
    if(!imageId)$('saveState').innerHTML='<b>Saved</b>, but the session image could not be stored.';
  }catch(e){busy=false;render();$('saveState').innerHTML=`<span style="color:var(--bad)">Not saved: ${esc(e&&e.message||'storage error')}. Try again.</span>`;}}

/* ---------- grid calibration ---------- */
const gBind=[['gCols','cols'],['gRows','rows'],['gOrder','order'],['gGW','gw'],['gGH','gh'],['gAir','air'],['gTh','th'],['gBd','bd']];
function renderGridUI(){gBind.forEach(([id,k])=>{$(id).value=G[k];$(id).disabled=G.locked;});
  $('lockPill').textContent=G.locked?'Locked':'Unlocked';$('lockPill').classList.toggle('on',G.locked);$('lockBtn').textContent=G.locked?'Unlock grid':'Discard changes';
  $('tEdit').disabled=G.locked;if(G.locked)$('tEdit').checked=false;$('resetCorners').disabled=G.locked;$('saveGrid').disabled=G.locked;$('rerunBtn').disabled=G.locked||!cur.shots.length;
  $('stage').classList.toggle('editing',$('tEdit').checked);
  $('gridState').textContent=G.updatedAt?`Grid last saved ${new Date(G.updatedAt).toLocaleString()}`:'Using the default grid for the current camera position.';}
gBind.forEach(([id,k])=>$(id).addEventListener('change',e=>{if(G.locked)return;G[k]=k==='order'?e.target.value:Math.max(1,+e.target.value||1);gridDirty=true;renderPlan();render();}));
$('lockBtn').onclick=()=>{if(G.locked){G.locked=false;}else{loadGrid(lastGridDoc);}renderGridUI();render();};
$('resetCorners').onclick=()=>{G.corners=DEF_GRID.corners.map(p=>[...p]);gridDirty=true;render();};
$('rerunBtn').onclick=()=>{if(!busy&&cur.shots.length)analyseAll().then(()=>{if(sel>=0)drawInspector()});};
$('saveGrid').onclick=async()=>{G.locked=true;G.updatedAt=new Date().toISOString();const doc={...G};delete doc.bd;doc.bd=G.bd;
  ls.set('pa.grid',doc);if(db){try{await db.doc('config/grid').set(doc);}catch(e){$('gridState').textContent='Grid kept in this browser only: shared save failed.';}}
  gridDirty=false;renderGridUI();render();};
let lastGridDoc=null;
function loadGrid(d){G=Object.assign(JSON.parse(JSON.stringify(DEF_GRID)),d||{});G.locked=true;renderGridUI();renderPlan();}
$('tEdit').onchange=()=>{renderGridUI();render();};
let drag=-1;const cvPt=(cv,e)=>{const b=cv.getBoundingClientRect();return[(e.clientX-b.left)*cv.width/b.width,(e.clientY-b.top)*cv.height/b.height];};
$('stageCv').addEventListener('pointerdown',e=>{if(!$('tEdit').checked||!cur.base)return;const[x,y]=cvPt(e.target,e),g=geo(G,cur.base.W,cur.base.H);let best=-1,bd=cur.base.W/25;
  g.px.forEach(([px,py],i)=>{const d=Math.hypot(px-x,py-y);if(d<bd){bd=d;best=i}});if(best>=0){drag=best;e.target.setPointerCapture(e.pointerId);}});
$('stageCv').addEventListener('pointermove',e=>{if(drag<0)return;const[x,y]=cvPt(e.target,e);G.corners[drag]=[x/cur.base.W,y/cur.base.H];gridDirty=true;render();});
$('stageCv').addEventListener('pointerup',()=>{drag=-1;});

/* ---------- history ---------- */
let filt='all',picked=[];
function shownSessions(){return sessions.filter(s=>filt==='all'||String(s.fireball)===filt);}
function renderHistory(){
  const list=shownSessions();$('hEmpty').hidden=list.length>0;
  
  const tb=$('hBody');tb.innerHTML='';
  list.forEach(s=>{const tr=document.createElement('tr'),st=s.stats||{},on=picked.includes(s._id);tr.className='row'+(on?' sel':'');
    tr.innerHTML=`<td><input type="checkbox" aria-label="Compare" ${on?'checked':''}></td><td>${esc(s.date||s.createdAt?.slice(0,10))}</td><td><span class="fbtag" style="--fbc:var(--fb${esc(s.fireball)})">FB ${esc(s.fireball)}</span></td>`+
      `<td class="num">${esc(s.psi??'–')}</td><td class="num">${esc(s.speed??'–')}</td><td class="num">${esc(s.cyl??'–')}</td><td class="num">${esc(s.r1??'–')}</td><td class="num">${esc(s.r2??'–')}</td><td class="num">${st.balls??'–'}/${s.expected??'–'}</td><td class="num"><b>${st.perfect??'–'}</b>/${(s.plan||[]).length||10}</td><td class="num">${st.hitRate==null?'–':Math.round(st.hitRate)+'%'}</td>`+
      `<td class="num">${fmt(st.meanMiss)}</td><td class="num">${fmt(st.spread)}</td><td>${esc(s.operator)}</td>`;
    tr.onclick=()=>{const k=picked.indexOf(s._id);if(k>=0)picked.splice(k,1);else{picked.push(s._id);if(picked.length>2)picked.shift();}renderHistory();renderCompare();};tb.appendChild(tr);});
  renderChart(list);}
function renderChart(list){const svg=$('chart'),m=$('metric').value,W=900,H=260,L=44,R=36,T=12,B=30;
  const pts=list.filter(s=>s.stats&&s.stats[m]!=null).slice().sort((a,b)=>(a.date+a.createdAt).localeCompare(b.date+b.createdAt));
  if(!pts.length){svg.innerHTML=`<text x="${W/2}" y="${H/2}" text-anchor="middle" class="ax">Saved sessions will be plotted here.</text>`;$('chartLegend').textContent='';return;}
  const vals=pts.map(s=>s.stats[m]),top=m==='hitRate'?100:m==='perfect'?10:Math.max(10,Math.ceil(Math.max(...vals)/10)*10),y=v=>T+(H-T-B)*(1-v/top),x=i=>L+(pts.length===1?(W-L-R)/2:(W-L-R)*i/(pts.length-1));
  let h='';for(let k=0;k<=4;k++){const v=top*k/4;h+=`<line class="gl" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L-6}" y="${y(v)+4}" text-anchor="end">${Math.round(v)}</text>`;}
  const fbs=[...new Set(pts.map(s=>s.fireball))];
  fbs.forEach(fb=>{const c=`var(--fb${fb})`,idx=pts.map((s,i)=>s.fireball===fb?i:-1).filter(i=>i>=0);
    h+=`<polyline class="ln" style="stroke:${c}" points="${idx.map(i=>`${x(i)},${y(pts[i].stats[m])}`).join(' ')}"/>`;
    idx.forEach(i=>{h+=`<circle cx="${x(i)}" cy="${y(pts[i].stats[m])}" r="5" style="fill:${c}"><title>${esc(pts[i].date)} FB ${fb} · ${esc(pts[i].psi??'–')} PSI · ${esc(pts[i].speed??'–')} km/h · cyl ${esc(pts[i].cyl??'–')} · R1 ${esc(pts[i].r1??'–')} · R2 ${esc(pts[i].r2??'–')}: ${fmt(pts[i].stats[m],1)}</title></circle>`;});});
  const step=Math.max(1,Math.ceil(pts.length/8));pts.forEach((s,i)=>{if(i%step===0||i===pts.length-1)h+=`<text class="ax" x="${x(i)}" y="${H-8}" text-anchor="middle">${esc((s.date||'').slice(5))}</text>`;});
  svg.innerHTML=h;$('chartLegend').innerHTML=fbs.map(fb=>`<span class="fbtag" style="--fbc:var(--fb${fb})">FB ${fb}</span>`).join(' ')+` &nbsp;${pts.length} session${pts.length>1?'s':''}, oldest left.`;}
const imgCache={};
function loadImg(id){if(!id)return Promise.resolve(null);if(imgCache[id])return imgCache[id];
  return imgCache[id]=new Promise(res=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>res(null);api.raw('GET','/api/image?id='+encodeURIComponent(id)).then(r=>r.ok?r.blob():null).then(b=>{if(!b)return res(null);im.src=URL.createObjectURL(b);}).catch(()=>res(null));});}
function noImage(x,cv){x.fillStyle='#000';x.fillRect(0,0,cv.width,cv.height);x.fillStyle='#6b7a70';x.font='500 34px sans-serif';x.textAlign='center';x.fillText('No stored image',cv.width/2,cv.height/2);}
async function renderCompare(){const ss=picked.map(id=>sessions.find(s=>s._id===id)).filter(Boolean);$('cmpPanel').hidden=!ss.length||!!ed;if(!ss.length||ed)return;
  $('cmpTitle').textContent=ss.length===2?'Compare':'Session';const box=$('cmpBox');box.innerHTML='';
  for(const s of ss){const d=document.createElement('div'),cv=document.createElement('canvas');d.appendChild(cv);const sg2=s.grid||G,mg=document.createElement('div');mg.className='sgrid mini';mg.style.setProperty('--cols',sg2.cols);
    mg.innerHTML=cardsHTML(sectorSummary((s.shots||[]).map(q=>({n:q.n,target:q.target,sector:q.sector})),sg2,s.perSector||5),sg2,null,false);d.appendChild(mg);
    const m=document.createElement('p');m.className='meta';m.innerHTML=`<span class="fbtag" style="--fbc:var(--fb${esc(s.fireball)})">FB ${esc(s.fireball)}</span> ${esc(s.date)} · ${esc(s.psi??'–')} PSI · ${esc(s.speed??'–')} km/h · cyl ${esc(s.cyl??'–')} mm · R1 ${esc(s.r1??'–')} · R2 ${esc(s.r2??'–')} · ${esc(s.operator||'')} ${s.notes?'· '+esc(s.notes):''}`;d.appendChild(m);
    const acts=document.createElement('div');acts.className='actions';acts.style.marginTop='8px';
    const edit=document.createElement('button');edit.type='button';edit.textContent='Edit session';edit.onclick=()=>openEdit(s._id);
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='Delete session';
    del.onclick=async()=>{if(del.dataset.armed!=='1'){del.dataset.armed='1';del.textContent='Click again to delete for everyone';return;}
      try{await db.collection('sessions').doc(s._id).delete();picked=picked.filter(x=>x!==s._id);}catch(e){del.textContent='Delete failed';}};
    acts.append(edit,del);d.appendChild(acts);box.appendChild(d);
    cv.width=s.W||1920;cv.height=s.H||1080;const x=cv.getContext('2d'),im=await loadImg(s.imageId);
    if(im)x.drawImage(im,0,0,cv.width,cv.height);else noImage(x,cv);
    overlay(x,s.grid,cv.width,cv.height,(s.shots||[]).filter(q=>q.px).map(q=>({n:q.n,x:q.px.x,y:q.px.y})),{grid:true,nums:$('cNums').checked,k:40});}
  // table
  const sectors=[...new Set(ss.flatMap(s=>s.plan||[]))].sort((a,b)=>a-b);
  let h=`<thead><tr><th></th>${ss.map(s=>`<th class="num"><span class="fbtag" style="--fbc:var(--fb${esc(s.fireball)})">FB ${esc(s.fireball)}</span> ${esc(s.date)}</th>`).join('')}</tr></thead><tbody>`;
  const row=(lab,f)=>`<tr><td>${lab}</td>${ss.map(s=>`<td class="num">${f(s)}</td>`).join('')}</tr>`;
  h+=row('Sectors 5 / 5',s=>`<b>${s.stats?.perfect??'–'}</b> / ${(s.plan||[]).length||10}`)+row('PSI',s=>esc(s.psi??'–'))+row('Speed km/h',s=>esc(s.speed??'–'))+row('Cylinder distance mm',s=>esc(s.cyl??'–'))+row('R1',s=>esc(s.r1??'–'))+row('R2',s=>esc(s.r2??'–'))+row('Hit rate',s=>s.stats?.hitRate==null?'–':Math.round(s.stats.hitRate)+'%')+row('Avg miss cm',s=>fmt(s.stats?.meanMiss))+row('Spread cm',s=>fmt(s.stats?.spread))+row('Balls found',s=>`${s.stats?.balls??'–'}/${s.expected??'–'}`);
  sectors.forEach(sec=>{h+=row(`Sector ${sec}: hits · miss · spread`,s=>{const p=s.stats?.perSector?.[sec];return p?`${p.hits}/${p.n} · ${fmt(p.meanMiss)} · ${fmt(p.spread)}`:'–';});});
  $('cmpTable').innerHTML=h+'</tbody>';}

/* ---------- edit saved session (screenshots are not stored: works on stored ball positions + stacked image,
   or on the original screenshots when they are loaded again; then the stacked image is rebuilt on save) ---------- */
let ed=null,eInspTok=0;
const E_LOAD_TIP='Missing or wrong ball? Load the original screenshots of this session (button or drop) to check each shot like in the Session tab.';
const eMeta=[['eDate','date'],['eOp','operator'],['ePsi','psi'],['eSpeed','speed'],['eCyl','cyl'],['eR1','r1'],['eR2','r2'],['eNotes','notes']];
function openEdit(id){const s=sessions.find(x=>x._id===id);if(!s)return;
  ed={id,src:s,fireball:s.fireball,shots:(s.shots||[]).map(q=>({...q,px:q.px?{...q.px}:null})),sel:-1,dirty:false,saving:false,grid:gridCopy(s.grid||G),gridChanged:false};$('eGridEdit').checked=false;
  eMeta.forEach(([el,k])=>$(el).value=s[k]??'');$('eTitle').textContent=`Edit session · FB ${s.fireball} · ${s.date||''}`;$('eState').textContent='';$('eLoad').textContent=E_LOAD_TIP;
  $('editPanel').hidden=false;$('cmpPanel').hidden=true;renderEdit();$('editPanel').scrollIntoView({behavior:'smooth',block:'start'});}
function closeEdit(){ed=null;$('editPanel').hidden=true;$('eCancel').dataset.armed='';$('eCancel').textContent='Cancel';renderCompare();}
const gridCopy=g=>JSON.parse(JSON.stringify({cols:g.cols,rows:g.rows,order:g.order,gw:g.gw,gh:g.gh,corners:g.corners,air:g.air,th:g.th}));
// untouched shots keep their stored cm values; moved ones (or all, once the grid changed) are re-measured with the session's grid
function editRows(){const s=ed.src,g=ed.grid,gg=geo(g,s.W||1920,s.H||1080);
  return ed.shots.map((q,i)=>{const r={i,shot:q.n??i+1,file:q.file||'',target:q.target,flag:q.flag};if(!q.px)return r;
    let x=q.x,y=q.y,sector=q.sector;if(q.moved||ed.gridChanged||x==null||sector==null){[x,y]=apply(gg.toCm,q.px.x,q.px.y);sector=sectorOf(g,x,y);}
    Object.assign(r,{x,y,sector,px:q.px});
    if(q.target){const[tx,ty]=sectorCentre(g,q.target);r.hit=sector===q.target;r.miss=Math.hypot(x-tx,y-ty);}return r;});}
function editGate(){const miss=[];if(!ed.fireball)miss.push('fireball');if(!(+$('ePsi').value>0))miss.push('PSI');if(!(+$('eSpeed').value>0))miss.push('speed');if($('eCyl').value==='')miss.push('cylinder distance');if($('eR1').value==='')miss.push('R1');if($('eR2').value==='')miss.push('R2');
  const ok=!miss.length;$('eSave').disabled=!ok||!ed.dirty||ed.saving||ed.loading;$('eLoadBtn').disabled=!!ed.loading;$('eGate').textContent=ok?(ed.dirty?'Unsaved changes.':''):`Fill in first: ${miss.join(', ')}.`;
  document.querySelectorAll('#eFbs .fb').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.fb===ed.fireball)));return ok;}
function renderEdit(){if(!ed)return;const s=ed.src,g=ed.grid,rows=editRows(),st=stats(rows),N=nSect(g);
  const sum=sectorSummary(rows.map(r=>({n:r.shot,i:r.i,target:r.target,sector:r.sector??null})),g,s.perSector||5);
  $('eKPerfect').textContent=`${sum.perfect}/${sum.aimed}`;$('eKHit').textContent=st.hitRate==null?'–':Math.round(st.hitRate)+'%';$('eKMiss').textContent=fmt(st.meanMiss);$('eKSpread').textContent=fmt(st.spread);
  const sg=$('eSgrid');sg.style.setProperty('--cols',g.cols);sg.innerHTML=cardsHTML(sum,g,st.perSector,true);
  const opt=t=>'<option value="">–</option>'+Array.from({length:N},(_,k)=>`<option${t===k+1?' selected':''}>${k+1}</option>`).join('');
  $('eBody').innerHTML=rows.map(r=>{const hit=r.target&&r.sector?(r.hit?' <span class="pill hit">hit</span>':' <span class="pill bad">miss</span>'):'';
    return `<tr class="row${r.i===ed.sel?' sel':''}" data-i="${r.i}"><td class="num">${r.shot}</td><td>${esc(r.file)}</td><td><select data-i="${r.i}" aria-label="Target sector">${opt(r.target)}</select></td><td><span class="sec">${r.sector??'–'}</span>${hit}</td>`+
      `<td class="num">${r.miss!=null?Math.round(r.miss):''}</td><td>${PILL[r.flag]||''}</td><td>${r.px?`<button type="button" data-nb="${r.i}" style="padding:2px 8px">No ball</button>`:''}</td></tr>`;}).join('');
  $('eGridReset').disabled=!ed.gridChanged;
  const r=rows[ed.sel];$('eHint').textContent=$('eGridEdit').checked?'Drag the yellow corner handles onto the goal corners. Every shot is re-measured with the new grid.':r?`Shot ${r.shot} · target ${r.target??'–'} · landed ${r.sector??'–'}. Click the image where this ball is to move it.`:'Pick a shot (a dot in the sector cards or a row in the shot list), then click the image where its ball is.';
  $('eInsp').hidden=!ed.shots[ed.sel]?.img;drawEdit(rows);drawEditInsp(rows);editGate();}
function composeEdit(cv){cv.width=ed.base.width;cv.height=ed.base.height;const x=cv.getContext('2d');x.drawImage(ed.base,0,0);
  ed.shots.forEach(q=>{if(q.px&&q.crop){const R=q.crop.width/2;x.drawImage(q.crop,q.px.x-R,q.px.y-R);}});return cv;}
async function drawEdit(rows){const s=ed.src,cv=$('eCv'),im=ed.base?null:await loadImg(s.imageId);if(!ed||ed.src!==s)return;const x=cv.getContext('2d');
  if(ed.base)composeEdit(cv);else{cv.width=s.W||1920;cv.height=s.H||1080;if(im)x.drawImage(im,0,0,cv.width,cv.height);else noImage(x,cv);}
  overlay(x,ed.grid,cv.width,cv.height,rows.filter(r=>r.px).map(r=>({n:r.shot,x:r.px.x,y:r.px.y,hl:r.i===ed.sel})),{grid:true,nums:$('eNums').checked,edit:$('eGridEdit').checked,k:40});
  const p=rows[ed.sel]?.px;if(p){x.strokeStyle='#ffc400';x.lineWidth=4;x.beginPath();x.arc(p.x,p.y,cv.width/60,0,7);x.stroke();}}
async function drawEditInsp(rows){const q=ed.shots[ed.sel];if(!q||!q.img)return;const tok=++eInspTok,bmp=await createImageBitmap(q.img);if(tok!==eInspTok||!ed){bmp.close&&bmp.close();return;}
  const cv=$('eInspCv');cv.width=bmp.width;cv.height=bmp.height;const x=cv.getContext('2d');x.drawImage(bmp,0,0);bmp.close&&bmp.close();drawGrid(x,ed.grid,cv.width,cv.height,false);
  (q.auto||[]).forEach(c=>{if(q.px&&Math.hypot(c.x-q.px.x,c.y-q.px.y)<2)return;x.strokeStyle='rgba(255,255,255,.6)';x.setLineDash([8,6]);x.lineWidth=3;x.beginPath();x.arc(c.x,c.y,c.r+8,0,7);x.stroke();});
  x.setLineDash([]);if(q.px){x.strokeStyle='#ff3b30';x.lineWidth=5;x.beginPath();x.arc(q.px.x,q.px.y,(q.px.r||cv.width/85)+8,0,7);x.stroke();}
  const r=rows[ed.sel];$('eInspTitle').textContent=`Shot ${r.shot} · target ${r.target??'–'} · landed ${r.sector??'–'}`;}
const medianR=()=>{const rs=ed.shots.filter(q=>q.px&&q.px.r).map(q=>q.px.r).sort((a,b)=>a-b);return rs.length?rs[rs.length>>1]:(ed.src.W||1920)/85;};
async function setEditPos(i,pos,flag){const q=ed.shots[i];q.px=pos?{x:Math.round(pos.x),y:Math.round(pos.y),r:pos.r||medianR()}:null;q.moved=true;q.flag=flag;q.crop=null;
  if(!pos)Object.assign(q,{x:null,y:null,sector:null,miss:null});
  else if(q.img){const bmp=await createImageBitmap(q.img);q.crop=makeCrop(bmp,q.px);bmp.close&&bmp.close();}
  ed.dirty=true;renderEdit();}
// match the screenshots to the stored shots by file name (or by order when the names differ), detect balls, cut the ball crops
async function loadEditShots(list){if(!ed||ed.loading)return;const E=ed,s=E.src,W=s.W||1920,H=s.H||1080;
  const files=[...list].filter(f=>/^image\//.test(f.type)||/\.(png|jpe?g|webp)$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const byName=new Map(files.map(f=>[f.name,f]));let pick=E.shots.map(q=>byName.get(q.file)),note='';
  if(pick.some(f=>!f)){if(files.length!==E.shots.length){$('eLoad').textContent=`Only ${pick.filter(Boolean).length} of ${E.shots.length} shots match a file name. Load the screenshots this session was made from.`;return;}pick=files;note=' File names differ, so they were matched in order.';}
  E.loading=true;editGate();const out=[];let base=null;
  try{for(let i=0;i<pick.length;i++){$('eLoad').textContent=`Analysing ${i+1} / ${pick.length}…`;const q=E.shots[i],bmp=await createImageBitmap(pick[i]);
      if(bmp.width!==W||bmp.height!==H){bmp.close&&bmp.close();throw new Error(`${pick[i].name} is ${bmp.width}×${bmp.height}, but the session was made from ${W}×${H} screenshots`);}
      if(i===0){base=document.createElement('canvas');base.width=W;base.height=H;base.getContext('2d').drawImage(bmp,0,0);}
      const auto=detect(bmp,{...G,...E.grid});let px=q.px&&{...q.px},crop=null;
      if(px){const near=auto.find(c=>Math.hypot(c.x-px.x,c.y-px.y)<c.r*1.5);px.r=near?near.r:(auto[0]?.r||W/85);crop=makeCrop(bmp,px);}
      bmp.close&&bmp.close();out.push({img:pick[i],auto,px,crop});if(ed!==E)return;}}
  catch(e){E.loading=false;if(ed===E){$('eLoad').innerHTML=`<span style="color:var(--bad)">${esc(e.message)}</span>`;editGate();}return;}
  if(ed!==E)return;out.forEach((o,i)=>Object.assign(E.shots[i],o));E.base=base;E.loading=false;
  $('eLoad').textContent=`Screenshots loaded.${note} Pick a shot to check it on its own screenshot; saving rebuilds the session image.`;renderEdit();}
async function saveEdit(){if(!ed||!db||!editGate())return;ed.saving=true;editGate();$('eState').textContent='Saving…';
  const s=ed.src,g=ed.grid,rows=editRows(),st=stats(rows),{_id,...base}=s;let imageId=s.imageId;
  if(ed.base){try{imageId=(await assets.upload(await canvasBlob(composeEdit(document.createElement('canvas'))))).id;}
    catch(e){ed.saving=false;editGate();$('eState').innerHTML=`<span style="color:var(--bad)">Not saved: the session image could not be stored (${esc(e&&e.message||'storage error')}). Try again.</span>`;return;}}
  const doc={...base,imageId,grid:g,fireball:ed.fireball,psi:+$('ePsi').value,speed:+$('eSpeed').value,cyl:+$('eCyl').value,r1:+$('eR1').value,r2:+$('eR2').value,date:$('eDate').value,operator:$('eOp').value.trim(),notes:$('eNotes').value.trim(),updatedAt:new Date().toISOString(),
    stats:{perfect:sectorSummary(rows.map(r=>({n:r.shot,target:r.target,sector:r.sector??null})),g,s.perSector||5).perfect,balls:st.balls,aimed:st.aimed,hitRate:st.hitRate,meanMiss:st.meanMiss,spread:st.spread,perSector:st.perSector},
    shots:rows.map(r=>({n:r.shot,file:r.file,target:r.target??null,sector:r.sector??null,x:r.x!=null?+r.x.toFixed(1):null,y:r.y!=null?+r.y.toFixed(1):null,
      miss:r.miss!=null?+r.miss.toFixed(1):null,px:r.px?{x:Math.round(r.px.x),y:Math.round(r.px.y)}:null,flag:r.flag}))};
  try{await db.collection('sessions').doc(ed.id).set(doc);if(s.imageId&&imageId!==s.imageId){try{await assets.delete(s.imageId)}catch(e){}}closeEdit();}
  catch(e){if(imageId!==s.imageId){try{await assets.delete(imageId)}catch(e2){}}ed.saving=false;editGate();$('eState').innerHTML=`<span style="color:var(--bad)">Not saved: ${esc(e&&e.message||'storage error')}. Try again.</span>`;}}

/* ---------- export ---------- */
let dl=null;
async function saveFile(name,data){if(dl){try{await dl.save({filename:name,data});}catch(e){}return;}
  const blob=data instanceof Blob?data:new Blob([data]);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);}
const fname=ext=>`precision_FB${cur.fireball??'x'}_${$('sDate').value||'session'}.${ext}`;
$('csvBtn').onclick=()=>{if(!cur.shots.length)return;const rows=shotRows();
  const head=['fireball','psi','speed_kmh','cylinder_mm','r1','r2','date','shot','file','target','sector','hit','x_cm','y_cm','miss_cm','dist_to_line_cm','check'];
  const lines=[head.join(',')].concat(rows.map(r=>[cur.fireball??'',$('sPsi').value,$('sSpeed').value,$('sCyl').value,$('sR1').value,$('sR2').value,$('sDate').value,r.shot,`"${r.file.replace(/"/g,'""')}"`,r.target??'',r.sector??'',r.target&&r.sector?(r.hit?'YES':'NO'):'',
    r.sector?Math.round(r.x):'',r.sector?Math.round(r.y):'',r.miss!=null?Math.round(r.miss):'',r.sector?Math.round(r.line):'',r.flag].join(',')));saveFile(fname('csv'),lines.join('\n'));};
$('imgBtn').onclick=()=>{if(!cur.base)return;const cv=composeClean();const pts=cur.shots.map((sh,i)=>sh.pos?{n:i+1,x:sh.pos.x,y:sh.pos.y}:null).filter(Boolean);
  overlay(cv.getContext('2d'),G,cv.width,cv.height,pts,{grid:$('tGrid').checked,nums:$('tNums').checked});cv.toBlob(b=>saveFile(fname('jpg'),b),'image/jpeg',.9);};

/* ---------- events ---------- */
document.querySelectorAll('#fbs .fb').forEach(b=>b.onclick=()=>{cur.fireball=+b.dataset.fb;document.querySelectorAll('#fbs .fb').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));cur.dirty=true;render();});
['sDate','sOp','sNotes','sPsi','sSpeed','sCyl','sR1','sR2'].forEach(id=>$(id).addEventListener('input',()=>{cur.dirty=true;render();}));
$('addBtn').onclick=()=>$('fileIn').click();
$('fileIn').onchange=e=>{if(e.target.files.length)loadFiles(e.target.files);e.target.value='';};
let dragN=0;
addEventListener('dragenter',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')&&(!$('viewS').hidden||(ed&&!$('viewH').hidden))){dragN++;$('drop').hidden=false;}});
addEventListener('dragleave',()=>{dragN=Math.max(0,dragN-1);if(!dragN)$('drop').hidden=true;});
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',e=>{e.preventDefault();dragN=0;$('drop').hidden=true;if(e.dataTransfer.files.length){if(ed&&!$('viewH').hidden)loadEditShots(e.dataTransfer.files);else if(gate())loadFiles(e.dataTransfer.files);else $('gateMsg').scrollIntoView({block:'center'});}});
['tNums','tGrid'].forEach(id=>$(id).addEventListener('change',render));
$('saveBtn').onclick=saveSession;
$('sgrid').addEventListener('click',e=>{const b=e.target.closest('button.dot');if(!b)return;openInspector(+b.dataset.i);$('inspector').scrollIntoView({behavior:'smooth',block:'start'});});
$('newBtn').onclick=()=>{if($('newBtn').dataset.armed!=='1'&&cur.shots.length&&cur.dirty){$('newBtn').dataset.armed='1';$('newBtn').textContent='Discard unsaved session?';setTimeout(()=>{$('newBtn').dataset.armed='';$('newBtn').textContent='New session';},4000);return;}
  $('newBtn').dataset.armed='';$('newBtn').textContent='New session';Object.assign(cur,{fireball:null,plan:PLAN.slice(),shots:[],base:null,savedId:null,savedImg:null,dirty:false});sel=-1;$('inspector').hidden=true;
  document.querySelectorAll('#fbs .fb').forEach(x=>x.setAttribute('aria-pressed','false'));$('sNotes').value='';$('sDate').value=new Date().toISOString().slice(0,10);renderPlan();render();scrollTo({top:0});};
$('inspCv').addEventListener('click',async e=>{const sh=cur.shots[sel];if(!sh)return;const[x,y]=cvPt(e.target,e);const rs=cur.shots.filter(s=>s.pos).map(s=>s.pos.r).sort((a,b)=>a-b),r=rs.length?rs[rs.length>>1]:sh.W/85;
  const near=sh.auto.find(c=>Math.hypot(c.x-x,c.y-y)<c.r*1.5);sh.pos=near?{...near}:{x,y,r};sh.manual=true;const bmp=await createImageBitmap(sh.file);sh.crop=makeCrop(bmp,sh.pos);bmp.close&&bmp.close();cur.dirty=true;render();drawInspector();});
$('noBallBtn').onclick=()=>{const sh=cur.shots[sel];if(!sh)return;sh.pos=null;sh.crop=null;sh.manual=true;cur.dirty=true;render();drawInspector();};
$('autoBtn').onclick=async()=>{const sh=cur.shots[sel];if(!sh)return;sh.manual=false;sh.pos=sh.auto[0]||null;if(sh.pos){const bmp=await createImageBitmap(sh.file);sh.crop=makeCrop(bmp,sh.pos);bmp.close&&bmp.close();}else sh.crop=null;cur.dirty=true;render();drawInspector();};
$('prevBtn').onclick=()=>{if(sel>0)openInspector(sel-1)};$('nextBtn').onclick=()=>{if(sel<cur.shots.length-1)openInspector(sel+1)};
$('closeBtn').onclick=()=>{sel=-1;$('inspector').hidden=true;render();};
addEventListener('keydown',e=>{if(sel<0||$('viewS').hidden||/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;if(e.key==='ArrowRight')$('nextBtn').click();if(e.key==='ArrowLeft')$('prevBtn').click();if(e.key==='Escape')$('closeBtn').click();});
function showTab(h){const hist=h==='history';$('viewS').hidden=hist;$('viewH').hidden=!hist;$('tabS').setAttribute('aria-selected',String(!hist));$('tabH').setAttribute('aria-selected',String(hist));if(hist){renderHistory();renderCompare();}}
$('tabS').onclick=()=>{location.hash='';showTab('');};$('tabH').onclick=()=>{location.hash='history';showTab('history');};
addEventListener('hashchange',()=>showTab(location.hash.slice(1)));
document.querySelectorAll('#fbFilter button').forEach(b=>b.onclick=()=>{filt=b.dataset.f;document.querySelectorAll('#fbFilter button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderHistory();});
$('metric').onchange=()=>renderChart(shownSessions());$('cNums').onchange=renderCompare;
document.querySelectorAll('#eFbs .fb').forEach(b=>b.onclick=()=>{if(!ed)return;ed.fireball=+b.dataset.fb;ed.dirty=true;editGate();});
eMeta.forEach(([id])=>$(id).addEventListener('input',()=>{if(!ed)return;ed.dirty=true;editGate();}));
$('eNums').onchange=renderEdit;
$('eSgrid').addEventListener('click',e=>{const b=e.target.closest('button.dot');if(!b||!ed)return;ed.sel=+b.dataset.i;renderEdit();$(ed.shots[ed.sel].img?'eInsp':'eCv').scrollIntoView({behavior:'smooth',block:'nearest'});});
$('eBody').addEventListener('click',e=>{if(!ed)return;const nb=e.target.closest('button[data-nb]');
  if(nb){setEditPos(+nb.dataset.nb,null,'excluded');return;}
  const tr=e.target.closest('tr[data-i]');if(tr&&e.target.tagName!=='SELECT'){ed.sel=+tr.dataset.i;renderEdit();}});
$('eBody').addEventListener('change',e=>{if(!ed||e.target.tagName!=='SELECT')return;ed.shots[+e.target.dataset.i].target=e.target.value?+e.target.value:null;ed.dirty=true;renderEdit();});
$('eCv').addEventListener('click',e=>{if(!ed||$('eGridEdit').checked)return;if(ed.sel<0){$('eHint').textContent='Pick a shot first: a dot in the sector cards or a row in the shot list.';return;}
  const[x,y]=cvPt(e.target,e);setEditPos(ed.sel,{x,y},'manual');});
$('eCancel').onclick=()=>{if(ed&&ed.dirty&&$('eCancel').dataset.armed!=='1'){$('eCancel').dataset.armed='1';$('eCancel').textContent='Discard changes?';setTimeout(()=>{$('eCancel').dataset.armed='';$('eCancel').textContent='Cancel';},4000);return;}closeEdit();};
$('eSave').onclick=saveEdit;
$('eGridEdit').onchange=renderEdit;
const setEditGrid=g=>{if(!ed)return;ed.grid=gridCopy(g);ed.gridChanged=true;ed.dirty=true;renderEdit();};
$('eGridShared').onclick=()=>setEditGrid(G);
$('eGridReset').onclick=()=>{if(!ed)return;ed.grid=gridCopy(ed.src.grid||G);ed.gridChanged=false;renderEdit();};
let eDrag=-1;
$('eCv').addEventListener('pointerdown',e=>{if(!ed||!$('eGridEdit').checked)return;const cv=e.target,[x,y]=cvPt(cv,e),g=geo(ed.grid,cv.width,cv.height);let best=-1,bd=cv.width/25;
  g.px.forEach(([px,py],i)=>{const d=Math.hypot(px-x,py-y);if(d<bd){bd=d;best=i}});if(best>=0){eDrag=best;cv.setPointerCapture(e.pointerId);}});
$('eCv').addEventListener('pointermove',e=>{if(eDrag<0||!ed)return;const cv=e.target,[x,y]=cvPt(cv,e);ed.grid.corners[eDrag]=[x/cv.width,y/cv.height];ed.gridChanged=true;ed.dirty=true;drawEdit(editRows());});
$('eCv').addEventListener('pointerup',()=>{if(eDrag<0)return;eDrag=-1;renderEdit();});
$('eLoadBtn').onclick=()=>$('eFileIn').click();
$('eFileIn').onchange=e=>{if(e.target.files.length)loadEditShots(e.target.files);e.target.value='';};
$('eInspCv').addEventListener('click',e=>{const q=ed&&ed.shots[ed.sel];if(!q||!q.img)return;const[x,y]=cvPt(e.target,e);
  const near=(q.auto||[]).find(c=>Math.hypot(c.x-x,c.y-y)<c.r*1.5);setEditPos(ed.sel,near||{x,y},'manual');});
$('eiNoBall').onclick=()=>{if(ed&&ed.sel>=0)setEditPos(ed.sel,null,'excluded');};
$('eiAuto').onclick=()=>{const q=ed&&ed.shots[ed.sel];if(!q||!q.auto)return;setEditPos(ed.sel,q.auto[0]||null,q.auto.length>1?'multiple':q.auto.length?'ok':'no ball');};
$('eiPrev').onclick=()=>{if(ed&&ed.sel>0){ed.sel--;renderEdit();}};$('eiNext').onclick=()=>{if(ed&&ed.sel<ed.shots.length-1){ed.sel++;renderEdit();}};
$('eiClose').onclick=()=>{if(!ed)return;ed.sel=-1;renderEdit();};
addEventListener('keydown',e=>{if(!ed||ed.sel<0||$('eInsp').hidden||$('viewH').hidden||/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))return;if(e.key==='ArrowRight')$('eiNext').click();if(e.key==='ArrowLeft')$('eiPrev').click();if(e.key==='Escape')$('eiClose').click();});

/* ---------- start ---------- */
$('sDate').value=new Date().toISOString().slice(0,10);
loadGrid(ls.get('pa.grid',null));lastGridDoc=ls.get('pa.grid',null);renderPlan();render();showTab(location.hash.slice(1));
/* ---------- storage: Vercel API (passcode protected) ---------- */
let pass=ls.get('pa.pass','');
const api={
  raw(method,path,body){return fetch(path,{method,headers:{'content-type':'application/json','x-passcode':pass},body:body===undefined?undefined:JSON.stringify(body)});},
  async json(method,path,body){const r=await this.raw(method,path,body);if(r.status===401){showLogin('Passcode is wrong or has changed.');throw new Error('passcode needed');}
    const j=await r.json().catch(()=>null);if(!r.ok)throw new Error((j&&j.error)||('HTTP '+r.status));return j;}
};
const listeners=[];
async function refreshSessions(){try{const docs=await api.json('GET','/api/sessions');const snap={docs:docs.map(d=>({id:d._id,data:()=>d}))};listeners.forEach(f=>f(snap));$('storeBanner').hidden=true;}
  catch(e){if(e.message!=='passcode needed'){$('storeBanner').hidden=false;$('storeBanner').textContent='History could not be loaded: '+e.message;}}}
const dbShim={
  collection(){return{orderBy(){return this},limit(){return this},
    onSnapshot(cb){listeners.push(cb);refreshSessions();return()=>{}},
    doc(id){return{set:async d=>{await api.json('PUT','/api/sessions?id='+encodeURIComponent(id),d);refreshSessions();},
                   delete:async()=>{await api.json('DELETE','/api/sessions?id='+encodeURIComponent(id));refreshSessions();}}}}},
  doc(){return{onSnapshot(cb){api.json('GET','/api/grid').then(g=>cb({exists:!!g,data:()=>g})).catch(()=>{});return()=>{}},
               set:d=>api.json('PUT','/api/grid',d)}}
};
const assetsShim={
  async upload(blob){const b64=await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(String(fr.result).split(',')[1]);fr.onerror=no;fr.readAsDataURL(blob);});
    return api.json('POST','/api/image',{data:b64});},
  delete(id){return api.json('DELETE','/api/image?id='+encodeURIComponent(id));}
};
function showLogin(msg){$('loginMsg').textContent=msg||'';$('login').hidden=false;$('app').hidden=true;setTimeout(()=>$('passIn').focus(),0);}
async function tryLogin(p){pass=p;const r=await api.raw('GET','/api/grid').catch(()=>null);
  if(!r||r.status===401){showLogin(r?'That passcode is not right.':'Cannot reach the server. Check the connection.');return false;}
  ls.set('pa.pass',p);$('login').hidden=true;$('app').hidden=false;return true;}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();if(await tryLogin($('passIn').value.trim()))boot();});
$('logoutBtn').onclick=()=>{ls.set('pa.pass','');pass='';showLogin('');};
let booted=false;
function boot(){if(booted){refreshSessions();return;}booted=true;db=dbShim;assets=assetsShim;
  db.doc('config/grid').onSnapshot(s=>{if(s.exists){lastGridDoc=s.data();if(G.locked&&!gridDirty){loadGrid(lastGridDoc);ls.set('pa.grid',lastGridDoc);render();}}});
  db.collection('sessions').orderBy('createdAt','desc').limit(1000).onSnapshot(snap=>{sessions=snap.docs.map(x=>{const d={_id:x.id,...x.data()};d.stats={...(d.stats||{}),perfect:perfectOf(d)};return d;});
    picked=picked.filter(id=>sessions.some(s=>s._id===id));if(!$('viewH').hidden){renderHistory();renderCompare();}});
  render();}
$('tabH').addEventListener('click',()=>{if(booted)refreshSessions();});
(async()=>{if(pass&&await tryLogin(pass))boot();else showLogin('');})();
