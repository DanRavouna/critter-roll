# The engine takes maps as data: every map the old game builds survives a JSON round trip with nothing lost, holds no functions,
# and the engine's own API no longer carries the game's map helpers (those hang off WORLD only because maps.js puts them there).
from playwright.sync_api import sync_playwright
from chk import check, done
errs=[]
with sync_playwright() as p:
  b=p.chromium.launch(); pg=b.new_page(viewport={'width':390,'height':844}); pg.on('pageerror',lambda e:errs.append(str(e)))
  pg.goto('file:///mnt/user-data/outputs/critter-roll-world.html'); pg.wait_for_timeout(1100)
  r=pg.evaluate("""(()=>{const ids=Object.keys(WORLD.MAPS), fns=[], lost=[];
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for(const id of ids){const m=WORLD.MAPS[id];(function walk(v,path,d){if(d>7)return;if(typeof v==='function')fns.push(path);else if(v&&typeof v==='object')for(const k in v)walk(v[k],path+'.'+k,d+1);})(m,id,0);
      const j=JSON.parse(JSON.stringify(m)); if(!same(j,m))lost.push(id);
      for(const f of ['id','name','W','H','grid','places','signs','exits','spawn','theme']) if(!(f in m)) lost.push(id+':'+f); }
    return {n:ids.length, fns:fns.slice(0,5), lost:lost.slice(0,5), start:WORLD.map.id, legacyApi:[typeof WORLD.ZONES, typeof WORLD.NETS, typeof WORLD.addProp]};})()""")
  print('maps:', r['n'], 'start:', r['start'])
  check('every map is plain data (no functions anywhere)', not r['fns'], r['fns'])
  check('every map survives a JSON round trip and has the core fields', not r['lost'], r['lost'])
  check('the old game still finds its map helpers on WORLD (attached by maps.js)', r['legacyApi']==['object','object','function'], r['legacyApi'])
  # the engine file itself knows no map, creature or quest
  src=open('/home/user/critter-roll/engine/world.js').read()
  for word in ["'town'", 'ZONES', 'ADV.', 'ACT.', 'dg-', 'Sproutvale']:
    check('engine/world.js does not mention ' + word, word not in src)
  # arriving in the start map from a neighbour lands on the neighbour's edge spot, as it did when the runtime knew the town
  pos=pg.evaluate("(()=>{WORLD.enter('frost');WORLD.enter('town');const p=WORLD.pos(),a=WORLD.MAPS.town.arrive.n;return [p.x/32,p.y/32,a[0],a[1]];})()")
  check('arrival into the start map from a zone uses that edge', abs(pos[0]-pos[2])<1e-9 and abs(pos[1]-pos[3])<1e-9, pos)
  print('errors:', errs or 'none'); check('no page errors', not errs, errs); b.close()
done()
