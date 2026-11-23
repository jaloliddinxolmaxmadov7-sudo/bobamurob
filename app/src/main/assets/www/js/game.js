/* UZ AUTO LIFE — game flow: save data, missions, services, tuning, dealer, HUD, map, input and the main loop. */
"use strict";

/* ================= Save data ================= */
let S = C.defaultSave();          // live player state (cash, xp, fuel, cars, …)
let econ = C.createEconomy(S);
let saveNotice = null;
let worldReady = false;

function readSave() {
  const raw = store.get(SAVE_KEY);
  if (raw == null) {
    const tmp = C.validateSave(parse(store.get(SAVE_KEY + ".tmp")));
    return tmp ? { data: tmp, existed: true } : { data: null, existed: false };
  }
  const v = C.validateSave(parse(raw));
  if (v) return { data: v, existed: true };
  const tmp = C.validateSave(parse(store.get(SAVE_KEY + ".tmp")));
  if (tmp) return { data: tmp, existed: true };
  store.set(SAVE_KEY + ".corrupt", raw);
  store.del(SAVE_KEY);
  saveNotice = "Saqlangan maʼlumot buzilgan edi — zaxira nusxa olindi, yangi oʻyin boshlanadi.";
  return { data: null, existed: false };
}
function writeSave() {
  S.savedAt = Date.now();
  S.pos = mode === "play" ? { x: car.x, z: car.z, h: car.h } : S.pos;
  const json = JSON.stringify(testDrive ? Object.assign({}, S, testDrive.keep) : S);
  // Two-step write: a crash between the steps leaves a valid .tmp copy for recovery.
  store.set(SAVE_KEY + ".tmp", json);
  store.set(SAVE_KEY, json);
  store.del(SAVE_KEY + ".tmp");
}
function hasSave() { return C.validateSave(parse(store.get(SAVE_KEY))) !== null; }
function useSave(d) { S = d; econ = C.createEconomy(S); if (worldReady) equipCar(); }
/* Model cars load on demand: run fn once the full model of id is ready (instantly if it already is). */
function withCar(id, fn, msgEl) {
  if (!ModelKit.isModelCar(id) || ModelKit.hasFull(id)) return fn();
  if (msgEl) { msgEl.textContent = "3D model yuklanmoqda…"; msgEl.style.color = "var(--feruza)"; }
  ModelKit.ensureCar(id, false).then(() => { if (msgEl) { msgEl.textContent = ""; msgEl.style.color = ""; } fn(); });
}
/* Test drive: any showroom car for two minutes, free. Your own car's fuel, damage and dirt are kept aside. */
let testDrive = null;
function equipCar() {
  if (testDrive) { Object.assign(S, testDrive.keep); testDrive = null; }
  setPlayerCar(S.carId, S.cars[S.carId], S.dents);
  afterEquip();
}
function startTestDrive(id) {
  if (missionBusy()) { $("dMsg").textContent = "Avval missiyani tugating."; return; }
  if (testDrive) equipCar();
  testDrive = { id, t: 120, keep: { fuel: S.fuel, condition: S.condition, dents: S.dents.slice(), dirt: S.dirt } };
  Object.assign(S, { fuel: C.PRICES.tankLitres, condition: 100, dents: [], dirt: 0 });
  show("dealer", false); setPreview(null);
  setPlayerCar(id, Object.assign(C.defaultTune(), { paint: "#15171c" }), []);
  afterEquip(); engineOn = true;
  big("SINOV HAYDOVI", true, 1.6); sfx.coin();
  toast("“" + carName(id) + "” — 2 daqiqa bepul!" + (pcar.hasSiren ? " L — sirena" : ""));
}
function endTestDrive() {
  if (!testDrive) return;
  equipCar(); toast("Sinov haydovi tugadi — oʻz mashinangizga qaytdingiz"); sfx.tone(520, 0.2);
}
function toggleSiren() {
  if (!pcar.hasSiren) { toast("Bu mashinada sirena yoʻq"); return; }
  sirenOn = !sirenOn; sfx.siren(sirenOn); $("pSiren").classList.toggle("held", sirenOn);
  if (sirenOn) toast("Sirena yoqildi — mashinalar yoʻl beradi");
}
function afterEquip() {
  sirenOn = false; sfx.siren(false);
  $("pSiren").hidden = !pcar.hasSiren; $("pSiren").classList.remove("held");
  car.nitro = 1;
  cockpit.visible = camMode === "cockpit";
  const hasNitro = P.nitroBoost > 0;
  $("gNitroW").hidden = !hasNitro; $("gNitroT").hidden = !hasNitro; $("pNitro").hidden = !hasNitro;
}

/* ================= Audio (WebAudio synthesis — no external files) ================= */
const sfx = (function () {
  let ctx = null, master, eng1, eng2, engGain, lp, squeal, sqGain, horn = null, siren = null;
  function init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = settings.volume; master.connect(ctx.destination);
    lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 2;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    eng1 = ctx.createOscillator(); eng1.type = "sawtooth";
    eng2 = ctx.createOscillator(); eng2.type = "square";
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    eng1.connect(lp); eng2.connect(g2); g2.connect(lp); lp.connect(engGain); engGain.connect(master);
    eng1.start(); eng2.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    squeal = ctx.createBufferSource(); squeal.buffer = buf; squeal.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 6;
    sqGain = ctx.createGain(); sqGain.gain.value = 0;
    squeal.connect(bp); bp.connect(sqGain); sqGain.connect(master); squeal.start();
    sfx.noise = buf;
  }
  function update(rpm, throttle, slip) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = rpm > 0;
    const f = 18 + rpm / 60 * 1.9;
    eng1.frequency.setTargetAtTime(f, t, 0.05);
    eng2.frequency.setTargetAtTime(f * 2, t, 0.05);
    lp.frequency.setTargetAtTime(300 + rpm * 0.18 + throttle * 500, t, 0.08);
    engGain.gain.setTargetAtTime(on ? 0.1 + throttle * 0.12 : 0, t, 0.08);
    sqGain.gain.setTargetAtTime(clamp((slip - 0.12) * 0.9, 0, 0.18), t, 0.05);
  }
  function blip(freq, dur, type, vol) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  }
  return {
    init,
    update,
    setVolume(v) { if (master) master.gain.value = v; },
    suspend(s) { if (ctx) (s ? ctx.suspend() : ctx.resume()).catch(() => {}); },
    tone(f, d) { blip(f, d, "square", 0.1); },
    click() { blip(880, 0.06, "triangle", 0.15); },
    shift() { blip(140, 0.08, "sine", 0.12); },
    coin() { blip(990, 0.09, "triangle", 0.2); setTimeout(() => blip(1320, 0.14, "triangle", 0.2), 90); },
    thump(k) {
      if (!ctx || !sfx.noise) return;
      const s = ctx.createBufferSource(); s.buffer = sfx.noise;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 260;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * k, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      s.connect(f); f.connect(g); g.connect(master); s.start(); s.stop(ctx.currentTime + 0.32);
    },
    siren(on) {
      if (!ctx) return;
      if (on && !siren) {
        const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = 980; lfo.type = "sine"; lfo.frequency.value = 0.32; lg.gain.value = 430;
        lfo.connect(lg); lg.connect(o.frequency); f.type = "lowpass"; f.frequency.value = 2400; g.gain.value = 0.06;
        o.connect(f); f.connect(g); g.connect(master); o.start(); lfo.start(); siren = { o, lfo };
      } else if (!on && siren) { siren.o.stop(); siren.lfo.stop(); siren = null; }
    },
    horn(on) {
      if (!ctx) return;
      if (on && !horn) {
        const g = ctx.createGain(); g.gain.value = 0.12; g.connect(master);
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = o2.type = "square";
        o1.frequency.value = 415; o2.frequency.value = 523; o1.connect(g); o2.connect(g); o1.start(); o2.start();
        horn = { o1, o2, g };
      } else if (!on && horn) { horn.o1.stop(); horn.o2.stop(); horn = null; }
    },
  };
})();

function setHorn(on) { hornOn = !!on; sfx.horn(on); }

/* ================= Game flow ================= */
let mode = "loading";   // loading | menu | play
let paused = false;
let camMode = "chase";
const idle = () => ({ type: null, phase: "idle" });
let mission = idle();
let navTarget = null;
let activeZone = null;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const MODALS = ["pause", "settings", "jobs", "results", "mapModal", "garage", "confirmNew", "tuning", "dealer"];

function show(id, on) { $(id).hidden = !on; }
function anyModal() { return MODALS.some((id) => !$(id).hidden); }
let toastT = 0;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.style.opacity = 1; toastT = 2.8; }
let bigT = 0;
function big(msg, small, dur) { const b = $("big"); b.textContent = msg; b.classList.toggle("sm", !!small); b.style.opacity = 1; bigT = dur || 0.9; }
const inputLocked = () => mission.phase === "countdown";

function placeCarFromSave() {
  if (S.pos && !insideSolid(S.pos.x, S.pos.z)) Object.assign(car, { x: S.pos.x, z: S.pos.z, h: S.pos.h });
  else Object.assign(car, { x: -45, z: 3, h: Math.PI / 2 });
  Object.assign(car, { vx: 0, vy: 0, r: 0, steer: 0, gear: 1, mode: "D" });
  engineOn = S.fuel > 0;
  camPos.set(car.x - Math.sin(car.h) * 8, 4, car.z - Math.cos(car.h) * 8);
}
function insideSolid(x, z) { for (const c of nearCols(x, z)) if (Math.abs(x - c.x) < c.hx + 1 && Math.abs(z - c.z) < c.hz + 1) return true; return false; }

