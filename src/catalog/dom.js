// ---------------------------------------------------------------------------
// dom.js — small helpers for building the catalogue page without a framework.
//
//   el('div', { class: 'card', onclick: fn }, child, 'text', ...)   one HTML element
//   add(parent, child, cond && child, ...)                          append, skipping null / false
//   svg('path', { d: '...' })                                       one SVG element (for the charts)
//   card('Title', ...children)                                      a titled box in the detail pane
//   facts([['Label', 'value', 'small note'], ...])                  a two-column list of facts
//   chip(color)                                                     a small square of colour
//   fmt(3.14159, 2) -> "3.14"        cssColor(0xff8800) -> "#ff8800"
// ---------------------------------------------------------------------------

// Children may be elements, strings, arrays of those, or null/false (skipped).
const clean = (children) => children.flat(3).filter((child) => child !== null && child !== undefined && child !== false);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);      // onclick, oninput, onpointerdown...
    else if (key in node) node[key] = value;                                         // value, checked, href, title, disabled...
    else node.setAttribute(key, value);
  }
  node.append(...clean(children));
  return node;
}

// parent.append(...) that skips null/false children, so callers can write  cond && card(...)
export function add(parent, ...children) {
  parent.append(...clean(children));
  return parent;
}

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...clean(children));
  return node;
}

export const card = (title, ...children) => el('section', { class: 'card' }, el('h3', {}, title), ...children);

// rows: [label, value, note?] — a row that is null/false is skipped, so callers can write  cond && [...]
export function facts(rows) {
  return el('dl', { class: 'facts' }, rows.filter(Boolean).map(([label, value, note]) => [
    el('dt', {}, label),
    el('dd', {}, value, note && el('small', {}, note)),
  ]));
}

// A number with a fixed count of decimals; "—" when there is no number.
export const fmt = (value, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

// Colours arrive as numbers (0xd42222) or strings ("#d42222"); CSS wants the string.
export const cssColor = (color) => (typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : String(color));

export const chip = (color, label = '') => el('span', { class: 'chip-row' }, el('span', { class: 'chip', style: `background:${cssColor(color)}` }), label || cssColor(color));

// A small coloured label, e.g. "發光" or "hero".
export const badge = (text, kind = '') => el('span', { class: 'badge ' + kind }, text);

// A switch button that stays lit while it is on.  toggle('煞車', false, (on) => ...)
export function toggle(label, on, onChange) {
  const button = el('button', { class: 'tool' + (on ? ' on' : ''), onclick: () => {
    on = !on;
    button.classList.toggle('on', on);
    onChange(on);
  } }, label);
  return button;
}

// A row of buttons of which exactly one is lit.  choice([['關', 0], ['近光', 1]], 0, (value) => ...)
export function choice(options, current, onChange) {
  const row = el('span', { class: 'choice' });
  for (const [label, value] of options) {
    row.append(el('button', { class: 'tool' + (value === current ? ' on' : ''), onclick: (event) => {
      for (const button of row.children) button.classList.toggle('on', button === event.currentTarget);
      onChange(value);
    } }, label));
  }
  return row;
}
