/* UZ AUTO LIFE — procedural car models (one sculpted, deformable shell per car), damage, particles and vehicle physics. */
"use strict";

/* Body shapes. z is forward; lengths in metres.
   belt = bottom of the glass, hood/deck = body height at the nose/tail, cab = glass base (front, rear), roof = flat roof (front, rear),
   wr = wheel radius, a/b = axle distances from the centre, tw = tyre width. */
const SHAPES = {
  shahar:  { L: 4.4, W: 1.78, H: 1.44, gc: 0.27, belt: 0.93, hood: 0.8,  deck: 0.93, cab: [0.85, -1.55], roof: [0.1, -0.8],   wr: 0.32, a: 1.32, b: 1.36, tw: 0.22, doors4: true },
  chaqqon: { L: 3.5, W: 1.5,  H: 1.84, gc: 0.28, belt: 1.02, hood: 0.92, deck: 1.02, cab: [1.5, -1.68],  roof: [0.95, -1.6],  wr: 0.27, a: 1.02, b: 1.1,  tw: 0.18, doors4: true },
  zarba:   { L: 3.95, W: 1.74, H: 1.45, gc: 0.26, belt: 0.92, hood: 0.78, deck: 0.94, cab: [0.8, -1.9],   roof: [0.05, -1.5],  wr: 0.31, a: 1.22, b: 1.27, tw: 0.22, doors4: true },
  bars:    { L: 4.65, W: 1.94, H: 1.76, gc: 0.4,  belt: 1.14, hood: 1.04, deck: 1.14, cab: [1.0, -2.2],   roof: [0.3, -1.95],  wr: 0.39, a: 1.42, b: 1.42, tw: 0.27, doors4: true, rails: true },
  lochin:  { L: 4.35, W: 1.84, H: 1.26, gc: 0.2,  belt: 0.84, hood: 0.66, deck: 0.86, cab: [0.6, -1.7],   roof: [-0.2, -0.75], wr: 0.33, a: 1.32, b: 1.32, tw: 0.26, sport: true },
  tulpor:  { L: 4.85, W: 1.96, H: 1.32, gc: 0.22, belt: 0.9,  hood: 0.8,  deck: 0.9,  cab: [0.4, -1.85],  roof: [-0.4, -0.95], wr: 0.35, a: 1.48, b: 1.42, tw: 0.3,  sport: true, scoop: true },
  sesto:   { L: 4.33, W: 1.99, H: 1.13, gc: 0.15, belt: 0.72, hood: 0.5,  deck: 0.8,  cab: [1.0, -1.25],  roof: [0.1, -0.5],   wr: 0.33, a: 1.3,  b: 1.4,  tw: 0.3,  sport: true, wing: true },
  yashin:  { L: 4.55, W: 2.0,  H: 1.12, gc: 0.16, belt: 0.74, hood: 0.52, deck: 0.82, cab: [1.05, -1.3],  roof: [0.15, -0.45], wr: 0.35, a: 1.38, b: 1.32, tw: 0.33, sport: true, wing: true },
};
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/* One closed shell: every cross-section has the same 11 named rows on each side —
   floor, wheel-well, rocker, flank, shoulder, glass bottom/top, roof rail, roof — so wheel arches, the greenhouse
   and the hood are all part of one deformable surface. Faces are grouped as paint (0), glass (1) or underbody (2). */
function shellGeo(sh) {
  const hl = sh.L / 2, hw = sh.W / 2, [c0, c1] = sh.cab, [r0, r1] = sh.roof, Ra = sh.wr + 0.085, zB = (r0 + r1) / 2;
  const keys = [-hl, hl, c0, c1, r0, r1, sh.a, -sh.b, sh.a - Ra, sh.a + Ra, -sh.b - Ra, -sh.b + Ra, hl - 0.05, hl - 0.16, -hl + 0.05, -hl + 0.16];
  if (sh.doors4) keys.push(zB - 0.05, zB + 0.05);
  const zs = keys.slice(), n0 = Math.round(sh.L / 0.115);
  for (let i = 1; i < n0; i++) { const z = -hl + (i / n0) * sh.L; if (!keys.some((k) => Math.abs(k - z) < 0.045)) zs.push(z); }
  zs.sort((a, b) => a - b);
  for (let i = zs.length - 2; i > 0; i--) if (zs[i + 1] - zs[i] < 0.02) zs.splice(i, 1);
  const HX = [0.93, 0.78, 0.6, 0.33, 0], CX = [0.93, 0.8, 0.7, 0.36, 0];
  const st = zs.map((z) => {
    const d = hl - Math.abs(z), u = d < 0.36 ? 1 - d / 0.36 : 0;
    const w = hw * (1 - 0.035 * (z / hl) ** 2) * (0.8 + 0.2 * Math.sqrt(1 - u * u));
    let ysh = z > c0 ? lerp(sh.belt, sh.hood - 0.02, smooth((z - c0) / (hl - c0))) : z < c1 ? lerp(sh.belt, sh.deck - 0.02, smooth((c1 - z) / (c1 + hl + 1e-3))) : sh.belt;
    ysh -= 0.09 * u * u;
    const yb = sh.gc + 0.12 * u * u;
    const f = z >= c0 || z <= c1 ? 0 : z > r0 ? (c0 - z) / (c0 - r0) : z < r1 ? (z - c1) / (r1 - c1) : 1;
    let arch = 0, flare = 1;
    for (const zw of [sh.a, -sh.b]) {
      const dz = Math.abs(z - zw);
      if (dz < Ra - 1e-4) arch = sh.wr + Math.sqrt(Ra * Ra - dz * dz);
      if (dz < Ra + 0.3) flare = Math.max(flare, 1 + 0.03 * smooth(1 - dz / (Ra + 0.3)));
    }
    const yE = Math.max(ysh, arch ? arch + 0.1 : 0), crown = 0.05 * (1 - u), h = ysh - yb;
    const hoodY = [yE, lerp(yE, ysh, 0.6) + crown * 0.5, ysh + crown * 0.85, ysh + crown, ysh + crown];
    const cabY = [yE, sh.H - 0.075, sh.H - 0.018, sh.H, sh.H];
    const pts = [
      [0, yb], [0.6 * w, Math.max(yb, arch)], [0.93 * w, Math.max(yb, arch)],
      [0.985 * w * flare, Math.max(yb + Math.min(0.09, h * 0.25), arch)],
      [w * flare, Math.max(lerp(yb, ysh, 0.45), arch + 0.03)],
      [0.975 * w * flare, Math.max(yE - Math.min(0.07, h * 0.2), arch + 0.06)],
    ];
    for (let k = 0; k < 5; k++) pts.push([w * lerp(HX[k], CX[k], f) * (k === 0 ? flare : 1), lerp(hoodY[k], cabY[k], f)]);
    return { z, f, pts };
  });
  const N = st.length, K = 20, row = (k) => (k <= 10 ? k : 20 - k);
  const pos = new Float32Array((N * K + 2) * 3);
  let p = 0;
  for (const s of st) for (let k = 0; k < K; k++) { const j = row(k), q = s.pts[j]; pos[p++] = k <= 10 ? q[0] : -q[0]; pos[p++] = q[1]; pos[p++] = s.z; }
  const cA = N * K, cB = cA + 1, mid = (s) => (s.pts[0][1] + s.pts[10][1]) / 2;
  pos.set([0, mid(st[0]), st[0].z], cA * 3); pos.set([0, mid(st[N - 1]), st[N - 1].z], cB * 3);
  const idx = [[], [], []];
  for (let i = 0; i < N - 1; i++) {
    const fa = st[i].f, fb = st[i + 1].f, fmin = Math.min(fa, fb), fmax = Math.max(fa, fb), zm = (st[i].z + st[i + 1].z) / 2;
    const pillar = sh.doors4 && Math.abs(zm - zB) < 0.05;
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K, band = Math.min(row(k), row(k2));
      let m = 0;
      if (band <= 1) m = 2;
      else if (band === 6 && !pillar && fmin > (zm > zB ? 0.16 : sh.doors4 ? 0.45 : 0.6)) m = 1;
      else if ((band === 8 || band === 9) && fmax > 0.04 && fmin < 0.97) m = 1;
      const a = i * K + k, b = i * K + k2, c = (i + 1) * K + k, d = (i + 1) * K + k2;
      idx[m].push(a, b, c, b, d, c);
    }
  }
  for (let k = 0; k < K; k++) { idx[0].push(cA, (k + 1) % K, k); idx[0].push(cB, (N - 1) * K + k, (N - 1) * K + ((k + 1) % K)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx[0].concat(idx[1], idx[2]));
  g.addGroup(0, idx[0].length, 0); g.addGroup(idx[0].length, idx[1].length, 1); g.addGroup(idx[0].length + idx[1].length, idx[2].length, 2);
  g.computeVertexNormals();
  g.userData.station = (z) => { let b = st[0]; for (const s of st) if (Math.abs(s.z - z) < Math.abs(b.z - z)) b = s; return b; };
  return g;
}

