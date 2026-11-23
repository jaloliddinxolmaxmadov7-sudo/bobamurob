/* UZ AUTO LIFE — the night city: roads, blocks, neon, service sites, colliders. */
"use strict";

const ROADS = [-120, -60, 0, 60, 120];
const BLOCKS = [-90, -30, 30, 90];
const RW = 12, HALF = 132, RING = 17, ISLAND = 7.5, WALL = 137;
const SERVICES = [
  { id: "fuel", name: "Yoqilgʻi quyish shoxobchasi", short: "Yoqilgʻi", x: 30, z: -44, r: 6, color: "#ffb020" },
  { id: "wash", name: "Avtomoyka", short: "Avtomoyka", x: -30, z: 44, r: 5.5, color: "#4cc3ff" },
  { id: "repair", name: "Ustaxona", short: "Ustaxona", x: 90, z: 44, r: 6, color: "#ff5a3c" },
  { id: "garage", name: "Garaj", short: "Garaj", x: -30, z: -44, r: 5.5, color: "#5dff9b" },
  { id: "tuning", name: "“Zarb” tyuning atelyesi", short: "Tyuning", x: 90, z: -44, r: 6, color: "#ff2e88" },
  { id: "dealer", name: "Avtosalon", short: "Avtosalon", x: -90, z: 45, r: 5.5, color: "#a25bff" },
  { id: "parking", name: "Markaziy avtoturargoh", short: "Parking", x: 30, z: 71, r: 4.5, color: "#19e3ff" },
  { id: "arena", name: "Drift maydoni", short: "Drift", x: -90, z: -73, r: 5, color: "#ff7a1a" },
];
const SVC = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
function blockKind(cx, cz, i, j) {
  if (cx === 30 && cz === -30) return "fuel";
  if (cx === -30 && cz === 30) return "wash";
  if (cx === 90 && cz === 30) return "repair";
  if (cx === -30 && cz === -30) return "garage";
  if (cx === 30 && cz === 30) return "bazaar";
  if (cx === 90 && cz === -30) return "tuning";
  if (cx === -90 && cz === 30) return "dealer";
  if (cx === 30 && cz === 90) return "parking";
  if (cx === -90 && cz === -90) return "arena";
  if (cx === -30 && cz === -90) return "registon";
  if (cx === 30 && cz === -90 && hasProp("uy")) return "mahalla";
  return (i + j) % 2 === 0 ? "apartments" : "houses";
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ---------- Colliders ---------- */
const colliders = [];             // {x,z,hx,hz,top} axis-aligned boxes
const circles = [{ x: 0, z: 0, r: ISLAND + 0.4 }];   // static circles; dynamic ones (traffic) are appended per frame
const STATIC_CIRCLES = () => circles.filter((c) => !c.dyn);
const GRID = 16, cgrid = new Map();
function addCol(x, z, hx, hz, top) {
  const c = { x, z, hx, hz, top: top == null ? 10 : top }; colliders.push(c);
  for (let gx = Math.floor((x - hx) / GRID); gx <= Math.floor((x + hx) / GRID); gx++)
    for (let gz = Math.floor((z - hz) / GRID); gz <= Math.floor((z + hz) / GRID); gz++) {
      const k = gx + "," + gz; if (!cgrid.has(k)) cgrid.set(k, []); cgrid.get(k).push(c);
    }
  return c;
}
function nearCols(x, z) {
  const out = new Set(), gx = Math.floor(x / GRID), gz = Math.floor(z / GRID);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = cgrid.get((gx + a) + "," + (gz + b)); if (l) l.forEach((c) => out.add(c)); }
  return out;
}
const ARENA = { x: -90, z: -90, half: 22 };
const LOT = { x: 30, z: 90, half: 23 };
const inArena = (x, z) => Math.abs(x - ARENA.x) < ARENA.half && Math.abs(z - ARENA.z) < ARENA.half;
function onRoad(x, z) {
  if (Math.hypot(x, z) < RING) return true;
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return false;
  if (inArena(x, z) || (Math.abs(x - LOT.x) < LOT.half && Math.abs(z - LOT.z) < LOT.half)) return true;
  return ROADS.some((r) => Math.abs(z - r) < RW / 2 || Math.abs(x - r) < RW / 2);
}

/* ---------- Instanced box batches ---------- */
const batches = {};
function box(batch, x, y, z, sx, sy, sz, color, solid) {
  (batches[batch] = batches[batch] || []).push({ x, y, z, sx, sy, sz, c: color });
  if (solid) addCol(x, z, sx / 2, sz / 2, y + sy / 2);
}
const tmpO = new THREE.Object3D();
function instanced(list, mat, opts) {
  opts = opts || {};
  if (!list.length) return null;
  const geo = opts.geo || new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((b, i) => {
    tmpO.position.set(b.x, b.y, b.z); tmpO.scale.set(b.sx, b.sy, b.sz); tmpO.rotation.set(0, b.ry || 0, 0); tmpO.updateMatrix();
    m.setMatrixAt(i, tmpO.matrix);
    m.setColorAt(i, col(b.c || opts.color || "#ffffff"));
  });
  m.castShadow = !!opts.cast; m.receiveShadow = !!opts.receive;
  m.instanceMatrix.needsUpdate = true;
  if (opts.order != null) m.renderOrder = opts.order;
  scene.add(m); return m;
}

