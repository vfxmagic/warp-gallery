/* ============================================================
   VFXMAGIC — flythrough engine (shared across the whole site)
   ------------------------------------------------------------
   A procedural fly-through rendered twice each frame: a FINAL
   RENDER layer (always visible) and a WIREFRAME viewport revealed
   inside the cursor "lens". The camera dollies forward over an
   infinite procedural heightfield; both layers draw from the same
   world-space geometry so the lens stays perfectly registered.

   Time of day is real: sun & moon alt/az and the moon's phase are
   computed from standard low-precision astronomy for the visitor's
   local time + a location inferred from their IANA timezone (no
   permission prompt). Eclipse canon 2026–2030 and a live ISS ground
   track are layered in. Honesty rules are preserved from the source.

   Refactored from a single-page hero into initFlythrough(opts) so
   any number of framed viewports can run on one page. Pure math +
   read-only catalogs live at module scope; everything stateful or
   DOM-bound lives per instance. Declarative auto-init scans for
   [data-fly]; initChrome() wires nav + scroll reveals once per page.
   ============================================================ */
(function(){
'use strict';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rad=Math.PI/180, ecl=rad*23.4397;
const lerp=(a,b,t)=>a+(b-a)*t;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

/* ---------- astronomy (J2000 low-precision) ---------- */
const toDays=ms=>ms/86400000-10957.5;
function rAsc(l,b){return Math.atan2(Math.sin(l)*Math.cos(ecl)-Math.tan(b)*Math.sin(ecl),Math.cos(l))}
function decl(l,b){return Math.asin(Math.sin(b)*Math.cos(ecl)+Math.cos(b)*Math.sin(ecl)*Math.sin(l))}
function sunCoords(d){
  const M=rad*(357.5291+0.98560028*d);
  const C=rad*(1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M));
  const l=M+C+rad*102.9372+Math.PI;
  return {ra:rAsc(l,0),dec:decl(l,0)};
}
function moonCoords(d){
  const L=rad*(218.316+13.176396*d);
  const M=rad*(134.963+13.064993*d);
  const F=rad*(93.272+13.229350*d);
  const l=L+rad*6.289*Math.sin(M), b=rad*5.128*Math.sin(F);
  return {ra:rAsc(l,b),dec:decl(l,b),dist:385001-20905*Math.cos(M)};
}
function azAlt(d,lat,lon,c){
  const lw=rad*-lon, phi=rad*lat;
  const Ha=rad*(280.16+360.9856235*d)-lw-c.ra;
  const alt=Math.asin(Math.sin(phi)*Math.sin(c.dec)+Math.cos(phi)*Math.cos(c.dec)*Math.cos(Ha))/rad;
  let az=Math.atan2(Math.sin(Ha),Math.cos(Ha)*Math.sin(phi)-Math.tan(c.dec)*Math.cos(phi))/rad+180;
  az=(az%360+360)%360;
  return {alt,az};
}
function moonIllum(d){
  const s=sunCoords(d), m=moonCoords(d), sd=149598000;
  const phi=Math.acos(Math.sin(s.dec)*Math.sin(m.dec)+Math.cos(s.dec)*Math.cos(m.dec)*Math.cos(s.ra-m.ra));
  const inc=Math.atan2(sd*Math.sin(phi), m.dist-sd*Math.cos(phi));
  const ang=Math.atan2(Math.cos(s.dec)*Math.sin(s.ra-m.ra),
    Math.sin(s.dec)*Math.cos(m.dec)-Math.cos(s.dec)*Math.sin(m.dec)*Math.cos(s.ra-m.ra));
  return {frac:(1+Math.cos(inc))/2, phase:0.5+0.5*inc/Math.PI*(ang<0?-1:1)};
}
function phaseName(p){
  const n=['NEW MOON','WAXING CRESCENT','FIRST QUARTER','WAXING GIBBOUS',
           'FULL MOON','WANING GIBBOUS','LAST QUARTER','WANING CRESCENT'];
  return n[Math.floor(((p%1)+1/16)*8)%8];
}

/* ---------- location from IANA timezone (no prompt) ---------- */
const TZ={
  'Australia/Melbourne':[-37.81,144.96],'Australia/Sydney':[-33.87,151.21],
  'Australia/Brisbane':[-27.47,153.03],'Australia/Perth':[-31.95,115.86],
  'Australia/Adelaide':[-34.93,138.60],'Australia/Hobart':[-42.88,147.33],
  'Australia/Darwin':[-12.46,130.84],'Pacific/Auckland':[-36.85,174.76],
  'Pacific/Fiji':[-18.14,178.44],'Pacific/Honolulu':[21.31,-157.86],
  'America/New_York':[40.71,-74.01],'America/Chicago':[41.88,-87.63],
  'America/Denver':[39.74,-104.99],'America/Phoenix':[33.45,-112.07],
  'America/Los_Angeles':[34.05,-118.24],'America/Anchorage':[61.22,-149.90],
  'America/Toronto':[43.65,-79.38],'America/Vancouver':[49.28,-123.12],
  'America/Mexico_City':[19.43,-99.13],'America/Sao_Paulo':[-23.55,-46.63],
  'America/Argentina/Buenos_Aires':[-34.60,-58.38],'America/Bogota':[4.71,-74.07],
  'America/Lima':[-12.05,-77.04],'America/Santiago':[-33.45,-70.67],
  'Europe/London':[51.51,-0.13],'Europe/Dublin':[53.35,-6.26],
  'Europe/Paris':[48.86,2.35],'Europe/Berlin':[52.52,13.41],
  'Europe/Madrid':[40.42,-3.70],'Europe/Rome':[41.90,12.50],
  'Europe/Amsterdam':[52.37,4.90],'Europe/Brussels':[50.85,4.35],
  'Europe/Zurich':[47.38,8.54],'Europe/Vienna':[48.21,16.37],
  'Europe/Stockholm':[59.33,18.07],'Europe/Oslo':[59.91,10.75],
  'Europe/Copenhagen':[55.68,12.57],'Europe/Helsinki':[60.17,24.94],
  'Europe/Warsaw':[52.23,21.01],'Europe/Prague':[50.08,14.44],
  'Europe/Lisbon':[38.72,-9.14],'Europe/Athens':[37.98,23.73],
  'Europe/Istanbul':[41.01,28.98],'Europe/Moscow':[55.76,37.62],
  'Europe/Kyiv':[50.45,30.52],'Asia/Dubai':[25.20,55.27],
  'Asia/Karachi':[24.86,67.00],'Asia/Kolkata':[22.57,88.36],
  'Asia/Dhaka':[23.81,90.41],'Asia/Bangkok':[13.76,100.50],
  'Asia/Singapore':[1.35,103.82],'Asia/Hong_Kong':[22.32,114.17],
  'Asia/Shanghai':[31.23,121.47],'Asia/Taipei':[25.03,121.57],
  'Asia/Seoul':[37.57,126.98],'Asia/Tokyo':[35.68,139.69],
  'Asia/Jakarta':[-6.21,106.85],'Asia/Manila':[14.60,120.98],
  'Asia/Kuala_Lumpur':[3.14,101.69],'Asia/Jerusalem':[31.77,35.21],
  'Asia/Riyadh':[24.71,46.68],'Africa/Cairo':[30.04,31.24],
  'Africa/Lagos':[6.52,3.38],'Africa/Johannesburg':[-26.20,28.05],
  'Africa/Nairobi':[-1.29,36.82],'Africa/Casablanca':[33.57,-7.59]
};
function locate(){
  let tz='';
  try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}
  if(TZ[tz]) return {lat:TZ[tz][0],lon:TZ[tz][1]};
  const lon=-new Date().getTimezoneOffset()/60*15;
  const region=tz.split('/')[0];
  const LAT={Australia:-27,Pacific:-15,Europe:48,Africa:8,Asia:28,America:38,Atlantic:35,Indian:-10};
  return {lat:LAT[region]!==undefined?LAT[region]:30, lon};
}
const LOC=locate();
const SOUTHERN=LOC.lat<0;

/* season -> representative date (solstice/equinox), hemisphere-correct */
const SEASON_DATES = SOUTHERN
  ? {spring:[8,22], summer:[11,21], autumn:[2,20], winter:[5,21]}
  : {spring:[2,20], summer:[5,21], autumn:[8,22], winter:[11,21]};
function currentSeason(){
  const nh=['winter','winter','spring','spring','spring','summer',
            'summer','summer','autumn','autumn','autumn','winter'][new Date().getMonth()];
  return SOUTHERN ? {winter:'summer',spring:'autumn',summer:'winter',autumn:'spring'}[nh] : nh;
}

/* ---------- eclipse canon 2026–2030 (NASA/Espenak) ---------- */
const ECL_LUNAR=[
  {u1:Date.UTC(2026,7,28,2,34),  mx:Date.UTC(2026,7,28,4,13),  u4:Date.UTC(2026,7,28,5,52),  mag:0.93},
  {u1:Date.UTC(2028,0,12,3,45),  mx:Date.UTC(2028,0,12,4,13),  u4:Date.UTC(2028,0,12,4,41),  mag:0.07},
  {u1:Date.UTC(2028,6,6,17,9),   mx:Date.UTC(2028,6,6,18,20),  u4:Date.UTC(2028,6,6,19,30),  mag:0.39},
  {u1:Date.UTC(2028,11,31,15,8), mx:Date.UTC(2028,11,31,16,52),u4:Date.UTC(2028,11,31,18,36),mag:1.25},
  {u1:Date.UTC(2029,5,26,1,32),  mx:Date.UTC(2029,5,26,3,22),  u4:Date.UTC(2029,5,26,5,12),  mag:1.85},
  {u1:Date.UTC(2029,11,20,21,0), mx:Date.UTC(2029,11,20,22,42),u4:Date.UTC(2029,11,21,0,25), mag:1.12},
  {u1:Date.UTC(2030,5,15,17,20), mx:Date.UTC(2030,5,15,18,33), u4:Date.UTC(2030,5,15,19,46), mag:0.50}
];
const ECL_SOLAR=[
  {ty:'T',t0:Date.UTC(2026,7,12,16,58),t1:Date.UTC(2026,7,12,18,34),mag:1.039,
   path:[[66,98],[83,40],[86,-40],[75,-58],[65.2,-25.2],[50,-15],[43,-8],[40,-3],[38.5,1]]},
  {ty:'A',t0:Date.UTC(2027,1,6,14,4),t1:Date.UTC(2027,1,6,17,55),mag:0.93,
   path:[[-37,-74],[-34,-63],[-30,-48],[-22,-30],[-10,-12],[2,-4],[6,1],[7,3]]},
  {ty:'T',t0:Date.UTC(2027,7,2,8,55),t1:Date.UTC(2027,7,2,11,25),mag:1.079,
   path:[[36.5,-6],[35,-2],[33,4],[31,12],[28,22],[25.7,32.6],[22,40],[17,46],[11,51],[3,60]]},
  {ty:'A',t0:Date.UTC(2028,0,26,13,15),t1:Date.UTC(2028,0,26,16,58),mag:0.92,
   path:[[-0.7,-90.3],[-1,-79],[-3,-72],[-2,-60],[1,-52],[12,-40],[30,-20],[38.7,-9],[40,-4]]},
  {ty:'T',t0:Date.UTC(2028,6,22,1,56),t1:Date.UTC(2028,6,22,4,0),mag:1.056,
   path:[[-13,121],[-15.6,126.7],[-19,133],[-23,139],[-27,143.5],[-31,147.5],[-33.9,151.2],[-38,157],[-42,165],[-44.7,169.8]]},
  {ty:'A',t0:Date.UTC(2030,5,1,5,10),t1:Date.UTC(2030,5,1,7,50),mag:0.94,
   path:[[34,6],[37,16],[40,27],[45,38],[51,52],[56,72],[57,95],[52,120],[45,137],[43,142]]},
  {ty:'T',t0:Date.UTC(2030,10,25,5,25),t1:Date.UTC(2030,10,25,8,10),mag:1.047,
   path:[[-20,12],[-25,18],[-29,25],[-31.5,29.5],[-36,45],[-42,65],[-43.5,80],[-42,100],[-38,125],[-35.2,138.7],[-32.5,146],[-29,152.5]]}
];
function pathDist(path){
  let best=1e9, bu=0, acc=0;
  const segLen=[]; let total=0;
  for(let i=0;i<path.length-1;i++){
    const cm=Math.cos(rad*(path[i][0]+path[i+1][0])/2);
    const dx=(path[i+1][1]-path[i][1])*cm, dy=path[i+1][0]-path[i][0];
    segLen.push(Math.hypot(dx,dy)); total+=segLen[i];
  }
  for(let i=0;i<path.length-1;i++){
    const a=path[i], b=path[i+1];
    const cm=Math.cos(rad*(a[0]+b[0])/2);
    const ax=a[1]*cm, ay=a[0], bx=b[1]*cm, by=b[0];
    const px=LOC.lon*cm, py=LOC.lat;
    const vx=bx-ax, vy=by-ay;
    const tt=clamp(((px-ax)*vx+(py-ay)*vy)/(vx*vx+vy*vy||1),0,1);
    const d=Math.hypot(px-(ax+vx*tt), py-(ay+vy*tt))*111.2;
    if(d<best){best=d; bu=(acc+segLen[i]*tt)/(total||1)}
    acc+=segLen[i];
  }
  return {km:best,u:bu};
}

