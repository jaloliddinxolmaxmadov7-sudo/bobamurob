/* UZ AUTO LIFE — city life: pedestrians, traffic, parked and showroom cars. */
"use strict";

/* ================= Pedestrians ================= */
const pedMats = {};
const pm = (c) => pedMats[c] || (pedMats[c] = std({ color: c, roughness: 0.8 }));
const PED_GEO = {
  torso: new THREE.BoxGeometry(0.42, 0.6, 0.24), head: new THREE.SphereGeometry(0.135, 10, 8), cap: new THREE.CylinderGeometry(0.125, 0.135, 0.08, 10),
  leg: new THREE.BoxGeometry(0.15, 0.8, 0.17), arm: new THREE.BoxGeometry(0.11, 0.58, 0.12), skirt: new THREE.CylinderGeometry(0.2, 0.33, 0.62, 10),
};
PED_GEO.leg.translate(0, -0.4, 0); PED_GEO.arm.translate(0, -0.26, 0);
const SKIN = ["#e0b08a", "#c98f66", "#f0c8a4", "#b87a52"];
const SHIRT = ["#1e63d8", "#d8202a", "#f2f2f2", "#19c2a8", "#f2b619", "#7a2be0", "#2c2f38", "#ff6a1f", "#3f8f3a", "#ff3d9a"];
const PANTS = ["#23283a", "#3a3f4c", "#1b1b20", "#4a3a2a", "#2a3f5c"];
function makePed(seed) {
  const r = rng(seed * 977 + 13), pk = (a) => a[Math.floor(r() * a.length)];
  const g = new THREE.Group(), skin = pm(pk(SKIN)), shirt = pm(pk(SHIRT)), pants = pm(pk(PANTS)), woman = r() < 0.32;
  // A real 3D person when the model kit has one of this gender; otherwise the simple built-in figure.
  const real = typeof ModelKit !== "undefined" && ModelKit.makePerson(seed, woman ? "f" : "m");
  if (real) return real;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(PED_GEO.torso, shirt, 0, 1.12, 0);
  add(PED_GEO.head, skin, 0, 1.58, 0);
  if (woman) { add(PED_GEO.skirt, shirt, 0, 0.72, 0); add(PED_GEO.cap, pm(pk(["#c8372d", "#f2f2f2", "#e8b021", "#19c2a8"])), 0, 1.66, -0.02).scale.set(1.15, 1.6, 1.15); }
  else if (r() < 0.5) add(PED_GEO.cap, pm(r() < 0.6 ? "#15171c" : "#f2f2f2"), 0, 1.71, 0);     // doʻppi
  const legs = [add(PED_GEO.leg, pants, -0.11, 0.8, 0), add(PED_GEO.leg, pants, 0.11, 0.8, 0)];
  const arms = [add(PED_GEO.arm, shirt, -0.27, 1.4, 0), add(PED_GEO.arm, shirt, 0.27, 1.4, 0)];
  const s = 0.94 + r() * 0.14; g.scale.set(s, s, s);
  return { g, legs, arms, phase: r() * 6 };
}
function animPed(p, walk, t) {
  const a = Math.sin(t) * 0.6 * walk;
  p.legs[0].rotation.x = a; p.legs[1].rotation.x = -a; p.arms[0].rotation.x = -a * 0.8; p.arms[1].rotation.x = a * 0.8;
}

