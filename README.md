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
| Space | handbrake. At speed: **drift** - tap it while steering into a bend, steer the slide with A / D, hold it with the throttle, steer straight to end it |
| C | switch camera (chase / cockpit) |
| Hold left mouse | look around |
| L | headlights: off → low → high |
| F | flash high beams (challenge a racer, ask traffic to move over) |
| H | horn |
| E | interact (refuel at a pump, start a time attack at an orange cone, go into a garage or a dealership) |
| R | watch the replay (when one is offered: after a speed camera, a race or a time attack) |
| GARAGE (main menu; on the road, drive into a garage) | change car, paint, engine and parts |
| M | map — every place has its own sign; click a stop to travel there |
| Backspace | put the car back on the road |
| Esc | pause: rain, time of night, picture filter, audio volume, the Blacklist, how to play, back to the main menu |
| ~ | developer console: type `help` (add reputation or money, go somewhere, change car...) |

## Where things live

```
index.html            page layout: canvas, HUD, menus
src/main.js           builds the world and runs the game loop — start reading here
src/config.js         every tweakable number: PHYSICS (grip/power/brake boosts), FEEL (camera
                      shake, neck, motion blur, crash effects), GRAPHICS (bloom, streaks, colour,
                      damp road, mist, reflections), GAMEPLAY, KEYS
src/core/             keyboard + mouse input, small math helpers
src/world/            showroom (the bright room the garage and the dealer show a car in), stage (the black stage a Blacklist
                      car is unveiled on), careerBuildings (the garage, the dealership, the speed camera),
                      mapData (roads + heights + junctions), roadNet (finding the way round the roads), terrain, road, sea, town (ordinary buildings), signals (traffic lights),
                      sky (night stages, city lights),
                      weather (rain), and the shared library every map is built from:
                      library (the list, by name), plants, buildings, props (model files);
                      scenery (plants the roadside), pois (places stops and single objects)
src/vehicles/         carSpecs (loads car folders, the engine library and the name list),
                      carSetup (factory car + what the owner changed = the one finished setup everything uses),
                      carStats (measures a car by driving it), carRating (ability bars and the 1-999 rating),
                      carLook (body parts: the car + what its owner chose to fit = the car to draw),
                      randomBuild (a car as some street racer might have tuned and restyled it),
                      carResources (frees a car's 3D data when it is thrown away),
                      carShell (generated bodywork),
                      carEnds (lamps, grilles and trim laid on the nose and tail),
                      carDetails (lamp lenses, door lines, mirrors, handles, exhausts),
                      carWheel (generated wheels), carModel (prepares .glb models),
                      carBuilder (assembles a car: body, lamps, plates), interior (cockpit,
                      hands, wipers), vehiclePhysics (how the car drives), playerCar
src/ai/               aiCar (shared base), junctions (planning, giving way and turning at a junction),
                      traffic (picks each map's rule set), trafficTwoLane (the rules for a two-lane road),
                      rivals (street racers: their styles, and the race to a place)
src/game/             collisions, challenge (near misses + time attack), save (the player's save file),
                      career (reputation, money, cars owned, the Blacklist), shop (prices and buying),
                      activities (a race or timed run from start to pay-out), scenes (the garage, dealership, Blacklist and
                      opening scenes), speedTraps (speed cameras), replay (the last seconds again, as a film), blacklistIntros (each Blacklist driver's introduction),
                      devCommands (the developer console's commands)
src/render/           cameras, materials (wet-road mirror, retroreflection, light beams),
                      smallLights (coloured glow from tail lamps and neon), reflections (what
                      car paint mirrors), navArrows (the way to go, drawn on the road), director (plays a scene: a list of
                      camera shots), postfx (film camera look), streak (streak filter), filters (optional looks), sparks,
                      drawDistance (only draws the pieces of the world that are near), replayLook (how a replay is lit)
src/audio/            engine, wind, rain, pass-bys, crashes; revTest (revving an engine on the spot, to listen to it)
src/ui/               HUD, map, menus, garage (change car, paint, engine, parts), dealer (buy cars), blacklist (the drivers to
                      beat), statBars (rating and ability bars), wallet (money and reputation, the same on every screen),
                      mapIcons (the sign of each kind of place on the map),
                      devConsole (the ~ window), CSS
src/catalog/          the catalogue page (catalog.html): browse everything in the game

public/content/cars/<id>/    one folder per car: car.json (+ model.glb)      ← add-ons go here
public/content/engines.json  the engine library: every engine, with its real factory figures
public/content/cars/<id>/kit.json  optional: the body parts that car can be restyled with
public/content/kits.json     shared body parts that fit any car (wings, skirts, scoops, rims, liveries)
public/content/upgrades.json the performance parts: groups, options, and exactly what each one changes
public/content/names.json    THE NAME LIST: the made-up brand and model names players see — edit it to rename things
public/content/career.json   THE CAREER'S RULES: the starter car, prices, what a win pays, the Blacklist drivers
public/content/maps/<id>/    one folder per map: map.json + height.bin        ← and here
public/content/props/        the shared library: index.json lists everything a map can use;
                             <id>/model.glb = an optional model for one of them
public/audio/                sound clips cut from reference/audio by tools/build-audio.py

tools/build-map.mjs      make a map folder from a real road (OpenStreetMap + elevation tiles)
tools/osm-route.mjs      used by build-map for a LOOP or any drive through several roads (--via / --loop)
tools/build-places.mjs   drafts a map's "buildings" list from the real places beside its road
tools/build-test-map.mjs writes the made-up map "test-town": a small road network for trying out junctions
tools/meshy-asset.sh     make a car or prop model with Meshy AI
tools/build-audio.py     cut the sound clips
tools/unpack-fmod-bank.py  take the recordings out of an FMOD .bank (Assetto Corsa sound mods)
tools/shot-receiver.mjs  saves contact sheets the game page sends (how a script LOOKS at a car: see the tuning-parts skill)
tools/check-audio.py     measure every engine loop: is its pitch what its label says, does it hold one speed, is it long enough
tools/check-content.mjs  check every car and map folder for mistakes
tools/check-car-shape.mjs  look for wrinkles in the generated bodywork of every car
tools/physics-test.mjs   0-100, top speed, braking, cornering, rating and ability bars for each hero car
tools/content.mjs        lets the tools load cars the same way the game does
.claude/skills/          speedx-add-car, speedx-add-map and speedx-tuning-parts: step-by-step recipes for agents
reference/               the Dash Cam screenshots, clips and source recordings
```