/* ---------- world noise (shimmer-free, infinite) ---------- */
function hash2(ix,iz){
  let n=(Math.imul(ix,374761393)+Math.imul(iz,668265263))|0;
  n=Math.imul(n^(n>>>13),1274126177);
  n=(n^(n>>>16))>>>0;
  return n/4294967296;
}
function noise2(x,z){
  const ix=Math.floor(x),iz=Math.floor(z);
  const fx=x-ix,fz=z-iz;
  const ux=fx*fx*(3-2*fx),uz=fz*fz*(3-2*fz);
  const a=hash2(ix,iz),b=hash2(ix+1,iz),c=hash2(ix,iz+1),d=hash2(ix+1,iz+1);
  return a+(b-a)*ux+(c-a)*uz+(a-b-c+d)*ux*uz;
}
function terrain(x,z){
  return 46*noise2(x*0.011,z*0.011)
       + 20*noise2(x*0.034+71.3,z*0.034+19.7)
       + 16*Math.sin(z*0.0042+x*0.0016);
}

/* ---------- bright-star catalog [RA h, Dec°, mag, warm] J2000 ---------- */
const CAT=[
  [12.443,-63.10,0.76],[12.795,-59.69,1.25],[12.519,-57.11,1.63,1],[12.253,-58.75,2.79],[12.356,-60.40,3.59],
  [14.660,-60.83,-0.27],[14.064,-60.37,0.61],
  [5.919,7.41,0.50,1],[5.418,6.35,1.64],[5.679,-1.94,1.74],[5.604,-1.20,1.69],[5.533,-0.30,2.23],[5.242,-8.20,0.13],[5.796,-9.67,2.09],
  [11.062,61.75,1.79,1],[11.031,56.38,2.37],[11.897,53.69,2.44],[12.257,57.03,3.31],[12.900,55.96,1.76],[13.399,54.93,2.04],[13.792,49.31,1.86],
  [0.153,59.15,2.27],[0.675,56.54,2.24,1],[0.945,60.72,2.39],[1.430,60.24,2.68],[1.907,63.67,3.37],
  [16.490,-26.43,1.06,1],[16.005,-22.62,2.32],[16.091,-19.81,2.62],[16.836,-34.29,2.29],[17.622,-43.00,1.86],[17.708,-39.03,2.39],[17.560,-37.10,1.62],[17.512,-37.30,2.70],
  [6.752,-16.72,-1.46],[6.400,-52.70,-0.74],[14.261,19.18,-0.05,1],[18.616,38.78,0.03],[5.278,46.00,0.08],
  [7.655,5.22,0.34],[1.629,-57.24,0.46],[19.846,8.87,0.77],[4.599,16.51,0.86,1],[13.420,-11.16,0.97],
  [7.755,28.03,1.14,1],[22.961,-29.62,1.16],[20.690,45.28,1.25],[10.139,11.97,1.39],[6.977,-28.97,1.50],
  [7.577,31.89,1.58],[5.438,28.61,1.65],[9.220,-69.72,1.67],[22.137,-46.96,1.74],[3.405,49.86,1.79],
  [7.140,-26.39,1.83],[18.403,-34.38,1.85],[8.375,-59.51,1.86],[5.992,44.95,1.90],[16.811,-69.03,1.91],
  [6.629,16.40,1.92],[20.427,-56.74,1.94],[8.745,-54.71,1.96],[6.378,-17.96,1.98],[9.460,-8.66,1.98,1],
  [2.530,89.26,1.98],[2.120,23.46,2.00,1],[0.726,-17.99,2.04],[1.162,35.62,2.05,1],[0.140,29.09,2.06],
  [18.921,-26.30,2.06],[14.111,-36.37,2.06,1],[17.582,12.56,2.07],[14.845,74.16,2.08,1],[10.333,19.84,2.08,1],
  [2.065,42.33,2.26,1],[11.818,14.57,2.13],[3.136,40.96,2.12],[22.711,-46.88,2.10,1],[12.692,-48.96,2.17],
  [9.285,-59.28,2.20],[9.133,-43.43,2.21,1],[15.578,26.71,2.23],[20.371,40.26,2.23],[17.943,51.49,2.23,1],
  [8.060,-40.00,2.25],[14.750,27.07,2.37,1],[14.699,-47.39,2.30],[13.665,-53.47,2.30],[14.592,-42.16,2.31],
  [0.438,-42.31,2.38,1],[21.736,9.88,2.39,1],[23.063,28.08,2.42,1],[17.173,-15.72,2.43],[7.401,-29.30,2.45],
  [9.368,-55.01,2.48],[23.079,15.21,2.49],[20.770,33.97,2.48,1],[15.283,-9.38,2.61],[15.738,6.43,2.65,1],
  [1.911,20.81,2.64],[5.661,-34.07,2.64],[12.573,-23.40,2.65],[13.911,18.40,2.68]
];
const AST=[
  {n:'CRUX',m:[0,1,2,3,4],l:[[0,2],[1,3]]},
  {n:'',m:[5,6],l:[[5,6]]},
  {n:'ORION',m:[7,8,9,10,11,12,13],l:[[7,8],[7,9],[8,11],[9,10],[10,11],[9,13],[11,12]]},
  {n:'URSA MAJOR',m:[14,15,16,17,18,19,20],l:[[14,15],[15,16],[16,17],[17,14],[17,18],[18,19],[19,20]]},
  {n:'CASSIOPEIA',m:[21,22,23,24,25],l:[[21,22],[22,23],[23,24],[24,25]]},
  {n:'SCORPIUS',m:[26,27,28,29,30,31,32,33],l:[[28,27],[27,26],[26,29],[29,30],[30,31],[31,32],[32,33]]}
];

/* ---------- palettes (night / dawn / dusk / day) ---------- */
const hx=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
const PAL={
  night:{sky:['#05070e','#0a1322','#16283c','#0a121c'].map(hx),
         near:[8,14,24],far:[54,78,108],rim:[190,215,240],rimA:0.16,
         star:1,prac:1,fog:[140,170,205],fogA:1,haze:[120,160,200],hazeA:0.10},
  dawn: {sky:['#101a33','#33395d','#9a6a78','#d9985f'].map(hx),
         near:[18,21,36],far:[112,98,116],rim:[255,205,160],rimA:0.22,
         star:0.30,prac:0.75,fog:[190,180,200],fogA:0.8,haze:[230,170,120],hazeA:0.16},
  dusk: {sky:['#0d1226','#3b2c4d','#b05d44','#e0894a'].map(hx),
         near:[20,16,32],far:[120,86,98],rim:[255,176,120],rimA:0.24,
         star:0.25,prac:0.85,fog:[200,160,150],fogA:0.8,haze:[240,160,100],hazeA:0.18},
  day:  {sky:['#6aa6cb','#8fc0dd','#c4ddeb','#a6c9da'].map(hx),
         near:[44,66,60],far:[136,164,180],rim:[255,250,238],rimA:0.20,
         star:0,prac:0.10,fog:[225,233,240],fogA:0.55,haze:[235,242,248],hazeA:0.12}
};
const ss=t=>t*t*(3-2*t);
function mixN(a,b,c,wa,wb,wc){return a*wa+b*wb+c*wc}
function mixC(a,b,c,wa,wb,wc){return [0,1,2].map(i=>Math.round(a[i]*wa+b[i]*wb+c[i]*wc))}
const SEASON_GRADE={
  summer:{near:[48,66,52], far:[138,162,170]},
  spring:{near:[40,72,52], far:[124,160,166]},
  autumn:{near:[64,56,38], far:[148,134,116]},
  winter:{near:[56,62,70], far:[152,170,186]}
};
const INK_BASE={i1:[6,9,15], i2:[10,14,22], i3:[16,21,31]};

/* shared scratch canvas for the moon terminator mask (used synchronously) */
const moonCv=document.createElement('canvas');
function drawMoonDisc(c,cx,cy,r,phase,litColor,litA,darkColor,darkA){
  if(darkA>0.002){
    c.globalAlpha=darkA; c.fillStyle=darkColor;
    c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.fill();
    c.globalAlpha=1;
  }
  let p=phase; if(SOUTHERN) p=1-p;
  const cosT=Math.cos(2*Math.PI*p);
  const rightLit=p<0.5;
  const s=Math.ceil(r*2+4);
  moonCv.width=s; moonCv.height=s;
  const m=moonCv.getContext('2d');
  m.translate(s/2,s/2);
  m.fillStyle=litColor;
  m.beginPath(); m.arc(0,0,r,-Math.PI/2,Math.PI/2,!rightLit); m.closePath(); m.fill();
  m.globalCompositeOperation=cosT>0?'destination-out':'source-over';
  m.beginPath(); m.ellipse(0,0,Math.max(0.01,r*Math.abs(cosT)),r,0,0,Math.PI*2); m.fill();
  c.globalAlpha=litA;
  c.drawImage(moonCv,cx-s/2,cy-s/2);
  c.globalAlpha=1;
}

/* Safari's Canvas 2D fill rate sits well below Chrome's, so a full-res Retina
   backing store makes the per-frame redraw lag. Detect Safari (Apple vendor +
   Safari UA, not Chrome/Chromium/iOS-Chrome) so we can push it fewer pixels. */
const IS_SAFARI = typeof navigator !== 'undefined'
  && (navigator.vendor || '').indexOf('Apple') > -1
  && /Safari/.test(navigator.userAgent)
  && !/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent);

/* ============================================================
   ONE INSTANCE — a single framed flythrough viewport.
   opts: {root, lens, iss, tintPage, interactive, defaultMin,
          season, scene, speed}
   ============================================================ */