const MUD = col(0x5a4630);
const trimMat = std({ color: 0x101114, roughness: 0.6, metalness: 0.2 });
const tireMat = std({ color: 0x0b0b0d, roughness: 0.9, side: THREE.DoubleSide });
const barrelMat = std({ color: 0x101114, roughness: 0.6, side: THREE.DoubleSide });
const discMat = std({ color: 0x7c8088, roughness: 0.35, metalness: 0.9 });
const caliperMat = std({ color: 0xd8202a, roughness: 0.4, metalness: 0.3 });
const chromeMat = std({ color: 0xd8dce2, roughness: 0.15, metalness: 1 });
const deadLight = std({ color: 0x1a1a1e, roughness: 0.4 });
const wheelGeoCache = {};
function wheelGeos(sh) {
  const k = sh.wr + "_" + sh.tw;
  if (wheelGeoCache[k]) return wheelGeoCache[k];
  const r = sh.wr, t = sh.tw / 2, V = (x, y) => new THREE.Vector2(x, y);
  const tire = new THREE.LatheGeometry([V(r * 0.64, -t), V(r * 0.9, -t), V(r * 0.985, -t * 0.72), V(r, -t * 0.35), V(r, t * 0.35), V(r * 0.985, t * 0.72), V(r * 0.9, t), V(r * 0.64, t)], 28);
  tire.rotateZ(-Math.PI / 2);                                  // axle along x, outer face at +x
  const barrel = new THREE.CylinderGeometry(r * 0.65, r * 0.65, sh.tw * 0.86, 24, 1, true); barrel.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(r * 0.645, 0.02, 6, 28); lip.rotateY(Math.PI / 2); lip.translate(t * 0.9, 0, 0);
  const spoke = new THREE.BoxGeometry(0.028, r * 0.62, 0.055); spoke.translate(t * 0.82, r * 0.33, 0);
  const hub = new THREE.CylinderGeometry(0.065, 0.075, 0.05, 12); hub.rotateZ(Math.PI / 2); hub.translate(t * 0.86, 0, 0);
  const disc = new THREE.CylinderGeometry(r * 0.52, r * 0.52, 0.03, 20); disc.rotateZ(Math.PI / 2); disc.translate(t * 0.35, 0, 0);
  const back = new THREE.CircleGeometry(r * 0.65, 20); back.rotateY(Math.PI / 2); back.translate(-t * 0.8, 0, 0);
  const caliper = new THREE.BoxGeometry(0.07, r * 0.3, r * 0.42); caliper.translate(t * 0.4, r * 0.38, 0);
  return (wheelGeoCache[k] = { tire, barrel, lip, spoke, hub, disc, back, caliper });
}
function plateMat(text) {
  return new THREE.MeshBasicMaterial({ map: canvasTex(256, 56, (g) => {
    g.fillStyle = "#e9e9e4"; g.fillRect(0, 0, 256, 56); g.strokeStyle = "#111"; g.lineWidth = 4; g.strokeRect(2, 2, 252, 52);
    g.fillStyle = "#111"; g.font = "800 34px 'Chakra Petch', Manrope, sans-serif"; g.textBaseline = "middle"; g.fillText(text, 14, 30);
  }) });
}
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Builds one car. opts: {paint, tune, player, plate}. */
function buildCar(id, opts) {
  opts = opts || {};
  const sh = SHAPES[id] || SHAPES.shahar, hl = sh.L / 2, hw = sh.W / 2;
  const g = new THREE.Group(), tilt = new THREE.Group(); g.add(tilt);
  const paintMat = opts.player
    ? new THREE.MeshPhysicalMaterial({ color: col(opts.paint || "#f3f1ec"), roughness: 0.3, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.0 })
    : std({ color: opts.paint || "#f3f1ec", roughness: 0.32, metalness: 0.55, envMapIntensity: 0.9 });
  const glassMat = std({ color: 0x0a121c, roughness: 0.05, metalness: 0.9, envMapIntensity: 1.7 });
  const headMat = new THREE.MeshBasicMaterial({ color: col(0xf2f7ff), toneMapped: false });
  const tailMat = new THREE.MeshBasicMaterial({ color: col(0xff1a12) });
  const rimMat = std({ color: (opts.tune && opts.tune.rim) || "#b8bcc2", metalness: 0.9, roughness: 0.22 });
  const add = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; (parent || tilt).add(m); return m; };

  const sGeo = shellGeo(sh), stn = sGeo.userData.station;
  const body = add(sGeo, [paintMat, glassMat, trimMat], 0, 0, 0);
  const deform = [{ geo: sGeo, orig: sGeo.attributes.position.array.slice() }];
  const nose = stn(hl - 0.12), tail = stn(-hl + 0.12), tipF = stn(hl), tipR = stn(-hl);
  const wN = nose.pts[4][0], yN = nose.pts[6][1], wT = tail.pts[4][0], yT = tail.pts[6][1];

  // Lights: swept headlamps at the front corners, a full-width tail bar with corner clusters
  const lights = {};
  for (const [k, s] of [["fl", 1], ["fr", -1]]) {
    const m = add(new THREE.BoxGeometry(0.46, sh.sport ? 0.06 : 0.09, 0.2), headMat, s * (wN - 0.27), yN - 0.075, hl - 0.15);
    m.rotation.y = s * 0.42; m.castShadow = false; lights[k] = m;
  }
  lights.rear = add(new THREE.BoxGeometry(wT * 1.74, 0.05, 0.12), tailMat, 0, yT - 0.08, -hl + 0.05); lights.rear.castShadow = false;
  for (const s of [1, -1]) { const m = add(new THREE.BoxGeometry(0.34, 0.11, 0.2), tailMat, s * (wT - 0.2), yT - 0.085, -hl + 0.12, lights.rear); m.position.set(s * (wT - 0.2), -0.005, 0.07); m.rotation.y = -s * 0.4; m.castShadow = false; }
  // Front fascia: grille and lower intake; rear diffuser with exhaust tips. The lower pieces are the loose bumpers.
  const yBf = tipF.pts[0][1], yBr = tipR.pts[0][1];
  add(new THREE.BoxGeometry(wN * 0.95, sh.sport ? 0.05 : 0.1, 0.08), trimMat, 0, yN - 0.08, hl - 0.012);
  const bumpers = {
    f: add(new THREE.BoxGeometry(wN * 1.5, 0.13, 0.1), trimMat, 0, yBf + 0.09, hl - 0.02),
    r: add(new THREE.BoxGeometry(wT * 1.5, 0.13, 0.1), trimMat, 0, yBr + 0.08, -hl + 0.02),
  };
  for (const s of [1, -1]) {
    add(new THREE.BoxGeometry(0.2, 0.035, 0.03), headMat, s * wN * 0.62, 0.04, 0.045, bumpers.f).castShadow = false;       // daytime running lights
    if (sh.sport) { const e = add(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 10), chromeMat, s * wT * 0.45, 0, -0.04, bumpers.r); e.rotation.x = Math.PI / 2; }
  }
  if (sh.sport) add(new THREE.BoxGeometry(wN * 1.7, 0.03, 0.22), trimMat, 0, -0.08, 0.05, bumpers.f);                        // splitter
  // Side skirts, door handles, mirrors
  for (const s of [1, -1]) {
    add(new THREE.BoxGeometry(0.05, 0.07, sh.a + sh.b - 2 * sh.wr - 0.3), trimMat, s * hw * 0.975, sh.gc + 0.035, (sh.a - sh.b) / 2);
    const hz = sh.doors4 ? [(sh.cab[0] + sh.roof[1]) / 2 - 0.25, sh.roof[1] - 0.05] : [sh.roof[1] + 0.1];
    for (const z of hz) add(new THREE.BoxGeometry(0.02, 0.025, 0.13), sh.sport ? trimMat : chromeMat, s * hw * 0.975, sh.belt - 0.085, z).castShadow = false;
  }
  const mirrors = [1, -1].map((s) => {
    const m = add(new THREE.BoxGeometry(0.17, 0.1, 0.09), paintMat, s * (hw * 0.93 + 0.1), sh.belt + 0.09, sh.cab[0] - 0.34);
    add(new THREE.BoxGeometry(0.1, 0.03, 0.05), trimMat, -s * 0.09, -0.04, 0, m); return m;
  });
  if (sh.rails) for (const s of [1, -1]) add(new THREE.BoxGeometry(0.05, 0.05, sh.roof[0] - sh.roof[1] - 0.2), chromeMat, s * hw * 0.62, sh.H + 0.035, (sh.roof[0] + sh.roof[1]) / 2);
  if (sh.scoop) add(new THREE.BoxGeometry(0.5, 0.08, 0.8), trimMat, 0, lerp(sh.belt, sh.hood, 0.45) + 0.05, (sh.cab[0] + hl) / 2 - 0.1);
  if (sh.wing) { add(new THREE.BoxGeometry(sh.W * 0.92, 0.035, 0.3), trimMat, 0, sh.deck + 0.17, -hl + 0.24); for (const s of [1, -1]) add(new THREE.BoxGeometry(0.05, 0.19, 0.22), trimMat, s * hw * 0.62, sh.deck + 0.07, -hl + 0.26); }
  // Spoiler (tuning)
  const spoiler = new THREE.Group(); tilt.add(spoiler);
  const sy = sh.deck + (sh.wing ? 0.42 : 0.3), sz = -hl + 0.3;
  add(new THREE.BoxGeometry(sh.W * 0.9, 0.04, 0.34), paintMat, 0, sy, sz, spoiler);
  for (const s of [1, -1]) { add(new THREE.BoxGeometry(0.05, sy - sh.deck + 0.04, 0.2), trimMat, s * hw * 0.5, (sy + sh.deck) / 2 - 0.03, sz + 0.03, spoiler); add(new THREE.BoxGeometry(0.035, 0.17, 0.42), paintMat, s * hw * 0.9, sy + 0.01, sz, spoiler); }
  // Plates
  const pm = plateMat(opts.plate || "01 U 777 ZA");
  const pf = add(new THREE.PlaneGeometry(0.46, 0.105), pm, 0, yBf + 0.1, hl + 0.035); pf.castShadow = false;
  const pb = add(new THREE.PlaneGeometry(0.46, 0.105), pm, 0, (yT + yBr) / 2 - 0.02, -hl - 0.012); pb.rotation.y = Math.PI; pb.castShadow = false;
  // Wheels: profiled tyre, five-spoke rim, brake disc (red calipers on the sport models)
  const wg = wheelGeos(sh), wheels = [];
  for (const [sx, z, front] of [[1, sh.a, 1], [-1, sh.a, 1], [1, -sh.b, 0], [-1, -sh.b, 0]]) {
    const steerG = new THREE.Group(); steerG.position.set(sx * (hw * 1.0 - sh.tw / 2), sh.wr, z); g.add(steerG);
    const side = new THREE.Group(); side.rotation.y = sx > 0 ? 0 : Math.PI; steerG.add(side);
    const spin = new THREE.Group(); side.add(spin);
    const t = new THREE.Mesh(wg.tire, tireMat); t.castShadow = true; spin.add(t);
    spin.add(new THREE.Mesh(wg.barrel, barrelMat), new THREE.Mesh(wg.lip, rimMat), new THREE.Mesh(wg.hub, rimMat), new THREE.Mesh(wg.disc, discMat), new THREE.Mesh(wg.back, trimMat));
    for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(wg.spoke, rimMat); s.rotation.x = (k * Math.PI * 2) / 5; spin.add(s); }
    if (sh.sport) side.add(new THREE.Mesh(wg.caliper, caliperMat));
    wheels.push({ steerG, spin, front, dir: sx });
  }
  // Light decals: headlight throw and neon underglow
  const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: col(0xcfe0ff), transparent: true, opacity: opts.player ? 0.3 : 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.scale.set(sh.W + 3.5, 1, 13); beam.position.set(0, 0.1, hl + 5.2); beam.renderOrder = 3; g.add(beam);
  const glow = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: col(0x19e3ff), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.set(sh.W + 2.2, 1, sh.L + 2); glow.position.y = 0.1; glow.renderOrder = 3; glow.visible = false; g.add(glow);
  const tailGlow = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: col(0xff2010), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  tailGlow.scale.set(sh.W + 2, 1, 4); tailGlow.position.set(0, 0.1, -hl - 1); tailGlow.renderOrder = 3; g.add(tailGlow);
  const bumperHome = { f: bumpers.f.position.clone(), r: bumpers.r.position.clone() };

  const car = {
    id, sh, g, tilt, body, wheels, lights, bumpers, mirrors, spoiler, beam, glow, tailGlow,
    paintMat, glassMat, headMat, tailMat, rimMat, broken: { fl: false, fr: false, rear: false },
    paint: col(opts.paint || "#f3f1ec"),
    setTune(t) {
      this.tune = t;
      this.paint = col(t.paint); paintMat.color.copy(this.paint); rimMat.color.copy(col(t.rim));
      spoiler.visible = !!t.spoiler && this.spoilerAllowed !== false;
      glow.visible = !!t.neon; if (t.neon) glow.material.color.copy(col(t.neon));
      glassMat.color.copy(col(t.tint ? 0x010203 : 0x0a121c)); glassMat.roughness = t.tint ? 0.02 : 0.05;
    },
    setDirt(d, cond) {
      paintMat.color.copy(this.paint).lerp(MUD, (d / 100) * 0.7).multiplyScalar(0.8 + 0.2 * (cond / 100));
      paintMat.roughness = 0.3 + (d / 100) * 0.55; if (paintMat.clearcoat != null) paintMat.clearcoat = 1 - d / 100;
    },
    /** Crumple the shell around a local-space point p, pushing along the (unit, horizontal) direction n. s = 0..1. */
    dent(px, py, pz, nx, nz, s, quiet) {
      const Rr = 0.5 + s * 0.8, depth = 0.07 + s * 0.36;
      for (const d of deform) {
        const a = d.geo.attributes.position.array, o = d.orig;
        for (let i = 0; i < a.length; i += 3) {
          const dx = a[i] - px, dy = (a[i + 1] - py) * 0.75, dz = a[i + 2] - pz, dist = Math.hypot(dx, dy, dz);
          if (dist > Rr) continue;
          const f = (1 - dist / Rr) ** 2, j = 0.6 + hash(i + px * 31 + pz * 17) * 0.9;
          a[i] += nx * depth * f * j; a[i + 2] += nz * depth * f * j; a[i + 1] += (hash(i * 3.1 + pz) - 0.6) * depth * f * 0.45;
          // never fold further than half a metre from the factory shape
          const ex = a[i] - o[i], ey = a[i + 1] - o[i + 1], ez = a[i + 2] - o[i + 2], el = Math.hypot(ex, ey, ez);
          if (el > 0.5) { const k = 0.5 / el; a[i] = o[i] + ex * k; a[i + 1] = o[i + 1] + ey * k; a[i + 2] = o[i + 2] + ez * k; }
        }
        d.geo.attributes.position.needsUpdate = true; d.geo.computeVertexNormals();
      }
      // Parts near the hit
      const front = pz > hl - 1.1, rear = pz < -hl + 1.1;
      if (s > 0.28) {
        if (front) { if (px > -0.2) this.breakLight("fl"); if (px < 0.2) this.breakLight("fr"); }
        if (rear && s > 0.4) this.breakLight("rear");
        const bp = front ? bumpers.f : rear ? bumpers.r : null;
        if (bp) { bp.rotation.z += (hash(px * 9 + s) - 0.5) * 0.35 * s; bp.rotation.y += (px > 0 ? -1 : 1) * 0.12 * s; bp.position.y -= 0.05 * s; bp.position.z += (front ? -1 : 1) * 0.1 * s; }
        if (Math.abs(px) > hw * 0.6 && Math.abs(pz - sh.cab[0]) < 1.2 && s > 0.45) mirrors[px > 0 ? 0 : 1].visible = false;
        if (s > 0.6 && Math.abs(pz) < 1.3) glassMat.color.lerp(col(0x56606a), 0.35);   // crazed side glass
      }
      if (!quiet && typeof sparkBurst === "function") sparkBurst(g.localToWorld(new THREE.Vector3(px, py, pz)), 10 + s * 40);
    },
    breakLight(k) {
      if (this.broken[k]) return; this.broken[k] = true; lights[k].material = deadLight;
      if (k === "rear") tailGlow.visible = false;
      beam.material.opacity = (opts.player ? 0.3 : 0.2) * ((this.broken.fl ? 0 : 0.5) + (this.broken.fr ? 0 : 0.5));
    },
    repair() {
      for (const d of deform) { d.geo.attributes.position.array.set(d.orig); d.geo.attributes.position.needsUpdate = true; d.geo.computeVertexNormals(); }
      this.broken = { fl: false, fr: false, rear: false };
      lights.fl.material = lights.fr.material = headMat; lights.rear.material = tailMat; tailGlow.visible = true;
      beam.material.opacity = opts.player ? 0.3 : 0.2;
      bumpers.f.rotation.set(0, 0, 0); bumpers.r.rotation.set(0, 0, 0);
      bumpers.f.position.copy(bumperHome.f); bumpers.r.position.copy(bumperHome.r); this.setTune(this.tune);
      if (!this.model) mirrors.forEach((m) => (m.visible = true));
    },
    dispose() { sGeo.dispose(); paintMat.dispose(); glassMat.dispose(); },
  };
  car.setTune(Object.assign(C.defaultTune(), { paint: opts.paint || "#f3f1ec" }, opts.tune || {}));
  // A real 3D model (models/manifest.json) replaces the procedural body when one is available.
  if (typeof ModelKit !== "undefined" && ModelKit.has(id)) ModelKit.dress(car, opts);
  return car;
}

