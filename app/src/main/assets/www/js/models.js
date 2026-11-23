/* UZ AUTO LIFE — 3D model kit: loads GLB/glTF models listed in models/manifest.json and fits them into the game.
   Everything is optional: if a file is missing (or the page is opened as file://) the procedural models stay. */
"use strict";

const ModelKit = (function () {
  const cars = {};          // id -> { scene, cfg, wheels: [...], shape }
  const people = [];        // { cfg, root, scale, minY, clips }
  let manifest = null;

  const re = (list) => (list && list.length ? new RegExp(list.join("|"), "i") : null);
  const matNames = (o) => [].concat(o.material || []).map((m) => m.name || "");

  function loadGLB(url) {
    return new Promise((res, rej) => new THREE.GLTFLoader().load(url, res, undefined, rej));
  }
  /* Fallback for hosts that cannot serve .glb: the same file packed as base64 inside a .js script. */
  function loadPacked(id, src) {
    return new Promise((res, rej) => {
      const done = () => {
        const b64 = window.__GLB && window.__GLB[id]; if (!b64) return rej(new Error("packed model missing"));
        const bin = atob(b64), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        delete window.__GLB[id];
        new THREE.GLTFLoader().parse(buf.buffer, "", res, rej);
      };
      if (window.__GLB && window.__GLB[id]) return done();
      const el = document.createElement("script"); el.src = src; el.onload = done; el.onerror = () => rej(new Error("no " + src));
      document.head.appendChild(el);
    });
  }

  /* Normalise a car model: scale to cfg.length (m), turn so the nose faces +Z, sit on y = 0, centre between the axles.
     Then measure the wheels so physics (axle positions, wheel radius, track) matches the model exactly. */
  /* Vertex reader that understands quantized (normalized integer) glTF attributes. */
  const NORM = (a) => (!a.normalized ? 1 : a.array instanceof Int8Array ? 1 / 127 : a.array instanceof Uint8Array ? 1 / 255 : a.array instanceof Int16Array ? 1 / 32767 : a.array instanceof Uint16Array ? 1 / 65535 : 1);
  /* Remove what is not part of the car itself: showroom floors, shadow planes, spare parts parked below it. */
  function stripExtras(root, cfg) {
    const hide = re(cfg.hide), drop = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (hide && (hide.test(o.name) || matNames(o).some((n) => hide.test(n)))) { drop.push(o); return; }
      if (cfg.dropBelow != null) { const b = new THREE.Box3().setFromObject(o); if (b.max.y < cfg.dropBelow) drop.push(o); }
    });
    drop.forEach((o) => o.parent.remove(o));
  }
  /* Some exports merge all four wheels (or a pair) into one mesh. Split such meshes into one piece per corner,
     sharing the vertex data, so each wheel can roll and steer on its own. */
  function splitCorners(root, cfg) {
    const rx = re(cfg.split); if (!rx) return;
    root.updateMatrixWorld(true);
    const cb = new THREE.Box3().setFromObject(root), cx = (cb.min.x + cb.max.x) / 2, cz = (cb.min.z + cb.max.z) / 2;
    const list = []; root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && matNames(o).some((n) => rx.test(n))) list.push(o); });
    const v = new THREE.Vector3();
    for (const o of list) {
      const g = o.geometry, pa = g.attributes.position, f = NORM(pa), idx = g.index ? g.index.array : null, n = idx ? idx.length : pa.count;
      const parts = [[], [], [], []], P = (i) => v.set(pa.getX(i) * f, pa.getY(i) * f, pa.getZ(i) * f).applyMatrix4(o.matrixWorld);
      for (let t = 0; t < n; t += 3) {
        const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
        let sx = 0, sz = 0; for (const i of [a, b, c]) { P(i); sx += v.x; sz += v.z; }
        parts[(sx / 3 > cx ? 1 : 0) + (sz / 3 > cz ? 2 : 0)].push(a, b, c);
      }
      const used = parts.filter((q) => q.length);
      if (used.length < 2) continue;
      for (const q of used) {
        const ng = new THREE.BufferGeometry();
        for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]);
        ng.setIndex(q);
        // bounds by hand: three r128 would read quantized positions without their scale
        const bb = new THREE.Box3(), w = new THREE.Vector3();
        for (const i of q) bb.expandByPoint(w.set(pa.getX(i) * f, pa.getY(i) * f, pa.getZ(i) * f));
        ng.boundingBox = bb; ng.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
        const m = new THREE.Mesh(ng, o.material); m.name = o.name + "_" + parts.indexOf(q);
        m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
        o.parent.add(m);
      }
      o.parent.remove(o);
    }
  }
  function prepareCar(id, gltf, cfg) {
    const root = gltf.scene;
    root.rotation.y = cfg.rotationY || 0;
    stripExtras(root, cfg);
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = (cfg.length || 4.4) / size.z;
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
    splitCorners(root, cfg);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const tireRe = re(cfg.tireMaterials || ["tire", "tyre", "shina"]);
    const tires = [];
    // A tyre is round, low and smaller than a metre — this skips body panels that happen to share the material.
    root.traverse((o) => {
      if (!o.isMesh || !matNames(o).some((n) => tireRe.test(n))) return;
      const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
      if (sz.y < 1.0 && sz.z < 1.0 && sz.x < 0.6 && Math.abs(sz.y - sz.z) < 0.35 * sz.y && b.min.y < box.min.y + 0.25) tires.push(o);
    });
    // One wheel per corner: tyre pieces in the same corner (tread + sidewall, etc.) are merged into one box.
    const bc = box.getCenter(new THREE.Vector3()), corners = {};
    for (const t of tires) {
      const b = new THREE.Box3().setFromObject(t), c = b.getCenter(new THREE.Vector3()), k = (c.x > bc.x ? "R" : "L") + (c.z > bc.z ? "F" : "B");
      (corners[k] = corners[k] || new THREE.Box3()).union(b);
    }
    const centres = Object.values(corners).map((b) => ({ c: b.getCenter(new THREE.Vector3()), r: (b.max.y - b.min.y) / 2, w: b.max.x - b.min.x }));
    // Shift: x centred, ground at y = 0, z centred between the axles (the physics origin).
    let zc = (box.min.z + box.max.z) / 2;
    if (centres.length >= 4) { const zs = centres.map((w) => w.c.z); zc = (Math.max(...zs) + Math.min(...zs)) / 2; }
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + (cfg.yOffset || 0), -zc);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const wheels = centres.map((w) => ({ x: w.c.x + root.position.x, y: w.c.y + root.position.y, z: w.c.z + root.position.z, r: w.r, w: w.w }));
    const front = wheels.filter((w) => w.z > 0), rear = wheels.filter((w) => w.z <= 0);
    const avg = (a, k) => a.reduce((t, w) => t + w[k], 0) / Math.max(1, a.length);
    const L = box.max.z - box.min.z, W = box.max.x - box.min.x, H = box.max.y;
    const shape = {
      L, W, H,
      a: front.length ? avg(front, "z") : L * 0.3, b: rear.length ? -avg(rear, "z") : L * 0.3,
      wr: wheels.length ? avg(wheels, "r") : 0.33, tw: wheels.length ? avg(wheels, "w") : 0.26,
      // Real centre of the model in physics space (the body may hang further forward or back than the axles).
      zMid: (box.max.z + box.min.z) / 2,
    };
    // Materials: glass, lights, shadows, reflections.
    const glassRe = re(cfg.glassMaterials || ["window", "glass", "oyna"]);
    const headRe = re(cfg.headlightMaterials), tailRe = re(cfg.taillightMaterials), sirenRe = re(cfg.sirenMaterials);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false;
      [].concat(o.material).forEach((m) => {
        m.envMapIntensity = cfg.envMapIntensity || 1.5;
        if (m.normalMap) m.normalScale.set(1, -1);   // glTF normal maps are Y-flipped vs. three's default
        if (glassRe && glassRe.test(m.name) && !(headRe && headRe.test(m.name)) && !(tailRe && tailRe.test(m.name))) {
          m.color.setRGB(0.02, 0.03, 0.045); m.metalness = 0.9; m.roughness = 0.05; m.transparent = true; m.opacity = 0.82; m.map = null;
        }
        if (headRe && headRe.test(m.name)) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 1.6; m.toneMapped = false; }
        if (tailRe && tailRe.test(m.name)) { m.emissive = new THREE.Color(0.9, 0.02, 0.01); m.emissiveIntensity = 0.5; }
        if (sirenRe && sirenRe.test(m.name)) { m.emissiveMap = m.map; m.emissive = new THREE.Color(0.15, 0.15, 0.15); m.toneMapped = false; }
        m.userData.role = sirenRe && sirenRe.test(m.name) ? "siren" : headRe && headRe.test(m.name) ? "head" : tailRe && tailRe.test(m.name) ? "tail" : "";
        m.needsUpdate = true;
      });
    });
    return { scene: root, cfg, wheels, shape };
  }

  async function getModel(id, cfg) {
    try { return await loadGLB(cfg.file); }
    catch (e) { if (!cfg.packed) throw e; return await loadPacked(id, cfg.packed); }
  }

  /* ---------- People: realistic rigged characters sharing one animation library ---------- */
  const qInv = (q) => q.clone().invert();
  // The animation library has no skin (meshes stripped), so its joints are plain nodes: accept any named node there.
  function boneMap(root, anyNode) { const m = {}; root.traverse((o) => { if ((o.isBone || (anyNode && o !== root && o.name)) && !o.isMesh) m[o.name] = o; }); return m; }
  const bare = (n) => n.replace(/^mixamorig:?/, "");
  function findBone(bones, name) { const b = bare(name); return bones[name] || bones["mixamorig" + b] || bones["mixamorig:" + b] || bones[b] || null; }
  /* Copy a clip onto another skeleton. Limbs keep their local rotations (Mixamo-style rigs share bone axes);
     the hips are re-expressed through world space, because each export stores a different rest rotation there. */
  function retarget(clip, src, dst) {
    const tracks = [];
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf("."), node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
      if (prop !== "quaternion") continue;                       // positions differ in scale: keep the target's own
      const sb = findBone(src.bones, node), tb = findBone(dst.bones, node);
      if (!sb || !tb) continue;
      const nt = t.clone(); nt.name = tb.name + ".quaternion";
      if (/Hips$/.test(tb.name)) {
        const Ps = src.parentQ[sb.name], Pt = dst.parentQ[tb.name], qsB = src.bind[sb.name], qtB = dst.bind[tb.name];
        const pre = qInv(Pt).multiply(Ps), post = qInv(qsB).multiply(qInv(Ps)).multiply(Pt).multiply(qtB), q = new THREE.Quaternion();
        const v = nt.values;
        for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i); q.premultiply(pre).multiply(post); q.toArray(v, i); }
      }
      tracks.push(nt);
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }
  /* Full world-space retarget, sampled at 30 fps: each target bone copies the source bone's rotation
     relative to its rest pose, measured in world space. Use it when two rigs store different bone axes. */
  function retargetWorld(clip, srcRoot, src, dst) {
    const order = []; const rootBone = Object.values(dst.bones).find((b) => !b.parent.isBone);
    if (!Object.keys(src.bones).length) return retarget(clip, src, dst);
    if (!rootBone) return retarget(clip, src, dst);
    rootBone.traverse((o) => { if (o.isBone) order.push(o); });
    const wsB = {}, wtB = {};
    for (const k in src.bones) wsB[k] = src.parentQ[k].clone().multiply(src.bind[k]);
    for (const b of order) wtB[b.name] = dst.parentQ[b.name].clone().multiply(dst.bind[b.name]);
    const pair = {}; for (const b of order) { const sb = findBone(src.bones, b.name); if (sb) pair[b.name] = sb; }
    const mixer = new THREE.AnimationMixer(srcRoot), act = mixer.clipAction(clip); act.play();
    const n = Math.max(2, Math.ceil(clip.duration * 30) + 1), times = new Float32Array(n), vals = {};
    order.forEach((b) => (vals[b.name] = new Float32Array(n * 4)));
    const W = {}, ws = new THREE.Quaternion(), tmp = new THREE.Quaternion();
    // The two rigs may face opposite ways: turn the source's world-space motion about Y to match the target.
    const ang = Math.atan2(src.left.z, src.left.x) - Math.atan2(dst.left.z, dst.left.x);
    const Rf = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), RfI = qInv(Rf);
    for (let i = 0; i < n; i++) {
      const t = (clip.duration * i) / (n - 1); times[i] = t;
      mixer.setTime(t); srcRoot.updateMatrixWorld(true);
      for (const b of order) {
        const parentW = b.parent.isBone ? W[b.parent.name] : dst.parentQ[b.name];
        let w;
        if (pair[b.name]) { pair[b.name].getWorldQuaternion(ws); w = Rf.clone().multiply(ws).multiply(qInv(wsB[pair[b.name].name])).multiply(RfI).multiply(wtB[b.name]); }
        else w = parentW.clone().multiply(dst.bind[b.name]);
        W[b.name] = w;
        tmp.copy(parentW).invert().multiply(w); tmp.toArray(vals[b.name], i * 4);
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(srcRoot);
    for (const k in src.bones) src.bones[k].quaternion.copy(src.bind[k]);
    srcRoot.updateMatrixWorld(true);
    const tracks = order.filter((b) => pair[b.name]).map((b) => new THREE.QuaternionKeyframeTrack(b.name + ".quaternion", times, vals[b.name]));
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }
  /* Rest rotations of a rig. With poseClip (a “TPose” clip) the reference pose is that clip's first frame. */
  const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
  /* The rig's own “left” (right hip → left hip), flattened: tells which way the character faces. */
  function leftAxis(bones) {
    const L = findBone(bones, "LeftUpLeg"), R = findBone(bones, "RightUpLeg");
    if (!L || !R) return new THREE.Vector3(1, 0, 0);
    const v = wpos(L).sub(wpos(R)); v.y = 0; return v.normalize();
  }
  /* Bring an A-posed rig into a T-pose: swing each arm segment out to horizontal. */
  function autoTPose(root, bones) {
    root.updateMatrixWorld(true);
    const left = leftAxis(bones), q = new THREE.Quaternion(), pw = new THREE.Quaternion(), w = new THREE.Quaternion();
    for (const side of ["Left", "Right"]) {
      const want = side === "Left" ? left.clone() : left.clone().negate();
      for (const [a, b] of [["Shoulder", "Arm"], ["Arm", "ForeArm"], ["ForeArm", "Hand"]]) {
        const A = findBone(bones, side + a), B = findBone(bones, side + b);
        if (!A || !B || a === "Shoulder") continue;
        const cur = wpos(B).sub(wpos(A)).normalize();
        q.setFromUnitVectors(cur, want);
        A.getWorldQuaternion(w); w.premultiply(q);
        A.parent.getWorldQuaternion(pw); A.quaternion.copy(pw.invert().multiply(w));
        root.updateMatrixWorld(true);
      }
    }
  }
  /* Rest rotations of a rig. pose: a “TPose” clip (first frame used), "auto" to straighten the arms, or nothing. */
  /* Same skeleton: keep every rotation; the hips keep their height motion but not their drift across the floor. */
  function sameRig(clip, dst) {
    const tracks = [];
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf("."), node = t.name.slice(0, dot), prop = t.name.slice(dot + 1), b = dst.bones[node];
      if (!b) continue;
      if (prop === "quaternion") tracks.push(t.clone());
      else if (prop === "position" && /Hips$/.test(node)) {
        const nt = t.clone(), v = nt.values, x0 = b.position.x, z0 = b.position.z;
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
        tracks.push(nt);
      }
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  }
  function rigInfo(root, pose, anyNode) {
    const bones = boneMap(root, anyNode), keep = {};
    for (const k in bones) keep[k] = bones[k].quaternion.clone();
    let mixer = null;
    if (pose && pose.isAnimationClip) { mixer = new THREE.AnimationMixer(root); mixer.clipAction(pose).play(); mixer.setTime(0); }
    else if (pose === "auto") autoTPose(root, bones);
    root.updateMatrixWorld(true);
    const bind = {}, parentQ = {};
    for (const k in bones) { bind[k] = bones[k].quaternion.clone(); parentQ[k] = bones[k].parent.getWorldQuaternion(new THREE.Quaternion()); }
    const left = leftAxis(bones);
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); }
    for (const k in bones) bones[k].quaternion.copy(keep[k]);
    root.updateMatrixWorld(true);
    return { bones, bind, parentQ, left };
  }
  async function loadPeople(m, onStep) {
    if (!m.people || !m.animations || !THREE.SkeletonUtils) return;
    // Several animation libraries (walk cycle, gestures, dance); each brings its own reference T-pose.
    const tpose = (list) => list.find((a) => /t-?pose/i.test(a.name));
    const libs = [].concat(m.animations).map(() => null);
    await Promise.all([].concat(m.animations).map(async (L, i) => {
      try {
        const lib = await getModel(L.id || "anim" + i, L);
        const rest = rigInfo(lib.scene, null, true), T = L.rig ? null : rigInfo(lib.scene, tpose(lib.animations) || "auto", true), clips = {};
        for (const [k, name] of Object.entries(L.clips)) { const c = lib.animations.find((a) => a.name === name); if (c) clips[k] = c; }
        libs[i] = { L, scene: lib.scene, rest, T, clips };
      } catch (e) { console.warn("Animatsiyalar yuklanmadi:", L.file, e && e.message); }
    }));
    if (!libs.some((l) => l && l.clips.walk)) return;
    await Promise.all(m.people.map(async (cfg) => {
      try {
        if (onStep) onStep("3D odamlar: " + (cfg.title || cfg.id) + "…");
        const g = await getModel(cfg.id, cfg);
        const root = g.scene, hide = re(cfg.hide);
        const drop = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          if (hide && (hide.test(o.name) || matNames(o).some((n) => hide.test(n)))) { drop.push(o); return; }
          o.castShadow = true; o.receiveShadow = false;
          // Skinned meshes are culled with a padded bind-pose sphere (animation never leaves it).
          o.geometry.computeBoundingSphere(); o.geometry.boundingSphere.radius *= 1.6; o.frustumCulled = true;
          [].concat(o.material).forEach((mm) => { mm.envMapIntensity = 0.5; });
        });
        drop.forEach((o) => o.parent.remove(o));
        root.updateMatrixWorld(true);
        // Skinned meshes report bind-space bounds, so measure the skeleton instead: toes to the top of the head.
        const dstRig = rigInfo(root), clips = {};
        const dstRigT = cfg.retarget === "local" ? null : rigInfo(root, tpose(g.animations) || "auto");
        let minY = 1e9, maxY = -1e9; const v = new THREE.Vector3();
        for (const k in dstRig.bones) { dstRig.bones[k].getWorldPosition(v); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
        const topBone = findBone(dstRig.bones, "HeadTop_End");
        const h = (maxY - minY) * (topBone ? 1.0 : 1.08), ground = minY - h * 0.012;
        // Later libraries override earlier ones. A library made for one rig (e.g. Ready Player Me) is used only on that
        // rig — that is also what its licence allows — and is copied bone-for-bone, with no retargeting at all.
        for (const S of libs) {
          if (!S) continue;
          const only = S.L.only || S.L.rig;
          if (only && only !== cfg.rig) continue;
          for (const k in S.clips) {
            if (S.L.rig) clips[k] = sameRig(S.clips[k], dstRig);
            else clips[k] = dstRigT ? retargetWorld(S.clips[k], S.scene, S.T, dstRigT) : retarget(S.clips[k], S.rest, dstRig);
          }
        }
        const P = { cfg, root, h, minY: ground, clips, outfits: buildOutfits(root, cfg.recolor) };
        if (cfg.doppi) fitDoppi(P, dstRig.bones);
        people.push(P);
      } catch (e) { console.warn("Odam modeli yuklanmadi:", cfg.id, e && e.message); }
    }));
  }

  /* Clothing colour variants: the outfit texture re-drawn with hue / saturation / brightness filters, so folds,
     seams and buttons stay — only the fabric colour changes. Variants are 512 px to stay light on phones. */
  function buildOutfits(root, rc) {
    if (!rc) return null;
    const out = {};
    root.traverse((o) => {
      if (!o.isMesh || !rc.meshes.includes(o.name) || !o.material.map || !o.material.map.image) return;
      const src = o.material.map, img = src.image, list = [];
      for (const [hue, sat, bri] of rc.variants) {
        const c = document.createElement("canvas"); c.width = c.height = 512;
        const g = c.getContext("2d");
        g.filter = "hue-rotate(" + hue + "deg) saturate(" + sat + ") brightness(" + bri + ")";
        try { g.drawImage(img, 0, 0, 512, 512); } catch (e) { return; }
        const t = new THREE.CanvasTexture(c); t.flipY = src.flipY; t.encoding = src.encoding; t.wrapS = src.wrapS; t.wrapT = src.wrapT; t.anisotropy = 4;
        list.push(t);
      }
      out[o.name] = list;
    });
    return out;
  }

  /* ---------- Chust doʻppi, sized to the actual skull of each character ---------- */
  let DOPPI_MAT = null;
  function doppiMat() {
    if (DOPPI_MAT) return DOPPI_MAT;
    const tex = canvasTex(1024, 256, (g, W, H) => {
      // black velvet with a faint weave
      g.fillStyle = "#0d0e12"; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 2600; i++) { g.fillStyle = "rgba(255,255,255," + (Math.random() * 0.035) + ")"; g.fillRect(Math.random() * W, Math.random() * H, 2, 1); }
      const ink = "#f1ede2", side = W / 4, wall = H * 0.62;
      g.strokeStyle = ink; g.fillStyle = ink;
      for (let k = 0; k < 4; k++) {
        const cx = k * side + side / 2, cy = wall * 0.5, L = wall * 0.36;
        // qalampir: a plump almond pod (white) with a dark crescent inside and a curled stem tip
        g.save(); g.translate(cx, cy); g.rotate(-0.55);
        g.fillStyle = ink; g.beginPath(); g.ellipse(0, 0, L * 0.5, L, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#0d0e12"; g.beginPath(); g.ellipse(L * 0.16, -L * 0.08, L * 0.26, L * 0.72, 0.12, 0, Math.PI * 2); g.fill();
        g.fillStyle = ink; g.beginPath(); g.ellipse(L * 0.24, -L * 0.12, L * 0.1, L * 0.46, 0.12, 0, Math.PI * 2); g.fill();
        g.strokeStyle = ink; g.lineWidth = 6; g.lineCap = "round";
        g.beginPath(); g.moveTo(0, -L * 0.98); g.quadraticCurveTo(L * 0.1, -L * 1.3, L * 0.42, -L * 1.22); g.stroke();
        g.restore();
        // stitched dots and small side leaves
        g.fillStyle = ink;
        for (const [dx, dy] of [[-0.3, -0.25], [0.32, 0.22], [-0.34, 0.3], [0.3, -0.32]]) { g.beginPath(); g.arc(cx + dx * side, cy + dy * wall, 4, 0, 7); g.fill(); }
        g.lineWidth = 3; g.strokeStyle = ink; g.beginPath(); g.arc(k * side, wall * 0.96, side * 0.09, Math.PI, 0); g.stroke();
      }
      // white piping at the rim and a band where wall meets crown
      g.fillRect(0, 0, W, 10); g.fillRect(0, wall - 5, W, 6);
      // crown: four lines meeting at the centre, with a stitched border
      for (let k = 0; k < 4; k++) { const x = k * side + side / 2; g.fillRect(x - 3, wall, 6, H - wall); }
      for (let x = 0; x < W; x += 14) g.fillRect(x, wall + 10, 6, 3);
    });
    tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8;
    DOPPI_MAT = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
    return DOPPI_MAT;
  }
  /* Smooth rounded-square skullcap: superellipse rings (no hard facets), a straight wall that leans in slightly,
     then a soft crown. a, b = half width / half depth at the rim; hgt = wall + crown height. */
  function doppiGeo(a, b, hgt) {
    const SEG = 96, prof = [[1, 0], [0.99, 0.3], [0.977, 0.62], [0.962, 0.72], [0.93, 0.81], [0.85, 0.89], [0.68, 0.95], [0.45, 0.983], [0.22, 0.996], [0, 1]];
    const n = 3.2, pos = [], uv = [], idx = [];
    for (let j = 0; j < prof.length; j++) {
      const [k, y] = prof[j];
      for (let i = 0; i <= SEG; i++) {
        const t = (i / SEG) * Math.PI * 2 + Math.PI / 4, c = Math.cos(t), s = Math.sin(t);
        const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), z = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
        pos.push(x * a * k, y * hgt, z * b * k);
        uv.push(i / SEG, j < 4 ? (y / 0.7) * 0.62 : 0.62 + ((y - 0.7) / 0.3) * 0.38);
      }
    }
    for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < SEG; i++) {
      const A = j * (SEG + 1) + i, B = A + 1, Cc = A + SEG + 1, D = Cc + 1;
      idx.push(A, Cc, B, B, Cc, D);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    // close the seam so shading is continuous where the ring wraps around
    const nr = geo.attributes.normal;
    for (let j = 0; j < prof.length; j++) { const A = j * (SEG + 1), B = A + SEG; const x = (nr.getX(A) + nr.getX(B)) / 2, y = (nr.getY(A) + nr.getY(B)) / 2, z = (nr.getZ(A) + nr.getZ(B)) / 2; nr.setXYZ(A, x, y, z); nr.setXYZ(B, x, y, z); }
    return geo;
  }
  /* Measure the skinned head in its rest pose and seat the cap on the crown, then store that placement
     in the head bone's own space so every clone carries it exactly. */
  function fitDoppi(P, bones) {
    const head = findBone(bones, "Head"); if (!head) return;
    const want = re(P.cfg.headMeshes || ["Head", "Body", "Ch0"]);
    const pts = [], v = new THREE.Vector3();
    P.root.updateMatrixWorld(true);
    P.root.traverse((o) => {
      if (!o.isSkinnedMesh || !want.test(o.name)) return;
      const pa = o.geometry.attributes.position, step = Math.max(1, Math.floor(pa.count / 6000));
      for (let i = 0; i < pa.count; i += step) { v.fromBufferAttribute(pa, i); o.boneTransform(i, v); v.applyMatrix4(o.matrixWorld); pts.push(v.clone()); }
    });
    if (!pts.length) return;
    const hp = head.getWorldPosition(new THREE.Vector3());
    const near = pts.filter((p) => p.y > hp.y - 0.02 && Math.hypot(p.x - hp.x, p.z - hp.z) < 0.16 * (P.h / 1.75));
    if (near.length < 20) return;
    const top = Math.max(...near.map((p) => p.y)), unit = P.h / 1.75;   // works for rigs in metres or centimetres
    const CAP = 0.058 * unit, rim = top - 0.044 * unit, band = near.filter((p) => Math.abs(p.y - rim) < 0.01 * unit);
    if (band.length < 8) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    band.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
    const a = (x1 - x0) / 2 + 0.005 * unit, b = (z1 - z0) / 2 + 0.005 * unit;
    const geo = doppiGeo(a, b, CAP);
    // check the crown clears the skull everywhere; lift the cap until it does
    let lift = 0;
    const pa = geo.attributes.position;
    for (let pass = 0; pass < 6; pass++) {
      let hit = false;
      for (const p of near) {
        const dy = p.y - (rim + lift); if (dy < CAP * 0.6) continue;
        const k = 1 - Math.min(1, Math.max(0, dy / CAP - 0.72) / 0.28) * 0.55;
        const rx = (p.x - (x0 + x1) / 2) / (a * Math.max(0.1, k)), rz = (p.z - (z0 + z1) / 2) / (b * Math.max(0.1, k));
        if (dy > CAP * 0.97 || Math.pow(Math.abs(rx), 3.2) + Math.pow(Math.abs(rz), 3.2) > 1) { hit = true; break; }
      }
      if (!hit) break; lift += 0.004 * unit;
    }
    const world = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, rim + lift, (z0 + z1) / 2);
    P.doppi = { geo, local: new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(world) };
    pa.needsUpdate = true;
  }

  /* A walking city resident, or null when no model of that gender is available. */
  function makePerson(seed, gender) {
    const opts = people.filter((p) => p.cfg.gender === gender);
    if (!opts.length) return null;
    const r = rng(seed * 7919 + 3), P = opts[Math.floor(r() * opts.length)], cfg = P.cfg;
    const inst = THREE.SkeletonUtils.clone(P.root);
    if (settings.quality !== "high") inst.traverse((o) => { if (o.isMesh) o.castShadow = false; });   // people's shadows only on “Yuqori”
    const height = (cfg.height || 1.72) * (0.95 + r() * 0.09), s = height / P.h;
    inst.scale.multiplyScalar(s); inst.position.y = -P.minY * s;
    const g = new THREE.Group(); g.add(inst);
    if (cfg.tint) inst.traverse((o) => {
      const list = o.isMesh && cfg.tint[o.name]; if (!list) return;
      o.material = o.material.clone(); o.material.color.set(list[Math.floor(r() * list.length)]);
    });
    if (P.outfits) inst.traverse((o) => {
      const list = o.isMesh && P.outfits[o.name]; if (!list || !list.length) return;
      o.material = o.material.clone(); o.material.map = list[Math.floor(r() * list.length)]; o.material.color.set("#ffffff");
    });
    // Nobody looks the same: skin tone, build, beard or clean-shaven.
    const V = cfg.variety || {};
    if (V.skin) {
      const tone = V.skin.tones[Math.floor(r() * V.skin.tones.length)], done = new Map();
      inst.traverse((o) => { if (o.isMesh && V.skin.meshes.includes(o.name)) { const m0 = o.material; if (!done.has(m0)) { const m1 = m0.clone(); m1.color.set(tone); done.set(m0, m1); } o.material = done.get(m0); } });
    }
    if (V.shave && r() < V.shave.chance) inst.traverse((o) => { if (o.isMesh && V.shave.meshes.includes(o.name)) o.visible = false; });
    if (V.build) { const k = V.build[0] + r() * (V.build[1] - V.build[0]); inst.scale.x *= k; inst.scale.z *= k; }
    const bones = boneMap(inst), head = findBone(bones, "Head");
    if (P.doppi && head && r() < cfg.doppi) {
      const d = new THREE.Mesh(P.doppi.geo, doppiMat()); d.castShadow = true;
      P.doppi.local.decompose(d.position, d.quaternion, d.scale); head.add(d);
    }
    const faces = [];
    inst.traverse((o) => { if (o.isMesh && o.morphTargetDictionary && o.morphTargetDictionary.mouthOpen != null) faces.push(o); });
    const mixer = new THREE.AnimationMixer(inst), act = {}, w = {};
    for (const k in P.clips) { act[k] = mixer.clipAction(P.clips[k]); act[k].play(); w[k] = k === "walk" ? 1 : 0; act[k].setEffectiveWeight(w[k]); act[k].time = r() * P.clips[k].duration; }
    const dummy = () => ({ rotation: { x: 0 } });
    return {
      g, inst, mixer, act, w, faces, model: true, mood: { talk: 0, smile: 0, open: 0 },
      b: { rArm: findBone(bones, "RightArm"), rFore: findBone(bones, "RightForeArm"), rHand: findBone(bones, "RightHand"), lUp: findBone(bones, "LeftUpLeg"), rUp: findBone(bones, "RightUpLeg") },
      legs: [dummy(), dummy()], arms: [dummy(), dummy()], phase: r() * 6, seed: r(),
    };
  }
  /* Cross-fade to a mode (walk, run, idle, look, agree, shake, sad, samba) and advance the skeleton and face. */
  function animate(p, dt, mode, speed, t) {
    if (!p.act[mode]) mode = p.act.idle ? "idle" : "walk";
    const k = Math.min(1, dt * 5);
    for (const a in p.act) {
      p.w[a] += ((a === mode ? 1 : 0) - p.w[a]) * k;
      const on = p.w[a] > 0.003, A = p.act[a];
      if (on !== A.enabled) A.enabled = on;          // silent clips cost nothing
      if (on) A.setEffectiveWeight(p.w[a]);
    }
    if (p.act.walk) p.act.walk.timeScale = speed || 1;
    p.mixer.update(dt);
    if (p.faces.length) {
      const m = p.mood, time = t || 0;
      const talkWave = m.talk || /^talk/.test(mode) ? Math.max(0, Math.sin(time * 13 + p.seed * 9) * 0.6 + Math.sin(time * 7.3) * 0.4) : 0;
      m.open += (talkWave * 0.55 - m.open) * Math.min(1, dt * 14);
      m.cur = (m.cur || 0) + (m.smile - (m.cur || 0)) * Math.min(1, dt * 4);
      for (const f of p.faces) { f.morphTargetInfluences[f.morphTargetDictionary.mouthOpen] = m.open; if (f.morphTargetDictionary.mouthSmile != null) f.morphTargetInfluences[f.morphTargetDictionary.mouthSmile] = m.cur; }
    }
  }
  const UP = new THREE.Vector3(0, 1, 0), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion();
  /* Turn one bone (in world space) so its segment to the child points along dir; children follow. */
  function aim(bone, child, dir) {
    if (!bone || !child) return;
    const cur = wpos(child).sub(wpos(bone)).normalize();
    tq.setFromUnitVectors(cur, dir.clone().normalize());
    bone.getWorldQuaternion(tq2); tq2.premultiply(tq);
    bone.parent.getWorldQuaternion(tq); bone.quaternion.copy(tq.invert().multiply(tq2));
    bone.updateMatrixWorld(true);
  }
  /* Raise the right arm and wave the hand, on top of whatever the body is doing. */
  function wave(p, dt, t, alreadyAnimated) {
    if (p.act.hail && !alreadyAnimated) { p.mood.smile = 1; animate(p, dt, "hail", 1, t); return; }
    if (p.act.wave && alreadyAnimated) return;   // the clip itself waves
    if (!alreadyAnimated) { p.mood.smile = 1; animate(p, dt, "idle", 1, t); }
    const b = p.b; if (!b.rArm || !b.rFore || !b.rHand || !b.lUp || !b.rUp) return;
    p.inst.updateMatrixWorld(true);
    const out = wpos(b.rUp).sub(wpos(b.lUp)); out.y = 0; out.normalize();
    aim(b.rArm, b.rFore, UP.clone().multiplyScalar(0.55).add(out.clone().multiplyScalar(0.85)));
    aim(b.rFore, b.rHand, UP.clone().add(out.clone().multiplyScalar(0.45 * Math.sin(t * 9))));
  }

  /* ---------- Props: trees and buildings, placed many times with instancing ---------- */
  const props = {};
  async function loadProps(m, onStep) {
    await Promise.all(Object.entries(m.props || {}).map(async ([id, cfg]) => {
      try {
        if (onStep) onStep("3D model: " + (cfg.title || id) + "…");
        const g = await getModel(id, cfg), root = g.scene;
        stripExtras(root, cfg);
        root.rotation.y = cfg.rotationY || 0; root.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3()), s = cfg.height ? cfg.height / size.y : cfg.scale || 1;
        root.scale.setScalar(s); root.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(root);
        root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2); root.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(root);
        const parts = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          [].concat(o.material).forEach((mm) => { mm.envMapIntensity = 0.6; if (cfg.tint && cfg.tint[mm.name]) mm.color.set(cfg.tint[mm.name]); if (cfg.alphaTest && mm.map) { mm.alphaTest = cfg.alphaTest; mm.transparent = false; mm.side = THREE.DoubleSide; } });
          parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
        });
        // Boxes of each material in the prop's own space (e.g. the outer walls, to wrap a tile band around them).
        const boxes = {};
        root.traverse((o) => { if (o.isMesh) matNames(o).forEach((n) => { (boxes[n] = boxes[n] || new THREE.Box3()).union(new THREE.Box3().setFromObject(o)); }); });
        props[id] = { cfg, parts, boxes, size: box.getSize(new THREE.Vector3()) };
        // Style variants: the same building re-dressed (wall colour, trim, awnings) — see restyle().
        (cfg.variants || []).forEach((v, k) => { props[id + "#" + k] = { cfg, size: props[id].size, boxes, parts: parts.map((p) => ({ ...p, material: restyle(p.material, v) })) }; });
        if (cfg.nightWindows) parts.forEach((p) => [].concat(p.material).forEach((mm) => { if (re(cfg.nightWindows).test(mm.name)) NIGHT_MATS.add(mm); }));
      } catch (e) { console.warn("Model yuklanmadi:", id, e && e.message); }
    }));
  }
  /* Atlas (ikat) fabric: the zigzag diamonds of Margʻilon silk, for awnings and canopies. */
  let ATLAS = null;
  function atlasTex() {
    if (ATLAS) return ATLAS;
    ATLAS = canvasTex(256, 256, (g, W, H) => {
      const cols = ["#1b2a6b", "#1cc6b8", "#f2b33d", "#d8323a", "#f4efe2", "#7a2be0"];
      for (let y = 0; y < H; y += 32) for (let x = -32; x < W + 32; x += 32) {
        const c = cols[((x / 32) + (y / 32) * 2 + 12) % cols.length];
        g.fillStyle = c; g.beginPath(); g.moveTo(x, y + 16); g.lineTo(x + 16, y); g.lineTo(x + 32, y + 16); g.lineTo(x + 16, y + 32); g.closePath(); g.fill();
        g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 14, y, 4, 32);       // the soft “blur” edge of ikat dyeing
      }
    });
    ATLAS.wrapS = ATLAS.wrapT = THREE.RepeatWrapping; ATLAS.flipY = false; return ATLAS;
  }
  const NIGHT_MATS = new Set();      // window materials that glow after dark (driven by the time of day)
  /* One style variant: per material either a CSS filter on its texture, a colour, or a replacement map. */
  function restyle(mat, v) {
    const one = (m) => {
      const n = m.name, f = v.filter && v.filter[n], c = v.color && v.color[n], mp = v.map && v.map[n];
      if (!f && !c && !mp) return m;
      const k = m.clone();
      if (f && m.map && m.map.image) {
        const cv = document.createElement("canvas"); cv.width = cv.height = 512;
        const g = cv.getContext("2d"); g.filter = f;
        try { g.drawImage(m.map.image, 0, 0, 512, 512); const t = new THREE.CanvasTexture(cv); t.flipY = m.map.flipY; t.encoding = m.map.encoding; t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT; t.anisotropy = 4; k.map = t; } catch (e) {}
      }
      if (c) k.color.set(c);
      if (mp === "atlas") { k.map = atlasTex(); k.color.set("#ffffff"); }
      if (mp === "girih" && typeof tileTex === "function") { const t = tileTex("girih").clone(); t.needsUpdate = true; t.repeat.set(v.repeat || 4, v.repeat || 4); t.flipY = false; k.map = t; k.color.set("#ffffff"); k.emissive = new THREE.Color(0.25, 0.25, 0.3); k.emissiveMap = t; }
      if (NIGHT_MATS.has(m)) NIGHT_MATS.add(k);
      return k;
    };
    return Array.isArray(mat) ? mat.map(one) : one(mat);
  }

  /* Place a prop many times: list of {x, z, ry, s}. One InstancedMesh per part. */
  /* Instanced copies are grouped in 60 m cells; each cell is shown only when the camera can see it (see cull). */
  const chunks = [];
  function placeProps(id, list, opts) {
    const P = props[id]; if (!P || !list.length) return null;
    const cells = new Map(), CELL = 60, rad = Math.hypot(P.size.x, P.size.y, P.size.z) / 2 * 1.3;
    for (const it of list) { const k = Math.floor(it.x / CELL) + "," + Math.floor(it.z / CELL); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(it); }
    const o = new THREE.Object3D(), m = new THREE.Matrix4(), meshes = [];
    for (const group of cells.values()) {
      const box = new THREE.Box3();
      group.forEach((it) => box.expandByPoint(new THREE.Vector3(it.x, (it.y || 0) + P.size.y * (it.s || 1) / 2, it.z)));
      const sphere = box.getBoundingSphere(new THREE.Sphere()); sphere.radius += rad * Math.max(...group.map((it) => it.s || 1));
      const ims = [];
      for (const part of P.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, group.length);
        group.forEach((it, i) => {
          o.position.set(it.x, it.y || 0, it.z); o.rotation.set(0, it.ry || 0, 0); o.scale.setScalar(it.s || 1); o.updateMatrix();
          m.multiplyMatrices(o.matrix, part.matrix); im.setMatrixAt(i, m);
        });
        im.castShadow = !(opts && opts.noShadow); im.receiveShadow = !(opts && opts.noReceive); im.frustumCulled = false;
        scene.add(im); ims.push(im); meshes.push(im);
      }
      chunks.push({ sphere, meshes: ims, maxDist: (opts && opts.maxDist) || 0 });
    }
    return meshes;
  }
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  function cull(cam) {
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
    const far = cam.far + 20;
    for (const c of chunks) {
      const lim = c.maxDist ? c.maxDist[settings.quality] || far : far;
      const on = frustum.intersectsSphere(c.sphere) && c.sphere.center.distanceTo(cam.position) - c.sphere.radius < Math.min(far, lim);
      for (const m of c.meshes) m.visible = on;
    }
  }

  async function load(onStep, bootCars) {
    try {
      const r = await fetch("models/manifest.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("no manifest");
      manifest = await r.json();
    } catch (e) {
      // Opened as a local file (file://): fetch is blocked, so read the same manifest from a script copy.
      manifest = await new Promise((res) => {
        const el = document.createElement("script"); el.src = "models/manifest.js";
        el.onload = () => res(window.__MODEL_MANIFEST || null); el.onerror = () => res(null); document.head.appendChild(el);
      });
      if (!manifest) return;
    }
    // Only the cars needed right now are loaded at start; the rest arrive when picked in the showroom.
    const jobs = (bootCars || []).map(([id, lod]) => ensureCar(id, lod, onStep));
    jobs.push(loadPeople(manifest, onStep), loadProps(manifest, onStep));
    await Promise.all(jobs);
  }
  const loading = {};
  const keyOf = (id, lod) => (lod ? id + "@lod" : id);
  /* Load one car model (full detail for the player, or the light “lod” copy for traffic and displays). */
  function ensureCar(id, lod, onStep) {
    const base = manifest && manifest.cars && manifest.cars[id];
    if (!base) return Promise.resolve(false);
    if (lod && !base.lod) lod = false;
    const key = keyOf(id, lod);
    if (cars[key]) return Promise.resolve(true);
    if (!loading[key]) loading[key] = (async () => {
      const cfg = lod ? Object.assign({}, base, { file: base.lod, packed: base.lodPacked, split: (base.split || []).concat(base.lodSplit || []) }) : base;
      try {
        if (onStep) onStep("3D model: " + (base.title || id) + "…");
        const g = await getModel(key, cfg);
        cars[key] = prepareCar(id, g, cfg);
        const sh = SHAPES[id] || (SHAPES[id] = Object.assign({}, SHAPES.yashin));
        if (!lod || !sh.model) Object.assign(sh, cars[key].shape, { model: true });
      } catch (e) { console.warn("Model yuklanmadi:", key, cfg.file, e && e.message); }
      return !!cars[key];
    })();
    return loading[key];
  }

  /* Attach a fresh copy of the model to a procedural car (built by buildCar). The procedural body is hidden;
     the model's own wheels are regrouped into spin/steer pivots so they roll and steer like the built-in ones. */
  function dress(car, opts) {
    const id = car.id, key = opts.lod && cars[id + "@lod"] ? id + "@lod" : cars[id] ? id : cars[id + "@lod"] ? id + "@lod" : null;
    const M = key && cars[key]; if (!M) return false;
    const root = M.scene.clone(true);
    if (opts.player) root.traverse((o) => { if (o.isMesh) o.material = [].concat(o.material).length > 1 ? o.material.map((m) => m.clone()) : o.material.clone(); });
    car.tilt.children.forEach((c) => { if (c !== car.spoiler) c.visible = false; });
    car.spoiler.visible = false; car.spoilerAllowed = false;
    car.wheels.forEach((w) => (w.steerG.visible = false));
    const holder = new THREE.Group(); car.tilt.add(holder); holder.add(root);
    car.g.updateMatrixWorld(true);
    // Regroup wheel parts: every mesh whose centre sits inside a tyre's radius belongs to that wheel.
    const caliperRe = re(M.cfg.caliperMaterials || ["calip", "calier"]);
    const parts = [];
    root.traverse((o) => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o); parts.push({ o, c: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()) }); } });
    const newWheels = M.wheels.map((w) => {
      const steerG = new THREE.Group(); steerG.position.set(w.x, w.y, w.z); car.g.add(steerG);
      const spin = new THREE.Group(); steerG.add(spin);
      return { steerG, spin, front: w.z > 0 ? 1 : 0, dir: 1, w };
    });
    car.g.updateMatrixWorld(true);
    for (const p of parts) {
      if (Math.max(p.size.x, p.size.y, p.size.z) > 1.2) continue;     // body panels are never wheel parts
      let best = null, bd = 1e9;
      for (const nw of newWheels) { const d = Math.hypot(p.c.x - nw.w.x, p.c.y - nw.w.y, p.c.z - nw.w.z); if (d < bd) { bd = d; best = nw; } }
      if (!best) continue;
      // Only pieces that sit on the axle and fit inside the wheel turn with it (tyre, rim, disc, hub);
      // calipers may sit off-centre but must still be inside the wheel. Fenders and arches stay with the body.
      const W = best.w, fixed = caliperRe && matNames(p.o).some((n) => caliperRe.test(n));
      const off = Math.hypot(p.c.y - W.y, p.c.z - W.z), inside = p.size.y <= W.r * 2.15 && p.size.z <= W.r * 2.15 && Math.abs(p.c.x - W.x) < Math.max(0.3, W.w);
      if (!inside || off > W.r * (fixed ? 0.85 : 0.35)) continue;
      (fixed ? best.steerG : best.spin).attach(p.o);
    }
    if (newWheels.length >= 4) { car.wheels.length = 0; newWheels.forEach((w) => car.wheels.push(w)); }
    // Light hooks used by the game every frame.
    const byRole = (role) => { const out = []; root.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => { if (m.userData.role === role && !out.includes(m)) out.push(m); }); }); return out; };
    car.model = { root, heads: byRole("head"), tails: byRole("tail"), siren: byRole("siren") };
    car.hasSiren = car.model.siren.length > 0;
    if (car.hasSiren) {
      const b = new THREE.Box3();
      root.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => m.userData.role === "siren")) b.expandByObject(o); });
      const c = b.getCenter(new THREE.Vector3()), half = Math.max(0.18, (b.max.x - b.min.x) / 4);
      const spr = (hex, dx) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: hex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        s.position.set(c.x + dx, b.max.y + 0.04, c.z); s.scale.set(1.7, 1.7, 1); s.visible = false; car.tilt.add(s); return s;
      };
      const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
      const ground = new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: GLOW_TEX, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      ground.scale.set(11, 1, 11); ground.position.y = 0.11; ground.renderOrder = 3; ground.visible = false; car.g.add(ground);
      car.sirenFx = { red: spr(0xff1a1a, -half), blue: spr(0x2a5bff, half), ground };
    }
    return true;
  }

  /* Lit windows after dark: called by the time-of-day system with night = 0..1. */
  function setNight(night) { NIGHT_MATS.forEach((m) => { if (!m.userData.lit) { m.emissive = new THREE.Color(1, 0.66, 0.32); m.emissiveMap = m.map; m.userData.lit = true; m.needsUpdate = true; } m.emissiveIntensity = night * 0.5; }); }
  return { load, dress, makePerson, animate, wave, placeProps, setNight, prop: (id) => props[id] || null, has: (id) => !!(cars[id] || cars[id + "@lod"]), hasFull: (id) => !!cars[id], isModelCar: (id) => !!(manifest && manifest.cars && manifest.cars[id]), ensureCar, cull, hasPeople: () => people.length > 0, get manifest() { return manifest; } };
})();
