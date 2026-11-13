// ---------------------------------------------------------------------------
// hud.js — the on-screen display while driving: digital gauge, timer, pop-up
// messages, big banners and the "press E" prompt.
// It only DISPLAYS things; all game rules live elsewhere.
// ---------------------------------------------------------------------------
import { MPH } from '../config.js';
import { formatTime } from '../core/mathUtils.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const root = $('hud'), gauge = $('gauge').getContext('2d');
  const timerBox = $('timer-box'), timer = $('timer'), timerExtra = $('timer-extra');
  const popups = $('popups'), banner = $('banner'), prompt = $('prompt');
  const status = $('status');
  let bannerTimer = 0, lastPrompt = '';

  // Digital gauge in the style of an aftermarket dash display:
  // gear in a ring, rev arc that turns red near the limit, big green speed.
  function drawGauge({ speed, rpm, redline, gear, fuel, lightMode, handbrake }) {
    const g = gauge, w = 260, h = 230, cx = 150, cy = 150, r = 76;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(4, 10, 7, 0.55)';
    g.beginPath(); g.roundRect(46, 50, 208, 174, 14); g.fill();

    // rev arc, numbered in thousands
    const maxK = Math.ceil(redline / 1000) + 1, startAngle = Math.PI * 0.72, sweep = Math.PI * 1.1;
    for (let k = 0; k <= maxK * 2; k++) {
      const value = k * 500, angle = startAngle + (value / (maxK * 1000)) * sweep;
      const lit = rpm >= value, red = value >= redline - 500;
      g.strokeStyle = red ? (lit ? '#ff4030' : 'rgba(255,64,48,0.35)') : (lit ? '#57ff9a' : 'rgba(87,255,154,0.25)');
      g.lineWidth = k % 2 === 0 ? 5 : 3;
      g.beginPath();
      g.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      g.lineTo(cx + Math.cos(angle) * (r - (k % 2 === 0 ? 14 : 9)), cy + Math.sin(angle) * (r - (k % 2 === 0 ? 14 : 9)));
      g.stroke();
      if (k % 2 === 0) {
        g.fillStyle = red ? '#ff4030' : 'rgba(87,255,154,0.8)'; g.font = '10px Menlo, monospace'; g.textAlign = 'center';
        g.fillText(String(k / 2), cx + Math.cos(angle) * (r + 10), cy + Math.sin(angle) * (r + 10) + 3);
      }
    }
    // speed
    g.fillStyle = '#57ff9a'; g.textAlign = 'center';
    g.font = 'italic bold 52px "Helvetica Neue", Arial';
    g.fillText(String(Math.round(Math.abs(speed) * MPH)), cx + 14, cy + 30);
    g.font = '11px Menlo, monospace'; g.fillText('mph', cx + 14, cy + 48);
    // gear ring
    g.strokeStyle = '#e8f2ea'; g.lineWidth = 2;
    g.beginPath(); g.arc(70, 34, 22, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(4,10,7,0.6)'; g.fill();
    g.fillStyle = '#fff'; g.font = 'italic bold 26px "Helvetica Neue", Arial';
    g.fillText(gear === -1 ? 'R' : String(gear), 70, 43);
    // small icons: headlights, handbrake
    g.font = '11px Menlo, monospace';
    g.fillStyle = lightMode === 2 ? '#4aa8ff' : lightMode === 1 ? '#57ff9a' : 'rgba(255,255,255,0.25)';
    g.fillText(lightMode === 2 ? 'HIGH' : lightMode === 1 ? 'LOW' : 'OFF', 122, 30);
    g.fillStyle = handbrake ? '#ff4030' : 'rgba(255,255,255,0.2)'; g.fillText('(P)', 164, 30);
    // fuel bar
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(190, 20, 56, 8);
    g.fillStyle = fuel < 0.15 ? '#ff4030' : '#57ff9a'; g.fillRect(190, 20, 56 * fuel, 8);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText('FUEL', 218, 42);
  }

  return {
    show(visible) { root.classList.toggle('hidden', !visible); },

    // Floating message under the timer. kind: 'good' | 'bad' | 'info'
    popup(text, kind = 'good') {
      const el = document.createElement('div');
      el.className = 'popup ' + (kind === 'good' ? '' : kind);
      el.textContent = text;
      popups.prepend(el);
      setTimeout(() => el.remove(), 1700);
      while (popups.children.length > 4) popups.lastChild.remove();
    },

    // Big text in the middle of the screen for `seconds`.
    banner(text, small = '', seconds = 2.5, color = '#ffffff') {
      banner.innerHTML = '';
      banner.append(text);
      if (small) { const s = document.createElement('small'); s.textContent = small; banner.append(s); }
      banner.style.color = color;
      banner.classList.add('on');
      bannerTimer = seconds;
    },

    // "Press [E] to ..." — pass null to hide.
    setPrompt(key, text) {
      const html = text ? `<b>${key}</b>${text}` : '';
      if (html !== lastPrompt) { prompt.innerHTML = html; lastPrompt = html; }
    },

    /**
     * @param state { vehicle, lightMode, timer: {visible, text, extra}, statusLines: string[] }
     */
    update(dt, state) {
      const v = state.vehicle;
      drawGauge({ speed: v.speed, rpm: v.engineOff ? 0 : v.rpm, redline: v.spec.engine.redline, gear: v.gear, fuel: v.fuel,
        lightMode: state.lightMode, handbrake: v.handbrake });
      timerBox.classList.toggle('on', state.timer.visible);
      if (state.timer.visible) { timer.textContent = state.timer.text; timerExtra.textContent = state.timer.extra || ''; }
      status.innerHTML = state.statusLines.join('<br>');
      if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) banner.classList.remove('on'); }
    },
    formatTime,
  };
}