/* ================= Particles (sparks, tyre and engine smoke) ================= */
function makeParticles(n, size, tex, opacity) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3).fill(-999), colr = new Float32Array(n * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(colr, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  const P = []; for (let i = 0; i < n; i++) P.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, grav: 0, drag: 0 });
  let next = 0;
  return {
    emit(x, y, z, vx, vy, vz, life, c, grav, drag) {
      const i = next; next = (next + 1) % n; const p = P[i];
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      Object.assign(p, { life, max: life, vx, vy, vz, r: c.r, g: c.g, b: c.b, grav: grav || 0, drag: drag || 0 });
    },
    update(dt) {
      for (let i = 0; i < n; i++) {
        const p = P[i]; if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { pos[i * 3 + 1] = -999; colr[i * 3] = colr[i * 3 + 1] = colr[i * 3 + 2] = 0; continue; }
        p.vy -= p.grav * dt; const k = 1 - p.drag * dt; p.vx *= k; p.vz *= k;
        pos[i * 3] += p.vx * dt; pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + p.vy * dt); pos[i * 3 + 2] += p.vz * dt;
        const f = p.life / p.max; colr[i * 3] = p.r * f; colr[i * 3 + 1] = p.g * f; colr[i * 3 + 2] = p.b * f;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}
const sparks = makeParticles(160, 0.22, GLOW_TEX, 1);
const smoke = makeParticles(140, 2.1, SMOKE_TEX, 0.5);
const SPARK_C = col(0xffb040), FLAME_C = col(0x3aa8ff), SMOKE_C = new THREE.Color(0.2, 0.2, 0.22), STEAM_C = new THREE.Color(0.3, 0.3, 0.33), TYRE_C = new THREE.Color(0.16, 0.16, 0.18);
function sparkBurst(w, n) {
  for (let i = 0; i < n; i++) sparks.emit(w.x, w.y, w.z, (Math.random() - 0.5) * 9, Math.random() * 5 + 1, (Math.random() - 0.5) * 9, 0.25 + Math.random() * 0.45, SPARK_C, 14, 0.5);
}

/* ================= Player car ================= */
const carG = new THREE.Group(); scene.add(carG);
let pcar = null;                       // current player car model
let cockpit = null;
const headLamp = new THREE.SpotLight(col(0xdfe9ff), 1.7, 46, 0.52, 0.65, 1.3);
const neonLamp = new THREE.PointLight(0xffffff, 0, 7, 2);
carG.add(headLamp, headLamp.target, neonLamp);
const wheels = [];
const P = { m: 1150, Iz: 1850, a: 1.25, b: 1.35, L: 2.6, h: 0.55, g: 9.81, Cf: 7.0, Cr: 7.6, brake: 9500, handbrake: 3600, drag: 0.42, roll: 150, grip: 1, power: 1, rwd: false, tough: 1, offroad: false, nitroBoost: 0, nitroTime: 0, cargo: 1 };
let HULL = [-1.45, -0.15, 1.15], HR = 0.92;
const car = { x: -45, z: 3, h: Math.PI / 2, vx: 0, vy: 0, r: 0, steer: 0, ax: 0, ay: 0, gear: 1, mode: "D", rpm: 850, shiftT: 0, spin: 0, slip: 0, throttle: 0, braking: false, hitCd: 0, revHold: 0, nitro: 1, boosting: false, pull: 0 };
let engineOn = true;
let sirenOn = false;          // police cars only (L key / siren button)
let hornOn = false;           // pedestrians react to it
const inp = { kF: false, kB: false, kL: false, kR: false, kH: false, kN: false, tGas: false, tBrake: false, tL: false, tR: false, tH: false, tN: false, wheel: 0 };

function setPlayerCar(id, tune, dents) {
  if (pcar) { carG.remove(pcar.g); pcar.dispose(); }
  pcar = buildCar(id, { player: true, tune, paint: tune.paint });
  carG.add(pcar.g);
  wheels.length = 0; pcar.wheels.forEach((w) => wheels.push(w));
  const sh = pcar.sh, pf = C.carPerf(id, tune);
  Object.assign(P, { m: pf.m, Iz: pf.m * 1.6, a: sh.a, b: sh.b, L: sh.a + sh.b, h: 0.4 + sh.H * 0.12, brake: 9500 * pf.brake * (pf.m / 1150), handbrake: 3600 * (pf.m / 1150), drag: pf.drag, roll: 150 * (pf.m / 1150), grip: pf.grip, power: pf.power, rwd: pf.rwd, tough: pf.tough, offroad: pf.offroad, nitroBoost: pf.nitroBoost, nitroTime: pf.nitroTime, cargo: pf.cargo });
  HR = sh.W / 2 + 0.05; const e = sh.L / 2 - HR + 0.08; HULL = [-e, 0, e];
  headLamp.position.set(0, 0.85, sh.L / 2 - 0.2); headLamp.target.position.set(0, 0.1, sh.L / 2 + 14);
  neonLamp.intensity = tune.neon ? 1.3 : 0; if (tune.neon) neonLamp.color.copy(col(tune.neon)); neonLamp.position.set(0, 0.25, 0);
  // Cockpit (dash + steering wheel) for the interior camera
  cockpit = new THREE.Group(); pcar.tilt.add(cockpit);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(sh.W * 0.8, 0.2, 0.45), trimMat); dash.position.set(0, sh.belt + 0.06, sh.cab[0] - 0.3); cockpit.add(dash);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.024, 8, 24), trimMat); sw.position.set(0.36, sh.belt + 0.17, sh.cab[0] - 0.58); sw.rotation.x = -0.35; cockpit.add(sw);
  cockpit.userData.wheel = sw; cockpit.visible = false;
  car.eye = { y: sh.H - 0.17, z: Math.min(sh.roof[0] - 0.1, sh.cab[0] - 0.85) };
  car.pull = (hash(id.length * 7.3) - 0.5) * 2;
  (dents || []).forEach((d) => pcar.dent(d.x, d.y, d.z, d.nx, d.nz, d.s, true));
  return pcar;
}

