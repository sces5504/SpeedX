// ---------------------------------------------------------------------------
// osm-route.mjs — finds a drive that uses SEVERAL real roads, for build-map.mjs.
//
// build-map.mjs on its own follows ONE named road from start to end. A loop (drive
// around for ever, no turning back) has to leave that road and come home on other
// roads, so here you give "via" points instead and this file:
//   1. downloads every drivable road around those points from OpenStreetMap
//   2. finds the shortest legal drive from each via point to the next
//      (and, for a loop, from the last one back to the first)
//   3. on a divided road (two one-way halves with a median) moves the line to the
//      middle of the two halves, because the game draws both halves around one line
//   4. notes what the map says about each stretch — road name, lanes, speed limit —
//      and where the traffic lights are, so the game's traffic can follow the map
//
// Tip: the route between two via points is the SHORTEST one. To force the drive
// along a longer road, put a via point somewhere in the middle of that road.
// ---------------------------------------------------------------------------

const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const MEDIAN_SEARCH_M = 40;      // how far away the other half of a divided road may be
const SIGNAL_MERGE_M = 40;       // traffic lights closer together than this are one junction

/**
 * @param via          [{ lat, lon }, ...] points the drive must pass, in order
 * @param loop         true = also drive from the last point back to the first
 * @param toLocal      (lat, lon) -> { x, z } in metres (from build-map.mjs)
 * @param fetchCached  (fileName, url, options) -> Buffer (from build-map.mjs)
 * @param cacheName    file name for the downloaded roads in tools/.cache
 * @returns { road: [{x, z}], sections: [...], signals: [metres...], length }
 */