const peds = [];
function rectPoint(rc, s) {
  const w = rc.x1 - rc.x0, d = rc.z1 - rc.z0, per = 2 * (w + d);
  s = ((s % per) + per) % per;
  if (s < w) return { x: rc.x0 + s, z: rc.z0, hx: 1, hz: 0 };
  s -= w; if (s < d) return { x: rc.x1, z: rc.z0 + s, hx: 0, hz: 1 };
  s -= d; if (s < w) return { x: rc.x1 - s, z: rc.z1, hx: -1, hz: 0 };
  s -= w; return { x: rc.x0, z: rc.z1 - s, hx: 0, hz: -1 };
}
function buildPeds() {
  const E = 21.8, loops = [];
  BLOCKS.forEach((cx, i) => BLOCKS.forEach((cz, j) => { if (blockKind(cx, cz, i, j) !== "arena") loops.push({ x0: cx - E, z0: cz - E, x1: cx + E, z1: cz + E, n: blockKind(cx, cz, i, j) === "bazaar" ? 3 : 1 }); }));
  // Two-block loops: these cross the road on the zebra crossings.
  for (const [ax, az, bx, bz] of [[-90, 90, -30, 90], [90, 30, 90, 90], [30, -90, 90, -90], [-90, -30, -90, 30], [-30, 90, -30, 30], [90, -90, 90, -30]])
    loops.push({ x0: Math.min(ax, bx) - E, z0: Math.min(az, bz) - E, x1: Math.max(ax, bx) + E, z1: Math.max(az, bz) + E, n: 2 });
  let seed = 1;
  for (const rc of loops) for (let k = 0; k < rc.n; k++) {
    const p = makePed(seed++), r = rng(seed * 31);
    Object.assign(p, { rc, s: r() * 400, dir: r() < 0.5 ? 1 : -1, speed: 1.05 + r() * 0.6, ox: 0, oz: 0, dodge: 0, dvx: 0, dvz: 0, x: 0, z: 0, scared: 0 });
    scene.add(p.g); peds.push(p);
  }
}
let onPedScare = null;        // set by the game: (ped, dist, speed)

/* ================= Character: what a 3D pedestrian feels like doing =================
   Most of the time they walk. Now and then they stop and do something — greet with a bow, talk on the phone-style
   gestures, think, shrug, stretch, yawn, dance… — never the same thing twice in a row. They react to the player:
   a horn gets a remark, a siren makes them stop and watch, a near miss makes them jump and complain, and a hit
   knocks them down; they lie there groaning, get up and give the driver a piece of their mind. */
const SAY = {
  hit: ["Voy, oyogʻim!", "Ey, asabga tegma!", "Koʻzingga qara, haydovchi!", "Voy-dod, odam bosdi!", "Sekinroq hayda-a!", "YPXga aytaman!", "Uyat senga!", "Voy belim…"],
  hurt: ["Voy-voy…", "Ohh…", "Tez yordam chaqiringlar…", "Oyogʻim…"],
  up: ["Ey, toʻxta!", "Haydovchilik guvohnomangni kim berdi?!", "Bu yer piyodalar yoʻli!", "Shuncha joy turib-a…", "Hozir koʻrsataman senga!"],
  scare: ["Ey-ey-ey!", "Voy, onajon!", "Sekin!", "Koʻrmayapsanmi?!"],
  horn: ["Signal chalma!", "Shoshma, aka!", "Nima gap?", "Eshitdim, eshitdim…", "Qulogʻim bitdi-ku!"],
  siren: ["Nima boʻldi ekan?", "Politsiya!", "Kimni quvlayapti?"],
  greet: ["Assalomu alaykum!", "Yaxshimisiz?", "Qalaysiz, aka?", "Ishlar joyidami?", "Oilangiz tinchmi?"],
  chat: ["Bozorda narx oshibdi…", "Toʻyga borasizmi?", "Osh tayyor ekan!", "Bugun havo zoʻr.", "Ertaga Chorsuga boramiz.", "Choy ichamizmi?", "Mashinangiz chiroyli ekan!"],
  dance: ["Lazgi!", "Hay-hay!", "Raqsga tushamiz!"],
  yawn: ["Uyqum keldi…"], think: ["Hmm…"], shrug: ["Bilmasam…"], cheer: ["Zoʻr!", "Ura!"], wave: ["Hey!", "Salom!"],
};
const pickSay = (k) => { const a = SAY[k]; return a ? a[Math.floor(Math.random() * a.length)] : ""; };
/* Speech bubbles: canvas sprites that float above a head and fade. */
const bubbleTex = {};
function say(p, text, secs, color) {
  if (!text || !p.g) return;
  const key = text + (color || "");
  if (!bubbleTex[key]) bubbleTex[key] = canvasTex(1024, 128, (g, W, H) => {
    g.font = "700 42px 'Chakra Petch', Manrope, sans-serif";
    const w = Math.min(W - 16, g.measureText(text).width + 52), x = (W - w) / 2;
    g.fillStyle = "rgba(255,255,255,0.96)"; g.strokeStyle = color || "#1d2440"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(x + 22, 10); g.lineTo(x + w - 22, 10); g.quadraticCurveTo(x + w, 10, x + w, 32); g.lineTo(x + w, 74); g.quadraticCurveTo(x + w, 96, x + w - 22, 96);
    g.lineTo(W / 2 + 14, 96); g.lineTo(W / 2, 120); g.lineTo(W / 2 - 14, 96); g.lineTo(x + 22, 96); g.quadraticCurveTo(x, 96, x, 74); g.lineTo(x, 32); g.quadraticCurveTo(x, 10, x + 22, 10); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = color || "#1d2440"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, W / 2, 54);
  });
  if (!p.bubble) {
    p.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, depthTest: false, transparent: true, fog: false }));
    p.bubble.scale.set(5.2, 0.65, 1); p.bubble.renderOrder = 20; p.g.add(p.bubble);
  }
  p.bubble.material.map = bubbleTex[key]; p.bubble.material.needsUpdate = true; p.bubble.material.opacity = 1;
  p.bubble.visible = true; p.bubbleT = secs || 2.5;
}
function bubbleTick(p, dt) {
  if (!p.bubble || !p.bubble.visible) return;
  p.bubbleT -= dt;
  const lying = p.down ? 0.9 : 0;
  p.bubble.position.set(0, (p.down ? 1.1 : 2.15) / Math.max(0.5, p.g.scale.y), lying);
  p.bubble.material.opacity = Math.min(1, p.bubbleT * 2);
  if (p.bubbleT <= 0) p.bubble.visible = false;
}

