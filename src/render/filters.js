// ---------------------------------------------------------------------------
// filters.js — optional "looks" laid over the finished picture, chosen in the
// pause menu (ESC -> FILTER). With the filter OFF this file does nothing at
// all: the picture is exactly what postfx.js makes.
//
// A filter is one entry in FILTERS:
//   id, name     how it is saved and what the menu shows
//   about        one line for people reading this file
//   glsl         shader text that defines   vec3 look(vec2 uv)
//                — the colour of the pixel at uv (0..1 across, 0..1 up).
//                It may use:  tDiffuse (the game's picture), uTime (seconds),
//                uAspect (width / height), hash(vec2) (a random 0..1 number)
//   ownColours   true = the filter brings its own colours, so the game's
//                cinema colour grade (step 6 in postfx.js) is switched off
//   camera       camera dials it changes while it is on — any of the "film
//                camera" numbers in config.js -> GRAPHICS (bloomStrength,
//                bloomRadius, bloomThreshold, streak, lensDistortion, grain)
//
// To add a filter: add an entry to FILTERS. Nothing else needs to change —
// the pause menu lists whatever is here.
// ---------------------------------------------------------------------------

export const FILTERS = [
  { id: 'off', name: 'OFF', about: 'No filter: the game as it is.' },

  {
    id: 'classic', name: 'CLASSIC GREEN',
    about: 'The colours of the first public version of SpeedX: an olive-green cast and slightly quieter colour. Only the colours change - every effect of the game (glow, streaks, reflections, dazzle) stays as it is.',
    glsl: `
      vec3 look(vec2 uv) {
        vec3 col = texture2D(tDiffuse, uv).rgb;
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // 1. take out the game's own tint (blue shadows, orange highlights: step 6 of the lens pass
        //    in postfx.js - these are the same two colours), which that version did not have
        col /= mix(vec3(0.86, 1.0, 1.16), vec3(1.07, 1.0, 0.92), smoothstep(0.03, 0.6, luma));
        // 2. that version's colours: a little quieter, with a green cast, greenest in the shadows
        luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(luma), col, 0.8);
        col *= vec3(1.0, 1.03, 0.875);
        col += vec3(0.004, 0.016, 0.009) * (1.0 - smoothstep(0.0, 0.5, luma));
        return col;
      }`,
  },

  {
    id: 'vhs', name: 'VHS TAPE',
    about: 'A worn video tape: colour that bleeds sideways, over-sharpened edges, lines that wobble, a band of bad tracking rolling up the screen, tape noise that runs along the lines, and now and then a drop-out.',
    camera: { grain: 0.02 },
    glsl: `
      // Tape noise is not TV static: it is smeared ALONG each line. A random value per little
      // piece of line, blended into the next piece.
      float along(vec2 cell) {
        float i = floor(cell.x), f = fract(cell.x);
        return mix(hash(vec2(i, cell.y)), hash(vec2(i + 1.0, cell.y)), f * f * (3.0 - 2.0 * f));
      }
      vec3 look(vec2 uv) {
        float line = floor(uv.y * 288.0);                      // a tape picture is made of a few hundred lines
        float tick = floor(uTime * 30.0);                      // ...and changes 30 times a second
        // every line sits a hair to the left or right of where it should
        uv.x += (hash(vec2(line, tick)) - 0.5) * 0.0007;
        // a band of bad tracking drifts slowly up the picture, tearing the lines inside it sideways
        float band = smoothstep(0.03, 0.0, abs(fract(uv.y - uTime * 0.06) - 0.5));
        uv.x += band * (along(vec2(uv.x * 6.0 + tick, line)) - 0.5) * 0.025;
        // the bottom few lines are always torn (the tape heads switching over)
        float bottom = smoothstep(0.025, 0.0, uv.y);
        uv.x += bottom * (hash(vec2(line, tick + 3.0)) - 0.35) * 0.09;

        // Brightness: fairly sharp, and "edge enhanced" the way video recorders did it - a little
        // too much, so that edges get a thin bright or dark rim.
        const vec3 GREY = vec3(0.299, 0.587, 0.114);
        float px = 0.0011;
        float centre = dot(texture2D(tDiffuse, uv).rgb, GREY);
        float sides = dot(texture2D(tDiffuse, uv - vec2(px * 2.0, 0.0)).rgb + texture2D(tDiffuse, uv + vec2(px * 2.0, 0.0)).rgb, GREY) * 0.5;
        float bright = mix(centre, sides, 0.25) + (centre - sides) * 0.5;
        // Colour: tape keeps very little colour detail, so it is smeared sideways and arrives a
        // little late (to the right of where it belongs).
        vec3 smear = vec3(0.0);
        for (int i = -2; i <= 2; i++) smear += texture2D(tDiffuse, uv + vec2(float(i) * 0.003 - 0.003, 0.0)).rgb;
        smear /= 5.0;
        vec3 colour = smear - dot(smear, GREY);
        // colour noise: slow, blotchy, a few lines tall
        colour += (vec3(along(vec2(uv.x * 26.0, floor(line / 3.0) + tick)), 0.5, along(vec2(uv.x * 22.0 + 9.0, floor(line / 3.0) + tick * 1.7))) - 0.5) * 0.05;
        vec3 col = vec3(bright) + colour * 1.2;

        col = col * 0.92 + 0.035;                              // blacks are grey, whites are dull
        col *= vec3(1.03, 0.98, 1.06);                         // the faint purple of old tape
        col *= 0.95 + 0.05 * sin(uv.y * 288.0 * 6.2832);       // scan lines
        // brightness noise: fine dashes along the lines, clearest in the dark, heavy in the torn parts
        float noise = along(vec2(uv.x * 420.0 + tick * 13.0, line + tick)) - 0.5;
        col += noise * (0.045 * (1.2 - bright) + band * 0.25 + bottom * 0.3);
        // drop-outs: now and then the tape loses its signal for part of a line - a white streak
        // that starts suddenly and fades out to the right like a comet
        float start = hash(vec2(line, tick * 1.3 + 5.0));
        float lost = step(0.997, hash(vec2(line * 1.7, tick))) * step(start, uv.x) * exp(-(uv.x - start) * 22.0);
        return col + lost * 0.6;
      }`,
  },
];

export const findFilter = (id) => FILTERS.find((filter) => filter.id === id) || FILTERS[0];

// The complete shader for one filter (postfx.js turns it into a post-processing pass).
export function filterShader(filter) {
  return {
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1.7 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime, uAspect; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ${filter.glsl}
      void main() { gl_FragColor = vec4(max(look(vUv), 0.0), 1.0); }`,
  };
}
