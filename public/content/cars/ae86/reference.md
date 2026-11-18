# ae86 — Toyota Sprinter Trueno GT-APEX 3-door (AE86), 1985 — the Fujiwara Takumi car

Rebuilt 2026-11-18 (tested as `ae862`, accepted: "ae86可以取代掉原本的了"). Same performance as before (4A-GE,
gears, mass, grip unchanged: rating 371) — only the looks changed.
The user asked for "藤原拓海的版本" (2026-11-18): the 3-door hatchback GT-APEX in white over black
("panda"), not the 2-door coupe.

## Sources
- Wikimedia Commons, AE86 3-door photos: "Toyota E-AE86 Sprinter Trueno GT APEX (22092207238).jpg"
  (true side profile, used for the side overlay), "Toyota E-AE86 Sprinter Trueno 2door GT APEX Sports
  Package (24010215162).jpg" (3-door rear, lamps), "...(No.106) (24102010030).jpg" (front),
  "Toyota SPRINTER TRUENO GT-APEX (E-AE86) ver.INITIAL D.jpg".
- The user's reference picture (AE86 H2 Concept, white over black, 2026-11-18 chat).
- Dimensions as `ae86`: 4205 / 1625 / 1335 mm, wheelbase 2400 mm.

## Measured / checked
- The old `ae86` side outline laid over the true side photo (scaled by the wheelbase): roof, hatch
  slope, bonnet and window line already match, so the stations are kept.
- Front (from the photos): pop-up lids; under them a black band 0.585-0.655 m with a grille in the
  middle and amber corner markers; a thin white strip; the black bumper from 0.535 m with an amber +
  clear lamp pair at its top corners; small black lip.
- Rear: lamps 0.70-0.815 m, red with the amber at the upper outer corner, a smoked reverse segment at
  the inner end; black recessed plate panel between them, plate low (0.68 m); black rubber spoiler
  across the top of the hatch.

## Deliberate differences (fictional car)
No badges or lettering (no name on the grille band or hatch, no shop name on the doors); plain grille.

## Body kits (inspiration, real kits; names in game are made up)
- BODY KIT `ae86-kit-pandem`: after the Rocket Bunny / Pandem AE86 Trueno hatch kit (GReddy listing:
  +40 mm front / +70 mm rear bolt-on over-fenders, front bumper, side skirts, ducktail).
  https://www.greddy.com/products/66910860
- BODY KIT `ae86-kit-n2`: after the TRD N2 club-race AE86s (riveted arches, big-mouth front spoiler, hatch wing).
- Shared with the other 80s / 90s coupes: FRONT SPLITTER (`apron`) and REAR DIFFUSER (`diffuser`) in kits.json.

## Still off / open
- Shut pop-up lids stand a few mm proud at their front edge and have no dark gap round them — fixing
  that is a change to `carBuilder.js` (asked the user).