## Adding cars and maps

Cars and maps are **data folders**, not code. To add one, create the folder and list its id in
`public/content/cars/index.json` or `public/content/maps/index.json`; to remove one, take the id out.
The game's code never changes. Full recipes (fields, model rules, how to check the result) are in
`.claude/skills/speedx-add-car/SKILL.md` and `.claude/skills/speedx-add-map/SKILL.md` — written so
another agent can follow them, but readable by people too.

Run `node tools/check-content.mjs` after any change.

## Cars: factory data, builds and ratings

- **Three layers decide how a car performs**, always in this order (explained at the top of
  `src/vehicles/carSetup.js`): the **stock** car (`car.json` + its engine in `engines.json`, real factory
  numbers), the **build** (what the owner changed), and the **game tune** (the arcade dials in `PHYSICS`,
  `src/config.js`, the same for every car). `setupCar()` returns one finished setup; the physics, the
  rival AI, the rating and the menus are all handed that same object.
- **Engines are a library.** A hero `car.json` names its engine (`"engine": "sr20det"`); the figures and
  the engine's voice live in `public/content/engines.json`. When the real car's engine is not in the
  library, pick the closest one that is.
- **Rating.** `src/vehicles/carRating.js` drives the car through fixed tests (`carStats.js`: flat, dry,
  standing start, full throttle; full brakes from 100 km/h; full steering at a steady 100 km/h) and turns the
  results into three bars — ACCELERATION, TOP SPEED, HANDLING, 0-100 each — and one rating from 1 to 999
  (40% / 25% / 35%). The points tables are fixed, so a car added later is scored on the same scale.
  `node tools/physics-test.mjs` prints them; `src/ui/statBars.js` draws them (and the change between two setups).
