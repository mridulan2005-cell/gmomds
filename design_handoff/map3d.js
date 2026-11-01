(function(){
if (customElements.get('dadi-map3d')) return;
const DADI='#2F5FD0', ANU='#E4572E', INK='#3d2b22', DEPTH=6, BT=2.4, STEP=900;
const SLOTS=[[120,110],[245,100],[370,110],[90,205],[200,212],[310,205],[420,200]];
const MPOS=[[-380,-250],[330,-180],[-330,210],[380,280]];
let LIBP=null;
function lib(){ return LIBP||(LIBP=Promise.all([
  import('https://esm.sh/three@0.160.0'),
  import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
  import('https://esm.sh/three@0.160.0/examples/jsm/loaders/SVGLoader.js')
]).then(([T,O,S])=>({T,OrbitControls:O.OrbitControls,SVGLoader:S.SVGLoader}))); }
function rnd(seed){ let s=(seed*7919)%233280; return ()=>{ s=(s*9301+49297)%233280; return s/233280; }; }
const easeBack=k=>{const c=1.6;return 1+(c+1)*Math.pow(k-1,3)+c*Math.pow(k-1,2);};
function shade(hex,f=.78){ const n=parseInt(hex.slice(1),16); const r=Math.round(((n>>16)&255)*f),g=Math.round(((n>>8)&255)*f),b=Math.round((n&255)*f); return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1); }
const now=()=>performance.now()/1000;

class DadiMap extends HTMLElement{
  set config(v){ this._cfg=v; this.update(); }
  get config(){ return this._cfg; }
  static get observedAttributes(){ return ['config']; }
  attributeChangedCallback(n,o,v){ this._cfg=v; this.update(); }
  connectedCallback(){ Object.assign(this.style,{display:'block',width:'100%',height:'100%',position:'relative'}); if(!this.started){ this.started=true; this.setup(); } }
  disconnectedCallback(){ cancelAnimationFrame(this.raf); if(this.ro) this.ro.disconnect(); if(this.renderer){ this.renderer.dispose(); this.renderer.domElement.remove(); } this.started=false; this.ready=false; this.lastStr=null; this.mode=null; }
  update(){ if(!this.ready) return; const raw=this._cfg??this.getAttribute('config'); if(!raw) return; const str=typeof raw==='string'?raw:JSON.stringify(raw); if(str===this.lastStr) return; this.lastStr=str; try{ this.build(JSON.parse(str)); }catch(e){ console.error(e); } }
  async setup(){
    const L=await lib(); if(!this.started) return;
    try{ await document.fonts.load('800 40px Urbanist'); }catch(e){}
    this.L=L; const T=L.T; this.T=T;
    const r=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true}); r.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    r.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none;';
    this.appendChild(r.domElement); this.renderer=r;
    this.scene=new T.Scene(); this.root=new T.Group(); this.scene.add(this.root);
    this.scene.add(new T.HemisphereLight(0xffffff,0xf1d9a8,1.6));
    const dl=new T.DirectionalLight(0xffffff,1.6); dl.position.set(-400,900,700); this.scene.add(dl);
    this.camera=new T.PerspectiveCamera(30,1.6,1,30000);
    const c=new L.OrbitControls(this.camera,r.domElement); c.enableDamping=true; c.dampingFactor=.08; c.enablePan=false; c.minPolarAngle=.3; c.maxPolarAngle=1.32; c.rotateSpeed=.6; this.controls=c;
    const gm=new T.DataTexture(new Uint8Array([120,195,255]),3,1,T.RedFormat); gm.minFilter=gm.magFilter=T.NearestFilter; gm.needsUpdate=true; this.grad=gm;
    this.mats={}; this.geos={}; this.items=[]; this.tweens=[]; this.anims=[]; this.qs=[]; this.pickables=[];
    this.stackY=0; this.stackTarget=0;
    this.ro=new ResizeObserver(()=>this.resize()); this.ro.observe(this); this.resize();
    const el=r.domElement; let down=null;
    el.addEventListener('pointerdown',e=>{ down={x:e.clientX,y:e.clientY,sy:this.stackTarget,moved:false}; });
    el.addEventListener('pointermove',e=>{ if(!down) return; const dx=e.clientX-down.x,dy=e.clientY-down.y; if(Math.hypot(dx,dy)>6) down.moved=true;
      if(this.mode==='stack'){ const k=this.clientHeight/(el.getBoundingClientRect().height||1); this.stackTarget=this.clampStack(down.sy+dy*k*2.4); } });
    el.addEventListener('pointerup',e=>{ if(down&&!down.moved) this.pick(e); down=null; });
    el.addEventListener('pointerleave',()=>{ down=null; });
    el.addEventListener('wheel',e=>{ if(this.mode!=='stack') return; e.preventDefault(); this.stackTarget=this.clampStack(this.stackTarget-e.deltaY*1.4); },{passive:false});
    this.clock=new T.Clock(); this.ready=true; this.update(); this.loop();
  }
  clampStack(v){ const n=(this.cfg&&this.cfg.months)?this.cfg.months.length:1; return Math.min(0,Math.max(-(n-1)*STEP,v)); }
  resize(){ if(!this.renderer) return; const w=this.clientWidth,h=this.clientHeight; if(!w||!h) return; this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); }
  toon(color,op=1){ const k='t'+color+op; return this.mats[k]||(this.mats[k]=new this.T.MeshToonMaterial({color,gradientMap:this.grad,transparent:op<1,opacity:op,depthWrite:op>=1})); }
  basic(color,op=1){ const k='b'+color+op; return this.mats[k]||(this.mats[k]=new this.T.MeshBasicMaterial({color,transparent:op<1,opacity:op,depthWrite:op>=1})); }
  parse(d){ return new this.L.SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`).paths; }
  tube(pts,z,closed,seed,rad){
    const T=this.T,R=rnd(seed); let len=0; for(let i=1;i<pts.length;i++) len+=pts[i].distanceTo(pts[i-1]);
    if(pts.length<2||len<1.5){ const g=new T.SphereGeometry(rad*1.6,8,6); g.translate(pts[0].x,pts[0].y,z); return g; }
    const v=pts.map(p=>new T.Vector3(p.x+(R()-.5)*1.2,p.y+(R()-.5)*1.2,z));
    if(closed&&v.length>2&&v[0].distanceTo(v[v.length-1])<.6) v.pop();
    if(v.length<2) v.push(v[0].clone().add(new T.Vector3(.5,0,0)));
    const curve=new T.CatmullRomCurve3(v,closed&&v.length>2,'centripetal');
    return new T.TubeGeometry(curve,Math.min(220,Math.max(10,Math.round(len*1.3))),rad,5,closed&&v.length>2);
  }
  geo(kind){
    if(this.geos[kind]) return this.geos[kind];
    const T=this.T,ic=this.icons[kind]||{f:[],s:[]},out={fills:[],a:[],b:[]};
    (ic.f||[]).forEach((d,di)=>this.parse(d).forEach(p=>{
      this.L.SVGLoader.createShapes(p).forEach(sh=>out.fills.push(new T.ExtrudeGeometry(sh,{depth:DEPTH,bevelEnabled:true,bevelThickness:BT,bevelSize:1.2,bevelSegments:3,curveSegments:14})));
      p.subPaths.forEach((sp,i)=>{ const pts=sp.getPoints(); [-BT-.3,DEPTH+BT+.3].forEach((z,zi)=>{ out.a.push(this.tube(pts,z,true,di*31+i*7+zi+1,1.15)); out.b.push(this.tube(pts,z,true,di*31+i*7+zi+57,1.15)); }); });
    }));
    (ic.s||[]).forEach((d,di)=>this.parse(d).forEach(p=>p.subPaths.forEach((sp,i)=>{ const pts=sp.getPoints(); out.a.push(this.tube(pts,DEPTH/2,false,di*13+i+3,1.5)); out.b.push(this.tube(pts,DEPTH/2,false,di*13+i+91,1.5)); })));
    return this.geos[kind]=out;
  }
  drawing(kind,owner,S,riseAt){
    const T=this.T,g=this.geo(kind),base=new T.Group(),mover=new T.Group(),sc=new T.Group(),inner=new T.Group();
    base.add(mover); mover.add(sc); sc.add(inner); inner.rotation.x=Math.PI; inner.position.set(-32,60,DEPTH/2);
    const fm=this.toon(this.colors[kind]||'#FFC93C'); g.fills.forEach(x=>inner.add(new T.Mesh(x,fm)));
    const lm=this.basic(owner==='d'?DADI:ANU),oa=new T.Group(),ob=new T.Group();
    g.a.forEach(x=>oa.add(new T.Mesh(x,lm))); g.b.forEach(x=>ob.add(new T.Mesh(x,lm))); ob.visible=false; inner.add(oa,ob);
    sc.scale.setScalar(riseAt?.0001:S/64);
    const sh=new T.Mesh(this.disc||(this.disc=new T.CircleGeometry(1,24)),this.basic(INK,.13)); sh.rotation.x=-Math.PI/2; sh.scale.setScalar(S*.3); sh.position.y=.8; base.add(sh);
    this.items.push({kind,base,mover,sc,inner,oa,ob,sh,S,ph:Math.random()*6.28,rise:riseAt}); return base;
  }
  islandGeo(shape){
    const k='i'+shape; if(this.geos[k]) return this.geos[k];
    const T=this.T,sh=this.L.SVGLoader.createShapes(this.parse(this.shapes[shape])[0])[0];
    const geo=new T.ExtrudeGeometry(sh,{depth:22,bevelEnabled:true,bevelThickness:3,bevelSize:3,bevelSegments:2,curveSegments:24}); geo.rotateX(Math.PI/2); geo.translate(-240,0,-140);
    const pts=sh.getPoints(60).map(p=>new T.Vector3(p.x-240,3.4,p.y-140));
    const curve=new T.CatmullRomCurve3(pts,true);
    const top=new T.TubeGeometry(curve,200,1.9,5,true);
    const bot=new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(p.x,-25.4,p.z)),true),200,1.6,5,true);
    const sp=curve.getSpacedPoints(120),dashes=[];
    for(let i=0;i<120;i+=2) dashes.push(new T.TubeGeometry(new T.LineCurve3(sp[i],sp[i+1]),1,2,5,false));
    return this.geos[k]={geo,top,bot,dashes};
  }
  sprite(text,o={}){
    const T=this.T,fs=o.size||56,pad=o.pill?fs*.7:fs*.2,c=document.createElement('canvas'); let x=c.getContext('2d'); const font=`800 ${fs}px Urbanist, Helvetica, sans-serif`; x.font=font;
    const tw=x.measureText(text).width; c.width=Math.ceil(tw+pad*2); c.height=Math.ceil(fs*1.7); x=c.getContext('2d'); x.font=font;
    if(o.pill){ x.fillStyle=o.bg||'#FFF3D1'; x.beginPath(); if(x.roundRect) x.roundRect(0,0,c.width,c.height,c.height/2); else x.rect(0,0,c.width,c.height); x.fill(); }
    x.fillStyle=o.color||INK; x.textAlign='center'; x.textBaseline='middle'; x.fillText(text,c.width/2,c.height/2+fs*.06);
    const tex=new T.CanvasTexture(c); tex.colorSpace=T.SRGBColorSpace; const s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
    const k=o.k||1; s.scale.set(c.width*k,c.height*k,1); s.renderOrder=10; return s;
  }
  lockSprite(k=1){
    const T=this.T,c=document.createElement('canvas'); c.width=c.height=128; const x=c.getContext('2d');
    x.fillStyle='#FFF3D1'; x.strokeStyle=INK; x.lineWidth=6; x.beginPath(); x.arc(64,64,56,0,7); x.fill(); x.stroke();
    x.lineWidth=7; x.lineCap='round'; x.beginPath(); x.moveTo(48,60); x.lineTo(48,48); x.arc(64,48,16,Math.PI,0); x.lineTo(80,60); x.stroke();
    x.fillStyle='#F26A2E'; x.beginPath(); if(x.roundRect) x.roundRect(40,58,48,36,8); else x.rect(40,58,48,36); x.fill(); x.stroke();
    const tex=new T.CanvasTexture(c); tex.colorSpace=T.SRGBColorSpace; const s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthWrite:false})); s.scale.set(90*k,90*k,1); return s;
  }
  island(p,o){
    const T=this.T,G=new T.Group(),ig=this.islandGeo(p.shape),st=p.status,t0=now();
    let top,side,line;
    if(st==='done'){
      if(o.fade){ top=new T.MeshToonMaterial({color:p.color,gradientMap:this.grad,transparent:true,opacity:0}); side=new T.MeshToonMaterial({color:shade(p.color),gradientMap:this.grad,transparent:true,opacity:0}); line=new T.MeshBasicMaterial({color:INK,transparent:true,opacity:0}); this.tweens.push({m:[top,side,line],t0,dur:2.6}); }
      else { top=this.toon(p.color); side=this.toon(shade(p.color)); line=this.basic(INK); }
    } else if(st==='current'){ top=this.toon('#ffffff',.42); side=this.toon('#ffffff',.2); }
    else { top=this.toon('#EEE7D8',.7); side=this.toon('#D8CFBC',.55); }
    const mesh=new T.Mesh(ig.geo,[top,side]); G.add(mesh);
    if(line){ G.add(new T.Mesh(ig.top,line)); G.add(new T.Mesh(ig.bot,line)); }
    if(st!=='done'||o.fade){ const dm=this.basic(st==='locked'?'#B5AA94':INK); ig.dashes.forEach(d=>G.add(new T.Mesh(d,dm))); }
    if(st==='done') this.decor(p,G,o.fade?top:null);
    if(o.pick){ mesh.userData.pick=o.pick; this.pickables.push(mesh); }
    if(st!=='locked') (p.pairs||[]).forEach((pr,j)=>{ const [u,v]=SLOTS[j]; [[pr[0],'d',-32,0],[pr[1],'a',32,10]].forEach(([k,w,du,dv],side)=>{ const rise=o.fresh===j?t0+(side?1.2:.35):0; const b=this.drawing(k,w,o.S||72,rise); b.position.set(u-240+du,3,v-140+dv); G.add(b); }); });
    if(st==='current'&&o.q){ const q=this.sprite('?',{size:150,color:'#8E7FD0'}); q.position.set(0,150,0); G.add(q); this.qs.push(q); }
    if(st==='locked'){ const l=this.lockSprite(o.lockK||1.4); l.position.set(0,70,0); G.add(l); }
    if(o.label){ const s=this.sprite(o.label,{size:46,pill:true,bg:st==='done'?INK:'#FFF3D1',color:st==='done'?'#FFF3D1':INK,k:1.25}); s.position.set(0,215,-80); G.add(s); }
    return G;
  }
  decor(p,G,fadeMat){
    const T=this.T;
    if(p.theme==='river'){ const m=fadeMat?new T.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0}):this.basic('#ffffff'); if(fadeMat) this.tweens.push({m:[m],t0:now(),dur:2.6});
      [-40,10,60].forEach((z,i)=>{ const pts=[]; for(let x=-150;x<=150;x+=10) pts.push(new T.Vector3(x,5,z+Math.sin(x/16)*6)); const w=new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts),60,2.2,5,false),m); G.add(w); this.anims.push({o:w,i}); }); }
    if(p.theme==='garden'){ const m=this.toon('#4E9F3D'); [[-170,-30],[150,-60],[-60,80],[190,60],[20,-90],[-190,50],[80,90]].forEach(([x,z])=>{ const c=new T.Mesh(this.cone||(this.cone=new T.ConeGeometry(6,16,6)),m); c.position.set(x,11,z); G.add(c); }); }
  }
  month(places,o={}){
    const T=this.T,G=new T.Group();
    places.forEach((p,i)=>{ const lbl=p.status==='done'?p.name:p.status==='current'?'This week · '+(7-(p.pairs||[]).length)+' to go':null;
      const g=this.island(p,{label:o.labels!==false?lbl:null,q:true,pick:o.pick&&p.status!=='locked'?{type:'place',pi:i}:null,lockK:1.6}); g.position.set(MPOS[i][0],0,MPOS[i][1]); G.add(g); });
    const pts=[[-760,-420],...MPOS,[760,520]].map(([x,z])=>new T.Vector3(x,-10,z));
    const curve=new T.CatmullRomCurve3(pts),n=Math.round(curve.getLength()/34),dot=this.dot||(this.dot=new T.SphereGeometry(7,10,8)),dm=this.toon('#FFC93C');
    curve.getSpacedPoints(n).forEach(pt=>{ const s=new T.Mesh(dot,dm); s.position.copy(pt); G.add(s); });
    return G;
  }
  board(m,i){
    const T=this.T,B=new T.Group(); B.userData.pick={type:'month',mi:i};
    const cream=this.toon('#FFF3D1',m.current?.35:1),edge=this.toon('#E6CF92',m.current?.3:1);
    const slab=new T.Mesh(this.slabGeo||(this.slabGeo=new T.BoxGeometry(1700,28,1300)),[edge,edge,cream,edge,edge,edge]); slab.position.y=-14; B.add(slab);
    if(m.current){ const e=new T.LineSegments(new T.EdgesGeometry(this.slabGeo),new T.LineDashedMaterial({color:INK,dashSize:24,gapSize:18})); e.computeLineDistances(); e.position.y=-14; B.add(e); }
    else { const e=new T.LineSegments(new T.EdgesGeometry(this.slabGeo),new T.LineBasicMaterial({color:INK})); e.position.y=-14; B.add(e); }
    const mg=this.month(m.places,{labels:false}); mg.scale.setScalar(.85); mg.position.y=34; B.add(mg);
    if(m.current) mg.traverse(o=>{ if(o.isMesh){ const fix=x=>{ const c=x.clone(); c.transparent=true; c.opacity=Math.min(x.opacity,.5); c.depthWrite=false; return c; }; o.material=Array.isArray(o.material)?o.material.map(fix):fix(o.material); } });
    const s=this.sprite(m.name,{size:52,pill:true,bg:m.current?'#FFF3D1':INK,color:m.current?INK:'#FFF3D1',k:1.3}); s.position.set(-990,40,0); B.add(s);
    this.pickables.push(B); return B;
  }
  build(cfg){
    this.cfg=cfg; this.icons=cfg.icons||{}; this.colors=cfg.colors||{}; this.shapes=cfg.shapes||{};
    this.root.clear(); this.items=[]; this.tweens=[]; this.anims=[]; this.qs=[]; this.pickables=[];
    if(cfg.mode==='place') this.root.add(this.island(cfg.place,{fresh:cfg.fresh,fade:cfg.fade,q:true,S:76}));
    else if(cfg.mode==='month') this.root.add(this.month(cfg.places,{pick:true}));
    else if(cfg.mode==='stack') cfg.months.forEach((m,i)=>{ const b=this.board(m,i); b.position.y=-i*STEP; this.root.add(b); });
    this.frame(cfg.mode);
  }
  frame(mode){
    if(mode===this.mode) return; this.mode=mode; const c=this.controls,cam=this.camera;
    c.enabled=mode!=='stack';
    if(mode==='place'){ c.target.set(0,50,10); cam.position.set(0,520,880); c.minDistance=600; c.maxDistance=1500; }
    if(mode==='month'){ c.target.set(0,0,20); cam.position.set(0,1450,1750); c.minDistance=1200; c.maxDistance=3200; }
    if(mode==='stack'){ this.stackY=this.stackTarget=0; }
    c.update();
  }
  pick(e){
    const T=this.T,r=this.renderer.domElement.getBoundingClientRect(),v=new T.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
    const rc=new T.Raycaster(); rc.setFromCamera(v,this.camera);
    for(const h of rc.intersectObjects(this.pickables,true)){ let o=h.object; while(o&&!o.userData.pick) o=o.parent; if(o){ if(window.__dadiMapPick) window.__dadiMapPick(o.userData.pick); return; } }
  }
  animate(it,t){
    const m=it.mover,p=t+it.ph,i=it.inner;
    switch(it.kind){
      case 'bird':{ const a=p*.55,r=55; m.position.set(Math.cos(a)*r,80+Math.sin(p*1.3)*10,Math.sin(a)*r*.6); m.rotation.y=Math.atan2(-Math.cos(a)*.6,-Math.sin(a)); i.scale.y=1-.22*Math.abs(Math.sin(t*6+it.ph)); it.sh.position.set(m.position.x,.8,m.position.z); break; }
      case 'kite': m.position.y=110+Math.sin(p*.8)*10; m.rotation.z=Math.sin(p*.7)*.15; break;
      case 'sun': m.position.y=150+Math.sin(p*.5)*5; m.rotation.y=t*.4; break;
      case 'moon': m.position.y=130+Math.sin(p*.6)*7; m.rotation.y=Math.sin(p*.3)*.6; break;
      case 'fish': m.position.x=Math.sin(p*.7)*40; m.position.y=6; m.rotation.y=Math.cos(p*.7)>0?0:Math.PI; m.rotation.z=Math.sin(p*5)*.06; it.sh.position.x=m.position.x; break;
      case 'boat': m.rotation.z=Math.sin(p*1.2)*.08; m.position.x=Math.sin(p*.3)*24; it.sh.position.x=m.position.x; break;
      case 'tree': case 'flower': m.rotation.z=Math.sin(p*.9)*.05; m.rotation.y=Math.sin(p*.25)*.3; break;
      case 'diya': i.scale.y=1+Math.sin(p*9)*.04; m.rotation.y=Math.sin(p*.4)*.4; break;
      case 'bell': m.rotation.z=Math.sin(p*2.2)*.2; break;
      case 'drum': m.position.y=Math.abs(Math.sin(p*2.6))*10; break;
      case 'note': m.position.y=24+Math.sin(p*1.4)*12; m.rotation.y=Math.sin(p*.8)*.5; break;
      case 'cat': i.scale.y=1+Math.sin(p*2)*.03; m.rotation.y=Math.sin(p*.35)*.4; break;
      case 'waves': m.position.x=Math.sin(p*1.1)*8; break;
      default: m.rotation.y=Math.sin(p*.4)*.35;
    }
  }
  loop(){
    this.raf=requestAnimationFrame(()=>this.loop()); if(!this.ready) return;
    const t=this.clock.getElapsedTime(),n=now();
    if(this.mode==='stack'){ this.stackY+=(this.stackTarget-this.stackY)*.12; this.camera.position.set(0,this.stackY+1500,2500); this.camera.lookAt(0,this.stackY-150,0); }
    else this.controls.update();
    const boil=Math.floor(t/.22)%2===0;
    for(const it of this.items){ it.oa.visible=boil; it.ob.visible=!boil; this.animate(it,t);
      if(it.rise){ const k=Math.min(1,Math.max(0,(n-it.rise)/1.4)); it.sc.scale.setScalar(Math.max(.0001,it.S/64*easeBack(k))); it.mover.rotation.x=-(1-k)*(1-k)*Math.PI/2; if(k>=1) it.rise=0; } }
    for(const tw of this.tweens){ const k=Math.min(1,(n-tw.t0)/tw.dur); tw.m.forEach(m=>{ m.opacity=k; if(k>=1){ m.transparent=false; m.needsUpdate=true; } }); }
    this.tweens=this.tweens.filter(tw=>(n-tw.t0)<tw.dur);
    for(const a of this.anims) a.o.position.x=((t*16+a.i*20)%40)-20;
    for(const q of this.qs){ q.material.opacity=.55+.35*Math.sin(t*2.4); q.position.y=150+Math.sin(t*1.2)*6; }
    this.renderer.render(this.scene,this.camera);
  }
}
customElements.define('dadi-map3d',DadiMap);
})();