function controls(dt) {
  const kmh = Math.abs(car.vx) * 3.6;
  // Keyboard: forward/back intents become gas/brake depending on gear; auto D↔R at standstill.
  let gas = 0, brk = 0;
  const kbFwd = inp.kF, kbBack = inp.kB;
  if (kbFwd || kbBack) {
    if (car.mode === "D") { gas = kbFwd ? 1 : 0; brk = kbBack ? 1 : 0; if (kbBack && !kbFwd && kmh < 2) { car.revHold += dt; if (car.revHold > 0.3) setGear("R"); } else car.revHold = 0; }
    else { gas = kbBack ? 1 : 0; brk = kbFwd ? 1 : 0; if (kbFwd && !kbBack && kmh < 2) { car.revHold += dt; if (car.revHold > 0.3) setGear("D"); } else car.revHold = 0; }
  } else car.revHold = 0;
  if (inp.tGas) gas = 1;
  if (inp.tBrake) brk = 1;
  let steerIn = (inp.kL ? 1 : 0) - (inp.kR ? 1 : 0) + (inp.tL ? 1 : 0) - (inp.tR ? 1 : 0) + inp.wheel;
  steerIn = clamp(steerIn, -1, 1);
  const v = Math.hypot(car.vx, car.vy);
  const maxSteer = (0.62 / (1 + v / 15)) * settings.sensitivity;
  const tgt = steerIn * Math.min(maxSteer, 0.65);
  const rate = 2.6 * dt;
  car.steer += clamp(tgt - car.steer, -rate, rate);
  if (typeof inputLocked === "function" && inputLocked()) { gas = 0; brk = 1; }
  // A badly damaged engine misfires.
  if (S.condition < 15 && Math.sin(performance.now() / 70) > 0.35) gas *= 0.25;
  car.throttle = engineOn && S.fuel > 0 ? gas : 0;
  car.brakeIn = brk;
  car.hand = inp.kH || inp.tH;
  // Nitro
  const want = (inp.kN || inp.tN) && P.nitroBoost > 0 && car.throttle > 0 && car.mode === "D";
  car.boosting = want && car.nitro > 0.02;
  if (car.boosting) car.nitro = Math.max(0, car.nitro - dt / P.nitroTime); else if (P.nitroBoost > 0) car.nitro = Math.min(1, car.nitro + dt / 20);
}