/* ---------- Signs & labels ---------- */
function makeLabel(text, color) {
  const tex = canvasTex(512, 112, (g) => {
    g.font = "700 46px 'Chakra Petch', Manrope, sans-serif";
    const w = Math.min(500, g.measureText(text.toUpperCase()).width + 70), x = (512 - w) / 2;
    g.fillStyle = "rgba(6,9,20,0.86)";
    g.beginPath(); g.moveTo(x + 18, 18); g.lineTo(x + w, 18); g.lineTo(x + w - 18, 94); g.lineTo(x, 94); g.closePath(); g.fill();
    g.strokeStyle = color; g.lineWidth = 4; g.stroke();
    g.fillStyle = color; g.fillRect(x + 30, 46, 10, 22);
    g.fillStyle = "#ffffff"; g.textBaseline = "middle"; g.fillText(text.toUpperCase(), x + 52, 58);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
  s.scale.set(11, 2.4, 1); return s;
}
const signCache = {};
function makeSign(text, color, w, h) {
  const key = text + color + w + "x" + h;
  if (!signCache[key]) signCache[key] = new THREE.MeshBasicMaterial({
    fog: true,
    map: canvasTex(512, Math.round((512 * h) / w), (g, W, H) => {
      g.fillStyle = "#070912"; g.fillRect(0, 0, W, H);
      g.strokeStyle = color; g.lineWidth = 8; g.shadowColor = color; g.shadowBlur = 22; g.strokeRect(12, 12, W - 24, H - 24);
      let fs = Math.floor(H * 0.52); g.font = "700 " + fs + "px 'Chakra Petch', Manrope, sans-serif";
      while (g.measureText(text).width > W - 70 && fs > 12) { fs -= 4; g.font = "700 " + fs + "px 'Chakra Petch', Manrope, sans-serif"; }
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = color; g.fillText(text, W / 2, H / 2 + 3); g.shadowBlur = 8; g.fillStyle = "#ffffff"; g.globalAlpha = 0.75; g.fillText(text, W / 2, H / 2 + 3);
    }),
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), signCache[key]);
}
function placeSign(text, color, w, h, x, y, z, ry) { const m = makeSign(text, color, w, h); m.position.set(x, y, z); m.rotation.y = ry || 0; scene.add(m); return m; }

/* ---------- Build steps (run across frames so the loading bar shows real progress) ---------- */
const R = rng(7331);
const pick = (a) => a[Math.floor(R() * a.length)];
const FACADES = ["#8d889c", "#9a9488", "#7f7c90", "#8f897e", "#757288", "#968c7c"];
const HOUSES = ["#a39a88", "#aaa398", "#9b8f72", "#a39580"];
const AWN = ["#c8372d", "#1cb5b0", "#e8b021", "#3f8f3a", "#2a62b8"];
const NEON = ["#19e3ff", "#ff2e88", "#ffb020", "#7dff4a", "#a25bff"];
const WARM = ["#ffd58a", "#ffe7b8", "#ffc46b", "#9fd8ff", "#fff1d6"];
const SHOPS = ["CHOYXONA", "SOMSA", "ISSIQ NON", "DORIXONA", "24/7", "KAFE", "GULLAR", "KITOBLAR", "OSH MARKAZI", "MARKET", "LAGʻMON", "SARTAROSH",
  "TANDIR NON", "SHASHLIKXONA", "ATLAS VA ADRAS", "SUZANI", "MEVA-CHEVA", "KOʻK CHOY", "DOʻPPI", "NAVVOT", "MANTI", "TOʻYXONA"];
/* GPS points of interest (each sits in a driving lane). */
const LANDMARKS = [
  { name: "Registon maydoni", x: -30, z: -63, color: "#1cc6b8" },
  { name: "Chorsu bozori", x: 30, z: 57, color: "#f2b33d" },
  { name: "Koʻk gumbaz aylanasi", x: -3, z: -24, color: "#2a8cff" },
];
const trees = [], lamps = [], pools = [];
let POOLS = null, HALOS = null;        // night-time glow decals, dimmed by day
const PARK_BAYS = [], DISPLAY = [];
const PROP_SPOTS = { "uy#0": [], "uy#1": [], "uy#2": [], uy: [], minora_bino: [], zarang: [] };
const BANDS = [];          // girih tile bands wrapped around model houses: {x, z, ry}      // 3D model buildings / trees to instance after the build
const hasProp = (id) => typeof ModelKit !== "undefined" && !!ModelKit.prop(id);
const PODIUM = { x: -90, z: 31 };

function buildGround() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(460, 460), std({ color: 0x1d2118, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  for (const c of ROADS) {
    box("road", 0, 0.02, c, HALF * 2, 0.04, RW);
    box("road", c, 0.021, 0, RW, 0.04, HALF * 2);
    for (let t = -HALF + 3; t < HALF; t += 6) {
      if (ROADS.some((rc) => Math.abs(t - rc) < 8)) continue;
      if (c === 0 && Math.abs(t) < RING + 2) continue;
      box("paint", t, 0.05, c, 3, 0.02, 0.18);
      box("paint", c, 0.05, t, 0.18, 0.02, 3);
    }
    // kerb-side edge lines
    for (const e of [-RW / 2 + 0.35, RW / 2 - 0.35]) { box("edge", 0, 0.048, c + e, HALF * 2, 0.02, 0.12); box("edge", c + e, 0.049, 0, 0.12, 0.02, HALF * 2); }
  }
  // Zebra crossings on every approach of each 4-way junction (the centre has the roundabout).
  for (const rx of ROADS) for (const rz of ROADS) {
    if (rx === 0 && rz === 0) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cx = rx + dx * 8, cz = rz + dz * 8;
      if (Math.abs(cx) > HALF - 1 || Math.abs(cz) > HALF - 1) continue;
      for (let k = -4.8; k <= 4.8; k += 1.6) {
        if (dx) box("paint", cx, 0.05, rz + k, 2.6, 0.02, 0.7);
        else box("paint", rx + k, 0.05, cz, 0.7, 0.02, 2.6);
      }
    }
  }
  // Roundabout with a tiled-dome pavilion, lit from below.
  const ring = new THREE.Mesh(new THREE.CircleGeometry(RING, 56), std({ color: 0x1c1e24, roughness: 0.42, metalness: 0.25 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.045; ring.receiveShadow = true; scene.add(ring);
  const line = new THREE.Mesh(new THREE.RingGeometry(ISLAND + 4.6, ISLAND + 4.85, 56), std({ color: 0xd8d6cc, roughness: 0.6 }));
  line.rotation.x = -Math.PI / 2; line.position.y = 0.06; scene.add(line);
  const island = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND, ISLAND + 0.3, 0.5, 40), std({ color: 0x2f5a34 }));
  island.position.y = 0.25; island.receiveShadow = true; scene.add(island);
  const kerb = new THREE.Mesh(new THREE.TorusGeometry(ISLAND + 0.15, 0.09, 6, 64), glowMat(0x19e3ff));
  kerb.rotation.x = Math.PI / 2; kerb.position.y = 0.55; scene.add(kerb);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 3.6, 16), tileMat("girih", 4, 1));
  base.position.y = 2.2; base.castShadow = true; scene.add(base);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.68, 2.68, 0.5, 16), glowMat(0x2aa8ff));
  band.position.y = 3.7; scene.add(band);
  const dome = ribDome(2.55, 16); dome.position.y = 3.95; scene.add(dome);
  finial(0, 3.95 + 2.55 * 1.38, 0, 1);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, x = Math.cos(a) * 5.7, z = Math.sin(a) * 5.7;
    if (k % 2 === 0) minaret(x, z, 7.5, 0.42, false); else addFlag(x, z, 6.4, a + Math.PI / 2, 1.6);
  }
  pools.push({ x: 0, z: 0, s: 24, c: "#1aa0c8" });
  // City boundary with a neon rail
  for (const [x, z, sx, sz] of [[0, -WALL, WALL * 2 + 2, 1.5], [0, WALL, WALL * 2 + 2, 1.5], [-WALL, 0, 1.5, WALL * 2], [WALL, 0, 1.5, WALL * 2]]) {
    box("wall", x, 0.7, z, sx, 1.4, sz, "#4a4658", true);
    box("neon", x, 1.48, z, sx > 2 ? sx : 0.2, 0.12, sz > 2 ? sz : 0.2, "#ff2e88");
  }
}

