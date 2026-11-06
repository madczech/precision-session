/* ---------- video: finds every shot in a session video, in this browser (the video is not uploaded) ----------
   Same method as the tested script (precision-video-test, 100 of 100 shots on 183mm-fb4-7psi-2sessions.mp4):
   1. launch: the goal is still, then something starts moving
   2. the ball is followed against the empty goal just before the launch; nothing ball-like flying away = not a shot
   3. impact: 3 frames before the net starts moving, or the last frame before the ball suddenly shrinks (post) */

/* --- MP4 / MOV index: where every frame is in the file (the index may sit at the end, as camera files do) --- */
const fourcc=(v,o)=>String.fromCharCode(v.getUint8(o),v.getUint8(o+1),v.getUint8(o+2),v.getUint8(o+3));
function boxes(v,s,e){const out=[];while(s+8<=e){let n=v.getUint32(s),h=8;const t=fourcc(v,s+4);
  if(n===1){n=Number(v.getBigUint64(s+8));h=16;}else if(n===0)n=e-s;if(n<h)break;out.push({t,s:s+h,e:Math.min(s+n,e),at:s});s+=n;}return out;}
const kid=(v,b,t)=>b&&boxes(v,b.s,b.e).find(x=>x.t===t);
function codecOf(v,entry,cfg){const b=i=>v.getUint8(cfg.s+i),h=x=>x.toString(16).padStart(2,'0');
  if(cfg.t==='avcC')return`avc1.${h(b(1))}${h(b(2))}${h(b(3))}`;
  // hvcC: profile space/tier/profile, compatibility flags (bit-reversed), level, constraint bytes
  const p=b(1);let c=v.getUint32(cfg.s+2),r=0;for(let i=0;i<32;i++){r=(r<<1)|(c&1);c>>>=1;}
  const con=[6,7,8,9,10,11].map(b);while(con.length&&!con[con.length-1])con.pop();
  return`${entry}.${['','A','B','C'][p>>6]}${p&31}.${(r>>>0).toString(16)}.${p&32?'H':'L'}${b(12)}`+con.map(x=>'.'+x.toString(16)).join('');}
