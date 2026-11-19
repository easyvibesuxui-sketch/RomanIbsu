/* ═══════════════════════════════════════════════════════════
   ვეფხისტყაოსანი — B version · scroll-owned scene compositor
   ───────────────────────────────────────────────────────────
   The page is a run of tall sections, one per act, each with a
   sticky pin. Scroll position is read as a point on a timeline of
   dwells (an act pinned while its video runs) and transitions (one
   scene becoming the next). Each scene is a short painted film; scroll
   writes its currentTime — this file never calls video.play().
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

   Over every scene, scroll-driven gold motes and, as each act
   settles, one slow sweep of light. Nothing advances unless the
   reader scrolls.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── content ───────────────────────────────────────────── */
  // focus: where the subject sits (image uv, top-left origin) — used
  // when a tall screen has to crop the painting.
  var SCENES = [
    { img: '00-prologue', dust: .35, focus: [0.50, 0.45], amb: [[108,141,160], [141,124, 99]] },
    { img: '01-tinatin',  dust: .45, focus: [0.74, 0.40], amb: [[141,127, 99], [110, 91, 59]] },
    { img: '02-stranger', dust: .60, focus: [0.62, 0.55], amb: [[111,114,112], [114, 95, 65]] },
    { img: '03-quest',    dust: .85, focus: [0.78, 0.55], amb: [[146,147,145], [174,147,107]] },
    { img: '04-sky',      dust: .20, focus: [0.50, 0.50], amb: [[160,167,164], [160,160,157]], breath: true },
    { img: '05-nestan',   dust: .50, focus: [0.62, 0.45], amb: [[110,111,111], [ 76, 81, 77]] },
    { img: '06-brothers', dust: .40, focus: [0.74, 0.45], amb: [[123,136,153], [131,120,105]] },
    { img: '07-kajeti',   dust: .75, focus: [0.64, 0.55], amb: [[107,109,112], [ 86, 84, 69]] },
    { img: '08-feast',    dust: .95, focus: [0.78, 0.55], amb: [[158,148,121], [118, 97, 58]] },
    { img: '09-colophon', dust: .40, focus: [0.45, 0.45], amb: [[136,156,170], [140,129,116]] },
    { img: null,          dust: 0,   focus: [0.50, 0.50], amb: [[226,210,178], [212,193,160]], paper: true }
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

  // dwell lengths, in viewport heights of scroll. Each act holds long
  // enough for its film to play out under the reader's hand.
  function dwellLen(i) {
    if (i === 0) return 2.0;
    if (SCENES[i].breath) return 1.6;
    if (SCENES[i].paper) return 1.0;
    return 2.4;
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
  var secs = [].slice.call(document.querySelectorAll('.sec'));
  var meterFill = document.getElementById('meterFill');
  var actNow = document.getElementById('actNow');
  var navBtns = [].slice.call(document.querySelectorAll('.acts button'));
  var acts = secs.map(function (sec) {
    var el = sec.querySelector('.act');
    return { el: el, scene: +sec.dataset.scene, parts: [].slice.call(el.querySelectorAll('[data-o]')).map(prepPart) };
  });
  var ROMAN = ['I', 'II', 'III', 'IV', 'IV', 'V', 'VI', 'VII', 'VIII', 'VIII', 'VIII'];
  var NAV_OF = [0, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7];  // scene → nav button index

  /* ── scroll unit & sections ────────────────────────────── */
  // One unit = one viewport height, held steady through mobile URL-bar
  // resizes so the page doesn't jump as the bar slides away. Section i
  // owns act i's dwell and the transition that carries it away, so its
  // pin holds for exactly as long as the act is on stage.
  function secSpan(i) {
    var a = i === 0 ? 0 : dwells[i].a;
    var b = i < trans.length ? trans[i].b : dwells[i].b;
    return [a, b];
  }
  var unit = 0, lastW = 0;
  function sizeTrack(force) {
    var w = innerWidth, h = innerHeight;
    if (!force && w === lastW && Math.abs(h - unit) < 120) return;
    lastW = w; unit = Math.max(h, 480);
    var y = 0;
    secs.forEach(function (sec, i) {
      var sp = secSpan(+sec.dataset.scene);
      var end = Math.round(sp[1] * unit);
      var hgt = end - y + (i === secs.length - 1 ? innerHeight : 0);
      sec.style.height = hgt + 'px';
      y = end;
    });
  }

  /* ── webgl ─────────────────────────────────────────────── */
  var gl = null, prog = null, U = {}, quad = null;
  var VERT = 'attribute vec2 p;varying vec2 vUv;void main(){vUv=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uA,uB;',
    'uniform vec2 uRes,uPt;',
    'uniform float uP,uMode,uPaperA,uPaperB,uT,uDust,uFlare;',
    'uniform vec4 uWinA,uWinB;',

    'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}',
    'float mote(vec2 uv,float sc,float t,float seed){',
    '  vec2 g=uv*vec2(uRes.x/uRes.y,1.)*sc;g.y-=t;g.x+=sin(g.y*.45+seed)*.35;',
    '  vec2 id=floor(g);vec2 f=fract(g)-.5;float h=hash(id+seed);',
    '  vec2 o=vec2(hash(id+seed+1.3),hash(id+seed+2.7))-.5;',
    '  float d=length(f-o*.7);',
    '  return step(.9,h)*(smoothstep(.13,0.,d)+.35*smoothstep(.34,0.,d))*(.45+.55*hash(id+seed+5.1));}',

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
    '    vec3 Aw=texA(uv+vec2(near*.028*(1.-bm),0.));',
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

    // gold motes, carried by scroll: two depths, the near ones faster
    '  if(uDust>0.){',
    '    float md=mote(uv,7.,uT*2.4,0.)*1.0+mote(uv,15.,uT*1.4,9.)*.65;',
    '    col+=vec3(1.,.85,.55)*md*uDust*.42;',
    '  }',
    // as an act settles, one slow band of warm light crosses it
    '  if(uFlare>0.&&uFlare<1.){',
    '    float e=uv.x*.78+(1.-uv.y)*.34;float pos=uFlare*1.55-.28;',
    '    float band=exp(-pow((e-pos)*3.4,2.))+.35*exp(-pow((e-pos+.12)*9.,2.));',
    '    col+=vec3(1.,.86,.62)*band*.17*sin(3.14159*uFlare);',
    '  }',

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
      ['uA', 'uB', 'uRes', 'uPt', 'uP', 'uMode', 'uPaperA', 'uPaperB', 'uWinA', 'uWinB', 'uT', 'uDust', 'uFlare'].forEach(function (n) {
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

  /* ── images, films, textures ───────────────────────────── */
  // Each scene starts as its still painting (the film's first frame),
  // so something is on stage at once; the film takes over as soon as
  // it has a frame to give.
  var imgs = [], texs = [], aspect = [];
  var vids = [], vidOK = [], dirty = [];
  var useMobile = false;

  // H.264 decodes in hardware almost everywhere, which matters for
  // seeking; VP9 covers Chromium builds shipped without it.
  var VFMT = (function () {
    var v = document.createElement('video');
    if (v.canPlayType('video/mp4; codecs="avc1.640028"')) return 'mp4';
    if (v.canPlayType('video/webm; codecs="vp9"')) return 'webm';
    return null;
  })();
  var holder = document.createElement('div');
  holder.className = 'vids'; holder.setAttribute('aria-hidden', 'true');
  document.body.appendChild(holder);

  function upload(i, src) {
    if (!gl) return;
    if (!texs[i]) {
      texs[i] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texs[i]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else gl.bindTexture(gl.TEXTURE_2D, texs[i]);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src); }
    catch (e) { /* a frame not yet decodable — keep the last one */ }
  }

  function load(i) {
    var sc = SCENES[i];
    if (!sc || sc.paper || imgs[i]) return;
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () {
      if (vidOK[i]) return;                      // the film got here first
      aspect[i] = im.naturalWidth / im.naturalHeight;
      upload(i, im);
      kick();
    };
    im.src = 'assets/img/' + sc.img + (useMobile ? '-m' : '') + '.webp';
    imgs[i] = im;
    loadVid(i);
  }

  function loadVid(i) {
    var sc = SCENES[i];
    if (reduced || !VFMT || !sc || sc.paper || vids[i]) return;
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.disableRemotePlayback = true;
    function fresh() { if (v.readyState >= 2) { vidOK[i] = true; dirty[i] = true; kick(); } }
    v.addEventListener('loadeddata', fresh);
    v.addEventListener('seeked', fresh);
    v.src = 'assets/video/' + sc.img + '.' + VFMT;
    holder.appendChild(v);
    v.load();                                    // fetches data — never starts playback
    vids[i] = v;
  }

  function ready(i) {
    if (SCENES[i].paper) return true;
    if (gl) return !!texs[i];
    return vidOK[i] || !!(imgs[i] && imgs[i].complete && aspect[i]);
  }

  // where scroll wants scene i's film: its whole life on stage, from the
  // transition that brings it in to the one that takes it away
  function filmTime(i, t) {
    var v = vids[i], l = life(i);
    if (!v || !v.duration || !isFinite(v.duration)) return 0;
    return clamp01((t - l[0]) / (l[1] - l[0])) * (v.duration - 0.05);
  }
  function scrub(i, t) {
    var v = vids[i];
    if (!v || v.readyState < 1 || v.seeking) return;
    var want = filmTime(i, t);
    if (Math.abs(v.currentTime - want) < 1 / 48) return;
    try { v.currentTime = want; } catch (e) { /* not seekable yet */ }
  }
  function refresh(i) {
    if (!dirty[i] || !vids[i] || vids[i].readyState < 2) return;
    dirty[i] = false;
    var v = vids[i];
    if (v.videoWidth) aspect[i] = v.videoWidth / v.videoHeight;
    upload(i, v);
  }

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
    return 1 + 0.035 * clamp01((t - l[0]) / (l[1] - l[0]));
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
    scrub(a, t); refresh(a);
    if (b >= 0) { scrub(b, t); refresh(b); }
    else if (a + 1 < SCENES.length) scrub(a + 1, t);   // park the next film on its first frame
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
      var dA = SCENES[a].dust, dB = b >= 0 ? SCENES[b].dust : dA;
      gl.uniform1f(U.uT, t);
      gl.uniform1f(U.uDust, reduced ? 0 : lerp(dA, dB, smooth(0.2, 0.8, p)));
      var fl = -1;
      if (!reduced && s.kind === 'dwell' && !SCENES[a].paper && a > 0) fl = clamp01((t - s.a) / ((s.b - s.a) * 0.55));
      gl.uniform1f(U.uFlare, fl);
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
      var im = vidOK[i] ? vids[i] : imgs[i];
      var iw = im.videoWidth || im.naturalWidth, ih = im.videoHeight || im.naturalHeight;
      c.drawImage(im, w[0] * iw, (1 - w[1] - w[3]) * ih, w[2] * iw, w[3] * ih, 0, 0, cw, ch);
    }
    paint(a, wA, 1);
    if (b >= 0 && p > 0) paint(b, wB, smooth(0, 1, p));
    c.globalAlpha = 1;
  }

  /* ── the words ─────────────────────────────────────────── */
  // A scene's parts arrive only after it has settled, one at a time in
  // data-o order, each with its own entrance (data-fx), and leave
  // together just before the next transition begins.
  //   rise     lifts in            num      settles out of a blur
  //   draw     a rule drawn L→R    blur     focuses in
  //   lines    each verse line rises out of its own line box
  //   letters  each glyph arrives on its own
  function prepPart(el) {
    var fx = el.dataset.fx || 'rise', subs = [];
    if (fx === 'lines') {
      var lines = el.innerHTML.split(/<br\s*\/?>/i);
      el.innerHTML = lines.map(function (h) { return '<span class="ln"><i>' + h.trim() + '</i></span>'; }).join('');
      subs = [].slice.call(el.querySelectorAll('.ln > i'));
    } else if (fx === 'letters') {
      var text = el.textContent;
      el.textContent = '';
      var sr = document.createElement('span');
      sr.className = 'sr'; sr.textContent = text;
      el.appendChild(sr);
      Array.from(text).forEach(function (c) {
        var sp = document.createElement('span');
        sp.className = 'ch'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = c;
        el.appendChild(sp); subs.push(sp);
      });
    }
    return { el: el, o: +el.dataset.o, fx: fx, subs: subs };
  }

  function wordsFor(scene, t) {
    var d = dwells[scene];
    var len = d.b - d.a, local = (t - d.a) / len;
    var last = scene === SCENES.length - 1;
    var out = last ? 1 : 1 - smooth(0.78, 0.95, local);
    return { local: local, out: out, first: scene === 0 };
  }

  var bootT0 = performance.now();
  var START = 0.05, STEP = 0.06, WIN = 0.17;    // in units of the act's dwell

  function setWords(t) {
    // the prologue's clock is time since load (it greets the reader);
    // every other act's clock is its own scroll progress
    var bootClock = (performance.now() - bootT0) / 4200;
    for (var k = 0; k < acts.length; k++) {
      var A = acts[k], w = wordsFor(A.scene, t);
      var isLast = A.scene === SCENES.length - 1;
      var live = w.local > -0.02 && (isLast || w.local < 1.0) && w.out > 0.001;
      if (A.scene === 0 && t < dwells[0].b) live = true;
      A.el.classList.toggle('is-live', live);
      A.el.setAttribute('aria-hidden', live ? 'false' : 'true');
      if (!live) continue;
      var clock = w.first ? bootClock : w.local;

      for (var j = 0; j < A.parts.length; j++) {
        var P = A.parts[j], el = P.el;
        var s0 = START + P.o * STEP;
        var a = reduced ? smooth(0, 0.08, clock) : smooth(s0, s0 + WIN, clock);
        var out = w.out, lift = (1 - out) * 8;

        if (reduced) {
          el.style.opacity = (a * out).toFixed(3);
          continue;
        }
        if (P.fx === 'num') {
          el.style.opacity = (a * out * 0.92).toFixed(3);
          el.style.transform = 'translate3d(0,' + ((1 - a) * 12 - lift).toFixed(2) + 'px,0) scale(' + (1.08 - 0.08 * a).toFixed(4) + ')';
          el.style.filter = a < 0.999 ? 'blur(' + ((1 - a) * 9).toFixed(2) + 'px)' : '';
        } else if (P.fx === 'draw') {
          el.style.opacity = (Math.min(1, a * 4) * out).toFixed(3);
          el.style.transform = 'translate3d(0,' + (-lift).toFixed(2) + 'px,0) scaleX(' + (1 - Math.pow(1 - a, 3)).toFixed(4) + ')';
        } else if (P.fx === 'blur') {
          el.style.opacity = (a * out).toFixed(3);
          el.style.transform = 'translate3d(0,' + ((1 - a) * 6 - lift).toFixed(2) + 'px,0)';
          el.style.filter = a < 0.999 ? 'blur(' + ((1 - a) * 5).toFixed(2) + 'px)' : '';
        } else if (P.fx === 'lines') {
          el.style.opacity = (a > 0 ? out : 0).toFixed(3);
          el.style.transform = 'translate3d(0,' + (-lift).toFixed(2) + 'px,0)';
          for (var li = 0; li < P.subs.length; li++) {
            var l0 = s0 + li * 0.055, la = smooth(l0, l0 + WIN, clock);
            var e = 1 - Math.pow(1 - la, 3);
            P.subs[li].style.transform = 'translate3d(0,' + ((1 - e) * 108).toFixed(2) + '%,0)';
            P.subs[li].style.opacity = la.toFixed(3);
          }
        } else if (P.fx === 'letters') {
          el.style.opacity = (a > 0 ? out : 0).toFixed(3);
          el.style.transform = 'translate3d(0,' + (-lift).toFixed(2) + 'px,0)';
          var n = P.subs.length, span = WIN * 1.6, per = n > 1 ? span / (n - 1) : 0;
          for (var ci = 0; ci < n; ci++) {
            var c0 = s0 + ci * per, ca = smooth(c0, c0 + WIN * 0.8, clock);
            P.subs[ci].style.opacity = ca.toFixed(3);
            P.subs[ci].style.transform = 'translate3d(0,' + ((1 - ca) * 0.42).toFixed(3) + 'em,0)';
          }
        } else {
          el.style.opacity = (a * out).toFixed(3);
          el.style.transform = 'translate3d(0,' + ((1 - a) * 14 - lift).toFixed(2) + 'px,0)';
        }
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

    var booting = cur < dwells[0].b && (now - bootT0) < 4200;
    if (cur !== target || !st || booting) kick();
    else last = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ── navigation ────────────────────────────────────────── */
  function jumpTo(scene) {
    var d = dwells[scene];
    var t = scene === 0 ? 0 : d.a + (d.b - d.a) * 0.5;
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
                 state: function () {
                   var s = segAt(cur), v = vids[s.i];
                   return { cur: cur, kind: s.kind, i: s.i, gl: !!gl, fmt: VFMT, film: !!vidOK[s.i],
                            ft: v ? +v.currentTime.toFixed(3) : null, want: v ? +filmTime(s.i, cur).toFixed(3) : null };
                 } };
})();