function enterPlay() {
  look.yaw = 0; look.pitch = 0; $("lookHint").style.opacity = look.used ? 0 : 1;
  sfx.init(); sfx.suspend(false);
  mode = "play"; paused = false;
  ["menu", "confirmNew", "garage", "settings"].forEach((id) => show(id, false));
  show("hud", true);
  const touch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  show("touch", touch);
  show("keys", !touch);
  updateControlsUI();
  placeCarFromSave();
  writeSave();
  checkRotate();
  if (saveNotice) { toast(saveNotice); saveNotice = null; }
  else toast("Assalomu alaykum! Pul topish uchun bayroqcha tugmasini bosing (J)");
}
function toMenu() {
  writeSave();
  mode = "menu"; paused = false;
  clearMission(); navTarget = null;
  ["hud", "touch", "rotate"].concat(MODALS).forEach((id) => show(id, false));
  setPreview(null);
  setHorn(false); sirenOn = false; sfx.siren(false); sfx.suspend(true);
  if (testDrive) equipCar();
  refreshMenu(); show("menu", true);
}
const PROVERBS = ["“Sabr tagi — sariq oltin.”", "“Yoʻl yursang — yoʻldoshing boʻlsin.”", "“Shoshgan — yiqilar.”", "“Qatra-qatra yigʻilib daryo boʻlur.”", "“Mehnat — mehnatning tagi rohat.”", "“Ehtiyot — oʻzingdan, Xudo saqlar.”", "“Oz-oz oʻrganib dono boʻlur.”"];
const proverb = () => PROVERBS[Math.floor(Math.random() * PROVERBS.length)];
function refreshMenu() {
  $("menuProverb").textContent = proverb();
  const exists = hasSave();
  $("bContinue").hidden = !exists;
  $("bPlay").textContent = exists ? "Yangi oʻyin" : "Yoʻlga chiqamiz!";
  $("bPlay").classList.toggle("primary", !exists);
  const d = exists ? C.validateSave(parse(store.get(SAVE_KEY))) : S;
  $("mCash").textContent = C.formatSom(d.cash);
  $("mLvl").textContent = C.levelFromXp(d.xp).level;
  $("mJobs").textContent = d.stats.completed;
}
function setPaused(p) {
  paused = p; show("pause", p);
  if (p) { clearInput(); setHorn(false); sfx.siren(false); writeSave(); } else if (sirenOn) sfx.siren(true);
}
function clearInput() { for (const k in inp) inp[k] = k === "wheel" ? 0 : false; document.querySelectorAll(".held").forEach((e) => e.classList.remove("held")); }

/* Menu buttons */
$("bContinue").onclick = () => { const r = readSave(); if (r.data) useSave(r.data); withCar(S.carId, () => { equipCar(); enterPlay(); }, $("menuNote")); };
$("bPlay").onclick = () => { if (hasSave()) show("confirmNew", true); else { useSave(C.defaultSave()); enterPlay(); } };
$("bNewYes").onclick = () => { useSave(C.defaultSave()); S.pos = null; enterPlay(); };
$("bNewNo").onclick = () => show("confirmNew", false);
$("bGarage").onclick = () => { const r = readSave(); if (r.data) useSave(r.data); renderGarage(); show("garage", true); };
$("bGarBack").onclick = () => show("garage", false);
let settingsFrom = "menu";
$("bSettings").onclick = () => { settingsFrom = "menu"; renderSettings(); show("settings", true); };
$("bPauseSet").onclick = () => { settingsFrom = "pause"; show("pause", false); renderSettings(); show("settings", true); };
$("bSetBack").onclick = () => { show("settings", false); if (settingsFrom === "pause") show("pause", true); };
$("bResume").onclick = () => setPaused(false);
$("bQuit").onclick = () => toMenu();
$("bRotIgnore").onclick = () => { rotIgnored = true; show("rotate", false); };

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
const som = C.formatSom;
const carName = (id) => C.CARS[id].name;
function noMoney(cost) { return "Pul yetarli emas: " + som(cost) + " kerak, sizda " + som(S.cash) + "."; }

/* ================= Garage ================= */
function renderGarage() {
  const lv = C.levelFromXp(S.xp), spec = C.CARS[S.carId], t = S.cars[S.carId];
  $("gTitle").textContent = "“" + spec.name + "” · " + spec.cls;
  const rows = [
    ["Pul", som(S.cash)],
    ["Daraja", lv.level + " (" + lv.current + " / " + lv.next + " XP)"],
    ["Yoqilgʻi", S.fuel.toFixed(1) + " / " + C.PRICES.tankLitres + " L"],
    ["Holati", Math.round(S.condition) + "%" + (S.dents.length ? " · " + S.dents.length + " ta pachoq" : "")],
    ["Iflosligi", Math.round(S.dirt) + "%"],
    ["Tyuning", "Dvigatel " + t.eng + " · Tormoz " + t.brk + " · Shina " + t.tire + " · Nitro " + t.nitro],
    ["Bajarilgan missiyalar", S.stats.completed],
    ["Muvaffaqiyatsiz", S.stats.failed],
    ["Medallar", S.stats.medals],
    ["Eng yaxshi drift", Math.round(S.stats.bestDrift) + " ball"],
    ["Missiyalardan daromad", som(S.stats.earned)],
    ["Jarimalar", S.stats.fines],
    ["Bosib oʻtilgan yoʻl", (S.stats.distance / 1000).toFixed(2) + " km"],
  ];
  $("gStats").innerHTML = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + escapeHtml(v) + "</dd>").join("");
  $("gCars").innerHTML = C.CAR_IDS.filter((id) => S.cars[id]).map((id) =>
    "<button class='carrow' data-car='" + id + "' aria-pressed='" + (id === S.carId) + "'><b>" + carName(id) + "</b><small>" + C.CARS[id].cls + "</small><span class='own'>" + (id === S.carId ? "Minilgan" : "Minish") + "</span></button>").join("");
  $("gTx").innerHTML = S.tx.length ? S.tx.slice(0, 30).map((x) => "<div><span>" + escapeHtml(x.label) + "</span><span class='" + (x.amount > 0 ? "plus" : "minus") + "'>" + (x.amount > 0 ? "+" : "−") + som(Math.abs(x.amount)) + "</span></div>").join("") : "<div><span style='color:var(--muted)'>Hali toʻlovlar yoʻq</span></div>";
}
$("gCars").addEventListener("click", (e) => {
  const b = e.target.closest("[data-car]"); if (!b || b.dataset.car === S.carId) return;
  if (missionBusy()) return toast("Avval missiyani tugating");
  const id = b.dataset.car;
  withCar(id, () => { S.carId = id; equipCar(); sfx.click(); if (mode === "play") writeSave(); else store.set(SAVE_KEY, JSON.stringify(S)); renderGarage(); });
});

/* ================= Settings ================= */
function renderCredits() {
  const mf = ModelKit.manifest; if (!mf) return;
  const items = [];
  for (const group of ["cars", "props", "people"]) { const g = mf[group]; if (!g) continue; for (const k of Object.keys(g)) { const c = g[k].credit; if (c) items.push(c); } }
  items.push("Odamlar: Ready Player Me avatari (three.js namunalari, MIT), Michelle va animatsiyalar — Mixamo (Adobe)");
  items.push("Harakatlar: Ready Player Me Animation Library (faqat RPM avatarlari uchun)");
  items.push("Shriftlar: Chakra Petch, Manrope (SIL OFL 1.1) · Grafika: three.js (MIT)");
  $("creditList").innerHTML = items.map((t) => "<li>" + escapeHtml(t) + "</li>").join("");
}
function renderSettings() {
  renderCredits();
  document.querySelectorAll("#settings .seg").forEach((seg) => {
    const k = seg.dataset.key;
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(String(settings[k]) === b.dataset.v)));
  });
  $("sSens").value = settings.sensitivity; $("sSensV").textContent = Math.round(settings.sensitivity * 100) + "%";
  $("sVol").value = settings.volume; $("sVolV").textContent = Math.round(settings.volume * 100) + "%";
}
document.querySelectorAll("#settings .seg").forEach((seg) => seg.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const k = seg.dataset.key; let v = b.dataset.v;
  if (k === "showFps") v = v === "true";
  settings[k] = v; saveSettings(); renderSettings();
  if (k === "quality") applyQuality();
  if (k === "tod") todT = 0;
  if (k === "controls") updateControlsUI();
  if (k === "showFps") show("fps", v && mode === "play");
}));
$("sSens").oninput = (e) => { settings.sensitivity = +e.target.value; saveSettings(); renderSettings(); };
$("sVol").oninput = (e) => { settings.volume = +e.target.value; saveSettings(); renderSettings(); sfx.setVolume(settings.volume); };
function updateControlsUI() {
  const wheel = settings.controls === "wheel";
  show("wheel", wheel); document.querySelector(".sbtns").hidden = wheel;
  show("fps", settings.showFps && mode === "play");
}

/* ================= Input ================= */
const KEYMAP = { KeyW: "kF", ArrowUp: "kF", KeyS: "kB", ArrowDown: "kB", KeyA: "kL", ArrowLeft: "kL", KeyD: "kR", ArrowRight: "kR", Space: "kH", ShiftLeft: "kN", ShiftRight: "kN", KeyN: "kN" };
function closeTop() {
  for (const id of ["mapModal", "jobs", "tuning", "dealer", "garage", "results"]) if (!$(id).hidden) { if (id === "dealer") setPreview(null); show(id, false); return true; }
  if (!$("settings").hidden) { $("bSetBack").onclick(); return true; }
  return false;
}
window.addEventListener("keydown", (e) => {
  if (mode !== "play") return;
  if (e.code === "Escape") { if (!closeTop()) setPaused(!paused); return; }
  if (paused || anyModal()) return;
  if (KEYMAP[e.code]) { inp[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === "KeyC") toggleCam();
  if (e.code === "KeyR") recover();
  if (e.code === "KeyE") toggleEngine();
  if (e.code === "KeyH") setHorn(true);
  if (e.code === "KeyM") openMap();
  if (e.code === "KeyJ") openJobs();
  if (e.code === "KeyL") toggleSiren();
});
window.addEventListener("keyup", (e) => { if (KEYMAP[e.code]) inp[KEYMAP[e.code]] = false; if (e.code === "KeyH") setHorn(false); });
window.addEventListener("blur", () => { clearInput(); setHorn(false); if (mode === "play" && !paused && !anyModal()) setPaused(true); });
document.addEventListener("visibilitychange", () => { if (document.hidden && mode === "play") { writeSave(); if (!paused && !anyModal()) setPaused(true); } });

function holdBtn(id, key, onDown, onUp) {
  const el = $(id);
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add("held"); if (key) inp[key] = true; if (onDown) onDown(); });
  const up = () => { el.classList.remove("held"); if (key) inp[key] = false; if (onUp) onUp(); };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("lostpointercapture", up);
}
holdBtn("pGas", "tGas"); holdBtn("pBrake", "tBrake"); holdBtn("pHand", "tH"); holdBtn("pLeft", "tL"); holdBtn("pRight", "tR"); holdBtn("pNitro", "tN");
holdBtn("pHorn", null, () => setHorn(true), () => setHorn(false));
$("pGear").addEventListener("click", () => { setGear(car.mode === "D" ? "R" : "D"); });
$("pSiren").addEventListener("click", toggleSiren);

// Steering wheel: drag rotates the wheel up to ±150°, springs back on release.
(function () {
  const el = $("wheel"), g = $("wheelG");
  let id = null, last = 0, rot = 0;
  const ang = (e) => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  el.addEventListener("pointerdown", (e) => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch (_) {} last = ang(e); });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const a = ang(e); let d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; last = a;
    rot = clamp(rot + (d * 180) / Math.PI, -150, 150);
  });
  const up = (e) => { if (e.pointerId === id) id = null; };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  (function tick() {
    if (id === null) rot *= 0.82;
    if (Math.abs(rot) < 0.5 && id === null) rot = 0;
    inp.wheel = -rot / 150;
    g.setAttribute("transform", "rotate(" + rot.toFixed(1) + " 74 74)");
    requestAnimationFrame(tick);
  })();
})();