function initFlythrough(opts){
  const root=opts.root;
  if(!root) return;
  const useLens=!!opts.lens;
  const useWire=useLens;
  const useISS=!!opts.iss;
  const tintPage=!!opts.tintPage;
  const interactive=opts.interactive!==undefined?opts.interactive:useLens;
  const SPEED=opts.speed||24;
  const sceneLabel=opts.scene||null;

  /* build canvases */
  const cvR=document.createElement('canvas'); cvR.className='cvRender';
  const cvW=document.createElement('canvas'); cvW.className='cvWire';
  root.insertBefore(cvW, root.firstChild);
  root.insertBefore(cvR, root.firstChild);
  if(!useWire) cvW.style.display='none';
  const ctxR=cvR.getContext('2d');
  const ctxW=cvW.getContext('2d');

  /* lens (optional, built on demand) */
  let lensEl=root.querySelector('.lens');
  if(useLens && !lensEl){
    lensEl=document.createElement('div'); lensEl.className='lens';
    lensEl.innerHTML='<i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><em>WIREFRAME</em>';
    root.appendChild(lensEl);
  }

  /* optional HUD / tod elements (scoped to this root) */
  const hudTc=root.querySelector('.hudTc');
  const hudScene=root.querySelector('.hudScene');
  const todEl=root.querySelector('.tod');
  const useTod=!!todEl;
  const todRange=todEl&&todEl.querySelector('.todRange');
  const todClock=todEl&&todEl.querySelector('.todClock');
  const todLive=todEl&&todEl.querySelector('.todLive');
  const todPhase=todEl&&todEl.querySelector('.todPhase');
  const moonChip=todEl&&todEl.querySelector('.moonChip');
  const todEclBtn=todEl&&todEl.querySelector('.todEcl');

  /* ---------- per-instance state ---------- */
  let W=0,H=0,DPR=1;
  let mx=0,my=0,lx=0,ly=0;
  let userDriving=false,lastInput=0,driftT=0;
  let paused=false, rafId=0;                 // RAF gated on an IntersectionObserver
  let hintGone=false;                        // .scrub-hint fades on first real input
  let sweepDone=false, sweep=null;           // one-shot reveal demo (drift maths)
  let baseR=null, baseW=null, vigC=null, compR=null, compW=null;
  let faintField=[], fogs=[];
  const NEAR=30, FAR=640, DZ=20, ALT=128, PZ=176;
  let camZ=0, persp=0, horY=0, swayX=0, bobY=0;

  let live = opts.defaultMin!==undefined ? false : true;
  let todMin = opts.defaultMin!==undefined ? opts.defaultMin
             : (()=>{const n=new Date();return n.getHours()*60+n.getMinutes()})();
  let sun={alt:-40,az:0}, moon={alt:-40,az:0,frac:0,phase:0};
  let sunEq={ra:0,dec:0}, thetaG=0, curMs=0, curD=0;
  let pal=null;
  let seasonSel = opts.season||null;
  let eclSel=null;
  let camRef=180;
  let skyStars=[];
  let eclNow={lunarM:0,lunarMag:0,solarCov:0,solarTy:'',solarDir:1,event:null};

  /* ---- site-wide sky sync ----
     The whole site shares ONE time-of-day so every page matches the front page.
     EVERY sky READS the shared state (so the inner pages follow); only the live
     ambient heroes (no data-min) SEED/write it. A page's data-min is therefore
     just its first-visit default, overridden the moment the session has a sky.
     sessionStorage persists across in-tab navigation, resets on a fresh visit. */
  const skySeed = (opts.defaultMin === undefined);   // live heroes write; locked pages only read
  try{
    const _s = JSON.parse(sessionStorage.getItem('vfxSky') || 'null');
    if(_s && typeof _s === 'object'){
      if(_s.live){ live = true; const _n = new Date(); todMin = _n.getHours()*60 + _n.getMinutes(); }
      else if(typeof _s.min === 'number'){ live = false; todMin = _s.min; }
      if('season' in _s) seasonSel = _s.season || null;
    }
  }catch(e){}

  /* ISS */
  const EARTH_R=6371;
  let issSamples=[], issWindow=[0,0], issFetching=false, issTimer=null;
  function issUsable(){ return useISS && Math.abs(curMs-Date.now())<3*86400000; }
  async function fetchISS(centerMs){
    if(issFetching) return;
    issFetching=true;
    try{
      const ts=[];
      for(let i=0;i<10;i++) ts.push(Math.round((centerMs-120000+i*60000)/1000));
      const res=await fetch('https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps='+ts.join(',')+'&units=kilometers');
      if(res.ok){
        const arr=await res.json();
        issSamples=arr.map(p=>({t:p.timestamp*1000,lat:p.latitude,lon:p.longitude,alt:p.altitude}));
        issWindow=[issSamples[0].t,issSamples[issSamples.length-1].t];
        buildSky(); updateHud();
      }
    }catch(e){ issSamples=[]; }
    issFetching=false;
  }
  function issEnsure(centerMs){
    if(!issUsable()){ return; }
    if(issSamples.length && centerMs>=issWindow[0]+30000 && centerMs<=issWindow[1]-30000) return;
    clearTimeout(issTimer);
    issTimer=setTimeout(()=>fetchISS(centerMs),500);
  }
  function issAt(tms){
    if(issSamples.length<2||tms<issWindow[0]||tms>issWindow[1]) return null;
    let i=0;
    while(i<issSamples.length-2&&issSamples[i+1].t<tms) i++;
    const a=issSamples[i], b=issSamples[i+1];
    const f=clamp((tms-a.t)/(b.t-a.t||1),0,1);
    let dl=b.lon-a.lon;
    if(dl>180) dl-=360; if(dl<-180) dl+=360;
    return {lat:a.lat+(b.lat-a.lat)*f, lon:a.lon+dl*f, alt:a.alt+(b.alt-a.alt)*f};
  }
  function issLook(p){
    const f1=rad*LOC.lat, f2=rad*p.lat, dl=rad*(p.lon-LOC.lon);
    const cg=Math.sin(f1)*Math.sin(f2)+Math.cos(f1)*Math.cos(f2)*Math.cos(dl);
    const g=Math.acos(clamp(cg,-1,1));
    const ratio=EARTH_R/(EARTH_R+p.alt);
    const elev=Math.atan2(Math.cos(g)-ratio,Math.sin(g))/rad;
    const y=Math.sin(dl)*Math.cos(f2);
    const x=Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl);
    return {alt:elev, az:((Math.atan2(y,x)/rad)+360)%360};
  }
  function issSunlit(p){
    const gha=thetaG-sunEq.ra;
    const ssLat=sunEq.dec/rad, ssLon=(((-gha/rad)%360)+540)%360-180;
    const u=(la,lo)=>[Math.cos(rad*la)*Math.cos(rad*lo),Math.cos(rad*la)*Math.sin(rad*lo),Math.sin(rad*la)];
    const s=u(ssLat,ssLon), v=u(p.lat,p.lon).map(c=>c*(EARTH_R+p.alt));
    const dot=v[0]*s[0]+v[1]*s[1]+v[2]*s[2];
    if(dot>=0) return true;
    const perp=Math.hypot(v[0]-dot*s[0],v[1]-dot*s[1],v[2]-dot*s[2]);
    return perp>EARTH_R;
  }
  function issScreen(look){
    const dAz=((look.az-camRef+540)%360)-180;
    if(Math.abs(dAz)>95||look.alt<=0) return null;
    return {x:W*(0.5+dAz/180), y:horY-(look.alt/75)*(horY-H*0.06)};
  }

  function computeEclipse(t){
    eclNow={lunarM:0,lunarMag:0,solarCov:0,solarTy:'',solarDir:1,event:null};
    for(const e of ECL_LUNAR){
      if(t>=e.u1&&t<=e.u4){
        const m=t<=e.mx ? (t-e.u1)/(e.mx-e.u1) : (e.u4-t)/(e.u4-e.mx);
        eclNow.lunarM=e.mag*clamp(m,0,1); eclNow.lunarMag=e.mag; eclNow.event=e;
      }
    }
    for(const e of ECL_SOLAR){
      const pd=pathDist(e.path);
      const covMax = pd.km<=120 ? Math.min(e.mag,1)
                   : Math.max(0, Math.min(e.mag,1)*(1-(pd.km-120)/3300));
      if(covMax<=0.01) continue;
      const tLoc=e.t0+pd.u*(e.t1-e.t0), HW=5400000;
      if(t>=tLoc-HW&&t<=tLoc+HW){
        eclNow.solarCov=covMax*Math.pow(Math.max(0,1-Math.abs(t-tLoc)/HW),1.2);
        eclNow.solarTy=e.ty; eclNow.solarDir=t<tLoc?1:-1; eclNow.event=e;
      }
    }
  }
  function nextVisibleEclipse(){
    const now=Date.now(), out=[];
    for(const e of ECL_LUNAR){
      if(e.mx<now) continue;
      const aa=azAlt(toDays(e.mx),LOC.lat,LOC.lon,moonCoords(toDays(e.mx)));
      if(aa.alt>0) out.push({t:e.mx,label:`${e.mag>=1?'TOTAL':'PARTIAL'} LUNAR`,e});
    }
    for(const e of ECL_SOLAR){
      const pd=pathDist(e.path);
      const covMax = pd.km<=120 ? 1 : Math.max(0,1-(pd.km-120)/3300);
      if(covMax<=0.03) continue;
      const tLoc=e.t0+pd.u*(e.t1-e.t0);
      if(tLoc<now) continue;
      const aa=azAlt(toDays(tLoc),LOC.lat,LOC.lon,sunCoords(toDays(tLoc)));
      if(aa.alt>0) out.push({t:tLoc,label:`${pd.km<=120?(e.ty==='T'?'TOTAL':'ANNULAR'):'PARTIAL'} SOLAR`,e});
    }
    out.sort((a,b)=>a.t-b.t);
    return out[0]||null;
  }

  function activeDate(){
    let d=new Date();
    if(eclSel){d=new Date(eclSel.t);}
    else if(seasonSel){const md=SEASON_DATES[seasonSel]; d.setMonth(md[0],md[1]);}
    d.setHours(0,todMin,0,0);
    return d;
  }
  function computeHeading(){
    const eclSide=SOUTHERN?0:180, poleSide=SOUTHERN?180:0;
    camRef=(sun.alt>-2||moon.alt>-2)?eclSide:poleSide;
  }
  function computeAstro(){
    curMs=activeDate().getTime();
    curD=toDays(curMs);
    sunEq=sunCoords(curD);
    thetaG=rad*(280.16+360.9856235*curD);
    sun=azAlt(curD,LOC.lat,LOC.lon,sunEq);
    const ma=azAlt(curD,LOC.lat,LOC.lon,moonCoords(curD));
    const il=moonIllum(curD);
    moon={alt:ma.alt,az:ma.az,frac:il.frac,phase:il.phase};
    computeEclipse(curMs);
    computeHeading();
    issEnsure(curMs);
  }
  function computePalette(){
    const a=sun.alt;
    const dW=ss(clamp((a-3)/11,0,1));
    const tW=clamp(1-Math.abs(a+2)/9,0,1)*(1-dW);
    const nW=Math.max(0,1-dW-tW);
    const morning=sun.az<180;
    const T=morning?PAL.dawn:PAL.dusk, N=PAL.night, D=PAL.day;
    const gr=SEASON_GRADE[seasonSel||currentSeason()];
    pal={
      sky:[0,1,2,3].map(i=>mixC(N.sky[i],T.sky[i],D.sky[i],nW,tW,dW)),
      near:mixC(N.near,T.near,gr.near,nW,tW,dW),
      far:mixC(N.far,T.far,gr.far,nW,tW,dW),
      rim:mixC(N.rim,T.rim,D.rim,nW,tW,dW),
      rimA:mixN(N.rimA,T.rimA,D.rimA,nW,tW,dW),
      star:mixN(N.star,T.star,D.star,nW,tW,dW),
      prac:mixN(N.prac,T.prac,D.prac,nW,tW,dW),
      fog:mixC(N.fog,T.fog,D.fog,nW,tW,dW),
      fogA:mixN(N.fogA,T.fogA,D.fogA,nW,tW,dW),
      haze:mixC(N.haze,T.haze,D.haze,nW,tW,dW),
      hazeA:mixN(N.hazeA,T.hazeA,D.hazeA,nW,tW,dW),
      nW,tW,dW,morning
    };
    if(eclNow.solarCov>0.6){
      const k=ss(clamp((eclNow.solarCov-0.6)/0.4,0,1))*(eclNow.solarTy==='T'?0.88:0.55);
      const N2=PAL.night;
      pal.sky=pal.sky.map((c,i)=>mixC(c,c,N2.sky[i],0,1-k,k));
      pal.near=mixC(pal.near,pal.near,N2.near,0,1-k,k);
      pal.far=mixC(pal.far,pal.far,N2.far,0,1-k,k);
      pal.star=Math.max(pal.star,k*0.85);
      pal.prac=Math.max(pal.prac,k*0.8);
      pal.haze=mixC(pal.haze,pal.haze,[240,160,100],0,1-k*0.9,k*0.9);
      pal.hazeA=Math.max(pal.hazeA,k*0.2);
      pal.fogA=pal.fogA*(1-k*0.5);
    }
  }
  function sceneBucket(){
    if(sun.alt>6) return 'DAY EXT';
    if(sun.alt>-8) return pal.morning?'DAWN EXT':'DUSK EXT';
    return 'NIGHT EXT';
  }
  function applyPageTint(){
    if(!tintPage) return;
    const s=pal.sky[1];
    const tint=(b,k)=>b.map((v,i)=>Math.round(v*(1-k)+s[i]*k));
    const rs=document.documentElement.style;
    const i1=tint(INK_BASE.i1,0.10), i2=tint(INK_BASE.i2,0.16), i3=tint(INK_BASE.i3,0.22);
    rs.setProperty('--ink',`rgb(${i1})`);
    rs.setProperty('--ink-2',`rgb(${i2})`);
    rs.setProperty('--ink-3',`rgb(${i3})`);
    rs.setProperty('--nav-bg',`rgba(${i1},.85)`);
  }

  function projectStars(mPos,sPos,moonR,sunR){
    skyStars=[];
    const idx=[];
    for(let i=0;i<CAT.length;i++){
      const s=CAT[i];
      const aa=azAlt(curD,LOC.lat,LOC.lon,{ra:rad*s[0]*15,dec:rad*s[1]});
      let scr=null;
      if(aa.alt>-1){
        const dAz=((aa.az-camRef+540)%360)-180;
        if(Math.abs(dAz)<=95){
          const x=W*(0.5+dAz/180);
          const y=horY-(aa.alt/75)*(horY-H*0.06);
          const nearMoon=mPos&&moon.alt>-2&&Math.hypot(x-mPos.x,y-mPos.y)<moonR*1.15;
          const nearSun=sPos&&sun.alt>-2&&Math.hypot(x-sPos.x,y-sPos.y)<sunR*1.4;
          if(!nearMoon&&!nearSun){
            scr={x,y,m:s[2],w:s[3]||0,ext:clamp(aa.alt/12,0.18,1)};
            skyStars.push(scr);
          }
        }
      }
      idx.push(scr);
    }
    return idx;
  }
  function skyXY(b){
    const dAz=((b.az-camRef+540)%360)-180;
    const f=clamp(0.5+dAz/180,0.06,0.94);
    return {x:W*f, y:horY-(b.alt/75)*(horY-H*0.06)};
  }

  function computeRows(){
    const firstZ=Math.floor((camZ+NEAR)/DZ)*DZ+DZ;
    const n=Math.floor((FAR-NEAR)/DZ);
    const step=Math.max(18,W/64);
    const rows=[];
    for(let i=0;i<n;i++){
      const z=firstZ+i*DZ, d=z-camZ, s=persp/d;
      const pts=[];
      for(let sx=-40;sx<=W+40+step;sx+=step){
        const xw=swayX+(sx-W/2)/s;
        pts.push([sx, horY+(ALT+bobY-terrain(xw,z))*s]);
      }
      rows.push({z,d,t:clamp((d-NEAR)/(FAR-NEAR),0,1),pts});
    }
    return rows;
  }
  function collectPracticals(){
    const list=[];
    const k0=Math.floor((camZ+NEAR)/PZ)-1, k1=Math.floor((camZ+FAR)/PZ)+1;
    for(let k=k0;k<=k1;k++){
      if(hash2(k,9173)>0.62) continue;
      const z=k*PZ+(0.15+0.7*hash2(k,31))*PZ;
      const d=z-camZ;
      if(d<NEAR+6 || d>FAR*0.82) continue;
      const xw=(hash2(k,57)-0.5)*520;
      const gy=terrain(xw,z), s=persp/d;
      const sx=W/2+(xw-swayX)*s;
      if(sx<-80||sx>W+80) continue;
      const sy=horY+(ALT+bobY-gy)*s;
      const fade=Math.min(1,(d-NEAR-6)/36,(FAR*0.82-d)/(FAR*0.2));
      list.push({k,z,d,s,sx,sy,fade:clamp(fade,0,1)});
    }
    list.sort((a,b)=>b.z-a.z);
    return list;
  }
  function drawPracticalR(c,p,time){
    const pr=pal.prac;
    if(pr<0.02) return;
    const flk = reduced ? 0.6
      : 0.5+0.5*Math.sin(time*0.013+p.k*2.13)+0.25*Math.sin(time*0.037+p.k*0.7);
    const gr=Math.max(9,(46+flk*9)*p.s);
    let g=c.createRadialGradient(p.sx,p.sy,0,p.sx,p.sy,gr);
    g.addColorStop(0,`rgba(255,176,96,${(0.5*p.fade*pr).toFixed(3)})`);
    g.addColorStop(0.32,`rgba(222,132,72,${(0.2*p.fade*pr).toFixed(3)})`);
    g.addColorStop(1,'rgba(222,132,72,0)');
    c.fillStyle=g;
    c.fillRect(p.sx-gr,p.sy-gr,gr*2,gr*2);
    c.globalAlpha=p.fade*pr;
    c.fillStyle='#ffce8a';
    c.beginPath(); c.arc(p.sx,p.sy,Math.max(1.1,1.6*p.s),0,Math.PI*2); c.fill();
    const fh=8*p.s;
    if(fh>3.5){
      const fx=p.sx+13*p.s;
      c.fillStyle='#05080d';
      c.fillRect(fx-0.9*p.s,p.sy-fh,1.8*p.s,fh);
      c.beginPath(); c.arc(fx,p.sy-fh-1.6*p.s,1.7*p.s,0,Math.PI*2); c.fill();
      c.fillStyle=`rgba(255,180,110,${(0.7*p.fade*pr).toFixed(3)})`;
      c.fillRect(fx-1.5*p.s,p.sy-fh+1.5*p.s,0.6*p.s,fh*0.66);
    }
    c.globalAlpha=1;
  }
  function drawPracticalW(c,p){
    const mr=clamp(4*p.s,2.5,9);
    c.globalAlpha=p.fade;
    c.strokeStyle='rgba(201,141,87,.9)'; c.lineWidth=1;
    c.beginPath(); c.arc(p.sx,p.sy,mr,0,Math.PI*2); c.stroke();
    c.beginPath();
    c.moveTo(p.sx-mr-5,p.sy); c.lineTo(p.sx+mr+5,p.sy);
    c.moveTo(p.sx,p.sy-mr-5); c.lineTo(p.sx,p.sy+mr+5);
    c.stroke();
    const fh=8*p.s;
    if(fh>3.5){
      c.strokeStyle='rgba(154,220,238,.6)';
      c.strokeRect(p.sx+13*p.s-2*p.s,p.sy-fh-3*p.s,4*p.s,fh+3*p.s);
    }
    c.globalAlpha=1;
  }
  function drawPracticalLabels(c,list){
    if(!list.length) return;
    const p=list[list.length-1];
    if(p.fade<0.35||p.d>FAR*0.5) return;
    c.font='9px "IBM Plex Mono",monospace';
    c.globalAlpha=p.fade;
    c.fillStyle='rgba(201,141,87,.85)';
    c.fillText(`PRACTICAL_${String((p.k%89+89)%89+1).padStart(2,'0')} · 2700K`, p.sx+14+4*p.s, p.sy-10-4*p.s);
    if(8*p.s>3.5){
      c.fillStyle='rgba(154,220,238,.55)';
      c.fillText('CHAR_SCALE 1.8m', p.sx+24*p.s, p.sy+10);
    }
    c.globalAlpha=1;
  }

  function drawScene(r,w,time){
    const rows=computeRows();
    const prs=collectPracticals();

    /* RENDER layer */
    r.clearRect(0,0,W,H);
    r.drawImage(baseR,0,0,W,H);
    if(!reduced && pal.star>0.01){
      r.save();
      for(const st of skyStars){
        const tw=st.m>0.6 ? 0.82+0.18*Math.sin(time*0.004+st.x*0.7) : 1;
        r.globalAlpha=clamp(1.05-st.m*0.16,0.22,1)*st.ext*pal.star*tw;
        r.fillStyle=st.w?'#f2d8b4':'#dfe9f5';
        r.beginPath(); r.arc(st.x,st.y,Math.max(0.6,(3.1-st.m)*0.62),0,Math.PI*2); r.fill();
      }
      r.restore();
    }
    if(issSamples.length && issUsable() && sun.alt<-6){
      const ims=live?Date.now():curMs;
      const p=issAt(ims);
      if(p && issSunlit(p)){
        const sp=issScreen(issLook(p));
        if(sp){
          const p2=issAt(ims-15000);
          r.save();
          if(p2){
            const sp2=issScreen(issLook(p2));
            if(sp2){
              const tg=r.createLinearGradient(sp2.x,sp2.y,sp.x,sp.y);
              tg.addColorStop(0,'rgba(255,243,214,0)');
              tg.addColorStop(1,'rgba(255,243,214,.7)');
              r.strokeStyle=tg; r.lineWidth=1.1;
              r.beginPath(); r.moveTo(sp2.x,sp2.y); r.lineTo(sp.x,sp.y); r.stroke();
            }
          }
          let ig=r.createRadialGradient(sp.x,sp.y,0,sp.x,sp.y,5);
          ig.addColorStop(0,'rgba(255,246,222,.55)');
          ig.addColorStop(1,'rgba(255,246,222,0)');
          r.fillStyle=ig; r.fillRect(sp.x-5,sp.y-5,10,10);
          r.fillStyle='#fff6de';
          r.beginPath(); r.arc(sp.x,sp.y,1.5,0,Math.PI*2); r.fill();
          r.restore();
        }
      }
    }
    let pi=0;
    for(let i=rows.length-1;i>=0;i--){
      const row=rows[i];
      while(pi<prs.length && prs[pi].z>=row.z){ drawPracticalR(r,prs[pi],time); pi++; }
      const t=row.t;
      const cr=Math.round(lerp(pal.near[0],pal.far[0],t));
      const cg=Math.round(lerp(pal.near[1],pal.far[1],t));
      const cb=Math.round(lerp(pal.near[2],pal.far[2],t));
      const a=t>0.82 ? 1-(t-0.82)/0.18*0.75 : 1;
      r.fillStyle=`rgba(${cr},${cg},${cb},${a.toFixed(3)})`;
      r.beginPath(); r.moveTo(-60,H+60);
      row.pts.forEach(p=>r.lineTo(p[0],p[1]));
      r.lineTo(W+60,H+60); r.closePath(); r.fill();
      if(t>0.22&&t<0.6){
        r.strokeStyle=`rgba(${pal.rim[0]},${pal.rim[1]},${pal.rim[2]},${(pal.rimA*(1-t)).toFixed(3)})`;
        r.lineWidth=1.3;
        r.beginPath(); row.pts.forEach((p,j)=>j?r.lineTo(p[0],p[1]):r.moveTo(p[0],p[1])); r.stroke();
      }
    }
    while(pi<prs.length){ drawPracticalR(r,prs[pi],time); pi++; }
    if(!reduced){
      fogs.forEach(f=>{
        f.x+=f.v; if(f.x>W+f.w/2)f.x=-f.w/2; if(f.x<-f.w/2)f.x=W+f.w/2;
        let fg=r.createRadialGradient(f.x,f.y,0,f.x,f.y,f.w/2);
        fg.addColorStop(0,`rgba(${pal.fog[0]},${pal.fog[1]},${pal.fog[2]},${(f.a*pal.fogA).toFixed(3)})`);
        fg.addColorStop(1,`rgba(${pal.fog[0]},${pal.fog[1]},${pal.fog[2]},0)`);
        r.save(); r.scale(1,f.h/(f.w/2));
        r.fillStyle=fg;
        r.beginPath(); r.arc(f.x,f.y*(f.w/2)/f.h,f.w/2,0,Math.PI*2); r.fill();
        r.restore();
      });
    }
    r.drawImage(vigC,0,0,W,H);

    if(!w) return;
    /* WIREFRAME layer */
    w.clearRect(0,0,W,H);
    w.drawImage(baseW,0,0,W,H);
    pi=0; w.lineWidth=1;
    for(let i=rows.length-1;i>=0;i--){
      const row=rows[i];
      while(pi<prs.length && prs[pi].z>=row.z){ drawPracticalW(w,prs[pi]); pi++; }
      const t=row.t;
      w.fillStyle='#06090f';
      w.beginPath(); w.moveTo(-60,H+60);
      row.pts.forEach(p=>w.lineTo(p[0],p[1]));
      w.lineTo(W+60,H+60); w.closePath(); w.fill();
      w.strokeStyle=`rgba(111,183,201,${(0.5*(1-t)+0.08).toFixed(3)})`;
      w.beginPath(); row.pts.forEach((p,j)=>j?w.lineTo(p[0],p[1]):w.moveTo(p[0],p[1])); w.stroke();
      if(t<0.5){
        w.strokeStyle=`rgba(111,183,201,${(0.14*(1-t*2)).toFixed(3)})`;
        const vl=12*persp/row.d;
        w.beginPath();
        row.pts.forEach((p,j)=>{if(j%4===0){w.moveTo(p[0],p[1]);w.lineTo(p[0],p[1]+vl)}});
        w.stroke();
      }
    }
    while(pi<prs.length){ drawPracticalW(w,prs[pi]); pi++; }
    drawPracticalLabels(w,prs);
  }

  function buildScene(){
    const sr=(seed=>function(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296})(2026);
    faintField=Array.from({length:Math.floor(W*H/14000)},()=>({
      x:sr()*W, y:sr()*H*0.55, r:sr()*0.6+0.25
    }));
    vigC=document.createElement('canvas');
    vigC.width=W*DPR; vigC.height=H*DPR;
    const vc=vigC.getContext('2d'); vc.setTransform(DPR,0,0,DPR,0,0);
    let v=vc.createRadialGradient(W/2,H*0.5,Math.min(W,H)*0.3,W/2,H*0.5,Math.max(W,H)*0.85);
    v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(2,4,8,.6)');
    vc.fillStyle=v; vc.fillRect(0,0,W,H);
    fogs=[{x:W*0.3,y:H*0.74,w:W*0.7,h:H*0.06,v:0.12,a:0.10},
          {x:W*0.7,y:H*0.82,w:W*0.8,h:H*0.05,v:-0.08,a:0.08}];
    baseR=document.createElement('canvas');
    baseW=document.createElement('canvas');
    baseR.width=baseW.width=W*DPR; baseR.height=baseW.height=H*DPR;
    if(reduced){
      compR=document.createElement('canvas');
      compW=document.createElement('canvas');
      compR.width=compW.width=W*DPR; compR.height=compW.height=H*DPR;
    }
    buildSky();
  }

  function buildSky(){
    const moonR=Math.min(W,H)*0.07;
    const sunR=Math.min(W,H)*0.05;
    const mPos=skyXY(moon), sPos=skyXY(sun);
    const starIdx=projectStars(mPos,sPos,moonR,sunR);
    const moonUp=moon.alt>-2, sunUp=sun.alt>-2;
    const moonFade=clamp((moon.alt+2)/5,0,1);
    const sunFade=clamp((sun.alt+2)/5,0,1);
    const sunHigh=clamp(sun.alt/25,0,1);
    const sunRGB=mixC([255,150,80],[255,150,80],[255,246,220],0,1-sunHigh,sunHigh);
    const kelvin=Math.round((3200+(5600-3200)*sunHigh)/100)*100;

    const r=baseR.getContext('2d'); r.setTransform(DPR,0,0,DPR,0,0);
    r.clearRect(0,0,W,H);
    let sky=r.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,`rgb(${pal.sky[0]})`);
    sky.addColorStop(0.45,`rgb(${pal.sky[1]})`);
    sky.addColorStop(0.75,`rgb(${pal.sky[2]})`);
    sky.addColorStop(1,`rgb(${pal.sky[3]})`);
    r.fillStyle=sky; r.fillRect(0,0,W,H);

    if(pal.star>0.01){
      r.fillStyle='#dfe9f5'; r.globalAlpha=0.22*pal.star;
      faintField.forEach(s=>{r.beginPath();r.arc(s.x,s.y,s.r,0,Math.PI*2);r.fill()});
      r.globalAlpha=1;
      if(reduced){
        for(const st of skyStars){
          r.globalAlpha=clamp(1.05-st.m*0.16,0.22,1)*st.ext*pal.star;
          r.fillStyle=st.w?'#f2d8b4':'#dfe9f5';
          r.beginPath(); r.arc(st.x,st.y,Math.max(0.6,(3.1-st.m)*0.62),0,Math.PI*2); r.fill();
        }
        r.globalAlpha=1;
      }
    }
    if(sunUp){
      const cov=eclNow.solarCov;
      const sdim=1-0.85*ss(clamp((cov-0.5)/0.5,0,1));
      let sg=r.createRadialGradient(sPos.x,sPos.y,0,sPos.x,sPos.y,sunR*9);
      sg.addColorStop(0,`rgba(${sunRGB},${(0.6*sunFade*sdim).toFixed(3)})`);
      sg.addColorStop(0.15,`rgba(${sunRGB},${(0.28*sunFade*sdim).toFixed(3)})`);
      sg.addColorStop(0.5,`rgba(${sunRGB},${(0.08*sunFade*sdim).toFixed(3)})`);
      sg.addColorStop(1,`rgba(${sunRGB},0)`);
      r.fillStyle=sg; r.fillRect(0,0,W,H);
      r.globalAlpha=sunFade;
      r.fillStyle=`rgb(${mixC(sunRGB,sunRGB,[255,252,240],0,1-sunHigh,sunHigh)})`;
      r.beginPath(); r.arc(sPos.x,sPos.y,sunR,0,Math.PI*2); r.fill();
      r.globalAlpha=1;
      if(cov>0.01){
        const mR=sunR*(eclNow.solarTy==='A'?0.94:1.03);
        const sep=(sunR+mR)*(1-cov)*eclNow.solarDir;
        const ang=rad*(SOUTHERN?205:25);
        const ex=sPos.x+Math.cos(ang)*sep, ey=sPos.y+Math.sin(ang)*sep;
        if(cov>0.995&&eclNow.solarTy==='T'){
          let co=r.createRadialGradient(sPos.x,sPos.y,sunR*0.9,sPos.x,sPos.y,sunR*3.4);
          co.addColorStop(0,'rgba(235,242,250,.85)');
          co.addColorStop(0.25,'rgba(210,225,240,.30)');
          co.addColorStop(1,'rgba(200,215,235,0)');
          r.fillStyle=co; r.fillRect(0,0,W,H);
          r.fillStyle='#05070c';
          r.beginPath(); r.arc(sPos.x,sPos.y,sunR*1.02,0,Math.PI*2); r.fill();
          r.strokeStyle='rgba(245,250,255,.9)'; r.lineWidth=1.6;
          r.beginPath(); r.arc(sPos.x,sPos.y,sunR*1.04,0,Math.PI*2); r.stroke();
        }else{
          r.fillStyle='rgba(7,9,14,.97)';
          r.beginPath(); r.arc(ex,ey,mR,0,Math.PI*2); r.fill();
        }
      }
    }
    if(moonUp){
      const em=eclNow.lunarM;
      const lum=(0.35+0.65*(pal.nW+0.6*pal.tW))*moonFade;
      const glowK=(0.2+0.8*moon.frac)*(0.15+0.85*(pal.nW+0.4*pal.tW))*moonFade*(1-0.8*clamp(em,0,1));
      let glow=r.createRadialGradient(mPos.x,mPos.y,0,mPos.x,mPos.y,moonR*8);
      glow.addColorStop(0,`rgba(214,232,248,${(0.55*glowK).toFixed(3)})`);
      glow.addColorStop(0.15,`rgba(170,205,235,${(0.22*glowK).toFixed(3)})`);
      glow.addColorStop(0.5,`rgba(120,160,200,${(0.07*glowK).toFixed(3)})`);
      glow.addColorStop(1,'rgba(120,160,200,0)');
      r.fillStyle=glow; r.fillRect(0,0,W,H);
      if(em>0.4){
        const rk=clamp((em-0.4)/0.6,0,1)*moonFade;
        let rg=r.createRadialGradient(mPos.x,mPos.y,0,mPos.x,mPos.y,moonR*5);
        rg.addColorStop(0,`rgba(190,70,40,${(0.30*rk).toFixed(3)})`);
        rg.addColorStop(0.4,`rgba(150,50,30,${(0.10*rk).toFixed(3)})`);
        rg.addColorStop(1,'rgba(150,50,30,0)');
        r.fillStyle=rg; r.fillRect(0,0,W,H);
      }
      drawMoonDisc(r,mPos.x,mPos.y,moonR,moon.phase,
        'rgb(233,241,249)',lum,
        'rgb(28,38,52)',0.55*pal.nW*moonFade);
      if(em>0){
        const Ru=moonR*2.65;
        const d=Ru+moonR-2*moonR*em;
        const ua=rad*(SOUTHERN?160:-20);
        r.save();
        r.beginPath(); r.arc(mPos.x,mPos.y,moonR,0,Math.PI*2); r.clip();
        r.globalAlpha=0.93*moonFade;
        r.fillStyle = em>=1 ? 'rgb(122,34,20)' : 'rgb(96,26,16)';
        r.beginPath(); r.arc(mPos.x+Math.cos(ua)*d,mPos.y+Math.sin(ua)*d,Ru,0,Math.PI*2); r.fill();
        if(em>=1){
          let lg=r.createRadialGradient(mPos.x,mPos.y,moonR*0.2,mPos.x,mPos.y,moonR);
          lg.addColorStop(0,'rgba(150,48,26,.0)');
          lg.addColorStop(1,'rgba(214,96,52,.45)');
          r.fillStyle=lg;
          r.beginPath(); r.arc(mPos.x,mPos.y,moonR,0,Math.PI*2); r.fill();
        }
        r.restore();
      }
      r.globalAlpha=0.35*lum*clamp(moon.frac*1.5,0,1)*(1-0.7*clamp(em,0,1));
      r.fillStyle='rgb(170,190,210)';
      r.beginPath(); r.arc(mPos.x-moonR*0.3,mPos.y-moonR*0.15,moonR*0.22,0,Math.PI*2); r.fill();
      r.beginPath(); r.arc(mPos.x+moonR*0.25,mPos.y+moonR*0.3,moonR*0.15,0,Math.PI*2); r.fill();
      r.globalAlpha=1;
    }
    let hz=r.createLinearGradient(0,horY-H*0.08,0,horY+H*0.05);
    hz.addColorStop(0,`rgba(${pal.haze},0)`);
    hz.addColorStop(0.7,`rgba(${pal.haze},${pal.hazeA.toFixed(3)})`);
    hz.addColorStop(1,`rgba(${pal.haze},0)`);
    r.fillStyle=hz; r.fillRect(0,horY-H*0.08,W,H*0.13);

    /* WIREFRAME viewport chrome */
    const w=baseW.getContext('2d'); w.setTransform(DPR,0,0,DPR,0,0);
    w.clearRect(0,0,W,H);
    w.fillStyle='#06090f'; w.fillRect(0,0,W,H);
    w.strokeStyle='rgba(111,183,201,.07)'; w.lineWidth=1;
    const g=Math.max(W,H)/14;
    w.beginPath();
    for(let x=g;x<W;x+=g){w.moveTo(x,0);w.lineTo(x,H)}
    for(let y=g;y<H;y+=g){w.moveTo(0,y);w.lineTo(W,y)}
    w.stroke();
    w.fillStyle='rgba(111,183,201,.28)';
    faintField.forEach(s=>{w.fillRect(s.x-0.5,s.y-0.5,1,1)});
    w.font='9px "IBM Plex Mono",monospace';
    skyStars.forEach(st=>{
      const d2=clamp(1.9-st.m*0.32,0.8,2.0);
      w.fillStyle=`rgba(154,220,238,${(0.65*st.ext).toFixed(3)})`;
      w.fillRect(st.x-d2/2,st.y-d2/2,d2,d2);
    });
    w.strokeStyle='rgba(111,183,201,.42)'; w.lineWidth=1;
    AST.forEach(a=>{
      let any=false;
      w.beginPath();
      a.l.forEach(seg=>{
        const A=starIdx[seg[0]], B=starIdx[seg[1]];
        if(A&&B){w.moveTo(A.x,A.y);w.lineTo(B.x,B.y);any=true}
      });
      w.stroke();
      if(a.n&&any){
        const vis=a.m.map(i=>starIdx[i]).filter(Boolean);
        if(vis.length>=Math.ceil(a.m.length*0.6)){
          const cx=vis.reduce((s,p)=>s+p.x,0)/vis.length;
          const cy=Math.min.apply(null,vis.map(p=>p.y))-10;
          w.fillStyle='rgba(154,220,238,.72)';
          w.fillText(a.n,cx-w.measureText(a.n).width/2,cy);
        }
      }
    });
    if(issSamples.length && issUsable()){
      const pts=issSamples.map(sm=>{
        const lk=issLook(sm);
        return lk.alt>0 ? issScreen(lk) : null;
      });
      if(pts.some(Boolean)){
        w.strokeStyle='rgba(154,220,238,.4)'; w.lineWidth=1; w.setLineDash([2,5]);
        w.beginPath(); let pen=false;
        pts.forEach(q=>{ if(q){ pen?w.lineTo(q.x,q.y):w.moveTo(q.x,q.y); pen=true; } else pen=false; });
        w.stroke(); w.setLineDash([]);
        const cp=issAt(curMs);
        if(cp){
          const lk=issLook(cp), sp=issScreen(lk);
          if(sp){
            w.strokeStyle='rgba(255,243,214,.85)';
            w.strokeRect(sp.x-3,sp.y-3,6,6);
            w.beginPath();
            w.moveTo(sp.x-7,sp.y); w.lineTo(sp.x-3,sp.y);
            w.moveTo(sp.x+3,sp.y); w.lineTo(sp.x+7,sp.y);
            w.stroke();
            const st = sun.alt>=-6 ? 'DAYLIGHT' : issSunlit(cp) ? 'SUNLIT · VISIBLE' : 'IN SHADOW';
            w.fillStyle='rgba(255,243,214,.7)';
            w.fillText(`ISS · 25544 · ALT ${lk.alt>=0?'+':''}${lk.alt.toFixed(0)}° · ${st}`, sp.x+11, sp.y-6);
          }
        }
      }
    }
    const ad=activeDate();
    const MO=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    w.fillStyle='rgba(154,220,238,.45)';
    w.fillText(
      `CAM HDG ${String(camRef).padStart(3,'0')}° ${camRef===0?'N':'S'} · `+
      `LAT ${LOC.lat.toFixed(1)} LON ${LOC.lon.toFixed(1)} · `+
      `${ad.getDate()} ${MO[ad.getMonth()]} ${ad.getFullYear()}`, 16, H-16);

    if(moonUp && eclNow.solarCov<=0.3){
      const p=SOUTHERN?1-moon.phase:moon.phase;
      const cosT=Math.cos(2*Math.PI*p);
      w.strokeStyle='rgba(154,220,238,.8)'; w.lineWidth=1.2;
      w.beginPath(); w.arc(mPos.x,mPos.y,moonR,0,Math.PI*2); w.stroke();
      w.strokeStyle='rgba(154,220,238,.45)';
      w.beginPath(); w.ellipse(mPos.x,mPos.y,Math.max(0.5,moonR*Math.abs(cosT)),moonR,0,0,Math.PI*2); w.stroke();
      w.setLineDash([3,5]);
      w.beginPath(); w.arc(mPos.x,mPos.y,moonR*1.8,0,Math.PI*2); w.stroke();
      w.setLineDash([]);
      w.fillStyle='rgba(154,220,238,.6)';
      w.fillText(`LUNA · ${phaseName(moon.phase)} ${Math.round(moon.frac*100)}%`, mPos.x+moonR*1.9+8, mPos.y-4);
      w.fillText(`ALT ${moon.alt>=0?'+':''}${moon.alt.toFixed(0)}° · AZ ${moon.az.toFixed(0)}°`, mPos.x+moonR*1.9+8, mPos.y+10);
      if(eclNow.lunarM>0){
        const Ru=moonR*2.65, d=Ru+moonR-2*moonR*eclNow.lunarM, ua=rad*(SOUTHERN?160:-20);
        w.strokeStyle='rgba(214,96,52,.55)'; w.setLineDash([4,6]);
        w.beginPath(); w.arc(mPos.x+Math.cos(ua)*d,mPos.y+Math.sin(ua)*d,Ru,0,Math.PI*2); w.stroke();
        w.setLineDash([]);
        w.fillStyle='rgba(214,96,52,.85)';
        w.fillText(`UMBRA · ${eclNow.lunarM>=1?'TOTAL':'PARTIAL'} LUNAR ECLIPSE · MAG ${eclNow.lunarM.toFixed(2)}`, mPos.x+moonR*1.9+8, mPos.y+24);
      }else if(!sunUp){
        w.fillText('LUNA_KEY · 5600K', mPos.x+moonR*1.9+8, mPos.y+24);
      }
    }
    if(sunUp){
      w.strokeStyle='rgba(201,141,87,.85)'; w.lineWidth=1.2;
      w.beginPath(); w.arc(sPos.x,sPos.y,sunR,0,Math.PI*2); w.stroke();
      w.beginPath();
      w.moveTo(sPos.x-sunR-7,sPos.y); w.lineTo(sPos.x+sunR+7,sPos.y);
      w.moveTo(sPos.x,sPos.y-sunR-7); w.lineTo(sPos.x,sPos.y+sunR+7);
      w.stroke();
      w.fillStyle='rgba(201,141,87,.75)';
      w.fillText(`SOL_KEY · ${kelvin}K`, sPos.x+sunR+12, sPos.y+3);
      w.fillText(`ALT ${sun.alt>=0?'+':''}${sun.alt.toFixed(0)}° · AZ ${sun.az.toFixed(0)}°`, sPos.x+sunR+12, sPos.y+17);
      if(eclNow.solarCov>0.01){
        w.fillStyle='rgba(214,96,52,.9)';
        w.fillText(`${eclNow.solarTy==='T'?'TOTAL':'ANNULAR'} SOLAR ECLIPSE · OBSCURATION ${(eclNow.solarCov*100).toFixed(0)}%`, sPos.x+sunR+12, sPos.y+31);
      }
    }

    if(reduced){
      camZ=0; swayX=0; bobY=0;
      const cr=compR.getContext('2d'); cr.setTransform(DPR,0,0,DPR,0,0);
      const cw=compW.getContext('2d'); cw.setTransform(DPR,0,0,DPR,0,0);
      cr.clearRect(0,0,W,H); cw.clearRect(0,0,W,H);
      drawScene(cr, useWire?cw:null, 0);
    }
  }

  function size(){
    W=root.clientWidth; H=root.clientHeight;
    if(W<2||H<2) return;
    // Cap the backing-store edge just under the universal GPU max-texture size (4096) so the canvas
    // is never clamped on one axis (which stretches circles into ellipses), while staying high enough
    // to render crisp — native 2× on a 1920 display, a sharp down-scale on 2560/3440. The matching
    // ResizeObserver (see boot) re-syncs the buffer to the box whenever layout settles, which is the
    // real cure for the aspect-mismatch stretch.
    const MAX_EDGE = 3840;
    // Cap Safari a notch lower than Chrome (1.5 vs 2): ~44% fewer pixels per
    // frame, still crisp, so its slower Canvas 2D fill keeps up. Chrome unchanged.
    const DPR_CAP = IS_SAFARI ? 1.5 : 2;
    DPR = Math.min(devicePixelRatio || 1, DPR_CAP, MAX_EDGE / Math.max(W, H));
    persp=H*0.155; horY=H*0.50;
    [cvR,cvW].forEach(c=>{c.width=Math.round(W*DPR);c.height=Math.round(H*DPR);c.getContext('2d').setTransform(DPR,0,0,DPR,0,0)});
    buildScene();
    mx=lx=W*0.5; my=ly=H*0.42;
  }

  function updateHud(){
    const hh=String(Math.floor(todMin/60)).padStart(2,'0');
    const mm=String(todMin%60).padStart(2,'0');
    if(todClock){
      if(seasonSel||eclSel){
        const ad=activeDate();
        const MO=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        todClock.textContent=`${hh}:${mm} · ${ad.getDate()} ${MO[ad.getMonth()]}`;
      }else{
        todClock.textContent=`${hh}:${mm} LOCAL`;
      }
    }
    if(todPhase) todPhase.textContent=`${phaseName(moon.phase)} · ${Math.round(moon.frac*100)}% · ALT ${moon.alt>=0?'+':''}${moon.alt.toFixed(0)}°`;
    if(hudScene) hudScene.textContent=sceneLabel ? sceneLabel.replace('{BUCKET}',sceneBucket()) : `SCENE 014 · ${sceneBucket()}`;
    if(moonChip){
      const mc=moonChip.getContext('2d');
      mc.clearRect(0,0,32,32);
      drawMoonDisc(mc,16,16,13,moon.phase,'#e9f1f9',1,'#1a2330',1);
      mc.strokeStyle='rgba(154,220,238,.6)'; mc.lineWidth=1.5;
      mc.beginPath(); mc.arc(16,16,13,0,Math.PI*2); mc.stroke();
    }
  }
  function applyTime(){
    computeAstro(); computePalette(); buildSky(); updateHud(); applyPageTint();
    if(skySeed){ try{ sessionStorage.setItem('vfxSky',
      JSON.stringify({live:live, min:todMin, season:seasonSel})); }catch(e){} }
  }
  function buildTrack(){
    if(!todRange) return;
    const day=activeDate(); day.setHours(0,0,0,0);
    const stops=[];
    for(let i=0;i<=48;i++){
      const d=toDays(day.getTime()+i*1800000);
      const a=azAlt(d,LOC.lat,LOC.lon,sunCoords(d)).alt;
      const col=a>4?'#9adcee':a>-7?'#c98d57':'#1b2738';
      stops.push(`${col} ${(i/48*100).toFixed(1)}%`);
    }
    todRange.style.setProperty('--track',`linear-gradient(90deg,${stops.join(',')})`);
  }

  /* ---------- tod wiring (only when the panel exists) ---------- */
  if(useTod){
    todEl.querySelectorAll('.tod-seasons button').forEach(b=>{
      b.addEventListener('click',()=>{
        const s=b.dataset.season;
        seasonSel = seasonSel===s ? null : s;
        eclSel=null; if(todEclBtn) todEclBtn.classList.remove('on');
        todEl.querySelectorAll('.tod-seasons button')
          .forEach(x=>x.classList.toggle('on',x.dataset.season===seasonSel));
        applyTime(); buildTrack();
      });
    });
    const nextEcl=nextVisibleEclipse();
    if(nextEcl && todEclBtn){
      const ld=new Date(nextEcl.t);
      const MO=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      todEclBtn.hidden=false;
      todEclBtn.textContent=`◐ NEXT IN YOUR SKY ▸ ${nextEcl.label} · ${ld.getDate()} ${MO[ld.getMonth()]} ${String(ld.getFullYear()).slice(2)}`;
      todEclBtn.addEventListener('click',()=>{
        if(eclSel){ eclSel=null; todEclBtn.classList.remove('on'); }
        else{
          eclSel=nextEcl; seasonSel=null;
          todEl.querySelectorAll('.tod-seasons button').forEach(x=>x.classList.remove('on'));
          live=false; if(todLive) todLive.classList.remove('on');
          const lt=new Date(nextEcl.t);
          todMin=lt.getHours()*60+lt.getMinutes();
          if(todRange) todRange.value=todMin;
          todEclBtn.classList.add('on');
        }
        applyTime(); buildTrack();
      });
    }
    function syncNow(){
      const n=new Date();
      todMin=n.getHours()*60+n.getMinutes();
      if(todRange) todRange.value=todMin;
      applyTime();
    }
    let todPend=false;
    if(todRange){
      todRange.addEventListener('input',()=>{
        live=false; if(todLive) todLive.classList.remove('on');
        todMin=+todRange.value;
        if(!todPend){
          todPend=true;
          requestAnimationFrame(()=>{todPend=false; applyTime();});
        }
      });
    }
    if(todLive){
      todLive.addEventListener('click',()=>{
        live=true; todLive.classList.add('on');
        eclSel=null; if(todEclBtn) todEclBtn.classList.remove('on');
        syncNow(); buildTrack();
      });
    }
    setInterval(()=>{
      if(!live) return;
      if(issSamples.length && issUsable() && Date.now()>issWindow[1]-150000) fetchISS(Date.now());
      const n=new Date(), m=n.getHours()*60+n.getMinutes();
      if(m!==todMin) syncNow();
    },30000);
  }

  /* ---------- the loop ---------- */
  let frameN=0, lastT=0;
  /* one-shot reveal demo: sweep the lens once across the frame using the
     same drift maths the idle camera uses, so the wireframe reveal is
     demonstrated without input. Parks at centre when done. */
  function startSweep(){
    if(sweepDone||sweep||!useLens) return;
    sweepDone=true;
    if(reduced){
      /* reduced motion: skip the animated sweep but still park a static lens
         off-centre so keyboard users see the wireframe revealed. */
      mx=W*0.5+W*0.18; my=H*0.42; lx=mx; ly=my;
      return;
    }
    sweep={t:0};
    userDriving=false; lastInput=performance.now()-10000;
  }
  function frame(t){
    // Keep the loop ALIVE but skip drawing until the first successful size() has built the scene.
    // A viewport inside a CSS grid (the reel) can report a 0-size box at init, so size() early-returns
    // and the scene buffer (baseR) is never built; drawing then calls drawImage(null) and THROWS,
    // killing the loop on frame 1 (the reel-viewport freeze). The ResizeObserver re-runs size() once
    // the grid resolves the box, and the very next frame draws normally. Resilient by construction.
    if(!baseR || W<2 || H<2){ rafId=requestAnimationFrame(frame); return; }
    frameN++;
    const dt=Math.min(50,t-lastT||16)/1000; lastT=t;
    if(!reduced){
      camZ+=SPEED*dt;
      swayX=Math.sin(t*0.00013)*46;
      bobY=Math.sin(t*0.0005)*3;
    }
    if(sweep){
      sweep.t+=0.018;
      const e=sweep.t;
      mx=W*0.5 + Math.sin(e*Math.PI*2)*W*0.30;
      my=H*0.42 + Math.sin(e*Math.PI*2*0.7+1.3)*H*0.14;
      if(e>=1){ sweep=null; mx=W*0.5; my=H*0.42; lastInput=t-5000;
        driftT=Math.asin(0)||0; }
    }else if(useLens && !reduced && !userDriving && t-lastInput>3200){
      driftT+=0.004;
      mx=W*0.5 + Math.sin(driftT)*W*0.26;
      my=H*0.42 + Math.sin(driftT*0.7+1.3)*H*0.16;
    }
    if(useLens){
      lx+=(mx-lx)*(reduced?1:0.2);
      ly+=(my-ly)*(reduced?1:0.2);
      const lr = Math.min(W,H)*0.22*(innerWidth<900?0.85:1);
      if(lensEl){
        lensEl.style.left=lx+'px'; lensEl.style.top=ly+'px';
        lensEl.style.width=lr*2+'px'; lensEl.style.height=lr*2+'px';
      }
    }
    if(reduced){
      ctxR.clearRect(0,0,W,H); ctxR.drawImage(compR,0,0,W,H);
      if(useWire){ ctxW.clearRect(0,0,W,H); ctxW.drawImage(compW,0,0,W,H); }
    }else{
      drawScene(ctxR, useWire?ctxW:null, t);
    }
    if(useWire && useLens){
      const lr = Math.min(W,H)*0.22*(innerWidth<900?0.85:1);
      ctxW.save();
      ctxW.globalCompositeOperation='destination-in';
      let keep=ctxW.createRadialGradient(lx,ly,lr*0.62,lx,ly,lr);
      keep.addColorStop(0,'rgba(0,0,0,1)');
      keep.addColorStop(1,'rgba(0,0,0,0)');
      ctxW.fillStyle=keep;
      ctxW.fillRect(0,0,W,H);
      ctxW.restore();
    }
    if(hudTc && frameN%2===0){
      const f=frameN%24, s=Math.floor(frameN/24)%60, m=Math.floor(frameN/1440)%60;
      hudTc.textContent=`TC 00:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(f).padStart(2,'0')}`;
    }
    rafId=requestAnimationFrame(frame);
  }
  function resume(){ if(!rafId && !paused){ lastT=0; rafId=requestAnimationFrame(frame); } }

  /* fade the scrub-hint out on the first genuine user input */
  function killHint(){
    if(hintGone) return; hintGone=true;
    const hint=root.querySelector('.scrub-hint');
    if(hint) hint.classList.add('gone');
  }
  function input(cx,cy){
    sweep=null;                       // user takes over from the demo immediately
    killHint();
    const r=root.getBoundingClientRect();
    mx=cx-r.left; my=cy-r.top;
    userDriving=true; lastInput=performance.now();
    clearTimeout(input._t);
    input._t=setTimeout(()=>{userDriving=false; driftT=Math.asin(Math.min(1,Math.max(-1,(mx-W*0.5)/(W*0.26))))||0;},3200);
  }
  /* the hero stays passive (its gesture coexists with page scroll); only the
     framed .bd-viewport / .reel-viewport capture the touch so a drag drives
     the lens instead of scrolling the page. */
  const captureTouch = useLens && interactive && !tintPage;
  if(useLens && interactive){
    root.addEventListener('mousemove',e=>input(e.clientX,e.clientY),{passive:true});
    if(captureTouch){
      root.style.touchAction='none';
      root.addEventListener('touchstart',e=>{input(e.touches[0].clientX,e.touches[0].clientY)},{passive:true});
      root.addEventListener('touchmove',e=>{
        e.preventDefault();
        input(e.touches[0].clientX,e.touches[0].clientY);
      },{passive:false});
    }else{
      root.addEventListener('touchmove',e=>input(e.touches[0].clientX,e.touches[0].clientY),{passive:true});
      root.addEventListener('touchstart',e=>input(e.touches[0].clientX,e.touches[0].clientY),{passive:true});
    }
  }

  /* ---------- boot ---------- */
  addEventListener('resize',size);
  // Re-sync the backing store to the element's ACTUAL box whenever it changes (fonts/layout settling,
  // aspect-ratio resolving, container resize). Without this, a canvas measured a hair too early keeps a
  // wrong buffer aspect → permanent vertical stretch on some machines. Debounced; size() doesn't alter
  // layout so there's no feedback loop.
  if(window.ResizeObserver){
    let roT=0, roW=0, roH=0;
    const ro=new ResizeObserver(()=>{
      if(Math.abs(root.clientWidth-roW)<1 && Math.abs(root.clientHeight-roH)<1) return;
      roW=root.clientWidth; roH=root.clientHeight;
      clearTimeout(roT); roT=setTimeout(size,120);
    });
    ro.observe(root);
  }
  computeAstro(); computePalette();
  if(todRange) todRange.value=todMin;
  if(useTod && todLive){ todLive.classList.toggle('on',live); }
  size();
  updateHud(); buildTrack(); applyPageTint();

  /* a11y + keyboard path: lens viewports are a focusable group; focusing one
     runs the same reveal sweep keyboard users can't trigger with a drag. */
  if(useLens){
    if(!root.hasAttribute('tabindex')) root.tabIndex=0;
    root.setAttribute('role','group');
    if(!root.hasAttribute('aria-label'))
      root.setAttribute('aria-label','Final render with a wireframe lens — drag, or focus, to reveal the wireframe underneath');
    root.addEventListener('focus',()=>{ killHint(); startSweep(); });
    root.addEventListener('keydown',e=>{
      if(e.key===' '||e.key==='Enter'){ e.preventDefault(); sweepDone=false; sweep=null; startSweep(); }
    });
  }

  /* PERF: the loop STARTS immediately; an IntersectionObserver only pauses it when the viewport
     scrolls off-screen (resuming on return). A previous version started the loop FROM the observer,
     which left any instance the first callback missed — e.g. the reel viewport, a grid cell that
     lays out a frame late — permanently unstarted (blank, frozen lens). Start-always is robust. */
  /* The loop runs continuously — robust by design. We deliberately do NOT pause it on scroll: an
     observer-driven pause repeatedly froze instances whose first callback raced layout (the reel
     viewport, a grid cell that resolves a frame late). The DPR cap keeps each frame cheap and the
     site has only a handful of viewports, so always-on is fine. A lightweight observer is used ONLY
     to trigger the one-shot reveal sweep when a lens viewport first scrolls into view — it never
     touches the run state, so the loop can never be left frozen. */
  rafId=requestAnimationFrame(frame);
  if(useLens){
    if('IntersectionObserver' in window){
      let swept=false;
      const vis=new IntersectionObserver(es=>es.forEach(e=>{
        if(e.isIntersecting && !swept){ swept=true; startSweep(); }
      }),{threshold:0.2});
      vis.observe(root);
    } else { startSweep(); }
  }
}

