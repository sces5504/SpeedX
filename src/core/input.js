// Keyboard input. Other files ask "is this action held?" or "was it just pressed?"
// using action names from config.js (KEYS), never raw key codes.
import { KEYS } from '../config.js';

const held = new Set();      // key codes currently down
const pressed = new Set();   // key codes that went down since the last frame

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Backspace') e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

// Mouse: hold the left button and move to look around. dx/dy = movement this frame.
const mouse = { down: false, dx: 0, dy: 0 };
window.addEventListener('mousedown', (e) => { if (e.button === 0 && e.target.tagName === 'CANVAS') mouse.down = true; });
window.addEventListener('mouseup', () => { mouse.down = false; });
window.addEventListener('mousemove', (e) => { if (mouse.down) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });

export const input = {
  mouse,
  isHeld: (action) => KEYS[action].some((code) => held.has(code)),
  wasPressed: (action) => KEYS[action].some((code) => pressed.has(code)),
  anyPressed: () => pressed.size > 0,
  // Call once at the end of every frame.
  endFrame: () => { pressed.clear(); mouse.dx = mouse.dy = 0; },
};
