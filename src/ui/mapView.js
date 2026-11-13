// ---------------------------------------------------------------------------
// mapView.js — draws the road as a 2D map: a small round minimap that follows
// you, and a full-screen map (press M) of the whole highway. On the full map
// the coloured circles are places: click one to travel there.
// ---------------------------------------------------------------------------
const POI_COLORS = { gas: '#ff5a4a', mart: '#3ad68a', turnout: '#ffd166' };

export function createMapView(map, onPickPoi) {
  const { road } = map;
  const mini = document.getElementById('minimap'), miniCtx = mini.getContext('2d');
  const full = document.getElementById('map-canvas'), fullCtx = full.getContext('2d');
  const screen = document.getElementById('map-screen');

  // Shared drawing routine. `toScreen` converts world (x, z) to canvas pixels.
  function draw(ctx, toScreen, { player, others, challenge, labels, stride }) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [color, width] of [['rgba(0,0,0,0.8)', labels ? 7 : 6], ['#cfd8d2', labels ? 3 : 3.2]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < road.count; i += stride) {
        const [x, y] = toScreen(road.x[i], road.z[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (const poi of map.pois) {
      const [x, y] = toScreen(road.x[poi.index], road.z[poi.index]);
      ctx.fillStyle = POI_COLORS[poi.type] || '#ffffff'; ctx.beginPath(); ctx.arc(x, y, labels ? 9 * devicePixelRatio : 5, 0, 7); ctx.fill();
      if (labels) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14 * devicePixelRatio, 0, 7); ctx.stroke(); }
      if (labels) { ctx.fillStyle = '#e8f2ea'; ctx.font = `${13 * devicePixelRatio}px Menlo, monospace`; ctx.fillText(poi.name, x + 20 * devicePixelRatio, y + 4); }
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
  for (let i = 0; i < road.count; i++) {
    minX = Math.min(minX, road.x[i]); maxX = Math.max(maxX, road.x[i]);
    minZ = Math.min(minZ, road.z[i]); maxZ = Math.max(maxZ, road.z[i]);
  }

  // Click a place on the full map to travel there.
  let toScreenFull = null;
  full.addEventListener('click', (e) => {
    if (!toScreenFull) return;
    const rect = full.getBoundingClientRect(), scale = full.width / rect.width;
    const cx = (e.clientX - rect.left) * scale, cy = (e.clientY - rect.top) * scale;
    for (const poi of map.pois) {
      const [x, y] = toScreenFull(road.x[poi.index], road.z[poi.index]);
      if (Math.hypot(x - cx, y - cy) < 26 * devicePixelRatio) { onPickPoi(poi); return; }
    }
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
      draw(fullCtx, toScreenFull, { ...info, labels: true, stride: 2 });
      fullCtx.restore();
      fullCtx.fillStyle = '#9fb3a6'; fullCtx.font = `${12 * devicePixelRatio}px Menlo, monospace`;
      fullCtx.fillText('N ↑', 20 * devicePixelRatio, 28 * devicePixelRatio);
    },
  };
}