function setGear(m) {
  if (car.mode === m) return;
  if (Math.abs(car.vx) > 1.5) { toast("Avval toʻxtang"); return; }
  car.mode = m; car.gear = 1; car.revHold = 0; sfx.click();
}

/* Planar bicycle model: per-axle slip angles, saturating tyre forces with load transfer,
   friction circle on the driven axle (front or rear), aero drag, rolling resistance, engine braking. */
function physicsStep(dt) {
  const { m, Iz, a, b, L, g } = P;
  const onAsphalt = onRoad(car.x, car.z);
  const mu = (onAsphalt ? 1.0 : P.offroad ? 0.95 : 0.85) * P.grip;
  const reverse = car.mode === "R";
  const dir = reverse ? -1 : 1;

  // Gearbox
  const speedAlong = car.vx * dir;
  car.rpm = engineOn && S.fuel > 0 ? C.Gearbox.rpm(Math.max(0, speedAlong), car.gear, reverse, car.throttle) : 0;
  car.shiftT -= dt;
  if (!reverse && car.shiftT <= 0 && engineOn) {
    const ng = C.Gearbox.autoShift(car.gear, car.rpm);
    if (ng !== car.gear) { car.gear = ng; car.shiftT = 0.4; sfx.shift(); }
  }
  let Fdrive = 0;
  const pw = C.powerFromCondition(S.condition) * P.power * (car.boosting ? 1 + P.nitroBoost : 1);
  if (car.throttle > 0 && car.shiftT < 0.25) Fdrive = C.Gearbox.force(car.rpm, car.gear, reverse, car.throttle, pw) * dir;
  if (reverse && -car.vx > 6.5) Fdrive = 0; // ~23 km/h reverse limiter

  // Axle loads with longitudinal weight transfer
  const Nf = Math.max(0, m * g * b / L - m * car.ax * P.h / L);
  const Nr = Math.max(0, m * g * a / L + m * car.ax * P.h / L);
  const muR = car.hand ? 0.42 : 1;
  let latF, latR;
  if (P.rwd) {
    const rMax = mu * Nr * muR;
    Fdrive = clamp(Fdrive, -rMax * 0.98, rMax * 0.98);
    latR = Math.sqrt(Math.max(0, rMax * rMax - Fdrive * Fdrive * 0.8));
    latF = mu * Nf;
  } else {
    const fMax = mu * Nf;
    Fdrive = clamp(Fdrive, -fMax * 0.98, fMax * 0.98);
    latF = Math.sqrt(Math.max(0, fMax * fMax - Fdrive * Fdrive));
    latR = mu * Nr * muR;
  }

  const vxa = Math.max(Math.abs(car.vx), 1.5);
  const sgn = car.vx >= 0 ? 1 : -1;
  // Bent suspension after a crash pulls the steering to one side.
  const steer = car.steer + (S.condition < 60 ? ((60 - S.condition) / 60) * 0.035 * car.pull * Math.min(1, Math.abs(car.vx) / 6) : 0);
  const alphaF = Math.atan2(car.vy + a * car.r, vxa) - steer * sgn;
  const alphaR = Math.atan2(car.vy - b * car.r, vxa);
  const Fyf = -latF * Math.tanh(P.Cf * alphaF);
  const Fyr = -latR * Math.tanh(P.Cr * alphaR);
  car.slip = Math.max(Math.abs(alphaR), Math.abs(alphaF) * 0.6) * Math.min(1, Math.abs(car.vx) / 8);
  car.slipR = Math.abs(alphaR) * Math.min(1, Math.abs(car.vx) / 6);

  // Longitudinal resistances
  let Fx = Fdrive;
  Fx -= P.drag * car.vx * Math.abs(car.vx);
  const rollRes = P.roll * (onAsphalt ? 1 : P.offroad ? 1.4 : 2.4);
  if (Math.abs(car.vx) > 0.05) Fx -= rollRes * sgn;
  if (car.throttle === 0 && engineOn && Math.abs(car.vx) > 0.5) Fx -= 260 * sgn * (car.gear <= 2 ? 1.4 : 1);
  let Fb = car.brakeIn * P.brake + (car.hand ? P.handbrake : 0);
  const stopping = Fb > 0 && Math.abs(car.vx) < 0.4;
  if (Fb > 0 && !stopping) Fx -= Math.min(Fb, mu * m * g) * sgn;

  const cs = Math.cos(steer), sn = Math.sin(steer);
  let dvx = (Fx - Fyf * sn) / m + car.vy * car.r;
  let dvy = (Fyr + Fyf * cs) / m - car.vx * car.r;
  const dr = (a * Fyf * cs - b * Fyr) / Iz;
  car.vx += dvx * dt; car.vy += dvy * dt; car.r += dr * dt;
  if (stopping) { car.vx *= 0.6; if (Math.abs(car.vx) < 0.05) car.vx = 0; }

  // Low-speed blend toward kinematic steering (the bicycle model is ill-conditioned near standstill)
  const v = Math.abs(car.vx);
  if (v < 3) {
    const k = 1 - v / 3;
    const rKin = car.vx * Math.tan(car.steer) / L;
    car.r = lerp(car.r, rKin, Math.min(1, k * 12 * dt + k * 0.3));
    car.vy = lerp(car.vy, 0, Math.min(1, k * 10 * dt + k * 0.2));
  }
  car.ax = lerp(car.ax, dvx - car.vy * car.r, 0.1);
  car.ay = lerp(car.ay, dvy + car.vx * car.r, 0.1);

  // Integrate in world space
  const fx_ = Math.sin(car.h), fz = Math.cos(car.h);   // forward
  const lx = Math.cos(car.h), lz = -Math.sin(car.h);   // left
  car.x += (fx_ * car.vx + lx * car.vy) * dt;
  car.z += (fz * car.vx + lz * car.vy) * dt;
  car.h += car.r * dt;
  collide();
}