function buildBlock(cx, cz, i, j) {
  const kind = blockKind(cx, cz, i, j);
  const open = ["fuel", "wash", "repair", "garage", "tuning", "dealer", "parking", "arena"].includes(kind);
  box("pave", cx, 0.03, cz, 48, 0.06, 48, kind === "parking" || kind === "arena" ? "#1d1f26" : "#383640");
  if (!open) {
    for (let k = -18; k <= 18; k += 12)
      for (const [x, z] of [[cx + k, cz - 23.2], [cx + k, cz + 23.2], [cx - 23.2, cz + k], [cx + 23.2, cz + k]])
        if (!(kind === "registon" && z > cz + 20)) trees.push({ x, z, kind: R() < 0.55 ? "poplar" : "plane", h: 0.85 + R() * 0.35 });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lamps.push({ x: cx + sx * 23.3, z: cz + sz * 23.3 });

  if (kind === "apartments" && cx === 90 && cz === 90 && hasProp("minora_bino")) {
    // A modern tower instead of the two slabs: the city's new landmark.
    box("grass", cx, 0.07, cz, 40, 0.04, 40, "#2f4a2c");
    const P = ModelKit.prop("minora_bino"), sx = Math.min(1, 38 / P.size.x, 38 / P.size.z);
    PROP_SPOTS.minora_bino.push({ x: cx, z: cz, ry: 0, s: sx });
    addCol(cx, cz, (P.size.x * sx) / 2 - 1, (P.size.z * sx) / 2 - 1, P.size.y * sx);
    pools.push({ x: cx, z: cz + 20, s: 30, c: "#9fd8ff" }, { x: cx, z: cz - 20, s: 30, c: "#9fd8ff" });
    placeSign("TOSHKENT SITI", "#19e3ff", 14, 2.2, cx, 4.2, cz + 23.6, 0);
  } else if (kind === "apartments") {
    box("grass", cx, 0.07, cz, 40, 0.04, 40, "#2f4a2c");
    for (const dz of [-10.5, 10.5]) {
      const floors = 4 + Math.floor(R() * 6), h = floors * 3, bz = cz + dz, out = Math.sign(dz);
      box("bld", cx, h / 2, bz, 34, h, 11, pick(FACADES), true);
      box("roof", cx, h + 0.25, bz, 34.4, 0.5, 11.4, "#3d3a46");
      const nc = pick(NEON);
      box("neon", cx, h + 0.62, bz + out * 5.75, 34.4, 0.16, 0.16, nc);
      for (let f = 0; f < floors; f++) for (let w = 0; w < 9; w++) {
        const wx = cx - 14.4 + w * 3.6, wy = f * 3 + 1.7;
        for (const side of [-1, 1]) {
          const fz = bz + side * 5.5;
          if (R() < 0.42) box("winlit", wx, wy, fz + side * 0.03, 1.5, 1.6, 0.08, pick(WARM)); else box("win", wx, wy, fz + side * 0.03, 1.5, 1.6, 0.08);
          if (f > 0 && w % 2 === 1) box("balc", wx, wy - 0.85, fz + side * 0.6, 2.8, 1.0, 1.2, "#8f8a9a");
        }
      }
      for (const ex of [-10, 0, 10]) box("door", cx + ex, 1.2, bz - out * 5.55, 1.6, 2.4, 0.1, "#3a2a22");
      // street-facing shop fronts with neon signs
      for (const sx of [-9, 9]) {
        const c = pick(NEON);
        placeSign(pick(SHOPS), c, 9, 1.6, cx + sx, 3.25, bz + out * 5.62, out > 0 ? 0 : Math.PI);
        box("winlit", cx + sx, 1.3, bz + out * 5.56, 8, 2.0, 0.08, "#b08a50");
        pools.push({ x: cx + sx, z: bz + out * 8.5, s: 11, c });
      }
    }
  } else if (kind === "houses") {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const hx = cx + sx * 10, hz = cz + sz * 10;
      const bx = hx - sx * 2, bz = hz - sz * 2;
      if (hasProp("uy")) {
        placeHouse(bx, bz, sx > 0 ? -Math.PI / 2 : Math.PI / 2);   // front faces the gate
      } else {
        box("bld", bx, 2.6, bz, 9, 5.2, 9, pick(HOUSES), true);
        box("roof", bx, 5.35, bz, 9.8, 0.3, 9.8, "#5a3a2c");
        for (const w of [-2.2, 2.2]) box(R() < 0.7 ? "winlit" : "win", bx + w, 3, bz + sz * 4.53, 1.4, 1.4, 0.08, pick(WARM));
      }
      box("grass", hx, 0.07, hz, 19.6, 0.04, 19.6, "#33502e");
      const H = 2.4, T = 0.4, half = 10, wc = "#8f8676";
      box("wall", hx, H / 2, hz - half, 20, H, T, wc, true);
      box("wall", hx, H / 2, hz + half, 20, H, T, wc, true);
      box("wall", hx - sx * half, H / 2, hz, T, H, 20, wc, true);
      box("wall", hx + sx * half, H / 2, hz - 6, T, H, 7, wc, true);
      box("wall", hx + sx * half, H / 2, hz + 6, T, H, 7, wc, true);
      box("gate", hx + sx * half, 1.3, hz, 0.2, 2.6, 5, "#1f6fa8", true);
      box("neon", hx + sx * (half + 0.15), 2.75, hz, 0.12, 0.12, 5.2, "#ffc46b");
      pools.push({ x: hx + sx * (half + 2), z: hz, s: 8, c: "#ffb45a" });
    }
  } else if (kind === "bazaar") {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const x = cx + 4 + a * 9, z = cz + 4 + b * 9, ac = pick(AWN);
      box("prop", x, 0.5, z, 4, 1, 2, "#6b5238");
      addCol(x, z, 2.3, 1.45, 2.7);
      box("awn", x, 2.7, z, 4.6, 0.15, 3, ac);
      for (const [px, pz] of [[-2.1, -1.3], [2.1, -1.3], [-2.1, 1.3], [2.1, 1.3]]) box("prop", x + px, 1.35, z + pz, 0.12, 2.7, 0.12, "#5a4630");
      ["#e0482b", "#f1c232", "#6aa84f", "#e69138"].forEach((c, k) => box("prop", x - 1.4 + k * 0.95, 1.2, z, 0.7, 0.4, 0.9, c));
      for (let k = -2; k <= 2; k++) box("neon", x + k * 1.05, 2.55, z + 1.5, 0.16, 0.16, 0.16, k % 2 ? "#ffd58a" : "#ff8a5a");
      pools.push({ x, z: z + 1.5, s: 7, c: "#ffb45a" });
    }
    box("bld", 14, 3, 46, 14, 6, 14, "#b9ab8e", true);
    const d = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std({ color: 0x1cb5b0, roughness: 0.25, metalness: 0.3, emissive: 0x0b5d66, emissiveIntensity: 0.5 }));
    d.position.set(14, 6, 46); d.castShadow = true; scene.add(d);
    box("neon", 14, 6.1, 46, 14.3, 0.18, 14.3, "#19e3ff");
    placeSign("BOZOR", "#ffb020", 10, 2.2, 14, 4.2, 38.9, Math.PI);
  } else if (kind === "fuel") {
    box("canopy", 30, 5.4, -44, 16, 0.6, 13, "#e8e6e0");
    box("neon", 30, 5.0, -44, 16.3, 0.22, 13.3, "#ffb020");
    for (const [px, pz] of [[-7, -5.5], [7, -5.5], [-7, 5.5], [7, 5.5]]) box("prop", 30 + px, 2.5, -44 + pz, 0.5, 5, 0.5, "#8d8a94", true);
    for (const px of [24.5, 35.5]) { box("prop", px, 0.15, -44, 1.6, 0.3, 4, "#6a6670", true); box("prop", px, 1.0, -44, 0.9, 1.7, 0.7, "#e04b2c"); box("neon", px, 1.95, -44, 0.95, 0.14, 0.75, "#ffffff"); }
    box("bld", 30, 2, -18, 14, 4, 8, "#c9c6c0", true);
    box("winlit", 30, 1.6, -22.05, 10, 2.2, 0.08, "#8fa6ba");
    box("neon", 30, 4.3, -18, 14.6, 0.2, 8.6, "#ffb020");
    placeSign("YOQILGʻI · 24/7", "#ffb020", 10, 1.6, 30, 4.9, -50.7, Math.PI);
    pools.push({ x: 30, z: -44, s: 26, c: "#fff0c8" }, { x: 30, z: -24, s: 14, c: "#cfe8ff" });
  } else if (kind === "wash") {
    box("bld", -34.6, 2.5, 44, 0.6, 5, 12, "#9fb2bd", true);
    box("bld", -25.4, 2.5, 44, 0.6, 5, 12, "#9fb2bd", true);
    box("canopy", -30, 5.2, 44, 10, 0.4, 12.4, "#2a6f96");
    box("neon", -30, 4.95, 44, 10.2, 0.16, 12.6, "#4cc3ff");
    for (const z of [39, 44, 49]) box("neon", -30, 4.9, z, 8.6, 0.1, 0.1, "#bfe9ff");
    box("bld", -30, 1.6, 16, 12, 3.2, 7, "#b3aea4", true);
    placeSign("AVTOMOYKA", "#4cc3ff", 9, 1.6, -30, 5.9, 50.3, 0);
    pools.push({ x: -30, z: 44, s: 20, c: "#8fd6ff" });
  } else if (kind === "repair") {
    box("bld", 90, 3.5, 20, 22, 7, 14, "#7c7884", true);
    box("roof", 90, 7.2, 20, 22.6, 0.4, 14.6, "#7a2a20");
    box("winlit", 90, 2.6, 27.05, 8, 5.2, 0.1, "#8a5a34");
    box("neon", 90, 5.45, 27.1, 8.4, 0.16, 0.16, "#ff5a3c");
    for (const tx of [78, 102]) for (let k = 0; k < 3; k++) box("prop", tx, 0.35 + k * 0.5, 46, 1.2, 0.45, 1.2, "#16161a", k === 0);
    placeSign("USTAXONA", "#ff5a3c", 9, 1.7, 90, 6.2, 27.12, 0);
    pools.push({ x: 90, z: 36, s: 24, c: "#ffb08a" });
  } else if (kind === "garage") {
    box("bld", -30, 2.5, -24, 12, 5, 10, "#8d8778", true);
    box("roof", -30, 5.2, -24, 12.6, 0.4, 10.6, "#2f4d3a");
    box("door", -30, 2, -29.05, 7, 4, 0.1, "#1f6fa8");
    box("neon", -30, 4.2, -29.1, 7.4, 0.14, 0.14, "#5dff9b");
    placeSign("GARAJ", "#5dff9b", 6, 1.4, -30, 5.0, -29.12, Math.PI);
    pools.push({ x: -30, z: -38, s: 20, c: "#a8ffd0" });
  } else if (kind === "tuning") {
    box("bld", 90, 3.5, -18, 24, 7, 13, "#22222c", true);
    box("roof", 90, 7.15, -18, 24.6, 0.3, 13.6, "#15151c");
    box("winlit", 84, 2.4, -24.55, 8, 4.4, 0.1, "#7a3a62");
    box("winlit", 96, 2.4, -24.55, 8, 4.4, 0.1, "#2f6a80");
    for (const y of [5.2, 5.7, 6.2]) box("neon", 90, y, -24.6, 24.2, 0.12, 0.12, y === 5.7 ? "#19e3ff" : "#ff2e88");
    for (const x of [78, 102]) { box("neon", x, 3.5, -24.6, 0.14, 7, 0.14, "#ff2e88"); for (let k = 0; k < 4; k++) box("prop", x + (x < 90 ? -1 : 1) * 0.2, 0.3 + k * 0.45, -50, 1.3, 0.42, 1.3, "#16161a", k === 0); }
    placeSign("ZARB TYUNING", "#ff2e88", 13, 2, 90, 8.3, -24.4, Math.PI);
    box("prop", 90, 0.06, -44, 14, 0.04, 9, "#2a2330");
    for (const x of [83.2, 96.8]) box("neon", x, 0.1, -44, 0.14, 0.05, 9, "#ff2e88");
    pools.push({ x: 90, z: -40, s: 28, c: "#ff7ab8" }, { x: 90, z: -30, s: 16, c: "#7fe9ff" });
  } else if (kind === "dealer") {
    box("bld", -90, 3.2, 14, 26, 6.4, 12, "#30303c", true);
    box("roof", -90, 6.55, 14, 27, 0.3, 13, "#1a1a22");
    box("winlit", -90, 2.7, 20.05, 24, 4.6, 0.1, "#4a5f86");
    for (const x of [-98, -90, -82]) box("neon", x, 4.85, 20.12, 5, 0.1, 0.06, "#eaf2ff");
    box("neon", -90, 5.35, 20.1, 26.2, 0.16, 0.16, "#a25bff");
    placeSign("AVTOSALON", "#a25bff", 13, 2.1, -90, 7.8, 20.2, 0);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.35, 40), std({ color: 0x15151c, roughness: 0.25, metalness: 0.6 }));
    pod.position.set(PODIUM.x, 0.2, PODIUM.z); pod.receiveShadow = true; scene.add(pod);
    const pr = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.07, 6, 64), glowMat(0xa25bff)); pr.rotation.x = Math.PI / 2; pr.position.set(PODIUM.x, 0.4, PODIUM.z); scene.add(pr);
    circles.push({ x: PODIUM.x, z: PODIUM.z, r: 3.7 });
    DISPLAY.push({ x: -106, z: 30, h: 0.5, id: "sesto", paint: "#15171c" }, { x: -74, z: 30, h: -0.5, id: typeof ModelKit !== "undefined" && ModelKit.has("m4csl") ? "m4csl" : "bars", paint: "#15171c" });
    DISPLAY.forEach((d) => addCol(d.x, d.z, 1.9, 2.2, 1.5));
    pools.push({ x: -90, z: 31, s: 22, c: "#f2ecff" }, { x: -106, z: 30, s: 12, c: "#ffffff" }, { x: -74, z: 30, s: 12, c: "#ffffff" });
  } else if (kind === "parking") {
    // Two rows of bays; a booth; paint lines. Some bays are occupied by parked cars.
    for (const rz of [84, 100]) {
      for (let k = 0; k <= 12; k++) box("paint", 12 + k * 3, 0.075, rz, 0.12, 0.02, 5.4);
      box("paint", 30, 0.075, rz, 36, 0.02, 0.12);
      for (let k = 0; k < 12; k++) PARK_BAYS.push({ x: 13.5 + k * 3, z: rz, occupied: R() < 0.28, h: R() < 0.5 ? 0 : Math.PI });
    }
    PARK_BAYS.filter((b) => b.occupied).forEach((b) => addCol(b.x, b.z, 0.95, 2.2, 1.4));
    box("bld", 10.5, 1.4, 71, 3, 2.8, 3, "#2a2c38", true);
    box("winlit", 12.05, 1.7, 71, 0.08, 1.2, 2, "#dff6ff");
    box("neon", 10.5, 2.9, 71, 3.2, 0.14, 3.2, "#19e3ff");
    placeSign("P", "#19e3ff", 2.4, 2.4, 49, 5, 67.2, Math.PI);
    box("prop", 49, 2.5, 67.3, 0.2, 5, 0.2, "#5d6268", true);
    for (const x of [8, 52]) for (const z of [68, 112]) { /* corner kerbs */ box("prop", x, 0.2, z, 1.2, 0.4, 1.2, "#8d8a94", true); }
    pools.push({ x: 20, z: 92, s: 26, c: "#cfe8ff" }, { x: 40, z: 92, s: 26, c: "#cfe8ff" });
  } else if (kind === "mahalla") {
    // A mahalla of model houses: two rows of three facing the streets, a shared yard with trees and a tea bed.
    box("grass", cx, 0.07, cz, 40, 0.04, 40, "#33502e");
    for (const rz of [-1, 1]) for (const ox of [-14, 0, 14]) placeHouse(cx + ox, cz + rz * 11, rz > 0 ? 0 : Math.PI);
    for (const ox of [-7, 7]) trees.push({ x: cx + ox, z: cz, kind: "plane", h: 0.9 + R() * 0.3 });
    box("prop", cx, 0.45, cz, 3.2, 0.12, 2.2, "#7a5230", true);          // soʻri (tea bed)
    for (const [px, pz] of [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]]) box("prop", cx + px, 0.22, cz + pz, 0.12, 0.44, 0.12, "#5a3a22");
    box("awn", cx, 0.53, cz, 3.0, 0.06, 2.0, "#c8372d");                  // a rug on it
    pools.push({ x: cx, z: cz, s: 14, c: "#ffcf86" });
  } else if (kind === "registon") {
    buildRegistan(cx, cz);
  } else if (kind === "arena") {
    const A = ARENA, e = 22.6;
    // Tyre walls (red/white), open towards the road at z = -66.
    for (let k = -22; k <= 22; k += 2) {
      const c = (k / 2) % 2 ? "#d6d6d6" : "#c8281e";
      box("prop", A.x + k, 0.45, A.z - e, 2, 0.9, 0.9, c, true);
      if (Math.abs(k) > 8) box("prop", A.x + k, 0.45, A.z + e, 2, 0.9, 0.9, c, true);
      box("prop", A.x - e, 0.45, A.z + k, 0.9, 0.9, 2, c, true);
      box("prop", A.x + e, 0.45, A.z + k, 0.9, 0.9, 2, c, true);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { box("prop", A.x + sx * e, 3, A.z + sz * e, 0.4, 6, 0.4, "#2a2c38"); box("neon", A.x + sx * e, 6.2, A.z + sz * e, 0.9, 0.5, 0.9, "#ff7a1a"); pools.push({ x: A.x + sx * 12, z: A.z + sz * 12, s: 30, c: "#ffd2a8" }); }
    // Drift circles and a tyre island in the middle.
    for (const r of [7, 14]) { const rg = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r + 0.12, 64), std({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0.5 })); rg.rotation.x = -Math.PI / 2; rg.position.set(A.x, 0.08, A.z - 2); scene.add(rg); }
    for (let k = 0; k < 3; k++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.42, 16), std({ color: 0x16161a })); t.position.set(A.x, 0.25 + k * 0.44, A.z - 2); t.castShadow = true; scene.add(t); }
    circles.push({ x: A.x, z: A.z - 2, r: 1.15 });
    // Entrance arch
    box("prop", A.x - 8.6, 2.6, A.z + e, 0.5, 5.2, 0.5, "#2a2c38", true); box("prop", A.x + 8.6, 2.6, A.z + e, 0.5, 5.2, 0.5, "#2a2c38", true);
    box("neon", A.x, 5.3, A.z + e, 17.7, 0.3, 0.3, "#ff7a1a");
    placeSign("DRIFT MAYDONI", "#ff7a1a", 11, 1.7, A.x, 6.5, A.z + e, 0);
  }
}

