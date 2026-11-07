import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
# Default output: index.html at the repository root (served by GitHub Pages).
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'index.html')
W = os.path.join(HERE, 'world') + os.sep                 # the game (Critter Roll, frozen)
E = os.path.join(HERE, '..', 'engine') + os.sep          # the engine: reusable, knows no game (see docs/next-plan.md)
ENGINE = ['runtime', 'pixel', 'landmarks', 'pxworld', 'weather', 'ambient', 'vfx', 'cloud', 'music', 'world']
# Map edits made in the map editor live in mapedits.json; wrapped here so the game reads them as MAPEDITS.
mapedits = '// generated from mapedits.json by build2.py\nconst MAPEDITS = ' + open(W + 'mapedits.json').read().strip() + ';\n'
def piece(p): return mapedits if p == 'mapedits' else open((E if p in ENGINE else W) + p + '.js').read()
h = open(W + 'shell.html').read()
# order: engine pieces, then the game's maps (which hand themselves to the engine), then the game
js = '\n'.join(piece(p) for p in ['runtime', 'pixel', 'landmarks', 'adventure', 'pxworld', 'weather', 'ambient', 'mapedits', 'world', 'maps', 'vfx', 'action', 'cloud', 'music', 'flavor', 'base', 'data', 'game', 'app']) + '\n'
h = h.replace('/*@@JS@@*/', js, 1).replace('<!--@@SCREEN@@-->', open(W + 'screen.html').read(), 1)
open(OUT, 'w').write(h); print('built', os.path.normpath(OUT), len(h) // 1024, 'KB')

# The map editor (editor.html) is built from the same engine pieces, so what it draws is what the game draws. (Editor branch only, never on main.)
if len(sys.argv) <= 1:
    ej = '\n'.join(piece(p) for p in ['pixel', 'landmarks', 'adventure', 'pxworld', 'weather', 'ambient', 'mapedits', 'world', 'maps', 'editor']) + '\n'
    eh = open(W + 'editor.html').read().replace('/*@@JS@@*/', ej, 1)
    open(os.path.join(HERE, '..', 'editor.html'), 'w').write(eh); print('built editor.html', len(eh) // 1024, 'KB')
