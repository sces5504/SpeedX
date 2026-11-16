// ---------------------------------------------------------------------------
// wallet.js — what the player has, written large: money, and reputation under it.
// The main menu, the garage, the dealership and the Blacklist all show it the
// same way, so it is drawn in one place.
//
//   renderWallet(element)     fill a <div class="wallet"> (style.css) with it
//   dollars(amount)           "$12,500"
// ---------------------------------------------------------------------------
import { career } from '../game/career.js';
import { SANDBOX } from '../game/save.js';

export const dollars = (amount) => '$' + Math.round(amount).toLocaleString();

export function renderWallet(element) {
  element.innerHTML = SANDBOX
    ? '<b>SANDBOX</b><span>every car and part is free</span>'
    : `<b>${dollars(career.money)}</b><span>REPUTATION <i>${career.reputation.toLocaleString()}</i></span>`;
}