- **Parts.** `public/content/upgrades.json` lists the performance parts in groups (engine, turbo /
  supercharger, ECU, gearbox, brakes, weight, tyres), a few options each, and the only things an option
  may change (torque, red line, boost, weight, grip, braking, shift time, an extra gear, drivetrain loss).
  Engine parts belong to the engine: swap the engine (`engineSwaps` in car.json says which fit) and each
  engine keeps its own. Forced induction is one of three: a single turbo (late, big top end), twin turbos
  (early, smooth) or a supercharger (everywhere). Which kinds an engine takes is its `fits` in
  `engines.json`; a kit on a factory-turbo engine gives `factoryTurboShare` of its boost. `PHYSICS.powerBoost` was lowered to
  1.3 when parts arrived: a factory car leaves room to grow.
- **Garage and save file.** `src/ui/garage.js` is the garage: click = try it (the bars show the change),
  APPLY = fit it (a part not owned yet is bought: the button reads BUY), CANCEL = put it back. Each car keeps
  its own paint, engine and parts in the save file (`src/game/save.js`) and gets them back on the next
  visit. There are two saves: the **career** (`localStorage` key `speedx-career`) and the **sandbox**
  (`speedx-save`: every car and part for nothing - the old test garage); the developer console's
  `sandbox on / off` switches. Changing parts only swaps the
  finished setup under the same 3D car; changing car rebuilds it, and `carResources.js` frees the old one.
- **Body parts** (looks only, never performance). A car with `"kit": true` has a `kit.json` beside its
  car.json: groups (front bumper, headlights, spoiler...) with options, each a small patch over car.json
  (`src/vehicles/carLook.js` explains the format and lists the only fields a part may touch). Parts made
  for one car's bodywork — bumpers, lamps — are written in that car's kit; parts the game builds from any
  car's measurements — wings, skirts, scoops, wide arches, rim colours, liveries — are shared in
  `public/content/kits.json` and a kit takes them with `{ "use": "rims" }`. Nothing is bolted onto a
  finished body: the car is generated again with the patch, so bumpers and wide arches have no seams.
  A whole-body kit can take over another group (`"blocks": ["skirts"]`). Every hero car has its own
  bumpers and lamps; `s13` has the most. A car's own shape can also carry parts on its SIDES (`"side"`:
  an intake behind the door, a panel in the second colour) and raised ducts on its engine cover (`"pods"`).
- **The garage's room.** `src/world/showroom.js` is a small lit scene of its own; while the garage is open
  the car stands in it (drag with the left mouse button to look round it, scroll to zoom, LIGHTS switches
  its lamps). HOLD TO REV or W revs the engine on show (`src/audio/revTest.js`) — the one being tried, when
  an engine or a turbo is being tried.
- **Rating scale.** With today's tables a factory 130 PS coupe rates about 370, a 250 PS sports car about
  570, a fully built one 700-850, and a 1000 PS four-wheel-drive hypercar about 865.
- **Driven wheels.** `"drive"` in car.json: `rwd` (default), `fwd` or `awd` (`vehiclePhysics.js`).
- **Street racers.** None of them holds back: in a race every one uses the same large share of what their
  car can do (`GAMEPLAY.racer` in `src/config.js`), a touch less on the straights while level or ahead, and a
  rubber band when behind. What makes one harder than another is the car: each turns up in a different one,
  tuned and restyled at random from the garage's own parts (`src/vehicles/randomBuild.js`) and rated within
  reach of yours. What differs is their style when not racing (`STYLES` in `src/ai/rivals.js`): a *flyer*
  drives flat out and races you if you keep up, a *hunter* catches you and flashes from your tail, a
  *showoff* snakes about and taunts from in front. Flash your lights (F) to accept any of them.
- **Names.** Players never see a real make or model. Every name comes from `public/content/names.json`
  (`brand` + `name`; `real` is a note for us). Change it there, reload, done. The brands are the made-up
  ones in `reference/speedx/brands/`. Traffic cars are not part of any of this: no engine, no rating.

## The career

You start with one modest car and a little money, beat street racers for reputation and money, earn stars
at speed cameras and time attacks, spend the money on parts (a garage) and cars (a dealership), and when
your reputation is high enough a **Blacklist** driver will race you - beat them for the first time and
their car is yours. HOW TO PLAY (main menu, pause menu) says the same to the player.