function buildTreesLamps() {
  if (hasProp("zarang")) {
    // Every tree in the city is the real 3D tree; on “Past” quality every other one is left out to stay fast.
    const low = settings.quality === "low";
    trees.forEach((t, i) => {
      if (low && i % 2) return;
      PROP_SPOTS.zarang.push({ x: t.x, z: t.z, ry: R() * Math.PI * 2, s: (t.kind === "poplar" ? 0.75 : 0.85) + t.h * 0.3 });
      addCol(t.x, t.z, 0.35, 0.35, 3);
    });
    trees.length = 0;
    ModelKit.placeProps("zarang", PROP_SPOTS.zarang, { noShadow: settings.quality !== "high", noReceive: true, maxDist: { low: 45, mid: 80, high: 160 } });
  }
  const trunk = trees.map((t) => { const h = (t.kind === "poplar" ? 3 : 2.6) * t.h; return { x: t.x, y: h / 2, z: t.z, sx: 0.35, sy: h, sz: 0.35 }; });
  const pop = trees.filter((t) => t.kind === "poplar").map((t, i) => ({ x: t.x, y: 3 + 4.4 * t.h, z: t.z, sx: 1.5, sy: 6.5 * t.h, sz: 1.5, ry: i, c: i % 3 ? "#2c4a26" : "#35562a" }));
  const pla = trees.filter((t) => t.kind === "plane").map((t, i) => ({ x: t.x, y: 2.6 * t.h + 2.1, z: t.z, sx: 3.6 * t.h, sy: 2.8 * t.h, sz: 3.6 * t.h, ry: i, c: i % 2 ? "#3c5c2c" : "#456632" }));
  instanced(trunk, std({ color: 0x3f3024 }), { geo: new THREE.CylinderGeometry(0.5, 0.6, 1, 6), cast: true });
  const crown = new THREE.IcosahedronGeometry(0.5, 1);
  instanced(pop, std({ flatShading: true }), { geo: crown, cast: true });
  instanced(pla, std({ flatShading: true }), { geo: crown, cast: true });
  trees.forEach((t) => addCol(t.x, t.z, 0.3, 0.3, 2));
  const poles = [], heads = [], halos = [];
  lamps.forEach(({ x, z }, i) => {
    const dx = x > Math.round(x / 60) * 60 ? -1 : 1;    // arm reaches over the nearest road
    poles.push({ x, y: 3.5, z, sx: 0.18, sy: 7, sz: 0.18 }, { x: x + dx * 0.7, y: 7, z, sx: 1.5, sy: 0.12, sz: 0.12 });
    const c = i % 5 === 0 ? "#bfe6ff" : "#ffd9a0";
    heads.push({ x: x + dx * 1.3, y: 6.85, z, sx: 0.8, sy: 0.18, sz: 0.4, c });
    halos.push({ x: x + dx * 1.3, y: 6.8, z, c });
    pools.push({ x: x + dx * 1.3, z, s: 19, c: i % 5 === 0 ? "#9fd0ff" : "#ffbe78" });
    addCol(x, z, 0.15, 0.15, 2);
  });
  instanced(poles, std({ color: 0x2d3036, metalness: 0.6, roughness: 0.4 }), { cast: true });
  instanced(heads, glowMat(0xffffff));
  // Lamp halos (sprites batched into one Points cloud).
  const pg = new THREE.BufferGeometry(), pos = new Float32Array(halos.length * 3), pc = new Float32Array(halos.length * 3);
  halos.forEach((h, i) => { pos.set([h.x, h.y, h.z], i * 3); const c = col(h.c); pc.set([c.r, c.g, c.b], i * 3); });
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); pg.setAttribute("color", new THREE.BufferAttribute(pc, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ map: GLOW_TEX, size: 5.5, vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  pts.frustumCulled = false; scene.add(pts); HALOS = pts;
}

/* One model house, in one of the Uzbek style variants, with a girih tile band under the roof and a collider. */
let houseN = 0;
function placeHouse(x, z, ry) {
  const k = houseN++ % 3, id = hasProp("uy#" + k) ? "uy#" + k : "uy", P = ModelKit.prop(id);
  PROP_SPOTS[id].push({ x, z, ry, s: 1 });
  const sw = Math.abs(Math.sin(ry)) > 0.5;
  addCol(x, z, (sw ? P.size.z : P.size.x) / 2, (sw ? P.size.x : P.size.z) / 2, P.size.y);
  BANDS.push({ x, z, ry });
}
function buildBands() {
  const P = ModelKit.prop("uy"); if (!P || !BANDS.length) return;
  const wb = P.boxes.Walls || new THREE.Box3(new THREE.Vector3(-P.size.x / 2, 0, -P.size.z / 2), P.size.clone().multiplyScalar(0.5));
  const c = wb.getCenter(new THREE.Vector3()), sz = wb.getSize(new THREE.Vector3()), y = wb.max.y - 0.55, H = 0.42, T = 0.05;
  const sides = [[sz.x + 2 * T, 0, sz.z / 2 + T / 2], [sz.x + 2 * T, Math.PI, sz.z / 2 + T / 2], [sz.z, Math.PI / 2, sz.x / 2 + T / 2], [sz.z, -Math.PI / 2, sz.x / 2 + T / 2]];
  const o = new THREE.Object3D(), inner = new THREE.Object3D();
  for (const [len, rot, off] of sides) {
    const geo = new THREE.BoxGeometry(len, H, T), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / (H * 1.6));        // square tiles along the band
    const im = new THREE.InstancedMesh(geo, tileMat("girih", 1, 1, { emissiveIntensity: 0.35 }), BANDS.length);
    BANDS.forEach((b, i) => {
      o.position.set(b.x, 0, b.z); o.rotation.set(0, b.ry, 0); o.updateMatrix();
      inner.position.set(c.x + Math.sin(rot) * off, y, c.z + Math.cos(rot) * off); inner.rotation.set(0, rot, 0); inner.updateMatrix();
      im.setMatrixAt(i, o.matrix.clone().multiply(inner.matrix));
    });
    scene.add(im);
  }
}
function flushBatches() {
  for (const id of ["uy", "uy#0", "uy#1", "uy#2", "minora_bino"]) if (PROP_SPOTS[id].length) ModelKit.placeProps(id, PROP_SPOTS[id]);

  const M = {
    road: [std({ color: 0x17191f, roughness: 0.45, metalness: 0.25, envMapIntensity: 0.7 }), { receive: true }],
    paint: [std({ color: 0xd8d6cc, roughness: 0.6, emissive: 0x3a3a36 }), {}],
    edge: [std({ color: 0xffb020, roughness: 0.6, emissive: 0x4a3008 }), {}],
    pave: [std({ roughness: 0.75, metalness: 0.05 }), { receive: true }],
    grass: [std({}), { receive: true }],
    bld: [std({ roughness: 0.85 }), { cast: true, receive: true }],
    roof: [std({}), { cast: true }],
    win: [std({ color: 0x141c28, roughness: 0.12, metalness: 0.7 }), {}],
    winlit: [new THREE.MeshBasicMaterial({}), {}],
    neon: [new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }), {}],
    balc: [std({}), { cast: true }],
    door: [std({ roughness: 0.6 }), {}],
    wall: [std({}), { cast: true, receive: true }],
    gate: [std({ metalness: 0.4, roughness: 0.45 }), { cast: true }],
    prop: [std({}), { cast: true }],
    awn: [std({}), { cast: true }],
    canopy: [std({}), { cast: true }],
  };
  for (const k in batches) instanced(batches[k], M[k][0], M[k][1]);
  // Light pools: additive decals that fake the street lighting on the wet ground.
  const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
  POOLS = instanced(pools.map((p) => ({ x: p.x, y: 0.09, z: p.z, sx: p.s, sy: 1, sz: p.s, c: p.c })),
    new THREE.MeshBasicMaterial({ map: GLOW_TEX, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }), { geo: flat, order: 2 });
}


