/* ═══════════════════════════════════════════════════════════
   ვეფხისტყაოსანი — B version · scroll-owned scene compositor
   ───────────────────────────────────────────────────────────
   The page is a tall empty track. Scroll position is read as a
   point on a timeline of dwells (a scene held still, slowly
   pushing in) and transitions (one scene becoming the next).
   One WebGL shader draws every transition; each has its own mode,
   taken from the reference:

     1 paper-ink   zoom into the scroll → parchment → the next scene
                   inks in from the left in sepia → colour blooms
     2 bloom       new scene spreads from a point with a ragged,
                   wet edge (from the crown)
     3 ripple      rings spread from the water and carry the next
                   scene with them
     4 wind        a streaked sweep, right to left, sand at its edge
     5 rise        the next scene rises from below
     6 whiteout    over-exposure and defocus, then refocus
     7 blade       a steel flash cuts the frame diagonally
     8 light       light opens from the gate and floods the frame
     9 to-paper    zoom into the scroll until only parchment is left
    10 fade        plain cross-fade (reduced motion, no WebGL)

   Nothing advances unless the reader scrolls.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── content ───────────────────────────────────────────── */
  // focus: where the subject sits (image uv, top-left origin) — used
  // when a tall screen has to crop the painting.
  var SCENES = [
    { img: '00-prologue', focus: [0.50, 0.45], amb: [[108,141,160], [141,124, 99]] },
    { img: '01-tinatin',  focus: [0.74, 0.40], amb: [[141,127, 99], [110, 91, 59]] },
    { img: '02-stranger', focus: [0.62, 0.55], amb: [[111,114,112], [114, 95, 65]] },
    { img: '03-quest',    focus: [0.78, 0.55], amb: [[146,147,145], [174,147,107]] },
    { img: '04-sky',      focus: [0.50, 0.50], amb: [[160,167,164], [160,160,157]], breath: true },
    { img: '05-nestan',   focus: [0.62, 0.45], amb: [[110,111,111], [ 76, 81, 77]] },
    { img: '06-brothers', focus: [0.74, 0.45], amb: [[123,136,153], [131,120,105]] },
    { img: '07-kajeti',   focus: [0.64, 0.55], amb: [[107,109,112], [ 86, 84, 69]] },
    { img: '08-feast',    focus: [0.78, 0.55], amb: [[158,148,121], [118, 97, 58]] },
    { img: '09-colophon', focus: [0.45, 0.45], amb: [[136,156,170], [140,129,116]] },
    { img: null,          focus: [0.50, 0.50], amb: [[226,210,178], [212,193,160]], paper: true }
  ];

  // transition i joins scene i to scene i+1. pt / zoomPt are image uv
  // (top-left origin) on the OUTGOING painting.
  var TRANS = [
    { mode: 1, len: 1.55, zoomPt: [0.56, 0.60], bloomPt: [0.62, 0.42] },
    { mode: 2, len: 1.05, pt: [0.79, 0.23] },
    { mode: 3, len: 1.10, pt: [0.24, 0.82] },
    { mode: 4, len: 1.00 },
    { mode: 5, len: 1.05 },
    { mode: 6, len: 0.95 },
    { mode: 7, len: 0.95 },
    { mode: 8, len: 1.15, pt: [0.66, 0.62] },
    { mode: 1, len: 1.40, bloomPt: [0.45, 0.45] },
    { mode: 9, len: 1.30, zoomPt: [0.55, 0.52] }
  ];

  // dwell lengths, in viewport heights of scroll
  function dwellLen(i) {
    if (i === 0) return 1.15;
    if (SCENES[i].breath) return 0.95;
    if (SCENES[i].paper) return 1.0;
    return 1.3;
  }

  /* ── timeline ──────────────────────────────────────────── */
  var segs = [], dwells = [], trans = [], TOTAL = 0;
  (function build() {
    var t = 0;
    for (var i = 0; i < SCENES.length; i++) {
      var d = { kind: 'dwell', i: i, a: t, b: t + dwellLen(i) };
      segs.push(d); dwells.push(d); t = d.b;
      if (i < TRANS.length) {
        var tr = { kind: 'trans', i: i, a: t, b: t + TRANS[i].len };
        segs.push(tr); trans.push(tr); t = tr.b;
      }
    }
    TOTAL = t;
  })();

  // a scene lives from the start of the transition that brings it in
  // to the end of the one that takes it away; it pushes in across that span
  function life(i) {
    var a = i === 0 ? 0 : trans[i - 1].a;
    var b = i < trans.length ? trans[i].b : dwells[i].b;
    return [a, b];
  }

  /* ── dom ───────────────────────────────────────────────── */
  var card = document.getElementById('card');
  var canvas = document.getElementById('gl');
  var track = document.getElementById('track');
  var meterFill = document.getElementById('meterFill');
  var actNow = document.getElementById('actNow');
  var navBtns = [].slice.call(document.querySelectorAll('.acts button'));
  var acts = [].slice.call(document.querySelectorAll('.act')).map(function (el) {
    return { el: el, scene: +el.dataset.scene, parts: [].slice.call(el.querySelectorAll('[data-o]')) };
  });
  var ROMAN = ['I', 'II', 'III', 'IV', 'IV', 'V', 'VI', 'VII', 'VIII', 'VIII', 'VIII'];
  var NAV_OF = [0, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7];  // scene → nav button index

  /* ── scroll unit ───────────────────────────────────────── */
  // One unit = one viewport height, held steady through mobile URL-bar
  // resizes so the page doesn't jump as the bar slides away.
  var unit = 0, lastW = 0;
  function sizeTrack(force) {
    var w = innerWidth, h = innerHeight;
    if (!force && w === lastW && Math.abs(h - unit) < 120) return;
    lastW = w; unit = Math.max(h, 480);
    track.style.height = Math.round(TOTAL * unit + innerHeight) + 'px';
  }

  /* ── webgl ─────────────────────────────────────────────── */
  var gl = null, prog = null, U = {}, quad = null;
  var VERT = 'attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uA,uB;',
    'uniform vec2 uRes,uPt;',
    'uniform float uP,uMode,uPaperA,uPaperB;',
    'uniform vec4 uWinA,uWinB;',

    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}',

    // parchment, made rather than loaded
    'vec3 paper(vec2 uv){',
    '  float n=fbm(uv*vec2(4.,6.));float f=fbm(uv*vec2(70.,9.));',
    '  vec3 c=vec3(.925,.862,.728)*(.92+.11*n)-.035*f;',
    '  vec2 q=uv-.5;c*=1.-.55*dot(q,q);',
    '  return c;}',
    'vec3 sepia(vec3 c){float l=dot(c,vec3(.299,.587,.114));return vec3(l*1.05+.03,l*.88+.02,l*.64);}',

    'vec3 texA(vec2 uv){return uPaperA>.5?paper(uv):texture2D(uA,uWinA.xy+clamp(uv,0.,1.)*uWinA.zw).rgb;}',
    'vec3 texB(vec2 uv){return uPaperB>.5?paper(uv):texture2D(uB,uWinB.xy+clamp(uv,0.,1.)*uWinB.zw).rgb;}',
    'vec3 blurA(vec2 uv,float r){vec3 s=vec3(0.);vec2 k=vec2(r*uRes.y/uRes.x,r);',
    '  for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)s+=texA(uv+vec2(float(i),float(j))*k);return s/9.;}',
    'vec3 blurB(vec2 uv,float r){vec3 s=vec3(0.);vec2 k=vec2(r*uRes.y/uRes.x,r);',
    '  for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)s+=texB(uv+vec2(float(i),float(j))*k);return s/9.;}',

    'void main(){',
    '  vec2 uv=vUv;vec2 asp=vec2(uRes.x/uRes.y,1.);float p=uP;int m=int(uMode+.5);',
    '  vec3 A=texA(uv);vec3 col=A;',

    // 1 · paper-ink: A has already been zoomed by the script
    '  if(m==1){',
    '    vec3 P=paper(uv);',
    '    col=mix(A,P,smoothstep(.16,.40,p));',
    '    float q=smoothstep(.38,.74,p);',
    '    float edge=uv.x*.95+(fbm(uv*vec2(3.,9.))-.5)*.36;',
    '    float t=q*1.38-.14;',
    '    float inkM=1.-smoothstep(t-.15,t,edge);',
    '    vec3 B=texB(uv);',
    '    vec3 ink=mix(P,P*sepia(B)*1.32,.94);',
    '    col=mix(col,ink,inkM);',
    '    float c=smoothstep(.70,1.,p);',
    '    float d=length((uv-uPt)*asp);float r=c*2.1;',
    '    float n=(fbm(uv*3.2+3.)-.5)*.42;',
    '    float bm=1.-smoothstep(r-.16,r,d+n);',
    '    col=mix(col,B,bm);',
    '    col*=1.-.16*bm*(1.-bm)*4.*(1.-c);',
    '  }',

    // 2 · bloom from a point, gold at the wet edge
    '  else if(m==2){',
    '    vec3 B=texB(uv);',
    '    float d=length((uv-uPt)*asp);',
    '    float r=smoothstep(0.,1.,p)*2.15;',
    '    float n=(fbm(uv*3.4+7.)-.5)*.46+(fbm(uv*14.)-.5)*.08;',
    '    float bm=1.-smoothstep(r-.14,r,d+n);',
    '    col=mix(A,B,bm);',
    '    float rim=bm*(1.-bm)*4.;',
    '    col=mix(col,col*vec3(1.10,1.0,.84)+vec3(.07,.05,.0),rim*.65*(1.-p));',
    '  }',

    // 3 · ripple from the water
    '  else if(m==3){',
    '    vec2 dv=(uv-uPt)*asp;float d=length(dv);vec2 dir=d>0.?dv/d:vec2(0.);',
    '    float r=p*2.1;',
    '    float wave=sin(d*90.-p*60.)*exp(-abs(d-r)*8.)*(1.-p);',
    '    vec2 off=dir/asp*wave*.011;',
    '    vec3 Aw=texA(uv+off);vec3 Bw=texB(uv-off*.6);',
    '    float n=(fbm(uv*4.)-.5)*.10+.022*sin(atan(dv.y,dv.x)*9.);',
    '    float bm=1.-smoothstep(r-.06,r,d+n);',
    '    col=mix(Aw,Bw,bm);',
    '    float ring=exp(-pow((d+n-r)*42.,2.));',
    '    col+=vec3(.86,.93,1.)*ring*.30*(1.-p);',
    '  }',

    // 4 · wind, right to left
    '  else if(m==4){',
    '    float n=fbm(vec2(uv.x*2.5,uv.y*11.))*.40+fbm(uv*5.)*.10;',
    '    float e=(1.-uv.x)+n;',
    '    float t=p*1.80-.18;',
    '    float bm=1.-smoothstep(t-.10,t,e);',
    '    float near=exp(-abs(e-t)*9.);',
    '    vec3 Aw=texA(uv+vec2(near*.06*(1.-bm),0.));',
    '    col=mix(Aw,texB(uv),bm);',
    '    col=mix(col,vec3(.89,.77,.56),.45*exp(-pow((e-t)*11.,2.))*(1.-p*.6));',
    '  }',

    // 5 · rise from below
    '  else if(m==5){',
    '    float ep=1.-pow(1.-p,3.);',
    '    vec3 B=texB(uv+vec2(0.,(1.-ep)*.12));',
    '    float e=uv.y+(fbm(uv*vec2(3.,2.))-.5)*.20;',
    '    float t=ep*1.32-.12;',
    '    float bm=1.-smoothstep(t-.08,t,e);',
    '    vec3 Aw=texA(uv-vec2(0.,ep*.05))*(1.-.18*ep);',
    '    col=mix(Aw,B,bm);',
    '    col*=1.-.14*exp(-pow((e-t)*18.,2.))*(1.-ep);',
    '  }',

    // 6 · over-exposure, defocus, refocus
    '  else if(m==6){',
    '    vec3 W=vec3(1.,.985,.955);',
    '    if(p<.5){float k=smoothstep(0.,.5,p);col=mix(blurA(uv,k*.011),W,pow(k,1.35)*.95);}',
    '    else{float k=smoothstep(.5,1.,p);col=mix(W,blurB(uv,(1.-k)*.013),pow(k,.8));}',
    '  }',

    // 7 · steel flash, diagonal
    '  else if(m==7){',
    '    vec2 dir=normalize(vec2(1.,-.55));',
    '    float s=dot(uv*asp,dir);float smin=dir.y;float smax=dir.x*asp.x;',
    '    float e=(s-smin)/(smax-smin);',
    '    float t=p*1.22-.11;',
    '    float bm=1.-smoothstep(t-.006,t,e);',
    '    float env=sin(3.14159*clamp(p,0.,1.));',
    '    float g=exp(-pow((e-t)*95.,2.))+.42*exp(-pow((e-t)*13.,2.));',
    '    float sp=step(.986,hash(floor(uv*uRes/3.)))*exp(-pow((e-t)*28.,2.));',
    '    col=mix(A,texB(uv),bm)+vec3(.93,.96,1.)*(g+sp*1.4)*env;',
    '  }',

    // 8 · light from the gate — a hot white core going gold at the edge,
    //     spilling past its own boundary, with rays from the opening;
    //     the next scene surfaces inside the light rather than after it
    '  else if(m==8){',
    '    float ep=pow(p,1.6);',
    '    vec2 dv=(uv-uPt)*asp;',
    '    float dx=abs(dv.x);',
    '    float shape=dx+max(0.,abs(dv.y)-.06)*.30+(fbm(uv*vec2(6.,2.))-.5)*.07;',
    '    float w=ep*2.3;',
    '    float lm=1.-smoothstep(w,w+.22,shape);',
    '    vec3 Lc=mix(vec3(1.,.985,.93),vec3(1.,.84,.55),smoothstep(0.,w+.25,shape));',
    '    float k=smoothstep(.32,1.,p);',
    '    vec3 inside=mix(Lc*(1.06+.12*(1.-k)),texB(uv)*(1.+.55*(1.-k)),k);',
    '    vec3 Ab=A*(1.+.45*ep);',
    '    col=mix(Ab,inside,lm);',
    '    float outside=max(shape-w,0.);',
    '    col+=vec3(1.,.82,.5)*.42*exp(-outside*5.5)*ep*(1.-k);',
    '    float ang=atan(dv.y,dv.x);',
    '    float rays=pow(noise(vec2(ang*11.,3.)),3.)*exp(-length(dv)*1.6);',
    '    col+=vec3(1.,.9,.68)*rays*.55*smoothstep(0.,.25,p)*(1.-k);',
    '  }',

    // 9 · into the parchment
    '  else if(m==9){ col=mix(A,paper(uv),smoothstep(.30,.82,p)); }',

    // 10 · plain cross-fade
    '  else if(m==10){ col=mix(A,texB(uv),smoothstep(0.,1.,p)); }',

    // the painting, finished: a little grain, a little vignette
    '  vec2 q=uv-.5;',
    '  col*=1.-.20*dot(q*vec2(1.2,1.),q*vec2(1.2,1.));',
    '  col+=(hash(uv*uRes)-.5)*.022;',
    '  gl_FragColor=vec4(col,1.);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function initGL() {
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['uA', 'uB', 'uRes', 'uPt', 'uP', 'uMode', 'uPaperA', 'uPaperB', 'uWinA', 'uWinB'].forEach(function (n) {
        U[n] = gl.getUniformLocation(prog, n);
      });
      gl.uniform1i(U.uA, 0); gl.uniform1i(U.uB, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      return true;
    } catch (e) {
      console.warn('[B] WebGL unavailable, falling back to 2D:', e.message);
      gl = null; return false;
    }
  }

  /* ── images / textures ─────────────────────────────────── */
  var imgs = [], texs = [], aspect = [];
  var useMobile = false;

  function load(i) {
    var sc = SCENES[i];
    if (!sc || sc.paper || imgs[i]) return;
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () {
      aspect[i] = im.naturalWidth / im.naturalHeight;
      if (gl) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        texs[i] = t;
      }
      kick();
    };
    im.src = 'assets/img/' + sc.img + (useMobile ? '-m' : '') + '.webp';
    imgs[i] = im;
  }
  function ready(i) { return SCENES[i].paper || (gl ? !!texs[i] : !!(imgs[i] && imgs[i].complete && aspect[i])); }

  /* ── geometry ──────────────────────────────────────────── */
  var cw = 1, ch = 1;
  function resize() {
    var r = card.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.min(Math.round(r.width * dpr), 2560);
    var h = Math.round(w * r.height / r.width);
    cw = w; ch = h;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var wantMobile = w <= 1300;
    if (wantMobile !== useMobile && imgs.length === 0) useMobile = wantMobile;
    if (gl) gl.viewport(0, 0, w, h);
  }

  // the part of the painting that is visible: [ox, oy, sx, sy] in y-up uv
  function win(i, zoom, focus) {
    var ia = aspect[i] || 16 / 9, ca = cw / ch;
    var sx = 1, sy = 1;
    if (ca > ia) sy = ia / ca; else sx = ca / ia;
    sx /= zoom; sy /= zoom;
    var fx = focus[0], fy = 1 - focus[1];
    var ox = Math.min(Math.max(fx - sx / 2, 0), 1 - sx);
    var oy = Math.min(Math.max(fy - sy / 2, 0), 1 - sy);
    return [ox, oy, sx, sy];
  }
  // an image point (top-left uv) → where it falls on the canvas (y-up uv)
  function toScreen(pt, w) {
    return [(pt[0] - w[0]) / w[2], ((1 - pt[1]) - w[1]) / w[3]];
  }

  /* ── state from the timeline ───────────────────────────── */
  var smooth = (function () { return function (a, b, x) { var t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }; })();
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function segAt(t) {
    for (var k = 0; k < segs.length; k++) if (t < segs[k].b) return segs[k];
    return segs[segs.length - 1];
  }
  function kb(i, t) {
    if (reduced) return 1;
    var l = life(i);
    return 1 + 0.075 * clamp01((t - l[0]) / (l[1] - l[0]));
  }

  /* ── draw ──────────────────────────────────────────────── */
  var ctx2d = null;

  function draw(t) {
    var s = segAt(t);
    var a = s.i, b = s.kind === 'trans' ? s.i + 1 : -1;
    var p = s.kind === 'trans' ? clamp01((t - s.a) / (s.b - s.a)) : 0;
    var tr = s.kind === 'trans' ? TRANS[s.i] : null;
    var mode = tr ? (reduced || !gl ? 10 : tr.mode) : 0;

    // keep the next scenes loading ahead of the reader
    load(a); load(a + 1); load(a + 2);
    if (!ready(a)) return false;
    if (b >= 0 && !ready(b)) { mode = 0; p = 0; }

    var focusA = SCENES[a].focus, zoomA = kb(a, t);
    // modes that dive into the scroll take over the outgoing camera
    if (tr && !reduced && (mode === 1 || mode === 9) && tr.zoomPt) {
      var span = mode === 1 ? 0.42 : 0.82;
      var z = smooth(0, span, p);
      zoomA = zoomA * (1 + 6.5 * Math.pow(z, 1.6));
      focusA = [lerp(focusA[0], tr.zoomPt[0], smooth(0, span * 0.7, p)),
                lerp(focusA[1], tr.zoomPt[1], smooth(0, span * 0.7, p))];
    }
    var wA = win(a, zoomA, focusA);
    var wB = b >= 0 ? win(b, kb(b, t), SCENES[b].focus) : wA;

    // effect origin, on screen
    var pt = [0.5, 0.5];
    if (tr) {
      if (tr.pt) pt = toScreen(tr.pt, wA);
      else if (tr.bloomPt) pt = b >= 0 ? toScreen(tr.bloomPt, wB) : pt;
    }

    if (gl) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texs[a] || null);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (b >= 0 && texs[b]) || texs[a] || null);
      gl.uniform2f(U.uRes, cw, ch);
      gl.uniform2f(U.uPt, pt[0], pt[1]);
      gl.uniform1f(U.uP, p);
      gl.uniform1f(U.uMode, mode);
      gl.uniform1f(U.uPaperA, SCENES[a].paper ? 1 : 0);
      gl.uniform1f(U.uPaperB, b >= 0 && SCENES[b].paper ? 1 : 0);
      gl.uniform4f(U.uWinA, wA[0], wA[1], wA[2], wA[3]);
      gl.uniform4f(U.uWinB, wB[0], wB[1], wB[2], wB[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      draw2d(a, b, p, wA, wB);
    }
    return { a: a, b: b, p: p, seg: s };
  }

  function draw2d(a, b, p, wA, wB) {
    if (!ctx2d) ctx2d = canvas.getContext('2d');
    var c = ctx2d;
    function paint(i, w, alpha) {
      c.globalAlpha = alpha;
      if (SCENES[i].paper) { c.fillStyle = '#ecdcba'; c.fillRect(0, 0, cw, ch); return; }
      var im = imgs[i], iw = im.naturalWidth, ih = im.naturalHeight;
      c.drawImage(im, w[0] * iw, (1 - w[1] - w[3]) * ih, w[2] * iw, w[3] * ih, 0, 0, cw, ch);
    }
    paint(a, wA, 1);
    if (b >= 0 && p > 0) paint(b, wB, smooth(0, 1, p));
    c.globalAlpha = 1;
  }

  /* ── the words ─────────────────────────────────────────── */
  // A scene's words arrive only after it has settled, one part at a
  // time, and leave together just before the next transition begins.
  function wordsFor(scene, t) {
    var d = dwells[scene];
    var len = d.b - d.a, local = (t - d.a) / len;
    var last = scene === SCENES.length - 1;
    var first = scene === 0;
    var out = last ? 1 : 1 - smooth(0.80, 0.97, local);
    return { local: local, out: out, first: first };
  }

  var bootT0 = performance.now();
  function setWords(t) {
    for (var k = 0; k < acts.length; k++) {
      var A = acts[k], w = wordsFor(A.scene, t);
      var isLast = A.scene === SCENES.length - 1;
      var live = w.local > -0.02 && (isLast || w.local < 1.0) && w.out > 0.001;
      if (A.scene === 0 && t < dwells[0].b) live = true;
      A.el.classList.toggle('is-live', live);
      A.el.setAttribute('aria-hidden', live ? 'false' : 'true');
      if (!live) continue;

      for (var j = 0; j < A.parts.length; j++) {
        var el = A.parts[j], o = +el.dataset.o, a;
        if (w.first) {
          // the opening lines arrive once, on load, in the same cadence
          var since = (performance.now() - bootT0) / 1000;
          a = reduced ? 1 : smooth(0.15 + o * 0.22, 0.95 + o * 0.22, since);
        } else {
          var s0 = 0.06 + o * 0.075;
          a = reduced ? smooth(0.02, 0.10, w.local) : smooth(s0, s0 + 0.20, w.local);
        }
        var op = a * w.out;
        var y = reduced ? 0 : (1 - a) * 14 - (1 - w.out) * 8;
        el.style.opacity = op.toFixed(3);
        el.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      }
    }
  }

  /* ── ground colour + chrome ────────────────────────────── */
  var root = document.documentElement.style;
  function pastel(c, k) { return [lerp(c[0], 248, k), lerp(c[1], 243, k), lerp(c[2], 236, k)]; }
  function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  var lastNav = -1;
  function setChrome(st, t) {
    var a = st.a, b = st.b, k = b >= 0 ? smooth(0.15, 0.85, st.p) : 0;
    var ca = SCENES[a].amb, cb = b >= 0 ? SCENES[b].amb : ca;
    var top = pastel([lerp(ca[0][0], cb[0][0], k), lerp(ca[0][1], cb[0][1], k), lerp(ca[0][2], cb[0][2], k)], 0.52);
    var bot = pastel([lerp(ca[1][0], cb[1][0], k), lerp(ca[1][1], cb[1][1], k), lerp(ca[1][2], cb[1][2], k)], 0.46);
    root.setProperty('--amb-top', rgb(top));
    root.setProperty('--amb-bot', rgb(bot));

    var nowScene = b >= 0 && st.p > 0.5 ? b : a;
    card.classList.toggle('is-paper', !!SCENES[nowScene].paper);
    card.classList.toggle('is-prologue', nowScene === 0);

    var navI = NAV_OF[nowScene];
    if (navI !== lastNav) {
      lastNav = navI;
      navBtns.forEach(function (btn, i) { btn.setAttribute('aria-current', i === navI ? 'true' : 'false'); });
      actNow.textContent = ROMAN[nowScene];
    }
    meterFill.style.width = (clamp01(t / TOTAL) * 100).toFixed(2) + '%';
  }

  /* ── loop ──────────────────────────────────────────────── */
  var target = 0, cur = 0, raf = 0, last = 0;
  function readScroll() { target = Math.min(Math.max(scrollY / unit, 0), TOTAL); }

  function frame(now) {
    raf = 0;
    // capped so a stalled tab doesn't leap on return, but loose enough that
    // a slow GPU at ~10fps still keeps pace with the reader
    var dt = last ? Math.min((now - last) / 1000, 0.1) : 0.016;
    last = now;
    // ease toward the scroll position: the scene glides, it never snaps
    cur += (target - cur) * (1 - Math.exp(-dt * 6.5));
    if (Math.abs(target - cur) < 0.0004) cur = target;

    var st = draw(cur);
    if (st) { setWords(cur); setChrome(st, cur); }

    var booting = cur < dwells[0].b && (now - bootT0) < 2200;
    if (cur !== target || !st || booting) kick();
    else last = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ── navigation ────────────────────────────────────────── */
  function jumpTo(scene) {
    var d = dwells[scene];
    var t = scene === 0 ? 0 : d.a + (d.b - d.a) * 0.42;
    scrollTo({ top: t * unit, behavior: reduced ? 'auto' : 'smooth' });
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-jump]');
    if (!el) return;
    e.preventDefault();
    jumpTo(+el.dataset.jump);
  });

  /* ── boot ──────────────────────────────────────────────── */
  sizeTrack(true);
  resize();
  useMobile = cw <= 1300;
  initGL();
  for (var i = 0; i < 3; i++) load(i);
  // the rest arrive in the background, in story order
  setTimeout(function () { for (var j = 3; j < SCENES.length; j++) load(j); }, 1200);

  readScroll(); cur = target;
  addEventListener('scroll', function () { readScroll(); kick(); }, { passive: true });
  addEventListener('resize', function () { sizeTrack(false); resize(); readScroll(); kick(); });
  kick();

  // test hook: lets an automated check set the timeline directly
  window.__B = { TOTAL: TOTAL, dwells: dwells, trans: trans, unit: function () { return unit; },
                 state: function () { var s = segAt(cur); return { cur: cur, kind: s.kind, i: s.i, gl: !!gl }; } };
})();