/* What each emote looks like: which clip, how long, what they say, mouth/smile. */
const EMOTE = {
  look: { w: 14, secs: [2.5, 5] }, look2: { w: 8, secs: [3, 5] },
  bow: { w: 7, secs: [2.6, 3.2], say: "greet", smile: 0.7 },
  wave: { w: 7, secs: [2.4, 3.4], say: "wave", smile: 1, face: "car" },
  talk: { w: 10, secs: [4, 7], say: "chat", talk: 1, smile: 0.4 }, talk2: { w: 7, secs: [4, 7], say: "chat", talk: 1 }, talk3: { w: 6, secs: [4, 6], say: "chat", talk: 1, smile: 0.3 },
  agree: { w: 8, secs: [3, 5], talk: 1, smile: 0.5 }, shake: { w: 4, secs: [2, 3.5], talk: 1 },
  think: { w: 6, secs: [3, 5], say: "think" }, shrug: { w: 5, secs: [2, 3], say: "shrug" },
  stretch: { w: 4, secs: [3, 4] }, yawn: { w: 4, secs: [2.5, 3.5], say: "yawn" },
  flex: { w: 2, secs: [2.5, 3.5], smile: 1 }, cheer: { w: 3, secs: [2, 3], say: "cheer", smile: 1 },
  point: { w: 3, secs: [2, 3] }, crossed: { w: 4, secs: [3, 5] }, facepalm: { w: 2, secs: [2, 3] },
  sad: { w: 2, secs: [3, 5] },
  dance: { w: 3, secs: [5, 8], say: "dance", smile: 1 }, dance2: { w: 2, secs: [5, 8], say: "dance", smile: 1 }, dance3: { w: 2, secs: [5, 8], smile: 1 },
  samba: { w: 4, secs: [5, 8], say: "dance", smile: 1 },
  idle: { w: 6, secs: [2, 4] },
};
function pickEmote(p) {
  const opts = Object.keys(EMOTE).filter((k) => p.act[k] || (k === "wave" && p.act.idle));
  let tot = 0; for (const k of opts) if (k !== p.lastEmote) tot += EMOTE[k].w;
  let n = Math.random() * tot;
  for (const k of opts) { if (k === p.lastEmote) continue; if ((n -= EMOTE[k].w) < 0) return k; }
  return "idle";
}
function startEmote(p, emote, secs, faceYaw, line) {
  const E = EMOTE[emote] || {};
  p.hold = secs != null ? secs : E.secs ? E.secs[0] + Math.random() * (E.secs[1] - E.secs[0]) : 3;
  p.emote = emote; p.lastEmote = emote; p.face = faceYaw == null ? null : faceYaw;
  p.mood.talk = E.talk || 0; p.mood.smile = E.smile || 0;
  p.waving = emote === "wave" && !p.act.wave;
  const text = line != null ? line : E.say && Math.random() < 0.75 ? pickSay(E.say) : "";
  if (text) say(p, text, Math.min(3.5, p.hold));
}
const clipFor = (p, e) => (e === "wave" && !p.act.wave ? "idle" : p.act[e] ? e : "idle");
/* Knocked down by the car: thrown along the car's motion, tumble, lie, get up. */
function knockDown(p, vx, vz, speed) {
  p.down = { t: 0, lie: Math.min(9, 2.2 + speed * 0.28), vx: vx * 0.7, vz: vz * 0.7, vy: 2.2 + speed * 0.12, y: 0, phase: "fly", hurt: speed > 13 };
  p.hold = 0; p.dodge = 0; p.waving = false; p.mood.talk = 1; p.mood.smile = 0;
  p.face = Math.atan2(-vx, -vz);              // turned toward the car, so the fall goes backwards
  say(p, pickSay("hit"), 2.4, "#c62828");
}
/* Runs while a pedestrian is down; returns the clip to play. */
function downTick(p, dt) {
  const D = p.down; D.t += dt;
  const g = p.g; g.rotation.order = "YXZ";
  if (D.phase === "fly") {
    p.ox += D.vx * dt; p.oz += D.vz * dt; D.vx *= 1 - dt * 1.6; D.vz *= 1 - dt * 1.6;
    D.vy -= 9.8 * dt; D.y = Math.max(0, D.y + D.vy * dt);
    g.rotation.x = Math.max(-Math.PI / 2, g.rotation.x - dt * 7.5);
    if (D.y <= 0 && D.t > 0.25) { D.phase = "lie"; D.t = 0; }
    return "fall";
  }
  if (D.phase === "lie") {
    D.vx *= 1 - dt * 6; D.vz *= 1 - dt * 6; p.ox += D.vx * dt; p.oz += D.vz * dt;
    g.rotation.x = -Math.PI / 2;
    if (!p.bubble || !p.bubble.visible) { if (Math.random() < dt * 0.6) say(p, pickSay("hurt"), 1.8, "#8a1c1c"); }
    if (D.t > D.lie) { D.phase = "rise"; D.t = 0; }
    return "fall";
  }
  // rise
  g.rotation.x = -Math.PI / 2 * Math.max(0, 1 - D.t / 0.9);
  if (D.t > 0.9) {
    g.rotation.x = 0; p.down = null;
    const angry = ["crossed", "point", "facepalm", "shake"].filter((k) => p.act[k]);
    startEmote(p, angry[Math.floor(Math.random() * angry.length)] || "idle", 3.2, p.face, pickSay("up"));
    p.mood.talk = 1; p.limp = D.hurt ? 12 : 0;
    return "idle";
  }
  return "idle";
}
function pedMind(p, dt, d, rx, rz, active) {
  if (p.next == null) { p.next = 3 + Math.random() * 18; p.hold = 0; p.react = 0; }
  p.react -= dt;
  const toCar = Math.atan2(-rx, -rz);
  if (p.down) return downTick(p, dt);
  if (p.dodge > 0 || p.scared > 0.6) { p.waving = false; p.mood.talk = 0; return "run"; }
  if (p.angry) { p.angry = false; startEmote(p, p.act.point ? "point" : "shake", 2.6, toCar, pickSay("scare")); p.mood.talk = 1; return clipFor(p, p.emote); }
  if (active) {
    if (hornOn && d < 18 && p.react <= 0) { p.react = 6; startEmote(p, p.act.facepalm && Math.random() < 0.4 ? "facepalm" : "shake", 2, toCar, pickSay("horn")); }
    else if (sirenOn && d < 26 && p.react <= 0) { p.react = 8; startEmote(p, "look", 2.5, toCar, Math.random() < 0.5 ? pickSay("siren") : ""); }
  }
  if (p.hold > 0) {
    p.hold -= dt;
    if (p.hold <= 0) { p.hold = 0; p.face = null; p.waving = false; p.mood.talk = 0; p.mood.smile = 0; p.next = 7 + Math.random() * 20; return "walk"; }
    if (p.emote === "look" || p.emote === "look2") p.face = (p.face == null ? p.g.rotation.y : p.face) + Math.sin(performance.now() / 900 + p.seed * 6) * dt * 0.5;
    return clipFor(p, p.emote);
  }
  p.next -= dt;
  if (p.next <= 0) {
    p.next = 7 + Math.random() * 20;
    if (onRoad(p.x, p.z) || d < 7) return "walk";   // never stop on the carriageway or right under the car
    // A neighbour close by? Stop and talk face to face: greet, then chat.
    const mate = peds.find((o) => o !== p && o.model && !o.down && o.hold <= 0 && o.dodge <= 0 && Math.hypot(o.x - p.x, o.z - p.z) < 3.2);
    if (mate && Math.random() < 0.7) {
      const yaw = Math.atan2(mate.x - p.x, mate.z - p.z), secs = 5 + Math.random() * 4;
      const t1 = ["talk", "talk2", "talk3", "agree"].filter((k) => p.act[k]), t2 = ["talk", "talk2", "agree", "think", "shrug"].filter((k) => mate.act[k]);
      startEmote(p, t1[Math.floor(Math.random() * t1.length)] || "idle", secs, yaw, pickSay("greet"));
      startEmote(mate, t2[Math.floor(Math.random() * t2.length)] || "idle", secs, yaw + Math.PI, "");
      setTimeout(() => { if (mate.hold > 0) say(mate, pickSay("chat"), 2.6); }, 1800);
      mate.next = p.next;
      return clipFor(p, p.emote);
    }
    const e = pickEmote(p);
    startEmote(p, e, null, EMOTE[e] && EMOTE[e].face === "car" ? toCar : null);
    return clipFor(p, e);
  }
  return "walk";
}
let onPedHit = null;          // set by the game: (ped, speed)
function pedsTick(dt, active) {
  const cs = Math.sin(car.h), cc = Math.cos(car.h);
  const vwx = cs * car.vx + cc * car.vy, vwz = cc * car.vx - cs * car.vy, sp = Math.hypot(vwx, vwz);
  const tnow = performance.now() / 1000;
  const low = settings.quality === "low";
  for (const p of peds) {
    if (p.frozen) { const q = rectPoint(p.rc, p.s); p.g.position.set(q.x, 0, q.z); p.g.rotation.y = p.face || 0; continue; }   // debug / screenshots
    if (p.dodge > 0) { p.dodge -= dt; p.ox += p.dvx * dt; p.oz += p.dvz * dt; }
    else if (p.model && (p.hold > 0 || p.down)) { if (!p.down) { p.ox *= 1 - Math.min(1, dt * 0.8); p.oz *= 1 - Math.min(1, dt * 0.8); } }
    else { p.s += p.dir * p.speed * (p.limp > 0 ? 0.55 : 1) * dt; p.ox *= 1 - Math.min(1, dt * 0.8); p.oz *= 1 - Math.min(1, dt * 0.8); }
    if (p.limp > 0) p.limp -= dt;
    const q = rectPoint(p.rc, p.s);
    p.x = q.x + p.ox; p.z = q.z + p.oz;
    const dc = Math.hypot(p.x, p.z);       // keep off the roundabout carriageway
    if (dc < RING + 1.6) { p.x *= (RING + 1.6) / dc; p.z *= (RING + 1.6) / dc; }
    const rx = p.x - car.x, rz = p.z - car.z, d = Math.hypot(rx, rz);
    p.g.visible = d < (p.model ? (low ? 45 : 70) : 95);
    if (!p.g.visible) continue;
    if (active && d < 14 && !p.down) {
      if (sp > 2 && p.dodge <= 0 && p.noDodge == null) {
        const tc = clamp((rx * vwx + rz * vwz) / (sp * sp), 0, 1.3), mx = rx - vwx * tc, mz = rz - vwz * tc, miss = Math.hypot(mx, mz);
        if (miss < 2.1 && (rx * vwx + rz * vwz) > 0) {
          // Some people jump clear in time; others don't see it coming.
          if (!p.model || Math.random() < 0.45) {
            let px = -vwz / sp, pz = vwx / sp; if (px * rx + pz * rz < 0) { px = -px; pz = -pz; }
            p.dodge = 0.42; p.dvx = px * 6.2; p.dvz = pz * 6.2; p.scared = 1.6; p.angry = true; p.hold = 0;
            if (onPedScare) onPedScare(p, d, sp);
          } else p.noDodge = 1.5;
        }
      }
      // Contact with the car body: a real hit above walking pace, a gentle shove below it.
      const hitR = HR + 0.4;
      let hd = d;
      for (const off of HULL) { const ex = car.x + cs * off, ez = car.z + cc * off; hd = Math.min(hd, Math.hypot(p.x - ex, p.z - ez)); }
      if (hd < hitR) {
        if (p.model && sp > 2.5) { knockDown(p, vwx, vwz, sp); sfx.thump(Math.min(1, sp / 14)); car.vx *= 0.82; if (onPedHit) onPedHit(p, sp); }
        else { const k = (hitR - hd) / Math.max(hd, 0.01); p.ox += rx * k; p.oz += rz * k; p.x += rx * k; p.z += rz * k; }
      }
    }
    if (p.noDodge != null) { p.noDodge -= dt; if (p.noDodge <= 0) p.noDodge = null; }
    p.scared = Math.max(0, p.scared - dt);
    let mode = "walk";
    if (p.model) mode = pedMind(p, dt, d, rx, rz, active);
    const lift = p.down ? (p.down.phase === "fly" ? p.down.y : 0) + 0.14 * Math.min(1, -p.g.rotation.x / (Math.PI / 2)) : 0;
    p.g.position.set(p.x, p.dodge > 0 ? Math.sin((1 - p.dodge / 0.42) * Math.PI) * 0.35 : lift, p.z);
    let hx = q.hx * p.dir, hz = q.hz * p.dir;
    if (p.dodge > 0) { hx = p.dvx; hz = p.dvz; }
    const want = p.model && p.face != null && p.dodge <= 0 ? p.face : Math.atan2(hx, hz);
    let dh = want - p.g.rotation.y; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    p.g.rotation.y += dh * Math.min(1, dt * (p.down ? 20 : 8));
    p.phase += dt * (p.dodge > 0 ? 16 : p.speed * 5.2);
    if (p.model) {
      bubbleTick(p, dt);
      if (d < (low ? 28 : 45)) {
        ModelKit.animate(p, dt, mode, (p.speed / 1.35) * (p.limp > 0 ? 0.6 : 1), tnow);
        if (p.down && p.act.fall) p.act.fall.timeScale = p.down.phase === "fly" ? 1 : 0.15;   // sprawled while lying
        if (p.waving) ModelKit.wave(p, dt, tnow, true);
      }
      continue;
    }
    animPed(p, d < 60 ? 1 : 0, p.phase);
    if (p.scared > 0) { p.arms[0].rotation.x = p.arms[1].rotation.x = -2.6; }
  }
}