function toggleCam() { camMode = camMode === "chase" ? "cockpit" : "chase"; cockpit.visible = camMode === "cockpit"; $("tCam").classList.toggle("on", camMode === "cockpit"); }
function toggleEngine() {
  if (!engineOn && S.fuel <= 0) { toast("Yoqilgʻi yoʻq — shoxobchaga boring"); return; }
  engineOn = !engineOn; toast(engineOn ? "Dvigatel yoqildi" : "Dvigatel oʻchirildi");
}
$("tPause").onclick = () => setPaused(true);
$("tCam").onclick = toggleCam;
$("tReset").onclick = recover;
$("tEngine").onclick = toggleEngine;
$("tJob").onclick = openJobs;
$("tMap").onclick = openMap;
$("mini").onclick = openMap;

/* ================= Mission markers ================= */
const target = new THREE.Group();
const targetMat = new THREE.MeshBasicMaterial({ color: col(0xffb020), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
const targetRingMat = new THREE.MeshBasicMaterial({ color: col(0xffb020), side: THREE.DoubleSide, fog: false });
(function () {
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 40, 20, 1, true), targetMat); beam.position.y = 20; target.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(C.ARRIVE_RADIUS - 0.5, C.ARRIVE_RADIUS, 48), targetRingMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; target.add(ring);
  target.visible = false; scene.add(target);
})();
// Parking bay outline
const bayMark = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 5.5), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, map: canvasTex(128, 256, (g) => {
  g.strokeStyle = "#19e3ff"; g.lineWidth = 10; g.shadowColor = "#19e3ff"; g.shadowBlur = 16; g.strokeRect(12, 12, 104, 232);
  g.fillStyle = "rgba(25,227,255,0.16)"; g.fillRect(12, 12, 104, 232);
  g.fillStyle = "#19e3ff"; g.font = "700 90px 'Chakra Petch', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("P", 64, 132);
}) }));
bayMark.rotation.x = -Math.PI / 2; bayMark.position.y = 0.13; bayMark.visible = false; bayMark.renderOrder = 4; scene.add(bayMark);
// Race gates: next (cyan) and the one after (magenta)
function mkGate(c) {
  const g = new THREE.Group(), m = glowMat(c), half = 7;
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.5, 0.35), m); p.position.set(s * half, 3.25, 0); g.add(p); }
  const top = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.35, 0.4, 0.35), m); top.position.y = 6.5; g.add(top);
  const line = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.04, 0.5), m); line.position.y = 0.1; g.add(line);
  g.visible = false; scene.add(g); return g;
}
const gates = [mkGate(0x19e3ff), mkGate(0xff2e88)];
// Taxi passenger
let passenger = { g: new THREE.Group(), arms: [{ rotation: {} }, { rotation: {} }], legs: [] };   // rebuilt once the models are in
function buildPassenger() { scene.remove(passenger.g); passenger = makePed(4711); passenger.g.visible = false; scene.add(passenger.g); }
let passengerT = 0;
function kerbSpot(p) {
  let rz = ROADS[0], rx = ROADS[0];
  for (const r of ROADS) { if (Math.abs(p.z - r) < Math.abs(p.z - rz)) rz = r; if (Math.abs(p.x - r) < Math.abs(p.x - rx)) rx = r; }
  if (Math.abs(p.z - rz) <= Math.abs(p.x - rx)) return { x: p.x, z: rz + (p.z >= rz ? 7.3 : -7.3) };
  return { x: rx + (p.x >= rx ? 7.3 : -7.3), z: p.z };
}
function showPassenger(p, t) { const k = kerbSpot(p); passenger.g.position.set(k.x, 0, k.z); passenger.g.visible = true; passengerT = t || 0; }

// 3D GPS arrow above the car
const gpsArrow = new THREE.Group();
(function () {
  const m = new THREE.MeshBasicMaterial({ color: col(0xffb020), fog: false });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 4), m); head.rotation.x = Math.PI / 2; head.position.z = 0.45;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.8), m); tail.position.z = -0.3;
  gpsArrow.add(head, tail); gpsArrow.visible = false; scene.add(gpsArrow);
})();

/* ================= Missions ================= */
const JOB_INFO = {
  delivery: { name: "Yetkazib berish", color: "#ffb020" },
  taxi: { name: "Taksi", color: "#ffe14a" },
  race: { name: "Tungi poyga", color: "#19e3ff" },
  drift: { name: "Drift", color: "#ff7a1a" },
  parking: { name: "Parkovka ustasi", color: "#5dff9b" },
};
const missionBusy = () => mission.type !== null;
function clearMission() { mission = idle(); target.visible = false; bayMark.visible = false; gates.forEach((g) => (g.visible = false)); passenger.g.visible = false; }
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function fmtLap(s) { return Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0"); }
let offers = { delivery: null, taxi: null };

function openJobs() {
  clearInput();
  if (missionBusy()) {
    showResults("Faol missiya", JOB_INFO[mission.type].name, [["Holat", missionLine().dest], ["Maʼlumot", missionLine().time || "—"]],
      [["Davom etish", "primary", closeResults], ["Bekor qilish", "danger", () => { clearMission(); closeResults(); toast("Missiya bekor qilindi"); }]]);
    return;
  }
  if (!offers.delivery) offers.delivery = C.createDeliveryJob(car.x, car.z);
  if (!offers.taxi) offers.taxi = C.createTaxiJob(car.x, car.z);
  renderJobs(); show("jobs", true);
}
function renderJobs() {
  const d = offers.delivery, t = offers.taxi, dPay = Math.round((d.reward * P.cargo) / 1000) * 1000;
  const card = (c, title, body) => "<div class='job' style='--c:" + c + "'><h4>" + title + "</h4>" + body + "</div>";
  let h = "";
  h += card(JOB_INFO.delivery.color, "Yetkazib berish",
    "<p>" + escapeHtml(d.pickup.name) + " → " + escapeHtml(d.dropoff.name) + "</p><div class='pay'>" + som(dPay) + "</div><small>" + Math.round(d.distance) + " m · " + fmtTime(d.timeLimit) + " · yukni urib yubormang" + (P.cargo > 1 ? " · yuk bonusi +" + Math.round((P.cargo - 1) * 100) + "%" : "") + "</small>" +
    "<div class='row'><button class='btn gold sm grow' data-go='delivery'>Boshlash</button><button class='btn sm' data-go='re-delivery'>Boshqa</button></div>");
  h += card(JOB_INFO.taxi.color, "Taksi",
    "<p>" + escapeHtml(t.passenger) + ": " + escapeHtml(t.pickup.name) + " → " + escapeHtml(t.dropoff.name) + "</p><div class='pay'>" + som(t.reward) + " + choychaqa</div><small>" + Math.round(t.distance) + " m · " + fmtTime(t.timeLimit) + " · silliq haydasangiz choychaqa koʻp</small>" +
    "<div class='row'><button class='btn gold sm grow' data-go='taxi'>Boshlash</button><button class='btn sm' data-go='re-taxi'>Boshqa</button></div>");
  h += card(JOB_INFO.race.color, "Tungi poyga",
    "<p>Neon darvozalardan vaqtga qarshi oʻting. Medal qancha yaxshi boʻlsa, mukofot shuncha katta.</p>" +
    C.RACES.map((r) => "<div class='row' style='align-items:center'><button class='btn primary sm grow' data-go='race:" + r.id + "'>" + r.name + "</button><small>oltin " + fmtLap(r.gold) + " · " + som(r.pay) + "</small></div>").join(""));
  h += card(JOB_INFO.drift.color, "Drift",
    "<p>Drift maydonida " + C.DRIFT_TIME + " soniya ichida ball yigʻing: qoʻl tormozi (Probel) bilan sirpaning. Maydon ichida ball ×1,5.</p><div class='pay'>" + som(C.driftReward(6000)) + " gacha</div><small>Rekord: " + Math.round(S.stats.bestDrift) + " ball" + (P.rwd ? " · orqa yuritma — drift uchun zoʻr" : "") + "</small>" +
    "<div class='row'><button class='btn hot sm grow' data-go='drift'>Boshlash</button></div>");
  h += card(JOB_INFO.parking.color, "Parkovka ustasi",
    "<p>Avtoturargohda belgilangan joyga mashinani aniq va urmasdan qoʻying. Aniqlik yuqori boʻlsa, haq koʻproq.</p><div class='pay'>" + som(30000) + " – " + som(100000) + "</div><small>75 soniya · har bir urilish −15 ball</small>" +
    "<div class='row'><button class='btn primary sm grow' data-go='parking'>Boshlash</button></div>");
  $("jobList").innerHTML = h;
}
$("jobList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]"); if (!b) return;
  const go = b.dataset.go;
  if (go === "re-delivery") { offers.delivery = C.createDeliveryJob(car.x, car.z); return renderJobs(); }
  if (go === "re-taxi") { offers.taxi = C.createTaxiJob(car.x, car.z); return renderJobs(); }
  show("jobs", false);
  if (go === "delivery") { startTrip("delivery", offers.delivery); offers.delivery = null; }
  else if (go === "taxi") { startTrip("taxi", offers.taxi); offers.taxi = null; }
  else if (go.startsWith("race:")) startRace(C.RACES.find((r) => r.id === go.slice(5)));
  else if (go === "drift") startDrift();
  else if (go === "parking") startParking();
});
$("bJobsClose").onclick = () => show("jobs", false);

function startTrip(type, job) {
  clearMission();
  mission = { type, phase: "toPickup", job, timeLeft: job.timeLimit, comfort: 100, damage: 0 };
  if (type === "taxi") { showPassenger(job.pickup); toast(job.passenger + " kutmoqda: " + job.pickup.name); }
  else toast("Yukni oling: " + job.pickup.name);
  sfx.click();
}
function startRace(race) { clearMission(); mission = { type: "race", phase: "toStart", race, idx: 0, time: 0, cd: 0 }; toast("Startga boring: " + race.name); sfx.click(); }
function startDrift() {
  clearMission(); mission = { type: "drift", phase: "toStart", timeLeft: C.DRIFT_TIME, score: 0, combo: 1, chain: 0, drifting: false };
  if (near(SVC.arena, SVC.arena.r)) beginDrift(); else toast("Drift maydoniga boring"); sfx.click();
}
function beginDrift() { mission.phase = "run"; big("DRIFT!", false, 1); sfx.tone(880, 0.25); }
function startParking() {
  clearMission(); mission = { type: "parking", phase: "toStart", timeLeft: 75, hits: 0, hold: 0, bay: null, acc: 0 };
  if (near(SVC.parking, SVC.parking.r + 2)) beginParking(); else toast("Avtoturargohga boring"); sfx.click();
}
function beginParking() {
  const free = PARK_BAYS.filter((b) => !b.occupied);
  mission.bay = free[Math.floor(Math.random() * free.length)]; mission.phase = "run";
  bayMark.position.set(mission.bay.x, 0.13, mission.bay.z); bayMark.visible = true;
  big("JOYGA QOʻYING", true, 1.4); sfx.tone(660, 0.2);
}
const near = (p, r) => Math.hypot(p.x - car.x, p.z - car.z) < r;