- **The rules are data**: `public/content/career.json` - what you start with, what a win pays, the price of
  every car and part, what each star pays, and the Blacklist drivers (car, reputation asked, race length,
  prize, their colour, their line, their introduction). The numbers are on the scale of Need for Speed:
  Most Wanted / Forza Horizon (a win a few thousand, a car tens of thousands). Change a number, reload.
  `node tools/check-content.mjs` checks the file.
- **What you have** is kept by `src/game/career.js` in the save file: reputation, money, the cars you own,
  the Blacklist drivers beaten, your stars. `src/game/shop.js` knows the prices and does the buying: a part
  is paid for once and then belongs to that car (taken off, it can be put back for nothing). Money and
  reputation are drawn the same way on every screen by `src/ui/wallet.js`.
- **One activity at a time** (`src/game/activities.js`): a street race, a Blacklist race or a time attack
  begins, then either finishes (the reward is worked out and paid) or is cancelled (nothing is paid).
  Travelling from the map, going to the garage or the menu, changing car and leaving the game all cancel it.
- **Paid once.** Everything a finished activity gives is handed over by `career.settle()` in one write to
  the save file, under the activity's own receipt number; the same receipt is never honoured twice.
- **Stars.** Two activities give one to three stars, and both pay the same way - each level once, the first
  time it is reached, skipped levels included (`career.awardStars`):
  - **Speed cameras** (`"speedCameras"` in map.json; `src/game/speedTraps.js`): the speed you pass at.
  - **Time attacks** (the orange cone at every stop; `src/game/challenge.js`): the clock at the gate. The
    times asked for come from an average speed per star (`"timeAttack": { "kmh": [..] }` in career.json, or
    in a map's map.json for that map), so they fit any length of run.
  The map screen shows the stars you have under each camera and each stop.
- **Street racers** in reach are announced: when one is close enough and going your way, the HUD says
  "F - flash your lights to race" with their car and its rating (`race.inReach`, `src/ai/rivals.js`).
- **The Blacklist screen** (`src/ui/blacklist.js`; main menu and pause menu): the drivers down the left, the
  chosen one's car on the black stage in the middle (`src/world/stage.js`), outlined in their colour, and
  on the right a meter of your reputation against what they ask, the prize and the race.
- **A Blacklist race** (`challengeDriver` in main.js) is made out on the road, in three parts:
  1. the driver's own **introduction** (`src/game/blacklistIntros.js` - every driver has one; `"intro"` in
     career.json names it; it can be skipped);
  2. a **rolling start** (`rollingStart` in `src/game/scenes.js`): the game drives both cars side by side
     to the line, 3-2-1 - nobody can gain anything before GO. It cannot be skipped;
  3. the race, to a gate. Street racers never drive a Blacklist driver's car.
  To add a driver: `.claude/skills/speedx-blacklist`.
- **Garages and dealerships are places.** Two more kinds of stop (`"type": "garage"` / `"dealer"` in a map's
  `pois`), built the same way as the gas station - by code, in `src/world/careerBuildings.js`, after the
  pictures in `reference/buildings/`. Press E in front of the garage's right-hand door: it rolls up, the car
  drives in, and the garage screen opens (TRAVEL there goes to the map). Press E at a dealership's entrance
  for the dealer screen (`src/ui/dealer.js`): the cars for sale - the only place cars are sold.
  Inside, each has a room of its own (`src/world/showroom.js`: ROOMS): the garage a workshop (painted bay,
  roller door, tool chests, tyres, work lamps), the dealership a salon at night (turntable, rings of light,
  a glass wall with the town beyond).
- **The garage screen** (`src/ui/garage.js`) has two tabs - PERFORMANCE and APPEARANCE - and two arrows
  either side of the car's name that go through the cars you own.
- **Scenes.** `src/render/director.js` plays a scene - a list of shots, each a camera move and whatever it
  moves - and `src/game/scenes.js` holds the game's scenes: into and out of the garage, into the dealership,
  the opening of a career, the rolling start. Any scene can be skipped (Space, Enter, Esc) unless it says
  otherwise: skipping takes every remaining shot straight to its last moment, so the game always ends up in
  the state the scene would have left it in. (Developer console: `intro` makes you a first-time player
  again, so the opening plays once more.)
