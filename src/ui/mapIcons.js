// ---------------------------------------------------------------------------
// mapIcons.js — the little signs on the map: one for every kind of place.
//
// Each sign is a round dark badge with a ring and a line drawing in the place's
// colour. The drawings are SVG path strings in a 24 x 24 square (the same kind of
// string as the route arrows in hud.js), stroked - never filled - so they stay
// readable when small.
//
//   drawMapIcon(ctx, kind, x, y, size)   draw the sign for `kind`, centred on (x, y), `size` pixels across
//   MAP_ICONS[kind]                      { color, label, path }: also what the map's legend lists
//
// To add a kind of place: one more line here. (Its colour is used for the stop's
// dot on the main menu's map cards too.)
// ---------------------------------------------------------------------------
export const MAP_ICONS = {
  gas: { color: '#ff5a4a', label: 'FUEL',                       // a pump with its hose
    path: 'M6 20V5h7v15M4.5 20h10M8 8h3v3H8zM13 11h2l1.5 1.5V17a1.2 1.2 0 0 0 2.4 0V9.5L16.5 7' },
  mart: { color: '#3ad68a', label: 'REST STOP',                 // a shop front under its awning
    path: 'M4.5 10l1.5-5h12l1.5 5M4.5 10a2.5 2.5 0 0 0 5 0a2.5 2.5 0 0 0 5 0a2.5 2.5 0 0 0 5 0M6 12.5V19.5h12V12.5M10.5 19.5v-4h3v4' },
  turnout: { color: '#ffd166', label: 'TURNOUT',                // a parking P
    path: 'M9 20V5h4.5a4 4 0 0 1 0 8H9' },
  garage: { color: '#ff7a3a', label: 'GARAGE',                  // a spanner
    path: 'M16.8 4.6a4.2 4.2 0 0 0-5.4 5.4L4.8 16.6a1.85 1.85 0 0 0 2.6 2.6l6.6-6.6a4.2 4.2 0 0 0 5.4-5.4l-2.6 2.6-2.2-.4-.4-2.2z' },
  dealer: { color: '#35d8ff', label: 'DEALERSHIP',              // a car, side on
    path: 'M3.5 15.5v-3l2.6-.7L8.4 8h6.4l3.1 3.8 2.6.7v3h-1.6M8.9 15.5h6.2M3.5 15.5h1.6M7 15.5m-1.9 0a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0M17 15.5m-1.9 0a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0' },
  camera: { color: '#ffb000', label: 'SPEED CAMERA',            // a camera on its pole
    path: 'M5 7h9v6H5zM14 9l4.5-2v6L14 11M9.5 13v7M7 20h5' },
  timeAttack: { color: '#57ff9a', label: 'TIME ATTACK',         // a stopwatch
    path: 'M12 14m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 14v-3.5M10 4h4M12 4v4' },
};

const drawings = {};          // kind -> Path2D (made once)

export function drawMapIcon(ctx, kind, x, y, size) {
  const icon = MAP_ICONS[kind];
  if (!icon) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, size / 4, 0, 7); ctx.fill(); return; }
  const drawing = (drawings[kind] ??= new Path2D(icon.path)), scale = size / 34;      // (the 24-unit drawing sits inside the badge)
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(4, 10, 7, 0.92)'; ctx.strokeStyle = icon.color; ctx.lineWidth = Math.max(1.2, size / 14);
  ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, 7); ctx.fill(); ctx.stroke();
  ctx.scale(scale, scale); ctx.translate(-12, -12);
  ctx.lineWidth = 2; ctx.lineJoin = ctx.lineCap = 'round';
  ctx.stroke(drawing);
  ctx.restore();
}
