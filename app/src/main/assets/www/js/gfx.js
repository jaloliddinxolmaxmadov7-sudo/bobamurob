/* UZ AUTO LIFE — base helpers, storage, renderer, night lighting and the post-processing chain
   (bloom + speed blur + vignette), all built on plain three.js r128 with no extra libraries. */
"use strict";
const C = window.UZCore;
const $ = (id) => document.getElementById(id);
const clamp = C.clamp;
const lerp = (a, b, t) => a + (b - a) * t;

/* ================= Storage ================= */
const SAVE_KEY = "uzautolife.save";
const SET_KEY = "uzautolife.settings";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
function parse(s) { try { return s ? JSON.parse(s) : undefined; } catch (e) { return null; } }
let settings = C.validateSettings(parse(store.get(SET_KEY)));
// First run on a phone: start on the light preset (the player can raise it in Sozlamalar).
if (store.get(SET_KEY) == null && window.matchMedia && matchMedia("(pointer: coarse)").matches) settings.quality = "low";
function saveSettings() { store.set(SET_KEY, JSON.stringify(settings)); }

/* ================= Colour helpers (sRGB workflow) ================= */
const col = (c) => new THREE.Color(c).convertSRGBToLinear();
const std = (o) => {
  o = Object.assign({ roughness: 0.9, metalness: 0 }, o);
  if (o.color != null) o.color = col(o.color);
  if (o.emissive != null) o.emissive = col(o.emissive);
  return new THREE.MeshStandardMaterial(o);
};
const glowMat = (c, o) => new THREE.MeshBasicMaterial(Object.assign({ color: col(c), fog: false }, o));
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
}
const GLOW_TEX = canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.55)"); gr.addColorStop(0.6, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const SMOKE_TEX = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.5, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

/* ================= Renderer & scene ================= */
const QUALITY = {
  low: { dpr: 0.75, shadows: false, map: 512, far: 170, fog: [30, 160], post: false, msaa: 0 },
  mid: { dpr: 1, shadows: true, map: 1024, far: 240, fog: [45, 230], post: true, msaa: 0 },
  high: { dpr: 1.5, shadows: true, map: 2048, far: 380, fog: [75, 370], post: true, msaa: 4 },
};
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("stage").appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 300);
scene.fog = new THREE.Fog(col(0x1b1533), 55, 280);
scene.background = new THREE.Color(0x05060d);

/* Sky dome driven by the time of day: zenith → horizon gradient, sun disc and glow, stars and moon at night. */
const SKY_U = {
  uZen: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uStars: { value: 1 }, uDay: { value: 0 },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: SKY_U,
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position * 250.0, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }",
    fragmentShader: [
      "varying vec3 vDir; uniform vec3 uZen, uMid, uHor, uGlow, uSunDir, uSunCol; uniform float uStars, uDay;",
      "float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }",
      "void main(){",
      "  vec3 d = normalize(vDir); float y = max(d.y, 0.0); vec3 sd = normalize(uSunDir);",
      "  float toward = pow(max(0.0, dot(normalize(d.xz + 1e-4), normalize(sd.xz + 1e-4))), 2.0);",
      "  vec3 hor = mix(uHor, uGlow, toward * 0.85);",
      "  vec3 c = mix(hor, uMid, smoothstep(0.0, 0.22, y)); c = mix(c, uZen, smoothstep(0.15, 0.75, y));",
      "  c += uGlow * toward * pow(1.0 - y, 18.0) * 0.35;",
      "  vec3 q = floor(d * 190.0); float s = hash(q);",
      "  c += vec3(0.9, 0.95, 1.0) * step(0.9972, s) * smoothstep(0.12, 0.5, y) * (0.5 + 0.5 * hash(q + 3.0)) * uStars;",
      "  float m = dot(d, sd);",
      "  c += uSunCol * (smoothstep(0.9990, 0.9994, m) + pow(max(m, 0.0), 300.0) * 0.6 + pow(max(m, 0.0), 8.0) * 0.12 * uDay) * step(-0.02, sd.y);",
      "  float mm = dot(d, normalize(vec3(0.45, 0.62, 0.35)));",
      "  c += (vec3(1.0, 0.97, 0.88) * smoothstep(0.9989, 0.9993, mm) + vec3(0.35, 0.4, 0.6) * pow(max(mm, 0.0), 220.0) * 0.5) * uStars;",
      "  gl_FragColor = vec4(c, 1.0);",
      "}",
    ].join("\n"),
  })
);
skyDome.frustumCulled = false; skyDome.renderOrder = -10; scene.add(skyDome);

