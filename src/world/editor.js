// ---- Map editor (editor.html). Paints the same letter grids the game builds its maps from, drawn by the game's own renderer (PXW.terrain). ----
// What it saves is a list of changed cells per map ({ mapId: { cells: [[x, y, 'T'], ...] } }) on top of the generated maps: src/world/mapedits.json.
// Signs, objects and building footprints (G, O, X) and interiors are shown but never painted; they belong to code that places them.
(() => {
  const $ = (id) => document.getElementById(id);
  const L = PXW.L, MAPS = WORLD.MAPS, EDIT = WORLD.EDIT_TILES, SOLID = WORLD.SOLID;
  const DRAFT = 'critter-roll:mapedits-draft';
  const TILES = [
    ['.', 'Ground', '#62BE45'], [',', 'Flowers', '#8FD870'], ['=', 'Path', '#E2CB95'], ['W', 'Tall grass', '#3E9A33'],
    ['Z', 'Rare grass', '#C8F0A0'], ['~', 'Water', '#4FA3E8'], ['T', 'Tree', '#2E6B4E'], ['R', 'Rock', '#A8B2C6'],
    ['F', 'Fence', '#B07A46'], ['C', 'Cave wall', '#3A3A52']
  ];
  const NAME = {}; TILES.forEach((t) => { NAME[t[0]] = t[1]; });
  Object.assign(NAME, { G: 'Sign (placed by code)', O: 'Object (placed by code)', X: 'Building (placed by code)' });
  const TOOLS = [['paint', 'Paint', 'b'], ['rect', 'Rect', 'r'], ['fill', 'Fill', 'f'], ['pick', 'Pick', 'i'], ['restore', 'Restore', 'e'], ['pan', 'Pan', 'h']];

  // the generated maps, before any edit: the baseline every edit is measured against
  const base = {}; Object.keys(MAPS).forEach((id) => { base[id] = MAPS[id].grid.map((r) => r.join('')); });
  const edits = {};          // mapId -> { 'x,y': ch }  (only cells that differ from the baseline)
  const undo = {}, redo = {};
  let cur = null, M = null, tool = 'paint', ch = 'T', zoom = 3, dirtyTerrain = true, frame = null, hover = null, drag = null, flags = null;

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
    cur = id; M = MAPS[id]; flags = null; dirtyTerrain = true; drag = null; report(''); listMaps(); fit();
    $('info').textContent = (M.name || id) + ' · ' + M.W + '×' + M.H + (editable(M) ? '' : ' · interiors are view only');
  }
  function report(t) { $('reptext').textContent = t; $('report').classList.toggle('open', !!t); }
  // ---------- drawing ----------
  function rebuild() {
    const T = PXW.terrain(M, M.id); if (T.anim) PXW.bake(T, 0, 0); frame = T.anim && T.anim.sets[0] ? T.anim.sets[0][0] : T; dirtyTerrain = false;
  }
  function render() {
    if (!M) return; if (dirtyTerrain) rebuild();
    const cv = $('cv'), S = L * zoom; cv.width = M.W * S; cv.height = M.H * S;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(frame, 0, 0, cv.width, cv.height);
    if ($('oGrid').checked) { g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= M.W; x++) { g.moveTo(x * S + 0.5, 0); g.lineTo(x * S + 0.5, M.H * S); } for (let y = 0; y <= M.H; y++) { g.moveTo(0, y * S + 0.5); g.lineTo(M.W * S, y * S + 0.5); } g.stroke(); }
    if (edits[cur]) { g.strokeStyle = 'rgba(255,216,107,0.8)'; g.lineWidth = 1; Object.keys(edits[cur]).forEach((k) => { const p = k.split(','); g.strokeRect(p[0] * S + 1.5, p[1] * S + 1.5, S - 3, S - 3); }); }
    if ($('oMark').checked) markers(g, S);
    if (flags) { g.fillStyle = 'rgba(255,60,60,0.45)'; flags.forEach((p) => g.fillRect(p[0] * S, p[1] * S, S, S)); }
    if (drag && drag.tool === 'rect') { const r = rectOf(drag); g.strokeStyle = '#FFD86B'; g.lineWidth = 2; g.strokeRect(r[0] * S + 1, r[1] * S + 1, (r[2] - r[0] + 1) * S - 2, (r[3] - r[1] + 1) * S - 2); }
    if (hover && editable(M) && tool !== 'pan') { g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.strokeRect(hover[0] * S + 1, hover[1] * S + 1, S - 2, S - 2); }
  }
  function markers(g, S) {
    g.lineWidth = 2; g.font = '700 ' + Math.max(9, S * 0.5) + 'px Nunito, sans-serif';
    (M.places || []).forEach((p) => { g.strokeStyle = '#6EE7F5'; g.strokeRect(p.x * S + 1, p.y * S + 1, p.w * S - 2, p.h * S - 2); g.fillStyle = '#6EE7F5'; if (p.door) g.fillRect(p.door[0] * S + S * 0.25, p.door[1] * S + S * 0.25, S * 0.5, S * 0.5); });
    (M.exits || []).forEach((e) => { g.fillStyle = 'rgba(255,216,107,0.85)'; for (let k = e.a; k <= e.b; k++) { const x = e.edge === 'w' ? 0 : e.edge === 'e' ? M.W - 1 : k, y = e.edge === 'n' ? 0 : e.edge === 's' ? M.H - 1 : k; g.fillRect(x * S, y * S, S, S); } });
    (M.signs || []).forEach((s) => { g.fillStyle = '#FF8AD0'; g.beginPath(); g.arc((s.x + 0.5) * S, (s.y + 0.5) * S, S * 0.22, 0, 6.3); g.fill(); });
    (M.objects || []).forEach((o) => { g.fillStyle = '#FF9A4A'; g.beginPath(); g.arc((o.x + 0.5) * S, (o.y + 0.5) * S, S * 0.22, 0, 6.3); g.fill(); });
    if (M.spawn) { g.fillStyle = '#6EF58A'; g.fillRect(M.spawn[0] * S - S * 0.2, M.spawn[1] * S - S * 0.2, S * 0.4, S * 0.4); }
  }

  // ---------- painting ----------
  const rectOf = (d) => [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)];
  function cellAt(ev) { const r = $('cv').getBoundingClientRect(), S = L * zoom; const x = Math.floor((ev.clientX - r.left) / S), y = Math.floor((ev.clientY - r.top) / S); return x >= 0 && y >= 0 && x < M.W && y < M.H ? [x, y] : null; }
  let blocked = 0, stroke = null;
  function put(x, y, c) {
    const old = M.grid[y][x]; if (old === c) return;
    if (EDIT.indexOf(old) === -1 || EDIT.indexOf(c) === -1) { blocked++; return; }
    setCell(cur, x, y, c); stroke.push([x, y, old, c]); dirtyTerrain = true;
  }
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
  function apply(c, rev) { const [x, y, o, n] = c; setCell(cur, x, y, rev ? o : n); dirtyTerrain = true; }
  function step(from, to, rev) { const s = (from[cur] || []).pop(); if (!s) return; (rev ? s.slice().reverse() : s).forEach((c) => apply(c, rev)); (to[cur] || (to[cur] = [])).push(s); saveDraft(); listMaps(); render(); }

  const cv = $('cv');
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (tool === 'pan') return;
    if (!M || !editable(M)) { msg('Interiors are view only for now.', true); return; }
    const p = cellAt(e); if (!p) return; cv.setPointerCapture(e.pointerId);
    if (e.button === 2 || tool === 'pick') { const t = M.grid[p[1]][p[0]]; if (EDIT.indexOf(t) !== -1) { setCh(t); } else msg(NAME[t] || t, true); return; }
    begin();
    if (tool === 'fill') { fillFrom(p[0], p[1], ch); end(); return; }
    if (tool === 'rect') { drag = { tool: 'rect', x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; render(); return; }
    drag = { tool: tool }; put(p[0], p[1], tool === 'restore' ? base[cur][p[1]][p[0]] : ch); render();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!M) return; const p = cellAt(e); hover = p;
    if (p) { const t = M.grid[p[1]][p[0]]; $('pos').textContent = 'x ' + p[0] + ', y ' + p[1] + ' · ' + (NAME[t] || t) + (edits[cur] && edits[cur][p[0] + ',' + p[1]] ? ' (edited)' : ''); }
    if (drag && p) { if (drag.tool === 'rect') { drag.x1 = p[0]; drag.y1 = p[1]; } else put(p[0], p[1], drag.tool === 'restore' ? base[cur][p[1]][p[0]] : ch); }
    render();
  });
  cv.addEventListener('pointerleave', () => { hover = null; render(); });
  cv.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.tool === 'rect') { const r = rectOf(drag); for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) put(x, y, ch); }
    drag = null; end();
  });

  // ---------- palette and tools ----------
  function setCh(c) { ch = c; if (tool === 'pick' || tool === 'restore') setTool('paint'); [...$('pal').children].forEach((b) => b.classList.toggle('on', b.dataset.c === c)); }
  function setTool(t) { tool = t; [...$('tools').children].forEach((b) => b.classList.toggle('on', b.dataset.t === t)); $('stage').classList.toggle('pan', t === 'pan'); }
  TILES.forEach((t) => { const b = document.createElement('button'); b.dataset.c = t[0]; b.innerHTML = '<i style="background:' + t[2] + '">' + t[0] + '</i>' + t[1]; b.onclick = () => setCh(t[0]); $('pal').appendChild(b); });
  TOOLS.forEach((t) => { const b = document.createElement('button'); b.dataset.t = t[0]; b.textContent = t[1]; b.onclick = () => setTool(t[0]); $('tools').appendChild(b); });
  setTool('paint'); setCh('T');

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
    r.onload = () => { try { const s = String(r.result), d = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); if (!confirm('Replace the current edits with the ones in this file?')) return; load(d); saveDraft(); listMaps(); dirtyTerrain = true; render(); msg('Imported.'); } catch (x) { msg('That file could not be read as map edits.', true); } };
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
  $('check').onclick = check;
  $('undo').onclick = () => step(undo, redo, true);
  $('redo').onclick = () => step(redo, undo, false);
  $('reset').onclick = () => { if (!M || !edits[cur] || !confirm('Throw away every edit on this map?')) return; load(Object.assign({}, toData(), { [cur]: { cells: [] } })); undo[cur] = []; redo[cur] = []; saveDraft(); open(cur); msg('Map reset.'); };
  function zoomTo(z) { zoom = Math.max(0.5, Math.min(8, z)); render(); }
  function fit() { const st = $('stage'); zoomTo(Math.min((st.clientWidth - 16) / (M.W * L), (st.clientHeight - 16) / (M.H * L))); }
  $('zin').onclick = () => zoomTo(zoom * 1.25); $('zout').onclick = () => zoomTo(zoom / 1.25); $('zfit').onclick = fit;
  $('oGrid').onchange = render; $('oMark').onchange = render; $('mapsel').onchange = (e) => open(e.target.value);
  $('more').onclick = (e) => { e.stopPropagation(); $('menu').classList.toggle('open'); };
  $('menu').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') $('menu').classList.remove('open'); });
  $('stage').addEventListener('pointerdown', (e) => { if (!$('menu').contains(e.target) && e.target !== $('more')) $('menu').classList.remove('open'); });
  $('repclose').onclick = () => { report(''); flags = null; render(); };
  window.addEventListener('resize', () => { if (M) render(); });
  $('stage').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoomTo(zoom + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); step(undo, redo, true); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); step(redo, undo, false); return; }
    const t = TOOLS.find((x) => x[2] === k); if (t) setTool(t[0]);
  });
  window.addEventListener('beforeunload', () => { if (Object.keys(edits).length) saveDraft(); });

  // start: the committed edits (mapedits.js) are the base state; a draft in this browser, if any, replaces them
  load(typeof MAPEDITS !== 'undefined' ? MAPEDITS : {});
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && Object.keys(d).length) { load(d); msg('Loaded your draft from this browser.'); } } catch (e) { /* no draft */ }
  open(MAPS.town ? 'town' : Object.keys(MAPS)[0]);
})();
