#!/usr/bin/env python3
"""build-audio.py — cuts the game's sound clips out of the recordings in reference/audio/.

    python3 tools/build-audio.py          (needs ffmpeg and numpy)

It writes small .wav files plus public/audio/clips.json, which audio.js reads.
  * loops     a steady stretch, with its end cross-faded into its start so it repeats seamlessly
  * one-shots a window around the loudest moment (a pass-by "whoosh" peaks when the car is closest)
Change the CLIPS table below to pick different stretches, then run it again.
Source recordings are from Freesound: CC0, except the car impacts (CC BY-NC 4.0, nsstudios) -
see reference/audio/README.md.
"""
import json, subprocess, wave, os
import numpy as np

SRC = 'reference/audio/'
OUT = 'public/audio/'

def load(name, rate, channels=1):
    # names starting with '1113550/' come from the second batch of recordings, in reference/1113550/
    path = 'reference/' + name if name.startswith('1113550/') else SRC + name
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(channels), '-ar', str(rate), '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32).reshape(-1, channels) / 32768

ENGINE_RMS = 0.3     # target average level of every engine loop

def save(name, data, rate, peak=0.9):
    if peak is not None: data = data / (np.abs(data).max() + 1e-9) * peak
    with wave.open(OUT + name, 'wb') as w:
        w.setnchannels(data.shape[1]); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((data * 32767).astype(np.int16).tobytes())

def loop(name, start, length, rate, channels=1, fade=0.25):
    """Cut [start, start+length] and blend the audio that follows into the beginning."""
    x = load(name, rate, channels)
    a, n, f = int(start * rate), int(length * rate), int(fade * rate)
    out = x[a:a + n].copy()
    t = np.linspace(0, np.pi / 2, f)[:, None]
    out[:f] = out[:f] * np.sin(t) + x[a + n:a + n + f] * np.cos(t)      # equal-power cross-fade
    return out

def around_peak(name, before, after, rate, channels=2):
    """Cut a window around the loudest 0.1 s of the file. Returns (audio, seconds from start to the peak)."""
    x = load(name, rate, channels)
    hop = rate // 10
    energy = np.array([np.sqrt((x[i:i + hop] ** 2).mean()) for i in range(0, len(x) - hop, hop)])
    peak = int(np.argmax(np.convolve(energy, np.ones(3) / 3, mode='same'))) * hop
    a, b = max(0, peak - int(before * rate)), min(len(x), peak + int(after * rate))
    out = x[a:b].copy()
    edge = int(0.08 * rate)
    ramp = np.linspace(0, 1, edge)[:, None]
    out[:edge] *= ramp; out[-edge:] *= ramp[::-1]
    return out, (peak - a) / rate

os.makedirs(OUT, exist_ok=True)
clips = {}

def cut(name, start, end, rate, channels=1, fade=0.012):
    """A one-shot: [start, end] seconds with a tiny fade at both ends (no clicks)."""
    x = load(name, rate, channels)
    out = x[int(start * rate):int(end * rate)].copy()
    n = int(fade * rate); ramp = np.linspace(0, 1, n)[:, None]
    out[:n] *= ramp; out[-n:] *= ramp[::-1]
    return out

# ---- Engine loops ------------------------------------------------------------------------
# "rpm" = the engine speed of that stretch of recording; audio.js speeds the loop up or down
# from there. For the 1113550 clips it was MEASURED (strongest low tone = firing frequency,
# and a 4-cylinder fires twice per turn, so rpm = Hz x 30): 214 Hz, 172 Hz and 80 Hz.
G = '1113550/01-golf-r-exhaust.mp3'
for key, name, start, length, rpm, fade in [
        ('engine_idle', 'engine-golf-r-exhaust-track.mp3', 493.5, 6.0, 850, 0.25),
        ('engine_low', G, 5.45, 0.9, 2400, 0.12),        # coasting down, off the throttle
        ('engine_mid', G, 3.05, 1.3, 5160, 0.15),        # pulling hard in the next gear
        ('engine_high', G, 0.25, 1.4, 6420, 0.15),       # flat out near the red line
        ('race_low', '1113550/03-vintage-race-engine.mp3', 4.2, 2.2, 2100, 0.2)]:   # lumpy race-cam burble
    audio = loop(name, start, length, 32000, 1, fade)
    # Every engine loop is brought to the SAME average loudness, so the engine does not seem to
    # fade as it revs out. tanh keeps the peaks in check.
    audio = np.tanh(audio / (np.sqrt((audio ** 2).mean()) + 1e-9) * ENGINE_RMS)
    save(key + '.wav', audio, 32000, peak=None)
    clips[key] = {'file': key + '.wav', 'rpm': rpm}