function showResults(tag, title, kv, btns) {
  $("rTag").textContent = tag; $("rTitle").textContent = title;
  $("rKv").innerHTML = kv.map(([k, v]) => "<dt>" + k + "</dt><dd>" + escapeHtml(v) + "</dd>").join("");
  const box = $("rBtns"); box.innerHTML = "";
  btns.forEach(([label, cls, fn]) => { const b = document.createElement("button"); b.className = "btn grow " + (cls || ""); b.textContent = label; b.onclick = fn; box.appendChild(b); });
  clearInput(); show("results", true);
}
function closeResults() { show("results", false); }

/** Pays out, records stats and shows the result sheet. */
function payOut(tag, title, reward, xp, rows, again) {
  const before = C.levelFromXp(S.xp).level;
  econ.earn(reward, JOB_INFO[mission.type].name);
  econ.addXp(xp);
  S.stats.completed++; S.stats.earned += reward;
  sfx.coin();
  const after = C.levelFromXp(S.xp).level;
  clearMission(); writeSave();
  showResults(tag, title, [["Mukofot", "+" + som(reward)]].concat(rows, [["Tajriba", "+" + xp + " XP"], ["Daraja", after > before ? before + " → " + after : String(after)]]),
    [["Yana missiya", "gold", () => { closeResults(); (again || openJobs)(); }], ["Davom etish", "", closeResults]]);
}
function failMission(title, rows) {
  S.stats.failed++; clearMission(); writeSave(); sfx.tone(180, 0.4);
  showResults("Muvaffaqiyatsiz", title, rows, [["Missiyalar", "primary", () => { closeResults(); openJobs(); }], ["Yopish", "", closeResults]]);
}

function missionTick(dt) {
  const m = mission; if (!m.type) return;
  const kmh = Math.abs(car.vx) * 3.6;
  if (m.type === "delivery" || m.type === "taxi") {
    const res = C.missionStep(m, dt, car.x, car.z, kmh);
    m.phase = res.phase; m.timeLeft = res.timeLeft;
    if (m.type === "taxi" && m.phase === "toDropoff") m.comfort = clamp(m.comfort - Math.max(0, Math.abs(car.ay) - 6.5) * dt * 3, 0, 100);
    if (res.event === "loaded") {
      sfx.click();
      if (m.type === "taxi") { passenger.g.visible = false; toast(m.job.passenger + " oʻtirdi. Manzil: " + m.job.dropoff.name); }
      else toast("Yuk ortildi! Endi: " + m.job.dropoff.name);
    }
    if (res.event === "success") {
      const job = m.job;
      if (m.type === "taxi") {
        const tip = C.taxiTip(job.reward, m.comfort); showPassenger(job.dropoff, 6);
        payOut("Yoʻlovchi yetkazildi", job.passenger + " — " + job.dropoff.name, job.reward + tip, job.xp, [["Yoʻl haqi", som(job.reward)], ["Choychaqa", som(tip)], ["Qulaylik", Math.round(m.comfort) + "%"]]);
      } else {
        const base = Math.round((job.reward * P.cargo) / 1000) * 1000, cut = Math.min(0.4, m.damage * 0.012), reward = Math.round((base * (1 - cut)) / 1000) * 1000;
        payOut("Buyurtma bajarildi", "Yetkazildi: " + job.dropoff.name, reward, job.xp, [["Yuk holati", cut > 0 ? "shikastlandi (−" + Math.round(cut * 100) + "%)" : "butun"], ["Qolgan vaqt", fmtTime(res.timeLeft)]]);
      }
    }
    if (res.event === "failed") failMission("Vaqt tugadi", [["Missiya", m.job.pickup.name + " → " + m.job.dropoff.name], ["Jarima", "yoʻq"]]);
  } else if (m.type === "race") {
    const r = m.race;
    if (m.phase === "toStart" && near(r.start, 8) && kmh < 30) {
      Object.assign(car, { x: r.start.x, z: r.start.z, h: r.start.h, vx: 0, vy: 0, r: 0, steer: 0, gear: 1, mode: "D" });
      m.phase = "countdown"; m.cd = 3.4; m.last = 4;
    } else if (m.phase === "countdown") {
      m.cd -= dt; const n = Math.ceil(m.cd - 0.4);
      if (n !== m.last && n > 0) { m.last = n; big(String(n), false, 0.8); sfx.tone(440, 0.15); }
      if (m.cd <= 0.4 && m.last !== 0) { m.last = 0; big("BOSHLA!", false, 1); sfx.tone(880, 0.4); }
      if (m.cd <= 0.4) { m.phase = "run"; m.time = 0; }
    } else if (m.phase === "run") {
      m.time += dt;
      const p = r.pts[m.idx];
      if (Math.hypot(p[0] - car.x, p[1] - car.z) < C.GATE_RADIUS) {
        m.idx++; sfx.tone(1100, 0.08);
        if (m.idx >= r.pts.length) {
          const md = C.raceMedal(r, m.time);
          if (md.medal) S.stats.medals++;
          payOut("Poyga tugadi", r.name + " — " + md.label, md.pay, md.medal === "gold" ? 180 : md.medal ? 110 : 40, [["Vaqt", fmtLap(m.time)], ["Oltin / kumush / bronza", fmtLap(r.gold) + " / " + fmtLap(r.silver) + " / " + fmtLap(r.bronze)]], () => startRace(r));
        }
      } else if (m.time > r.bronze * 2.5) failMission("Juda sekin", [["Poyga", r.name], ["Vaqt", fmtLap(m.time)]]);
    }
  } else if (m.type === "drift") {
    if (m.phase === "toStart") { if (near(SVC.arena, SVC.arena.r)) beginDrift(); }
    else {
      Object.assign(m, C.driftStep(m, dt, car.slipR || 0, Math.hypot(car.vx, car.vy), inArena(car.x, car.z)));
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) {
        const score = Math.round(m.score), reward = C.driftReward(score), rec = score > S.stats.bestDrift;
        if (rec) S.stats.bestDrift = score;
        if (reward >= 5000) payOut("Drift tugadi", score + " ball" + (rec ? " — yangi rekord!" : ""), reward, Math.min(300, Math.round(score / 25)), [["Rekord", Math.round(S.stats.bestDrift) + " ball"]], startDrift);
        else failMission("Ball yigʻilmadi", [["Maslahat", "Tezlashib, Probel bilan burilishda sirpaning"]]);
      }
    }
  } else if (m.type === "parking") {
    if (m.phase === "toStart") { if (near(SVC.parking, SVC.parking.r + 2)) beginParking(); }
    else {
      m.timeLeft -= dt;
      const a = ((car.h % Math.PI) + Math.PI) % Math.PI, dAng = Math.min(a, Math.PI - a);
      const sc = C.parkingScore(car.x - m.bay.x, car.z - m.bay.z, dAng, m.hits, m.timeLeft);
      m.acc = sc.ok ? sc.score : 0;
      m.hold = sc.ok && Math.abs(car.vx) < 0.25 ? m.hold + dt : 0;
      if (m.hold > 1) payOut("Parkovka", "Aniqlik: " + sc.score + "%", sc.reward, 40 + Math.round(sc.score / 2), [["Urilishlar", String(m.hits)], ["Qolgan vaqt", fmtTime(m.timeLeft)]], startParking);
      else if (m.timeLeft <= 0) failMission("Vaqt tugadi", [["Urilishlar", String(m.hits)]]);
    }
  }
}
/** What the mission card shows right now. */
function missionLine() {
  const m = mission, d = (p) => Math.round(Math.hypot(p.x - car.x, p.z - car.z)) + " m";
  if (m.type === "delivery" || m.type === "taxi") {
    const t = m.phase === "toPickup" ? m.job.pickup : m.job.dropoff;
    const tag = m.type === "taxi" ? (m.phase === "toPickup" ? "Taksi · yoʻlovchini oling" : "Taksi · qulaylik " + Math.round(m.comfort) + "%") : (m.phase === "toPickup" ? "Yukni olish" : "Yetkazib berish");
    return { tag, dest: t.name, time: fmtTime(m.timeLeft), low: m.timeLeft < 15, dist: d(t) };
  }
  if (m.type === "race") {
    if (m.phase !== "run") return { tag: "Tungi poyga", dest: "Startga boring: " + m.race.name, time: "", dist: d(m.race.start) };
    return { tag: m.race.name, dest: "Darvoza " + Math.min(m.idx + 1, m.race.pts.length) + " / " + m.race.pts.length, time: fmtLap(m.time), low: m.time > m.race.bronze, dist: "oltin " + fmtLap(m.race.gold) };
  }
  if (m.type === "drift") {
    if (m.phase !== "run") return { tag: "Drift", dest: "Drift maydoniga boring", time: "", dist: d(SVC.arena) };
    return { tag: "Drift" + (m.drifting ? " · SIRPANISH!" : ""), dest: Math.round(m.score) + " ball", time: fmtTime(m.timeLeft), low: m.timeLeft < 10, dist: "×" + m.combo.toFixed(1) };
  }
  if (m.type === "parking") {
    if (m.phase !== "run") return { tag: "Parkovka ustasi", dest: "Avtoturargohga boring", time: "", dist: d(SVC.parking) };
    return { tag: "Parkovka ustasi", dest: m.acc ? "Aniqlik " + m.acc + "% — toʻxtab turing" : "Belgilangan joyga qoʻying", time: fmtTime(m.timeLeft), low: m.timeLeft < 15, dist: d(m.bay) };
  }
  return null;
}
function navGoal() {
  const m = mission;
  if (m.type === "delivery" || m.type === "taxi") { const p = m.phase === "toPickup" ? m.job.pickup : m.job.dropoff; return { x: p.x, z: p.z, color: JOB_INFO[m.type].color, beam: true }; }
  if (m.type === "race") {
    if (m.phase === "toStart") return { x: m.race.start.x, z: m.race.start.z, color: "#19e3ff", beam: true };
    const p = m.race.pts[Math.min(m.idx, m.race.pts.length - 1)]; return { x: p[0], z: p[1], color: "#19e3ff" };
  }
  if (m.type === "drift") return m.phase === "toStart" ? { x: SVC.arena.x, z: SVC.arena.z, color: "#ff7a1a", beam: true } : null;
  if (m.type === "parking") return m.phase === "toStart" ? { x: SVC.parking.x, z: SVC.parking.z, color: "#5dff9b", beam: true } : { x: m.bay.x, z: m.bay.z, color: "#19e3ff" };
  if (navTarget) return navTarget;
  return null;
}