/* ================= Oʻzbekcha meʼmorchilik: koshin tiles, ribbed domes, minarets, peshtoq portals, flags ================= */
const TILE = {};
function tileTex(kind) {
  if (TILE[kind]) return TILE[kind];
  const star = (g, cx, cy, r, c) => { g.fillStyle = c; g.beginPath(); for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, rr = i % 2 ? r * 0.62 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  const t = canvasTex(256, 256, (g, W, H) => {
    if (kind === "dome") {            // turquoise glaze with a dark diamond lattice
      g.fillStyle = "#1db3aa"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "#0b6670"; g.lineWidth = 7;
      for (let k = -W; k <= W * 2; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke(); g.beginPath(); g.moveTo(k, H); g.lineTo(k + H, 0); g.stroke(); }
      g.fillStyle = "#eaf7f3"; for (let x = 0; x < W; x += 64) for (let y = 0; y < H; y += 64) { g.beginPath(); g.arc(x + 32, y, 5, 0, 7); g.fill(); g.beginPath(); g.arc(x, y + 32, 5, 0, 7); g.fill(); }
    } else if (kind === "girih") {    // lapis tiles with eight-point stars
      g.fillStyle = "#1d3f9e"; g.fillRect(0, 0, W, H);
      for (const [x, y] of [[64, 64], [192, 64], [64, 192], [192, 192]]) { star(g, x, y, 50, "#1cc6b8"); star(g, x, y, 31, "#f2e8cf"); star(g, x, y, 14, "#f2b33d"); }
      for (let x = 0; x <= W; x += 128) for (let y = 0; y <= H; y += 128) star(g, x, y, 22, "#0f2463");
    } else if (kind === "brick") {    // fired brick with turquoise inlays
      g.fillStyle = "#7d5a3a"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#b8895a"; for (let y = 0; y < H; y += 16) for (let x = ((y / 16) % 2) * 16 - 16; x < W; x += 32) g.fillRect(x + 1, y + 1, 30, 14);
      g.fillStyle = "#1cc6b8"; for (let y = 24; y < H; y += 64) for (let x = 24; x < W; x += 64) { g.save(); g.translate(x + 8, y + 8); g.rotate(Math.PI / 4); g.fillRect(-7, -7, 14, 14); g.restore(); }
    } else if (kind === "minaret") {  // brick shaft with glazed bands
      g.fillStyle = "#b8895a"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#8f6640"; for (let y = 0; y < H; y += 12) for (let x = ((y / 12) % 2) * 12; x < W; x += 24) g.fillRect(x, y, 2, 12);
      g.fillStyle = "#1d3f9e"; g.fillRect(0, 96, W, 64);
      for (let x = 16; x < W; x += 32) star(g, x, 128, 14, "#1cc6b8");
      g.fillStyle = "#1cc6b8"; g.fillRect(0, 90, W, 6); g.fillRect(0, 160, W, 6);
    } else if (kind === "arcade") {   // two arched niches per tile
      g.fillStyle = "#b8895a"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#1d3f9e"; g.fillRect(0, 0, W, 34);
      for (let x = 8; x < W; x += 24) star(g, x, 17, 10, "#1cc6b8");
      for (const x0 of [24, 152]) {
        g.fillStyle = "#f2e8cf"; arch(g, x0 - 6, 236, 92, 172); g.fill();
        g.fillStyle = "#0b1a3c"; arch(g, x0, 236, 80, 160); g.fill();
        g.fillStyle = "rgba(255,190,110,0.75)"; g.fillRect(x0 + 26, 176, 28, 60);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; TILE[kind] = t; return t;
}
/* Pointed (four-centred) arch path: x,y = bottom-left, w, h. */
function arch(g, x, y, w, h) {
  const sh = h - w * 0.62;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - sh);
  g.quadraticCurveTo(x, y - h + w * 0.12, x + w / 2, y - h);
  g.quadraticCurveTo(x + w, y - h + w * 0.12, x + w, y - sh);
  g.lineTo(x + w, y); g.closePath();
}
function tileMat(kind, rx, ry, extra) {
  const t = tileTex(kind).clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
  return std(Object.assign({ map: t, color: 0xffffff, roughness: 0.55, emissive: 0x2a2a30, emissiveMap: t, emissiveIntensity: 0.55 }, extra || {}));
}
let PORTAL_MAT = null;
function portalMat() {
  if (PORTAL_MAT) return PORTAL_MAT;
  const tex = canvasTex(512, 640, (g, W, H) => {
    g.fillStyle = g.createPattern(tileTex("girih").image, "repeat"); g.save(); g.scale(0.5, 0.5); g.fillRect(0, 0, W * 2, H * 2); g.restore();
    // vine-scroll band along the top (islimi)
    g.fillStyle = "#0f2463"; g.fillRect(22, 22, W - 44, 70);
    g.strokeStyle = "#f2e8cf"; g.lineWidth = 4;
    for (let x = 40; x < W - 40; x += 46) { g.beginPath(); g.arc(x, 57, 15, Math.PI * 0.2, Math.PI * 1.7); g.stroke(); g.beginPath(); g.arc(x + 23, 57, 9, Math.PI * 1.2, Math.PI * 2.6); g.stroke(); }
    g.strokeStyle = "#f2b33d"; g.lineWidth = 5; g.strokeRect(22, 22, W - 44, 70);
    // the great arch
    g.fillStyle = "#f2e8cf"; arch(g, 82, H, W - 164, H - 118); g.fill();
    g.fillStyle = "#1cc6b8"; arch(g, 92, H, W - 184, H - 132); g.fill();
    const gr = g.createLinearGradient(0, 140, 0, H); gr.addColorStop(0, "#071230"); gr.addColorStop(1, "#14244f");
    g.fillStyle = gr; arch(g, 104, H, W - 208, H - 148); g.fill();
    // muqarnas: little cells in the arch head
    g.save(); arch(g, 104, H, W - 208, H - 148); g.clip();
    for (let row = 0; row < 6; row++) for (let k = 0; k < 9; k++) {
      const x = 118 + k * 34 + (row % 2) * 17, y = 168 + row * 30;
      g.strokeStyle = row % 2 ? "#1cc6b8" : "#f2b33d"; g.lineWidth = 2.5; arch(g, x, y + 26, 26, 26); g.stroke();
    }
    g.restore();
    // lit doorway
    g.fillStyle = "#3a2414"; arch(g, 196, H, 120, 190); g.fill();
    g.fillStyle = "rgba(255,196,110,0.95)"; arch(g, 206, H, 100, 172); g.fill();
    g.strokeStyle = "#f2b33d"; g.lineWidth = 6; arch(g, 82, H, W - 164, H - 118); g.stroke();
    // spandrel rosettes
    for (const x of [62, W - 62]) { g.fillStyle = "#f2b33d"; g.beginPath(); g.arc(x, 150, 26, 0, 7); g.fill(); g.fillStyle = "#1cc6b8"; g.beginPath(); g.arc(x, 150, 14, 0, 7); g.fill(); }
  });
  PORTAL_MAT = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color(1, 1, 1), emissiveMap: tex, emissiveIntensity: 0.42, roughness: 0.6 });
  return PORTAL_MAT;
}
/* Melon-ribbed onion dome (Goʻri Amir style). Origin at the dome base. */
function ribDome(r, ribs, kind) {
  const geo = new THREE.SphereGeometry(r, 64, 22, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / r, a = Math.atan2(z, x);
    const k = (1 + 0.2 * Math.sin(Math.PI * t) * (1 - t)) * (1 + 0.05 * Math.pow(Math.abs(Math.cos((a * ribs) / 2)), 0.6) * Math.sqrt(Math.max(0, 1 - t * t)));
    p.setXYZ(i, x * k, y * 1.38, z * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, tileMat(kind || "dome", ribs / 2, 2, { roughness: 0.3, metalness: 0.15, emissive: 0x0a4a50, emissiveIntensity: 0.6 }));
  m.castShadow = true; return m;
}
const GOLD = () => std({ color: 0xe7b341, metalness: 1, roughness: 0.25, emissive: 0x4a3008 });
function finial(x, y, z, s) {
  const m = GOLD();
  for (const [r, dy] of [[0.16, 0.12], [0.24, 0.45], [0.13, 0.82]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(r * s, 12, 8), m); b.position.set(x, y + dy * s, z); scene.add(b); }
  const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06 * s, 0.55 * s, 8), m); sp.position.set(x, y + 1.15 * s, z); scene.add(sp);
}
function minaret(x, z, h, r, solid) {
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, h, 20), tileMat("minaret", 3, h / 6));
  shaft.position.set(x, h / 2, z); shaft.castShadow = true; scene.add(shaft);
  const gal = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 0.85, r * 0.9, 20), tileMat("girih", 3, 0.5));
  gal.position.set(x, h + r * 0.4, z); scene.add(gal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.36, 0.05, 6, 32), glowMat(0xf2b33d)); ring.rotation.x = Math.PI / 2; ring.position.set(x, h + r * 0.86, z); scene.add(ring);
  const lan = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, r * 1.1, 12), new THREE.MeshBasicMaterial({ color: col(0xffc46b), toneMapped: false }));
  lan.position.set(x, h + r * 1.4, z); scene.add(lan);
  const d = ribDome(r * 0.95, 12); d.position.set(x, h + r * 1.95, z); scene.add(d);
  finial(x, h + r * 1.95 + r * 1.3, z, r * 0.9);
  pools.push({ x, z, s: 6 + r * 4, c: "#ffc46b" });
  if (solid !== false) addCol(x, z, r, r, h);
}
/* Oʻzbekiston bayrogʻi — blue / white / green with thin red fimbriations, crescent and 12 stars. */
let FLAG_MAT = null;
const flags = [];
function addFlag(x, z, h, ry, size) {
  if (!FLAG_MAT) FLAG_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: canvasTex(256, 128, (g, W, H) => {
    g.fillStyle = "#0099b5"; g.fillRect(0, 0, W, H / 3); g.fillStyle = "#ffffff"; g.fillRect(0, H / 3, W, H / 3);
    g.fillStyle = "#1eb53a"; g.fillRect(0, (2 * H) / 3, W, H / 3);
    g.fillStyle = "#ce1126"; g.fillRect(0, H / 3 - 2, W, 4); g.fillRect(0, (2 * H) / 3 - 2, W, 4);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(30, 21, 14, 0, 7); g.fill(); g.fillStyle = "#0099b5"; g.beginPath(); g.arc(35, 21, 12, 0, 7); g.fill();
    g.fillStyle = "#ffffff"; const rows = [[3], [4], [5]];
    let n = 0; [5, 4, 3].forEach((cnt, row) => { for (let i = 0; i < cnt; i++) { g.beginPath(); g.arc(102 - i * 13, 8 + row * 13, 2.6, 0, 7); g.fill(); n++; } });
  }) });
  FLAG_MAT.color.setScalar(0.78);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 8), std({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 }));
  pole.position.set(x, h / 2, z); scene.add(pole);
  const s = size || 1.6, geo = new THREE.PlaneGeometry(s, s / 2, 14, 4); geo.translate(s / 2, 0, 0);
  const m = new THREE.Mesh(geo, FLAG_MAT); m.position.set(x, h - s / 4 - 0.05, z); m.rotation.y = ry; scene.add(m);
  flags.push({ m, base: geo.attributes.position.array.slice(), ph: x * 0.37 + z * 0.21 });
  addCol(x, z, 0.12, 0.12, h);
}
/* Called every frame by the game: flags ripple in the night wind. */
function worldTick(t) {
  for (const f of flags) {
    const a = f.m.geometry.attributes.position, b = f.base;
    for (let i = 0; i < a.count; i++) { const x = b[i * 3]; a.array[i * 3 + 2] = Math.sin(x * 3.2 - t * 5.5 + f.ph) * 0.12 * x + Math.sin(t * 2.1 + f.ph) * 0.03 * x; }
    a.needsUpdate = true;
  }
}
/* World transform helpers for rotated layouts: local (lx, lz) around (ox, oz) turned by ry. */
const rot = (ox, oz, ry, lx, lz) => ({ x: ox + lx * Math.cos(ry) + lz * Math.sin(ry), z: oz - lx * Math.sin(ry) + lz * Math.cos(ry) });
function rotCol(ox, oz, ry, lx, lz, hx, hz, top) { const p = rot(ox, oz, ry, lx, lz), sw = Math.abs(Math.sin(ry)) > 0.5; addCol(p.x, p.z, sw ? hz : hx, sw ? hx : hz, top); }
/* One madrasa: a peshtoq portal, arcaded wings, two corner minarets and ribbed domes behind. */
function madrasa(ox, oz, ry, width, domes) {
  const g = new THREE.Group(); g.position.set(ox, 0, oz); g.rotation.y = ry; scene.add(g);
  const pw = 13, ph = 15, pd = 3, L = (width - pw) / 2;
  const brick = tileMat("brick", 3, 3);
  const portal = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), [brick, brick, brick, brick, portalMat(), brick]);
  portal.position.set(0, ph / 2, 0); portal.castShadow = true; portal.receiveShadow = true; g.add(portal);
  rotCol(ox, oz, ry, 0, 0, pw / 2, pd / 2, ph);
  const gl = glowMat(0xf2b33d);
  for (const [x, y, sx, sy] of [[-pw / 2, ph / 2, 0.14, ph], [pw / 2, ph / 2, 0.14, ph], [0, ph, pw, 0.14]]) { const e = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.14), gl); e.position.set(x, y, pd / 2 + 0.05); g.add(e); }
  for (const s of [-1, 1]) {
    const wx = s * (pw / 2 + L / 2), arc = tileMat("arcade", L / 6, 1);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(L, 7, 4), [brick, brick, brick, brick, arc, brick]);
    wing.position.set(wx, 3.5, -0.6); wing.castShadow = true; wing.receiveShadow = true; g.add(wing);
    const top = new THREE.Mesh(new THREE.BoxGeometry(L, 0.5, 4.2), tileMat("girih", L / 3, 0.25)); top.position.set(wx, 7.25, -0.6); g.add(top);
    rotCol(ox, oz, ry, wx, -0.6, L / 2, 2, 7);
    const mp = rot(ox, oz, ry, s * (pw / 2 + L + 0.2), 0.6); minaret(mp.x, mp.z, 17, 0.85);
  }
  (domes || []).forEach((dx) => {
    const p = rot(ox, oz, ry, dx, -5);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.1, 4, 24), tileMat("girih", 6, 1)); drum.position.set(p.x, 9, p.z); drum.castShadow = true; scene.add(drum);
    const d = ribDome(3, 18); d.position.set(p.x, 11, p.z); scene.add(d); finial(p.x, 11 + 3 * 1.38, p.z, 1.6);
  });
  const f = rot(ox, oz, ry, 0, 6); pools.push({ x: f.x, z: f.z, s: 18, c: "#ffcf86" });
}
function buildRegistan(cx, cz) {
  box("pave", cx, 0.075, cz + 2, 46, 0.02, 44, "#4a4236");
  madrasa(cx, cz - 16.5, 0, 38, [-9, 9]);              // back: two domes
  madrasa(cx - 16.5, cz + 5, Math.PI / 2, 28, [7]);     // left, facing the courtyard
  madrasa(cx + 16.5, cz + 5, -Math.PI / 2, 28, [-7]);   // right, mirrored
  const star = new THREE.Mesh(new THREE.CircleGeometry(5, 8), tileMat("girih", 2, 2, { emissiveIntensity: 0.7 }));
  star.rotation.x = -Math.PI / 2; star.position.set(cx, 0.09, cz + 4); scene.add(star);
  const ring = new THREE.Mesh(new THREE.RingGeometry(5, 5.25, 8), glowMat(0xf2b33d)); ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.1, cz + 4); scene.add(ring);
  for (const s of [-1, 1]) { box("prop", cx + s * 6.5, 3, cz + 24.4, 0.3, 6, 0.3, "#2a2c38", true); addFlag(cx + s * 9.5, cz + 23, 7.5, s > 0 ? Math.PI : 0, 1.8); }
  placeSign("REGISTON", "#1cc6b8", 12, 1.9, cx, 5.4, cz + 24.6, 0);
  pools.push({ x: cx, z: cz + 4, s: 22, c: "#9fe8ff" }, { x: cx, z: cz + 27, s: 16, c: "#ffcf86" });
}

/* Service markers: glowing ground ring and floating label */
const markers = [];
function buildServiceMarkers() {
  SERVICES.forEach((s) => {
    const g = new THREE.Group(); g.position.set(s.x, 0, s.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.4, s.r, 48), new THREE.MeshBasicMaterial({ color: col(s.color), transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.11; g.add(ring);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(s.r - 0.4, 48), new THREE.MeshBasicMaterial({ color: col(s.color), transparent: true, opacity: 0.1, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.y = 0.105; g.add(fill);
    const lbl = makeLabel(s.short, s.color); lbl.position.y = 7.6; g.add(lbl);
    scene.add(g); markers.push({ s, ring, lbl });
  });
}