const hemi = new THREE.HemisphereLight(col(0x7f93d8), col(0x2a2238), 0.62);
scene.add(hemi);
const sun = new THREE.DirectionalLight(col(0xa9c0ff), 0.6);   // moonlight
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 170; sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
/* Studio lights: switched on while a car is on show (dealer, tuning, garage) so models read clearly. */
const studio = new THREE.Group();
const studioKey = new THREE.SpotLight(0xffffff, 0, 22, 0.75, 0.5, 1.2); studioKey.position.set(3, 9, 5);
const studioRim = new THREE.SpotLight(0x9fd8ff, 0, 22, 0.8, 0.6, 1.2); studioRim.position.set(-5, 6, -6);
studio.add(studioKey, studioKey.target, studioRim, studioRim.target); scene.add(studio);
function studioLight(on, x, z) {
  studio.position.set(x || 0, 0, z || 0);
  studioKey.intensity = on ? 2.6 : 0; studioRim.intensity = on ? 1.6 : 0;
}

/* Reflection environment: dark dusk with neon strips, so paint and wet asphalt pick up streaks. */
function buildEnvironment() {
  const es = new THREE.Scene();
  const tex = canvasTex(8, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#0a1030"); gr.addColorStop(0.45, "#2a1c4a"); gr.addColorStop(0.52, "#70304a"); gr.addColorStop(0.56, "#1a1426"); gr.addColorStop(1, "#07070c");
    g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  });
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })));
  const strips = [[0x19e3ff, 0, 9, -20, 26, 0.7, 1], [0xff2e88, 22, 7, 0, 1, 0.7, 24], [0xfff0d0, -22, 12, 0, 1, 1.2, 20], [0xffb020, 0, 6, 22, 18, 0.6, 1], [0xffffff, 0, 24, 0, 9, 0.5, 9]];
  for (const [c, x, y, z, sx, sy, sz] of strips) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.3) }));
    m.position.set(x, y, z); es.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  ENV.night = pm.fromScene(es, 0.03).texture;
  // daytime reflections: blue sky, warm ground, bright sun strip
  const ds = new THREE.Scene();
  ds.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: canvasTex(8, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "#3d78c9"); gr.addColorStop(0.48, "#a9c9ec"); gr.addColorStop(0.52, "#8f8572"); gr.addColorStop(1, "#4a443a");
    g.fillStyle = gr; g.fillRect(0, 0, 8, 256); }) })));
  const sunStrip = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.4) })); sunStrip.position.set(10, 30, -20); ds.add(sunStrip);
  ENV.day = pm.fromScene(ds, 0.03).texture;
  scene.environment = ENV.night;
  pm.dispose();
}
const ENV = { night: null, day: null };