/* Crashes and pedestrians feed back into the missions. */
onCrash = (dmg, speed, hit) => {
  const m = mission;
  if (m.type === "delivery" && m.phase === "toDropoff") m.damage += dmg;
  if (m.type === "taxi" && m.phase === "toDropoff") m.comfort = Math.max(0, m.comfort - dmg * 2.5 - 5);
  if (m.type === "drift") m.combo = 1;
  if (m.type === "parking" && m.phase === "run") m.hits++;
  if (hit && hit.traffic) toast("Avtohalokat! Holat: " + Math.round(S.condition) + "%");
};
let fineCd = 0, scareCd = 0;
onPedScare = (ped, dist, speed) => {
  if (mission.type === "taxi" && mission.phase === "toDropoff") mission.comfort = Math.max(0, mission.comfort - 12);
  if (speed > 11 && fineCd <= 0) {      // faster than ~40 km/h straight at a pedestrian
    fineCd = 10;
    const fine = Math.min(S.cash, C.FINE_PEDESTRIAN);
    if (fine > 0) econ.spend(fine, "Jarima: piyodaga xavf solish");
    S.stats.fines++; sfx.tone(220, 0.3);
    toast("Jarima " + som(fine) + " — piyodaga xavf soldingiz!");
  } else if (scareCd <= 0) { scareCd = 4; toast("Ehtiyot boʻling — piyodalar!"); }
};

onPedHit = (ped, speed) => {
  const m = mission;
  if (m.type === "taxi" && m.phase === "toDropoff") m.comfort = Math.max(0, m.comfort - 30);
  if (m.type === "delivery" && m.phase === "toDropoff") m.damage += 6;
  fineCd = 6;
  const fine = Math.min(S.cash, C.FINE_PEDESTRIAN * 2);
  if (fine > 0) econ.spend(fine, "Jarima: piyodani urib yuborish");
  S.stats.fines++; fx.hit = Math.min(1, speed / 12);
  toast("Piyodani urib yubordingiz! Jarima " + som(fine));
};

/* ================= Services ================= */
function zoneTick() {
  const kmh = Math.abs(car.vx) * 3.6;
  let z = null;
  for (const s of SERVICES) if (Math.hypot(car.x - s.x, car.z - s.z) < s.r && kmh < 15) z = s;
  if (z && (z.id === "arena" || z.id === "parking") && missionBusy()) z = null;
  if ((z && z.id) !== (activeZone && activeZone.id)) { activeZone = z; renderSvc(); }
  else if (z) refreshSvcNumbers();
}
function renderSvc() {
  const el = $("svc");
  if (!activeZone) { el.hidden = true; return; }
  el.hidden = false; el.style.borderLeftColor = activeZone.color;
  const id = activeZone.id;
  let html = "<h3>" + activeZone.name + "</h3>";
  if (id === "fuel") html += "<div class='line'>Bakda <b id='zA'></b></div><div class='line'>1 litr narxi <b>" + som(C.PRICES.fuelPerLitre) + "</b></div><div class='row'><button class='btn gold grow' id='zFull'></button><button class='btn grow' id='z10'>+10 L</button></div>";
  if (id === "wash") html += "<div class='line'>Iflosligi <b id='zA'></b></div><div class='row'><button class='btn primary grow' id='zWash'>Yuvish · " + som(C.PRICES.wash) + "</button></div>";
  if (id === "repair") html += "<div class='line'>Holati <b id='zA'></b></div><div class='line'>Pachoqlar <b id='zB'></b></div><div class='row'><button class='btn primary grow' id='zFix'></button></div>";
  if (id === "garage") html += "<div class='line'>Oʻyin har 5 soniyada oʻzi saqlanadi.</div><div class='row'><button class='btn primary grow' id='zSave'>Saqlash</button><button class='btn grow' id='zGar'>Mashinalarim</button></div>";
  if (id === "tuning") html += "<div class='line'>Dvigatel, tormoz, shina, nitro, rang, neon, spoyler.</div><div class='row'><button class='btn hot grow' id='zTune'>Tyuningga kirish</button></div>";
  if (id === "dealer") html += "<div class='line'>Yangi mashinalar: " + (C.CAR_IDS.length - 1) + " ta model.</div><div class='row'><button class='btn hot grow' id='zDeal'>Salonga kirish</button></div>";
  if (id === "parking") html += "<div class='line'>Mashinani belgilangan joyga aniq qoʻying va pul ishlang.</div><div class='row'><button class='btn primary grow' id='zPark'>Parkovka missiyasi</button></div>";
  if (id === "arena") html += "<div class='line'>" + C.DRIFT_TIME + " soniya drift. Rekord: <b>" + Math.round(S.stats.bestDrift) + " ball</b></div><div class='row'><button class='btn hot grow' id='zDrift'>Driftni boshlash</button></div>";
  html += "<div id='svcMsg'></div>";
  el.innerHTML = html;
  const on = (bid, fn) => { const b = $(bid); if (b) b.onclick = () => { fn(); refreshSvcNumbers(); }; };
  on("zFull", () => buyFuel(Infinity));
  on("z10", () => buyFuel(10));
  on("zWash", () => { if (S.dirt < 1) return msg("Mashina allaqachon toza"); if (econ.spend(C.PRICES.wash, "Avtomoyka")) { S.dirt = 0; sfx.coin(); toast("Mashina yuvildi"); writeSave(); } else msg(noMoney(C.PRICES.wash)); });
  on("zFix", () => { const c = repairPrice(); if (c <= 0) return msg("Taʼmir kerak emas"); if (econ.spend(c, "Ustaxona taʼmiri")) { S.condition = 100; S.dents = []; pcar.repair(); sfx.coin(); toast("Mashina taʼmirlandi — kuzov tekislandi"); writeSave(); } else msg(noMoney(c)); });
  on("zSave", () => { writeSave(); msg("Saqlandi", true); });
  on("zGar", () => { clearInput(); renderGarage(); show("garage", true); });
  on("zTune", openTuning);
  on("zDeal", openDealer);
  on("zPark", startParking);
  on("zDrift", startDrift);
  refreshSvcNumbers();
}
// Straightening dents costs extra on top of the mechanical repair.
const repairPrice = () => C.repairCost(S.condition) + S.dents.length * 4000;
function msg(t, ok) { const m = $("svcMsg"); if (m) { m.textContent = t; m.style.color = ok ? "var(--ok)" : ""; } }
function buyFuel(max) {
  const missing = C.PRICES.tankLitres - S.fuel;
  if (missing < 0.5) return msg("Bak toʻla");
  const litres = Math.min(Math.ceil(missing), max);
  const cost = litres * C.PRICES.fuelPerLitre;
  if (!econ.spend(cost, "Yoqilgʻi: " + litres + " L")) return msg(noMoney(cost));
  S.fuel = Math.min(C.PRICES.tankLitres, S.fuel + litres);
  if (!engineOn) { engineOn = true; }
  sfx.coin(); toast("+" + litres + " L quyildi"); writeSave();
}
function refreshSvcNumbers() {
  if (!activeZone) return;
  const a = $("zA");
  if (activeZone.id === "fuel") { a.textContent = S.fuel.toFixed(1) + " / " + C.PRICES.tankLitres + " L"; const gap = C.PRICES.tankLitres - S.fuel, miss = gap < 0.5 ? 0 : Math.ceil(gap); const b = $("zFull"); b.textContent = miss ? "Toʻldirish · " + som(miss * C.PRICES.fuelPerLitre) : "Bak toʻla"; b.disabled = !miss; }
  if (activeZone.id === "wash") a.textContent = Math.round(S.dirt) + "%";
  if (activeZone.id === "repair") { a.textContent = Math.round(S.condition) + "%"; $("zB").textContent = S.dents.length + " ta"; const c = repairPrice(); const b = $("zFix"); b.textContent = c ? "Taʼmirlash · " + som(c) : "Taʼmir kerak emas"; b.disabled = !c; }
}

/* ================= Tuning ================= */
const UPGRADES = [
  ["eng", "Dvigatel", "Har bosqich +13% quvvat"],
  ["brk", "Tormoz", "Har bosqich +16% tormoz kuchi"],
  ["tire", "Shinalar", "Har bosqich +6% yoʻl tutishi"],
  ["nitro", "Nitro", "Shift / N₂O tugmasi: qisqa muddatli tezlanish"],
];
function openTuning() { clearInput(); $("tMsg").textContent = ""; renderTuning(); show("tuning", true); }
function renderTuning() {
  const t = S.cars[S.carId];
  $("tTitle").textContent = "“" + carName(S.carId) + "”";
  $("tCash").textContent = som(S.cash);
  let h = "<h3>Kuch</h3>";
  for (const [k, name, desc] of UPGRADES) {
    const max = C.TUNE[k].length - 1, lvl = t[k], price = lvl < max ? C.TUNE[k][lvl + 1] : 0;
    let pips = ""; for (let i = 0; i < max; i++) pips += "<i class='" + (i < lvl ? "on" : "") + "'></i>";
    h += "<div class='up'><b>" + name + "<span class='pips'>" + pips + "</span></b><small>" + desc + "</small><button class='btn sm " + (price ? "hot" : "") + "' data-act='up:" + k + "'" + (price ? "" : " disabled") + ">" + (price ? som(price) : "MAX") + "</button></div>";
  }
  const sw = (list, cur, act) => list.map((c) => "<button style='--c:" + c + "' data-act='" + act + ":" + c + "' aria-pressed='" + (cur === c) + "' aria-label='" + c + "'></button>").join("");
  h += "<h3>Rang · " + som(C.TUNE.paint) + "</h3><div class='sw'>" + sw(C.PAINTS, t.paint, "paint") + "</div>";
  h += "<h3>Neon · " + som(t.neon ? 30000 : C.TUNE.neon) + "</h3><div class='sw'>" + sw(C.NEONS, t.neon, "neon") + "<button class='off' style='--c:transparent' data-act='neon:off' aria-pressed='" + (t.neon === null) + "'>YOʻQ</button></div>";
  h += "<h3>Disklar · " + som(C.TUNE.rim) + "</h3><div class='sw'>" + sw(C.RIMS, t.rim, "rim") + "</div>";
  h += "<h3>Kuzov</h3><div class='row'><button class='btn sm grow' data-act='spoiler'>" + (t.spoiler ? "Spoylerni yechish" : "Spoyler · " + som(C.TUNE.spoiler)) + "</button><button class='btn sm grow' data-act='tint'>" + (t.tint ? "Tonirovkani olish" : "Tonirovka · " + som(C.TUNE.tint)) + "</button></div>";
  $("tBody").innerHTML = h;
}
$("tBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const [act, val] = b.dataset.act.split(":"), t = S.cars[S.carId];
  const buy = (price, label, apply) => {
    if (!econ.spend(price, "Tyuning: " + label)) { $("tMsg").textContent = noMoney(price); sfx.tone(180, 0.2); return; }
    apply(); $("tMsg").textContent = ""; if (price > 0) sfx.coin(); else sfx.click();
    equipCar(); writeSave(); renderTuning();
  };
  if (act === "up") { const price = C.TUNE[val][t[val] + 1]; if (price) buy(price, UPGRADES.find((u) => u[0] === val)[1] + " " + (t[val] + 1), () => t[val]++); }
  else if (act === "paint") { if (t.paint !== val) buy(C.TUNE.paint, "rang", () => (t.paint = val)); }
  else if (act === "rim") { if (t.rim !== val) buy(C.TUNE.rim, "disklar", () => (t.rim = val)); }
  else if (act === "neon") { if (val === "off") { if (t.neon) buy(0, "neon", () => (t.neon = null)); } else if (t.neon !== val) buy(t.neon ? 30000 : C.TUNE.neon, "neon", () => (t.neon = val)); }
  else if (act === "spoiler") buy(t.spoiler ? 0 : C.TUNE.spoiler, "spoyler", () => (t.spoiler = !t.spoiler));
  else if (act === "tint") buy(t.tint ? 0 : C.TUNE.tint, "tonirovka", () => (t.tint = !t.tint));
});
$("bTuneBack").onclick = () => show("tuning", false);

