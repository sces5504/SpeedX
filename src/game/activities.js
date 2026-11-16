// ---------------------------------------------------------------------------
// activities.js — the one thing the player is in the middle of, from start to pay-out.
//
// An ACTIVITY is anything with a beginning and an end that the free driving is
// interrupted for:
//   'street'      a race against a street racer met on the road
//   'blacklist'   a race against a Blacklist driver
//   'timeAttack'  a timed run from an orange cone
// There is never more than one.
// (A SPEED CAMERA is an activity too, but it is over the instant it happens, so it never
// needs this file. It and the time attack give STARS, paid the first time each level is
// reached: career.awardStars - see game/speedTraps.js and game/challenge.js.) Every activity goes through the same life:
//
//   begin(kind, details)   it starts (refused while another is running)
//   finish(won)            it ran to its end: the reward is worked out and paid - ONCE
//   cancel()               it was abandoned: nothing is paid, nothing is lost
//
// WHAT ABANDONS AN ACTIVITY (main.js calls cancel for all of these): travelling
// somewhere from the map screen, going into the garage or back to the main menu,
// changing car, and leaving the game - an activity is never written to the save
// file, so after a reload the player is simply driving around again.
//
// THE REWARD is decided here (rewardFor) and handed over by career.settle() under
// the activity's own number, so that a result which somehow comes in twice is
// paid once.
// ---------------------------------------------------------------------------
import { GAMEPLAY } from '../config.js';
import { clamp } from '../core/mathUtils.js';
import { RULES, career } from './career.js';

const tidy = (amount) => Math.round(amount / 10) * 10;

// What winning pays. details: { playerRating, rivalRating, length (metres), entry (a Blacklist driver) }
function rewardFor(activity) {
  if (activity.kind === 'timeAttack') return {};          // (its stars are paid by challenge.js)
  const first = activity.kind === 'blacklist' && !career.hasBeaten(activity.entry);
  if (first) return { ...activity.entry.prize, car: activity.entry.car, beaten: activity.entry.id };
  // A street race (or beating a Blacklist driver again): the usual sum, more for a faster rival, less for a shorter race.
  const harder = clamp(1 + (activity.rivalRating - activity.playerRating) / 300, 0.5, 2);
  const longer = clamp(activity.length / GAMEPLAY.raceLength, 0.4, 1.2);
  return { money: tidy(RULES.streetRace.money * harder * longer), reputation: tidy(RULES.streetRace.reputation * harder * longer) };
}

export function createActivities() {
  let count = 0;
  const activities = {
    current: null,                           // { id, kind, ...details } while one is running
    begin(kind, details = {}) {
      if (activities.current) return null;
      activities.current = { id: `${kind}-${Date.now()}-${++count}`, kind, ...details };
      return activities.current;
    },
    cancel() { activities.current = null; },
    /**
     * The activity ran to its end. Returns what was paid: { money, reputation, car, beaten } -
     * empty for a loss, null if there was no activity (or its reward had been paid already).
     */
    finish(won) {
      const activity = activities.current;
      if (!activity) return null;
      activities.current = null;
      return won ? career.settle({ id: activity.id, ...rewardFor(activity) }) : {};
    },
  };
  return activities;
}
