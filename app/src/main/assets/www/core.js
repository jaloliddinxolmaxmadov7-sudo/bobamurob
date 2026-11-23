/* UZ AUTO LIFE — core game rules (pure logic, no DOM/3D).
 * Shared by the game page and the Node test suite (tests/core.test.js). */
(function (root) {
  "use strict";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- Gearbox: automatic 5-speed + reverse ---------- */
  const Gearbox = {
    WHEEL_RADIUS: 0.31,
    RATIOS: [3.45, 2.05, 1.42, 1.08, 0.86],
    REVERSE: 3.3,
    FINAL: 4.1,
    IDLE: 850,
    REDLINE: 6400,
    UP: 5600,
    DOWN: 2100,
    PEAK_TORQUE: 160, // Nm
    ratio(gear, reverse) {
      return reverse ? this.REVERSE : this.RATIOS[clamp(gear, 1, 5) - 1];
    },
    /** Engine rpm from road speed (m/s). Torque-converter slip keeps rpm up in 1st/R. */
    rpm(speed, gear, reverse, throttle) {
      const wheelRpm = (Math.abs(speed) / (2 * Math.PI * this.WHEEL_RADIUS)) * 60;
      const coupled = wheelRpm * this.ratio(gear, reverse) * this.FINAL;
      const slip = this.IDLE + throttle * 2200;
      const low = gear === 1 || reverse ? slip : this.IDLE + throttle * 400;
      return clamp(Math.max(coupled, low), this.IDLE, this.REDLINE);
    },
    autoShift(gear, rpm) {
      if (rpm > this.UP && gear < 5) return gear + 1;
      if (rpm < this.DOWN && gear > 1) return gear - 1;
      return gear;
    },
    torque(rpm) {
      if (rpm >= this.REDLINE) return 0;
      const t = 1 - ((rpm - 3900) / 3800) ** 2;
      return this.PEAK_TORQUE * clamp(t, 0.55, 1);
    },
    /** Tractive force at the driven wheels (N). */
    force(rpm, gear, reverse, throttle, powerFactor) {
      return (this.torque(rpm) * this.ratio(gear, reverse) * this.FINAL * 0.88 * throttle * powerFactor) / this.WHEEL_RADIUS;
    },
  };

  /** Damage lowers engine power: 100% condition → 100%, 0% → 40%. */
  const powerFromCondition = (c) => 0.4 + (0.6 * clamp(c, 0, 100)) / 100;

  /* ---------- Levels ---------- */
  function levelFromXp(xp) {
    let level = 1;
    let rest = Math.max(0, Math.floor(xp || 0));
    while (rest >= 500 * level) {
      rest -= 500 * level;
      level++;
    }
    return { level, current: rest, next: 500 * level };
  }

  function formatSom(n) {
    const s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return s + " soʻm";
  }

  /* ---------- Prices (fictional, tunable) ---------- */
  const PRICES = {
    fuelPerLitre: 11000,
    wash: 25000,
    repairPerPoint: 1800,
    startingCash: 500000,
    tankLitres: 45,
  };

  /* ---------- Economy: the only place cash changes ---------- */
  function createEconomy(state) {
    const MAX_TX = 60;
    let txCounter = 0;
    const push = (amount, label) => {
      state.tx.unshift({ id: Date.now() * 100 + (txCounter++ % 100), t: Date.now(), amount, label });
      if (state.tx.length > MAX_TX) state.tx.length = MAX_TX;
    };
    return {
      /** Returns false and changes nothing if funds are insufficient or amount invalid. */
      spend(amount, label) {
        const a = Math.round(amount);
        if (!Number.isFinite(a) || a < 0) return false;
        if (a === 0) return true;
        if (state.cash < a) return false;
        state.cash -= a;
        push(-a, label);
        return true;
      },
      earn(amount, label) {
        const a = Math.round(amount);
        if (!Number.isFinite(a) || a <= 0) return false;
        state.cash += a;
        push(a, label);
        return true;
      },
      addXp(x) {
        if (Number.isFinite(x) && x > 0) state.xp += Math.round(x);
      },
    };
  }

  /* ---------- Services ---------- */
  function refuelQuote(fuel, cash) {
    const missing = Math.max(0, PRICES.tankLitres - fuel);
    const affordable = Math.floor(cash / PRICES.fuelPerLitre);
    const litres = Math.max(0, Math.min(Math.ceil(missing), affordable));
    return { missing, litres, cost: litres * PRICES.fuelPerLitre, fullCost: Math.ceil(missing) * PRICES.fuelPerLitre };
  }
  const repairCost = (condition) => Math.ceil(100 - clamp(condition, 0, 100)) * PRICES.repairPerPoint;

  /* ---------- Cars, tuning (fictional models, tunable numbers) ---------- */
  const CARS = {
    shahar:  { name: "Shahar",  cls: "Sedan",       price: 0,        m: 1150, power: 1.0,  grip: 1.0,  brake: 1.0,  drag: 0.42, rwd: false, cargo: 1.0, tough: 1.0 },
    chaqqon: { name: "Chaqqon", cls: "Mikrofurgon", price: 1200000,  m: 980,  power: 0.82, grip: 0.93, brake: 0.9,  drag: 0.56, rwd: false, cargo: 1.3, tough: 1.0 },
    zarba:   { name: "Zarba",   cls: "Xetchbek",    price: 1800000,  m: 1040, power: 1.22, grip: 1.06, brake: 1.1,  drag: 0.40, rwd: false, cargo: 1.0, tough: 1.0 },
    bars:    { name: "Bars",    cls: "Yoʻltanlamas", price: 4500000, m: 1720, power: 1.55, grip: 1.0,  brake: 1.15, drag: 0.58, rwd: false, cargo: 1.15, tough: 0.6, offroad: true },
    lochin:  { name: "Lochin",  cls: "Sport kupe",  price: 8000000,  m: 1240, power: 1.8,  grip: 1.16, brake: 1.3,  drag: 0.38, rwd: true,  cargo: 1.0, tough: 1.0 },
    tulpor:  { name: "Tulpor",  cls: "Muskul-kar",  price: 13000000, m: 1520, power: 2.35, grip: 1.1,  brake: 1.3,  drag: 0.45, rwd: true,  cargo: 1.0, tough: 0.85 },
    yashin:  { name: "Yashin",  cls: "Superkar",    price: 28000000, m: 1310, power: 2.9,  grip: 1.32, brake: 1.6,  drag: 0.33, rwd: true,  cargo: 1.0, tough: 1.1 },
    matiz:   { name: "Daewoo Matiz", cls: "Mitti xetchbek", price: 900000, m: 830, power: 0.8, grip: 0.96, brake: 0.95, drag: 0.5, rwd: false, cargo: 0.9, tough: 1.1 },
    lacetti: { name: "Chevrolet Lacetti", cls: "Sedan", price: 2600000, m: 1230, power: 1.15, grip: 1.03, brake: 1.05, drag: 0.42, rwd: false, cargo: 1.1, tough: 1.0 },
    f22:     { name: "BMW F22 Eurofighter", cls: "Drift kupe", price: 15000000, m: 1400, power: 2.2, grip: 1.08, brake: 1.35, drag: 0.4, rwd: true, cargo: 1.0, tough: 0.95 },
    m4csl:   { name: "BMW M4 CSL", cls: "Sport kupe", price: 24000000, m: 1625, power: 2.7, grip: 1.25, brake: 1.5, drag: 0.36, rwd: true, cargo: 1.0, tough: 1.0 },
    kelajak: { name: "Future Car", cls: "Konsept yoʻltanlamas", price: 30000000, m: 1500, power: 2.6, grip: 1.2, brake: 1.4, drag: 0.45, rwd: true, cargo: 1.0, tough: 0.7, offroad: true },
    eb110:   { name: "Bugatti EB110 SS", cls: "Superkar", price: 35000000, m: 1420, power: 3.0, grip: 1.3, brake: 1.55, drag: 0.32, rwd: false, cargo: 1.0, tough: 1.05 },
    sesto:   { name: "Lamborghini Sesto Elemento", cls: "Politsiya superkari", price: 40000000, m: 1000, power: 3.2, grip: 1.4, brake: 1.75, drag: 0.31, rwd: true, cargo: 1.0, tough: 1.15, siren: true },
  };
  const CAR_IDS = Object.keys(CARS);
  const TUNE = {
    eng: [0, 300000, 700000, 1500000],
    brk: [0, 200000, 450000],
    tire: [0, 250000, 600000],
    nitro: [0, 400000, 900000],
    paint: 60000, neon: 120000, spoiler: 150000, rim: 80000, tint: 50000,
  };
  const PAINTS = ["#f3f1ec", "#15171c", "#d8202a", "#1e63d8", "#f2b619", "#19c2a8", "#7a2be0", "#ff6a1f", "#3f8f3a", "#ff3d9a", "#8d949c"];
  const NEONS = ["#19e3ff", "#ff2e88", "#7dff4a", "#ffb020", "#a25bff"];
  const RIMS = ["#b8bcc2", "#15171c", "#d9a520", "#ff2e88", "#19e3ff"];
  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  function defaultTune() {
    return { eng: 0, brk: 0, tire: 0, nitro: 0, paint: PAINTS[0], neon: null, spoiler: false, rim: RIMS[0], tint: false };
  }
  function validateTune(r) {
    const d = defaultTune();
    if (!r || typeof r !== "object") return d;
    const lvl = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
    return {
      eng: lvl(r.eng, TUNE.eng.length - 1), brk: lvl(r.brk, TUNE.brk.length - 1), tire: lvl(r.tire, TUNE.tire.length - 1), nitro: lvl(r.nitro, TUNE.nitro.length - 1),
      paint: isHex(r.paint) ? r.paint : d.paint, neon: isHex(r.neon) ? r.neon : null, spoiler: r.spoiler === true, rim: isHex(r.rim) ? r.rim : d.rim, tint: r.tint === true,
    };
  }
  /** Effective performance of a car with its upgrades. */
  function carPerf(id, tune) {
    const c = CARS[id] || CARS.shahar, t = tune || defaultTune();
    return {
      m: c.m, rwd: c.rwd, drag: c.drag, cargo: c.cargo, tough: c.tough, offroad: !!c.offroad,
      power: c.power * (1 + 0.13 * t.eng), grip: c.grip * (1 + 0.06 * t.tire), brake: c.brake * (1 + 0.16 * t.brk),
      nitroBoost: [0, 0.5, 0.8][t.nitro], nitroTime: [0, 4, 6.5][t.nitro],
    };
  }

  /* ---------- Save data ---------- */
  const SAVE_VERSION = 2;
  function defaultSave() {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      cash: PRICES.startingCash,
      xp: 0,
      fuel: PRICES.tankLitres,
      dirt: 0,
      condition: 100,
      carId: "shahar",
      cars: { shahar: defaultTune() },
      dents: [],
      stats: { completed: 0, failed: 0, earned: 0, distance: 0, fines: 0, bestDrift: 0, medals: 0 },
      tx: [],
    };
  }
  const isNum = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

  /** Returns a clean SaveData or null if anything is malformed. Version 1 saves are migrated. */
  function validateSave(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== SAVE_VERSION && raw.version !== 1) return null;
    const s = raw.stats;
    if (!s || typeof s !== "object") return null;
    const checks = [
      isNum(raw.cash, 0, 1e12),
      isNum(raw.xp, 0, 1e9),
      isNum(raw.fuel, 0, PRICES.tankLitres),
      isNum(raw.dirt, 0, 100),
      isNum(raw.condition, 0, 100),
      isNum(s.completed, 0, 1e7),
      isNum(s.failed, 0, 1e7),
      isNum(s.earned, 0, 1e12),
      isNum(s.distance, 0, 1e10),
    ];
    if (checks.includes(false)) return null;
    const tx = Array.isArray(raw.tx)
      ? raw.tx.filter((t) => t && typeof t.label === "string" && Number.isFinite(t.amount) && Number.isFinite(t.t)).slice(0, 60)
      : [];
    const p = raw.pos;
    const pos = p && isNum(p.x, -140, 140) && isNum(p.z, -140, 140) && isNum(p.h, -1e4, 1e4) ? { x: p.x, z: p.z, h: p.h } : null;
    const cars = { shahar: defaultTune() };
    if (raw.cars && typeof raw.cars === "object") for (const id of CAR_IDS) if (raw.cars[id]) cars[id] = validateTune(raw.cars[id]);
    const carId = typeof raw.carId === "string" && cars[raw.carId] ? raw.carId : "shahar";
    const dents = Array.isArray(raw.dents)
      ? raw.dents.filter((d) => d && isNum(d.x, -2, 2) && isNum(d.y, 0, 2) && isNum(d.z, -4, 4) && isNum(d.nx, -1, 1) && isNum(d.nz, -1, 1) && isNum(d.s, 0, 1)).slice(-24)
          .map((d) => ({ x: d.x, y: d.y, z: d.z, nx: d.nx, nz: d.nz, s: d.s }))
      : [];
    const opt = (v, max) => (isNum(v, 0, max) ? v : 0);
    return {
      version: SAVE_VERSION,
      pos,
      savedAt: isNum(raw.savedAt, 0, 1e15) ? raw.savedAt : Date.now(),
      cash: raw.cash,
      xp: raw.xp,
      fuel: raw.fuel,
      dirt: raw.dirt,
      condition: raw.condition,
      carId, cars, dents,
      stats: { completed: s.completed, failed: s.failed, earned: s.earned, distance: s.distance, fines: opt(s.fines, 1e7), bestDrift: opt(s.bestDrift, 1e9), medals: opt(s.medals, 1e7) },
      tx,
    };
  }

  const DEFAULT_SETTINGS = { quality: "mid", showFps: false, controls: "wheel", sensitivity: 1, volume: 0.6, tod: "auto" };
  const TODS = ["auto", "morning", "day", "evening", "night"];
  function validateSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      quality: ["low", "mid", "high"].includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
      showFps: typeof r.showFps === "boolean" ? r.showFps : DEFAULT_SETTINGS.showFps,
      controls: r.controls === "buttons" || r.controls === "wheel" ? r.controls : DEFAULT_SETTINGS.controls,
      sensitivity: isNum(r.sensitivity, 0.5, 1.5) ? r.sensitivity : DEFAULT_SETTINGS.sensitivity,
      volume: isNum(r.volume, 0, 1) ? r.volume : DEFAULT_SETTINGS.volume,
      tod: TODS.includes(r.tod) ? r.tod : DEFAULT_SETTINGS.tod,
    };
  }

  /* ---------- Delivery missions ---------- */
  // Fictional roadside points, each sitting in a driving lane.
  const DELIVERY_POINTS = [
    { name: "Lola choyxonasi", x: -90, z: -57 },
    { name: "Doʻstlik koʻchasi 14", x: -90, z: 63 },
    { name: "Bogʻbon doʻkoni", x: 90, z: -57 },
    { name: "Gulzor mahallasi", x: 90, z: 63 },
    { name: "5-maktab", x: -117, z: 10 },
    { name: "“Issiq non” novvoyxonasi", x: 117, z: 30 },
    { name: "Kitob doʻkoni", x: 30, z: 117 },
    { name: "Oilaviy poliklinika", x: -30, z: -117 },
    { name: "Bozor darvozasi", x: 57, z: 30 },
    { name: "Sport majmuasi", x: -63, z: 90 },
    { name: "Pochta boʻlimi", x: 63, z: -90 },
    { name: "Navroʻz toʻyxonasi", x: -3, z: 95 },
  ];

  /** rand() → [0,1) is injectable for tests. Manhattan distance approximates the grid route. */
  function createDeliveryJob(fromX, fromZ, rand) {
    rand = rand || Math.random;
    const byDist = DELIVERY_POINTS.slice().sort(
      (a, b) => Math.hypot(a.x - fromX, a.z - fromZ) - Math.hypot(b.x - fromX, b.z - fromZ)
    );
    const pickup = byDist[Math.floor(rand() * 3)];
    const far = DELIVERY_POINTS.filter((p) => p !== pickup && Math.hypot(p.x - pickup.x, p.z - pickup.z) > 80);
    const dropoff = far[Math.floor(rand() * far.length)];
    const distance = Math.abs(dropoff.x - pickup.x) + Math.abs(dropoff.z - pickup.z);
    const toPickup = Math.abs(pickup.x - fromX) + Math.abs(pickup.z - fromZ);
    return {
      pickup,
      dropoff,
      distance,
      timeLimit: Math.round((toPickup + distance) / 8 + 40),
      reward: Math.round((18000 + distance * 220) / 1000) * 1000,
      xp: Math.round(60 + distance / 4),
    };
  }

  const ARRIVE_RADIUS = 7;
  const ARRIVE_MAX_KMH = 25;
  /** Pure mission step. Returns {phase, timeLeft, event}. */
  function missionStep(m, dt, x, z, kmh) {
    if (!m.job || (m.phase !== "toPickup" && m.phase !== "toDropoff")) return { phase: m.phase, timeLeft: m.timeLeft, event: null };
    const t = m.timeLeft - dt;
    if (t <= 0) return { phase: "failed", timeLeft: 0, event: "failed" };
    const target = m.phase === "toPickup" ? m.job.pickup : m.job.dropoff;
    const near = Math.hypot(target.x - x, target.z - z) < ARRIVE_RADIUS && Math.abs(kmh) < ARRIVE_MAX_KMH;
    if (near && m.phase === "toPickup") return { phase: "toDropoff", timeLeft: t, event: "loaded" };
    if (near && m.phase === "toDropoff") return { phase: "success", timeLeft: t, event: "success" };
    return { phase: m.phase, timeLeft: t, event: null };
  }

  /* ---------- Taxi ---------- */
  const PASSENGERS = ["Aziz aka", "Dilnoza opa", "Bobur", "Malika", "Jasur", "Nodira xola", "Sardor", "Gulnora", "Otabek", "Zarina"];
  function createTaxiJob(fromX, fromZ, rand) {
    rand = rand || Math.random;
    const j = createDeliveryJob(fromX, fromZ, rand);
    j.passenger = PASSENGERS[Math.floor(rand() * PASSENGERS.length)];
    j.reward = Math.round((22000 + j.distance * 260) / 1000) * 1000;
    j.timeLimit += 15;
    return j;
  }
  /** Tip grows with comfort (0..100): smooth, crash-free rides pay up to +60%. */
  const taxiTip = (reward, comfort) => Math.round((reward * 0.6 * clamp(comfort, 0, 100)) / 100 / 1000) * 1000;

  /* ---------- Street races (time trial through neon gates) ---------- */
  const RACES = [
    { id: "ring", name: "Katta halqa", start: { x: -60, z: 123, h: Math.PI / 2 },
      pts: [[0, 123], [60, 123], [123, 60], [123, 0], [123, -60], [60, -123], [0, -123], [-60, -123], [-123, -60], [-123, 0], [-123, 60], [-90, 123]],
      gold: 64, silver: 78, bronze: 96, pay: 260000 },
    { id: "centre", name: "Markaz aylanasi", start: { x: -100, z: 3, h: Math.PI / 2 },
      pts: [[-40, 3], [40, 3], [57, 40], [20, 57], [-40, 57], [-57, 20], [-57, -40], [-20, -57], [40, -57], [100, -57]],
      gold: 46, silver: 56, bronze: 70, pay: 200000 },
    { id: "sprint", name: "Tungi sprint", start: { x: -112, z: 123, h: Math.PI / 2 },
      pts: [[-40, 123], [40, 123], [112, 123]],
      gold: 12.5, silver: 14.5, bronze: 17.5, pay: 110000 },
  ];
  const GATE_RADIUS = 9;
  function raceMedal(race, time) {
    if (time <= race.gold) return { medal: "gold", label: "Oltin", pay: race.pay };
    if (time <= race.silver) return { medal: "silver", label: "Kumush", pay: Math.round(race.pay * 0.6) };
    if (time <= race.bronze) return { medal: "bronze", label: "Bronza", pay: Math.round(race.pay * 0.35) };
    return { medal: null, label: "Medalsiz", pay: Math.round(race.pay * 0.08) };
  }

  /* ---------- Drift ---------- */
  const DRIFT_TIME = 60;
  /** One scoring step. slip = slip angle (rad), speed m/s. Returns the new {score, combo, chain}. */
  function driftStep(d, dt, slip, speed, inArena) {
    const drifting = slip > 0.22 && speed > 5;
    if (!drifting) return { score: d.score, combo: Math.max(1, d.combo - dt * 1.5), chain: 0, drifting: false };
    const chain = d.chain + dt;
    const combo = Math.min(5, d.combo + dt * 0.45);
    const gain = Math.min(slip, 0.9) * Math.min(speed, 30) * 14 * combo * (inArena ? 1.5 : 1) * dt;
    return { score: d.score + gain, combo, chain, drifting: true };
  }
  const driftReward = (score) => Math.min(320000, Math.round((score * 55) / 1000) * 1000);

  /* ---------- Parking ---------- */
  /** dLat/dLong in metres from the bay centre, dAng in radians (already folded to 0..π/2). */
  function parkingScore(dLat, dLong, dAng, hits, timeLeft) {
    const inBay = Math.abs(dLat) < 0.75 && Math.abs(dLong) < 1.1 && dAng < 0.2;
    if (!inBay) return { ok: false, score: 0, reward: 0 };
    const acc = 1 - (Math.abs(dLat) / 0.75) * 0.4 - (Math.abs(dLong) / 1.1) * 0.3 - (dAng / 0.2) * 0.3;
    const score = Math.round(clamp(acc * 100 - hits * 15, 5, 100));
    const reward = Math.round((25000 + score * 550 + Math.max(0, timeLeft) * 300) / 1000) * 1000;
    return { ok: true, score, reward };
  }

  const FINE_PEDESTRIAN = 50000;

  const Core = {
    clamp,
    Gearbox,
    powerFromCondition,
    levelFromXp,
    formatSom,
    PRICES,
    createEconomy,
    refuelQuote,
    repairCost,
    SAVE_VERSION,
    defaultSave,
    validateSave,
    DEFAULT_SETTINGS,
    validateSettings,
    DELIVERY_POINTS,
    createDeliveryJob,
    missionStep,
    ARRIVE_RADIUS,
    ARRIVE_MAX_KMH,
    CARS, CAR_IDS, TUNE, PAINTS, NEONS, RIMS, defaultTune, validateTune, carPerf,
    createTaxiJob, taxiTip, RACES, GATE_RADIUS, raceMedal, DRIFT_TIME, driftStep, driftReward, parkingScore, FINE_PEDESTRIAN,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.UZCore = Core;
})(typeof globalThis !== "undefined" ? globalThis : this);