/* Three circles along the body vs. box colliders, static circles and traffic; impulse with rotation.
   The deepest contact is reported with its position on the shell so the bodywork can be dented there. */
const dynCircles = [];      // refreshed every frame by the traffic system: {x, z, r, owner}
function collide() {
  const fx_ = Math.sin(car.h), fz = Math.cos(car.h), lx = Math.cos(car.h), lz = -Math.sin(car.h);
  const near = nearCols(car.x, car.z);
  let worst = 0, wHit = null;
  for (const off of HULL) {
    const px = car.x + fx_ * off, pz = car.z + fz * off;
    const hits = [];
    near.forEach((c) => {
      const qx = clamp(px, c.x - c.hx, c.x + c.hx), qz = clamp(pz, c.z - c.hz, c.z + c.hz);
      let dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
      if (d < HR) {
        if (d < 1e-4) { // centre inside box: push out along the shallowest axis
          const ox = c.hx - Math.abs(px - c.x), oz = c.hz - Math.abs(pz - c.z);
          if (ox < oz) { dx = Math.sign(px - c.x) || 1; dz = 0; d = -ox; } else { dz = Math.sign(pz - c.z) || 1; dx = 0; d = -oz; }
          hits.push({ nx: dx, nz: dz, pen: HR - d });
        } else hits.push({ nx: dx / d, nz: dz / d, pen: HR - d });
      }
    });
    for (const list of [circles, dynCircles]) for (const ci of list) {
      const dx = px - ci.x, dz = pz - ci.z, d = Math.hypot(dx, dz);
      if (d < HR + ci.r && d > 1e-4) hits.push({ nx: dx / d, nz: dz / d, pen: HR + ci.r - d, owner: ci.owner });
    }
    for (const hcol of hits) {
      car.x += hcol.nx * hcol.pen; car.z += hcol.nz * hcol.pen;
      // velocity of contact point (world): v + ω×p, with p relative to CG
      const rx = fx_ * off - hcol.nx * HR, rz = fz * off - hcol.nz * HR;
      const vwx = fx_ * car.vx + lx * car.vy + car.r * rz;
      const vwz = fz * car.vx + lz * car.vy - car.r * rx;
      const vn = vwx * hcol.nx + vwz * hcol.nz;
      if (hcol.owner) hcol.owner.stun = 2.5;
      if (vn < 0) {
        const rn = rz * hcol.nx - rx * hcol.nz;
        const e = 0.18;
        const j = (-(1 + e) * vn) / (1 / P.m + (rn * rn) / P.Iz);
        // friction impulse along the tangent
        const tx = -hcol.nz, tz = hcol.nx, vt = vwx * tx + vwz * tz, rt = rz * tx - rx * tz;
        const jt = clamp(-vt / (1 / P.m + (rt * rt) / P.Iz), -0.35 * j, 0.35 * j);
        const Jx = j * hcol.nx + jt * tx, Jz = j * hcol.nz + jt * tz;
        let wvx = fx_ * car.vx + lx * car.vy + Jx / P.m, wvz = fz * car.vx + lz * car.vy + Jz / P.m;
        car.r += (rz * Jx - rx * Jz) / P.Iz;
        car.vx = wvx * fx_ + wvz * fz; car.vy = wvx * lx + wvz * lz;
        if (-vn > worst) {
          worst = -vn;
          // contact in the car's local frame: x = left, z = forward
          const nL = hcol.nx * lx + hcol.nz * lz, nF = hcol.nx * fx_ + hcol.nz * fz;
          wHit = { x: -nL * HR, z: off - nF * HR, nx: nL, nz: nF, traffic: !!hcol.owner };
        }
      }
    }
  }
  if (worst > 0) onImpact(worst, wHit);
}
let onCrash = null;      // set by the game: (damage, speed, hit) → void
function onImpact(speed, hit) {
  if (car.hitCd > 0) return;
  if (speed > 2) sfx.thump(Math.min(1, speed / 12));
  if (speed > 3.2) {
    const dmg = (speed - 3.2) * 3.4 * P.tough;
    S.condition = Math.max(0, S.condition - dmg);
    car.hitCd = 0.5;
    fx.hit = Math.min(1, speed / 13);
    const sh = pcar.sh, s = clamp((speed - 2.6) / 13, 0.05, 1);
    const d = { x: clamp(hit.x, -sh.W / 2, sh.W / 2), y: 0.55 + sh.gc, z: clamp(hit.z, -sh.L / 2, sh.L / 2), nx: hit.nx, nz: hit.nz, s };
    pcar.dent(d.x, d.y, d.z, d.nx, d.nz, d.s);
    S.dents.push({ x: +d.x.toFixed(2), y: +d.y.toFixed(2), z: +d.z.toFixed(2), nx: +d.nx.toFixed(2), nz: +d.nz.toFixed(2), s: +d.s.toFixed(2) });
    if (S.dents.length > 24) S.dents.shift();
    if (dmg > 6) toast("Toʻqnashuv! Holat: " + Math.round(S.condition) + "%");
    if (onCrash) onCrash(dmg, speed, hit);
  }
}

