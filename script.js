/* fira: behaviour
   1. state, language and theme
   2. globe (canvas, orthographic projection, no library)
   3. home page: figures, last 30 days, steps, sensor comparison
   4. country page: stats, map, timeline, notable days, matrix, calendar, day log, risk estimate
   Data lives in data/*.js. Text lives in data/i18n.js. Images are read from the images/ folder. */
(function () {
  'use strict';

  var DATA = window.FIRA_DATA || {};
  var TEXT = window.FIRA_I18N || {};
  var OM = DATA.oman;
  var CUR = null;
  var WORLD = DATA.world || [];
  var EARTH = DATA.earth;

  /* ---------- constants you may want to edit ---------- */
  var SAT_NAMES = ['Terra', 'Aqua', 'S-NPP', 'NOAA-20', 'NOAA-21'];
  var SAT_FAM = [0, 0, 1, 1, 1];            // 0 = MODIS, 1 = VIIRS
  var SAT_START = [2000, 2002, 2012, 2018, 2023];
  // Rough monthly climate per country (mean daily maximum, relative humidity). Illustrative only.
  var CLIM_T = [], CLIM_RH = [], T_LO = 22, T_HI = 46;
  var ROWS_PER_PAGE = 20;
  var IMG_DIR = 'images/';
  var OVERVIEW_IMG = '';
  // Per-country settings. Notable-day images are read from images/<date>-before.jpg and images/<date>-after.jpg.
  var CFGS = {
    oman: { id: 'oman', iso: 'OMN', data: DATA.oman, hl: 'world', center: [57.0, 20.6], cosLat: 21, regKey: 'g.head', noteKey: 'cc.oman.note',
            clim: { T: [25, 27, 31, 36, 41, 43, 42, 40, 38, 35, 30, 26], RH: [55, 55, 50, 42, 35, 38, 52, 58, 52, 45, 48, 55], lo: 22, hi: 46 },
            notable: [{ date: '2024-01-17', before: '2024-01-10', lat: 23.6, lon: 56.4 }, { date: '2016-03-29', before: '2016-03-22', lat: 23.6, lon: 57.8 }, { date: '2025-07-01', before: '2025-06-24', lat: 22.6, lon: 57.65 }] },
    usa: { id: 'usa', iso: 'USA', data: DATA.usa, hl: 'govs', center: [-121.8, 39.5], cosLat: 39, regKey: 'g.headUs', noteKey: 'cc.usa.note',
           clim: { T: [12, 14, 17, 20, 24, 28, 32, 32, 28, 22, 15, 11], RH: [78, 72, 65, 58, 52, 46, 38, 40, 48, 60, 74, 80], lo: 8, hi: 36 },
           notable: [{ date: '2018-11-08', before: '2018-11-01', lat: 39.78, lon: -121.62 }, { date: '2020-08-19', before: '2020-08-12', lat: 38.6, lon: -122.3 }, { date: '2021-08-17', before: '2021-08-10', lat: 40.2, lon: -121.1 }] }
  };
  var NOTABLE = [];
  var COUNTRIES = [
    { id: 'oman', iso: 'OMN', key: 'c.oman', ready: !!DATA.oman },
    { id: 'usa', iso: 'USA', key: 'c.usa', ready: !!DATA.usa },
    { id: 'greece', iso: 'GRC', key: 'c.greece', ready: false }
  ];
  function cOf(id) { for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].id === id) return COUNTRIES[i]; return null; }

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var RAD = Math.PI / 180;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };
  var lang = store.get('fira-lang') === 'ar' ? 'ar' : 'en';
  var nf = new Intl.NumberFormat('en-US');
  function loc() { return lang === 'ar' ? 'ar-u-nu-latn' : 'en-US'; }
  function t(key, vars) {
    var s = (TEXT[lang] && TEXT[lang][key]) || (TEXT.en && TEXT.en[key]) || key;
    if (vars) { for (var k in vars) { s = s.split('{' + k + '}').join(vars[k]); } }
    return s;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function fmtDate(s) { return new Intl.DateTimeFormat(loc(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(s + 'T00:00:00Z')); }
  function monthName(m, long) { return new Intl.DateTimeFormat(loc(), { month: long ? 'long' : 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, m, 1))); }
  function countryName(c) {
    var w = null;
    for (var i = 0; i < WORLD.length; i++) { if (WORLD[i].i === c.iso) { w = WORLD[i]; break; } }
    return t(c.key) || (w && w.n) || c.id;
  }
  function scrollTo_(el) { el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }

  /* ---------- reading images from the images/ folder ---------- */
  var imgState = {};            // url -> true | false
  function probe(url, cb) {
    if (imgState[url] !== undefined) { cb(imgState[url]); return; }
    var im = new Image();
    im.onload = function () { imgState[url] = true; cb(true); };
    im.onerror = function () { imgState[url] = false; cb(false); };
    im.src = url;
  }

  /* ---------- colours for canvas (read from CSS tokens) ---------- */
  var COL = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    document.documentElement.setAttribute('data-mode', isDark() ? 'dark' : 'light');
    var g = function (n) { return cs.getPropertyValue(n).trim(); };
    COL = {
      dark: g('--dark') === '1', bg: g('--bg'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), accent: g('--accent'),
      modis: g('--modis'), viirs: g('--viirs'), excl: g('--excl'),
      r: [g('--r0'), g('--r1'), g('--r2'), g('--r3'), g('--r4'), g('--r5')],
      sea: g('--g-sea'), land: g('--g-land'), gline: g('--g-line'), grid: g('--g-grid'), halo: g('--g-halo'),
      hi: g('--g-hi'), lo: g('--g-lo'), oman: g('--g-oman'), omanEdge: g('--g-oman-edge')
    };
  }

  /* ---------- state ---------- */
  var Y_MIN = 2000, Y_MAX = 2026;
  var S = { sensor: 'both', src: 'std', from: 2000, to: 2026, excl: false, tl: 'year', metric: 'count', calYear: 2026, sort: 'new', page: 0,
            rMonth: new Date().getMonth(), rT: 0, rH: 0, mapYear: null, hiGov: -2 };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- prepare data ---------- */
  var days = [], dayMap = {}, VAR = null;
  var season = [];
  // day row: [date, Terra, Aqua, S-NPP, NOAA-20, NOAA-21, fire power MODIS, fire power VIIRS, night MODIS, night VIIRS]
  function buildDays() {
    VAR = OM.v[S.src];
    days = []; dayMap = {};
    VAR.days.forEach(function (r) {
      var o = { d: r[0], y: +r[0].slice(0, 4), m: +r[0].slice(5, 7) - 1, dd: +r[0].slice(8, 10), s: [r[1], r[2], r[3], r[4], r[5]], fm: r[6], fv: r[7], nm: r[8], nv: r[9] };
      o.mod = o.s[0] + o.s[1]; o.vii = o.s[2] + o.s[3] + o.s[4];
      days.push(o); dayMap[o.d] = o;
    });
  }
  var built = false;
  function setCountry(id) {
    CUR = CFGS[id]; OM = CUR.data; NOTABLE = CUR.notable;
    CLIM_T = CUR.clim.T; CLIM_RH = CUR.clim.RH; T_LO = CUR.clim.lo; T_HI = CUR.clim.hi;
    OVERVIEW_IMG = IMG_DIR + id + '-overview.jpg';
    Y_MIN = OM.meta.y0; Y_MAX = +OM.meta.last.slice(0, 4);
    S.from = Y_MIN; S.to = Y_MAX; S.calYear = Y_MAX; S.src = 'std'; S.sensor = 'both'; S.excl = false; S.mapYear = null; S.hiGov = -2; S.page = 0;
    S.fsort = 'area'; S.fhi = -1;
    if ($('show-excl')) $('show-excl').checked = false;
    S.rT = CLIM_T[S.rMonth]; S.rH = CLIM_RH[S.rMonth];
    buildDays(); built = false;
  }
  if (OM) setCountry('oman');
  function sv(d) { return S.sensor === 'modis' ? d.mod : S.sensor === 'viirs' ? d.vii : d.mod + d.vii; }
  function fv_(d) { return S.sensor === 'modis' ? d.fm : S.sensor === 'viirs' ? d.fv : d.fm + d.fv; }
  function nv_(d) { return S.sensor === 'modis' ? d.nm : S.sensor === 'viirs' ? d.nv : d.nm + d.nv; }
  function satOn(i) { return S.sensor === 'both' || (S.sensor === 'modis' ? SAT_FAM[i] === 0 : SAT_FAM[i] === 1); }
  function inRange(d) { return d.y >= S.from && d.y <= S.to; }

  /* ---------- language and theme ---------- */
  function applyStatic() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('doc.title');
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) { els[i].textContent = t(els[i].getAttribute('data-i18n')); }
    var al = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < al.length; j++) { al[j].setAttribute('aria-label', t(al[j].getAttribute('data-i18n-aria'))); }
    $('btn-lang').lang = lang === 'ar' ? 'en' : 'ar';
    $('seg-src').title = t('f.srcHint');
  }
  function setLang(l) {
    lang = l; store.set('fira-lang', l);
    applyStatic(); buildCountryList(); renderHome(); renderCountry(true); resizeGlobe(); drawGlobe();
  }
  function isDark() { var th = document.documentElement.getAttribute('data-theme'); return th ? th === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function setTheme(th) {
    document.documentElement.setAttribute('data-theme', th); store.set('fira-theme', th);
    readColors(); renderCountry(false); renderHome(); drawGlobe();
  }

  /* =========================================================
     GLOBE
     A WebGL shader draws the Earth from NASA Blue Marble images (day, night lights, clouds, atmosphere).
     A 2D canvas on top draws borders, Oman, fire detections and the label, so they line up exactly.
     Scrolling the page flies the camera from space down to Oman. Dragging turns the globe by hand,
     then it drifts back to the scrolled view.
     ========================================================= */
  var gcv = $('globe'), gctx = gcv.getContext('2d'), glcv = $('globe-gl');
  var tip = $('globe-tip');
  var G = { lon: -30, lat: 14, k: 0.85, cxf: 0.5, cyf: 0.5, base: 0.4, w: 0, h: 0, dpr: 1, p: 0, ps: 0, dLon: 0, dLat: 0, uk: 1,
            down: false, moved: 0, hover: -1, hhl: -1, pLat: 0, pLon: 0, vx: 0, vy: 0, pointers: {}, pinch: 0, idleAt: 0, run: false };
    // camera path while scrolling: progress, longitude, latitude, zoom
  var PATH = [[0, -30, 14, 0.85], [0.28, 10, 24, 1.0], [0.55, 40, 26, 1.25], [0.78, 52, 24, 1.8], [1, 57.2, 21.5, 2.7]];
  // scenes: first and last scroll position at which each is shown
  var SCENES = [[0, 0.2], [0.25, 0.46], [0.51, 0.72], [0.78, 1.01]];

  // bounding boxes for picking
  WORLD.forEach(function (c) {
    var x0 = 999, x1 = -999, y0 = 999, y1 = -999;
    c.p.forEach(function (poly) { poly[0].forEach(function (pt) { if (pt[0] < x0) x0 = pt[0]; if (pt[0] > x1) x1 = pt[0]; if (pt[1] < y0) y0 = pt[1]; if (pt[1] > y1) y1 = pt[1]; }); });
    c.bb = [x0, x1, y0, y1];
  });
  // highlighted countries: world polygon (or the state polygons for a part of a country) and glowing detections
  var HL = [];
  function fireDots(D) {
    var cnt = {}, mxc = 1, out = [], ck;
    D.v.std.cellrows.forEach(function (r) { cnt[r[0]] = (cnt[r[0]] || 0) + r[2]; });
    for (ck in cnt) { if (cnt[ck] > mxc) mxc = cnt[ck]; }
    for (ck in cnt) { out.push([D.cells[ck][0], D.cells[ck][1], Math.sqrt(cnt[ck] / mxc)]); }
    out.sort(function (a, b) { return b[2] - a[2]; });
    return out.slice(0, 1400);
  }
  COUNTRIES.forEach(function (c) {
    if (!c.ready) return;
    var cfg = CFGS[c.id], idx = -1, polys = null;
    WORLD.forEach(function (w, i) { if (w.i === c.iso) idx = i; });
    if (cfg.hl === 'govs') { polys = []; cfg.data.govs.forEach(function (g) { polys = polys.concat(g.p); }); } else if (idx >= 0) polys = WORLD[idx].p;
    HL.push({ c: c, cfg: cfg, idx: idx, polys: polys, fire: fireDots(cfg.data) });
  });
  function hlAt(idx) {
    for (var k = 0; k < HL.length; k++) {
      var e = HL[k];
      if (e.idx !== idx) continue;
      if (e.cfg.hl === 'world') return k;
      var b = e.cfg.data.meta.box;
      if (G.pLat >= b[0] && G.pLat <= b[1] && G.pLon >= b[2] && G.pLon <= b[3]) return k;
    }
    return -1;
  }

  /* ---------- WebGL Earth ---------- */
  var GL = { ok: false, loaded: 0 };
  var VS = '#version 300 es\nvoid main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }';
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 uRes; uniform vec2 uC; uniform float uR; uniform float uLon; uniform float uLat; uniform float uTime;',
    'uniform sampler2D tDay; uniform sampler2D tNight; uniform sampler2D tMask;',
    'out vec4 o;',
    'const float PI = 3.14159265;',
    'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'void main(){',
    '  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 q = (px - uC) / uR; q.y = -q.y;',
    '  float r2 = dot(q, q), r = sqrt(r2);',
    '  float z = sqrt(max(1.0 - r2, 0.0));',
    '  vec3 n = vec3(q, z);',
    '  float p0 = uLat;',
    '  float lat = asin(clamp(z * sin(p0) + q.y * cos(p0), -1.0, 1.0));',
    '  float xl = q.x, zl = z * cos(p0) - q.y * sin(p0);',
    '  float u1 = (uLon + atan(xl, zl)) / (2.0 * PI) + 0.5;',
    '  float u2 = (uLon + atan(-xl, -zl) + PI) / (2.0 * PI) + 0.5;',
    '  float v = 0.5 - lat / PI;',
    '  vec2 g1x = dFdx(vec2(u1, v)), g1y = dFdy(vec2(u1, v)), g2x = dFdx(vec2(u2, v)), g2y = dFdy(vec2(u2, v));',
    '  bool useB = abs(g1x.x) + abs(g1y.x) > abs(g2x.x) + abs(g2y.x);',
    '  vec2 gx = useB ? g2x : g1x, gy = useB ? g2y : g1y;',
    '  vec2 uv = vec2(u1, v);',
    '  vec3 day = textureGrad(tDay, uv, gx, gy).rgb;',
    '  vec3 nt = textureGrad(tNight, uv, gx, gy).rgb;',
    '  vec3 mk = textureGrad(tMask, uv, gx, gy).rgb;',
    '  float cl = textureGrad(tMask, uv + vec2(uTime * 0.00035, 0.0), gx, gy).b;',
    '  float land = mk.g;',
    '  vec3 s = normalize(vec3(-0.50, 0.36, 0.79));',
    '  float d = dot(n, s);',
    '  float dayk = smoothstep(-0.16, 0.24, d);',
    '  float lit = 0.34 + 0.78 * smoothstep(-0.2, 1.0, d);',
    '  vec3 dcol = day * lit;',
    '  dcol = mix(dcol, dcol * vec3(0.92, 1.0, 1.08) + vec3(0.0, 0.01, 0.03), 1.0 - land);',
    '  float spec = pow(max(dot(reflect(-s, n), vec3(0.0, 0.0, 1.0)), 0.0), 140.0) * (1.0 - land) * 0.22;',
    '  float cloud = smoothstep(0.38, 0.95, cl) * 0.78;',
    '  dcol = mix(dcol, vec3(0.96, 0.97, 1.0) * lit, cloud) + spec;',
    '  vec3 ncol = nt * vec3(1.7, 1.3, 0.9) * 1.25 + vec3(0.004, 0.007, 0.016);',
    '  ncol *= 1.0 - cloud * 0.6;',
    '  vec3 col = mix(ncol, dcol, dayk);',
    '  float f = pow(1.0 - z, 2.7);',
    '  vec3 atm = vec3(0.30, 0.56, 1.0);',
    '  col += atm * f * (0.28 + 0.95 * smoothstep(-0.35, 0.6, d)) * 0.95;',
    '  float fw = max(fwidth(r), 0.0005);',
    '  float t = smoothstep(1.0 - fw, 1.0 + fw, r);',
    '  float h = max(r - 1.0, 0.0);',
    '  float gl = exp(-h * 13.0) * 0.85;',
    '  float side = 0.25 + 0.75 * smoothstep(-0.5, 0.7, dot(q / max(r, 0.001), s.xy));',
    '  float ga = clamp(gl, 0.0, 1.0) * (r < 1.45 ? 1.0 : 0.0);',
    '  vec4 outc = vec4(atm * side * ga, ga);',
    '  vec4 inc = vec4(col, 1.0);',
    '  vec4 res = mix(inc, outc, t);',
    '  vec2 sg = floor(px / 5.0);',
    '  float sh = hash(sg + 7.0);',
    '  float sd = length(fract(px / 5.0) - 0.5);',
    '  float star = step(0.9965, sh) * smoothstep(0.34, 0.0, sd) * (0.25 + 0.55 * hash(sg + 31.0));',
    '  res.rgb += vec3(star) * (1.0 - res.a);',
    '  res.a = max(res.a, star * (1.0 - res.a));',
    '  o = res;',
    '}'
  ].join('\n');

  function initGL() {
    if (!EARTH) return;
    var gl = glcv.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; } return s; }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(pr)); return; }
    GL.gl = gl; GL.pr = pr; GL.u = {};
    ['uRes', 'uC', 'uR', 'uLon', 'uLat', 'uTime', 'tDay', 'tNight', 'tMask'].forEach(function (n) { GL.u[n] = gl.getUniformLocation(pr, n); });
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    GL.tex = [];
    [EARTH.day, EARTH.night, EARTH.mask].forEach(function (src, i) {
      var tx = gl.createTexture(), im = new Image();
      GL.tex.push(tx);
      im.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        GL.loaded++;
        if (GL.loaded === 3) { GL.ok = true; gcv.classList.add('gl'); drawGlobe(performance.now()); }
      };
      im.src = src;
    });
  }
  function drawGL(now) {
    if (!GL.ok) return;
    var gl = GL.gl;
    gl.viewport(0, 0, glcv.width, glcv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(GL.pr);
    gl.uniform2f(GL.u.uRes, glcv.width, glcv.height);
    gl.uniform2f(GL.u.uC, G.w * G.cxf * G.dpr, G.h * G.cyf * G.dpr);
    gl.uniform1f(GL.u.uR, G.base * G.k * G.dpr);
    gl.uniform1f(GL.u.uLon, G.lon * RAD);
    gl.uniform1f(GL.u.uLat, G.lat * RAD);
    gl.uniform1f(GL.u.uTime, (now || 0) / 1000);
    for (var i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, GL.tex[i]); }
    gl.uniform1i(GL.u.tDay, 0); gl.uniform1i(GL.u.tNight, 1); gl.uniform1i(GL.u.tMask, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------- projection for the 2D overlay (same maths as the shader, orthographic) ---------- */
  function proj(lon, lat) {
    var l = (lon - G.lon) * RAD, p = lat * RAD, p0 = G.lat * RAD;
    var cp = Math.cos(p), x = cp * Math.sin(l);
    var y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(l);
    var z = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(l);
    return [x, y, z];
  }
  function ringPath(ctx, ring, cx, cy, R) {
    var n = ring.length, xs = new Array(n), ys = new Array(n), vis = 0, i, q, len;
    for (i = 0; i < n; i++) {
      q = proj(ring[i][0], ring[i][1]);
      if (q[2] > 0) { vis++; xs[i] = cx + R * q[0]; ys[i] = cy - R * q[1]; }
      else { len = Math.hypot(q[0], q[1]) || 1; xs[i] = cx + R * q[0] / len; ys[i] = cy - R * q[1] / len; }
    }
    if (!vis) return false;
    ctx.moveTo(xs[0], ys[0]);
    for (i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.closePath();
    return true;
  }
  function polyPath(ctx, poly, cx, cy, R) {
    var any = false;
    for (var r = 0; r < poly.length; r++) { if (ringPath(ctx, poly[r], cx, cy, R)) any = true; }
    return any;
  }
  function globeR() { return G.base * G.k; }
  function resizeGlobe() {
    var wrap = $('stage-in'); if (!wrap) return;
    var r = wrap.getBoundingClientRect();
    if (!r.width) return;
    G.dpr = Math.min(window.devicePixelRatio || 1, 2);
    G.w = r.width; G.h = r.height;
    var narrow = G.w < 820;
    G.cxf = narrow ? 0.5 : 0.69; G.cyf = narrow ? 0.36 : 0.5;
    G.base = Math.min(G.w, G.h) * (narrow ? 0.34 : 0.40);
    [gcv, glcv].forEach(function (c) { c.width = Math.round(G.w * G.dpr); c.height = Math.round(G.h * G.dpr); });
  }
  function drawGlobe(now) {
    if (!G.w) return;
    drawGL(now);
    var ctx = gctx, W = G.w, H = G.h, cx = W * G.cxf, cy = H * G.cyf, R = globeR(), i, j, q;
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
    if (!GL.ok) {                                   // fallback when WebGL 2 is not available
      ctx.fillStyle = '#0B1A33'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.fillStyle = '#2A3B33'; ctx.beginPath();
      for (i = 0; i < WORLD.length; i++) { for (j = 0; j < WORLD[i].p.length; j++) polyPath(ctx, WORLD[i].p[j], cx, cy, R); }
      ctx.fill('evenodd');
    }
    // country borders
    var skip = {};
    HL.forEach(function (e) { if (e.cfg.hl === 'world' && e.idx >= 0) skip[e.idx] = 1; });
    ctx.lineJoin = 'round'; ctx.lineWidth = G.k > 1.5 ? 1 : 0.7; ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    for (i = 0; i < WORLD.length; i++) { if (skip[i]) continue; for (j = 0; j < WORLD[i].p.length; j++) polyPath(ctx, WORLD[i].p[j], cx, cy, R); }
    ctx.stroke();
    if (G.hover >= 0 && !skip[G.hover] && G.hhl < 0) {
      ctx.beginPath(); for (j = 0; j < WORLD[G.hover].p.length; j++) polyPath(ctx, WORLD[G.hover].p[j], cx, cy, R);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    // highlighted countries
    HL.forEach(function (e, k) {
      if (!e.polys) return;
      var hv = G.hhl === k;
      ctx.beginPath(); for (var jj = 0; jj < e.polys.length; jj++) polyPath(ctx, e.polys[jj], cx, cy, R);
      ctx.fillStyle = hv ? 'rgba(255,112,48,0.34)' : 'rgba(255,112,48,0.20)'; ctx.fill('evenodd');
      ctx.strokeStyle = '#FFB26B'; ctx.lineWidth = hv ? 2.2 : 1.4; ctx.stroke();
    });
    // fire detections glow as the camera comes in
    var fa = clamp((G.ps - 0.62) / 0.28, 0, 1);
    if (fa > 0) {
      ctx.globalCompositeOperation = 'lighter';
      HL.forEach(function (e) {
        var FIRE = e.fire;
        for (var i2 = 0; i2 < FIRE.length; i2++) {
          var q2 = proj(FIRE[i2][1], FIRE[i2][0]);
          if (q2[2] < 0.1) continue;
          var rr = (0.9 + 2.8 * FIRE[i2][2]) * Math.min(G.k, 2.2) / 1.4, x = cx + R * q2[0], y = cy - R * q2[1];
          var gr = ctx.createRadialGradient(x, y, 0, x, y, rr * 2.6);
          gr.addColorStop(0, 'rgba(255,226,150,' + (0.5 * fa) + ')'); gr.addColorStop(0.35, 'rgba(255,120,40,' + (0.2 * fa) + ')'); gr.addColorStop(1, 'rgba(255,60,20,0)');
          ctx.fillStyle = gr; ctx.fillRect(x - rr * 2.6, y - rr * 2.6, rr * 5.2, rr * 5.2);
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // pulse ring and label on each loaded country
    HL.forEach(function (e) {
      var q3 = proj(e.cfg.center[0], e.cfg.center[1]);
      if (q3[2] <= 0.15) return;
      var x0 = cx + R * q3[0], y0 = cy - R * q3[1];
      if (G.ps < 0.8) {
        var ph = reduce ? 0.4 : ((now || 0) / 2200) % 1;
        ctx.strokeStyle = '#FFB26B'; ctx.globalAlpha = (1 - ph) * (1 - G.ps / 0.8); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x0, y0, 8 + ph * 26, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = 1;
      }
      var la = clamp((G.ps - 0.1) / 0.2, 0, 1) * (1 - clamp((G.ps - 0.9) / 0.1, 0, 1));
      if (la > 0.02) {
        var nm = countryName(e.c);
        ctx.font = '400 13px ' + (lang === 'ar' ? "'IBM Plex Sans Arabic'" : "'Jost'") + ', sans-serif';
        if ('letterSpacing' in ctx) ctx.letterSpacing = lang === 'ar' ? '0px' : '4px';
        ctx.fillStyle = 'rgba(255,255,255,' + (0.92 * la) + ')'; ctx.textAlign = 'center';
        ctx.fillText(lang === 'ar' ? nm : nm.toUpperCase(), x0, y0 - 34 - 8 * Math.min(G.k, 2));
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      }
    });
  }
  function pickCountry(px, py) {
    var W = G.w, H = G.h, R = globeR(), cx = W * G.cxf, cy = H * G.cyf;
    var x = (px - cx) / R, y = (cy - py) / R, r2 = x * x + y * y;
    if (r2 > 1) return -1;
    var z = Math.sqrt(1 - r2), p0 = G.lat * RAD;
    var lat = Math.asin(clamp(z * Math.sin(p0) + y * Math.cos(p0), -1, 1)) / RAD;
    var lon = G.lon + Math.atan2(x, z * Math.cos(p0) - y * Math.sin(p0)) / RAD;
    while (lon > 180) lon -= 360; while (lon < -180) lon += 360;
    G.pLat = lat; G.pLon = lon;
    for (var i = 0; i < WORLD.length; i++) {
      var c = WORLD[i], b = c.bb;
      if (lon < b[0] || lon > b[1] || lat < b[2] || lat > b[3]) continue;
      for (var p = 0; p < c.p.length; p++) {
        if (inRing(c.p[p][0], lon, lat)) {
          var hole = false;
          for (var h = 1; h < c.p[p].length; h++) { if (inRing(c.p[p][h], lon, lat)) { hole = true; break; } }
          if (!hole) return i;
        }
      }
    }
    return -1;
  }
  function inRing(ring, x, y) {
    var c = false, n = ring.length;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }

  /* ---------- scroll: camera path and scenes ---------- */
  function ease(t) { return t * t * (3 - 2 * t); }
  function pose(p) {
    var i = 0;
    while (i < PATH.length - 2 && p > PATH[i + 1][0]) i++;
    var a = PATH[i], b = PATH[i + 1], t = ease(clamp((p - a[0]) / (b[0] - a[0]), 0, 1));
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  function readScroll() {
    var st = $('stage'); if (!st || $('view-home').hidden) return;
    var r = st.getBoundingClientRect(), span = Math.max(1, r.height - window.innerHeight);
    G.p = clamp(-r.top / span, 0, 1);
  }
  function updateScenes() {
    var els = document.querySelectorAll('.scene'), p = G.ps;
    for (var i = 0; i < els.length; i++) {
      var s = SCENES[i], fi = 0.035, o = clamp((p - s[0]) / fi, 0, 1) * clamp((s[1] - p) / fi, 0, 1);
      if (i === 0) o = clamp((s[1] - p) / fi, 0, 1);
      els[i].style.opacity = o.toFixed(3);
      els[i].style.transform = 'translateY(' + ((1 - o) * 14).toFixed(1) + 'px)';
      els[i].style.visibility = o > 0.01 ? 'visible' : 'hidden';
      els[i].style.pointerEvents = o > 0.6 ? 'auto' : 'none';
    }
    $('cue').style.opacity = String(clamp(1 - p / 0.06, 0, 1));
  }
  function globeLoop(now) {
    if (!G.run) return;
    if (document.hidden || $('view-home').hidden) { G.run = false; return; }
    G.ps += (G.p - G.ps) * (reduce ? 1 : 0.1);
    if (Math.abs(G.p - G.ps) < 0.0005) G.ps = G.p;
    var b = pose(G.ps);
    if (!G.down) {
      if (Math.abs(G.vx) > 0.01 || Math.abs(G.vy) > 0.01) { G.dLon -= G.vx; G.dLat = clamp(G.dLat + G.vy, -60, 60); G.vx *= 0.94; G.vy *= 0.94; }
      else if (now - G.idleAt > 1600) { G.dLon *= 0.95; G.dLat *= 0.95; G.uk += (1 - G.uk) * 0.05; }
    }
    G.lon = b[0] + G.dLon; G.lat = clamp(b[1] + G.dLat, -80, 80); G.k = b[2] * G.uk;
    drawGlobe(now); updateScenes();
    requestAnimationFrame(globeLoop);
  }
  function startGlobe() {
    if (G.run) return;
    G.run = true; readScroll();
    if (!G.ps && G.p) G.ps = G.p;
    requestAnimationFrame(globeLoop);
  }
  function showTip(text, px, py) { tip.textContent = text; tip.hidden = false; tip.style.left = px + 'px'; tip.style.top = py + 'px'; }
  function globeEvents() {
    function pos(e) { var r = gcv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    gcv.addEventListener('pointerdown', function (e) {
      gcv.setPointerCapture(e.pointerId);
      G.pointers[e.pointerId] = pos(e);
      var ids = Object.keys(G.pointers);
      if (ids.length === 2) { var a = G.pointers[ids[0]], b = G.pointers[ids[1]]; G.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      G.down = true; G.moved = 0; G.vx = 0; G.vy = 0; gcv.classList.add('drag');
    });
    gcv.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (G.down && G.pointers[e.pointerId]) {
        var prev = G.pointers[e.pointerId], dx = p[0] - prev[0], dy = p[1] - prev[1];
        G.pointers[e.pointerId] = p;
        var ids = Object.keys(G.pointers);
        if (ids.length >= 2) {
          var a = G.pointers[ids[0]], b = G.pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (G.pinch) G.uk = clamp(G.uk * d / G.pinch, 0.6, 2.4); G.pinch = d; G.moved += 10;
        } else {
          var f = 1 / (globeR() * RAD) * 0.9;
          G.dLon -= dx * f; G.dLat = clamp(G.dLat + dy * f, -60, 60); G.vx = dx * f * 0.6; G.vy = dy * f * 0.6; G.moved += Math.abs(dx) + Math.abs(dy);
        }
        G.idleAt = performance.now(); tip.hidden = true;
      } else if (!G.down) {
        var idx = pickCountry(p[0], p[1]);
        var hl = idx >= 0 ? hlAt(idx) : -1;
        G.hover = idx; G.hhl = hl;
        gcv.classList.toggle('pointer', hl >= 0);
        if (idx >= 0) {
          var isOm = hl >= 0;
          var nm = isOm ? countryName(HL[hl].c) : (lang === 'ar' && WORLD[idx].a ? WORLD[idx].a : WORLD[idx].n);
          showTip(nm + ' · ' + (isOm ? t('tip.open') : t('tip.soon')), p[0], p[1]);
        } else tip.hidden = true;
      }
    });
    function end(e) {
      var wasClick = G.moved < 6 && G.pointers[e.pointerId];
      delete G.pointers[e.pointerId]; G.pinch = 0;
      if (!Object.keys(G.pointers).length) { G.down = false; G.idleAt = performance.now(); gcv.classList.remove('drag'); }
      if (wasClick && e.type === 'pointerup') {
        var p = pos(e), idx = pickCountry(p[0], p[1]);
        var hk = idx >= 0 ? hlAt(idx) : -1;
        if (hk >= 0) location.hash = '#' + HL[hk].c.id;
      }
    }
    gcv.addEventListener('pointerup', end);
    gcv.addEventListener('pointercancel', end);
    gcv.addEventListener('pointerleave', function () { if (!G.down) { G.hover = -1; G.hhl = -1; tip.hidden = true; gcv.classList.remove('pointer'); } });
    gcv.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      G.uk = clamp(G.uk * (e.deltaY < 0 ? 1.08 : 0.92), 0.6, 2.4); G.idleAt = performance.now();
    }, { passive: false });
    window.addEventListener('scroll', readScroll, { passive: true });
  }

  /* =========================================================
     HOME PAGE
     ========================================================= */
  function sparkSvg(D) {
    var by = {}, y0 = D.meta.y0, n = +D.meta.last.slice(0, 4) - y0 + 1, i, max = 1, Y_MIN = y0;
    D.v.std.days.forEach(function (r) { var y = +r[0].slice(0, 4); by[y] = (by[y] || 0) + r[1] + r[2]; });   // MODIS only: one steady sensor family
    for (i = 0; i < n; i++) { if ((by[Y_MIN + i] || 0) > max) max = by[Y_MIN + i]; }
    var w = 80, h = 22, bw = w / n, out = '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    for (i = 0; i < n; i++) {
      var v = (by[Y_MIN + i] || 0) / max * (h - 2);
      out += '<rect x="' + (i * bw + 0.3).toFixed(2) + '" y="' + (h - v - 1).toFixed(2) + '" width="' + (bw - 0.6).toFixed(2) + '" height="' + Math.max(v, 0.8).toFixed(2) + '"/>';
    }
    return out + '</svg>';
  }
  function buildCountryList() {
    var h = '';
    COUNTRIES.forEach(function (c) {
      if (c.ready) h += '<li><a href="#' + c.id + '"><span class="nm">' + esc(countryName(c)) + '</span>' + sparkSvg(CFGS[c.id].data) + '<span class="st">' + esc(t('home.open')) + '</span></a></li>';
      else h += '<li><div class="soon"><span class="nm">' + esc(countryName(c)) + '</span><span class="st">' + esc(t('home.soon')) + '</span></div></li>';
    });
    $('country-list').innerHTML = h;
  }
  function renderHome() {
    if (!DATA.oman) return;
    var mt = DATA.oman.meta, std = DATA.oman.v.std.days, i;
    var RD = COUNTRIES.filter(function (c) { return c.ready; }).map(function (c) { return CFGS[c.id].data; });
    var rawAll = 0, keptAll = 0, yA = 9999, yB = 0;
    RD.forEach(function (D) { rawAll += D.meta.raw_total; keptAll += D.meta.kept.std; yA = Math.min(yA, D.meta.y0); yB = Math.max(yB, +D.meta.last.slice(0, 4)); });
    $('home-stats').innerHTML =
      '<div><dt>' + esc(t('hs.raw')) + '</dt><dd>' + nf.format(rawAll) + '</dd></div>' +
      '<div><dt>' + esc(t('hs.kept')) + '</dt><dd>' + nf.format(keptAll) + '</dd></div>' +
      '<div><dt>' + esc(t('hs.regions')) + '</dt><dd>' + RD.length + '</dd></div>' +
      '<div><dt>' + esc(t('hs.span')) + '</dt><dd>' + yA + '–' + yB + '</dd></div>';

    // last 30 days
    var end = new Date(mt.last + 'T00:00:00Z').getTime(), vals = [], sum = 0, peak = null, pk = 0, byDay = {};
    std.forEach(function (r) { byDay[r[0]] = r[1] + r[2] + r[3] + r[4] + r[5]; });
    for (i = 29; i >= 0; i--) {
      var ds = new Date(end - i * 864e5).toISOString().slice(0, 10), v = byDay[ds] || 0;
      vals.push(v); sum += v; if (v > pk) { pk = v; peak = ds; }
    }
    var max = Math.max.apply(null, vals.concat([1])), W = 300, H = 56, bw = W / 30, svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('hs.last')) + '">';
    vals.forEach(function (v, k) {
      var hh = v / max * (H - 4);
      svg += '<rect x="' + (k * bw + 1).toFixed(1) + '" y="' + (H - hh).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + Math.max(hh, v ? 1.5 : 0).toFixed(1) + '"/>';
    });
    svg += '<line x1="0" x2="' + W + '" y1="' + (H - 0.5) + '" y2="' + (H - 0.5) + '"/></svg>';
    $('home-30').innerHTML =
      '<div class="l30-n"><b>' + nf.format(sum) + '</b><span>' + esc(t('hs.last')) + '</span></div>' +
      '<div class="l30-c">' + svg + '</div>' +
      '<p class="cap">' + esc(countryName(COUNTRIES[0]) + ': ' + t('hs.lastNote', { last: fmtDate(mt.last) })) + ' ' + esc(peak ? t('hs.peak', { d: fmtDate(peak), n: nf.format(pk) }) : t('hs.none')) + '</p>';

    // three steps
    var pct = Math.round(100 * (rawAll - keptAll) / rawAll);
    $('home-steps').innerHTML =
      '<li><b class="sn">1</b><h3>' + esc(t('how.s1t')) + '</h3><p>' + esc(t('how.s1', { raw: nf.format(rawAll), year: yA })) + '</p></li>' +
      '<li><b class="sn">2</b><h3>' + esc(t('how.s2t')) + '</h3><p>' + esc(t('how.s2', { pct: pct })) + '</p></li>' +
      '<li><b class="sn">3</b><h3>' + esc(t('how.s3t')) + '</h3><p>' + esc(t('how.s3')) + '</p></li>';

    // MODIS vs VIIRS
    var rows = [
      ['vs.pixel', 'vs.modisPixel', 'vs.viirsPixel'],
      ['vs.sats', 'vs.modisSats', 'vs.viirsSats'],
      ['vs.since', null, null],
      ['vs.best', 'vs.modisBest', 'vs.viirsBest']
    ];
    var h = '<div class="vs-h"></div><div class="vs-h"><i class="k-sq"></i>MODIS</div><div class="vs-h"><i class="k-ci"></i>VIIRS</div>';
    rows.forEach(function (r) {
      h += '<div class="vs-l">' + esc(t(r[0])) + '</div>';
      h += '<div>' + esc(r[1] ? t(r[1]) : mt.first_modis.slice(0, 4)) + '</div><div>' + esc(r[2] ? t(r[2]) : mt.first_viirs.slice(0, 4)) + '</div>';
    });
    $('home-vs-body').innerHTML = h;
  }

  /* =========================================================
     COUNTRY PAGE
     ========================================================= */
  function fillSelect(id, from, to, value) {
    var el = $(id), h = '';
    for (var y = from; y <= to; y++) h += '<option value="' + y + '"' + (y === value ? ' selected' : '') + '>' + y + '</option>';
    el.innerHTML = h;
  }
  function setRadio(name, value) {
    var els = document.getElementsByName(name);
    for (var i = 0; i < els.length; i++) els[i].checked = els[i].value === value;
  }
  /* ----- fires, grouped from the standard record ----- */
  var FEV = [];
  function evDays(e) { return Math.round((Date.parse(e[1]) - Date.parse(e[0])) / 864e5) + 1; }
  // a source that burns for over a month on a few square kilometres is a fixed heat source, not a fire
  function evFire(e) { return !(evDays(e) > 30 && e[4] < 15); }
  function evAll() { return OM.events.filter(function (e) { var y = +e[0].slice(0, 4); return y >= S.from && y <= S.to; }); }
  function evInRange() { return evAll().filter(evFire); }
  function renderFires() {
    var evs = evInRange();
    var key = S.fsort === 'dur' ? function (e) { return evDays(e); } : S.fsort === 'power' ? function (e) { return e[5]; } : function (e) { return e[4]; };
    evs.sort(function (a, b) { return key(b) - key(a); });
    FEV = evs.slice(0, 100);
    if (!FEV.length) { $('fires-skip').textContent = ''; $('fires').innerHTML = '<p class="empty-note">' + esc(t('fi.none')) + '</p>'; return; }
    var h = '<table class="ft"><thead><tr><th>#</th><th>' + esc(t('fi.when')) + '</th><th class="r">' + esc(t('fi.length')) + '</th><th class="r">' + esc(t('fi.sizeKm')) +
      '</th><th class="r">' + esc(t('fi.peak')) + '</th><th class="r">' + esc(t('fi.n')) + '</th></tr></thead><tbody>';
    FEV.forEach(function (e, i) {
      h += '<tr tabindex="0" data-f="' + i + '"' + (i === S.fhi ? ' class="on"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(fmtDate(e[0])) + (e[0] === e[1] ? '' : ' – ' + esc(fmtDate(e[1]))) +
        '</td><td class="r">' + evDays(e) + '</td><td class="r">' + nf.format(e[4]) + '</td><td class="r">' + nf.format(e[5]) + '</td><td class="r">' + nf.format(e[6]) + '</td></tr>';
    });
    $('fires').innerHTML = h + '</tbody></table>';
    var skipped = evAll().length - evs.length;
    $('fires-skip').textContent = skipped ? t('fi.skip', { n: nf.format(skipped) }) : '';
  }
  function renderCheck() {
    var mt = OM.meta, pct = Math.round(mt.resid24 * 1000) / 10, h = '';
    h += '<div class="ck-gauge"><div class="ck-n"><b>' + pct.toFixed(1) + '%</b><span>' + esc(t('ck.resid')) + '</span></div>' +
      '<div class="ck-bar" role="img" aria-label="' + pct + '%"><i style="width:' + Math.max(pct, 0.6) + '%"></i></div>' +
      '<p class="cap">' + esc(t('ck.residHint')) + ' ' + esc(t('ck.persist', { n: nf.format(mt.persist_cells) })) + '</p></div>';
    if (CUR.id === 'oman') h += '<p class="ck-msg">' + esc(t('ck.oman', { p: Math.round(pct) })) + '</p>';
    if (OM.check && OM.check.length) {
      var ok = 0;
      h += '<h3 class="sub">' + esc(t('ck.known')) + '</h3><p class="cap">' + esc(t('ck.knownText')) + '</p><table class="ft"><thead><tr><th>' + esc(t('ck.fire')) + '</th><th>' + esc(t('ck.date')) +
        '</th><th class="r">' + esc(t('ck.raw')) + '</th><th class="r">' + esc(t('ck.kept')) + '</th><th class="r">' + esc(t('ck.share')) + '</th></tr></thead><tbody>';
      OM.check.forEach(function (c) {
        var sh = c.raw ? c.kept / c.raw : 0; if (sh >= 0.9) ok++;
        h += '<tr><td>' + esc(c.name) + '</td><td>' + esc(fmtDate(c.date)) + '</td><td class="r">' + nf.format(c.raw) + '</td><td class="r">' + nf.format(c.kept) + '</td><td class="r">' + Math.round(sh * 100) + '%</td></tr>';
      });
      h += '</tbody></table><p class="ck-msg">' + esc(t('ck.summary', { k: ok, n: OM.check.length })) + '</p>';
    } else h += '<p class="cap">' + esc(t('ck.noKnown')) + '</p>';
    $('check').innerHTML = h;
  }
  function renderStats() {
    var tot = 0, act = 0, mw = 0, byYear = {}, best = null;
    days.forEach(function (d) {
      if (!inRange(d)) return;
      var n = sv(d); if (!n) return;
      tot += n; act++; mw += fv_(d); byYear[d.y] = (byYear[d.y] || 0) + n;
    });
    var evs = evInRange(), longest = 0;
    evs.forEach(function (e) { var dd = evDays(e); if (dd > longest) longest = dd; });
    for (var y in byYear) { if (best === null || byYear[y] > byYear[best]) best = y; }
    $('stats').innerHTML =
      '<div><dt>' + esc(t('s.det')) + '</dt><dd>' + nf.format(tot) + '</dd></div>' +
      '<div><dt>' + esc(t('s.days')) + '</dt><dd>' + nf.format(act) + '</dd></div>' +
      '<div><dt>' + esc(t('s.year')) + '</dt><dd>' + (best === null ? esc(t('s.none')) : best) + '</dd></div>' +
      '<div><dt>' + esc(t('s.power')) + '</dt><dd>' + nf.format(Math.round(mw)) + '</dd></div>' +
      '<div><dt>' + esc(t('s.fires')) + '</dt><dd>' + nf.format(evs.length) + '</dd></div>' +
      '<div><dt>' + esc(t('s.longest')) + '</dt><dd>' + (longest ? esc(t('s.days2', { n: nf.format(longest) })) : esc(t('s.none'))) + '</dd></div>';
  }
  function renderHeaderImage() {
    probe(OVERVIEW_IMG, function (ok) {
      $('c-fig').hidden = !ok;
      if (ok) $('c-img').src = OVERVIEW_IMG;
      $('c-img').alt = $('c-cap').textContent = t('c.imgCap', { place: countryName(cOf(CUR.id)) });
    });
  }

  /* ----- map ----- */
  var MAP = { marks: [], w: 0, h: 0, dpr: 1, z: 1, tx: 0, ty: 0 };
  var MAPIMG = null;
  if (EARTH && EARTH.day) { var mi = new Image(); mi.onload = function () { MAPIMG = mi; if (typeof drawMap === 'function' && $('view-country') && !$('view-country').hidden) drawMap(); }; mi.src = EARTH.day; }
  var mcv = $('map'), mctx = mcv.getContext('2d');
  var play = { timer: 0 };
  function sizeMap() {
    var r = mcv.getBoundingClientRect(); if (!r.width) return false;
    MAP.dpr = Math.min(window.devicePixelRatio || 1, 2); MAP.w = r.width; MAP.h = r.height;
    mcv.width = Math.round(r.width * MAP.dpr); mcv.height = Math.round(r.height * MAP.dpr);
    return true;
  }
  function drawMap() {
    if (!OM || !sizeMap()) return;
    var ctx = mctx, W = MAP.w, H = MAP.h, pad = 14, b = OM.meta.box; // lat0, lat1, lon0, lon1
    var cosL = Math.cos(CUR.cosLat * RAD);
    var s = Math.min((W - 2 * pad) / ((b[3] - b[2]) * cosL), (H - 2 * pad) / (b[1] - b[0]));
    var ox = (W - (b[3] - b[2]) * cosL * s) / 2, oy = (H - (b[1] - b[0]) * s) / 2;
    var Z = MAP.z;
    var X = function (lon) { return (ox + (lon - b[2]) * cosL * s - W / 2) * Z + W / 2 + MAP.tx; };
    var Y = function (lat) { return (oy + (b[1] - lat) * s - H / 2) * Z + H / 2 + MAP.ty; };
    var iLon = function (x) { return b[2] + ((((x - W / 2 - MAP.tx) / Z) + W / 2) - ox) / (cosL * s); };
    var iLat = function (y) { return b[1] - ((((y - H / 2 - MAP.ty) / Z) + H / 2) - oy) / s; };
    ctx.setTransform(MAP.dpr, 0, 0, MAP.dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    // satellite picture behind the data (NASA Blue Marble), darkened so the detections stand out
    var hasImg = !!MAPIMG;
    if (hasImg) {
      var la0 = clamp(iLat(H), -90, 90), la1 = clamp(iLat(0), -90, 90), lo0 = clamp(iLon(0), -180, 180), lo1 = clamp(iLon(W), -180, 180);
      var iw = MAPIMG.naturalWidth, ih = MAPIMG.naturalHeight;
      var sx = (lo0 + 180) / 360 * iw, sw = Math.max((lo1 - lo0) / 360 * iw, 1), sy = (90 - la1) / 180 * ih, sh = Math.max((la1 - la0) / 180 * ih, 1);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#0B1A33'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(MAPIMG, sx, sy, sw, sh, X(lo0), Y(la1), X(lo1) - X(lo0), Y(la0) - Y(la1));
      ctx.fillStyle = 'rgba(6,10,16,0.42)'; ctx.fillRect(0, 0, W, H);
    }
    // outlines
    ctx.lineJoin = 'round'; ctx.lineWidth = 1;
    WORLD.forEach(function (c, ci) {
      var bb = c.bb; if (bb[1] < b[2] - 1 || bb[0] > b[3] + 1 || bb[3] < b[0] - 1 || bb[2] > b[1] + 1) return;
      var isOm = CUR.hl === 'world' && c.i === CUR.iso;
      ctx.beginPath();
      c.p.forEach(function (poly) { poly.forEach(function (ring) { ring.forEach(function (pt, k) { if (k) ctx.lineTo(X(pt[0]), Y(pt[1])); else ctx.moveTo(X(pt[0]), Y(pt[1])); }); ctx.closePath(); }); });
      ctx.fillStyle = COL.land;
      if (isOm && !hasImg) ctx.fill('evenodd');
      ctx.strokeStyle = hasImg ? (isOm ? '#FFFFFF' : 'rgba(255,255,255,0.45)') : isOm ? COL.ink : COL.gline; ctx.lineWidth = isOm ? 1.3 : 0.8; ctx.stroke();
    });
    if (CUR.hl === 'govs') {
      ctx.beginPath();
      OM.govs.forEach(function (g) { g.p.forEach(function (poly) { poly.forEach(function (ring) { ring.forEach(function (pt, k) { if (k) ctx.lineTo(X(pt[0]), Y(pt[1])); else ctx.moveTo(X(pt[0]), Y(pt[1])); }); ctx.closePath(); }); }); });
      if (!hasImg) { ctx.fillStyle = COL.land; ctx.fill('evenodd'); } ctx.strokeStyle = hasImg ? '#FFFFFF' : COL.ink; ctx.lineWidth = 1.3; ctx.stroke();
    }
    // governorate borders, quiet; the hovered one is drawn heavier
    ctx.lineWidth = 0.6; ctx.strokeStyle = hasImg ? 'rgba(255,255,255,0.4)' : COL.gline;
    OM.govs.forEach(function (g, gi) {
      if (gi === S.hiGov) return;
      ctx.beginPath();
      g.p.forEach(function (poly) { poly.forEach(function (ring) { ring.forEach(function (pt, k) { if (k) ctx.lineTo(X(pt[0]), Y(pt[1])); else ctx.moveTo(X(pt[0]), Y(pt[1])); }); ctx.closePath(); }); });
      ctx.stroke();
    });
    if (S.hiGov >= 0) {
      ctx.beginPath();
      OM.govs[S.hiGov].p.forEach(function (poly) { poly.forEach(function (ring) { ring.forEach(function (pt, k) { if (k) ctx.lineTo(X(pt[0]), Y(pt[1])); else ctx.moveTo(X(pt[0]), Y(pt[1])); }); ctx.closePath(); }); });
      ctx.fillStyle = COL.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'; ctx.fill('evenodd');
      ctx.strokeStyle = COL.accent; ctx.lineWidth = 2; ctx.stroke();
    }
    // aggregate cells for the selection (or for one year during playback)
    var agg = {}, maxN = 1, i, r, fam, yr, rowMax = 1, one = S.mapYear !== null;
    for (i = 0; i < VAR.cellrows.length; i++) {
      r = VAR.cellrows[i]; fam = r[1] % 2; yr = OM.meta.y0 + (r[1] >> 1);
      if (yr < S.from || yr > S.to) continue;
      if (S.sensor === 'modis' && fam !== 0) continue;
      if (S.sensor === 'viirs' && fam !== 1) continue;
      if (r[2] > rowMax) rowMax = r[2];
      if (one && yr !== S.mapYear) continue;
      if (!agg[r[0]]) agg[r[0]] = [0, 0]; agg[r[0]][fam] += r[2];
    }
    for (var k in agg) { var mx = Math.max(agg[k][0], agg[k][1]); if (mx > maxN) maxN = mx; }
    if (one) maxN = rowMax;                    // same scale for every year, so the years can be compared
    MAP.marks = [];
    var keys = Object.keys(agg);
    $('map-empty').hidden = keys.length > 0;
    var zs = Math.min(Math.pow(Z, 0.6), 3.2);
    var rad = function (n) { return (2.2 + 7.5 * Math.sqrt(n / maxN)) * zs; };
    var dim = function (key) { return S.hiGov >= 0 && OM.cellgov[key] !== S.hiGov; };
    // excluded sources
    if (S.excl) {
      var mxE = 1; VAR.excluded.forEach(function (e) { if (e[2] > mxE) mxE = e[2]; });
      ctx.strokeStyle = COL.excl; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      VAR.excluded.forEach(function (e) {
        var x = X(e[1]), y = Y(e[0]), rr = 3 + 7 * Math.sqrt(e[2] / mxE);
        ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.stroke();
        MAP.marks.push({ x: x, y: y, r: rr, ex: e });
      });
      ctx.setLineDash([]);
    }
    // VIIRS circles first (larger, underneath), MODIS squares on top
    keys.forEach(function (key) {
      var a = agg[key], c = OM.cells[key], x = X(c[1]), y = Y(c[0]);
      ctx.globalAlpha = dim(key) ? 0.15 : 0.72;
      if (a[1] > 0) { ctx.fillStyle = COL.viirs; ctx.beginPath(); ctx.arc(x, y, rad(a[1]), 0, 6.2832); ctx.fill(); }
    });
    keys.forEach(function (key) {
      var a = agg[key], c = OM.cells[key], x = X(c[1]), y = Y(c[0]);
      ctx.globalAlpha = dim(key) ? 0.15 : 0.72;
      if (a[0] > 0) { var q = rad(a[0]) * 0.95; ctx.fillStyle = COL.modis; ctx.fillRect(x - q, y - q, 2 * q, 2 * q); }
      MAP.marks.push({ x: x, y: y, r: Math.max(rad(a[0]), rad(a[1])), a: a, lat: c[0], lon: c[1] });
    });
    ctx.globalAlpha = 1;
    // notable days: small rings, only while the whole selection is shown
    if (!one) {
      ctx.strokeStyle = hasImg ? '#FFFFFF' : COL.ink; ctx.lineWidth = 1.4;

    }
    // animated pins (notable days, selected fire) sit above the canvas
    var pins = '', addPin = function (la, lo, cls, label) {
      var x = X(lo), y = Y(la); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) return;
      pins += '<i class="pin ' + cls + '" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px"' + (label ? ' title="' + esc(label) + '"' : '') + '></i>';
    };
    if (!one) NOTABLE.forEach(function (n) { addPin(n.lat, n.lon, 'nt', fmtDate(n.date)); });
    if (S.fhi >= 0 && FEV[S.fhi]) addPin(FEV[S.fhi][2], FEV[S.fhi][3], 'sel', fmtDate(FEV[S.fhi][0]));
    $('map-pins').innerHTML = pins;
    // scale bar (100 km)
    var km100 = (100 / 111.32) * s * Z, bx = 12, by = H - 14;
    ctx.strokeStyle = hasImg ? '#FFFFFF' : COL.ink; ctx.fillStyle = hasImg ? 'rgba(255,255,255,0.85)' : COL.muted; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + km100, by); ctx.lineTo(bx + km100, by - 4); ctx.stroke();
    ctx.font = '11px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'left'; ctx.fillText('100 km', bx, by - 8);
    if (one) { ctx.font = '700 40px ' + getComputedStyle(document.body).fontFamily; ctx.fillStyle = hasImg ? '#FFFFFF' : COL.ink; ctx.globalAlpha = 0.85; ctx.textAlign = 'right'; ctx.fillText(String(S.mapYear), W - 12, 46); ctx.globalAlpha = 1; }
  }
  function mapEvents() {
    var tp = $('map-tip');
    mcv.addEventListener('pointermove', function (e) {
      var r = mcv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 1e9;
      MAP.marks.forEach(function (m) { var d = Math.hypot(m.x - x, m.y - y); if (d < m.r + 5 && d < bd) { bd = d; best = m; } });
      if (!best) { tp.hidden = true; return; }
      var txt;
      if (best.ex) txt = t('m.tipExcl', { months: best.ex[3] });
      else if (S.sensor === 'both') txt = t('m.tipBoth', { m: nf.format(best.a[0]), v: nf.format(best.a[1]) });
      else txt = t('m.tip', { n: nf.format(S.sensor === 'modis' ? best.a[0] : best.a[1]) });
      tp.textContent = txt; tp.hidden = false; tp.style.left = best.x + 'px'; tp.style.top = (best.y - best.r) + 'px';
    });
    mcv.addEventListener('pointerleave', function () { tp.hidden = true; });
    // zoom and pan: buttons, ctrl/cmd + wheel, double click, drag when zoomed, two-finger pinch
    var ptr = {}, pinch = 0, drag = null;
    function zoomAt(f, px, py) {
      var nz = clamp(MAP.z * f, 1, 14); f = nz / MAP.z;
      var W = MAP.w, H = MAP.h;
      MAP.tx = (px - W / 2) - ((px - W / 2) - MAP.tx) * f; MAP.ty = (py - H / 2) - ((py - H / 2) - MAP.ty) * f;
      MAP.z = nz; fixPan(); drawMap();
    }
    function fixPan() {
      var lim = function (v, n) { var m = (MAP.z - 1) * n / 2; return clamp(v, -m, m); };
      MAP.tx = lim(MAP.tx, MAP.w); MAP.ty = lim(MAP.ty, MAP.h);
      mcv.style.touchAction = MAP.z > 1 ? 'none' : 'pan-y'; mcv.style.cursor = MAP.z > 1 ? 'grab' : '';
      $('mz-reset').disabled = MAP.z === 1;
    }
    window.resetMapView = function () { MAP.z = 1; MAP.tx = 0; MAP.ty = 0; fixPan(); };
    $('mz-in').addEventListener('click', function () { zoomAt(1.6, MAP.w / 2, MAP.h / 2); });
    $('mz-out').addEventListener('click', function () { zoomAt(1 / 1.6, MAP.w / 2, MAP.h / 2); });
    $('mz-reset').addEventListener('click', function () { window.resetMapView(); drawMap(); });
    mcv.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); var r = mcv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    mcv.addEventListener('dblclick', function (e) { var r = mcv.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
    mcv.addEventListener('pointerdown', function (e) {
      ptr[e.pointerId] = [e.clientX, e.clientY]; drag = null;
      if (Object.keys(ptr).length === 1 && MAP.z > 1) { drag = [e.clientX, e.clientY]; mcv.setPointerCapture(e.pointerId); mcv.style.cursor = 'grabbing'; }
      pinch = 0;
    });
    mcv.addEventListener('pointermove', function (e) {
      if (!ptr[e.pointerId]) return;
      ptr[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(ptr);
      if (ids.length === 2) {
        var a = ptr[ids[0]], b = ptr[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = mcv.getBoundingClientRect();
        if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
        pinch = d;
      } else if (drag) {
        MAP.tx += e.clientX - drag[0]; MAP.ty += e.clientY - drag[1]; drag = [e.clientX, e.clientY]; fixPan(); drawMap(); tp.hidden = true;
      }
    });
    function up(e) { delete ptr[e.pointerId]; pinch = 0; drag = null; if (MAP.z > 1) mcv.style.cursor = 'grab'; }
    mcv.addEventListener('pointerup', up); mcv.addEventListener('pointercancel', up);
  }
  /* playback: one year at a time */
  function updateMapCtl() {
    var sl = $('map-year');
    sl.min = S.from; sl.max = S.to; sl.value = S.mapYear === null ? S.to : S.mapYear;
    sl.disabled = S.from === S.to;
    $('map-yearv').textContent = S.mapYear === null ? (S.from === S.to ? S.from : S.from + '–' + S.to) : S.mapYear;
    $('map-play-t').textContent = play.timer ? t('m.pause') : t('m.play');
    $('map-play').className = 'btn btn-ic' + (play.timer ? ' on' : '');
    $('map-all').disabled = S.mapYear === null;
  }
  function stopPlay() { if (play.timer) { clearInterval(play.timer); play.timer = 0; } }
  function togglePlay() {
    if (play.timer) { stopPlay(); updateMapCtl(); return; }
    S.mapYear = S.from;
    play.timer = setInterval(function () {
      S.mapYear++;
      if (S.mapYear > S.to) { stopPlay(); S.mapYear = null; }
      updateMapCtl(); drawMap();
    }, 900);
    updateMapCtl(); drawMap();
  }

  /* ----- governorates ----- */
  function renderGov() {
    var tot = {}, i, r, fam, yr, sum = 0;
    for (i = 0; i < VAR.cellrows.length; i++) {
      r = VAR.cellrows[i]; fam = r[1] % 2; yr = OM.meta.y0 + (r[1] >> 1);
      if (yr < S.from || yr > S.to) continue;
      if (S.sensor === 'modis' && fam !== 0) continue;
      if (S.sensor === 'viirs' && fam !== 1) continue;
      var g = OM.cellgov[r[0]]; tot[g] = (tot[g] || 0) + r[2]; sum += r[2];
    }
    var list = Object.keys(tot).map(function (k) { return +k; }).filter(function (k) { return k >= 0; }).sort(function (a, b) { return tot[b] - tot[a]; });
    if (tot[-1]) list.push(-1);
    var max = Math.max.apply(null, list.map(function (k) { return tot[k]; }).concat([1])), h = '';
    list.forEach(function (k) {
      var nm = k < 0 ? t('g.out') : (lang === 'ar' && OM.govs[k].a ? OM.govs[k].a : OM.govs[k].n);
      h += '<li tabindex="0" data-g="' + k + '"><span class="gn">' + esc(nm) + '</span><span class="gb"><i style="width:' + (tot[k] / max * 100).toFixed(1) + '%"></i></span><span class="gc">' + nf.format(tot[k]) + '<small>' + Math.round(100 * tot[k] / (sum || 1)) + '%</small></span></li>';
    });
    $('gov').innerHTML = h;
  }

  /* ----- timeline ----- */
  var TL = { W: 1000, padL: 6, padR: 6 };
  function renderTimeline() {
    var yearly = S.tl === 'year', n = yearly ? (Y_MAX - Y_MIN + 1) : (Y_MAX - Y_MIN + 1) * 12, pow = S.metric === 'power';
    var fam = [new Array(n).fill(0), new Array(n).fill(0)];
    days.forEach(function (d) {
      var i = yearly ? d.y - Y_MIN : (d.y - Y_MIN) * 12 + d.m;
      fam[0][i] += pow ? d.fm : d.mod; fam[1][i] += pow ? d.fv : d.vii;
    });
    var rows = []; if (S.sensor !== 'viirs') rows.push(0); if (S.sensor !== 'modis') rows.push(1);
    var W = TL.W, padL = TL.padL, padR = TL.padR, rowH = 120, gap = 44, top = 30, axisH = 24;
    var H = top + rows.length * rowH + (rows.length - 1) * gap + axisH;
    var bw = (W - padL - padR) / n, out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('t.label')) + '">';
    rows.forEach(function (f, ri) {
      var y0 = top + ri * (rowH + gap), vals = fam[f], max = Math.max.apply(null, vals.concat([1]));
      var label = t(pow ? (f === 0 ? 't.modisPow' : 't.viirsPow') : (f === 0 ? 't.modisRow' : 't.viirsRow'), { max: nf.format(Math.round(max)) });
      out += '<text class="strong" x="' + padL + '" y="' + (y0 - 10) + '">' + esc(label) + '</text>';
      for (var i = 0; i < n; i++) {
        var yr = Y_MIN + (yearly ? i : Math.floor(i / 12)), h = vals[i] / max * rowH, x = padL + i * bw, nn = nf.format(Math.round(vals[i]));
        var sel = yr >= S.from && yr <= S.to, cur = yr === S.calYear;
        var ttl = yearly ? t(pow ? 't.barPow' : 't.barYear', { y: yr, n: nn }) : t(pow ? 't.barPowM' : 't.barMonth', { m: monthName(i % 12), y: yr, n: nn });
        out += '<rect data-year="' + yr + '" class="' + (f === 0 ? 'bar-m' : 'bar-v') + (sel ? '' : ' off') + (cur && yearly ? ' sel' : '') + '" x="' + x.toFixed(2) + '" y="' + (y0 + rowH - h).toFixed(2) + '" width="' + Math.max(bw - (yearly ? 5 : 0.8), 0.8).toFixed(2) + '" height="' + Math.max(h, vals[i] ? 1 : 0).toFixed(2) + '"><title>' + esc(ttl) + '</title></rect>';
      }
      out += '<line class="axis" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (y0 + rowH) + '" y2="' + (y0 + rowH) + '"/>';
      SAT_NAMES.forEach(function (nm, si) {
        if (SAT_FAM[si] !== f || SAT_START[si] === Y_MIN) return;
        var x = padL + (SAT_START[si] - Y_MIN) * (yearly ? 1 : 12) * bw;
        var late = x > W - 90;
        out += '<line class="mk" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (y0 - 2) + '" y2="' + (y0 + rowH) + '"/><text x="' + (late ? x - 4 : x + 4).toFixed(1) + '" y="' + (y0 + 12) + '" text-anchor="' + (late ? 'end' : 'start') + '">' + esc(nm) + '</text>';
      });
    });
    // notable days: a small marker above the first row
    NOTABLE.forEach(function (ev, k) {
      var yy = +ev.date.slice(0, 4), mm = +ev.date.slice(5, 7) - 1, dd = +ev.date.slice(8, 10);
      var pos = yearly ? (yy - Y_MIN) + (mm + dd / 31) / 12 : (yy - Y_MIN) * 12 + mm + dd / 31;
      var x = padL + pos * bw;
      out += '<path class="ntm" data-nt="' + k + '" d="M' + (x - 6).toFixed(1) + ' ' + (top - 22) + ' L' + (x + 6).toFixed(1) + ' ' + (top - 22) + ' L' + x.toFixed(1) + ' ' + (top - 8) + ' Z"><title>' + esc(t('t.mark', { d: fmtDate(ev.date) })) + '</title></path>';
    });
    var ay = H - 6;
    for (var yy2 = Y_MIN; yy2 <= Y_MAX; yy2 += (yearly ? 2 : 4)) {
      var xx = padL + (yy2 - Y_MIN) * (yearly ? 1 : 12) * bw + (yearly ? bw / 2 - 2 : 0);
      out += '<text x="' + xx.toFixed(1) + '" y="' + ay + '" text-anchor="' + (yearly ? 'middle' : 'start') + '">' + yy2 + '</text>';
    }
    $('chart-tl').innerHTML = out + '</svg><div class="band" id="tl-band" hidden></div>';
    $('tl-reset').hidden = S.from === Y_MIN && S.to === Y_MAX;
  }
  function tlYearAt(clientX) {
    var svg = $('chart-tl').querySelector('svg'), r = svg.getBoundingClientRect(), n = Y_MAX - Y_MIN + 1;
    var x = (clientX - r.left) / r.width * TL.W, f = (x - TL.padL) / (TL.W - TL.padL - TL.padR) * n;
    return clamp(Math.floor(f), 0, n - 1) + Y_MIN;
  }
  function showBand(a, b) {
    var box = $('chart-tl'), svg = box.querySelector('svg'), sr = svg.getBoundingClientRect(), br = box.getBoundingClientRect();
    var n = Y_MAX - Y_MIN + 1, u = (TL.W - TL.padL - TL.padR) / n, k = sr.width / TL.W, el = $('tl-band');
    el.hidden = false;
    el.style.left = ((sr.left - br.left) + (TL.padL + (a - Y_MIN) * u) * k) + 'px';
    el.style.width = ((b - a + 1) * u * k) + 'px';
    el.style.top = (sr.top - br.top) + 'px'; el.style.height = sr.height + 'px';
  }
  function timelineDrag() {
    var box = $('chart-tl'), st = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      st = { x: e.clientX, y0: tlYearAt(e.clientX), moved: false, id: e.pointerId };
    });
    box.addEventListener('pointermove', function (e) {
      if (!st) return;
      if (!st.moved && Math.abs(e.clientX - st.x) > 7) { st.moved = true; try { box.setPointerCapture(st.id); } catch (er) { /* ignore */ } }
      if (st.moved) { var a = st.y0, b = tlYearAt(e.clientX); showBand(Math.min(a, b), Math.max(a, b)); }
    });
    function end(e) {
      if (!st) return;
      var s = st; st = null;
      if (!s.moved) return;
      var a = s.y0, b = tlYearAt(e.clientX);
      S.from = Math.min(a, b); S.to = Math.max(a, b); S.page = 0; S.mapYear = null;
      $('y-from').value = S.from; $('y-to').value = S.to;
      S.noClick = true; setTimeout(function () { S.noClick = false; }, 0);
      renderCountry(false);
    }
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', function () { st = null; var b = $('tl-band'); if (b) b.hidden = true; });
  }

  /* ----- night and day ----- */
  function renderDN() {
    var tot = 0, night = 0;
    days.forEach(function (d) { if (inRange(d)) { tot += sv(d); night += nv_(d); } });
    var pct = tot ? Math.round(100 * night / tot) : 0;
    $('dn').innerHTML =
      '<h3 class="sub">' + esc(t('dn.title')) + '</h3>' +
      '<div class="dn-bar" role="img" aria-label="' + esc(t('dn.text', { p: pct })) + '"><i class="n" style="flex:' + night + '"></i><i class="d" style="flex:' + (tot - night) + '"></i></div>' +
      '<div class="dn-k"><span>' + esc(t('dn.night')) + ' ' + nf.format(night) + '</span><span>' + esc(t('dn.day')) + ' ' + nf.format(tot - night) + '</span></div>' +
      '<p class="cap">' + esc(t('dn.text', { p: pct })) + '</p>';
  }

  /* ----- notable days with before/after images ----- */
  function compareHtml(ev) {
    var b = IMG_DIR + ev.date + '-before.jpg', a = IMG_DIR + ev.date + '-after.jpg';
    return '<div class="cmp" style="--p:50%">' +
      '<img class="cmp-a" src="' + esc(a) + '" alt="' + esc(t('n.after')) + '" width="979" height="997">' +
      '<img class="cmp-b" src="' + esc(b) + '" alt="' + esc(t('n.before')) + '" width="979" height="997">' +
      '<span class="cmp-l b">' + esc(t('n.before')) + '</span><span class="cmp-l a">' + esc(t('n.after')) + '</span>' +
      '<span class="cmp-h" aria-hidden="true"></span>' +
      '<input type="range" class="cmp-r" min="0" max="100" value="50" aria-label="' + esc(t('n.slider')) + '"></div>';
  }
  function posText(lat, lon) {
    var ar = lang === 'ar';
    return Math.abs(lat) + '°' + (lat >= 0 ? (ar ? 'شمالاً' : 'N') : (ar ? 'جنوباً' : 'S')) + ' ' + Math.abs(lon) + '°' + (lon >= 0 ? (ar ? 'شرقاً' : 'E') : (ar ? 'غرباً' : 'W'));
  }
  function renderNotable() {
    var h = '';
    NOTABLE.forEach(function (ev, i) {
      var d = null, k;
      for (k = 0; k < OM.v.std.days.length; k++) { if (OM.v.std.days[k][0] === ev.date) { d = OM.v.std.days[k]; break; } }
      var n = d ? d[1] + d[2] + d[3] + d[4] + d[5] : 0, mw = d ? Math.round(d[6] + d[7]) : 0, sats = '';
      if (d) { for (k = 0; k < 5; k++) { if (d[1 + k] > 0) sats += '<span class="sat ' + (SAT_FAM[k] ? 'v' : 'm') + '">' + SAT_NAMES[k] + ' ' + d[1 + k] + '</span>'; } }
      var fb = IMG_DIR + ev.date + '-before.jpg', fa = IMG_DIR + ev.date + '-after.jpg';
      h += '<article class="nt" id="nt-' + i + '"><header><h3>' + esc(fmtDate(ev.date)) + '</h3>' +
        '<p class="meta">' + esc(t('n.meta', { n: nf.format(n), mw: nf.format(mw), pos: posText(ev.lat, ev.lon) })) + '</p></header>' +
        '<div class="sats"><span class="lab">' + esc(t('n.sats')) + '</span>' + sats + '</div>' +
        '<div class="nt-media" id="ntm-' + i + '" hidden></div>' +
        '<p class="cap" id="ntc-' + i + '" hidden>' + esc(t('n.cap', { b: fmtDate(ev.before), a: fmtDate(ev.date) })) + '</p></article>';
    });
    $('notable').innerHTML = h;
    NOTABLE.forEach(function (ev, i) {
      probe(IMG_DIR + ev.date + '-before.jpg', function (ok1) {
        if (!ok1) return;
        probe(IMG_DIR + ev.date + '-after.jpg', function (ok2) {
          var el = $('ntm-' + i);
          if (ok2 && el) { el.innerHTML = compareHtml(ev); el.hidden = false; $('ntc-' + i).hidden = false; }
        });
      });
    });
  }

  /* ----- year by month matrix ----- */
  function renderMatrix() {
    var ny = Y_MAX - Y_MIN + 1, grid = [], max = 0, y, m;
    for (y = 0; y < ny; y++) grid.push(new Array(12).fill(0));
    days.forEach(function (d) { grid[d.y - Y_MIN][d.m] += sv(d); });
    grid.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    var cw = 34, ch = 17, left = 40, top = 22, W = left + 12 * cw + 2, H = top + ny * ch + 2;
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('x.label')) + '">';
    for (m = 0; m < 12; m++) out += '<text x="' + (left + m * cw + cw / 2 - 1) + '" y="14" text-anchor="middle">' + esc(monthName(m)) + '</text>';
    for (y = 0; y < ny; y++) {
      var yr = Y_MIN + y;
      out += '<text x="' + (left - 6) + '" y="' + (top + y * ch + 12) + '" text-anchor="end">' + yr + '</text>';
      for (m = 0; m < 12; m++) {
        var v = grid[y][m], lvl = v === 0 ? 0 : clamp(Math.ceil(5 * Math.sqrt(v / max)), 1, 5), sel = yr >= S.from && yr <= S.to;
        out += '<rect class="mx' + (sel ? '' : ' off') + '" data-year="' + yr + '" x="' + (left + m * cw) + '" y="' + (top + y * ch) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" fill="' + COL.r[lvl] + '"><title>' + esc(t('x.cell', { m: monthName(m), y: yr, n: nf.format(v) })) + '</title></rect>';
      }
    }
    $('chart-mx').innerHTML = out + '</svg>';
  }

  /* ----- calendar ----- */
  function renderCalendar() {
    var y = S.calYear, cell = 15, left = 30, top = 20;
    var first = new Date(Date.UTC(y, 0, 1)), offset = first.getUTCDay();
    var total = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 864e5, vals = [], max = 0, i;
    for (i = 0; i < total; i++) {
      var ds = new Date(Date.UTC(y, 0, 1 + i)).toISOString().slice(0, 10), o = dayMap[ds], v = o ? sv(o) : 0;
      vals.push([ds, v]); if (v > max) max = v;
    }
    var weeks = Math.ceil((total + offset) / 7), W = left + weeks * cell + 4, H = top + 7 * cell + 4;
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('k.label', { y: y })) + '">';
    [1, 3, 5].forEach(function (d) { out += '<text x="0" y="' + (top + d * cell + 11) + '">' + esc(new Intl.DateTimeFormat(loc(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + d)))) + '</text>'; });
    var lastM = -1;
    for (i = 0; i < total; i++) {
      var dt = new Date(Date.UTC(y, 0, 1 + i)), idx = i + offset, col = Math.floor(idx / 7), row = idx % 7;
      var lvl = vals[i][1] === 0 ? 0 : clamp(Math.ceil(5 * Math.sqrt(vals[i][1] / max)), 1, 5);
      if (dt.getUTCMonth() !== lastM && dt.getUTCDate() <= 7 && row <= 6) { lastM = dt.getUTCMonth(); out += '<text x="' + (left + col * cell) + '" y="12">' + esc(monthName(lastM)) + '</text>'; }
      out += '<rect class="day" x="' + (left + col * cell) + '" y="' + (top + row * cell) + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" fill="' + COL.r[lvl] + '"><title>' + esc(t('k.day', { d: fmtDate(vals[i][0]), n: nf.format(vals[i][1]) })) + '</title></rect>';
    }
    $('chart-cal').innerHTML = out + '</svg>';
  }

  /* ----- day log and CSV ----- */
  function logRows() {
    var rows = days.filter(function (d) { return inRange(d) && sv(d) > 0; });
    if (S.sort === 'old') rows.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    else if (S.sort === 'most') rows.sort(function (a, b) { return sv(b) - sv(a) || (a.d < b.d ? 1 : -1); });
    else rows.sort(function (a, b) { return a.d < b.d ? 1 : -1; });
    return rows;
  }
  function renderLog() {
    var rows = logRows(), pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    S.page = clamp(S.page, 0, pages - 1);
    if (!rows.length) { $('log').innerHTML = '<p class="none">' + esc(t('l.empty')) + '</p>'; $('pager').innerHTML = ''; return; }
    var h = '<div class="row head"><span>' + esc(t('l.date')) + '</span><span class="n">' + esc(t('l.count')) + '</span><span>' + esc(t('l.sats')) + '</span><span class="frp">' + esc(t('l.frp')) + '</span></div>';
    rows.slice(S.page * ROWS_PER_PAGE, (S.page + 1) * ROWS_PER_PAGE).forEach(function (d) {
      var sats = '';
      for (var i = 0; i < 5; i++) { if (satOn(i) && d.s[i] > 0) sats += '<span class="sat ' + (SAT_FAM[i] ? 'v' : 'm') + '">' + SAT_NAMES[i] + ' ' + d.s[i] + '</span>'; }
      h += '<div class="row"><span class="d">' + esc(fmtDate(d.d)) + '</span><span class="n">' + nf.format(sv(d)) + '</span><span class="sats">' + sats + '</span><span class="frp">' + nf.format(Math.round(fv_(d))) + '</span></div>';
    });
    $('log').innerHTML = h;
    $('pager').innerHTML = '<button type="button" class="btn" id="pg-prev"' + (S.page === 0 ? ' disabled' : '') + '>' + esc(t('l.prev')) + '</button>' +
      '<button type="button" class="btn" id="pg-next"' + (S.page >= pages - 1 ? ' disabled' : '') + '>' + esc(t('l.next')) + '</button>' +
      '<span class="info">' + esc(t('l.page', { p: S.page + 1, n: pages })) + ' · ' + esc(t('l.rows', { n: nf.format(rows.length) })) + '</span>';
  }
  function downloadCsv() {
    var rows = days.filter(function (d) { return inRange(d) && sv(d) > 0; });
    var out = ['date,detections,Terra,Aqua,S-NPP,NOAA-20,NOAA-21,fire_power_MW,night_detections'];
    rows.forEach(function (d) { out.push([d.d, sv(d), d.s[0], d.s[1], d.s[2], d.s[3], d.s[4], Math.round(fv_(d) * 10) / 10, nv_(d)].join(',')); });
    var blob = new Blob(['﻿' + out.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fira-' + CUR.id + '-' + S.sensor + '-' + S.from + '-' + S.to + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ----- risk ----- */
  function computeSeason() {
    var sums = new Array(12).fill(0);
    days.forEach(function (d) { if (inRange(d)) sums[d.m] += sv(d); });
    var mx = Math.max.apply(null, sums.concat([1]));
    season = sums.map(function (v) { return v / mx; });
  }
  function risk(m, T, RH) {
    var tt = clamp((T - T_LO) / (T_HI - T_LO), 0, 1), dd = Math.pow(clamp((90 - RH) / 80, 0, 1), 1.2), ss = season[m] || 0;
    return { score: 100 * (0.30 * tt + 0.35 * dd + 0.35 * ss), t: tt, d: dd, s: ss };
  }
  function level(s) { return s < 25 ? 0 : s < 45 ? 1 : s < 65 ? 2 : 3; }
  function renderRiskControls() {
    var h = '';
    for (var m = 0; m < 12; m++) h += '<button type="button" data-rm="' + m + '" aria-pressed="' + (m === S.rMonth ? 'true' : 'false') + '">' + esc(monthName(m)) + '</button>';
    $('r-months').innerHTML = h;
    $('r-months').setAttribute('aria-label', t('r.month'));
    $('r-t').value = S.rT; $('r-h').value = S.rH;
  }
  function renderRisk() {
    computeSeason();
    var r = risk(S.rMonth, S.rT, S.rH), lv = level(r.score), lvc = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)'];
    $('r-tv').textContent = S.rT + '°C'; $('r-hv').textContent = S.rH + '%';
    var btns = $('r-months').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', i === S.rMonth ? 'true' : 'false');
    $('r-result').innerHTML =
      '<div class="score"><b>' + Math.round(r.score) + '</b><small>' + esc(t('r.outOf')) + '</small></div>' +
      '<span class="level" style="--lv:' + lvc[lv] + '"><i></i>' + esc(t('r.l' + lv)) + '</span>' +
      '<div class="meter" aria-hidden="true"><span style="flex:25;background:' + lvc[0] + '"></span><span style="flex:20;background:' + lvc[1] + '"></span><span style="flex:20;background:' + lvc[2] + '"></span><span style="flex:35;background:' + lvc[3] + '"></span><b style="left:' + clamp(r.score, 0, 100).toFixed(1) + '%"></b></div>' +
      '<p class="advice">' + esc(t('r.a' + lv)) + '</p>' +
      '<div class="fac">' +
      '<div><span>' + esc(t('r.fT')) + '</span><span class="bar-bg"><i style="width:' + Math.round(r.t * 100) + '%"></i></span><em>' + Math.round(r.t * 100) + '%</em></div>' +
      '<div><span>' + esc(t('r.fD')) + '</span><span class="bar-bg"><i style="width:' + Math.round(r.d * 100) + '%"></i></span><em>' + Math.round(r.d * 100) + '%</em></div>' +
      '<div><span>' + esc(t('r.fS')) + '</span><span class="bar-bg"><i style="width:' + Math.round(r.s * 100) + '%"></i></span><em>' + Math.round(r.s * 100) + '%</em></div></div>';
    var W = 640, H = 190, base = 150, top = 22, step = (W - 20) / 12, bw = step * 0.62, lvf = [COL.r[1], COL.r[2], COL.r[3], COL.r[4]];
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('r.chart')) + '">';
    [25, 45, 65].forEach(function (g) { var y = base - g / 100 * (base - top); out += '<line class="gl" x1="10" x2="' + (W - 10) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>'; });
    for (var m = 0; m < 12; m++) {
      var sc = risk(m, CLIM_T[m], CLIM_RH[m]).score, x = 10 + m * step + (step - bw) / 2, h = sc / 100 * (base - top);
      out += '<rect x="' + x.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + lvf[level(sc)] + '"' + (m === S.rMonth ? ' stroke="' + COL.ink + '" stroke-width="2"' : '') + '/>';
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (base - h - 5).toFixed(1) + '" text-anchor="middle">' + Math.round(sc) + '</text>';
      out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (base + 16) + '" text-anchor="middle"' + (m === S.rMonth ? ' class="strong"' : '') + '>' + esc(monthName(m)) + '</text>';
    }
    out += '<line class="axis" x1="10" x2="' + (W - 10) + '" y1="' + base + '" y2="' + base + '"/>';
    var yy = base - clamp(r.score, 0, 100) / 100 * (base - top);
    out += '<line class="cur" x1="10" x2="' + (W - 10) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/><text class="cur-t" x="12" y="' + (yy - 6).toFixed(1) + '">' + esc(t('r.yours')) + ' ' + Math.round(r.score) + '</text>';
    $('chart-risk').innerHTML = out + '</svg>';
  }

  /* ----- about ----- */
  function renderAbout() {
    var mt = OM.meta, std = mt.kept.std, strict = mt.kept.strict;
    $('about').innerHTML =
      '<p>' + esc(t('a.p1', { last: fmtDate(mt.last) })) + '</p>' +
      '<p>' + esc(t('a.p2', { thr: mt.thr_months, drop: nf.format(mt.raw_total - std), raw: nf.format(mt.raw_total), kept: nf.format(std) })) + '</p>' +
      '<p>' + esc(t('a.p5', { smin: mt.strict_months, n: nf.format(strict), pct: Math.round(100 * strict / std) })) + '</p>' +
      '<p>' + esc(t('a.p3')) + '</p><p>' + esc(t(CUR.noteKey)) + '</p>' +
      (mt.cut ? '<p>' + esc(t('cc.usa.cut', { cut: fmtDate(mt.cut) })) + '</p>' : '') +
      '<p>' + esc(t('a.p6', { g: 1.0 })) + '</p>' +
      (CUR.id === 'usa' ? '<p>' + esc(t('a.p7', { err: 12 })) + '</p>' : '');
  }

  /* ----- render the whole country page ----- */
  function renderCountry(rebuild) {
    if (!OM || $('view-country').hidden) return;
    stopPlay();
    if (S.mapYear !== null && (S.mapYear < S.from || S.mapYear > S.to)) S.mapYear = null;
    if (!built || rebuild) {
      fillSelect('y-from', Y_MIN, Y_MAX, S.from); fillSelect('y-to', Y_MIN, Y_MAX, S.to); fillSelect('cal-year', Y_MIN, Y_MAX, S.calYear);
      setRadio('sensor', S.sensor); setRadio('src', S.src); setRadio('metric', S.metric); setRadio('tl', S.tl);
      renderRiskControls(); renderHeaderImage(); renderNotable(); built = true; if ($('f-sort')) $('f-sort').value = S.fsort;
    }
    if (!built && window.resetMapView) window.resetMapView();
    var place = countryName(cOf(CUR.id));
    $('c-name').textContent = place;
    $('c-lead').textContent = t('c.lead', { place: place, first: fmtDate(OM.meta.first), last: fmtDate(OM.meta.last) });
    $('map').setAttribute('aria-label', t('m.label', { place: place }));
    $('g-head').textContent = t(CUR.regKey);
    renderFires(); renderCheck();
    updateMapCtl(); renderStats(); drawMap(); renderGov(); renderTimeline(); renderDN(); renderMatrix(); renderCalendar(); renderLog(); renderRisk(); renderAbout();
  }

  function pickYear(y) {
    S.calYear = y; $('cal-year').value = y; renderCalendar(); renderTimeline();
    scrollTo_($('sec-calendar'));
  }
  function countryEvents() {
    $('seg-sensor').addEventListener('change', function (e) { S.sensor = e.target.value; S.page = 0; renderCountry(false); });
    $('seg-src').addEventListener('change', function (e) { S.src = e.target.value; buildDays(); S.page = 0; renderCountry(false); });
    $('seg-tl').addEventListener('change', function (e) { S.tl = e.target.value; renderTimeline(); });
    $('seg-metric').addEventListener('change', function (e) { S.metric = e.target.value; renderTimeline(); });
    $('y-from').addEventListener('change', function (e) { S.from = +e.target.value; if (S.to < S.from) { S.to = S.from; $('y-to').value = S.to; } S.page = 0; renderCountry(false); });
    $('y-to').addEventListener('change', function (e) { S.to = +e.target.value; if (S.from > S.to) { S.from = S.to; $('y-from').value = S.from; } S.page = 0; renderCountry(false); });
    $('tl-reset').addEventListener('click', function () { S.from = Y_MIN; S.to = Y_MAX; $('y-from').value = S.from; $('y-to').value = S.to; S.page = 0; renderCountry(false); });
    $('show-excl').addEventListener('change', function (e) { S.excl = e.target.checked; drawMap(); });
    $('cal-year').addEventListener('change', function (e) { S.calYear = +e.target.value; renderCalendar(); renderTimeline(); });
    $('log-sort').addEventListener('change', function (e) { S.sort = e.target.value; S.page = 0; renderLog(); });
    $('csv').addEventListener('click', downloadCsv);
    $('f-sort').addEventListener('change', function (e) { S.fsort = e.target.value; S.fhi = -1; renderFires(); });
    $('fires').addEventListener('click', function (e) {
      var tr = e.target.closest && e.target.closest('tr[data-f]'); if (!tr) return;
      S.fhi = +tr.getAttribute('data-f'); S.mapYear = null; renderFires(); updateMapCtl(); drawMap(); scrollTo_($('sec-map'));
    });
    // map playback
    $('map-play').addEventListener('click', togglePlay);
    $('map-year').addEventListener('input', function (e) { stopPlay(); S.mapYear = +e.target.value; updateMapCtl(); drawMap(); });
    $('map-all').addEventListener('click', function () { stopPlay(); S.mapYear = null; updateMapCtl(); drawMap(); });
    // governorates highlight the map
    var gov = $('gov');
    function hi(e) { var li = e.target.closest && e.target.closest('li[data-g]'); var g = li ? +li.getAttribute('data-g') : -2; if (g !== S.hiGov) { S.hiGov = g; drawMap(); } }
    gov.addEventListener('mouseover', hi); gov.addEventListener('focusin', hi);
    gov.addEventListener('mouseleave', function () { if (S.hiGov !== -2) { S.hiGov = -2; drawMap(); } });
    gov.addEventListener('focusout', function () { if (S.hiGov !== -2) { S.hiGov = -2; drawMap(); } });
    // timeline: click a bar to open that year, click a marker to jump to the day, drag to select years
    timelineDrag();
    $('chart-tl').addEventListener('click', function (e) {
      if (S.noClick) return;
      var m = e.target.closest && e.target.closest('path[data-nt]');
      if (m) { scrollTo_($('nt-' + m.getAttribute('data-nt'))); return; }
      var r = e.target.closest && e.target.closest('rect[data-year]'); if (!r) return;
      pickYear(+r.getAttribute('data-year'));
    });
    $('chart-mx').addEventListener('click', function (e) {
      var r = e.target.closest && e.target.closest('rect[data-year]'); if (r) pickYear(+r.getAttribute('data-year'));
    });
    $('notable').addEventListener('input', function (e) {
      if (e.target.classList.contains('cmp-r')) e.target.parentNode.style.setProperty('--p', e.target.value + '%');
    });
    $('pager').addEventListener('click', function (e) {
      if (e.target.id === 'pg-prev') S.page--; else if (e.target.id === 'pg-next') S.page++; else return;
      renderLog(); scrollTo_($('sec-log'));
    });
    $('r-months').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-rm]'); if (!b) return;
      S.rMonth = +b.getAttribute('data-rm'); S.rT = CLIM_T[S.rMonth]; S.rH = CLIM_RH[S.rMonth]; $('r-t').value = S.rT; $('r-h').value = S.rH; renderRisk();
    });
    $('r-t').addEventListener('input', function (e) { S.rT = +e.target.value; renderRisk(); });
    $('r-h').addEventListener('input', function (e) { S.rH = +e.target.value; renderRisk(); });
    $('r-reset').addEventListener('click', function () { S.rT = CLIM_T[S.rMonth]; S.rH = CLIM_RH[S.rMonth]; $('r-t').value = S.rT; $('r-h').value = S.rH; renderRisk(); });
    mapEvents();
  }

  /* ---------- router ---------- */
  function route() {
    var h = location.hash.replace('#', ''), country = (h === 'oman' || h === 'usa') && CFGS[h] && CFGS[h].data ? h : '';
    $('view-home').hidden = !!country; $('view-country').hidden = !country;
    document.documentElement.setAttribute('data-view', country ? 'country' : 'home');
    readColors();
    stopPlay();
    if (country) { if (!CUR || CUR.id !== country) setCountry(country); renderCountry(true); window.scrollTo(0, 0); }
    else { resizeGlobe(); readColors(); renderHome(); startGlobe(); drawGlobe(); window.scrollTo(0, 0); }
  }

  /* ---------- boot ---------- */
  var savedTheme = store.get('fira-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
  applyStatic(); readColors(); buildCountryList(); globeEvents(); countryEvents(); initGL();
  $('btn-lang').addEventListener('click', function () { setLang(lang === 'en' ? 'ar' : 'en'); });
  $('btn-theme').addEventListener('click', function () { setTheme(isDark() ? 'light' : 'dark'); });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', function () { resizeGlobe(); drawGlobe(); if (!$('view-country').hidden) { drawMap(); } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('view-home').hidden) startGlobe(); });
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); var onMq = function () { readColors(); drawGlobe(); renderCountry(false); renderHome(); }; if (mq.addEventListener) mq.addEventListener('change', onMq); }
  route();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { resizeGlobe(); if (!$('view-country').hidden) drawMap(); });
})();