/* ================= Traffic ================= */
const traffic = [];
function laneLoop(cs) {
  const n = cs.length, lane = [], dirs = [];
  for (let i = 0; i < n; i++) { const a = cs[i], b = cs[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); dirs.push([(b[0] - a[0]) / l, (b[1] - a[1]) / l]); }
  for (let i = 0; i < n; i++) { const dp = dirs[(i + n - 1) % n], dn = dirs[i]; lane.push([cs[i][0] + (-dp[1] - dn[1]) * 3, cs[i][1] + (dp[0] + dn[0]) * 3]); }
  const pts = [], Rr = 6;
  for (let i = 0; i < n; i++) {
    const a = lane[i], b = lane[(i + 1) % n], d = dirs[i], dn = dirs[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = Rr; s <= len - Rr; s += 1) pts.push({ x: a[0] + d[0] * s, z: a[1] + d[1] * s, turn: s > len - Rr - 6 });
    const p0 = [b[0] - d[0] * Rr, b[1] - d[1] * Rr], p2 = [b[0] + dn[0] * Rr, b[1] + dn[1] * Rr];
    for (let k = 1; k < 9; k++) { const t = k / 9, u = 1 - t; pts.push({ x: u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], z: u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1], turn: true }); }
  }
  return pts;
}
const TRAFFIC_PAINT = ["#f3f1ec", "#15171c", "#8d949c", "#d8202a", "#1e63d8", "#f2b619", "#19c2a8"];
function buildTraffic() {
  const O = 120, Mr = 60;
  // A handful of NPC cars only: one per loop, so the streets feel alive without getting in the way.
  const loops = [
    [[[-O, O], [O, O], [O, -O], [-O, -O]], 1], [[[-O, -O], [O, -O], [O, O], [-O, O]], 1],
    [[[-Mr, Mr], [Mr, Mr], [Mr, -Mr], [-Mr, -Mr]], 1], [[[-Mr, -Mr], [Mr, -Mr], [Mr, Mr], [-Mr, Mr]], 1],
    [[[Mr, -O], [O, -O], [O, -Mr], [Mr, -Mr]], 1],
  ];
  // Streets of Uzbekistan: Lacettis and Matizes when their 3D models are in.
  const M = (id, alt) => (typeof ModelKit !== "undefined" && ModelKit.has(id) ? id : alt);
  const ids = [M("lacetti", "shahar"), M("matiz", "chaqqon"), "zarba", M("lacetti", "bars"), M("matiz", "shahar"), M("lacetti", "zarba"), M("matiz", "chaqqon")], r = rng(4242);
  loops.forEach(([cs, count]) => {
    const pts = laneLoop(cs);
    for (let k = 0; k < count; k++) {
      const id = ids[Math.floor(r() * ids.length)];
      const m = buildCar(id, { lod: true, paint: TRAFFIC_PAINT[Math.floor(r() * TRAFFIC_PAINT.length)], plate: (10 + Math.floor(r() * 80)) + " " + "ABDEFK"[Math.floor(r() * 6)] + " " + (100 + Math.floor(r() * 899)) + " UZ" });
      scene.add(m.g);
      mergeMeshes(staticMeshes(m.tilt), m.tilt);
      // each wheel: the rolling parts into one, the fixed parts (calipers) into another
      m.wheels.forEach((w) => { mergeMeshes(staticMeshes(w.spin), w.spin); mergeMeshes(staticMeshes(w.steerG, new Set([w.spin])), w.steerG); w.steerG.traverse((o) => { if (o.isMesh) o.castShadow = false; }); });
      traffic.push({ m, pts, i: (k / count) * pts.length + r() * 20, v: 8, max: 7.5 + r() * 3, x: 0, z: 0, h: 0, fx: 0, fz: 1, stun: 0, spin: 0, honk: 0 });
    }
  });
  trafficTick(0, false);
}
function trafficTick(dt, active) {
  dynCircles.length = 0;
  for (const t of traffic) {
    const n = t.pts.length, i0 = Math.floor(t.i) % n, i1 = (i0 + 1) % n, f = t.i - Math.floor(t.i), a = t.pts[i0], b = t.pts[i1];
    t.x = lerp(a.x, b.x, f); t.z = lerp(a.z, b.z, f);
    const ahead = t.pts[(i0 + 3) % n], dx = ahead.x - t.x, dz = ahead.z - t.z, l = Math.hypot(dx, dz) || 1;
    t.fx = dx / l; t.fz = dz / l; t.h = Math.atan2(dx, dz);
    // Anything in the lane ahead? (player, other traffic, pedestrians)
    let target = a.turn ? Math.min(t.max, 4.6) : t.max;
    const blocked = (ox, oz, range, lat) => { const rx = ox - t.x, rz = oz - t.z, al = rx * t.fx + rz * t.fz; return al > 0.5 && al < range && Math.abs(rx * t.fz - rz * t.fx) < lat; };
    let stop = active && blocked(car.x, car.z, 6 + t.v * 0.9, 2.3);
    if (!stop) for (const o of traffic) if (o !== t && blocked(o.x, o.z, 5.5 + t.v * 0.8, 2.1)) { stop = true; break; }
    if (!stop) for (const p of peds) if (p.g.visible && blocked(p.x, p.z, 4 + t.v * 0.7, 1.9)) { stop = true; break; }
    if (active && sirenOn) {      // police behind you? slow down and let it pass
      const rx = car.x - t.x, rz = car.z - t.z, al = rx * t.fx + rz * t.fz;
      if (al < 0 && al > -40 && Math.abs(rx * t.fz - rz * t.fx) < 7) target = Math.min(target, 1.2);
    }
    t.stun = Math.max(0, t.stun - dt);
    if (stop || t.stun > 0) target = 0;
    t.v += clamp(target - t.v, -14 * dt, 3.2 * dt);
    t.i = (t.i + t.v * dt) % n;
    const g = t.m.g; g.position.set(t.x, 0, t.z); g.rotation.y = t.h;
    t.spin += (t.v / t.m.sh.wr) * dt; t.m.wheels.forEach((w) => (w.spin.rotation.x = t.spin * w.dir));
    const braking = target < t.v - 0.3 || t.v < 0.2;
    t.m.tailMat.color.setRGB(t.stun > 0 ? (Math.sin(performance.now() / 120) > 0 ? 1 : 0.2) : braking ? 1 : 0.42, t.stun > 0 ? 0.35 : 0.02, 0.01);
    const e = t.m.sh.L / 2 - 0.9;
    dynCircles.push({ x: t.x + t.fx * e, z: t.z + t.fz * e, r: 0.95, owner: t }, { x: t.x - t.fx * e, z: t.z - t.fz * e, r: 0.95, owner: t }, { x: t.x, z: t.z, r: 0.95, owner: t });
  }
}

