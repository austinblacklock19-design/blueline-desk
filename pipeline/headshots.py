#!/usr/bin/env python3
"""Rebuild player headshot sprite sheets from the NHL's mugshots.

Reads data/rosters.json (written by refresh.js) and data/heads-needed.json (teams whose roster changed),
downloads each player's headshot from assets.nhle.com, crops it to head and shoulders, and packs a team's
players into one 96px-tile webp sheet: web/p/<TEAM>.webp. Updates web/p/index.json and web/p/heads.js.

    pip install pillow
    python3 pipeline/headshots.py          # teams listed in data/heads-needed.json
    python3 pipeline/headshots.py --all    # every team
"""
import io, json, os, sys, time, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA, PDIR = os.path.join(ROOT, 'data'), os.path.join(ROOT, 'web', 'p')
TILE, COLS = 96, 8

def fetch(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'blueline-desk'})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except Exception as e:  # 404s are players without a photo yet
            if getattr(e, 'code', None) == 404:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None

def tile(png):
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    w, h = im.size
    side = w * 0.72
    box = (round((w - side) / 2), round(h * 0.143), round((w + side) / 2), round(h * 0.143 + side))
    return im.crop(box).resize((TILE, TILE), Image.LANCZOS)

def main():
    rosters = json.load(open(os.path.join(DATA, 'rosters.json')))
    index_f = os.path.join(PDIR, 'index.json')
    index = json.load(open(index_f)) if os.path.exists(index_f) else {'size': TILE, 'cols': COLS, 'teams': {}}
    if '--all' in sys.argv:
        teams = sorted(rosters)
    else:
        need_f = os.path.join(DATA, 'heads-needed.json')
        teams = json.load(open(need_f)) if os.path.exists(need_f) else []
    for team in teams:
        players = rosters.get(team, [])
        rows = (len(players) + COLS - 1) // COLS
        sheet = Image.new('RGBA', (COLS * TILE, max(1, rows) * TILE), (0, 0, 0, 0))
        ids = []
        for i, (pid, url) in enumerate(players):
            png = fetch(url) if url else None
            if png:
                sheet.paste(tile(png), ((i % COLS) * TILE, (i // COLS) * TILE))
                ids.append(pid)
            else:
                ids.append(-pid)  # the page shows initials for a negative id
        sheet.save(os.path.join(PDIR, team + '.webp'), 'WEBP', quality=80, method=6)
        index['teams'][team] = ids
        print(team, len(ids), 'players,', sum(1 for i in ids if i < 0), 'without a photo')
    index.update({'size': TILE, 'cols': COLS})
    json.dump(index, open(index_f, 'w'), separators=(',', ':'))
    open(os.path.join(PDIR, 'heads.js'), 'w').write('window.__HEADS__=' + json.dumps(index, separators=(',', ':')) + ';\n')
    if '--all' not in sys.argv:
        json.dump([], open(os.path.join(DATA, 'heads-needed.json'), 'w'))

if __name__ == '__main__':
    main()