/* ================= Time of day ================= */
// Palettes: [zenith, mid, horizon, glow] for night, day and the golden hour.
const PAL = {
  night: ["#03050f", "#140f33", "#21143d", "#5c1a3a"],
  day: ["#2f6fd0", "#62a0e6", "#bcd5ee", "#fff2d6"],
  dusk: ["#1f2a5e", "#6b4a7a", "#f08a4b", "#ffb15c"],
};
const SUN_DIR = new THREE.Vector3(0.45, 0.62, 0.35);
const tc = (a) => a.map((c) => col(c));
const PALC = { night: tc(PAL.night), day: tc(PAL.day), dusk: tc(PAL.dusk) };
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
let dayK = 0;
const TOD_NAMES = [[5, "Tun"], [8, "Tong"], [17, "Kun"], [20, "Kechqurun"], [24, "Tun"]];
function todName(h) { for (const [lim, n] of TOD_NAMES) if (h < lim) return n; return "Tun"; }
/* h = hour 0..24. Sets sky, fog, lights, exposure, bloom and the night-only glow decals. */
function setTimeOfDay(h) {
  const ang = ((h - 6) / 12) * Math.PI, sh = Math.sin(ang);                 // sun height: +1 noon, −1 midnight
  const az = ((h - 6) / 12) * Math.PI;
  const sunV = new THREE.Vector3(-Math.cos(az) * Math.cos(Math.asin(Math.max(-1, Math.min(1, sh)))), sh, -0.35).normalize();
  dayK = THREE.MathUtils.smoothstep(sh, -0.08, 0.3);
  const dusk = Math.exp(-Math.pow((sh - 0.04) / 0.16, 2));                  // golden hour around sunrise / sunset
  const keys = ["uZen", "uMid", "uHor", "uGlow"];
  keys.forEach((k, i) => { tmpC.copy(PALC.night[i]).lerp(PALC.day[i], dayK).lerp(PALC.dusk[i], dusk * 0.85); SKY_U[k].value.copy(tmpC); });
  SKY_U.uSunDir.value.copy(sunV); SKY_U.uStars.value = 1 - THREE.MathUtils.smoothstep(sh, -0.2, 0.05); SKY_U.uDay.value = dayK;
  SKY_U.uSunCol.value.copy(col("#fff4dc")).lerp(col("#ff8a3c"), dusk).multiplyScalar(1.4);
  scene.fog.color.copy(col("#1b1533")).lerp(col("#b5cce4"), dayK).lerp(col("#c48a7c"), dusk * 0.7);
  scene.background.copy(scene.fog.color);
  hemi.color.copy(col("#7f93d8")).lerp(col("#d6e6ff"), dayK).lerp(col("#ffb38a"), dusk * 0.6);
  hemi.groundColor.copy(col("#2a2238")).lerp(col("#7d6c56"), dayK);
  hemi.intensity = 0.62 + dayK * 0.38;
  // Directional light: the sun by day, the moon by night.
  if (sh > -0.05) { SUN_DIR.copy(sunV).setY(Math.max(0.12, sunV.y)).normalize(); sun.color.copy(col("#fff1dc")).lerp(col("#ff9a55"), dusk); sun.intensity = 0.6 + 1.9 * dayK; }
  else { SUN_DIR.set(0.45, 0.62, 0.35).normalize(); sun.color.copy(col("#a9c0ff")); sun.intensity = 0.6; }
  renderer.toneMappingExposure = 1.0 - dayK * 0.16;
  fx.bloom = 1 - dayK * 0.72; fx.th = 0.76 + dayK * 0.17;
  if (ENV.day) scene.environment = dayK > 0.5 ? ENV.day : ENV.night;
  if (typeof POOLS !== "undefined" && POOLS) POOLS.material.opacity = 0.34 * (1 - dayK * 0.92);
  if (typeof HALOS !== "undefined" && HALOS) HALOS.material.opacity = 0.55 * (1 - dayK * 0.9);
  if (typeof ModelKit !== "undefined") ModelKit.setNight(1 - THREE.MathUtils.smoothstep(sh, -0.15, 0.12));
}
/* Keep the shadow-casting light over the area being looked at, coming from the sun/moon direction. */
function placeSun(x, z) { sun.position.set(x + SUN_DIR.x * 90, SUN_DIR.y * 90, z + SUN_DIR.z * 90); sun.target.position.set(x, 0, z); }