# ---- Forced induction and backfire (second batch) -----------------------------------------
# Exhaust pops: the sharp bangs after each rev in the Audi R8 recording.
for i, (start, end) in enumerate([(1.05, 1.32), (2.99, 3.26), (4.69, 5.0), (6.82, 7.02), (10.24, 10.44)]):
    save(f'pop{i + 1}.wav', cut('1113550/06-audi-r8-revs-and-pops.mp3', start, end, 44100), 44100)
    clips[f'pop{i + 1}'] = {'file': f'pop{i + 1}.wav'}
# Turbo letting go: the wastegate / blow-off moments of the Ferrari F40 recording.
for i, (start, end) in enumerate([(3.62, 4.5), (8.72, 9.4)]):
    save(f'blowoff{i + 1}.wav', cut('1113550/05-f40-turbo-wastegate.mp3', start, end, 44100, 1, 0.05), 44100)
    clips[f'blowoff{i + 1}'] = {'file': f'blowoff{i + 1}.wav'}
# Supercharger whine: a short stretch of the Hellcat at full song (pitch follows rpm in game).
save('supercharger.wav', loop('1113550/04-hellcat-supercharger.mp3', 3.2, 0.45, 32000, 1, 0.08), 32000)
clips['supercharger'] = {'file': 'supercharger.wav', 'rpm': 6000}

# ---- Ambient loops -------------------------------------------------------------------------
save('rain_cabin.wav', loop('rain-cabin-loop.mp3', 20, 14, 32000, 2, 1.0), 32000, 0.7)
save('rain_wipers.wav', loop('rain-cabin-wipers-medium-loop.mp3', 12, 14, 32000, 2, 1.0), 32000, 0.7)
save('road_wet.wav', loop('road-wet-highway-cabin-prius.mp3', 70, 10, 32000, 1, 1.0), 32000, 0.7)
clips.update({'rain_cabin': {'file': 'rain_cabin.wav'}, 'rain_wipers': {'file': 'rain_wipers.wav'}, 'road_wet': {'file': 'road_wet.wav'}})

# ---- One-shots -----------------------------------------------------------------------------
for key, name, before, after in [('pass_highway', 'passby-highway-doppler.mp3', 1.6, 2.0), ('pass_fast', 'passby-high-speed-alternate.mp3', 1.4, 1.8),
                                 ('pass_cabin', 'passby-fast-cabin-doppler.mp3', 1.4, 1.8), ('pass_wet', 'passby-wet-road.mp3', 1.4, 2.0),
                                 ('pass_race', 'passby-race-car-nordschleife.mp3', 1.8, 2.4)]:
    audio, peak = around_peak(name, before, after, 32000)
    save(key + '.wav', audio, 32000)
    clips[key] = {'file': key + '.wav', 'peak': round(peak, 2)}
# Real car impacts (nsstudios "car crash", CC BY-NC 4.0 - non-commercial, credit required).
# 'impact' = one clean thud for every ordinary hit, 'crash' = the full crash for knock-out hits.
def whole(name, rate):
    return load(name, rate, 1)
save('impact.wav', whole('impact-real-car-second-thud.wav', 44100), 44100); clips['impact'] = {'file': 'impact.wav'}
save('crash.wav', whole('impact-real-car-crash-v2.wav', 44100), 44100); clips['crash'] = {'file': 'crash.wav'}
audio, peak = around_peak('engine-mini-cooper-s-gear-shift.mp3', 0.06, 0.3, 32000, 1)
save('shift.wav', audio, 32000); clips['shift'] = {'file': 'shift.wav'}
audio, peak = around_peak('engine-parking-lot-rev.mp3', 1.2, 2.2, 32000, 1)
save('rev.wav', audio, 32000); clips['rev'] = {'file': 'rev.wav'}
audio, peak = around_peak('engine-vintage-race-start-rev.mp3', 1.5, 2.5, 32000, 2)
save('race_start.wav', audio, 32000); clips['race_start'] = {'file': 'race_start.wav'}

json.dump(clips, open(OUT + 'clips.json', 'w'), indent=2)
print(json.dumps(clips, indent=1))