/* ================= Dealer ================= */
let dealSel = "zarba";
const CAR_NOTES = {
  shahar: "Ishonchli shahar sedani. Hamma narsa shundan boshlanadi.",
  chaqqon: "Kichkina mikrofurgon: sekin, lekin yetkazib berishda haq +30%.",
  zarba: "Yengil va chaqqon xetchbek — tor koʻchalar uchun.",
  bars: "Ogʻir yoʻltanlamas: yoʻlsiz joyda ham tortadi, urilishga chidamli, yuk +15%.",
  lochin: "Orqa yuritmali sport kupe — drift uchun eng qulay.",
  tulpor: "Katta dvigatelli muskul-kar: toʻgʻri yoʻlda uchadi.",
  yashin: "Superkar. Eng tez, eng yaxshi tormoz va yoʻl tutish.",
  matiz: "Oʻzbekiston yoʻllarining afsonasi: kichkina, tejamkor, har qanday tor koʻchaga sigʻadi.",
  lacetti: "Har bir oʻzbek oilasining sevimli sedani. Ishonchli va qulay, yuk sigʻimi ham yaxshi.",
  f22: "Drift uchun yigʻilgan BMW: orqa yuritma, keng gʻildiraklar, kuchli dvigatel.",
  m4csl: "BMW'ning eng yengil va eng tez M4 versiyasi. Yoʻlni mahkam ushlaydi.",
  kelajak: "Kelajakdan kelgan konsept: katta gʻildiraklar, yoʻlsiz joyda ham uchadi.",
  eb110: "90-yillar afsonasi — toʻrt turbinali V12, toʻliq yuritma.",
  sesto: "Uglerod tolali yengil superkar (atigi 1000 kg), politsiya rangida. L tugmasi — sirena: yoqsangiz, yoʻldagi mashinalar sizga yoʻl beradi.",
};
function openDealer() {
  clearInput(); if (S.cars[dealSel]) dealSel = C.CAR_IDS.find((id) => !S.cars[id]) || S.carId; $("dMsg").textContent = ""; renderDealer(); show("dealer", true);
  const id = dealSel; withCar(id, () => { if (dealSel === id && !$("dealer").hidden) renderDealer(); }, $("dMsg"));
}
function renderDealer() {
  $("dCash").textContent = som(S.cash);
  $("dCars").innerHTML = C.CAR_IDS.map((id) => {
    const c = C.CARS[id], own = !!S.cars[id];
    return "<button class='carrow' data-car='" + id + "' aria-pressed='" + (id === dealSel) + "'><b>" + c.name + "</b><small>" + c.cls + (c.rwd ? " · orqa yuritma" : "") + "</small><span class='" + (own ? "own" : "") + "'>" + (own ? (id === S.carId ? "Minilgan" : "Sizniki") : som(c.price)) + "</span></button>";
  }).join("");
  const c = C.CARS[dealSel], own = !!S.cars[dealSel];
  const meter = (label, v) => "<div class='meter'><span>" + label + "</span><div class='bar'><i style='width:" + Math.round(clamp(v, 0.05, 1) * 100) + "%'></i></div></div>";
  $("dInfo").innerHTML = "<h3>“" + c.name + "”</h3><p style='margin-bottom:6px'>" + CAR_NOTES[dealSel] + "</p>" +
    meter("Tezlanish", (c.power / c.m) * 1150 / 2.6) + meter("Yoʻl tutishi", (c.grip - 0.8) / 0.55) + meter("Tormoz", c.brake / 1.6) + meter("Chidamlilik", 0.6 / c.tough);
  const b = $("bDealBuy");
  b.textContent = own ? (dealSel === S.carId ? "Shu mashinadasiz" : "Shu mashinaga oʻtirish") : "Sotib olish · " + som(c.price);
  b.disabled = own && dealSel === S.carId;
  const tb = $("bDealTest"); tb.hidden = own; tb.textContent = "Sinov haydovi · 2 daqiqa bepul";
  setPreview(dealSel, own ? S.cars[dealSel].paint : ["#f3f1ec", "#19c2a8", "#1e63d8", "#15171c", "#d8202a", "#ff6a1f", "#f2b619"][C.CAR_IDS.indexOf(dealSel)]);
}
$("dCars").addEventListener("click", (e) => {
  const b = e.target.closest("[data-car]"); if (!b) return;
  const id = b.dataset.car; dealSel = id; $("dMsg").textContent = ""; sfx.click(); renderDealer();
  withCar(id, () => { if (dealSel === id && !$("dealer").hidden) renderDealer(); }, $("dMsg"));
});
$("bDealTest").onclick = () => { const id = dealSel; withCar(id, () => startTestDrive(id), $("dMsg")); };
$("bDealBuy").onclick = () => {
  if (missionBusy()) { $("dMsg").textContent = "Avval missiyani tugating."; return; }
  if (testDrive) equipCar();
  const c = C.CARS[dealSel];
  if (!S.cars[dealSel]) {
    if (!econ.spend(c.price, "Avtosalon: “" + c.name + "”")) { $("dMsg").textContent = noMoney(c.price); sfx.tone(180, 0.2); return; }
    S.cars[dealSel] = Object.assign(C.defaultTune(), { paint: preview.m ? "#" + preview.m.paint.clone().convertLinearToSRGB().getHexString() : C.PAINTS[0] });
    S.condition = 100; S.dents = []; S.dirt = 0; S.fuel = C.PRICES.tankLitres;
    sfx.coin(); toast("Tabriklaymiz! Yangi mashina: “" + c.name + "”");
  } else sfx.click();
  const id = dealSel;
  withCar(id, () => { S.carId = id; equipCar(); writeSave(); renderDealer(); }, $("dMsg"));
};
$("bDealBack").onclick = () => { show("dealer", false); setPreview(null); };