/* ============================================================
   STATIC SHOT FRAME — one-shot procedural still for thumbnails
   (work cards, reel playlist, studio). Shares the terrain/moon
   math but draws once, no animation loop. mood ∈ night|dawn|dusk|day.
   opts: {mood, wire, seed}
   ============================================================ */
function paintStill(el, opts){
  opts=opts||{};
  const mood=opts.mood||'night';
  const wire=!!opts.wire;
  let seed=(opts.seed||1)>>>0;
  const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const DPR=Math.min(devicePixelRatio||1,2);
  let W=el.clientWidth||el.offsetWidth, H=el.clientHeight||el.offsetHeight;
  if(W<2||H<2){ W=W||320; H=H||180; }
  let cv=el.querySelector('canvas.cvStill');
  if(!cv){ cv=document.createElement('canvas'); cv.className='cvStill'; el.insertBefore(cv,el.firstChild); }
  cv.width=W*DPR; cv.height=H*DPR;
  const r=cv.getContext('2d'); r.setTransform(DPR,0,0,DPR,0,0);
  r.clearRect(0,0,W,H);
  const p=PAL[mood]||PAL.night;

  /* sky */
  let sky=r.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,`rgb(${p.sky[0]})`);
  sky.addColorStop(0.45,`rgb(${p.sky[1]})`);
  sky.addColorStop(0.78,`rgb(${p.sky[2]})`);
  sky.addColorStop(1,`rgb(${p.sky[3]})`);
  r.fillStyle=sky; r.fillRect(0,0,W,H);

  const horY=H*0.54, persp=H*0.17, NEAR=26, FAR=Math.max(360,W*0.9), ALT=118;
  const zoff=opts.seed?opts.seed*53.7:0;

  /* stars */
  if(p.star>0.05){
    for(let i=0;i<Math.floor(W*H/2600);i++){
      const m=rng()*3, x=rng()*W, y=rng()*horY*0.96;
      r.globalAlpha=clamp(1.05-m*0.16,0.18,1)*p.star;
      r.fillStyle=rng()<0.2?'#f2d8b4':'#dfe9f5';
      r.beginPath(); r.arc(x,y,Math.max(0.5,(3.1-m)*0.5),0,Math.PI*2); r.fill();
    }
    r.globalAlpha=1;
  }
  /* moon (night/dawn/dusk) */
  if(p.star>0.2){
    const mr=Math.min(W,H)*0.066, mx=W*(0.18+rng()*0.6), my=horY*(0.3+rng()*0.4);
    let glow=r.createRadialGradient(mx,my,0,mx,my,mr*7);
    glow.addColorStop(0,'rgba(214,232,248,.42)');
    glow.addColorStop(0.16,'rgba(170,205,235,.16)');
    glow.addColorStop(1,'rgba(120,160,200,0)');
    r.fillStyle=glow; r.fillRect(0,0,W,H);
    drawMoonDisc(r,mx,my,mr,0.18+rng()*0.64,'rgb(233,241,249)',0.92,'rgb(28,38,52)',0.4);
  }

  /* terrain rows far -> near */
  const rows=[];
  for(let d=FAR; d>=NEAR; d-=14){
    const s=persp/d, pts=[];
    const step=Math.max(12,W/46);
    for(let sx=-20;sx<=W+20+step;sx+=step){
      const xw=(sx-W/2)/s;
      pts.push([sx, horY+(ALT-terrain(xw,d+zoff))*s]);
    }
    rows.push({d,s,t:clamp((d-NEAR)/(FAR-NEAR),0,1),pts});
  }
  rows.forEach(row=>{
    const t=row.t;
    const cr=Math.round(lerp(p.near[0],p.far[0],t));
    const cg=Math.round(lerp(p.near[1],p.far[1],t));
    const cb=Math.round(lerp(p.near[2],p.far[2],t));
    r.fillStyle=`rgb(${cr},${cg},${cb})`;
    r.beginPath(); r.moveTo(-30,H+30);
    row.pts.forEach(pt=>r.lineTo(pt[0],pt[1]));
    r.lineTo(W+30,H+30); r.closePath(); r.fill();
    if(t>0.18&&t<0.62){
      r.strokeStyle=`rgba(${p.rim[0]},${p.rim[1]},${p.rim[2]},${(p.rimA*(1-t)).toFixed(3)})`;
      r.lineWidth=1.2;
      r.beginPath(); row.pts.forEach((pt,j)=>j?r.lineTo(pt[0],pt[1]):r.moveTo(pt[0],pt[1])); r.stroke();
    }
  });
  /* a couple of practicals */
  if(p.prac>0.05){
    for(let i=0;i<2;i++){
      const px=W*(0.2+rng()*0.6), py=horY+H*(0.04+rng()*0.16);
      let g=r.createRadialGradient(px,py,0,px,py,22);
      g.addColorStop(0,`rgba(255,176,96,${(0.5*p.prac).toFixed(3)})`);
      g.addColorStop(0.34,`rgba(222,132,72,${(0.18*p.prac).toFixed(3)})`);
      g.addColorStop(1,'rgba(222,132,72,0)');
      r.fillStyle=g; r.fillRect(px-22,py-22,44,44);
      r.fillStyle='#ffce8a'; r.globalAlpha=p.prac;
      r.beginPath(); r.arc(px,py,1.4,0,Math.PI*2); r.fill(); r.globalAlpha=1;
    }
  }
  /* wireframe overlay (the left/under half on cards) */
  if(wire){
    r.save();
    r.strokeStyle='rgba(111,183,201,.10)'; r.lineWidth=1;
    const gs=Math.max(W,H)/12;
    r.beginPath();
    for(let x=gs;x<W;x+=gs){r.moveTo(x,0);r.lineTo(x,H)}
    for(let y=gs;y<H;y+=gs){r.moveTo(0,y);r.lineTo(W,y)}
    r.stroke();
    rows.filter((_,i)=>i%2===0).forEach(row=>{
      r.strokeStyle=`rgba(111,183,201,${(0.36*(1-row.t)+0.06).toFixed(3)})`;
      r.beginPath(); row.pts.forEach((pt,j)=>j?r.lineTo(pt[0],pt[1]):r.moveTo(pt[0],pt[1])); r.stroke();
    });
    r.restore();
  }
  /* vignette */
  let v=r.createRadialGradient(W/2,H*0.5,Math.min(W,H)*0.28,W/2,H*0.5,Math.max(W,H)*0.82);
  v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(2,4,8,.55)');
  r.fillStyle=v; r.fillRect(0,0,W,H);
}

