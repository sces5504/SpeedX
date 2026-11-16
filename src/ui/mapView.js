// ---------------------------------------------------------------------------
// mapView.js — draws the road as a 2D map: a small round minimap that follows
// you, and a full-screen map (press M) of the whole highway. Every place has
// its own sign (ui/mapIcons.js): fuel, rest stop, turnout, garage, dealership,
// speed camera. On the full map click a stop to travel there; under each stop and
// camera are the stars the player has there (a stop's are its time attack's).
// Also: the little route pictures on the map cards of the main menu.
// ---------------------------------------------------------------------------
import { MAP_ICONS, drawMapIcon } from './mapIcons.js';

const stars = (count) => '★'.repeat(count) + '☆'.repeat(3 - count);

// How long a road is, from its list of [x, z] points (metres).
// closed = the road is a loop, so the piece from the last point back to the first counts too.
export function routeLength(points, closed = false) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed) length += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  return length;
}

// A small picture of a map's road and its stops for the main menu, drawn straight from the
// map's map.json (`info`) — so every installed map can be shown without loading it.
export function drawRoutePreview(canvas, info) {
  const points = info.road, ctx = canvas.getContext('2d');
  const lines = [{ road: points, loop: info.loop }, ...(info.roads || [])];      // the main road, then any others
  canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio;
  const xs = lines.flatMap((line) => line.road.map((p) => p[0])), zs = lines.flatMap((line) => line.road.map((p) => p[1]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const pad = 14 * devicePixelRatio;
  const scale = Math.min((canvas.width - pad * 2) / (maxX - minX || 1), (canvas.height - pad * 2) / (maxZ - minZ || 1));
  const ox = (canvas.width - (maxX - minX) * scale) / 2, oz = (canvas.height - (maxZ - minZ) * scale) / 2;
  const toScreen = ([x, z]) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];      // north is up, as on the full map
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.strokeStyle = '#cfd8d2'; ctx.lineWidth = 2 * devicePixelRatio;
  for (const line of lines) {
    ctx.beginPath();
    line.road.forEach((point, i) => { const [x, y] = toScreen(point); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    if (line.loop) ctx.closePath();                          // a loop: join the end to the start
    ctx.stroke();
  }
  // The stops, each `s` metres along the road.
  for (const poi of info.pois || []) {
    let left = poi.s, at = points[points.length - 1];
    for (let i = 1; i < points.length; i++) {
      const step = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      if (left <= step) { const f = left / (step || 1); at = [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f]; break; }
      left -= step;
    }
    const [x, y] = toScreen(at);
    ctx.fillStyle = MAP_ICONS[poi.type]?.color || '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 4 * devicePixelRatio, 0, 7); ctx.fill();
  }
}

// onPickPoi(poi) = a stop was clicked; onPickPlace(x, z) = somewhere else on the map was clicked.
export function createMapView(map, onPickPoi, onPickPlace) {
  const { road } = map;
  const mini = document.getElementById('minimap'), miniCtx = mini.getContext('2d');
  const full = document.getElementById('map-canvas'), fullCtx = full.getContext('2d');
  const screen = document.getElementById('map-screen');

  // The legend under the full map: every sign and what it means.
  const legend = document.getElementById('map-legend');
  for (const [kind, icon] of Object.entries(MAP_ICONS)) {
    if (kind === 'timeAttack') continue;                       // (every stop has a time attack: its stars are under the stop)
    const item = document.createElement('span'), picture = document.createElement('canvas');
    picture.width = picture.height = 44;
    drawMapIcon(picture.getContext('2d'), kind, 22, 22, 40);
    item.append(picture, icon.label);
    legend.append(item);
  }

  // Shared drawing routine. `toScreen` converts world (x, z) to canvas pixels.
  // cameras: [{ x, z, name, stars }], stopStars(poi) -> the stars of that stop's time attack.
  function draw(ctx, toScreen, { player, others, challenge, labels, stride, route, routeColor, goal, cameras = [], stopStars = () => 0 }) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [color, width] of [['rgba(0,0,0,0.8)', labels ? 7 : 6], ['#cfd8d2', labels ? 3 : 3.2]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      for (const way of map.ways) {                          // every road of the map
        ctx.beginPath();
        for (let i = 0; i < way.road.count; i += stride) {
          const [x, y] = toScreen(way.road.x[i], way.road.z[i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        const [x, y] = toScreen(way.road.x[way.road.count - 1], way.road.z[way.road.count - 1]);
        ctx.lineTo(x, y);                                    // (right to its last point: that is where it joins the next road)
        if (way.road.closed) ctx.closePath();                // a loop: join the end to the start
        ctx.stroke();
      }
    }
    // The way to go (a race's shortest way to its gate, or to the destination picked on this map).
    if (route) {
      ctx.strokeStyle = routeColor; ctx.lineWidth = labels ? 5 : 4;
      ctx.beginPath();
      route.forEach((point, i) => { const [x, y] = toScreen(point[0], point[1]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    }
    if (goal) {
      const [x, y] = toScreen(goal.x, goal.z);
      ctx.fillStyle = routeColor; ctx.beginPath(); ctx.arc(x, y, labels ? 8 : 5, 0, 7); ctx.fill();
    }
    // Places: each with its own sign; on the full map also its name and the stars the player has there.
    const pixel = labels ? devicePixelRatio : 1;
    const caption = (x, y, name, count, color) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8f2ea'; ctx.font = `${13 * pixel}px Menlo, monospace`; ctx.fillText(name, x + 20 * pixel, y - 1 * pixel);
      ctx.fillStyle = color; ctx.font = `${11 * pixel}px Menlo, monospace`; ctx.fillText(stars(count), x + 20 * pixel, y + 13 * pixel);
    };
    for (const camera of cameras) {
      const [x, y] = toScreen(camera.x, camera.z);
      drawMapIcon(ctx, 'camera', x, y, labels ? 24 * pixel : 13);
      if (labels) caption(x, y, camera.name, camera.stars, MAP_ICONS.camera.color);
    }
    for (const poi of map.pois) {
      const [x, y] = toScreen(road.x[poi.index], road.z[poi.index]);
      drawMapIcon(ctx, poi.type, x, y, labels ? 30 * pixel : 16);
      if (labels) caption(x, y, poi.name, stopStars(poi), MAP_ICONS.timeAttack.color);
    }
    if (challenge) {
      const [x, y] = toScreen(challenge.x, challenge.z);
      ctx.strokeStyle = '#57ff9a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, labels ? 10 : 7, 0, 7); ctx.stroke();
    }
    for (const o of others) {
      const [x, y] = toScreen(o.x, o.z);
      ctx.fillStyle = o.kind === 'rival' ? '#ff4bd0' : 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(x, y, o.kind === 'rival' ? 4.5 : 2.5, 0, 7); ctx.fill();
    }
    // The player: a little arrow pointing where the car points.
    const [px, py] = toScreen(player.x, player.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-player.yaw);
    ctx.fillStyle = '#57ff9a'; ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Bounding box of the whole road, for the full map.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const way of map.ways) for (let i = 0; i < way.road.count; i++) {
    minX = Math.min(minX, way.road.x[i]); maxX = Math.max(maxX, way.road.x[i]);
    minZ = Math.min(minZ, way.road.z[i]); maxZ = Math.max(maxZ, way.road.z[i]);
  }

  // Click a place on the full map to travel there.
  let toScreenFull = null, toWorldFull = null;
  full.addEventListener('click', (e) => {
    if (!toScreenFull) return;
    const rect = full.getBoundingClientRect(), scale = full.width / rect.width;
    const cx = (e.clientX - rect.left) * scale, cy = (e.clientY - rect.top) * scale;
    for (const poi of map.pois) {
      const [x, y] = toScreenFull(road.x[poi.index], road.z[poi.index]);
      if (Math.hypot(x - cx, y - cy) < 26 * devicePixelRatio) { onPickPoi(poi); return; }
    }
    onPickPlace(...toWorldFull(cx, cy));                     // anywhere else: a destination to be shown the way to
  });

  return {
    get open() { return !screen.classList.contains('hidden'); },
    toggle(force) { screen.classList.toggle('hidden', force === undefined ? undefined : !force); },

    drawMini(info) {
      const size = mini.width, scale = size / 700;          // shows 700 m across
      miniCtx.clearRect(0, 0, size, size);
      draw(miniCtx, (x, z) => [size / 2 + (x - info.player.x) * scale, size / 2 + (z - info.player.z) * scale], { ...info, labels: false, stride: 3 });
    },

    drawFull(info) {
      const rect = full.getBoundingClientRect();
      full.width = rect.width * devicePixelRatio; full.height = rect.height * devicePixelRatio;
      const pad = 60 * devicePixelRatio;
      const scale = Math.min((full.width - pad * 2) / (maxX - minX), (full.height - pad * 2) / (maxZ - minZ));
      const ox = (full.width - (maxX - minX) * scale) / 2, oz = (full.height - (maxZ - minZ) * scale) / 2;
      fullCtx.clearRect(0, 0, full.width, full.height);
      fullCtx.save();
      toScreenFull = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];
      toWorldFull = (px, py) => [minX + (px - ox) / scale, minZ + (py - oz) / scale];
      draw(fullCtx, toScreenFull, { ...info, labels: true, stride: 2 });
      fullCtx.restore();
      fullCtx.fillStyle = '#9fb3a6'; fullCtx.font = `${12 * devicePixelRatio}px Menlo, monospace`;
      fullCtx.fillText('N ↑', 20 * devicePixelRatio, 28 * devicePixelRatio);
    },
  };
}