function recover() {
  // Snap to the nearest lane, aligned with the road, at rest.
  let best = null;
  for (const r of ROADS) {
    const xz = clamp(car.x, -HALF + 4, HALF - 4);
    const c1 = { x: xz, z: r + 3, h: Math.PI / 2 }, c2 = { x: r - 3, z: clamp(car.z, -HALF + 4, HALF - 4), h: 0 };
    for (const c of [c1, c2]) {
      if (Math.hypot(c.x, c.z) < RING + 3) continue;
      const d = Math.hypot(c.x - car.x, c.z - car.z);
      if (!best || d < best.d) best = Object.assign({ d }, c);
    }
  }
  const fwd = Math.sin(car.h) * Math.sin(best.h) + Math.cos(car.h) * Math.cos(best.h);
  const h = fwd >= 0 ? best.h : best.h + Math.PI;
  // keep right in the direction we end up facing
  const rx = -Math.cos(h), rz = Math.sin(h);
  const cx = best.h === 0 ? best.x + 3 : best.x, cz = best.h === 0 ? best.z : best.z - 3;
  Object.assign(car, { x: cx + rx * 3, z: cz + rz * 3, h, vx: 0, vy: 0, r: 0, steer: 0, gear: 1, mode: "D" });
  toast("Mashina yoʻlga qaytarildi");
}