async function mp4Index(file){const rd=async(a,b)=>new DataView(await file.slice(a,b).arrayBuffer());let moov=null;
  for(let p=0;p+8<=file.size;){const v=await rd(p,Math.min(p+16,file.size));let n=v.getUint32(0);const t=fourcc(v,4);
    if(n===1)n=Number(v.getBigUint64(8));else if(n===0)n=file.size-p;if(n<8)break;
    if(t==='moov')moov=await rd(p,p+n);if(t==='moof')throw new Error('This video is in a streaming format (fragmented MP4) that cannot be read yet.');p+=n;}
  if(!moov)throw new Error('Not an MP4 / MOV video, or the file is incomplete.');
  const v=moov;
  for(const trak of boxes(v,8,v.byteLength).filter(x=>x.t==='trak')){const mdia=kid(v,trak,'mdia'),hdlr=kid(v,mdia,'hdlr');
    if(!hdlr||fourcc(v,hdlr.s+8)!=='vide')continue;
    const mdhd=kid(v,mdia,'mdhd'),scale=v.getUint8(mdhd.s)===1?v.getUint32(mdhd.s+20):v.getUint32(mdhd.s+12);
    const stbl=kid(v,kid(v,mdia,'minf'),'stbl'),ent=boxes(v,kid(v,stbl,'stsd').s+8,kid(v,stbl,'stsd').e)[0];
    const W=v.getUint16(ent.s+24),H=v.getUint16(ent.s+26),cfg=boxes(v,ent.s+78,ent.e).find(x=>/^(avcC|hvcC)$/.test(x.t));
    if(!cfg)throw new Error(`Video codec ${ent.t} is not supported (use H.264 or HEVC).`);
    const u32=(b,i)=>v.getUint32(b.s+i),list=(t,w)=>{const b=kid(v,stbl,t);if(!b)return null;const n=u32(b,4),a=[];for(let i=0;i<n*w;i++)a.push(u32(b,8+4*i));return a;};
    const stsz=kid(v,stbl,'stsz'),fixed=u32(stsz,4),N=u32(stsz,8),size=i=>fixed||u32(stsz,12+4*i);
    const co64=kid(v,stbl,'co64'),stco=kid(v,stbl,'stco'),nChunk=u32(co64||stco,4),chunkAt=c=>co64?Number(v.getBigUint64(co64.s+8+8*c)):u32(stco,8+4*c);
    const stsc=list('stsc',3),stts=list('stts',2),ctts=kid(v,stbl,'ctts'),sync=new Set(list('stss',1)||[]),allSync=!kid(v,stbl,'stss');
    const S=new Array(N);let k=0,dts=0;
    for(let c=0,e=0;c<nChunk&&k<N;c++){while(e+3<stsc.length&&stsc[e+3]-1<=c)e+=3;let off=chunkAt(c);
      for(let j=0;j<stsc[e+1]&&k<N;j++,k++){const n=size(k);S[k]={off,n,key:allSync||sync.has(k+1)};off+=n;}}
    for(let e=0,i=0;e<stts.length;e+=2)for(let j=0;j<stts[e];j++,i++)if(S[i]){S[i].dts=dts;dts+=stts[e+1];}
    if(ctts){const n=u32(ctts,4),signed=v.getUint8(ctts.s)===1;for(let e=0,i=0;e<n;e++){const cnt=u32(ctts,8+8*e),o=signed?v.getInt32(ctts.s+12+8*e):u32(ctts,12+8*e);for(let j=0;j<cnt;j++,i++)if(S[i])S[i].cts=S[i].dts+o;}}
    S.forEach(s=>{s.cts??=s.dts;s.t=Math.round(1e6*s.cts/scale);});
    return{W,H,samples:S,fps:N/(dts/scale),codec:codecOf(v,ent.t,cfg),description:new Uint8Array(v.buffer,v.byteOffset+cfg.s,cfg.e-cfg.s)};}
  throw new Error('The file has no video track.');}

/* --- decoding: every frame, in order, through the browser's own decoder --- */
async function decodeAll(file,ix,onFrame,stop,from=0,to=Infinity){
  if(!('VideoDecoder' in self))throw new Error('This browser cannot read video frames. Use a current Chrome, Edge or Safari.');
  const cfg={codec:ix.codec,description:ix.description,codedWidth:ix.W,codedHeight:ix.H};
  if(!(await VideoDecoder.isConfigSupported(cfg)).supported)throw new Error(`This browser cannot decode this video (${ix.codec}).`);
  let err=null;const dec=new VideoDecoder({output:f=>{try{if(!err)onFrame(f);}catch(e){err=e;}finally{f.close();}},error:e=>{err=e;}});
  dec.configure(cfg);const S=ix.samples;let i=from;while(i>0&&!S[i].key)i--;const end=Math.min(S.length,to);
  for(;i<end&&!err&&!stop();){let j=i,lo=S[i].off,hi=lo+S[i].n;               // one read for up to 8 MB of frames
    while(j+1<end&&S[j+1].off>=lo&&S[j+1].off+S[j+1].n-lo<8<<20){j++;hi=Math.max(hi,S[j].off+S[j].n);}
    const buf=new Uint8Array(await file.slice(lo,hi).arrayBuffer());
    for(let k=i;k<=j;k++){const s=S[k];dec.decode(new EncodedVideoChunk({type:s.key?'key':'delta',timestamp:s.t,data:buf.subarray(s.off-lo,s.off-lo+s.n)}));}
    while(dec.decodeQueueSize>24&&!err)await new Promise(r=>{dec.addEventListener('dequeue',r,{once:true});setTimeout(r,5);});
    i=j+1;}
  if(!err&&!stop())await dec.flush().catch(e=>{err=e;});dec.close();if(err)throw err;}