/* ================= Map & GPS ================= */
const mapImg = document.createElement("canvas");
const MAP_PX = 2, MAP_W = 280;   // world ±140 → 560 px
function drawStaticMap() {
  mapImg.width = mapImg.height = MAP_W * MAP_PX;
  const g = mapImg.getContext("2d"), s = MAP_PX, o = MAP_W / 2;
  const X = (x) => (x + o) * s;
  g.fillStyle = "#0b1020"; g.fillRect(0, 0, mapImg.width, mapImg.height);
  BLOCKS.forEach((cx, i) => BLOCKS.forEach((cz, j) => {
    const k = blockKind(cx, cz, i, j);
    g.fillStyle = { apartments: "#1c2238", houses: "#1a2a2a", bazaar: "#3a2c18", fuel: "#3a3016", wash: "#16303f", repair: "#3a1c18", garage: "#173324", tuning: "#3a1530", dealer: "#281a44", parking: "#12303a", arena: "#3a2412", registon: "#123a44", mahalla: "#2a2a1a" }[k];
    g.fillRect(X(cx - 24), X(cz - 24), 48 * s, 48 * s);
  }));
  g.fillStyle = "#3c4666";
  colliders.forEach((c) => { if (c.hx * c.hz > 8) g.fillRect(X(c.x - c.hx), X(c.z - c.hz), c.hx * 2 * s, c.hz * 2 * s); });
  g.fillStyle = "#5a6690";
  ROADS.forEach((r) => { g.fillRect(X(-HALF), X(r - RW / 2), HALF * 2 * s, RW * s); g.fillRect(X(r - RW / 2), X(-HALF), RW * s, HALF * 2 * s); });
  g.beginPath(); g.arc(X(0), X(0), RING * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#1f5a3a"; g.beginPath(); g.arc(X(0), X(0), ISLAND * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#19e3ff"; g.beginPath(); g.arc(X(0), X(0), 2.5 * s, 0, Math.PI * 2); g.fill();
}
function drawMini() {
  const cv = $("mini"), g = cv.getContext("2d"), W = cv.width, scale = W / 190, u = W / 272;   // ±95 m around the car
  g.save(); g.clearRect(0, 0, W, W);
  g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#0b1020"; g.fillRect(0, 0, W, W);
  const k = scale / MAP_PX;
  g.drawImage(mapImg, W / 2 - (car.x + MAP_W / 2) * scale, W / 2 - (car.z + MAP_W / 2) * scale, mapImg.width * k, mapImg.height * k);
  const toS = (x, z) => [W / 2 + (x - car.x) * scale, W / 2 + (z - car.z) * scale];
  g.fillStyle = "#ffffff"; traffic.forEach((t) => { const [sx, sy] = toS(t.x, t.z); g.fillRect(sx - 4 * u, sy - 4 * u, 8 * u, 8 * u); });
  peds.forEach((p) => { if (!p.g.visible) return; const [sx, sy] = toS(p.x, p.z); g.fillStyle = p.down ? "#ff4d4d" : "rgba(255,214,140,0.85)"; g.beginPath(); g.arc(sx, sy, (p.down ? 4 : 2.6) * u, 0, 7); g.fill(); });
  g.font = "700 " + Math.round(13 * u) + "px Manrope, sans-serif"; g.textAlign = "center";
  LANDMARKS.forEach((l) => { const [sx, sy] = toS(l.x, l.z); if (Math.hypot(sx - W / 2, sy - W / 2) > W / 2 - 20) return; g.fillStyle = l.color; g.beginPath(); g.arc(sx, sy, 6 * u, 0, 7); g.fill(); g.fillStyle = "#f1f5ff"; g.fillText(l.name.split(" ")[0], sx, sy - 9 * u); });
  SERVICES.forEach((s) => { const [sx, sy] = toS(s.x, s.z); g.fillStyle = s.color; g.strokeStyle = "#05070f"; g.lineWidth = 3; g.beginPath(); g.arc(sx, sy, 9 * u, 0, Math.PI * 2); g.fill(); g.stroke(); });
  if (mission.type === "race" && mission.phase === "run") { g.fillStyle = "#ff2e88"; mission.race.pts.slice(mission.idx + 1).forEach((p) => { const [sx, sy] = toS(p[0], p[1]); g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.fill(); }); }
  const goal = navGoal();
  if (goal) {
    let [gx, gy] = toS(goal.x, goal.z);
    const dx = gx - W / 2, dy = gy - W / 2, d = Math.hypot(dx, dy), lim = W / 2 - 14;
    g.strokeStyle = goal.color; g.lineWidth = 4; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(W / 2, W / 2);
    if (d > lim) { gx = W / 2 + (dx / d) * lim; gy = W / 2 + (dy / d) * lim; }
    g.lineTo(gx, gy); g.stroke(); g.setLineDash([]);
    g.fillStyle = goal.color; g.beginPath(); g.arc(gx, gy, 11, 0, Math.PI * 2); g.fill();
  }
  // player arrow (screen y = world z)
  g.translate(W / 2, W / 2); g.rotate(-car.h + Math.PI);
  g.fillStyle = "#ffffff"; g.strokeStyle = "#05070f"; g.lineWidth = 3;
  g.scale(u, u); g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function openMap() {
  clearInput();
  const list = $("navList"); list.innerHTML = "";
  const add = (label, color, fn) => { const b = document.createElement("button"); b.className = "btn"; b.innerHTML = "<span class='dot' style='background:" + color + "'></span>" + label; b.onclick = fn; list.appendChild(b); };
  SERVICES.forEach((s) => add(s.name, s.color, () => { navTarget = { x: s.x, z: s.z, color: s.color, name: s.name }; show("mapModal", false); toast("GPS: " + s.name); }));
  LANDMARKS.forEach((s) => add(s.name, s.color, () => { navTarget = { x: s.x, z: s.z, color: s.color, name: s.name }; show("mapModal", false); toast("GPS: " + s.name); }));
  if (navTarget) add("GPSni oʻchirish", "#93a0bd", () => { navTarget = null; show("mapModal", false); });
  const cv = $("bigmap"), g = cv.getContext("2d");
  g.drawImage(mapImg, 0, 0, cv.width, cv.height);
  const s = cv.width / MAP_W, T = (v) => (v + MAP_W / 2) * s;
  SERVICES.forEach((sv) => {
    g.fillStyle = sv.color; g.strokeStyle = "#05070f"; g.lineWidth = 3; g.beginPath(); g.arc(T(sv.x), T(sv.z), 9, 0, Math.PI * 2); g.fill(); g.stroke();
    g.font = "700 12px Manrope, sans-serif"; g.fillStyle = "#f1f5ff"; g.textAlign = "center"; g.fillText(sv.short, T(sv.x), T(sv.z) - 14);
  });
  if (mission.type === "race") { g.strokeStyle = "#ff2e88"; g.lineWidth = 3; g.beginPath(); g.moveTo(T(mission.race.start.x), T(mission.race.start.z)); mission.race.pts.forEach((p) => g.lineTo(T(p[0]), T(p[1]))); g.stroke(); }
  const goal = navGoal();
  if (goal) { g.fillStyle = goal.color; g.beginPath(); g.arc(T(goal.x), T(goal.z), 10, 0, Math.PI * 2); g.fill(); }
  g.save(); g.translate(T(car.x), T(car.z)); g.rotate(-car.h + Math.PI);
  g.fillStyle = "#ffffff"; g.strokeStyle = "#05070f"; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 10); g.lineTo(0, 5); g.lineTo(-10, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
  show("mapModal", true);
}
$("bMapClose").onclick = () => show("mapModal", false);

/* ================= HUD ================= */
let hudT = 0, saveT = 0, miniT = 0;
function hud() {
  const kmh = Math.abs(car.vx) * 3.6;
  const rp = car.rpm / C.Gearbox.REDLINE;
  $("gRpm").style.width = (rp * 100).toFixed(1) + "%";
  $("gSpdT").textContent = Math.round(kmh);
  $("gRpmT").textContent = engineOn ? Math.round(car.rpm / 50) * 50 + " RPM" : "OFF";
  $("gGear").textContent = !engineOn ? "—" : car.mode === "R" ? "R" : "D" + car.gear;
  $("gNitro").style.width = (car.nitro * 100).toFixed(0) + "%";
  $("pGear").textContent = car.mode;
  $("hCash").textContent = som(S.cash);
  const lv = C.levelFromXp(S.xp);
  $("hLvl").textContent = lv.level + "-daraja"; $("hXp").style.width = (lv.current / lv.next * 100) + "%";
  $("hFuel").style.width = (S.fuel / C.PRICES.tankLitres * 100) + "%"; $("hFuelT").textContent = S.fuel.toFixed(1) + "L";
  $("sFuel").classList.toggle("warn", S.fuel < 5);
  $("hCond").style.width = S.condition + "%"; $("hCondT").textContent = Math.round(S.condition) + "%";
  $("sCond").classList.toggle("warn", S.condition < 30);
  $("hDirt").style.width = S.dirt + "%"; $("hDirtT").textContent = Math.round(S.dirt) + "%";
  $("tEngine").classList.toggle("off", !engineOn);
  $("tJob").classList.toggle("hl", !missionBusy());
  const mc = $("mcard"), line = missionLine() || (testDrive ? { tag: "Sinov haydovi", dest: carName(testDrive.id), time: fmtTime(testDrive.t), low: testDrive.t < 15, dist: pcar.hasSiren ? "L — sirena" : "" } : null);
  mc.hidden = !line && !navTarget;
  if (line) {
    $("mcTag").textContent = line.tag; $("mcDest").textContent = line.dest;
    const te = $("mcTime"); te.textContent = line.time; te.classList.toggle("low", !!line.low); te.hidden = !line.time;
    $("mcDist").textContent = line.dist;
  } else if (navTarget) {
    $("mcTag").textContent = "GPS"; $("mcDest").textContent = navTarget.name; $("mcTime").hidden = true;
    $("mcDist").textContent = Math.round(Math.hypot(navTarget.x - car.x, navTarget.z - car.z)) + " m";
  }
}

let rotIgnored = false;
function checkRotate() {
  const touch = matchMedia("(pointer: coarse)").matches;
  show("rotate", mode === "play" && touch && !rotIgnored && window.innerHeight > window.innerWidth);
}
window.addEventListener("resize", () => { resize(); checkRotate(); });

/* Free look: drag anywhere on the 3D view to swing the camera around the car (front, sides, rear).
   While driving it drifts back behind the car a moment after you let go; parked, it stays where you left it. */
const look = { yaw: 0, pitch: 0, id: null, lx: 0, ly: 0, idle: 9, used: false };
(function () {
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || paused || anyModal() || look.id !== null) return;
    look.id = e.pointerId; look.lx = e.clientX; look.ly = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== look.id) return;
    const dx = e.clientX - look.lx, dy = e.clientY - look.ly; look.lx = e.clientX; look.ly = e.clientY;
    look.yaw -= dx * 0.009; look.pitch = clamp(look.pitch + dy * 0.004, -0.25, 0.7); look.idle = 0;
    if (!look.used) { look.used = true; $("lookHint").style.opacity = 0; }
  });
  const up = (e) => { if (e.pointerId === look.id) look.id = null; };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
})();

/* Keep the chase camera out of buildings: walk from the car toward the camera and stop before a wall. */
function pullIn(v) {
  const dx = v.x - car.x, dz = v.z - car.z, d = Math.hypot(dx, dz);
  for (let k = 1; k <= 12; k++) {
    const t = k / 12, px = car.x + dx * t, pz = car.z + dz * t;
    for (const c of nearCols(px, pz)) {
      if ((c.hx < 0.5 && c.hz < 0.5) || c.top < 2.8) continue;
      if (Math.abs(px - c.x) < c.hx + 0.4 && Math.abs(pz - c.z) < c.hz + 0.4) {
        const keep = Math.max(1.5, d * (k - 1) / 12) / d;
        v.x = car.x + dx * keep; v.z = car.z + dz * keep; v.y = Math.max(v.y, 2.6);
        return;
      }
    }
  }
}