/* ============================================================
   Page chrome: nav scroll state, mobile menu, scroll reveals.
   Wired once per page.
   ============================================================ */
/* P2: opt-in ambient sound for the home hero. OFF by default, started only on a real click
   (browser autoplay rules + good manners), built procedurally with Web Audio — a slow-swept
   wind bed + a faint low drone. No audio files; nothing plays until the visitor asks. */
function initAmbient(){
  const hero=document.querySelector('.hero[data-tint]');
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!hero||!AC||hero.querySelector('.fx-sound')) return;
  const btn=document.createElement('button');
  btn.type='button'; btn.className='fx-sound';
  btn.setAttribute('aria-pressed','false'); btn.setAttribute('aria-label','Toggle ambient sound');
  btn.innerHTML='<span class="ic" aria-hidden="true">♪</span><span class="lbl">SOUND OFF</span>';
  hero.appendChild(btn);
  let ctx=null, master=null, nodes=[], on=false;
  function start(){
    try{
      ctx=new AC();
      master=ctx.createGain(); master.gain.value=0; master.connect(ctx.destination);
      const buf=ctx.createBuffer(1, ctx.sampleRate*4, ctx.sampleRate), d=buf.getChannelData(0);
      let last=0;
      for(let i=0;i<d.length;i++){ const w=Math.random()*2-1; last=(last+0.02*w)/1.02; d[i]=last*3.2; }
      const src=ctx.createBufferSource(); src.buffer=buf; src.loop=true;
      const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=420;
      const lfo=ctx.createOscillator(); lfo.frequency.value=0.07;
      const lg=ctx.createGain(); lg.gain.value=180; lfo.connect(lg); lg.connect(lp.frequency);
      const wind=ctx.createGain(); wind.gain.value=0.5;
      src.connect(lp); lp.connect(wind); wind.connect(master);
      const osc=ctx.createOscillator(); osc.type='sine'; osc.frequency.value=58;
      const og=ctx.createGain(); og.gain.value=0.045; osc.connect(og); og.connect(master);
      src.start(); lfo.start(); osc.start(); nodes=[src,lfo,osc];
      master.gain.setTargetAtTime(0.09, ctx.currentTime, 0.9);   // gentle fade-in
    }catch(e){ ctx=null; }
  }
  function stop(){
    if(!ctx) return; const c=ctx, ns=nodes; ctx=null;
    try{ master.gain.setTargetAtTime(0.0001, c.currentTime, 0.35); }catch(e){}
    setTimeout(()=>{ try{ ns.forEach(n=>n.stop&&n.stop()); c.close(); }catch(e){} }, 700);
  }
  btn.addEventListener('click',()=>{
    on=!on;
    btn.classList.toggle('on',on);
    btn.setAttribute('aria-pressed', on?'true':'false');
    btn.querySelector('.lbl').textContent = on?'SOUND ON':'SOUND OFF';
    if(on) start(); else stop();
  });
}