/* ================= Post-processing ================= */
const post = (function () {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const qs = new THREE.Scene(); qs.add(quad);
  const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const mk = (uniforms, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
  const bright = mk({ t: { value: null }, uTh: { value: 0.76 } },
    "uniform sampler2D t; uniform float uTh; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(uTh, 1.0, l), 1.0); }");
  const blur = mk({ t: { value: null }, d: { value: new THREE.Vector2() } },
    "uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227; c += (texture2D(t, vUv + d * 1.385).rgb + texture2D(t, vUv - d * 1.385).rgb) * 0.316; c += (texture2D(t, vUv + d * 3.231).rgb + texture2D(t, vUv - d * 3.231).rgb) * 0.0703; gl_FragColor = vec4(c, 1.0); }");
  const final = mk({ tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, uBloom: { value: 1 }, uSpeed: { value: 0 }, uNitro: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } }, [
    "uniform sampler2D tScene, tB1, tB2; uniform float uBloom, uSpeed, uNitro, uHit, uTime; varying vec2 vUv;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "void main(){",
    "  vec2 c = vUv - vec2(0.5, 0.44); float r = length(c);",
    "  float amt = (uSpeed + uNitro * 0.5) * smoothstep(0.1, 0.7, r) * 0.1;",
    "  float j = hash(vUv * 731.0 + uTime);",
    "  vec3 col = vec3(0.0);",
    "  for (int i = 0; i < 8; i++) { col += texture2D(tScene, vUv - c * amt * (float(i) + j) / 8.0).rgb; }",
    "  col /= 8.0;",
    "  float ca = (uNitro * 0.012 + uHit * 0.03) * r;",
    "  col.r = mix(col.r, texture2D(tScene, vUv - c * (amt * 0.5 + ca)).r, 0.6 * step(0.0001, ca));",
    "  col.b = mix(col.b, texture2D(tScene, vUv + c * ca).b, 0.6 * step(0.0001, ca));",
    "  col += (texture2D(tB1, vUv).rgb * 0.75 + texture2D(tB2, vUv).rgb * 1.0) * uBloom;",
    "  col = mix(col, col * vec3(0.94, 1.0, 1.1), 0.4);",
    "  col = col * (1.0 + uNitro * 0.12) + vec3(0.02, 0.07, 0.1) * uNitro * smoothstep(0.3, 0.8, r);",
    "  col *= mix(0.5, 1.0, smoothstep(0.98, 0.28, r));",
    "  col += vec3(0.6, 0.05, 0.05) * uHit * smoothstep(0.35, 0.85, r);",
    "  col += (hash(vUv * vec2(1711.0, 977.0) + uTime) - 0.5) * 0.022;",
    "  gl_FragColor = vec4(col, 1.0);",
    "}",
  ].join("\n"));
  let rtScene = null; const rts = [];
  let W = 1, H = 1, msaa = 0;
  function target(w, h) {
    const t = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    t.texture.encoding = THREE.sRGBEncoding; return t;
  }
  function resize(w, h, samples) {
    W = w; H = h; msaa = samples;
    if (rtScene) rtScene.dispose(); rts.forEach((t) => t.dispose()); rts.length = 0;
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false };
    if (samples > 0 && renderer.capabilities.isWebGL2 && THREE.WebGLMultisampleRenderTarget) { rtScene = new THREE.WebGLMultisampleRenderTarget(w, h, opts); rtScene.samples = samples; }
    else rtScene = new THREE.WebGLRenderTarget(w, h, opts);
    rtScene.texture.encoding = THREE.sRGBEncoding;
    rts.push(target(w >> 1, h >> 1), target(w >> 2, h >> 2), target(w >> 2, h >> 2), target(w >> 3, h >> 3), target(w >> 3, h >> 3));
  }
  function pass(mat, src, dst) { quad.material = mat; mat.uniforms.t.value = src.texture; renderer.setRenderTarget(dst); renderer.render(qs, cam); }
  function render(sc, cm, fx) {
    if (!rtScene) return;
    renderer.setRenderTarget(rtScene); renderer.render(sc, cm);
    pass(bright, rtScene, rts[0]);
    blur.uniforms.d.value.set(1 / rts[1].width, 0); pass(blur, rts[0], rts[1]);
    blur.uniforms.d.value.set(0, 1 / rts[1].height); pass(blur, rts[1], rts[2]);
    blur.uniforms.d.value.set(1.6 / rts[3].width, 0); pass(blur, rts[2], rts[3]);
    blur.uniforms.d.value.set(0, 1.6 / rts[3].height); pass(blur, rts[3], rts[4]);
    const u = final.uniforms;
    u.tScene.value = rtScene.texture; u.tB1.value = rts[2].texture; u.tB2.value = rts[4].texture;
    u.uBloom.value = fx.bloom == null ? 1 : fx.bloom; bright.uniforms.uTh.value = fx.th || 0.76;
    u.uSpeed.value = fx.speed; u.uNitro.value = fx.nitro; u.uHit.value = fx.hit; u.uTime.value = fx.time % 100;
    quad.material = final; renderer.setRenderTarget(null); renderer.render(qs, cam);
  }
  return { resize, render };
})();