/* --- image helpers on the goal crop --- */
// grey, then 5x5 Gaussian [1 4 6 4 1]/16 (edges mirrored)
function greyBlur(d,w,h){const g=new Uint8Array(w*h),t=new Uint16Array(w*h),o=new Uint8Array(w*h),m=(i,n)=>i<0?-i:i>=n?2*n-2-i:i;
  for(let i=0;i<w*h;i++)g[i]=Math.round(.299*d[i*4]+.587*d[i*4+1]+.114*d[i*4+2]);
  for(let y=0;y<h;y++){const r=y*w;for(let x=0;x<w;x++)t[r+x]=g[r+m(x-2,w)]+4*g[r+m(x-1,w)]+6*g[r+x]+4*g[r+m(x+1,w)]+g[r+m(x+2,w)];}
  for(let y=0;y<h;y++){const a=m(y-2,h)*w,b=m(y-1,h)*w,c=y*w,e=m(y+1,h)*w,f=m(y+2,h)*w;for(let x=0;x<w;x++)o[c+x]=(t[a+x]+4*t[b+x]+6*t[c+x]+4*t[e+x]+t[f+x]+128)>>8;}
  return o;}
// erode (all) or dilate (any) with a k-wide line, along rows (step 1) or columns (step w); the window is cut at the edges
function morph(src,w,h,k,all,alongRows){const out=new Uint8Array(w*h),r=k>>1,n=alongRows?w:h,lines=alongRows?h:w,st=alongRows?1:w,ls=alongRows?w:1;
  for(let l=0;l<lines;l++){const b=l*ls;let c=0;for(let i=0;i<Math.min(r,n);i++)c+=src[b+i*st];
    for(let i=0;i<n;i++){if(i+r<n)c+=src[b+(i+r)*st];if(i-r-1>=0)c-=src[b+(i-r-1)*st];const win=Math.min(n-1,i+r)-Math.max(0,i-r)+1;out[b+i*st]=all?(c===win?1:0):(c>0?1:0);}}
  return out;}
// the ball = the largest round, ball-sized patch that differs from the empty goal
function findBall(bg,g,w,h,P){const mk=new Uint8Array(w*h);for(let i=0;i<w*h;i++)mk[i]=Math.abs(g[i]-bg[i])>40?1:0;
  const k=P.kern,op=morph(morph(morph(morph(mk,w,h,k,true,true),w,h,k,true,false),w,h,k,false,true),w,h,k,false,false),lab=new Int32Array(w*h),st=[];let best=null,id=0;
  for(let i=0;i<w*h;i++){if(!op[i]||lab[i])continue;id++;lab[i]=id;st.push(i);let a=0,sx=0,sy=0,x0=1e9,x1=-1,y0=1e9,y1=-1;
    while(st.length){const j=st.pop(),x=j%w,y=(j/w)|0;a++;sx+=x;sy+=y;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const q=yy*w+xx;if(op[q]&&!lab[q]){lab[q]=id;st.push(q);}}}
    const bw=x1-x0+1,bh=y1-y0+1,big=Math.max(bw,bh);
    if(a<P.aMin||a>P.aMax||big>1.6*Math.min(bw,bh)||a/(Math.PI*(big/2)**2)<.5)continue;
    if(!best||a>best.a)best={x:sx/a+P.cx,y:sy/a+P.cy,a};}
  return best;}