- **Replays** (`src/game/replay.js`): a replay is not a script or a video but a RECORDING OF WHERE THE CARS
  WERE - thirty times a second, the last 14 seconds, in memory only. After a speed camera, a race or a
  time attack, press R: the clip is cut into shots chosen for speed (cameras standing low at the roadside
  that the car blasts past, cameras bolted low on the car), the finish gate is shown again, and only the
  last instant before a finish line plays in slow motion. A replay is lit like a night shoot
  (`src/render/replayLook.js`, `GRAPHICS.replay`): fill light, softer headlights. Driving is not touched.
  Only the 3D models are moved, so the game carries on exactly where it was.
- **Drift** (`PHYSICS.drift` in config.js; steps 4b and 6b of `src/vehicles/vehiclePhysics.js`): what SPACE
  does at speed. Until SPACE is pressed none of it is in play - ordinary handling is exactly as it was.
- Not built yet: checkpoint races.

## How the picture is made

Everything is generated by code at start-up — no model or texture downloads.

- **Cars** have no model file. `src/vehicles/carShell.js` stretches a smooth skin over the side profile
  ("stations") in each `car.json`, with wheel arches, pillars and side windows of any shape;
  `carEnds.js` lays the car's own lamps, grilles and bumper inserts ("nose" and "tail" in `car.json`)
  on that skin so they follow it round the corners; `carDetails.js` adds shut lines, mirrors and
  handles; `carWheel.js` makes the wheels. The cockpit
  (`interior.js`: dashboard, wheel and hands, seats, door panels) is built from the same measurements.
  A car that does have a `model.glb` (made in Blender, say) uses that instead — see `carModel.js`.
- **Shared library.** Plants, buildings, street furniture and ground types are made by code in
  `src/world/` (`plants.js`, `buildings.js`, `terrain.js`) and listed by name in `library.js` and in
  `public/content/props/index.json`. Any map uses them from its `map.json`: `"scenery"` (plants),
  `"pois"` (whole stops), `"objects"` (one lamp, sign or building anywhere along the road), `"ground"`.
  A model in `public/content/props/` replaces the built-in thing of the same name.
- **Catalogue page.** `catalog.html` (the LIBRARY link in the main menu) shows every car, engine (with a
  rev button, bare or with a boost kit), body kit (on its car), object, plant, ground, stop, traffic rule
  set and map, with live 3D previews, each car's measured
  performance and an engine you can rev. It has no data of its own: `src/catalog/` builds everything
  with the game's own functions and files, so it always shows the game as it is now. The performance
  figures come from `src/vehicles/carStats.js`, which `tools/physics-test.mjs` prints too.
  (`vite.config.js` only exists to tell the build there are two pages.)
- **First-time defaults.** `FIRST_TIME` in `src/config.js` says what a new player starts with (the CLASSIC
  GREEN filter, rain on). The game then remembers their own choices of filter and rain. All sounds are
  downloaded when the page opens (`audio.preload()`), so nothing is fetched when DRIVE is pressed.
- **Picture filters.** ESC -> FILTER steps through the looks in `src/render/filters.js` (OFF, CLASSIC
  GREEN = the first public version's olive-green colours on top of today's picture, VHS TAPE). Off
  means off: nothing is added to the picture. A new filter is one more entry in that file.
- **Main menu.** `src/ui/menu.js` builds a card for every installed car (left) and map (right, with
  a picture of its route) and leaves the middle clear so you see the car you are choosing.
- **Maps.** Pick one in the main menu (MAP) or open `/?map=<id>`. Each map's `map.json` says what it
  is made of from the shared library, which stops it has (stops are the fast-travel points on every
  map), and which traffic rules its drivers follow (`"traffic": { "rules": "two-lane", ... }`).
  Rule sets are plug-ins: `src/ai/traffic.js` lists them, `trafficTwoLane.js` is the one for a
  two-lane road. The main road may be a **loop** (`"loop": true` in map.json):
  it joins back onto itself and has no end barriers. Code that compares two positions along the
  road must then use `map.wrap()`, `map.ahead()` and `map.roomAhead()` (explained at the top of
  `world/mapData.js`) instead of subtracting `s` values.
