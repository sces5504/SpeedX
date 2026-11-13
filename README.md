# SpeedX

A night-driving prototype on a real 6-mile stretch of Angeles Crest Highway (CA-2), built with Three.js.
It is always night; you just drive. Traffic shares the road, street racers cruise it, and you can race them.

## Run it

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Controls

| Key | Action |
| --- | --- |
| W A S D (or arrows) | throttle, steer, brake / reverse |
| Space | handbrake |
| C | switch camera (chase / cockpit) |
| Hold left mouse | look around |
| L | headlights: off → low → high |
| F | flash high beams (challenge a racer, ask traffic to move over) |
| H | horn |
| E | interact (refuel at a pump, start a time attack at an orange cone) |
| M | map — click a circle to travel there |
| Backspace | put the car back on the road |
| Esc | pause (rain and time of night are in this menu) |

## Where things live

```
index.html            page layout: canvas, HUD, menus
src/main.js           builds the world and runs the game loop — start reading here
src/config.js         every tweakable number: PHYSICS (grip/power/brake boosts), FEEL (camera
                      shake, neck, motion blur, crash effects), GRAPHICS, GAMEPLAY, KEYS
src/core/             keyboard + mouse input, small math helpers
src/world/            mapData (road + heights), terrain, road, scenery, pois, props, sky, weather
src/vehicles/         carSpecs (loads car folders), carModel (prepares .glb models),
                      carBuilder (assembles a car), interior (cockpit, hands, wipers),
                      vehiclePhysics (how the car drives), playerCar (ties them together)
src/ai/               aiCar (shared base), traffic, rivals
src/game/             collisions, challenge (near misses + time attack)
src/render/           cameras, materials (retroreflection, wet road), postfx, sparks
src/audio/            engine, wind, rain, pass-bys, crashes
src/ui/               HUD, map, menus, CSS

public/content/cars/<id>/    one folder per car: car.json (+ model.glb)      ← add-ons go here
public/content/maps/<id>/    one folder per map: map.json + height.bin        ← and here
public/content/props/<id>/   reusable scenery models (trees, lamps, buildings…)
public/audio/                sound clips cut from reference/audio by tools/build-audio.py

tools/build-map.mjs      make a map folder from a real road (OpenStreetMap + elevation tiles)
tools/meshy-asset.sh     make a car or prop model with Meshy AI
tools/build-audio.py     cut the sound clips
tools/check-content.mjs  check every car and map folder for mistakes
tools/physics-test.mjs   0-100, top speed, braking, cornering for each hero car
.claude/skills/          speedx-add-car and speedx-add-map: step-by-step recipes for agents
reference/               the Dash Cam screenshots, clips and source recordings
```

## Adding cars and maps

Cars and maps are **data folders**, not code. To add one, create the folder and list its id in
`public/content/cars/index.json` or `public/content/maps/index.json`; to remove one, take the id out.
The game's code never changes. Full recipes (fields, model rules, how to check the result) are in
`.claude/skills/speedx-add-car/SKILL.md` and `.claude/skills/speedx-add-map/SKILL.md` — written so
another agent can follow them, but readable by people too.

Run `node tools/check-content.mjs` after any change.

## How the models are used

Car models were generated with Meshy AI (one reference image → one mid-poly model each). At load time
`src/vehicles/carModel.js` scales each model to the real car's length, works out which end is the nose,
cuts the four wheels out so they can spin and steer, and replaces the AI-painted texture with clean
paint, dark glass and the original lamp colours. Lamps and licence plates are added by the game.
A car with no model falls back to a simple body built from the side profile in its `car.json`.

## Sound

`python3 tools/build-audio.py` cuts loops and one-shots out of the CC0 recordings in `reference/audio/`
(sources in its README). Engine "voices" per car are the `ENGINE_PROFILES` in `src/audio/audio.js`.

## Data credits

Road © OpenStreetMap contributors (ODbL). Elevation from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).
Recordings: Freesound, CC0 — except the car impact sounds, which are cut from "car crash" by nsstudios
(CC BY-NC 4.0: non-commercial use only, credit required). Details in `reference/audio/README.md`.