/* --- the shot finder: one call per decoded frame, in order --- */
function shotFinder(W,H,grid,nFrames,onShot,dbg=null,i0=0){
  const xs=grid.corners.map(c=>c[0]*W),ys=grid.corners.map(c=>c[1]*H),gx0=Math.min(...xs),gx1=Math.max(...xs),gy0=Math.min(...ys),gy1=Math.max(...ys);
  const SW=480,SH=Math.round(480*H/W),s=SW/W,cl=(v,a,b)=>Math.max(a,Math.min(b,Math.round(v)));
  // motion: the goal mouth at 1/4 size; tracking: the goal mouth plus a margin at full size
  const mx0=cl((gx0-.01*W)*s,0,SW-1),mx1=cl((gx1+.01*W)*s,1,SW),my0=cl((gy0-.02*H)*s,0,SH-1),my1=cl(gy1*s,1,SH),mw=mx1-mx0,mh=my1-my0;
  const cx=cl(gx0-.02*W,0,W-1),cy=cl(gy0-.02*H,0,H-1),cw=cl(gx1+.02*W,1,W)-cx,ch=cl(gy1+.02*H,1,H)-cy,f2=(W/1920)**2;
  const P={cx,cy,f2,kern:Math.max(3,Math.round(5*W/1920)|1),aMin:250*f2,aMax:6000*f2},MS=mw*mh/61625;   // pixel counts were tuned at 1920x1080
  const Q=30*MS,R=12,ring=[],ts=new Float64Array(R),half=new OffscreenCanvas(SW*2,SH*2),small=new OffscreenCanvas(SW,SH);
  for(let k=0;k<R;k++)ring.push(new OffscreenCanvas(W,H));
  const rc=ring.map(c=>c.getContext('2d')),hc=half.getContext('2d'),sc=small.getContext('2d');
  const m=new Float32Array(nFrames+8),run=new Int32Array(nFrames+8);let i=i0-1,prev=null,next=Math.max(100,i0+20),act=null;if(dbg)dbg.m=m;
  const crop=k=>greyBlur(rc[k%R].getImageData(cx,cy,cw,ch).data,cw,ch);
  const snap=k=>{const c=new OffscreenCanvas(W,H);c.getContext('2d').drawImage(ring[k%R],0,0);return c.convertToBlob({type:'image/jpeg',quality:.92});};
  function decide(a,k){                                 // impact rules, as in shots.py
    if(k>=a.o+20&&a.drop==null){const p=a.tr.get(k),q=a.tr.get(k-1);if(p&&q&&p.a<.6*q.a){a.drop=k-1;a.dropImg=snap(k-1);}}
    if(a.imp==null&&k>=a.o+15&&k<a.o+45){const w=Array.from(m.subarray(k-6,k)).sort((x,y)=>x-y),base=(w[2]+w[3])/2;
      if(m[k]>Math.max(1.8*base,base+120*MS)){if(a.drop!=null&&a.drop+1<=k-3){a.imp=a.drop;a.img=a.dropImg;a.check=true;}
        else{let j=k-3;while(!a.tr.has(j)&&j>a.o+15&&k-j<R-1)j--;a.check=j!==k-3;a.imp=j;a.img=snap(j);}}}
    if(k<a.o+45)return;
    const ar=(f,t)=>{const r=[];for(let j=f;j<t;j++)if(a.tr.has(j))r.push(a.tr.get(j).a);return r;},early=ar(a.o+8,a.o+15),late=ar(a.o+19,a.o+23);
    if(a.imp==null&&a.drop!=null){a.imp=a.drop;a.img=a.dropImg;a.check=true;}
    const med=v=>{const w=v.slice().sort((x,y)=>x-y),h=w.length>>1;return w.length%2?w[h]:(w[h-1]+w[h])/2;};
    // ball-sized when close (real shots: 2300+ px, rolled/thrown balls and people: under 1200) and shrinking (real: 17%+)
    const ok=a.imp!=null&&a.tr.has(a.imp)&&early.length>=4&&late.length>=2&&med(early)>=1500*P.f2&&med(early)>1.08*med(late);
    if(dbg)dbg.cands.push({o:a.o,imp:a.imp,drop:a.drop,ok,early,late,tr:[...a.tr].map(([k,b])=>[k,Math.round(b.x),Math.round(b.y),b.a])});
    if(ok){const b=a.tr.get(a.imp);onShot({frame:a.imp,t:a.ts.get(a.imp),x:b.x,y:b.y,r:Math.sqrt(b.a/Math.PI),check:!!a.check,img:a.img});}
    act=null;}
  return function frame(vf){i++;const sl=i%R;rc[sl].drawImage(vf,0,0,W,H);ts[sl]=vf.timestamp;
    hc.drawImage(ring[sl],0,0,SW*2,SH*2);sc.drawImage(half,0,0,SW,SH);   // two exact halvings = 4x4 average
    const d=sc.getImageData(mx0,my0,mw,mh).data,g=new Uint8Array(mw*mh);for(let k=0;k<mw*mh;k++)g[k]=Math.round(.299*d[k*4]+.587*d[k*4+1]+.114*d[k*4+2]);
    if(prev){let n=0;for(let k=0;k<g.length;k++)if(Math.abs(g[k]-prev[k])>25)n++;m[i]=n;}prev=g;run[i]=m[i]<Q?(i?run[i-1]:0)+1:0;
    const o=i-5;                                      // launch: still for 12+ frames, then 4 of the next 6 frames clearly moving
    if(!act&&o>=next&&run[o-1]>=12&&m[o]>=Q){let c=0;for(let k=o;k<=i;k++)if(m[k]>100*MS)c++;
      if(c>=4){act={o,bg:crop(o-4),tr:new Map(),ts:new Map()};next=o+150;}}
    if(act&&i>=act.o+8){const b=findBall(act.bg,crop(i),cw,ch,P);if(b)act.tr.set(i,b);act.ts.set(i,vf.timestamp);decide(act,i);}};}