/* Gallery lightbox: click (or Enter/Space) a .gallery .shot to magnify the frame full-screen,
   then ←/→ to step through and Esc/✕/backdrop to close. Keyboard-accessible. */
function initLightbox(){
  const shots=[].slice.call(document.querySelectorAll('.gallery .shot'));
  if(!shots.length || document.querySelector('.lightbox')) return;
  const items=shots.map(s=>{
    const img=s.querySelector('img'), cap=s.querySelector('figcaption');
    return {src:img?img.currentSrc||img.src:'', cap:cap?cap.innerHTML:''};
  });
  const lb=document.createElement('div');
  lb.className='lightbox'; lb.setAttribute('role','dialog'); lb.setAttribute('aria-modal','true');
  lb.setAttribute('aria-label','Image viewer'); lb.hidden=true;
  lb.innerHTML='<button class="lb-close" type="button" aria-label="Close">✕</button>'+
    '<button class="lb-nav lb-prev" type="button" aria-label="Previous frame">‹</button>'+
    '<button class="lb-nav lb-next" type="button" aria-label="Next frame">›</button>'+
    '<figure><img alt=""><figcaption></figcaption></figure>'+
    '<span class="lb-count" aria-hidden="true"></span>';
  document.body.appendChild(lb);
  const lbImg=lb.querySelector('img'), lbCap=lb.querySelector('figcaption'), lbCount=lb.querySelector('.lb-count');
  let idx=0, lastFocus=null;
  function show(i){
    idx=(i+items.length)%items.length;
    lbImg.src=items[idx].src; lbCap.innerHTML=items[idx].cap;
    lbCount.textContent=(idx+1)+' / '+items.length;
  }
  function open(i){
    lastFocus=document.activeElement; show(i);
    lb.hidden=false; lb.classList.add('open'); document.body.style.overflow='hidden';
    lb.querySelector('.lb-close').focus();
  }
  function close(){
    lb.classList.remove('open'); lb.hidden=true; document.body.style.overflow=''; lbImg.removeAttribute('src');
    if(lastFocus&&lastFocus.focus) lastFocus.focus();
  }
  shots.forEach((s,i)=>{
    s.setAttribute('tabindex','0'); s.setAttribute('role','button'); s.setAttribute('aria-label','View larger');
    s.addEventListener('click',()=>open(i));
    s.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(i); } });
  });
  lb.querySelector('.lb-close').addEventListener('click',close);
  lb.querySelector('.lb-prev').addEventListener('click',e=>{ e.stopPropagation(); show(idx-1); });
  lb.querySelector('.lb-next').addEventListener('click',e=>{ e.stopPropagation(); show(idx+1); });
  lb.addEventListener('click',e=>{ if(e.target===lb) close(); });
  addEventListener('keydown',e=>{
    if(lb.hidden) return;
    if(e.key==='Escape') close();
    else if(e.key==='ArrowLeft') show(idx-1);
    else if(e.key==='ArrowRight') show(idx+1);
  });
}

