// ---------------------------------------------------------------------------
// carLook.js — how a car LOOKS: the car + the body parts its owner chose.
// (carSetup.js is the same idea for how it PERFORMS. Body parts never change
// performance: only the fields in LOOK_FIELDS below can be touched, and the
// physics reads none of them.)
//
// A car that can be restyled has a kit file beside its car.json:
//     public/content/cars/<id>/kit.json
//       { "groups": [ { "id": "spoiler", "title": "SPOILER", "options": [
//             { "id": "s13-wing-none", "look": { "spoiler": null } }, ... ] }, ... ] }
// A group is one place on the car (front bumper, side skirts, headlights...);
// at most one of its options is fitted, none = the part the car comes with.
// Only the options listed for a car exist for that car: nothing is offered
// that has not been made to fit it.
//
// An option's "look" is a small patch over the car's own car.json:
//   * any field in LOOK_FIELDS replaces the car's own (spoiler, skirts, flares...)
//   * "nose" / "tail" / "side": { "<slot>": [parts] } replaces the parts of the nose, tail or
//     sides that car.json marks with that "slot" ("bumper", "lamps") and leaves the rest;
//     a slot the car does not have yet is simply added (canards, vents)
// An option may also say "blocks": ["skirts"]: a whole-body kit that brings its
// own side skirts takes that group over while it is fitted.
//
// The owner's choices are plain data, kept in the save file per car:
//   look = { spoiler: 's13-wing-none', frontBumper: 's13-front-aero' }
// dressCar(spec, look) hands back the car to build (carBuilder.js).
// ---------------------------------------------------------------------------
import { toNumber } from './carSpecs.js';

// Everything a body part may change. (All of it is about shape and colour.)
const LOOK_FIELDS = ['flares', 'skirts', 'spoiler', 'exhausts', 'lip', 'wheelOut', 'hood', 'roofScoop', 'rimColor', 'twoTone', 'twoToneZone', 'endLift', 'headlights', 'taillights'];
const COLOUR_FIELDS = ['rimColor', 'twoTone'];

export const lookGroups = (stock) => stock.kit?.groups || [];
export const fittedLook = (look, group) => look?.[group.id] || '';
const optionOf = (group, id) => group.options.find((option) => option.id === id);

// The fitted option (of another group) that has taken this group over, or null.
export function takenOverBy(stock, look, group) {
  for (const other of lookGroups(stock)) {
    const option = other !== group && optionOf(other, fittedLook(look, other));
    if (option?.blocks?.includes(group.id)) return option;
  }
  return null;
}

// Fit an option ('' = the part the car comes with). Returns a new look.
export const fitLook = (look = {}, group, optionId) => ({ ...look, [group.id]: optionId });

const dressed = new WeakMap();               // spec -> (choices -> dressed spec), so the same look is only worked out once

/**
 * @param spec  a finished car setup (carSetup.js)
 * @param look  the owner's body parts; nothing = the car as it comes
 */
export function dressCar(spec, look = {}) {
  const options = lookGroups(spec).filter((group) => !takenOverBy(spec, look, group)).map((group) => optionOf(group, fittedLook(look, group))).filter(Boolean);
  if (!options.length) return spec;
  const key = options.map((option) => option.id).join('|');
  if (!dressed.has(spec)) dressed.set(spec, new Map());
  const made = dressed.get(spec);
  if (!made.has(key)) {
    const car = { ...spec };
    for (const { look: patch } of options) {
      for (const field of LOOK_FIELDS) {
        if (field in patch) car[field] = COLOUR_FIELDS.includes(field) ? toNumber(patch[field]) : patch[field];
      }
      // Parts of the nose and tail: out go the car's own parts in that slot, in come the option's (in the same place in the list).
      for (const end of ['nose', 'tail', 'side']) {
        for (const [slot, parts] of Object.entries(patch[end] || {})) {
          const own = car[end] || [], first = own.findIndex((part) => part.slot === slot);
          const kept = own.filter((part) => part.slot !== slot);
          kept.splice(first < 0 ? kept.length : first, 0, ...parts.map((part) => ({ ...part, slot })));
          car[end] = kept;
        }
      }
    }
    made.set(key, car);
  }
  return made.get(key);
}
