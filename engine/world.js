// ---- Engine: the world runtime. Maps are data handed over by load(); this file knows no particular map, creature or quest. ----
// Movement with eight facings, collision, exits between maps, interiors, the camera, terrain frames in the wind, NPC sight lines,
// weather and time-of-day passes, dark rooms, and the hooks a game fills in (see init(canvas, opts)): act (an action layer), objLight / objArt
// (light radius and art per object kind), drawUnder / drawOver (a game's own drawings), onEncounter / onGrass / onNear / onInteract / onMap...
const WORLD = (() => {
  const TS = 32;
  const SOLID = new Set(['T', 'X', '~', 'F', 'G', 'O', 'R', 'w', 'b', 's', 't', 'p', 'k', 'h', 'm', 'a', 'x', 'n', 'C']);   // a = altar, x = stair, n = bell post (interiors) // C = cave wall
  function rng(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const MAPS = {};   // filled by load(): maps are data (see engine/format.md)
  let M = null, WINDS = {};
  const solidAt = (tx, ty, map) => { const mm = map || M; return tx < 0 || ty < 0 || tx >= mm.W || ty >= mm.H || SOLID.has(mm.grid[ty][tx]); };

  // ---------- drawing ----------
  let terrain = null, terrainScale = 1, terrainFor = null;
  function prerender() {
    terrainFor = M.id; terrainScale = 1;
    terrain = PXW.terrain(M, M.id);
    windClass = 0; lastWind = null; lastPic = null; fade = null;
    if (terrain.anim) PXW.bake(terrain, 0, 0);   // pose 0 with no lean is exactly the old still picture
  }
  // ---------- state ----------
  const P = { x: 8.9 * TS, y: 9.4 * TS, dir: 'down', moving: false, step: 0 };
  const input = { jx: 0, jy: 0, keys: {} };
  // eight facings from a velocity: sectors of 45 degrees around the circle (the player and the follower; NPCs keep four, their sight lines are four-way)
  const dir8 = (vx, vy) => ['right', 'downright', 'down', 'downleft', 'left', 'upleft', 'up', 'upright'][((Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) % 8) + 8) % 8];
  let canvas, ctx, vw = 0, vh = 0, dpr = 1, paused = false, tAnim = 0, opts = {};
  let zoom = 1;
  let lastTile = '', stepsSince = 0, rustle = 0, flash = 0;

  function collides(nx, ny) {
    const hw = 9, top = 6, bot = 2;
    return [[nx - hw, ny - top], [nx + hw, ny - top], [nx - hw, ny + bot], [nx + hw, ny + bot]].some(([x, y]) => {
      const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
      if (tx < 0 || ty < 0 || tx >= M.W || ty >= M.H) { const e = exitAt(tx, ty); if (!e) return true; if (locked(e)) { bump(e); return true; } return false; }
      return SOLID.has(M.grid[ty][tx]) || npcAt(tx, ty) || barricadeAt(tx, ty);
    });
  }
  let NPCS = {};
  const npcAt = (tx, ty) => (NPCS[M.id] || []).some((n) => !n.hidden && n.x === tx && n.y === ty);
  function setupNpcs(list) {
    NPCS = {};
    Object.keys(list).forEach((mapId) => {
      const mm = MAPS[mapId];
      NPCS[mapId] = list[mapId].map((cfg) => {
        const n = Object.assign({ dir: 'down', alert: 0, declined: false, turnT: 2 + Math.random() * 3 }, cfg);
        if (SOLID.has(mm.grid[n.y][n.x]) || mm.grid[n.y][n.x] === 'W' || mm.grid[n.y][n.x] === 'Z') mm.grid[n.y][n.x] = '.';
        n.frames = PXW.frames(n.pal);
        return n;
      });
    });
  }
  function facePlayer(n) {
    const dx = P.x / TS - (n.x + 0.5), dy = P.y / TS - (n.y + 0.9);
    n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  function inSight(n) {
    const tx = Math.floor(P.x / TS), ty = Math.floor(P.y / TS);
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[n.dir];
    for (let k = 1; k <= 4; k++) {
      const x = n.x + v[0] * k, y = n.y + v[1] * k;
      if (x < 0 || y < 0 || x >= M.W || y >= M.H || SOLID.has(M.grid[y][x])) return false;
      if (x === tx && y === ty) return true;
    }
    return false;
  }
  const locked = (e) => !!(opts.exitLocked && opts.exitLocked(e));
  const barricadeAt = (tx, ty) => M.exits.some((e) => {
    if (!locked(e)) return false;
    if (e.edge === 'n') return ty === 1 && tx >= e.a && tx <= e.b; if (e.edge === 's') return ty === M.H - 2 && tx >= e.a && tx <= e.b;
    if (e.edge === 'w') return tx === 1 && ty >= e.a && ty <= e.b; return tx === M.W - 2 && ty >= e.a && ty <= e.b;
  }) && (bump(M.exits.find((e) => locked(e) && (((e.edge === 'n' && ty === 1) || (e.edge === 's' && ty === M.H - 2)) && tx >= e.a && tx <= e.b || ((e.edge === 'w' && tx === 1) || (e.edge === 'e' && tx === M.W - 2)) && ty >= e.a && ty <= e.b))), true);
  let lastBump = -Infinity;
  function bump(e) { const t = performance.now(); if (t - lastBump > 2500 && opts.onLocked) { lastBump = t; opts.onLocked(e); } }
  function nextHop(from, to) { // breadth-first over map exits
    if (!MAPS[to] || from === to) return to;
    const prev = { [from]: null }, q = [from];
    while (q.length) { const c = q.shift(); if (c === to) break; MAPS[c].exits.forEach((e) => { if (!(e.to in prev)) { prev[e.to] = c; q.push(e.to); } }); }
    if (!(to in prev)) return to;
    let c = to; while (prev[c] !== from && prev[c] !== null) c = prev[c]; return c;
  }
  function exitAt(tx, ty) {
    return M.exits.find((e) => (e.edge === 'n' && ty < 0 && tx >= e.a && tx <= e.b) || (e.edge === 's' && ty >= M.H && tx >= e.a && tx <= e.b) || (e.edge === 'w' && tx < 0 && ty >= e.a && ty <= e.b) || (e.edge === 'e' && tx >= M.W && ty >= e.a && ty <= e.b));
  }
  function enter(mapId, edgeFrom) {
    lastNear = null; fishAt = null; trail = []; FOL = null;
    const prev = M ? M.id : null;
    M = MAPS[mapId];
    const spot = (M.arriveFrom && M.arriveFrom[prev]) || M.spawn;
    P.x = spot[0] * TS; P.y = spot[1] * TS; lastTile = ''; stepsSince = 0;
    (NPCS[mapId] || []).forEach((n) => { n.declined = false; n.alert = 0; });
    if (canvas) prerender();
    if (opts.onMap) opts.onMap(M);
  }
  // ---------- map transitions: zoom toward the player, pixelate and darken, swap maps at the midpoint, then settle back ----------
  // go(mapId, pre?) is for real player moves (exits, doors, Travel); enter() stays instant for code and tests.
  // Reduce motion / calm mode: a short fade only. window.__noTransition (test hook) makes go() instant.
  let TR = null, fxC = null;
  function go(mapId, pre) {
    if (TR || !MAPS[mapId]) return;
    if (typeof window !== 'undefined' && window.__noTransition) { if (pre) enter(pre); enter(mapId); return; }
    const still = opts.still ? !!opts.still() : false;
    TR = { t: 0, dur: still ? 0.3 : 0.62, mapId: mapId, pre: pre || null, swapped: false, still: still };
    input.jx = 0; input.jy = 0; input.keys = {}; P.moving = false;
  }
  function stepTR(dt) {
    TR.t += dt;
    if (!TR.swapped && TR.t >= TR.dur / 2) { TR.swapped = true; if (TR.pre) enter(TR.pre); enter(TR.mapId); }
    if (TR.t >= TR.dur) TR = null;
  }
  function transitionFx() { // call last in draw(): everything already drawn is pixelated, zoomed and darkened by how far the transition is
    const u = Math.min(1, TR.t / TR.dur), kk = 1 - Math.abs(u * 2 - 1), k = kk * kk * (3 - 2 * kk), W = canvas.width, H = canvas.height;
    if (TR.still) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(10,14,30,' + (k * 0.9).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return; }
    const px = Math.max(1, Math.round((1 + k * 11) * dpr)), tw = Math.max(1, Math.ceil(W / px)), th = Math.max(1, Math.ceil(H / px)), z = 1 + 0.4 * k;
    if (!fxC) fxC = document.createElement('canvas');
    if (fxC.width !== tw || fxC.height !== th) { fxC.width = tw; fxC.height = th; }
    const f = fxC.getContext('2d'); f.imageSmoothingEnabled = true; f.drawImage(canvas, 0, 0, W, H, 0, 0, tw, th);
    const pc = lastPlayerScreen ? [lastPlayerScreen.x * dpr, (lastPlayerScreen.y - 18) * dpr] : [W / 2, H / 2];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#0A0E1E'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(fxC, 0, 0, tw, th, pc[0] - pc[0] * z, pc[1] - pc[1] * z, tw * px * z, th * px * z);
    ctx.fillStyle = 'rgba(10,14,30,' + (k * k * 0.92).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function nearest() {
    const tx = P.x / TS, ty = P.y / TS; let best = null, bd = 1.7;
    (NPCS[M.id] || []).forEach((n) => { if (n.hidden) return; const d = Math.hypot(tx - (n.x + 0.5), ty - (n.y + 0.9)); if (d < 1.45 && d < bd + 0.3) { bd = Math.min(bd, d); best = { kind: 'npc', npc: n }; } });
    if (best) return best;
    M.places.forEach((p) => { if (p.inert) return; const [dx, dy] = p.door; const d = Math.hypot(tx - (dx + 1), ty - (dy + (dy === p.y && p.h > 1 ? -0.1 : 1.1))); if (d < bd) { bd = d; best = { kind: 'place', place: p }; } });   // a door on the top row of a building is stood at from above (the Arena's gate)
    M.signs.forEach((s) => { const d = Math.hypot(tx - (s.x + 0.5), ty - (s.y + 0.5)); if (d < Math.min(bd, 1.6)) { bd = d; best = { kind: 'sign', sign: s }; } });
    (M.objects || []).forEach((o) => { if (o.hidden) return; const d = Math.hypot(tx - (o.x + 0.5), ty - (o.y + 0.5)); if (d < Math.min(bd, o.reach || 1.7)) { bd = d; best = { kind: 'object', obj: o }; } });
    if (!best && !(M.theme && M.theme.lava) && !M.interior) { // fishing: water next to you
      const fx = Math.floor(tx), fy = Math.floor(ty - 0.3), dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }, f = dirs[P.dir] || [0, 1];
      const cand = [[fx + f[0], fy + f[1]], [fx, fy - 1], [fx, fy + 1], [fx - 1, fy], [fx + 1, fy]];
      const w = cand.find(([x, y]) => M.grid[y] && M.grid[y][x] === '~');
      if (w) best = { kind: 'water', x: w[0], y: w[1] };
    }
    return best;
  }
  let lastNear = null;
  let trail = [], FOL = null, fishAt = null; // follower critter (visual only) + fishing bobber
  function followerReset() { trail = []; FOL = { x: P.x, y: P.y + 2, moving: false }; }
  function followerStep() {
    if (!FOL) followerReset();
    if (Math.hypot(P.x - FOL.x, P.y - FOL.y) > TS * 6) { followerReset(); return; }   // the player was moved far (a teleport): the follower catches up at once
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(P.x - last.x, P.y - last.y) > 2) { trail.push({ x: P.x, y: P.y }); if (trail.length > 60) trail.shift(); }
    let dist = 0, tgt = null;
    for (let i = trail.length - 1; i > 0; i--) { dist += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y); if (dist >= TS * 1.05) { tgt = trail[i - 1]; break; } }
    if (tgt) { const ox = FOL.x, oy = FOL.y; FOL.moving = Math.hypot(tgt.x - FOL.x, tgt.y - FOL.y) > 0.5; FOL.x += (tgt.x - FOL.x) * 0.35; FOL.y += (tgt.y - FOL.y) * 0.35;
      const mx = FOL.x - ox, my = FOL.y - oy; if (Math.hypot(mx, my) > 0.15) { FOL.dir = dir8(mx, my); } if (FOL.moving) FOL.step = (FOL.step || 0) + 0.15; } else FOL.moving = false;
  }
  // critter-lead mode (Settings, with action mode): you steer the critter; the human walks behind it. P stays "the controlled body" for collisions, interactions, exits and the camera.
  let LEAD = false;
  function critterLead(fol) { return !!(fol && fol.img && fol.img.complete && opts.critterLead && opts.critterLead()); }
  function update(dt) {
    if (paused || TR) { P.moving = false; return; }
    followerStep();
    if (opts.act) { const fl = opts.follower ? opts.follower() : null; LEAD = critterLead(fl); if (!LEAD) { P.ox = 0; P.oy = 0; } opts.act.step({ M: M, TS: TS, P: LEAD ? FOL : P, FOL: LEAD ? P : FOL, lead: LEAD, fol: fl, dt: dt, solidAt: (x, y) => solidAt(x, y) }); }
    let vx = input.jx, vy = input.jy; const k = input.keys;
    if (k.ArrowLeft || k.a) vx -= 1; if (k.ArrowRight || k.d) vx += 1; if (k.ArrowUp || k.w) vy -= 1; if (k.ArrowDown || k.s) vy += 1;
    const len = Math.hypot(vx, vy);
    if (len > 0.15) {
      const sp = 4.2 * TS * dt * Math.min(1, len); vx /= len; vy /= len;
      const nx = P.x + vx * sp, ny = P.y + vy * sp;
      if (!collides(nx, P.y)) P.x = nx;
      if (!collides(P.x, ny)) P.y = ny;
      P.dir = dir8(vx, vy);
      P.moving = true; P.step += dt * 9;
    } else P.moving = false;
    // left the map through an exit?
    const tx = Math.floor(P.x / TS), ty = Math.floor(P.y / TS);
    if (tx < 0 || ty < 0 || tx >= M.W || ty >= M.H) { const e = exitAt(tx, ty); if (e) { go(e.to); return; } }
    // grass steps
    const key = tx + ',' + ty;
    if (key !== lastTile) {
      lastTile = key; stepsSince += 1;
      const t = M.grid[ty] && M.grid[ty][tx];
      if (t === 'W' || t === 'Z') {
        rustle = 0.35;
        if (opts.onGrass) opts.onGrass();
        const rate = t === 'Z' ? 0.22 : M.rate;
        if (stepsSince >= 3 && opts.random() < rate && opts.onEncounter && !(opts.act && opts.act.active())) {
          stepsSince = 0;
          opts.onEncounter({ types: M.types, rare: t === 'Z', zone: M.name });
        }
      }
    }
    rustle = Math.max(0, rustle - dt); flash = Math.max(0, flash - dt);
    // trainers watch a straight line in front of them
    (NPCS[M.id] || []).forEach((n) => {
      if (n.hidden) return;
      if (n.trainer) {
        if (!n.declined && n.alert === 0 && opts.canChallenge && opts.canChallenge(n) && inSight(n)) {
          n.declined = true; // one sighting per visit: resets when you re-enter the map
          n.alert = 0.8; paused = true; input.jx = 0; input.jy = 0; if (opts.onAlert) opts.onAlert(n);
          setTimeout(() => { n.alert = 0; if (opts.onSpotted) opts.onSpotted(n); }, 750);
        }
      } else if (!n.leader) { n.turnT -= dt; if (n.turnT <= 0) { n.turnT = 2.5 + Math.random() * 4; n.dir = ['down', 'left', 'right', 'down'][Math.floor(Math.random() * 4)]; } }
    });
    const n = nearest(); const nk = n ? (n.place ? n.place.id : (n.obj ? 'obj' + n.obj.id : n.npc ? 'npc' + n.npc.id : (n.sign ? 'sign' + n.sign.x + ',' + n.sign.y : n.kind + n.x + ',' + n.y))) : null;
    if (nk !== lastNear) { lastNear = nk; if (opts.onNear) opts.onNear(n); }
  }
  let FR = null, lastPlayerScreen = null, lastCam = null, tintNow = 'day';
  function drawPlayer(sx, sy, body) {
    if (!body && opts.carry && opts.carry()) { ctx.fillStyle = '#14101E'; ctx.fillRect(sx - 7, sy - 46, 14, 6); ctx.fillStyle = '#A87A48'; ctx.fillRect(sx - 6, sy - 45, 12, 4); ctx.fillStyle = '#C9986A'; ctx.fillRect(sx - 6, sy - 45, 12, 1); }   // a log carried on the shoulders (Blaze's trial)
    if (!FR) FR = PXW.frames();
    const B = body || P, x = Math.round(sx * dpr) / dpr, y = Math.round(sy * dpr) / dpr;
    if (!body) lastPlayerScreen = { x: x, y: y };
    ctx.fillStyle = 'rgba(10,30,10,0.32)'; ctx.fillRect(x - 10, y - 2, 20, 4); ctx.fillRect(x - 8, y - 4, 16, 8);
    const f = B.moving ? (Math.floor((B.step || 0) / 1.6) % 2 ? 1 : 2) : 0;
    ctx.drawImage(FR[B.dir || 'down'][f], x - 16, y - 38, 32, 40);
    const t = M.grid[Math.floor(B.y / TS)] && M.grid[Math.floor(B.y / TS)][Math.floor(B.x / TS)];
    if (t === 'W' || t === 'Z') {
      const pal = PXW.PAL[M.id] || PXW.PAL.town, sway = rustle > 0 ? (Math.floor(tAnim * 20) % 2) * 2 : 0;
      for (let i = -3; i <= 3; i++) { const bx = x + i * 5 + sway; ctx.fillStyle = pal.tb; ctx.fillRect(bx - 2, y - 8, 4, 10); ctx.fillStyle = t === 'Z' ? '#FFF7D6' : pal.th; ctx.fillRect(bx - 2, y - 10, 2, 4); }
    }
  }
  function drawCritterAt(fol, wx, wy, moving, cx, cy, snap, isBody, dir) {
    const x = snap(wx - cx), y = snap(wy - cy), hop = moving ? Math.abs(Math.sin(tAnim * 12)) * 3 : Math.abs(Math.sin(tAnim * 2)) * 1;
    const im = fol.imgFor ? fol.imgFor(dir || 'down') : fol.img, w = 30, h = Math.round(30 * im.height / Math.max(1, im.width));
    if (isBody) lastPlayerScreen = { x: x, y: y };
    ctx.fillStyle = 'rgba(10,30,10,0.28)'; ctx.fillRect(x - 8, y - 2, 16, 3); ctx.fillRect(x - 6, y - 3, 12, 5);
    ctx.imageSmoothingEnabled = false; const va = isBody && opts.act && opts.act.veilAlpha ? opts.act.veilAlpha() : 1; if (va < 1) ctx.globalAlpha = va; ctx.drawImage(im, Math.round(x - w / 2), Math.round(y - h - hop), w, h); if (va < 1) ctx.globalAlpha = 1;   // veiled (Dusk's verb): drawn faint
    if (fol.shiny && Math.floor(tAnim * 1.5) % 3 === 0) { const sx = x + 10 - (Math.floor(tAnim * 6) % 3) * 6, sy = y - h - 2 - hop; ctx.fillStyle = '#FFF3B0'; ctx.fillRect(sx - 1, sy - 4, 2, 8); ctx.fillRect(sx - 4, sy - 1, 8, 2); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(sx - 1, sy - 1, 2, 2); }
    if (isBody) { const t = M.grid[Math.floor(wy / TS)] && M.grid[Math.floor(wy / TS)][Math.floor(wx / TS)]; if (t === 'W' || t === 'Z') { const pal = PXW.PAL[M.id] || PXW.PAL.town, sway = rustle > 0 ? (Math.floor(tAnim * 20) % 2) * 2 : 0; for (let i = -3; i <= 3; i++) { const bx = x + i * 5 + sway; ctx.fillStyle = pal.tb; ctx.fillRect(bx - 2, y - 8, 4, 10); ctx.fillStyle = t === 'Z' ? '#FFF7D6' : pal.th; ctx.fillRect(bx - 2, y - 10, 2, 4); } } }
  }
  function drawTag(text, sx, sy, gold) {
    ctx.font = '600 13px "Pixelify Sans", Nunito, sans-serif';
    const w = Math.round((ctx.measureText(text).width + 14) / 2) * 2, x = Math.round((sx - w / 2) * dpr) / dpr, y = Math.round((sy - 11) * dpr) / dpr;
    ctx.fillStyle = gold ? '#8A6510' : '#0E1A38'; ctx.fillRect(x, y + 2, w, 18); ctx.fillRect(x + 2, y, w - 4, 22);
    ctx.fillStyle = gold ? '#FFD86B' : '#1E2A4A'; ctx.fillRect(x + 2, y + 2, w - 4, 18);
    ctx.fillStyle = gold ? '#FFF1BF' : '#3A4A78'; ctx.fillRect(x + 2, y + 2, w - 4, 2);
    ctx.fillStyle = gold ? '#2A1B00' : '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2, y + 12);
  }
  // dark dungeons: a dark layer with stepped light circles around the player and around lit objects (braziers, fires)
  let darkC = null;
  // dark dungeons: the screen is covered in 8 px dark blocks whose darkness steps up with the distance to the nearest light (the player, lit braziers, fires).
  // Runs of equal darkness are batched into one fill per level, so there is no offscreen canvas and no full-screen blending.
  const DARK_A = [0.04, 0.12, 0.26, 0.45, 0.68, 0.95], DARK_D = [0.26, 0.42, 0.6, 0.8, 1.0];   // darkness per ring, ring edges as a fraction of the light radius
  function drawDark(cx, cy, pxs, pys) {
    const still = opts.still ? opts.still() : false, flick = still ? 1 : 1 + 0.025 * Math.sin(tAnim * 7), lights = [];
    const add = (x, y, r) => { r *= flick; if (x + r < 0 || x - r > vw || y + r < 0 || y - r > vh) return; lights.push([x, y, r * r]); };
    add(pxs - cx, pys - cy - 14, M.dark.r * TS);
    (M.objects || []).forEach((o) => { const r = opts.objLight ? opts.objLight(o, opts.objState ? opts.objState(o) : null) : 0; if (r) add((o.x + 0.5) * TS - cx, (o.y + 0.5) * TS - cy, r * TS); });
    const C = 8, cols = Math.ceil(vw / C), rows = Math.ceil(vh / C), paths = DARK_A.map(() => new Path2D());
    for (let ry = 0; ry < rows; ry++) {
      const py = ry * C + C / 2; let run = -1, lvl = -1;
      for (let rx = 0; rx <= cols; rx++) {
        let l = -2;
        if (rx < cols) {
          const px = rx * C + C / 2; let best = 9;   // smallest (distance / radius)^2 over all lights
          for (let k = 0; k < lights.length; k++) { const L = lights[k], dx = px - L[0], dy = py - L[1], q = (dx * dx + dy * dy) / L[2]; if (q < best) best = q; }
          l = 5; for (let d = 0; d < 5; d++) if (best < DARK_D[d] * DARK_D[d]) { l = d; break; }
        }
        if (l !== lvl) { if (lvl >= 0) paths[lvl].rect(run * C, ry * C, (rx - run) * C, C); run = rx; lvl = l; }
      }
    }
    DARK_A.forEach((a, k) => { ctx.fillStyle = 'rgba(3,5,16,' + a + ')'; ctx.fill(paths[k]); });
  }
  const hash2 = (a, b, c) => { let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519) ^ Math.imul(c + 99, 3266489917); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // rain ripples / storm whitecaps on visible water tiles (pixel rings, 2 px steps)
  function waterFx(kind, cx, cy) {
    const x0 = Math.max(0, Math.floor(cx / TS)), x1 = Math.min(M.W - 1, Math.floor((cx + vw) / TS)), y0 = Math.max(0, Math.floor(cy / TS)), y1 = Math.min(M.H - 1, Math.floor((cy + vh) / TS));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (M.grid[ty][tx] !== '~') continue;
      const sx = Math.round(tx * TS - cx), sy = Math.round(ty * TS - cy);
      if (kind === 'storm') { // choppy whitecaps flicker on and off
        const f = Math.floor(tAnim * 2.5); ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (let k = 0; k < 2; k++) if (hash2(tx, ty, f * 2 + k) < 0.35) { const ox = Math.floor(hash2(tx, ty, 50 + k + f) * 20) & ~1, oy = (6 + Math.floor(hash2(tx, ty, 90 + k) * 18)) & ~1; ctx.fillRect(sx + ox, sy + oy, 8, 2); ctx.fillRect(sx + ox + 2, sy + oy - 2, 4, 2); }
      } else {
        for (let k = 0; k < 2; k++) { const ph = (tAnim * 0.9 + hash2(tx, ty, k) * 3) % 1.6; if (ph > 0.8) continue;
          const sz = 2 + Math.floor(ph * 8) * 2, ox = 8 + Math.floor(hash2(tx, ty, 10 + k) * 14), oy = 8 + Math.floor(hash2(tx, ty, 20 + k) * 14), a = (1 - ph / 0.8) * 0.55;
          ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; const w = sz * 2, h = sz, x = sx + (ox & ~1) - sz, y = sy + (oy & ~1) - (sz >> 1);
          ctx.fillRect(x + 2, y, w - 4, 2); ctx.fillRect(x + 2, y + h - 2, w - 4, 2); ctx.fillRect(x, y + 2, 2, Math.max(0, h - 4)); ctx.fillRect(x + w - 2, y + 2, 2, Math.max(0, h - 4)); }
      }
    }
  }
  // snow settles on the roofs of ordinary buildings
  function snowCaps(cx, cy) {
    M.places.forEach((p) => {
      if (p.w < 3 || ['board', 'device', 'arena'].indexOf(p.kind) !== -1) return;
      const x = Math.round(p.x * TS - cx), y = Math.round(p.y * TS - cy), w = p.w * TS; if (x > vw + 40 || x + w < -40 || y > vh + 40 || y + p.h * TS < -40) return;
      const roofH = Math.round(p.h * TS * 0.5), capH = Math.max(12, Math.round(roofH * 0.36) & ~1);
      ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fillRect(x + 6, y + 2, w - 12, 4); ctx.fillRect(x + 2, y + 6, w - 4, capH - 4);
      ctx.fillStyle = 'rgba(200,216,238,0.97)'; ctx.fillRect(x + 2, y + capH + 2, w - 4, 2); // shaded lower edge
      for (let i = 0; i < Math.floor((w - 4) / 6); i++) { const dr = ((i * 7 + p.x) % 3) * 2; ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fillRect(x + 2 + i * 6, y + capH + 4, 4, 2 + dr); }
    });
  }
  // ---- wind (Meaning per place: wind is change, so it blows where things change; the cold is stillness, so there it never blows, not even in a storm). Each place has a character: how strong it can get (base) and how much of the time it is calm (calm 0 = it never stops). The strength then changes over time by itself, from three slow waves that never line up, so a sheltered forest breathes now and then and a pass is always moving. ----
  // wind character per region ({ base, calm }) is content, set by the game with setWinds(); an unknown region gets { base: 0.5, calm: 0.4 }
  // (was: { town: { base: 0.5, calm: 0.5 }, moss: { base: 0.55, calm: 0.6 }, tide: { base: 0.85, calm: 0.05 }, ember: { base: 1, calm: 0.25 }, 'route-mf': { base: 0.8, calm: 0.1 }, 'route-cm': { base: 1, calm: 0.25 }, 'route-cc': { base: 0.85, calm: 0.05 }, frost: { base: 0 }, peak: { base: 0 }, 'route-fc': { base: 0 } };
  const hashS = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h ^ (h >>> 15)) >>> 0) / 4294967296; };
  // the wind strength 0..1 of a map at time t (seconds), before weather, night or a gust (a pure function, so tests can sample it)
  function windLevel(mapId, t, region) {
    const c = WINDS[region] || { base: 0.5, calm: 0.4 }; if (!(c.base > 0)) return 0;
    const sd = hashS(mapId), base = Math.min(1, c.base * (0.85 + 0.3 * hashS(mapId + 'b'))), ph1 = sd * 6.28, ph2 = hashS(mapId + 'c') * 6.28, ph3 = hashS(mapId + 'd') * 6.28;
    const n = 0.5 + 0.5 * (0.5 * Math.sin(6.283 * t / 23 + ph1) + 0.3 * Math.sin(6.283 * t / 37 + ph2) + 0.2 * Math.sin(6.283 * t / 61 + ph3));
    if (c.calm < 0.15) return base * (0.75 + 0.25 * n);
    const lo = 0.2 + 0.5 * c.calm; return base * Math.max(0, Math.min(1, (n - lo) / 0.25));
  }
  let gustUntil = 0, lastWind = null, windClass = 0, lastPic = null, fade = null, lastKf = 0, windPh = 0, windT = 0;
  const SIN6F = [0, 0.87, 0.87, 0, -0.87, -0.87];   // the same six poses the trees use
  function windNow() {
    if (M.interior || M.dark || M.cave || (opts.still && opts.still())) return { A: 0, fps: 0, s: 0 };
    const rg = typeof WEATHER !== 'undefined' && WEATHER.region ? WEATHER.region(M.id) : null; if (!((WINDS[rg] || { base: 0.5 }).base > 0)) return { A: 0, fps: 0, s: 0 };
    let s = windLevel(M.id, performance.now() / 1000, rg);
    const wk = opts.weather ? opts.weather() : null; if (wk === 'storm') s = Math.min(1, s * 1.4 + 0.25); else if (wk === 'rain') s = Math.min(1, s * 1.15); else if (wk === 'fog') s *= 0.5;
    if ((opts.tint ? opts.tint() : 'day') === 'night') s *= 0.6;   // the night is calmer
    if (performance.now() < gustUntil) s = 1;
    if (typeof window.__wind === 'number') s = window.__wind;   // test hook
    const prev = windClass, cls = s < (prev === 0 ? 0.14 : 0.1) ? 0 : (s >= (prev === 2 ? 0.66 : 0.74) ? 2 : 1); windClass = cls;   // a little hysteresis, so a strength hovering at a threshold does not flicker
    return { A: cls, fps: 1.5 + 1.5 * s, s: s };
  }
  function draw() {
    if (!terrain || terrainFor !== M.id) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mw = M.W * TS, mh = M.H * TS;
    // camera is built from the player's snapped position, so the player never moves relative to the screen
    const snap = (v) => Math.round(v * dpr) / dpr;
    const pxs = snap(P.x), pys = snap(P.y);
    let cx = pxs - snap(vw / 2), cy = pys - snap(vh * 0.55);
    cx = snap(mw <= vw ? (mw - vw) / 2 : Math.max(0, Math.min(mw - vw, cx)));
    cy = snap(mh <= vh ? (mh - vh) / 2 : Math.max(0, Math.min(mh - vh, cy)));
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = M.theme.bg; ctx.fillRect(0, 0, vw, vh);
    // the picture is one of six baked frames (the still terrain plus the trees, grass, flowers and water in that pose); only the part on screen is copied
    let pic = terrain;
    // the pose is the running SUM of (speed x time), never time x speed: when the wind changes the pose keeps going from where it was instead of jumping
    if (terrain.anim) { const wd = windNow(); windPh += wd.fps * Math.min(0.1, Math.max(0, tAnim - windT)); windT = tAnim; const kf = wd.A ? Math.floor(windPh) % 6 : 0; lastKf = kf; if (lastWind && lastWind.A !== wd.A && lastPic) fade = { pic: lastPic, t0: performance.now() }; lastWind = wd; pic = terrain.anim.sets[wd.A] && terrain.anim.sets[wd.A][kf]; if (!pic) { const have = PXW.baked(terrain, wd.A); pic = have.length ? have[0] : PXW.bake(terrain, kf, wd.A); } PXW.fill(terrain, wd.A, performance.now()); lastPic = pic; }
    const sx0 = Math.max(0, Math.floor(cx / 2)), sy0 = Math.max(0, Math.floor(cy / 2)), sw = Math.max(1, Math.min(pic.width - sx0, Math.ceil(vw / 2) + 2)), sh = Math.max(1, Math.min(pic.height - sy0, Math.ceil(vh / 2) + 2));
    const fp = fade ? (performance.now() - fade.t0) / 300 : 1;   // a change of wind class fades over 0.3 s instead of jumping
    if (fade && fp < 1 && fade.pic.width === pic.width) { ctx.drawImage(fade.pic, sx0, sy0, sw, sh, sx0 * 2 - cx, sy0 * 2 - cy, sw * 2, sh * 2); ctx.globalAlpha = Math.max(0, fp); ctx.drawImage(pic, sx0, sy0, sw, sh, sx0 * 2 - cx, sy0 * 2 - cy, sw * 2, sh * 2); ctx.globalAlpha = 1; } else { fade = null; ctx.drawImage(pic, sx0, sy0, sw, sh, sx0 * 2 - cx, sy0 * 2 - cy, sw * 2, sh * 2); }
    if (typeof VFX !== 'undefined') { const sk = VFX.shakeNow(tAnim); if (sk.x || sk.y) { cx += sk.x; cy += sk.y; } }   // a blow shakes the camera along its direction (off in Reduce motion)
    lastCam = { cx: cx, cy: cy };
    const hookEnv = { ctx: ctx, M: M, cx: cx, cy: cy, vw: vw, vh: vh, t: tAnim, snap: snap, TS: TS, opts: opts };
    if (opts.drawUnder) opts.drawUnder(hookEnv);   // the game draws under the entities here (Critter Roll: the shrine glow, the fountain)
    if (M.rare) {
      const rr = M.rare;
      for (let i = 0; i < 6; i++) {
        const a = tAnim * 1.7 + i * 1.05, sx = (rr.x + 1.5) * TS - cx + Math.cos(a) * 34, sy = (rr.y + 1.5) * TS - cy + Math.sin(a * 1.3) * 26, s = 3 + 2 * Math.sin(tAnim * 4 + i);
        const qx = snap((rr.x + 1.5) * TS - cx + Math.round(Math.cos(a) * 17) * 2), qy = snap((rr.y + 1.5) * TS - cy + Math.round(Math.sin(a * 1.3) * 13) * 2); ctx.fillStyle = '#FFF7D6'; ctx.fillRect(qx, qy, 2, 2); if (s > 3.5) { ctx.fillStyle = '#FFD86B'; ctx.fillRect(qx - 2, qy, 2, 2); ctx.fillRect(qx + 2, qy, 2, 2); ctx.fillRect(qx, qy - 2, 2, 2); ctx.fillRect(qx, qy + 2, 2, 2); }
      }
    }
    // stone platform under leaders
    (NPCS[M.id] || []).forEach((n) => { if (!n.leader) return; const x = snap(n.x * TS - cx), y = snap(n.y * TS - cy);
      ctx.fillStyle = '#4A5878'; ctx.fillRect(x - 10, y - 6, 52, 44); ctx.fillStyle = '#C9D3E6'; ctx.fillRect(x - 8, y - 4, 48, 40); ctx.fillStyle = '#A8B4CC'; ctx.fillRect(x - 8, y + 16, 48, 2); ctx.fillRect(x + 14, y - 4, 2, 40);
      ctx.fillStyle = '#FFD86B'; [[-8, -4], [38, -4], [-8, 34], [38, 34]].forEach(([a, c2]) => ctx.fillRect(x + a, y + c2, 2, 2)); });
    // barricades on locked trails
    M.exits.forEach((e) => { if (!locked(e)) return;
      for (let k = e.a; k <= e.b; k++) {
        const tx = e.edge === 'n' || e.edge === 's' ? k : (e.edge === 'w' ? 1 : M.W - 2), ty = e.edge === 'n' ? 1 : (e.edge === 's' ? M.H - 2 : k);
        const x = snap(tx * TS - cx), y = snap(ty * TS - cy);
        ctx.fillStyle = '#4A2A14'; ctx.fillRect(x + 2, y + 6, 6, 26); ctx.fillRect(x + 24, y + 6, 6, 26);
        ctx.fillStyle = '#4A2A14'; ctx.fillRect(x, y + 8, 32, 12);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#F8F8F8' : '#D8574A'; ctx.fillRect(x + 2 + i * 7, y + 10, 7, 8); }
      } });
    // ambient scenery critters + weather on the ground (ripples, whitecaps, snow caps), under the entities
    const wk = M.interior ? null : (opts.weather ? opts.weather() : null), todNow = M.interior ? 'day' : (opts.tint ? opts.tint() : 'day');
    const ambEnv = { M: M, TS: TS, wind: lastWind ? lastWind.s : 0, solidAt: (x, y) => solidAt(x, y), tileAt: (x, y) => (M.grid[y] ? M.grid[y][x] : 'T'), player: { x: P.x, y: P.y }, cx: cx, cy: cy, vw: vw, vh: vh, t: tAnim, dt: frameDt, tod: todNow, weather: wk, still: opts.still ? opts.still() : false, on: opts.ambient ? opts.ambient() : true };
    if (typeof AMBIENT !== 'undefined') AMBIENT.draw(ctx, 'ground', ambEnv);
    if (!ambEnv.still && (wk === 'rain' || wk === 'storm')) waterFx(wk, cx, cy);
    if (wk === 'snow') snowCaps(cx, cy);
    const fol = opts.follower ? opts.follower() : null;
    if (!FOL) followerReset();
    const list = (NPCS[M.id] || []).filter((n) => !n.hidden).map((n) => ({ y: (n.y + 0.9) * TS, n: n })).concat((M.objects || []).filter((o) => !o.hidden).map((o) => ({ y: (o.y + 0.95) * TS, o: o }))).concat([{ y: P.y, p: true }]).concat(fol && fol.img && fol.img.complete ? [{ y: FOL.y, f: true }] : []).sort((a, b) => a.y - b.y);
    LEAD = critterLead(fol); if (!LEAD) { P.ox = 0; P.oy = 0; }
    const actEnv = { M: M, TS: TS, P: LEAD ? FOL : P, FOL: LEAD ? P : FOL, lead: LEAD, fol: fol, ctx: ctx, cx: cx, cy: cy, vw: vw, vh: vh, t: tAnim, snap: snap };
    if (opts.act) opts.act.items(actEnv).forEach((a) => list.push(a));
    list.sort((a, b) => a.y - b.y);
    list.forEach((it) => {
      if (it.fn) { it.fn(ctx); return; }
      if (it.p) { if (LEAD) drawCritterAt(fol, P.x + (P.ox || 0), P.y + (P.oy || 0), P.moving, cx, cy, snap, true, P.dir); else drawPlayer(pxs - cx, pys - cy); return; }
      if (it.o) { const o = it.o, ox = snap(o.x * TS - cx), oy = snap(o.y * TS - cy), far = ox < -40 || ox > vw + 40 || oy < -50 || oy > vh + 50; if (far && o.kind !== 'postlamp') return; const st = opts.objState ? (opts.objState(o) || {}) : {}, art = opts.objArt ? opts.objArt(o.kind) : null; if (far) return; /* a post lamp's state eases over time, so it is stepped even off screen (otherwise the lamps ahead light only once they are in view) */ if (art) { ctx.save(); ctx.translate(ox, oy); art(ctx, 0, 0, st, tAnim, o); ctx.restore(); } return; }   // drawn from its own origin: the art snaps to a 2 px grid, which must be relative to the object, not the screen, or it jitters against the ground while the camera moves

      if (it.f && LEAD) { drawPlayer(snap(FOL.x - cx), snap(FOL.y - cy), { x: FOL.x, y: FOL.y, dir: FOL.dir || P.dir, moving: FOL.moving, step: FOL.step || 0 }); return; }
      if (it.f) {
        const x = snap(FOL.x + (FOL.ox || 0) - cx), y = snap(FOL.y + (FOL.oy || 0) - cy), hop = FOL.moving ? Math.abs(Math.sin(tAnim * 12)) * 3 : Math.abs(Math.sin(tAnim * 2)) * 1;
        const fim = fol.imgFor ? fol.imgFor(FOL.dir || 'down') : fol.img, w = 30, h = Math.round(30 * fim.height / Math.max(1, fim.width));
        ctx.fillStyle = 'rgba(10,30,10,0.28)'; ctx.fillRect(x - 8, y - 2, 16, 3); ctx.fillRect(x - 6, y - 3, 12, 5);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(fim, Math.round(x - w / 2), Math.round(y - h - hop), w, h);
        if (fol.shiny && Math.floor(tAnim * 1.5) % 3 === 0) { const sx = x + 10 - (Math.floor(tAnim * 6) % 3) * 6, sy = y - h - 2 - hop; ctx.fillStyle = '#FFF3B0'; ctx.fillRect(sx - 1, sy - 4, 2, 8); ctx.fillRect(sx - 4, sy - 1, 8, 2); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(sx - 1, sy - 1, 2, 2); }
        return;
      }
      const n = it.n, x = snap((n.x + 0.5) * TS - cx), y = snap((n.y + 0.9) * TS - cy);
      if (x < -40 || x > vw + 40 || y < -60 || y > vh + 60) return;
      ctx.fillStyle = 'rgba(10,30,10,0.32)'; ctx.fillRect(x - 10, y - 2, 20, 4); ctx.fillRect(x - 8, y - 4, 16, 8);
      ctx.drawImage(n.frames[n.dir][0], x - 16, y - 38, 32, 40);
      if (n.alert > 0) { ctx.fillStyle = '#1E2A4A'; ctx.fillRect(x - 8, y - 66, 16, 22); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - 6, y - 64, 12, 18); ctx.fillStyle = '#D8574A'; ctx.fillRect(x - 2, y - 61, 4, 9); ctx.fillRect(x - 2, y - 50, 4, 3); }
    });
    if (opts.act) opts.act.drawFx(actEnv);
    if (typeof AMBIENT !== 'undefined') AMBIENT.draw(ctx, 'air', ambEnv);
    if (fishAt) { // bobber
      const bx = snap((fishAt.x + 0.5) * TS - cx), by = snap((fishAt.y + 0.55) * TS - cy + Math.sin(tAnim * (fishAt.bite ? 22 : 4)) * (fishAt.bite ? 3 : 1.5));
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(bx - 8, by + 3, 16, 2);
      ctx.fillStyle = '#1E2A4A'; ctx.fillRect(bx - 4, by - 6, 8, 10); ctx.fillStyle = '#D8574A'; ctx.fillRect(bx - 3, by - 5, 6, 4); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(bx - 3, by - 1, 6, 4);
    }
    // the Sealed Arch's open doorway: a swirling glow between the pillars
    (M.objects || []).forEach((o) => { if (!o.portal || !(opts.objState && (opts.objState(o) || {}).open)) return;
      const X = snap(o.portal.x * TS - cx), Y = snap(o.portal.y * TS - cy), k = 0.5 + 0.5 * Math.sin(tAnim * 2.4);
      if (X < -140 || X > vw + 40 || Y < -120 || Y > vh + 40) return;
      const gr = ctx.createLinearGradient(0, Y + 28, 0, Y + 92); gr.addColorStop(0, 'rgba(190,150,255,' + (0.55 + 0.3 * k).toFixed(2) + ')'); gr.addColorStop(1, 'rgba(60,40,140,0.9)');
      ctx.fillStyle = gr; ctx.fillRect(X + 34, Y + 28, 60, 64);
      for (let i = 0; i < 9; i++) { const px2 = X + 40 + ((i * 17 + Math.floor(tAnim * 6) * 3) % 48), py2 = Y + 34 + ((i * 23 + Math.floor(tAnim * 12 + i * 5)) % 52); ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.9)' : 'rgba(255,216,107,0.9)'; ctx.fillRect(px2 & ~1, py2 & ~1, 2, 2); }
    });
    // a lit beacon: a shaft of light rising from its lantern (objects with `beam`, when their state says lit)
    const drawBeam = (bx2, by2, k) => {
      if (bx2 < -60 || bx2 > vw + 60 || by2 < -vh) return;
      const gr = ctx.createLinearGradient(0, by2, 0, 0); gr.addColorStop(0, 'rgba(255,236,160,' + (0.75 * k).toFixed(2) + ')'); gr.addColorStop(1, 'rgba(255,236,160,0)');
      ctx.fillStyle = gr; ctx.fillRect(bx2 - 14, 0, 28, by2); ctx.fillStyle = 'rgba(255,248,200,' + (0.35 * k).toFixed(2) + ')'; ctx.fillRect(bx2 - 5, 0, 10, by2);
      const gl = ctx.createRadialGradient(bx2, by2, 2, bx2, by2, 56); gl.addColorStop(0, 'rgba(255,236,160,0.8)'); gl.addColorStop(1, 'rgba(255,236,160,0)'); ctx.fillStyle = gl; ctx.fillRect(bx2 - 56, by2 - 56, 112, 112);
    };
    (M.objects || []).forEach((o) => { if (!o.beam || !(opts.objState && (opts.objState(o) || {}).lit)) return; drawBeam(snap(o.beam.x * TS - cx), snap(o.beam.y * TS - cy), 0.6 + 0.4 * Math.sin(tAnim * 3)); });
    // once the great lamp is lit the land answers: every lighthouse throws a beam inland, day and night
    if (opts.relit && opts.relit()) (M.props || []).forEach((pr) => { if (pr.id === 'lighthouse') drawBeam(snap((pr.x + pr.w / 2) * TS - cx), snap((pr.y + 0.6) * TS - cy), 0.5 + 0.35 * Math.sin(tAnim * 2.2 + pr.x)); });
    if (opts.drawOver) opts.drawOver(hookEnv);   // the game draws over the entities here (Critter Roll: the lit window of Home)
    // chimney smoke from the houses that keep a fire (the puffs lean with the wind): places whose palette arch is 'cottage' or 'forge'
    if (!M.interior && !(opts.still && opts.still())) { const arch = (PXW.PAL[M.id] || {}).arch; if (arch === 'cottage' || arch === 'forge') { const ws = lastWind ? lastWind.s : 0;
      M.places.forEach((p) => { if (p.kind && p.kind !== 'house' && p.kind !== 'gym') return; const chx = (p.x + p.w) * TS - (arch === 'forge' ? (p.kind === 'gym' ? 24 : 20) : 26), chy = p.y * TS - (arch === 'forge' ? 26 : 4);
        for (let i = 0; i < 3; i++) { const ph = (tAnim * 0.35 + i / 3 + (p.x * 0.37)) % 1, sx = snap(chx - cx + Math.round((ph * 10 * (0.3 + ws) + Math.sin(tAnim * 1.5 + i) * 2) / 2) * 2), sy = snap(chy - cy - Math.round(ph * 22 / 2) * 2), sz = 4 + Math.round(ph * 3) * 2;
          if (sx < -20 || sx > vw + 20 || sy < -20 || sy > vh + 20) continue; ctx.fillStyle = arch === 'forge' ? 'rgba(90,80,80,' + (0.45 * (1 - ph)).toFixed(2) + ')' : 'rgba(240,240,248,' + (0.55 * (1 - ph)).toFixed(2) + ')'; ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz); } }); } }
    // flags (Meaning: wind is change; a banner shows it where a fire is kept): one pennant on every gym hall, on the Long Watch and on the harbour mast. Its tail ripples pose by pose with the trees' six-step cycle, 1 px at a time; with no wind (the cold) it hangs still.
    if (!M.interior) { const kf = lastKf, ws = lastWind ? lastWind.s : 0, A = ws > 0.12 && !(opts.still && opts.still());
      const flag = (fx, fy, col) => { const x = snap(fx - cx), y = snap(fy - cy); if (x < -30 || x > vw + 30 || y < -30 || y > vh + 30) return;
        ctx.fillStyle = '#2B2235'; ctx.fillRect(x, y, 2, 16); ctx.fillStyle = '#E8D8B0'; ctx.fillRect(x, y - 2, 2, 2);
        if (!A) { ctx.fillStyle = col; ctx.fillRect(x + 2, y, 3, 8); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 4, y, 1, 8); return; }   // hanging
        for (let j = 0; j < 8; j++) { const dy = j < 3 ? 0 : Math.round(SIN6F[(kf + j) % 6]), h = 5 - (j >> 2); ctx.fillStyle = col; ctx.fillRect(x + 2 + j, y + dy, 1, h); if (j % 3 === 2) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 2 + j, y + dy, 1, h); } } };
      M.places.forEach((p) => { if (p.kind === 'gym') flag((p.x + p.w) * TS - 22, p.y * TS + 2, p.color || '#F5C542'); else if (p.kind === 'tower') flag((p.x + p.w) * TS - 14, p.y * TS - 12, '#FFD86B'); });
      (M.objects || []).forEach((o) => { if (o.kind === 'harborlamp') flag(o.x * TS + 26, o.y * TS - 10, '#D8574A'); }); }
    // weather (outdoors only), under the time-of-day tint so night darkens it too
    if (typeof WEATHER !== 'undefined') WEATHER.draw(ctx, { kind: M.interior ? null : (opts.weather ? opts.weather() : null), mapId: M.id, vw: vw, vh: vh, cx: cx, cy: cy, t: tAnim, wind: lastWind ? lastWind.s : 0, still: opts.still ? opts.still() : false });
    // time of day: tint the world (tags drawn later stay crisp)
    const tod = (M.interior || M.cave) ? 'day' : (opts.tint ? opts.tint() : 'day'); // lamplit rooms and caves: no night tint
    tintNow = tod;
    if (tod !== 'day') {
      ctx.fillStyle = { night: 'rgba(14,24,70,0.42)', dusk: 'rgba(255,110,50,0.14)', dawn: 'rgba(255,190,140,0.12)' }[tod];
      ctx.fillRect(0, 0, vw, vh);
      if (tod === 'night' || tod === 'dusk') M.places.forEach((p) => { if (p.kind) return; const roofH = Math.round(p.h * 32 * 0.5);
        [[p.x * TS + 16, p.y * TS + roofH + 8], [p.x * TS + p.w * TS - 44, p.y * TS + roofH + 8]].forEach(([wx, wy]) => { const x = snap(wx - cx), y = snap(wy - cy);
          const gr = ctx.createRadialGradient(x + 14, y + 10, 2, x + 14, y + 10, 34); gr.addColorStop(0, 'rgba(255,214,120,0.55)'); gr.addColorStop(1, 'rgba(255,214,120,0)'); ctx.fillStyle = gr; ctx.fillRect(x - 24, y - 26, 76, 72);
          ctx.fillStyle = '#FFD86B'; ctx.fillRect(x, y, 28, 20); }); });
    }
    if (typeof AMBIENT !== 'undefined') AMBIENT.draw(ctx, 'glow', ambEnv); // lights (fireflies) shine over the night tint
    if (M.dark) drawDark(cx, cy, pxs, pys);
    // no words over the places or the rare grass (Dan, Nov 2026): a place reads from its shape and its mark, the rare grass from its sparkle; the name comes at the door (the action button)
    M.exits.forEach((e) => {
      const name = MAPS[e.to] ? MAPS[e.to].name : e.to;
      let tx, ty; const mid = (e.a + e.b + 1) / 2;
      if (e.edge === 'n') { tx = mid * TS - cx; ty = 0.7 * TS - cy; } else if (e.edge === 's') { tx = mid * TS - cx; ty = (M.H - 0.7) * TS - cy; } else if (e.edge === 'w') { tx = 1.8 * TS - cx; ty = mid * TS - cy - 18; } else { tx = (M.W - 1.8) * TS - cx; ty = mid * TS - cy - 18; }
      if (tx > -80 && tx < vw + 80 && ty > -20 && ty < vh + 20) drawTag('To ' + name, tx, ty, false);   // just the place name; the level requirement is told when you touch the gate
    });
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.9, flash * 3) + ')'; ctx.fillRect(0, 0, vw, vh); }
    if (TR) transitionFx();
  }
  let last = 0, frameDt = 0.016;
  function frame(t) { const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; frameDt = dt; tAnim += dt; if (TR) stepTR(dt); update(dt); draw(); requestAnimationFrame(frame); }
  // the view scales with the window: the shorter side shows about 14 tiles whatever the screen, in half steps so pixels stay even (a phone is 1, a laptop about 1.5 to 2). window.__zoom overrides it (tests).
  function resize() { const cw = canvas.clientWidth, ch = canvas.clientHeight; zoom = typeof window.__zoom === 'number' ? window.__zoom : Math.max(1, Math.floor(Math.min(cw, ch) / 448 * 2) / 2); vw = cw / zoom; vh = ch / zoom; dpr = Math.min(3, window.devicePixelRatio || 1) * zoom; canvas.width = Math.round(cw * Math.min(3, window.devicePixelRatio || 1)); canvas.height = Math.round(ch * Math.min(3, window.devicePixelRatio || 1)); if (!terrain || terrainFor !== M.id) prerender(); }
  function init(cv, o) {
    canvas = cv; ctx = cv.getContext('2d'); opts = Object.assign({ random: () => Math.random() }, o);
    if (o.npcs) setupNpcs(o.npcs);
    if (o.map && MAPS[o.map]) M = MAPS[o.map];
    if (o.pos) { P.x = o.pos.x; P.y = o.pos.y; }
    if (collides(P.x, P.y)) { P.x = M.spawn[0] * TS; P.y = M.spawn[1] * TS; } // a saved spot that became solid (layout change): back to the entrance
    if (collides(P.x, P.y) || P.x < 0 || P.y < 0 || P.x > M.W * TS || P.y > M.H * TS) { P.x = M.spawn[0] * TS; P.y = M.spawn[1] * TS; }
    resize(); window.addEventListener('resize', resize);
    window.addEventListener('keydown', (e) => { if (paused) return; input.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true; if (e.key === 'Enter' || e.key === ' ' || e.key === 'e') { const n = nearest(); if (n && opts.onInteract) { e.preventDefault(); opts.onInteract(n); } } if (e.key.startsWith('Arrow')) e.preventDefault(); });
    window.addEventListener('keyup', (e) => { input.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
    if (opts.onMap) opts.onMap(M);
    requestAnimationFrame(frame);
  }
  // ---- Map edits: tiles changed by hand in editor.html (Dan, Nov 2026), applied on top of the generated maps ----
  // MAPEDITS (built from mapedits.json) holds { mapId: { cells: [[x, y, 'T'], ...] } }. Only plain terrain tiles are touched: signs, objects and building footprints (G, O, X) and interiors never change.
  // With ?mapedits=local the draft saved by the editor in this browser is applied as well (to playtest before committing).
  const EDIT_TILES = '.,=WZ~TRFC';
  function applyMapEdits(src) {
    Object.keys(src || {}).forEach((id) => {
      const m = MAPS[id]; if (!m || m.interior) return;
      ((src[id] || {}).cells || []).forEach((c) => { const row = m.grid[c[1]]; if (!row || c[0] < 0 || c[0] >= m.W) return; if (EDIT_TILES.indexOf(row[c[0]]) === -1 || EDIT_TILES.indexOf(c[2]) === -1) return; row[c[0]] = c[2]; });
    });
  }
  // ---- loading: the game hands over its maps (plain data: grid, W, H, places, signs, objects, exits, arrive, arriveFrom, spawn, theme...) and the map to start on ----
  function load(maps, startId) {
    Object.keys(maps).forEach((id) => { MAPS[id] = maps[id]; });
    M = MAPS[startId] || MAPS[Object.keys(MAPS)[0]] || null;
    if (M) { P.x = M.spawn[0] * TS; P.y = M.spawn[1] * TS; }
    if (!window.__EDITOR) {
      applyMapEdits(typeof MAPEDITS !== 'undefined' ? MAPEDITS : {});
      try { if (/[?&]mapedits=local/.test(location.search)) applyMapEdits(JSON.parse(localStorage.getItem('critter-roll:mapedits-draft') || '{}')); } catch (e) { /* no draft */ }
      // #mapedits=<base64 json>: the draft carried in the URL by an editor hosted elsewhere (for example a private claude.ai page); the edits are applied for this visit only, nothing is stored.
      try { const h = /[#&]mapedits=([^&]+)/.exec(location.hash); if (h) applyMapEdits(JSON.parse(decodeURIComponent(escape(atob(h[1].replace(/-/g, '+').replace(/_/g, '/')))))); } catch (e) { /* bad draft in the URL */ }
    }
}
  return {
    init, load, rng, setWinds: (w) => { WINDS = w || {}; }, input, nearest, MAPS, TS, SOLID, EDIT_TILES, applyMapEdits, collides, enter, go, nextHop, get objects() { return M.objects || []; },
    // clear tiles (and the objects standing on them) of a map, e.g. rubble after the rite; redraws the ground if it is the current map
    // open or close a gate (all objects with `gate: id`): hidden + walkable when open, solid when closed
    setGate: (mapId, gateId, open) => { const m = MAPS[mapId]; if (!m) return; (m.objects || []).forEach((o) => { if (o.gate !== gateId) return; o.hidden = !!open; m.grid[o.y][o.x] = open ? '.' : 'O'; }); },
    setTiles: (mapId, cells, ch) => { const m = MAPS[mapId]; if (!m) return; cells.forEach(([x, y]) => { if (m.grid[y] && x >= 0 && x < m.W) m.grid[y][x] = ch; }); if (M === m && canvas) prerender(); }, moving: () => !!P.moving,
    openTiles: (mapId, cells, objIds) => { const m = MAPS[mapId]; if (!m) return; cells.forEach(([x, y]) => { if (m.grid[y]) m.grid[y][x] = '.'; }); m.objects = (m.objects || []).filter((o) => objIds.indexOf(o.id) === -1); if (M === m && canvas) prerender(); }, setFish: (f) => { fishAt = f; }, follower: () => FOL,
    get map() { return M; }, get PLACES() { return M.places; }, get SIGNS() { return M.signs; },
    solidAt: (x, y) => solidAt(x, y),
    get zoom() { return zoom; }, view: () => ({ vw: vw, vh: vh, zoom: zoom }),
    setPaused: (v) => { paused = v; if (v) { input.jx = 0; input.jy = 0; input.keys = {}; } }, get paused() { return paused; }, get transitioning() { return !!TR; },
    get npcs() { return NPCS[M.id] || []; }, allNpcs: () => NPCS, facePlayer, inSight,
    followerPos: () => (FOL ? { x: FOL.x, y: FOL.y, dir: FOL.dir || null, moving: !!FOL.moving } : null), get lead() { return LEAD; },
    pos: () => ({ x: P.x, y: P.y }), facing: () => ({ player: P.dir, follower: FOL ? FOL.dir : null }), walkFrame: () => (P.moving ? (Math.floor((P.step || 0) / 1.6) % 2 ? 1 : 2) : 0), terrainCanvas: () => terrain, windFrame: () => lastKf, windLevel: (id, t) => windLevel(id, t, typeof WEATHER !== 'undefined' && WEATHER.region ? WEATHER.region(id) : null), gust: () => { gustUntil = performance.now() + 3500; }, wind: () => lastWind, debug: () => ({ player: lastPlayerScreen, cam: lastCam, tint: tintNow }), drawNow: () => draw(), setPos: (x, y) => { P.x = x; P.y = y; }, step: (dt) => update(dt), flash: () => { flash = 0.3; }
  };
})();