let postOn = true;
function applyQuality() {
  const q = QUALITY[settings.quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.shadowMap.enabled = q.shadows;
  sun.castShadow = q.shadows;
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(q.map, q.map);
  camera.far = q.far; camera.updateProjectionMatrix();
  scene.fog.near = q.fog[0]; scene.fog.far = q.fog[1];
  postOn = q.post;
  scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const q = QUALITY[settings.quality], pr = renderer.getPixelRatio();
  if (q.post) post.resize(Math.floor(w * pr), Math.floor(h * pr), q.msaa);
}
const fx = { speed: 0, nitro: 0, hit: 0, time: 0, bloom: 1, th: 0.76 };
function renderFrame() {
  skyDome.position.copy(camera.position);
  if (typeof ModelKit !== "undefined") ModelKit.cull(camera);
  if (postOn) post.render(scene, camera, fx); else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
}

/* ================= Static mesh merging (fewer draw calls) =================
   Bakes many meshes that never move relative to `parent` into one mesh per material. Handles indexed / non-indexed
   and quantized (normalized integer) glTF attributes. Materials that look the same are shared even if they are
   separate objects, so e.g. twenty gold finials become one draw. */
const NORMF = (a) => (!a.normalized ? 1 : a.array instanceof Int8Array ? 1 / 127 : a.array instanceof Uint8Array ? 1 / 255 : a.array instanceof Int16Array ? 1 / 32767 : a.array instanceof Uint16Array ? 1 / 65535 : 1);
function matKey(m) {
  const t = (x) => (x ? (x.image && x.image.uuid ? x.image.uuid : x.uuid) + (x.repeat ? x.repeat.x + "x" + x.repeat.y : "") : "-");
  return [m.type, m.color && m.color.getHexString(), m.emissive && m.emissive.getHexString(), m.emissiveIntensity, m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.blending, m.toneMapped, m.fog, m.vertexColors, t(m.map), t(m.normalMap), t(m.emissiveMap), t(m.alphaMap), m.alphaTest].join("|");
}
function mergeMeshes(meshes, parent) {
  if (meshes.length < 2) return 0;
  parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const groups = new Map(), mats = new Map();
  for (const o of meshes) {
    const ms = [].concat(o.material);
    if (ms.length !== 1 || !o.geometry.attributes.position) continue;     // multi-material meshes stay as they are
    const k = matKey(ms[0]) + (o.geometry.attributes.uv ? "|uv" : "|nouv");
    if (!mats.has(k)) mats.set(k, ms[0]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3();
  let merged = 0;
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const P = [], Nn = [], UV = [], hasUV = k.endsWith("|uv");
    for (const o of list) {
      const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
      const fp = NORMF(pa), fn = na ? NORMF(na) : 1, fu = ua ? NORMF(ua) : 1;
      M.multiplyMatrices(inv, o.matrixWorld); N.getNormalMatrix(M);
      const idx = g.index ? g.index.array : null, n = idx ? idx.length : pa.count;
      for (let t = 0; t < n; t++) {
        const i = idx ? idx[t] : t;
        v.set(pa.getX(i) * fp, pa.getY(i) * fp, pa.getZ(i) * fp).applyMatrix4(M); P.push(v.x, v.y, v.z);
        if (na) { v.set(na.getX(i) * fn, na.getY(i) * fn, na.getZ(i) * fn).applyMatrix3(N).normalize(); Nn.push(v.x, v.y, v.z); } else Nn.push(0, 1, 0);
        if (hasUV) UV.push(ua.getX(i) * fu, ua.getY(i) * fu);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3));
    if (hasUV) geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, mats.get(k));
    mesh.castShadow = list.some((o) => o.castShadow); mesh.receiveShadow = list.some((o) => o.receiveShadow);
    mesh.renderOrder = list[0].renderOrder;
    parent.add(mesh);
    for (const o of list) o.parent.remove(o);
    merged += list.length - 1;
  }
  return merged;
}
/* All visible plain meshes under root (no instanced / skinned / sprites), skipping subtrees in `skip`. */
function staticMeshes(root, skip) {
  const out = [];
  (function walk(o) {
    if (!o.visible || (skip && skip.has(o))) return;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !o.morphTargetInfluences) out.push(o);
    o.children.forEach(walk);
  })(root);
  return out;
}