/* ================= Parked, showroom and preview cars ================= */
function buildStaticCars() {
  const r = rng(99), ids = ["shahar", "zarba", "chaqqon", "bars", "lochin", "shahar", "zarba"];
  let models = 0;   // a few parked 3D-model cars (Lacetti / Matiz); the rest stay light for phones
  const pickParked = () => { if (models < 4 && typeof ModelKit !== "undefined" && r() < 0.5) { const id = r() < 0.55 ? "lacetti" : "matiz"; if (ModelKit.has(id)) { models++; return id; } } return ids[Math.floor(r() * ids.length)]; };
  const park = (id, x, z, h, paint) => {
    const m = buildCar(id, { lod: true, paint, plate: (10 + Math.floor(r() * 80)) + " " + "ABDEFK"[Math.floor(r() * 6)] + " " + (100 + Math.floor(r() * 899)) + " UZ" });
    m.g.position.set(x, 0, z); m.g.rotation.y = h; m.beam.visible = false; m.tailGlow.visible = false; m.tailMat.color.setRGB(0.25, 0.01, 0.01); m.headMat.color.setRGB(0.25, 0.27, 0.3);
    scene.add(m.g); mergeMeshes(staticMeshes(m.g), m.g);
    if (settings.quality !== "high") m.g.traverse((o) => { if (o.isMesh && o.geometry.boundingSphere && o.geometry.boundingSphere.radius < 0.6) o.castShadow = false; });   // small bits: no shadow
    return m;
  };
  PARK_BAYS.filter((b) => b.occupied).forEach((b) => park(pickParked(), b.x, b.z, b.h, TRAFFIC_PAINT[Math.floor(r() * TRAFFIC_PAINT.length)]));
  DISPLAY.forEach((d) => park(d.id, d.x, d.z, d.h, d.paint));
}
const preview = { id: null, m: null, cache: {} };
function setPreview(id, paint) {
  if (preview.m) preview.m.g.visible = false;
  if (!id) { preview.id = null; preview.m = null; return; }
  // A 3D-model car is shown only once its full model is in; until then nothing (the sheet says it is loading).
  if (typeof ModelKit !== "undefined" && ModelKit.isModelCar(id) && !ModelKit.hasFull(id)) { preview.id = id; preview.m = null; return; }
  const ck = id + (typeof ModelKit !== "undefined" && ModelKit.hasFull(id) ? "@m" : "");
  if (preview.cache[id] && preview.cache[id].ck !== ck) { scene.remove(preview.cache[id].g); delete preview.cache[id]; }
  if (!preview.cache[id]) { const m = buildCar(id, { player: true, paint: paint || "#d8202a" }); m.g.position.set(PODIUM.x, 0.38, PODIUM.z); m.beam.visible = false; m.tailGlow.visible = false; m.ck = ck; scene.add(m.g); preview.cache[id] = m; }
  preview.id = id; preview.m = preview.cache[id]; preview.m.g.visible = true;
}