export async function findRoute({ via, loop, toLocal, fetchCached, cacheName }) {
  // ---- 1. Download the roads around the via points ------------------------------
  const pad = 0.015;                                           // about 1.5 km
  const box = [Math.min(...via.map((p) => p.lat)) - pad, Math.min(...via.map((p) => p.lon)) - pad,
               Math.max(...via.map((p) => p.lat)) + pad, Math.max(...via.map((p) => p.lon)) + pad].join(',');
  const query = `[out:json][timeout:90];(way["highway"~"^(${DRIVABLE})$"](${box});node["highway"="traffic_signals"](${box}););out geom;`;
  const buf = await fetchCached(cacheName, 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'speedx-map-builder/0.1', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  const elements = JSON.parse(buf.toString()).elements;
  const ways = elements.filter((e) => e.type === 'way');
  const signalNodes = new Set(elements.filter((e) => e.type === 'node').map((e) => e.id));

  // ---- 2. A graph: every map point knows which points you may drive to from it ----
  const nodes = new Map();                                     // id -> { id, x, z, edges: [{ to, length, way }] }
  const node = (id, geo) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...toLocal(geo.lat, geo.lon), edges: [] });
    return nodes.get(id);
  };
  for (const way of ways) {
    const oneway = way.tags.oneway, forward = oneway !== '-1', backward = oneway !== 'yes' && way.tags.junction !== 'roundabout';
    for (let i = 1; i < way.nodes.length; i++) {
      const a = node(way.nodes[i - 1], way.geometry[i - 1]), b = node(way.nodes[i], way.geometry[i]);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (forward) a.edges.push({ to: b, length, way });
      if (backward) b.edges.push({ to: a, length, way });
    }
  }
  const nearestNode = (p) => {
    const q = toLocal(p.lat, p.lon);
    let best = null, bestD = Infinity;
    for (const n of nodes.values()) {
      const d = (n.x - q.x) ** 2 + (n.z - q.z) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  };

  // Shortest legal drive from one map point to another (Dijkstra's algorithm).
  function drive(from, to) {
    const cost = new Map([[from, 0]]), cameFrom = new Map(), open = [from];
    while (open.length) {
      let k = 0;
      for (let i = 1; i < open.length; i++) if (cost.get(open[i]) < cost.get(open[k])) k = i;
      const here = open.splice(k, 1)[0];
      if (here === to) break;
      for (const edge of here.edges) {
        const c = cost.get(here) + edge.length;
        if (c < (cost.get(edge.to) ?? Infinity)) {
          if (!cost.has(edge.to)) open.push(edge.to);
          cost.set(edge.to, c); cameFrom.set(edge.to, { node: here, way: edge.way });
        }
      }
    }
    if (!cameFrom.has(to)) throw new Error('No drivable route between two of the --via points. Move one of them onto a road.');
    const steps = [];
    for (let n = to; n !== from; n = cameFrom.get(n).node) steps.push({ node: n, way: cameFrom.get(n).way });
    return steps.reverse();                                    // every step = the point reached + the road used to reach it
  }

  const stops = via.map(nearestNode);
  if (loop) stops.push(stops[0]);
  const route = [];
  for (let i = 1; i < stops.length; i++) route.push(...drive(stops[i - 1], stops[i]));
  if (!loop) route.unshift({ node: stops[0], way: route[0].way });
  // (For a loop the last step arrives back at the first via point, so the list is already a closed ring.)

  // ---- 3. Divided roads: move the line to the middle of the two halves ------------
  const usedWays = new Set(route.map((step) => step.way));
  const otherHalves = [];                                      // pieces of one-way roads the route does NOT use
  for (const way of ways) {
    if (way.tags.oneway !== 'yes' || usedWays.has(way)) continue;
    for (let i = 1; i < way.nodes.length; i++) otherHalves.push({ a: nodes.get(way.nodes[i - 1]), b: nodes.get(way.nodes[i]), ref: way.tags.ref });
  }
  const count = route.length;
  const points = route.map((step, i) => {
    const here = step.node, point = { x: here.x, z: here.z, divided: false };
    if (step.way.tags.oneway !== 'yes') return point;
    const before = route[loop ? (i + count - 1) % count : Math.max(0, i - 1)].node;
    const after = route[loop ? (i + 1) % count : Math.min(count - 1, i + 1)].node;
    const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz) || 1;
    let best = null, bestD = MEDIAN_SEARCH_M;
    for (const seg of otherHalves) {
      if (seg.ref !== step.way.tags.ref) continue;
      const sx = seg.b.x - seg.a.x, sz = seg.b.z - seg.a.z, segLen2 = sx * sx + sz * sz || 1;
      if ((sx * dx + sz * dz) / (Math.sqrt(segLen2) * len) > -0.5) continue;       // must run the opposite way
      const t = Math.min(1, Math.max(0, ((here.x - seg.a.x) * sx + (here.z - seg.a.z) * sz) / segLen2));
      const px = seg.a.x + sx * t, pz = seg.a.z + sz * t, d = Math.hypot(px - here.x, pz - here.z);
      if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
    }
    if (best) { point.x = (here.x + best.x) / 2; point.z = (here.z + best.z) / 2; point.divided = true; }
    return point;
  });

  // ---- 4. What the map says about each stretch, and where the lights are ----------
  const sections = [], signals = [];
  let metres = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) metres += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const tags = route[i].way.tags, divided = points[i].divided;
    const lanesHere = Number(tags.lanes) || null;               // on a one-way half this counts that half only
    const facts = {
      name: [tags.ref, tags.bridge ? '' : tags.name].filter(Boolean).join(' '),
      kind: tags.highway,
      lanes: lanesHere && (divided ? lanesHere * 2 : lanesHere),
      divided,
      speedKmh: Number(tags.maxspeed) || null,
    };
    const last = sections[sections.length - 1];
    const same = last && last.kind === facts.kind && last.lanes === facts.lanes && last.divided === facts.divided
      && last.speedKmh === facts.speedKmh && (!facts.name || last.name === facts.name || tags.bridge);
    if (same) last.to = Math.round(metres);
    else sections.push({ from: last ? last.to : 0, to: Math.round(metres), ...facts });      // starts where the one before ended
    if (signalNodes.has(route[i].node.id) && !(signals.length && metres - signals[signals.length - 1] < SIGNAL_MERGE_M)) signals.push(Math.round(metres));
  }
  if (loop) metres += Math.hypot(points[0].x - points[count - 1].x, points[0].z - points[count - 1].z);
  sections[sections.length - 1].to = Math.round(metres);
  // Tiny scraps (a few metres between two tags) only make the list hard to read: fold them into a neighbour.
  for (let i = sections.length - 1; i > 0; i--) {
    if (sections[i].to - sections[i].from < 30) { sections[i - 1].to = sections[i].to; sections.splice(i, 1); }
  }
  if (sections.length > 1 && sections[0].to < 30) { sections[1].from = 0; sections.shift(); }
  // On a loop the last light and the first one can be the same junction, seen from both sides of the join.
  if (loop && signals.length > 1 && metres - signals[signals.length - 1] + signals[0] < SIGNAL_MERGE_M) signals.pop();

  return { road: points.map(({ x, z }) => ({ x, z })), sections, signals, length: metres };
}
