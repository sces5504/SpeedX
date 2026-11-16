#!/usr/bin/env python3
"""check-audio.py — measures every engine loop in public/audio/ and points out the bad ones.

    python3 tools/check-audio.py            (needs numpy)

Nobody can check a hundred loops by ear every time, so this listens with numbers. For each loop
that has an "rpm" in clips.json it measures:
  repeat   the sound's true repeat: the shortest period it clearly repeats at. An engine repeats
           every bang (the firing frequency at the labelled rpm = rpm / 60 x firings per turn), or
           every half turn, every turn ... up to every whole engine cycle. So the firing frequency
           divided by the repeat must be a whole number that divides the bangs per cycle (V8: 1, 2,
           4 or 8). Anything else means the label is wrong - or that something other than the engine
           (a supercharger's whine, a turbo) is the loudest thing in the recording.
  clear    how well it repeats (0..1). Under 0.3 it is mostly noise.
  drift    that repeat in the first half against the second half. A loop must hold one speed (2 %).
  length   a loop shorter than 1 s is heard repeating.
  wobble   how much the loudness goes up and down inside the loop.
  lines    the three strongest tones, as multiples of the firing frequency, strongest first. Above
           idle the engine's own low notes should lead: a strongest tone over 3.2x is a whine.
Run it after tools/build-audio.py. A line ending in capitals is a loop to cut again.
"""
import json, wave, sys
import numpy as np

# firings per turn of the crank, by the first part of the clip's name (cylinders / 2; rotors for a rotary)
FIRINGS = {'engine': 2, 'race': 2, 'i4race': 2, 'i6': 3, 'f4': 2, 'f6': 3, 'v6': 3, 'v8': 4, 'v8t': 4, 'v10': 5, 'v10f1': 5, 'v12': 6, 'rotary': 2, 'rotarybp': 2}
# The first engine's loops were tuned by ear with the game running: leave them alone, do not "fix" them.
BY_EAR = ['engine_idle', 'engine_low', 'engine_mid', 'engine_high', 'race_low']

def load(name):
    with wave.open('public/audio/' + name) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
        if w.getnchannels() > 1: x = x.reshape(-1, w.getnchannels()).mean(1)
        return x, w.getframerate()

def repeat(x, rate, low, high):
    """The shortest period between low and high Hz that repeats about as well as the best one.
    Returns (its frequency, how clearly it repeats 0..1)."""
    x = x - x.mean()
    spectrum = np.fft.rfft(x * np.hanning(len(x)), 1 << int(np.ceil(np.log2(2 * len(x)))))
    strength = np.fft.irfft(abs(spectrum) ** 2)                 # how well the sound matches itself, shifted by k samples
    a, b = int(rate / high), int(rate / low)
    k = a + int(np.argmax(strength[a:b] >= 0.95 * strength[a:b].max()))
    while strength[k + 1] > strength[k]: k += 1                 # climb to the top of that peak
    before, top, after = strength[k - 1:k + 2]
    k += 0.5 * (before - after) / (before - 2 * top + after)    # the peak usually sits between two samples
    return rate / k, top / strength[0]

def lines(x, rate, count=3):
    """The strongest tones below 4000 Hz, strongest first."""
    spectrum = np.abs(np.fft.rfft(x * np.hanning(len(x)), 1 << 18)); tones = np.fft.rfftfreq(1 << 18, 1 / rate)
    spectrum[(tones < 15) | (tones > 4000)] = 0
    found = []
    for _ in range(count):
        hz = tones[np.argmax(spectrum)]; found.append(hz)
        spectrum[np.abs(tones - hz) < max(6, hz * 0.04)] = 0
    return found

bad = 0
clips = json.load(open('public/audio/clips.json'))
for name, clip in clips.items():
    voice = name.rsplit('_', 1)[0]
    if 'rpm' not in clip or voice not in FIRINGS or name in BY_EAR: continue
    x, rate = load(clip['file'])
    per_cycle = 2 * FIRINGS[voice]                               # bangs in one whole engine cycle (two turns)
    want = clip['rpm'] / 60 * FIRINGS[voice]
    found, clear = repeat(x, rate, want / per_cycle * 0.9, want * 2.2)
    first, _ = repeat(x[:len(x) // 2], rate, found * 0.94, found * 1.06)
    second, _ = repeat(x[len(x) // 2:], rate, found * 0.94, found * 1.06)
    block = int(rate * 0.05)
    loud = np.array([np.sqrt((x[i:i + block] ** 2).mean()) for i in range(0, len(x) - block, block)])
    wobble = loud.std() / loud.mean()
    tones = [hz / want for hz in lines(x, rate)]
    every = want / found                                         # the sound repeats once every so many bangs
    flags = []
    if abs(every / round(max(every, 1)) - 1) > 0.05 or per_cycle % round(max(every, 1)): flags.append('PITCH (label or something else is louder than the engine)')
    if clear < 0.3: flags.append('UNCLEAR')
    if abs(second / first - 1) > 0.02: flags.append('DRIFT')
    if len(x) / rate < 1.0: flags.append('SHORT')
    if wobble > 0.25: flags.append('WOBBLE')
    if tones[0] > 3.2 and clip['rpm'] > 2000: flags.append('WHINE')
    bad += bool(flags)
    print(f"{name:13s} {len(x) / rate:4.2f} s  label {clip['rpm']:5d} rpm = {want:6.1f} Hz  repeats at {found:6.1f} Hz (every {every:5.2f} bangs, clear {clear:.2f})"
          f"  drift {(second / first - 1) * 100:+5.1f} %  wobble {wobble:.2f}  lines " + ' '.join(f'x{t:.2f}' for t in tones) + '  ' + ' '.join(flags))
print(f"\n{bad} loop(s) to look at." if bad else "\nEvery loop holds its pitch and matches its label.")
sys.exit(1 if bad else 0)
