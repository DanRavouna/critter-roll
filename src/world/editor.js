// ---- Map editor (editor.html). Paints the same letter grids the game builds its maps from, drawn by the game's own renderer (PXW.terrain). ----
// What it saves is a list of changed cells per map ({ mapId: { cells: [[x, y, 'T'], ...] } }) on top of the generated maps: src/world/mapedits.json.
// Signs, objects and building footprints (G, O, X) and interiors are shown but never painted; they belong to code that places them.
// Touch model (Dan, Nov 2026: "too hard to use"): one finger paints, two fingers pan and pinch-zoom, a long press picks the tile under it.
(() => {
  const $ = (id) => document.getElementById(id);
  const L = PXW.L, MAPS = WORLD.MAPS, EDIT = WORLD.EDIT_TILES, SOLID = WORLD.SOLID;
  const DRAFT = 'critter-roll:mapedits-draft';
  const TILES = [['.', 'Ground'], [',', 'Flowers'], ['=', 'Path'], ['W', 'Tall grass'], ['Z', 'Rare grass'], ['~', 'Water'], ['T', 'Tree'], ['R', 'Rock'], ['F', 'Fence'], ['C', 'Cave wall']];
  const NAME = {}; TILES.forEach((t) => { NAME[t[0]] = t[1]; });
  Object.assign(NAME, { G: 'Sign (placed by code)', O: 'Object (placed by code)', X: 'Building (placed by code)' });
  const TOOLS = [['paint', 'Paint', 'b'], ['rect', 'Box', 'r'], ['fill', 'Fill', 'f'], ['restore', 'Restore', 'e']];

  // the generated maps, before any edit: the baseline every edit is measured against
  const base = {}; Object.keys(MAPS).forEach((id) => { base[id] = MAPS[id].grid.map((r) => r.join('')); });
  const edits = {};          // mapId -> { 'x,y': ch }  (only cells that differ from the baseline)
  const undo = {}, redo = {};
  let cur = null, M = null, tool = 'paint', ch = 'T', brush = 1, frame = null, dirtyTerrain = true, hover = null, drag = null, flags = null;
  const cam = { x: 0, y: 0, z: 2 };   // screen = world * z + (x, y)

  function msg(t, bad) { const e = $('msg'); e.textContent = t || ''; e.className = bad ? 'bad' : ''; }
  const editable = (m) => !!m && !m.interior;
  function setCell(id, x, y, c) {
    const m = MAPS[id], b = base[id][y][x]; m.grid[y][x] = c;
    const e = edits[id] || (edits[id] = {}); if (c === b) delete e[x + ',' + y]; else e[x + ',' + y] = c;
    if (!Object.keys(e).length) delete edits[id];
  }
  function toData() {
    const out = {}; Object.keys(edits).sort().forEach((id) => { out[id] = { cells: Object.keys(edits[id]).map((k) => { const p = k.split(','); return [+p[0], +p[1], edits[id][k]]; }).sort((a, b) => a[1] - b[1] || a[0] - b[0]) }; });
    return out;
  }
  function saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify(toData())); } catch (e) { msg('Could not save the draft in this browser: export the file instead.', true); } }
  function load(data) {
    Object.keys(edits).forEach((id) => { MAPS[id].grid = base[id].map((r) => r.split('')); delete edits[id]; });
    Object.keys(data || {}).forEach((id) => { if (!MAPS[id] || MAPS[id].interior) return; ((data[id] || {}).cells || []).forEach((c) => { const row = MAPS[id].grid[c[1]]; if (!row || c[0] < 0 || c[0] >= MAPS[id].W) return; if (EDIT.indexOf(row[c[0]]) === -1 || EDIT.indexOf(c[2]) === -1) return; setCell(id, c[0], c[1], c[2]); }); });
  }

  // ---------- map list ----------
  function listMaps() {
    const sel = $('mapsel'); sel.innerHTML = '';
    Object.keys(MAPS).forEach((id) => {
      const m = MAPS[id], n = edits[id] ? Object.keys(edits[id]).length : 0, o = document.createElement('option');
      o.value = id; o.textContent = (m.name || id) + (m.interior ? ' (view only)' : '') + (n ? ' · ' + n + ' edited' : ''); if (id === cur) o.selected = true; sel.appendChild(o);
    });
  }
  function open(id) {
    cur = id; M = MAPS[id]; flags = null; dirtyTerrain = true; drag = null; report(''); listMaps(); palette(); home();
    $('info').textContent = (M.name || id) + ' · ' + M.W + '×' + M.H + (editable(M) ? '' : ' · interiors are view only');
  }
  function report(t) { $('reptext').textContent = t; $('report').classList.toggle('open', !!t); }

  // ---------- camera ----------
  const stage = () => $('stage');
  function clampCam() {
    const st = stage(), W = M.W * L * cam.z, H = M.H * L * cam.z, pad = 48;
    cam.x = Math.min(st.clientWidth - pad, Math.max(pad - W, cam.x)); cam.y = Math.min(st.clientHeight - pad, Math.max(pad - H, cam.y));
  }
  function zoomAt(z, sx, sy) { z = Math.max(0.5, Math.min(8, z)); const wx = (sx - cam.x) / cam.z, wy = (sy - cam.y) / cam.z; cam.z = z; cam.x = sx - wx * z; cam.y = sy - wy * z; clampCam(); render(); }
  const centre = () => { const st = stage(); return [st.clientWidth / 2, st.clientHeight / 2]; };
  function fit() { const st = stage(); cam.z = Math.max(0.5, Math.min((st.clientWidth - 16) / (M.W * L), (st.clientHeight - 16) / (M.H * L))); cam.x = (st.clientWidth - M.W * L * cam.z) / 2; cam.y = (st.clientHeight - M.H * L * cam.z) / 2; render(); }
  function home() {   // open at a tap-sized zoom (a tile about 36 px, a thumb's width) centred on where the player appears, or fit when the map is small
    const st = stage(); const want = 36 / L, fitZ = Math.min((st.clientWidth - 16) / (M.W * L), (st.clientHeight - 16) / (M.H * L));
    if (fitZ >= want * 0.7) { fit(); return; }
    cam.z = want; const at = M.spawn || [M.W / 2, M.H / 2]; cam.x = st.clientWidth / 2 - at[0] * L * cam.z; cam.y = st.clientHeight / 2 - at[1] * L * cam.z; clampCam(); render();
  }

  // ---------- drawing ----------
  function rebuild() { const T = PXW.terrain(M, M.id); if (T.anim) PXW.bake(T, 0, 0); frame = T.anim && T.anim.sets[0] ? T.anim.sets[0][0] : T; dirtyTerrain = false; }
  let raf = 0; function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function draw() {
    if (!M) return; if (dirtyTerrain) rebuild();
    const cv = $('cv'), st = stage(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== st.clientWidth * dpr || cv.height !== st.clientHeight * dpr) { cv.width = st.clientWidth * dpr; cv.height = st.clientHeight * dpr; cv.style.width = st.clientWidth + 'px'; cv.style.height = st.clientHeight + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false; g.fillStyle = '#0F0C1C'; g.fillRect(0, 0, st.clientWidth, st.clientHeight);
    const S = L * cam.z; g.translate(cam.x, cam.y); g.drawImage(frame, 0, 0, M.W * S, M.H * S);
    if ($('oGrid').checked && S >= 10) { g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= M.W; x++) { g.moveTo(x * S + 0.5, 0); g.lineTo(x * S + 0.5, M.H * S); } for (let y = 0; y <= M.H; y++) { g.moveTo(0, y * S + 0.5); g.lineTo(M.W * S, y * S + 0.5); } g.stroke(); }
    if (edits[cur] && $('oEdit').checked) {   // one outline around each edited region (per-cell boxes made painted water look tiled)
      const e = edits[cur]; g.strokeStyle = 'rgba(255,216,107,0.75)'; g.lineWidth = 2; g.beginPath();
      Object.keys(e).forEach((k) => { const p = k.split(','), x = +p[0], y = +p[1], X = x * S, Y = y * S;
        if (!e[x + ',' + (y - 1)]) { g.moveTo(X, Y + 1); g.lineTo(X + S, Y + 1); } if (!e[x + ',' + (y + 1)]) { g.moveTo(X, Y + S - 1); g.lineTo(X + S, Y + S - 1); }
        if (!e[(x - 1) + ',' + y]) { g.moveTo(X + 1, Y); g.lineTo(X + 1, Y + S); } if (!e[(x + 1) + ',' + y]) { g.moveTo(X + S - 1, Y); g.lineTo(X + S - 1, Y + S); } });
      g.stroke();
    }
    if ($('oMark').checked) markers(g, S);
    if (flags) { g.fillStyle = 'rgba(255,60,60,0.45)'; flags.forEach((p) => g.fillRect(p[0] * S, p[1] * S, S, S)); }
    if (drag && drag.tool === 'rect') { const r = rectOf(drag); g.strokeStyle = '#FFD86B'; g.lineWidth = 2; g.strokeRect(r[0] * S + 1, r[1] * S + 1, (r[2] - r[0] + 1) * S - 2, (r[3] - r[1] + 1) * S - 2); }
    if (hover && editable(M) && !drag) { const b = brushCells(hover[0], hover[1]); g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; b.forEach((p) => g.strokeRect(p[0] * S + 1, p[1] * S + 1, S - 2, S - 2)); }
  }
  function markers(g, S) {
    g.lineWidth = 2;
    (M.places || []).forEach((p) => { g.strokeStyle = '#6EE7F5'; g.strokeRect(p.x * S + 1, p.y * S + 1, p.w * S - 2, p.h * S - 2); g.fillStyle = '#6EE7F5'; if (p.door) g.fillRect(p.door[0] * S + S * 0.25, p.door[1] * S + S * 0.25, S * 0.5, S * 0.5); });
    (M.exits || []).forEach((e) => { g.fillStyle = 'rgba(255,216,107,0.85)'; for (let k = e.a; k <= e.b; k++) { const x = e.edge === 'w' ? 0 : e.edge === 'e' ? M.W - 1 : k, y = e.edge === 'n' ? 0 : e.edge === 's' ? M.H - 1 : k; g.fillRect(x * S, y * S, S, S); } });
    (M.signs || []).forEach((s) => { g.fillStyle = '#FF8AD0'; g.beginPath(); g.arc((s.x + 0.5) * S, (s.y + 0.5) * S, S * 0.22, 0, 6.3); g.fill(); });
    (M.objects || []).forEach((o) => { g.fillStyle = '#FF9A4A'; g.beginPath(); g.arc((o.x + 0.5) * S, (o.y + 0.5) * S, S * 0.22, 0, 6.3); g.fill(); });
    if (M.spawn) { g.fillStyle = '#6EF58A'; g.fillRect(M.spawn[0] * S - S * 0.2, M.spawn[1] * S - S * 0.2, S * 0.4, S * 0.4); }
  }

  // ---------- painting ----------
  const rectOf = (d) => [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)];
  function cellAt(sx, sy) { const S = L * cam.z, x = Math.floor((sx - cam.x) / S), y = Math.floor((sy - cam.y) / S); return x >= 0 && y >= 0 && x < M.W && y < M.H ? [x, y] : null; }
  function brushCells(x, y) { const o = Math.floor((brush - 1) / 2), out = []; for (let yy = y - o; yy < y - o + brush; yy++) for (let xx = x - o; xx < x - o + brush; xx++) if (xx >= 0 && yy >= 0 && xx < M.W && yy < M.H) out.push([xx, yy]); return out; }
  let blocked = 0, stroke = null;
  function put(x, y, c) {
    const old = M.grid[y][x]; if (old === c) return;
    if (EDIT.indexOf(old) === -1 || EDIT.indexOf(c) === -1) { blocked++; return; }
    setCell(cur, x, y, c); stroke.push([x, y, old, c]); dirtyTerrain = true;
  }
  const dab = (x, y) => brushCells(x, y).forEach((p) => put(p[0], p[1], tool === 'restore' ? base[cur][p[1]][p[0]] : ch));
  function fillFrom(x, y, c) {
    const t = M.grid[y][x]; if (t === c || EDIT.indexOf(t) === -1) return; const q = [[x, y]], seen = new Set([x + ',' + y]);
    while (q.length) { const p = q.pop(); put(p[0], p[1], c); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => { const nx = p[0] + d[0], ny = p[1] + d[1], k = nx + ',' + ny; if (nx < 0 || ny < 0 || nx >= M.W || ny >= M.H || seen.has(k) || M.grid[ny][nx] !== t) return; seen.add(k); q.push([nx, ny]); }); }
  }
  function begin() { stroke = []; blocked = 0; }
  function end() {
    if (stroke && stroke.length) { (undo[cur] || (undo[cur] = [])).push(stroke); redo[cur] = []; saveDraft(); listMaps(); }
    if (blocked) msg(blocked + ' cell(s) skipped: signs, objects and buildings are placed by code and cannot be painted over.', true); else msg(stroke && stroke.length ? 'Draft saved in this browser.' : '');
    stroke = null; render();
  }
  function cancel() { if (!stroke) return; stroke.slice().reverse().forEach((c) => apply(c, true)); stroke = null; drag = null; render(); }   // a second finger landed: this was a pan, not a stroke
  function apply(c, rev) { const [x, y, o, n] = c; setCell(cur, x, y, rev ? o : n); dirtyTerrain = true; }
  function step(from, to, rev) { const s = (from[cur] || []).pop(); if (!s) return; (rev ? s.slice().reverse() : s).forEach((c) => apply(c, rev)); (to[cur] || (to[cur] = [])).push(s); saveDraft(); listMaps(); render(); }
  function pick(p) { const t = M.grid[p[1]][p[0]]; if (EDIT.indexOf(t) !== -1) { setCh(t); msg('Picked ' + NAME[t] + '.'); } else msg(NAME[t] || t, true); }

  const cv = $('cv'), ptrs = new Map(); let pinch = null, hold = null;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (!M) return; const s = pos(e); ptrs.set(e.pointerId, s); cv.setPointerCapture(e.pointerId); clearTimeout(hold);
    if (ptrs.size === 2) {   // two fingers: pan and pinch; whatever the first finger painted is taken back
      cancel(); const a = [...ptrs.values()]; pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), z: cam.z, cx: (a[0][0] + a[1][0]) / 2, cy: (a[0][1] + a[1][1]) / 2, x: cam.x, y: cam.y }; return;
    }
    if (ptrs.size > 2) return;
    const p = cellAt(s[0], s[1]); if (!p) return;
    if (e.button === 2 || e.button === 1 || e.pointerType === 'mouse' && e.altKey) { pick(p); return; }
    if (!editable(M)) { msg('Interiors are view only for now.', true); return; }
    if (e.pointerType !== 'mouse') hold = setTimeout(() => { if (stroke && stroke.length <= brush * brush && drag) { cancel(); pick(p); try { navigator.vibrate && navigator.vibrate(20); } catch (x) { /* none */ } } }, 550);   // long press without moving = pick
    begin();
    if (tool === 'fill') { fillFrom(p[0], p[1], ch); end(); return; }
    if (tool === 'rect') { drag = { tool: 'rect', x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; render(); return; }
    drag = { tool: tool, last: p }; dab(p[0], p[1]); render();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!M) return; const s = pos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, s);
    if (pinch && ptrs.size >= 2) {
      const a = [...ptrs.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), cx = (a[0][0] + a[1][0]) / 2, cy = (a[0][1] + a[1][1]) / 2;
      const z = Math.max(0.5, Math.min(8, pinch.z * d / Math.max(1, pinch.d))); cam.z = z;
      cam.x = cx - (pinch.cx - pinch.x) / pinch.z * z; cam.y = cy - (pinch.cy - pinch.y) / pinch.z * z; clampCam(); render(); return;
    }
    const p = cellAt(s[0], s[1]); hover = p;
    if (p) { const t = M.grid[p[1]][p[0]]; $('pos').textContent = 'x ' + p[0] + ', y ' + p[1] + ' · ' + (NAME[t] || t) + (edits[cur] && edits[cur][p[0] + ',' + p[1]] ? ' (edited)' : ''); }
    if (drag && p) {
      if (drag.tool === 'rect') { drag.x1 = p[0]; drag.y1 = p[1]; }
      else if (!drag.last || drag.last[0] !== p[0] || drag.last[1] !== p[1]) { clearTimeout(hold); const q = drag.last || p, n = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) || 1; for (let i = 1; i <= n; i++) dab(Math.round(q[0] + (p[0] - q[0]) * i / n), Math.round(q[1] + (p[1] - q[1]) * i / n)); drag.last = p; }
    }
    render();
  });
  const up = (e) => {
    ptrs.delete(e.pointerId); clearTimeout(hold);
    if (pinch) { if (ptrs.size < 2) pinch = null; return; }
    if (!drag) return;
    if (drag.tool === 'rect') { const r = rectOf(drag); for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) put(x, y, ch); }
    drag = null; end();
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { hover = null; render(); });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const s = pos(e); if (e.ctrlKey || e.metaKey) zoomAt(cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), s[0], s[1]); else { cam.x -= e.deltaX; cam.y -= e.deltaY; clampCam(); render(); } }, { passive: false });

  // ---------- palette and tools ----------
  function setCh(c) { ch = c; if (tool === 'restore') setTool('paint'); [...$('pal').children].forEach((b) => b.classList.toggle('on', b.dataset.c === c)); }
  function setTool(t) { tool = t; [...$('tools').children].forEach((b) => b.classList.toggle('on', b.dataset.t === t)); }
  function setBrush(n) { brush = n; [...$('brush').children].forEach((b) => b.classList.toggle('on', +b.dataset.n === n)); render(); }
  function tileArt(c) {   // the tile as this map's theme draws it: a 3x3 patch of it, the middle tile cropped with the space above (trees and fences stand up)
    const mini = { id: M.id, W: 3, H: 3, grid: [[c, c, c], [c, c, c], [c, c, c]], places: [], signs: [], objects: [] };
    const T = PXW.terrain(mini, M.interior ? 'town' : M.id); if (T.anim) PXW.bake(T, 0, 0); const src = T.anim && T.anim.sets[0] ? T.anim.sets[0][0] : T;
    const out = document.createElement('canvas'); out.width = 16; out.height = 24; const g = out.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 16, 8, 16, 24, 0, 0, 16, 24); return out;
  }
  function palette() {
    const pal = $('pal'); pal.innerHTML = '';
    TILES.forEach((t) => { const b = document.createElement('button'); b.dataset.c = t[0]; b.title = t[1]; b.appendChild(tileArt(t[0])); const s = document.createElement('span'); s.textContent = t[1]; b.appendChild(s); b.classList.toggle('on', t[0] === ch); b.onclick = () => setCh(t[0]); pal.appendChild(b); });
  }
  TOOLS.forEach((t) => { const b = document.createElement('button'); b.dataset.t = t[0]; b.textContent = t[1]; b.onclick = () => setTool(t[0]); $('tools').appendChild(b); });
  [1, 2, 3].forEach((n) => { const b = document.createElement('button'); b.dataset.n = n; b.textContent = n + '×' + n; b.onclick = () => setBrush(n); $('brush').appendChild(b); });
  setTool('paint'); setBrush(1);

  // ---------- walkability ----------
  function check() {
    if (!M) return; const g = M.grid, W = M.W, H = M.H, starts = [];
    const walk = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !SOLID.has(g[y][x]);
    if (M.spawn) starts.push([Math.floor(M.spawn[0]), Math.floor(M.spawn[1])]);
    Object.keys(M.arrive || {}).forEach((k) => { const a = M.arrive[k]; starts.push([Math.floor(a[0]), Math.floor(a[1])]); });
    Object.keys(M.arriveFrom || {}).forEach((k) => { const a = M.arriveFrom[k]; starts.push([Math.floor(a[0]), Math.floor(a[1])]); });
    const goals = [];
    (M.exits || []).forEach((e) => { for (let k = e.a; k <= e.b; k++) goals.push([e.edge === 'w' ? 0 : e.edge === 'e' ? W - 1 : k, e.edge === 'n' ? 0 : e.edge === 's' ? H - 1 : k, 'exit to ' + e.to]); });
    (M.places || []).forEach((p) => { if (p.door) goals.push([p.door[0], p.door[1] + 1, 'door of ' + (p.name || p.id)]); });
    if (!starts.length) { report('No start point known for this map, so nothing to check.'); return; }
    const seen = new Set(); const q = starts.filter((s) => walk(s[0], s[1])); q.forEach((s) => seen.add(s[0] + ',' + s[1]));
    for (let i = 0; i < q.length; i++) { const p = q[i]; [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach((d) => { const x = p[0] + d[0], y = p[1] + d[1], k = x + ',' + y; if (walk(x, y) && !seen.has(k)) { seen.add(k); q.push([x, y]); } }); }
    const bad = goals.filter((t) => !seen.has(t[0] + ',' + t[1]));
    flags = bad.map((t) => [t[0], t[1]]);
    const blockedStarts = starts.filter((s) => !walk(s[0], s[1])).length;
    report((bad.length || blockedStarts ? '' : 'Every exit and door can be reached from the start point(s).') + (blockedStarts ? blockedStarts + ' start point(s) are on a solid tile.\n' : '') + bad.map((t) => 'Not reachable: ' + t[2] + ' (' + t[0] + ',' + t[1] + ')').join('\n') + '\n(4-way walking over non-solid tiles; the game\'s own collision may be a little more forgiving.)');
    render();
  }

  // ---------- in-page dialogs (the browser's prompt/confirm are blocked inside the claude.ai page) ----------
  function ask(text, withInput) {
    return new Promise((res) => {
      const box = $('ask'), inp = $('askin'); $('asktext').textContent = text; inp.hidden = !withInput; inp.value = ''; box.classList.add('open');
      const done = (v) => { box.classList.remove('open'); $('askok').onclick = $('askno').onclick = null; inp.onkeydown = null; res(v); };
      $('askok').onclick = () => done(withInput ? inp.value : true); $('askno').onclick = () => done(withInput ? null : false);
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
      if (withInput) setTimeout(() => inp.focus(), 50);
    });
  }
  // ---------- file, playtest, view ----------
  function exportFile() {
    const d = toData(), ids = Object.keys(d);
    const txt = ids.length ? '{\n' + ids.map((id) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(d[id])).join(',\n') + '\n}\n' : '{}\n';
    const done = () => msg('Exported ' + ids.length + ' edited map(s) as mapedits.json: put it in src/world/ and rebuild.');
    if (saver) { saver.save({ filename: 'mapedits.json', data: txt }).then(done, (e) => msg(e && e.code === 'declined' ? 'Export cancelled.' : 'Export failed (' + ((e && e.code) || 'unavailable') + ').', true)); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'mapedits.json'; a.click(); done();
  }
  // Hosted as a claude.ai page the file goes through the viewer's save prompt (the downloads capability); elsewhere a plain download.
  let saver = null; if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then((ns) => { saver = ns; }, () => {});
  $('export').onclick = exportFile;
  $('import').onclick = () => $('file').click();
  $('file').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = async () => { try { const s = String(r.result), d = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); if (!(await ask('Replace the current edits with the ones in this file?'))) return; load(d); saveDraft(); listMaps(); dirtyTerrain = true; render(); msg('Imported.'); } catch (x) { msg('That file could not be read as map edits.', true); } };
    r.readAsText(f); e.target.value = '';
  };
  // Playtest: next to the game (GitHub Pages, a local build) the draft travels through this browser's storage; hosted elsewhere (a private claude.ai page) it travels in the URL.
  const GAME = 'https://danravouna.github.io/critter-roll/';
  const local = /^(https?:|file:)/.test(location.protocol) && !/claude\.ai|claudeusercontent/.test(location.host);
  $('playtest').onclick = () => {
    saveDraft(); if (local) { window.open('index.html?mapedits=local', '_blank'); return; }
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(toData())))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (b64.length > 60000) { msg('This draft is too large to carry in a link (' + b64.length + ' characters); export it instead.', true); return; }
    window.open(GAME + '#mapedits=' + b64, '_blank');
  };
  $('check').onclick = () => check();
  // ---------- Submit: push mapedits.json to main through the viewer's GitHub connector (claude.ai page only). A GitHub Action on main then rebuilds index.html, runs the smoke tests and deploys. ----------
  const GH = { server: 'github', owner: 'danravouna', repo: 'critter-roll', path: 'src/world/mapedits.json', branch: 'main' };
  let mcp = null, perms = null; if (window.claude && typeof window.claude.use === 'function') { window.claude.use('mcp').then((ns) => { mcp = ns; if (ns) $('submit').hidden = false; }, () => {}); window.claude.use('permissions').then((ns) => { perms = ns; }, () => {}); }
  // The page must be allowed to use GitHub before the call: ask on the click (the first call's own ask does not always show, and then the call reports upstream_error without reaching GitHub).
  async function allowed() {
    if (!perms) return true;
    let st = await perms.state('mcp:github').catch(() => 'unavailable');
    if (st === 'prompt') { report('Allow this page to use GitHub when claude.ai asks…'); st = ((await perms.request(['mcp:github'])) || {})['mcp:github'] || 'unavailable'; }
    if (st === 'granted' || st === 'unavailable') return true;   // unavailable: an older viewer that cannot say; let the call decide
    report('Not submitted: this page is not allowed to use GitHub for you. Open the page\'s Permissions menu (⋮ at the top), switch GitHub on, then press Submit again.' + (st === 'denied' ? '' : ' (' + st + ')'));
    try { if (await ask('Open the Permissions panel now?')) { await perms.manage(); } } catch (e) { /* the panel did not open: the message above says where it is */ }
    return false;
  }
  const jsonText = () => { const d = toData(), ids = Object.keys(d); return ids.length ? '{\n' + ids.map((id) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(d[id])).join(',\n') + '\n}\n' : '{}\n'; };
  function unreachable() {   // every edited map must pass the walkability check before it goes live
    const out = [], keep = cur; Object.keys(edits).forEach((id) => { open(id); check(); if (flags && flags.length) out.push(MAPS[id].name || id); });
    open(keep); return out;
  }
  $('submit').onclick = async () => {
    if (!mcp) return; const ids = Object.keys(edits);
    if (!ids.length) { report('Nothing to submit: no map differs from the generated one.'); return; }
    report('Checking that every exit and door can still be reached…'); const bad = unreachable(); if (bad.length) { report('Not submitted. An exit or a door cannot be reached on: ' + bad.join(', ') + '. Fix those first (⋯ → Check walkability shows them in red).'); return; }
    report(''); if (!(await allowed())) return;
    const note = await ask('One line for the commit: what do these edits mean inside the quest?\n(Maps: ' + ids.map((id) => MAPS[id].name || id).join(', ') + ')', true); if (note == null) return;
    if (!note.trim()) { report('Not submitted: a meaning line is required (the standing rule: every place says its piece of the meaning).'); return; }
    report('Submitting…'); $('submit').disabled = true;
    try {
      let sha; try { const r = await mcp.callTool(GH.server, 'get_file_contents', { owner: GH.owner, repo: GH.repo, path: GH.path, ref: 'refs/heads/' + GH.branch }, { cache: false }); const m = /SHA: ([0-9a-f]{40})/.exec(JSON.stringify(r)); sha = m ? m[1] : undefined; } catch (e) { if (!e || e.code !== 'tool_error') throw e; }
      const input = { owner: GH.owner, repo: GH.repo, path: GH.path, branch: GH.branch, content: jsonText(), message: 'Map edits from the editor: ' + note.trim() + '\n\nMaps: ' + ids.join(', ') + '. Submitted from the map editor page; index.html is rebuilt by the mapedits workflow.' };
      if (sha) input.sha = sha;
      const r = await mcp.callTool(GH.server, 'create_or_update_file', input);
      const url = (JSON.stringify(r).match(/https:\/\/github\.com\/[^"\\]*\/commit\/[0-9a-f]+/) || [])[0];
      report('Submitted to main. GitHub now rebuilds the game and runs the smoke tests; the site updates in a few minutes if they pass (you get an email from GitHub if they do not).' + (url ? '\nCommit: ' + url : ''));
    } catch (e) {
      const c = e && e.code;
      report(c === 'server_not_connected' ? 'GitHub is not connected: add GitHub in claude.ai Settings → Connectors, then try again.'
        : c === 'needs_reauth' ? 'GitHub needs to be reconnected in claude.ai Settings → Connectors.'
        : c === 'approval_required' || c === 'consent_required' ? 'Not submitted: the page needs your approval to use GitHub. Allow it when asked and press Submit again.'
        : c === 'not_in_manifest' || c === 'blocked_by_policy' ? 'Not submitted: this page is not allowed to use GitHub for you (' + c + ').'
        : c === 'tool_error' ? 'GitHub refused the change: ' + (e.message || '')
        : (c === 'upstream_error' && e.retryable) ? 'Not submitted: GitHub access for this page is not confirmed yet, so the call did not reach GitHub. Allow GitHub for this page (its Permissions menu, ⋮ at the top), wait a few seconds, then press Submit again.'
        : 'Not submitted (' + (c || 'error') + '): ' + (e && e.message || '') + (c === 'server_unavailable' || c === 'upstream_error' ? ' Check the repository before trying again: the commit may still have happened.' : ''));
    }
    $('submit').disabled = false;
  };
  $('undo').onclick = () => step(undo, redo, true);
  $('redo').onclick = () => step(redo, undo, false);
  $('reset').onclick = async () => { if (!M || !edits[cur] || !(await ask('Throw away every edit on this map?'))) return; load(Object.assign({}, toData(), { [cur]: { cells: [] } })); undo[cur] = []; redo[cur] = []; saveDraft(); open(cur); msg('Map reset.'); };
  $('zin').onclick = () => { const c = centre(); zoomAt(cam.z * 1.25, c[0], c[1]); }; $('zout').onclick = () => { const c = centre(); zoomAt(cam.z / 1.25, c[0], c[1]); }; $('zfit').onclick = fit;
  $('oGrid').onchange = render; $('oMark').onchange = render; $('oEdit').onchange = render; $('mapsel').onchange = (e) => open(e.target.value);
  $('more').onclick = (e) => { e.stopPropagation(); $('menu').classList.toggle('open'); };
  $('menu').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') $('menu').classList.remove('open'); });
  stage().addEventListener('pointerdown', (e) => { if (!$('menu').contains(e.target) && e.target !== $('more')) $('menu').classList.remove('open'); });
  $('repclose').onclick = () => { report(''); flags = null; render(); };
  window.addEventListener('resize', () => { if (M) { clampCam(); render(); } });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); step(undo, redo, true); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); step(redo, undo, false); return; }
    const t = TOOLS.find((x) => x[2] === k); if (t) setTool(t[0]);
    if (k === '1' || k === '2' || k === '3') setBrush(+k);
    const tl = TILES.find((x) => x[0] === e.key); if (tl) setCh(tl[0]);
  });
  window.addEventListener('beforeunload', () => { if (Object.keys(edits).length) saveDraft(); });

  // start: the committed edits (mapedits.json) are the base state; a draft in this browser, if any, replaces them
  load(typeof MAPEDITS !== 'undefined' ? MAPEDITS : {});
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && Object.keys(d).length) { load(d); msg('Loaded your draft from this browser.'); } } catch (e) { /* no draft */ }
  open(MAPS.town ? 'town' : Object.keys(MAPS)[0]);
})();