- **More than one road.** A map may list further roads in `"roads"` (each `{ id, road: [[x, z]...], type,
  sections }`). Every road is a **way**: an object shaped like a one-road map, so `way.pointAt`, `way.road`,
  `way.laneCentre`... mean for that road what `map.pointAt`... mean for the main one (`map.ways[0]`); the top
  of `world/mapData.js` explains it under WAYS. Roads join by being drawn to touch - an end lying on another
  road (side road, fork, merge) or two lines crossing - and `joinWays()` there finds the junctions, matches
  the heights, opens the guardrails and median wall and cuts the corners back. Roads listed first are "on
  top" where two meet. `map.locate(x, z)` says which road a point is on; the player's car keeps its own
  (`player.way`). `test-town` (`node tools/build-test-map.mjs`, open `/?map=test-town`) is a made-up area with
  a ring, an avenue, a crossroads, a fork, a merge and a dead end. Stops, buildings and plants are still
  placed along the main road only.
- **Finding the way.** `src/world/roadNet.js` (`net` in main.js) answers what a driver or a race needs to
  know about the network: the next junction ahead, the arms leaving it, where you end up after driving so
  many metres (`net.walk`), and the shortest route between two places (`net.findRoute`). A place is
  `{ way, s }`.
- **AI at junctions.** Every AI car knows which road it is on (`ai.way`). `src/ai/junctions.js` plans the
  next junction for it (which arm, how fast the turn can be taken), slows it down, makes it give way - the
  road listed first at a junction has priority, one car turns at a time - and hands it to `startTurn()` in
  `aiCar.js`, which carries it round a curve onto the new road. A brain never reads another car's position
  directly: `lookAround()` (aiCar.js) tells it where the cars near it are along its OWN road, so a car
  crossing at a junction is just "something in my lane ahead".
- **A race is to a place.** Flash a racer and the gate is put about `GAMEPLAY.raceLength` further on, the
  way the road leads (shorter on a small network). Any road will do: whoever has less road left by the
  shortest route is ahead, the map draws that route, and the rival takes it (`src/ai/rivals.js`).
- **Navigation.** On the map screen (M) click a road to set a destination (click it again to clear): the
  shortest way there is drawn on the map and the minimap (`nav` in main.js; `goto` in the developer console),
  as glowing chevrons on the road ahead (`src/render/navArrows.js`) and as the next instruction beside the
  minimap - an arrow and how far (`hud.setNav`). A race shows its way to the gate the same way, in green.
- **Traffic lights.** A light on its own goes in a road's `"signals"` (metres along it); `"signalJunctions"`
  (a point at each junction) puts lights on every road meeting there, the main road and the joining roads
  getting green in turn (`world/signals.js`, `lightJunction()` in `world/mapData.js`). AI drivers stop at
  red (`signalSpeed` in `ai/aiCar.js`); racers in a race do not. The masts are solid.
- **Kinds of road.** A road can change along the way: two lanes, four lanes with a median, a narrow
  country road (`ROAD_TYPES` in `src/config.js`). A map's `sections` say which stretch is which;
  `mapData.js` turns that into per-position widths (`road.half`, `road.barrier`, `road.lanes`...)
  and `map.laneCentre(s, dir, lane)` tells a driver where the middle of a lane is.
- **Towns.** A map may list `buildings` (townhouses, cafés, a seafood restaurant, a temple, pylons...):
  `tools/build-places.mjs` drafts the list from the real places on OpenStreetMap, `world/town.js`
  draws them — everything solid in one area welded into one mesh and everything that glows into
  another, so a town costs a handful of draw calls. Signs show the kind of business, never a real name.
  The same file makes street lamps and utility poles along a stretch (`roadside` in map.json) and the
  landmarks that are modelled on one real place each.
- **Traffic follows the map.** Each stretch has its own speed limit (`speedKmh` in a map's `sections`;
  `road.limit` in the game) and the signs show it. A map's `signals` become traffic lights
  (`world/signals.js`): the AI drivers stop at red (`signalSpeed` in `ai/aiCar.js`), you need not.
  Where the road has two lanes each way they keep right and pass on the left.
- **Real lamps.** Road lamps and lit buildings list a lamp each; the nearest `GRAPHICS.realLamps` of them
  are real lights, the rest are "small lights" in the shaders. `GRAPHICS.lightPools` switches the older
  painted pools of colour on the ground back on.
- **Woodland from the map.** `woods` in a map.json are the outlines of the real forests; scenery entries
  with `"where": "woods"` / `"open"` plant inside or outside them (`map.inWoods`).
