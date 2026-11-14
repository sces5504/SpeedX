// ---------------------------------------------------------------------------
// charts.js — the line charts of the catalogue, drawn as SVG (no chart library).
//
//   plot({ ... })   an empty chart: frame, grid lines and numbers on the axes.
//                   It returns { node, X, Y, add } — X(value) and Y(value) turn
//                   data into pixel positions, add(...) puts shapes on top.
//   linePath(points)   "M x y L x y ..." for an SVG <path> from [[x, y], ...] pixels
//
// The torque curve (carsPage.js) and the elevation profile (mapsPage.js) are
// both built on plot().
// ---------------------------------------------------------------------------
import { add, svg } from './dom.js';

export const linePath = (points) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

// A "nice" distance between grid lines: 1, 2 or 5 times a power of ten, giving about `count` lines.
export function niceStep(range, count = 5) {
  const rough = range / count, power = 10 ** Math.floor(Math.log10(rough)), unit = rough / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

/**
 * @param o { width, height, xMin, xMax, yMin, yMax, xStep, yStep,
 *            xLabel(value) / yLabel(value): text for a grid line (default: the number),
 *            right: pixels kept free on the right (for a second axis) }
 */
export function plot({ width = 640, height = 240, xMin, xMax, yMin, yMax, xStep, yStep, xLabel = String, yLabel = String, right = 14 }) {
  const left = 46, top = 12, bottom = 26;
  const X = (x) => left + ((x - xMin) / (xMax - xMin)) * (width - left - right);
  const Y = (y) => height - bottom - ((y - yMin) / (yMax - yMin)) * (height - top - bottom);
  const node = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart' });
  // Grid lines with their numbers (tiny rounding errors are tidied away with toFixed).
  const tidy = (value, step) => Number(value.toFixed(Math.max(0, -Math.floor(Math.log10(step)) + 1)));
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
    node.append(svg('line', { x1: X(x), x2: X(x), y1: top, y2: height - bottom, class: 'grid' }),
      svg('text', { x: X(x), y: height - 8, 'text-anchor': 'middle', class: 'axis' }, xLabel(tidy(x, xStep))));
  }
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    node.append(svg('line', { x1: left, x2: width - right, y1: Y(y), y2: Y(y), class: 'grid' }),
      svg('text', { x: left - 6, y: Y(y) + 4, 'text-anchor': 'end', class: 'axis' }, yLabel(tidy(y, yStep))));
  }
  return { node, X, Y, left, right: width - right, top, bottom: height - bottom, add: (...shapes) => add(node, ...shapes) };
}
