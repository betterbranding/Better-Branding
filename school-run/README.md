# School Run: Google Earth Edition

A 3D driving game of the morning school run in Colleyville, TX, rendered on Google Photorealistic 3D Tiles (real photogrammetry buildings, trees, and terrain).

**Route:** Home (Quality Hill Rd) → Colleyville Elementary **south car rider entrance** (the middle drive off Pleasant Run is bus/staff only) → Colleyville Middle School via Bogart Dr. About 2.6 miles, 8 minutes.

## Files

- `index.html` — page shell, import map (Three.js + 3d-tiles-renderer from CDN), HUD
- `main.js` — game loop, car controls, Drive / 3D Map camera modes, checkpoint logic
- `world.js` — Google Photorealistic 3D Tiles setup, route ribbon draped on terrain
- `geo.js` — WGS84 → local game-frame projection helpers (ECEF anchor)
- `data.js` — route waypoints and checkpoints (home, CES south entrance, CMS)
- `styles.css` — HUD styling

## Running locally

Serve the folder over HTTP (ES modules won't load from `file://`):

```sh
bunx serve .
# or: python3 -m http.server 8000
```

Then open the printed localhost URL.

## Controls

- **W / ↑** accelerate, **S / ↓** brake or reverse
- **A / D or ← / →** steer
- **M** toggle Drive / 3D Map mode

## Notes

- Uses the Google Map Tiles API (key in `world.js`, project: ADHD Brain Hacker). The key is referrer-restricted to `betterbranding.github.io`, so it only works on the live site.
- First load takes ~10–20 seconds while high-res tiles stream in.