- **The catalogue reads the library by itself.** Anything in `OBJECTS`, `PLANTS` or `GROUNDS`
  (`world/library.js`) appears on `catalog.html` without being added there. Town buildings are
  registered as objects automatically, so a new kind in `world/town.js` shows up too.
- **Sea.** A map with `"sea": true` gets a sheet of dark water at sea level (`world/sea.js`);
  the ground type `north-coast` adds a sandy shore.
- **Only what is near is drawn.** Road ribbons are cut every kilometre, roadside things are grouped
  by area and the mountain is made of tiles with a fine and a rough version
  (`render/drawDistance.js`, distances in `GRAPHICS`). That is what lets a map be long.
- **Neon.** Buildings are lit with colour, not white light: `neon()` and `haze()` in
  `world/buildings.js`, and each stop's palette (`color`, `accent`, `light`) from its map.json entry.
- **Nothing burns out.** Surfaces can have a brightness `limit` (`enhanceMaterial` in
  `render/materials.js`): a car in your headlights, the road under an oncoming beam and the cabin
  stay "brightly lit" instead of turning into white blobs. Only real lamps glow and streak.
- **Light.** Only a few lamps are real lights (your beams, the nearest street lamps and oncoming cars).
  Every other lamp — tail lamps, neon, vending machines — is a cheap "small light" that tints what is
  near it and reflects in the road (`render/smallLights.js`).
- **Reflections.** Wet asphalt mirrors last frame's picture (`render/materials.js`); car paint and glass
  mirror a small all-round photo taken from your car (`render/reflections.js`).
- **Film look.** `render/postfx.js`: streak filter, bloom, dazzle from headlights, cinema colour, grain.
  The strengths are in `GRAPHICS` in `src/config.js` (`streak`, `glare`, `bloomStrength`,
  `buildingLights`, `dampRoad`…) — set one to 0 to see what it does.
- **Rain** is in `world/weather.js` (streaks, splashes, tyre spray) and `postfx.js` (drops on the glass).

Developer console: press `~` in the game and type `help`. The window is `src/ui/devConsole.js`; the commands
(`rep`, `money`, `tp`, `goto`, `pos`, `car`, `fuel`, `rain`, `night`, `rival`, `race`, `win`, `blacklist`,
`sandbox`, `save`) are one short entry each in `src/game/devCommands.js`.

Browser console helpers: `speedx.preview('<carId>')`, `speedx.setOrbit(angle, speed)`, `speedx.weather.toggle()`,
`speedx.sky.setPreset(n)`, `speedx.step(120)` (fast-forward 120 frames — handy when the tab is in the background).

## Sound

`python3 tools/build-audio.py` cuts loops and one-shots out of the CC0 recordings in `reference/audio/`
(sources in its README). The one exception is the V10 voice (`v10f1_*.wav`): Formula 1 V10 sounds by SHR
Modding, unpacked with `tools/unpack-fmod-bank.py`, which **need their written consent before the game is
published** (`reference/audio/acfan-f1-v10/acfan-f1-v10.md`). In `src/audio/audio.js`, `VOICES` are the sets of recordings (one per kind of engine)
and `ENGINE_PROFILES` say which voice an engine uses and how its exhaust is shaped. Each engine in
`engines.json` picks a profile with `"sound"`, so the sound follows the engine, not the car: swap the engine
and the car sounds like the new one. A car adds a small colouring of its own (`soundBody` in car.json), and
the turbo whistle / blow-off or supercharger whine plays whenever the engine has one, from the factory or
from a kit fitted in the garage. Lifting off at high revs crackles in the exhaust. After cutting new loops run
`python3 tools/check-audio.py`: it measures what nobody can check by ear a hundred times over (a loop whose
loudest tone is not the engine, a loop that drifts in pitch, a loop too short not to be heard repeating).

## Data credits

Road © OpenStreetMap contributors (ODbL). Elevation from Mapzen/AWS Terrain Tiles (USGS 3DEP, SRTM).
Recordings: Freesound, CC0 — except the car impact sounds, which are cut from "car crash" by nsstudios
(CC BY-NC 4.0: non-commercial use only, credit required). Details in `reference/audio/README.md`.