function initChrome(){
  const nav=document.getElementById('nav')||document.querySelector('nav');
  if(nav){
    const onScroll=()=>nav.classList.toggle('scrolled',scrollY>40);
    addEventListener('scroll',onScroll,{passive:true}); onScroll();
    const menuBtn=nav.querySelector('.menu-btn');
    const menu=document.querySelector('.mobile-menu');
    if(menuBtn&&menu){
      const setExpanded=open=>menuBtn.setAttribute('aria-expanded',open?'true':'false');
      setExpanded(menu.classList.contains('open'));
      menuBtn.addEventListener('click',()=>setExpanded(menu.classList.toggle('open')));
      menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{
        menu.classList.remove('open'); setExpanded(false);
      }));
    }
  }
  /* P2: faint film-grain laid over the whole page (decorative, never blocks input) */
  if(!document.querySelector('.fx-grain')){
    const g=document.createElement('div'); g.className='fx-grain'; g.setAttribute('aria-hidden','true');
    document.body.appendChild(g);
  }
  initAmbient();   // opt-in ambient sound on the home hero (off by default)
  initLightbox();  // click a gallery frame to magnify it (work page)
  /* announce clock / phase changes politely to assistive tech */
  document.querySelectorAll('.tod-head').forEach(h=>{
    if(!h.hasAttribute('aria-live')) h.setAttribute('aria-live','polite');
  });
  // Graceful degradation: if IntersectionObserver is unavailable, reveal everything immediately
  // (content must never stay invisible because the scroll-in observer couldn't run).
  if(!('IntersectionObserver' in window)){
    document.querySelectorAll('.reveal').forEach(el=>el.classList.add('in'));
    return;
  }
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:0.12});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
}