/* Per-frame visuals for the player car: tilt, wheels, lights, smoke. */
let smokeT = 0;
function carVisuals(dt, t) {
  carG.position.set(car.x, 0, car.z); carG.rotation.y = car.h;
  const tl = pcar.tilt;
  tl.rotation.z = lerp(tl.rotation.z, clamp(car.ay * 0.012, -0.08, 0.08), 0.2);
  tl.rotation.x = lerp(tl.rotation.x, clamp(car.ax * 0.007, -0.05, 0.05), 0.2);
  car.spin += (car.vx / pcar.sh.wr) * dt;
  wheels.forEach((w) => { w.spin.rotation.x = car.spin * w.dir; if (w.front) w.steerG.rotation.y = car.steer; });
  if (cockpit && cockpit.userData.wheel) cockpit.userData.wheel.rotation.z = -car.steer * 6;
  pcar.setDirt(S.dirt, S.condition);
  const braking = car.brakeIn > 0 || car.hand;
  pcar.tailMat.color.setRGB(braking ? 1 : 0.42, 0.02, 0.01);
  pcar.tailGlow.material.opacity = braking ? 0.55 : 0.2;
  const lit = (pcar.broken.fl ? 0 : 0.5) + (pcar.broken.fr ? 0 : 0.5);
  headLamp.intensity = engineOn ? 1.7 * lit : 0; pcar.beam.visible = engineOn && lit > 0;
  if (pcar.glow.visible) pcar.glow.material.opacity = 0.7 + Math.sin(t * 5) * 0.15;
  if (pcar.model) {           // lights of a real 3D model
    pcar.model.tails.forEach((m) => (m.emissiveIntensity = braking ? 2.4 : 0.45));
    pcar.model.heads.forEach((m) => (m.emissiveIntensity = engineOn ? 1.6 : 0.05));
  }
  if (pcar.sirenFx) {         // police strobes: red double-flash, then blue
    const k = Math.floor(t * 11) % 8, red = sirenOn && (k === 0 || k === 2), blue = sirenOn && (k === 4 || k === 6);
    pcar.sirenFx.red.visible = red; pcar.sirenFx.blue.visible = blue;
    pcar.sirenFx.ground.visible = red || blue;
    pcar.sirenFx.ground.material.color.setHex(red ? 0xff2020 : 0x2a5bff);
    pcar.model.siren.forEach((m) => m.emissive.setScalar(red || blue ? 2.2 : 0.15));
  }
  // Smoke: engine when badly damaged, tyres when sliding, blue flame on nitro.
  smokeT += dt;
  const fxw = Math.sin(car.h), fzw = Math.cos(car.h), sh = pcar.sh;
  if (smokeT > 0.035) {
    smokeT = 0;
    if (S.condition < 40 && engineOn) {
      const k = S.condition < 18 ? SMOKE_C : STEAM_C, z = sh.L / 2 - 0.7;
      if (Math.random() < (S.condition < 18 ? 1 : 0.5)) smoke.emit(car.x + fxw * z + (Math.random() - 0.5) * 0.5, sh.hood + 0.1, car.z + fzw * z + (Math.random() - 0.5) * 0.5, fxw * car.vx * 0.4, 1.4 + Math.random(), fzw * car.vx * 0.4, 1.6, k, -0.4, 0.6);
    }
    if (car.slipR > 0.2 && Math.abs(car.vx) > 4 || (car.hand && Math.abs(car.vx) > 5)) {
      for (const s of [-1, 1]) smoke.emit(car.x - fxw * sh.b + Math.cos(car.h) * s * 0.75, 0.25, car.z - fzw * sh.b - Math.sin(car.h) * s * 0.75, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 1.1, TYRE_C, -0.3, 0.5);
    }
    if (car.boosting) for (let i = 0; i < 3; i++) sparks.emit(car.x - fxw * (sh.L / 2 + 0.1) + (Math.random() - 0.5) * 0.5, 0.35, car.z - fzw * (sh.L / 2 + 0.1) + (Math.random() - 0.5) * 0.5, -fxw * 6 + (Math.random() - 0.5) * 2, Math.random() * 0.6, -fzw * 6 + (Math.random() - 0.5) * 2, 0.22, FLAME_C, 0, 0);
  }
}