/* --- the whole job: video file -> sessions of shots (files the Session tab can load like screenshots) --- */
// dbg (testing only): {from, to} analyses part of the video and collects every launch candidate
async function analyseVideo(file,grid,progress,stop,dbg=null){const ix=await mp4Index(file),N=ix.samples.length,shots=[],t0=performance.now();let n=0,last=0;
  let from=0;if(dbg){from=dbg.from||0;while(from>0&&!ix.samples[from].key)from--;dbg.cands=[];}
  const frame=shotFinder(ix.W,ix.H,grid,N,s=>shots.push(s),dbg,from);
  await decodeAll(file,ix,vf=>{frame(vf);n++;const now=performance.now();if(now-last>250){last=now;progress(n,N,shots.length,(now-t0)/1000);}},stop,from,dbg?.to);
  if(stop())return null;
  const base=file.name.replace(/\.[^.]+$/,''),mmss=us=>{const s=Math.round(us/1e6);return`${String(Math.floor(s/60)).padStart(2,'0')}-${String(s%60).padStart(2,'0')}`;};
  const sessions=[];shots.forEach((s,k)=>{if(!k||s.t-shots[k-1].t>45e6)sessions.push([]);sessions[sessions.length-1].push(s);});   // a pause over 45 s starts a new session
  for(const[si,list]of sessions.entries())for(const[k,s]of list.entries()){
    s.name=`${base}_S${si+1}-${String(k+1).padStart(2,'0')}_${mmss(s.t)}.jpg`;s.file=new File([await s.img],s.name,{type:'image/jpeg'});delete s.img;}
  return{sessions,W:ix.W,H:ix.H,frames:n,fps:ix.fps,seconds:(performance.now()-t0)/1000};}

/* --- runs as a worker (new Worker('/video.js')), so it keeps full speed when the window is in the background --- */
if(typeof WorkerGlobalScope!=='undefined'&&self instanceof WorkerGlobalScope)self.onmessage=async e=>{
  try{const res=await analyseVideo(e.data.file,e.data.grid,(n,N,k,s)=>postMessage({progress:[n,N,k,s]}),()=>false);postMessage({done:res});}
  catch(err){postMessage({error:String(err&&err.message||err)});}};