/* ================= Main loop ================= */
/* Game clock: in “Avto” one in-game hour passes every 30 seconds (a full day in 12 minutes). */
const TOD_FIXED = { morning: 7.3, day: 13, evening: 18.7, night: 23 };
let clockH = 7, todT = 0;
function clockTick(dt, running) {
  if (settings.tod === "auto") { if (running) clockH = (clockH + dt / 30) % 24; }
  else clockH = TOD_FIXED[settings.tod];
  todT -= dt;
  if (todT <= 0) {
    todT = 0.2; setTimeOfDay(clockH);
    const hh = Math.floor(clockH), mm = Math.floor((clockH - hh) * 60);
    $("hClock").textContent = String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + " · " + todName(clockH);
  }
}
let last = performance.now(), acc = 0, fpsN = 0, fpsT = 0, menuAng = 0, showAng = 0;
const STEP = 1 / 120;
let lowFuelWarned = false;
function simTick(dt) {
  controls(dt);
  acc += dt;
  const x0 = car.x, z0 = car.z;
  while (acc >= STEP) { physicsStep(STEP); acc -= STEP; }
  car.hitCd -= dt; fineCd -= dt; scareCd -= dt;
  // Consumption, dirt, odometer
  const moved = Math.hypot(car.x - x0, car.z - z0);
  S.stats.distance += moved;
  if (engineOn) {
    S.fuel = Math.max(0, S.fuel - (0.0022 + car.throttle * (car.rpm / C.Gearbox.REDLINE) * 0.022 * (car.boosting ? 1.8 : 1)) * dt);
    if (S.fuel <= 0) { engineOn = false; toast("Yoqilgʻi tugadi! GPS orqali shoxobchani toping"); }
    if (S.fuel < 5 && !lowFuelWarned) { lowFuelWarned = true; toast("Yoqilgʻi kam qoldi"); }
    if (S.fuel >= 5) lowFuelWarned = false;
  }
  S.dirt = Math.min(100, S.dirt + moved * (onRoad(car.x, car.z) ? 0.006 : 0.03));
  trafficTick(dt, true);
  pedsTick(dt, true);
  missionTick(dt);
  zoneTick();
  if (navTarget && Math.hypot(navTarget.x - car.x, navTarget.z - car.z) < 9) { toast("Yetib keldingiz: " + navTarget.name); navTarget = null; }
  saveT += dt; if (saveT > 5) { saveT = 0; writeSave(); }
  if (testDrive) { testDrive.t -= dt; if (testDrive.t <= 0) endTestDrive(); }
}
function showcaseTarget() {
  if (mode !== "play") return null;
  if (!$("dealer").hidden) return { x: PODIUM.x, z: PODIUM.z, r: 6.6 };
  if (!$("tuning").hidden || !$("garage").hidden) return { x: car.x, z: car.z, r: 6.4 };
  return null;
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsN++; fpsT += dt; if (fpsT > 0.5) { $("fps").textContent = Math.round(fpsN / fpsT) + " FPS"; fpsN = 0; fpsT = 0; }
  if (mode === "loading") return;
  const t = now / 1000;

  const running = mode === "play" && !paused && !anyModal();
  if (running) simTick(dt);
  else { acc = 0; if (mode === "menu") { trafficTick(dt, false); pedsTick(dt, false); } }

  clockTick(dt, running);
  carVisuals(dt, t);
  sparks.update(dt); smoke.update(dt);
  sfx.update(running ? car.rpm : 0, car.throttle, car.slip, car.boosting);

  // Markers
  markers.forEach((mk) => { mk.ring.material.opacity = 0.55 + Math.sin(t * 3) * 0.3; });
  const goal = mode === "play" ? navGoal() : null;
  target.visible = !!(goal && goal.beam);
  if (goal) {
    const gc = col(goal.color);
    if (goal.beam) { target.position.set(goal.x, 0, goal.z); targetMat.color.copy(gc); targetRingMat.color.copy(gc); }
    gpsArrow.visible = true;
    gpsArrow.position.set(car.x, pcar.sh.H + 1.45 + Math.sin(t * 3) * 0.08, car.z);
    gpsArrow.rotation.y = Math.atan2(goal.x - car.x, goal.z - car.z);
    gpsArrow.children[0].material.color.copy(gc);
  } else gpsArrow.visible = false;
  // Race gates
  if (mission.type === "race" && mission.phase !== "toStart") {
    const r = mission.race;
    gates.forEach((g, k) => {
      const i = mission.idx + k; g.visible = i < r.pts.length;
      if (!g.visible) return;
      const p = r.pts[i], q = i === 0 ? [r.start.x, r.start.z] : r.pts[i - 1];
      g.position.set(p[0], 0, p[1]); g.rotation.y = Math.atan2(p[0] - q[0], p[1] - q[1]);
    });
  } else gates.forEach((g) => (g.visible = false));
  if (bayMark.visible) bayMark.material.opacity = 0.7 + Math.sin(t * 5) * 0.3;
  if (passenger.g.visible) {
    passenger.g.rotation.y = Math.atan2(car.x - passenger.g.position.x, car.z - passenger.g.position.z);
    if (passenger.model) ModelKit.wave(passenger, dt, t);
    else { animPed(passenger, 0, 0); passenger.arms[1].rotation.x = -2.7 + Math.sin(t * 7) * 0.35; }
    if (passengerT > 0) { passengerT -= dt; if (passengerT <= 0) passenger.g.visible = false; }
  }
  if (preview.m) preview.m.g.rotation.y = t * 0.5;
  worldTick(t);

  // Camera
  const sc = showcaseTarget();
  studioLight(!!sc, sc && sc.x, sc && sc.z);
  if (mode === "menu") {
    menuAng += dt * 0.045;
    camera.position.set(Math.sin(menuAng) * 78, 30, Math.cos(menuAng) * 78);
    camera.lookAt(0, 4, 0); camera.fov = 58;
    placeSun(0, 0);
    fx.speed = 0; fx.nitro = 0;
  } else if (sc) {
    showAng += dt * 0.35;
    camera.position.set(sc.x + Math.sin(showAng) * sc.r, 1.9, sc.z + Math.cos(showAng) * sc.r);
    // look slightly to the right of the car so it sits left of the side sheet
    const off = window.innerWidth > 700 ? 1.5 : 0;
    camLook.set(sc.x + Math.cos(showAng) * off, 0.8, sc.z - Math.sin(showAng) * off);
    camera.lookAt(camLook); camera.fov = 44;
    camPos.copy(camera.position);
    placeSun(sc.x, sc.z);
    fx.speed = 0; fx.nitro = 0;
  } else {
    const fx_ = Math.sin(car.h), fz = Math.cos(car.h), v = Math.abs(car.vx);
    if (camMode === "chase") {
      look.idle += dt;
      if (look.id === null && look.idle > 1.6 && v > 2.5) { const k = Math.min(1, dt * 1.8); look.yaw *= 1 - k; look.pitch *= 1 - k; }
      while (look.yaw > Math.PI) look.yaw -= 2 * Math.PI; while (look.yaw < -Math.PI) look.yaw += 2 * Math.PI;
      const yaw = car.h + look.yaw, bx = Math.sin(yaw), bz = Math.cos(yaw), turned = Math.abs(look.yaw) / Math.PI;
      const back = 6.6 + pcar.sh.L * 0.25 + Math.min(v, 40) * 0.045 * (1 - turned);
      const want = new THREE.Vector3(car.x - bx * back, 2.5 + pcar.sh.H * 0.45 + Math.min(v, 40) * 0.014 + look.pitch * back, car.z - bz * back);
      pullIn(want);
      camPos.lerp(want, 1 - Math.pow(look.idle < 0.3 ? 0.00001 : 0.0025, dt));
      pullIn(camPos);
      const ahead = 3 * (1 - Math.min(1, turned * 2));
      camLook.set(car.x + fx_ * ahead, 0.9 + pcar.sh.H * 0.2, car.z + fz * ahead);
      camera.position.copy(camPos);
      // road rumble at speed and a jolt on impact
      const sh = Math.max(0, (v - 22) / 60) * 0.06 + fx.hit * 0.25 + (car.boosting ? 0.03 : 0);
      camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh;
      camera.lookAt(camLook);
      camera.fov = lerp(camera.fov, 60 + Math.min(v, 45) * 0.42 + (car.boosting ? 9 : 0), 0.1);
    } else {
      const lx = Math.cos(car.h), lz = -Math.sin(car.h), e = car.eye;
      camera.position.set(car.x + fx_ * e.z + lx * 0.36, e.y, car.z + fz * e.z + lz * 0.36);
      camera.lookAt(car.x + fx_ * (e.z + 10) + lx * 0.36, e.y - 0.22, car.z + fz * (e.z + 10) + lz * 0.36);
      camera.fov = 74;
    }
    placeSun(car.x, car.z);
    fx.speed = lerp(fx.speed, clamp((v - 13) / 26, 0, 1), 0.08);
    fx.nitro = lerp(fx.nitro, car.boosting ? 1 : 0, 0.12);
  }
  if (window.__cam) { const c = window.__cam; camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); camera.fov = 40; }   // debug / screenshots
  camera.updateProjectionMatrix();
  fx.hit = Math.max(0, fx.hit - dt * 2.2); fx.time = t;

  if (mode === "play") {
    hudT += dt; if (hudT > 0.06) { hudT = 0; hud(); }
    miniT += dt; if (miniT > 0.1) { miniT = 0; drawMini(); }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $("toast").style.opacity = 0; }
    if (bigT > 0) { bigT -= dt; if (bigT <= 0) $("big").style.opacity = 0; }
  }
  renderFrame();
}

/* ================= Boot (staged loading with real progress) ================= */
const steps = [
  ["3D modellar yuklanmoqda…", () => {
    // At start: your own car in full detail, light copies of the street cars and the two showroom cars.
    const sv = C.validateSave(parse(store.get(SAVE_KEY)));
    const boot = [[sv ? sv.carId : "shahar", false], ["lacetti", true], ["matiz", true], ["sesto", true], ["m4csl", true]];
    return ModelKit.load((t) => ($("loadTxt").textContent = t), boot);
  }],
  ["Tungi osmon va yorugʻlik…", () => { buildEnvironment(); worldBefore = new Set(scene.children); }],
  ["Yoʻllar va chorrahalar…", buildGround],
  ...BLOCKS.flatMap((cx, i) => BLOCKS.map((cz, j) => ["Mahallalar quriladi…", () => buildBlock(cx, cz, i, j)])),
  ["Daraxtlar va chiroqlar…", buildTreesLamps],
  ["Neonlar yoqiladi…", flushBatches],
  ["Shahar yigʻilmoqda…", mergeWorld],
  ["Xizmat koʻrsatish joylari…", buildServiceMarkers],
  ["Piyodalar chiqmoqda…", () => { buildPeds(); buildPassenger(); }],
  ["Mashinalar yoʻlga chiqmoqda…", () => { buildTraffic(); buildStaticCars(); }],
  ["Garaj ochilmoqda…", () => { const r = readSave(); if (r.data) { S = r.data; econ = C.createEconomy(S); } worldReady = true; equipCar(); }],
  ["Xarita chiziladi…", drawStaticMap],
  ["Sahna tayyorlanadi…", () => { applyQuality(); renderer.compile(scene, camera); }],
];
let stepI = 0, worldBefore = null;
/* Everything the city build added that never moves (domes, minarets, signs, kerbs…) is merged by material. */
function mergeWorld() {
  const skip = new Set(flags.map((f) => f.m));
  const roots = scene.children.filter((o) => !worldBefore.has(o) && !o.isLight && !o.isInstancedMesh && !o.isPoints && !o.isSprite && !skip.has(o));
  const list = []; roots.forEach((r) => staticMeshes(r, skip).forEach((m) => list.push(m)));
  mergeMeshes(list, scene);
}
function bootFail(err) {
  console.error(err);
  $("loadTxt").textContent = "Yuklashda xato: " + err.message + ". Sahifani yangilang yoki grafika sifatini pasaytiring.";
  $("loadTxt").style.color = "var(--danger)";
}
function boot() {
  if (stepI === 0) $("loadProverb").textContent = proverb();
  try {
    const [label, fn] = steps[stepI];
    $("loadTxt").textContent = label;
    const r = fn();
    const next = () => {
      stepI++;
      $("loadBar").style.width = (stepI / steps.length * 100) + "%";
      if (stepI < steps.length) requestAnimationFrame(boot);
      else {
        placeCarFromSave();
        mode = "menu"; show("loading", false); refreshMenu(); show("menu", true);
        if (saveNotice) $("menuNote").textContent = saveNotice;
      }
    };
    if (r && typeof r.then === "function") r.then(next, bootFail); else next();
  } catch (err) { bootFail(err); }
}
resize();
requestAnimationFrame(boot);
requestAnimationFrame(frame);
window.__uz = { car, inp, startTestDrive, toggleSiren, get pcar() { return pcar; }, get testDrive() { return testDrive; }, physicsStep, controls, simTick, get S() { return S; }, get mission() { return mission; }, startTrip, startRace, startDrift, startParking, recover, openTuning, openDealer, equipCar };