/* ---------- declarative auto-init: scan [data-fly] + [data-still] ---------- */
function paintStills(){
  document.querySelectorAll('[data-still]').forEach(el=>{
    const d=el.dataset;
    paintStill(el,{mood:d.mood||'night', wire:d.wire!==undefined, seed:d.seed!==undefined?parseInt(d.seed,10):(Math.abs(hashStr(el.dataset.seedkey||el.id||el.className))||1)});
  });
}
function hashStr(s){let h=0;for(let i=0;i<(s||'').length;i++){h=(Math.imul(31,h)+s.charCodeAt(i))|0}return h>>>0}
function bootAll(){
  initChrome();
  document.querySelectorAll('[data-fly]').forEach(el=>{
    const d=el.dataset;
    initFlythrough({
      root:el,
      lens: d.lens!==undefined,
      iss: d.iss!==undefined,
      tintPage: d.tint!==undefined,
      interactive: d.interactive!==undefined ? true : undefined,
      defaultMin: d.min!==undefined ? parseInt(d.min,10) : undefined,
      season: d.season||undefined,
      scene: d.scene||undefined,
      speed: d.speed!==undefined ? parseFloat(d.speed) : undefined
    });
  });
  paintStills();
  /* repaint stills on resize (debounced) — animated heroes handle their own resize */
  let rt=null;
  addEventListener('resize',()=>{clearTimeout(rt); rt=setTimeout(paintStills,180);},{passive:true});
}
if(document.readyState==='loading') addEventListener('DOMContentLoaded',bootAll);
else bootAll();

/* expose for manual use */
window.VFXM={initFlythrough,initChrome,paintStill,paintStills};
})();
