#!/usr/bin/env python3
"""build-audio.py — cuts the game's sound clips out of the recordings in reference/audio/.

    python3 tools/build-audio.py          (needs ffmpeg and numpy)

It writes small .wav files plus public/audio/clips.json, which audio.js reads.
  * loops     a steady stretch, with its end cross-faded into its start so it repeats seamlessly
  * one-shots a window around the loudest moment (a pass-by "whoosh" peaks when the car is closest)
Change the CLIPS table below to pick different stretches, then run it again.
Source recordings are from Freesound: CC0, except the car impacts (CC BY-NC 4.0, nsstudios) -
see reference/audio/README.md. The per-layout engine voices (i6_*, v8_*, rotary_* ...) come from the third
batch in reference/speedx/audio/audio/ - sources and licences are listed in reference/speedx/audio/README.md.
The V10 (v10f1_*) is cut from two Assetto Corsa sound mods by SHR Modding (ACFAN): see
reference/audio/acfan-f1-v10/acfan-f1-v10.md. THEIR SOUNDS NEED SHR MODDING'S WRITTEN CONSENT BEFORE THE GAME
IS PUBLISHED - do not put those clips online before the owner has it.
After changing an engine loop, run tools/check-audio.py: it measures every loop against its rpm label.
"""
import json, subprocess, wave, os
import numpy as np

SRC = 'reference/audio/'
OUT = 'public/audio/'

def load(name, rate, channels=1):
    # names starting with '1113550/' come from the second batch of recordings, in reference/1113550/
    # names starting with 'speedx/' come from the third batch, in reference/speedx/audio/audio/
    path = 'reference/' + name if name.startswith('1113550/') else SRC + name
    if name.startswith('speedx/'): path = 'reference/speedx/audio/audio/' + name[len('speedx/'):]
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', str(channels), '-ar', str(rate), '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32).reshape(-1, channels) / 32768

ENGINE_RMS = 0.3     # target average level of every engine loop

def save(name, data, rate, peak=0.9):
    if peak is not None: data = data / (np.abs(data).max() + 1e-9) * peak
    with wave.open(OUT + name, 'wb') as w:
        w.setnchannels(data.shape[1]); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((data * 32767).astype(np.int16).tobytes())

def follow(piece, rate, hz_from, hz_to):
    """Measure the engine note along a piece. hz_from and hz_to are only a rough guide (the note at the start
    and at the end): every 0.03 s this picks the strongest tone within 6 % of the straight line between them."""
    step, size, tones = int(0.03 * rate), int(0.12 * rate), np.fft.rfftfreq(1 << 16, 1 / rate)
    guide = np.linspace(hz_from, hz_to, len(piece))
    at, hz = [], []
    for i in range(0, len(piece) - size, step):
        spectrum = np.abs(np.fft.rfft(piece[i:i + size, 0] * np.hanning(size), 1 << 16))
        near = np.abs(tones / guide[i + size // 2] - 1) < 0.06
        at.append(i + size // 2); hz.append(tones[near][np.argmax(spectrum[near])])
    hz = np.convolve(np.pad(hz, 2, mode='edge'), np.ones(5) / 5, mode='valid')      # smooth out the jitter
    return np.interp(np.arange(len(piece)), at, hz)

def hold_pitch(piece, rate, hz_from, hz_to):
    """A stretch where the revs climb, fall or wander: the engine note goes from about hz_from to about hz_to.
    Squeeze and stretch it, sample by sample, so the note holds still at its average pitch - otherwise the
    loop would jump in pitch every time it repeats. Returns (the audio, the pitch it now holds, in Hz)."""
    hz = follow(piece, rate, hz_from, hz_to)                         # the note along the piece, measured
    pulses = np.cumsum(hz) / rate                                    # engine pulses gone by at each sample
    even = np.arange(0, pulses[-1], hz.mean() / rate)                # the same pulses, spread out evenly
    return np.stack([np.interp(even, pulses, piece[:, c]) for c in range(piece.shape[1])], axis=1), hz.mean()

def level(audio, rate, window=0.3):
    """Even out the loudness along a piece (a car pulling away fades; a rev swells), so a loop does not throb."""
    n = int(window * rate)
    loud = np.sqrt(np.convolve(np.pad((audio ** 2).mean(axis=1), n, mode='reflect'), np.ones(n) / n, mode='same')[n:-n])
    return audio / (loud[:, None] + 1e-6)

def loop(name, start, length, rate, channels=1, fade=0.25, sweep=None, hums=(), key='', hiss=None):
    """Cut [start, start+length] and blend the audio that follows into the beginning.
    sweep = (Hz at the start, Hz at the end) when the revs change over the stretch: see hold_pitch().
    hums  = [(Hz, width)] steady tones that are not the engine, taken out first: see without_tone().
    hiss  = (Hz, how much to keep) to turn down everything above that pitch: see quieter_above()."""
    x = load(name, rate, channels)
    a, n, f = int(start * rate), int(length * rate), int(fade * rate)
    x = x[a:a + n + f + 200].copy()                                     # the stretch, plus what the cross-fade needs
    for hz, width in hums: x = without_tone(x, rate, hz, width)
    if hiss: x = quieter_above(x, rate, *hiss)
    if sweep:
        x, held = hold_pitch(x, rate, *sweep)
        x = level(x, rate)
        print(f'{key}: note held at {held:.1f} Hz')                     # its rpm label must match this (see the table)
    out = x[:n].copy()
    t = np.linspace(0, np.pi / 2, f)[:, None]
    out[:f] = out[:f] * np.sin(t) + x[n:n + f] * np.cos(t)              # equal-power cross-fade
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

def save_engine_loop(key, audio, rpm):
    # Every engine loop is brought to the SAME average loudness, so the engine does not seem to
    # fade as it revs out. tanh keeps the peaks in check.
    audio = np.tanh(audio / (np.sqrt((audio ** 2).mean()) + 1e-9) * ENGINE_RMS)
    save(key + '.wav', audio, 32000, peak=None)
    clips[key] = {'file': key + '.wav', 'rpm': rpm}

def without_tone(audio, rate, hz, width=2.0):
    """Remove one steady tone that is not the engine (a fan humming near the microphone): everything within
    `width` Hz of `hz`. (0, 100) removes everything below 100 Hz - the boom inside a car's cabin."""
    spectrum = np.fft.rfft(audio[:, 0])
    spectrum[np.abs(np.fft.rfftfreq(len(audio), 1 / rate) - hz) < width] = 0
    return np.fft.irfft(spectrum, len(audio))[:, None]

def quieter_above(audio, rate, hz, keep):
    """Turn everything above `hz` down to `keep` (0..1) of its level: the hiss of air being sucked in and a
    turbo's whistle, where the microphone caught more of them than of the engine. The change is spread over
    the half octave below `hz`, so nothing is cut off sharply."""
    spectrum = np.fft.rfft(audio[:, 0])
    tones = np.fft.rfftfreq(len(audio), 1 / rate)
    spectrum *= np.interp(np.log2(np.maximum(tones, 1) / hz), [-0.5, 0], [1, keep])
    return np.fft.irfft(spectrum, len(audio))[:, None]

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
    save_engine_loop(key, loop(name, start, length, 32000, 1, fade), rpm)

# ---- Engine voices: one set of loops per engine layout (third batch) -----------------------
# Named <voice>_<slot>; the slot (idle / low / mid / high) is the one whose revs are nearest. Not every
# voice has all four. "rpm" was MEASURED from the firing frequency of that stretch:
#     four-stroke: rpm = Hz x 120 / cylinders   (I4 x30, I6/V6/F6 x20, V8 x15, V10 x12, V12 x10)
#     rotary:      rpm = Hz x 30                (two rotors, one bang per rotor per turn)
# The last column is None for a steady stretch, or (Hz at the start, Hz at the end) for a stretch where
# the revs were climbing, falling or wandering - loop() then holds the note still, evens out the loudness
# and prints the pitch it held (which is where that row's rpm comes from). Two equal numbers = "nearly
# steady, just iron it out". A held sweep never sounds as true as a steady stretch: use one only when the
# recording has nothing steady, keep it 1 s or longer, and run tools/check-audio.py afterwards.
X = 'speedx/'
F40 = '1113550/05-f40-turbo-wastegate.mp3'
GT86, R8 = X + 'supercharger-gt86-vortech-dyno.mp3', X + 'engine-v10-audi-r8-onboard-drive.mp3'
SUPRA, RX7 = X + 'engine-i6-supra-turbo-dyno.mp3', X + 'engine-rotary-rx7-fc-ext-idle-steadies.mp3'
E190, WRX = X + 'engine-i4-190e16v-dyno-accel.mp3', X + 'engine-f4-wrx-idle-revs.mp3'
MASERATI, GIULIA = X + 'engine-v8-maserati-granturismo.mp3', X + 'engine-v6-alfa-giulia-qv-ext-away-by.mp3'
# Formula 1 V10s, unpacked from two Assetto Corsa sound mods with tools/unpack-fmod-bank.py (consent needed: see the top)
F2004, R25 = 'acfan-f1-v10/wav/f2004_f2000_ext_', 'acfan-f1-v10/wav/r25_r25_ext_'
# Steady tones that are not the engine, taken out of a clip before it is looped: (Hz, width in Hz).
HUMS = {'v8t_idle': [(85.4, 2)], 'v8_idle': [(85.4, 2), (170.8, 2), (256.2, 2)], 'v8_low': [(85.4, 2), (170.8, 2), (256.2, 2)],   # a fan beside the Maserati
        'v6_mid': [(62.2, 2)],                                           # a hum somewhere at the test track
        'rotary_low': [(0, 100)]}                                        # the boom inside the RX-8's cabin
# Induction noise that drowned the engine, turned down: (above this many Hz, keep this much of its level).
# The Supra's dyno microphone sat by the intake: at the top of the pull a turbo whistle near 10 kHz
# carried a quarter of the whole sound. These bring both loops down to what the other engines have up there.
HISS = {'i6_mid': (4000, 0.5), 'i6_high': (6000, 0.3)}
for key, name, start, length, rpm, fade, sweep in [
        # i4race - Mercedes 190E 2.3-16 (Chippy569, CC0): a raspy twin-cam four on a dyno. The run is one
        #          4-second pull with nothing steady in it: mid and high are held sweeps (25-40 % wide).
        ('i4race_idle', X + 'engine-i4-190e16v-start-revs.mp3', 4.9, 1.6, 1240, 0.3, (43.1, 39.6)),   # fast idle just after starting
        ('i4race_mid', E190, 2.6, 1.0, 5595, 0.12, (157, 219)),               # revving up quickly
        ('i4race_high', E190, 3.1, 1.0, 6460, 0.12, (190, 238)),              # the top of the same run
        # i6 - BMW M4 idle (Andreabarata, CC0) + turbo Supra on a dyno (editboy23, CC0)
        ('i6_idle', X + 'engine-i6-bmw-m4-start-revs.mp3', 149.0, 2.5, 830, 0.3, None),   # repeats at 20.7 Hz = each bank of three
        ('i6_low', SUPRA, 12.0, 1.3, 3290, 0.2, (161.2, 167.3)),              # start of the pull, under load
        ('i6_mid', SUPRA, 20.8, 1.2, 4710, 0.2, (215.3, 255.9)),
        ('i6_high', SUPRA, 23.2, 1.0, 6980, 0.2, (315.4, 382.1)),             # near the top of the pull
        # f4 - Subaru WRX (ulose2piranha, CC0): the uneven boxer rumble; mid/high are a supercharged
        #      GT-86 on a dyno (dezoris, CC BY 4.0 - credit required), also a flat-four but smoother
        ('f4_idle', WRX, 1.0, 2.4, 720, 0.4, None),
        ('f4_low', WRX, 23.0, 1.3, 3520, 0.2, (117, 117)),                    # revs held for two seconds (they wander 3 %)
        ('f4_mid', GT86, 28.0, 1.3, 4880, 0.2, (152.2, 173.4)),
        ('f4_high', GT86, 32.9, 1.3, 7000, 0.2, (222.0, 244.9)),
        # f6 - Porsche 911 driving past in the street (mharo, CC0): no idle, and it never revs high
        ('f6_low', X + 'engine-f6-porsche-911-street.mp3', 2.95, 1.0, 2410, 0.15, (119, 126)),     # as it passes the microphone
        ('f6_mid', X + 'engine-f6-porsche-911-street.mp3', 5.7, 1.0, 3270, 0.2, (148.3, 179.0)),   # pulling away
        # v6 - Alfa Romeo Giulia Quadrifoglio twin-turbo V6 (Sonniss GDC 2020). Idle: microphone in the engine
        #      bay. The rest: from outside, the car driving away and past at steady speed - each bank of three
        #      has its own exhaust, so the sound repeats at HALF the firing frequency.
        ('v6_idle', X + 'engine-v6-alfa-giulia-qv-onboard.mp3', 9.0, 2.2, 970, 0.3, None),
        ('v6_low', GIULIA, 28.7, 2.0, 3350, 0.3, (167.5, 167.5)),             # driving away at a steady speed (it fades: levelled)
        ('v6_mid', GIULIA, 245.0, 1.8, 3825, 0.3, (189, 192)),                # after a steady pass
        ('v6_high', GIULIA, 195.0, 1.0, 5795, 0.2, (289, 284)),               # just after a fast pass, revs falling 3 %
        # v8 - a cross-plane V8 with NO supercharger whine: Maserati GranTurismo 4.7 (myeclecticself, CC0)
        #      idling with the exhaust flaps open and pulling away; the top end is a hot-rod V8 held flat out in
        #      a burnout (Ears68, CC0). The burnout's rpm is worked out, not known: the sound repeats at 52.9 Hz,
        #      taken as one whole engine cycle (two turns) = 6350 rpm; were it one turn, the label would be 3175.
        ('v8_idle', MASERATI, 5.2, 2.2, 845, 0.3, None),
        ('v8_low', MASERATI, 10.9, 1.1, 3065, 0.2, (203, 208)),               # pulling away, 30 m off (a quiet stretch)
        ('v8_mid', X + 'engine-v8-supercharged-start-idle-burnout.mp3', 39.3, 2.0, 6350, 0.3, None),
        # v8t - exotic V8: Maserati GranTurismo idle (flaps shut) + Ferrari F40 twin-turbo (second batch)
        ('v8t_idle', MASERATI, 1.0, 2.0, 845, 0.3, None),
        ('v8t_mid', F40, 10.0, 1.45, 5890, 0.25, (374.1, 411.1)),
        ('v8t_high', F40, 7.6, 1.1, 7040, 0.2, (447, 490)),
        # v10 - Lamborghini Huracan idle (Sonniss GDC 2019) + Audi R8 driving, engine microphone (Sonniss GDC
        #       2020). The R8 is driven gently: it never goes above 4100 rpm, so there is no high loop.
        ('v10_idle', X + 'engine-v10-huracan-ext-idle-blips.mp3', 18.0, 2.2, 805, 0.3, None),
        ('v10_low', R8, 51.3, 1.7, 3280, 0.3, None),                          # cruising at a steady speed
        ('v10_mid', R8, 45.2, 1.1, 3870, 0.2, (322, 318)),                    # a short hold, revs wandering 3 %
        # v10f1 - Formula 1 V10s (SHR Modding: Ferrari F2004 and Renault R25 sound mods), heard from outside. These
        #         are loops made for a game already, each at one engine speed. The loudest tone of an F1 V10 is
        #         HALF its firing frequency (each bank of five has its own exhaust), so rpm = that tone x 24.
        #         An F1 engine idles near 3700 rpm and revs to 19,000: audio.js fits that range onto ours.
        ('v10f1_idle', F2004 + 'idle.wav', 0.1, 2.2, 3740, 0.3, None),
        ('v10f1_low', F2004 + 'on_mid_rear.wav', 0.3, 3.0, 7650, 0.3, (320, 320)),            # from behind, revs wandering 2 %
        ('v10f1_mid', R25 + 'on_high_rear_close_1.wav', 0.5, 3.0, 12210, 0.3, (509, 509)),    # from behind, close (its loudness swells: levelled)
        ('v10f1_high', F2004 + 'on_high_front_close_3.wav', 0.1, 1.7, 19010, 0.3, (793, 793)),   # flat out, from the front
        # v12 - Ferrari 812 Superfast (Sonniss GDC 2020). Idle: engine microphone (that take only has idle and
        #       0.3 s blips). Low: from outside, accelerating gently past the microphone - it short-shifts
        #       below 3300 rpm, so there is nothing higher.
        ('v12_idle', X + 'engine-v12-ferrari-812-onboard.mp3', 10.0, 2.2, 965, 0.3, None),
        ('v12_low', X + 'engine-v12-ferrari-812-ext-by.mp3', 17.6, 1.2, 2770, 0.2, (267, 292)),
        # rotary - smooth: Mazda RX-8 RENESIS held at steady revs (Soundholder, Sonniss GDC 2020) - low is recorded
        #          inside the cabin (muffled, close to a pure hum), mid is the on-board loop - and, for the top end,
        #          the RX-7 FC below, whose porting no longer "braps" at 6700 rpm.
        ('rotary_low', X + 'engine-rotary-rx8-cabin-4k-loop.mp3', 0.3, 2.2, 4290, 0.4, None),
        ('rotary_mid', X + 'engine-rotary-rx8-onboard-5k-loop.mp3', 2.0, 3.0, 5010, 0.4, None),
        ('rotary_high', RX7, 73.5, 2.5, 6710, 0.3, None),
        # rotarybp - Mazda RX-7 FC, bridge-ported 13B turbo, held at steady revs (Sonniss GDC 2019): the lumpy
        #            "brap-brap" of a race port. rotary_idle is the same idle under its old name.
        ('rotary_idle', RX7, 4.0, 2.4, 2420, 0.4, None),
        ('rotarybp_idle', RX7, 4.0, 2.4, 2420, 0.4, None),                    # the "brap-brap" idle (it idles high)
        ('rotarybp_low', RX7, 43.0, 1.8, 3320, 0.3, None),
        ('rotarybp_mid', RX7, 56.0, 1.8, 5500, 0.3, None),
        ('rotarybp_high', RX7, 74.5, 1.8, 6720, 0.3, None)]:
    save_engine_loop(key, loop(name, start, length, 32000, 1, fade, sweep, HUMS.get(key, ()), key, HISS.get(key)), rpm)
# Turbo spooling up, then the blow-off valve letting go (EwanPenman11, CC0). A quiet recording.
save('blowoff3.wav', cut(X + 'turbo-spool-blowoff.mp3', 0.6, 1.7, 44100, 1, 0.05), 44100)
clips['blowoff3'] = {'file': 'blowoff3.wav'}

# ---- Forced induction and backfire (second batch) -----------------------------------------
# Exhaust pops: the sharp bangs after each rev in the Audi R8 recording.
for i, (start, end) in enumerate([(1.05, 1.32), (2.99, 3.26), (4.69, 5.0), (6.82, 7.02), (10.24, 10.44)]):
    save(f'pop{i + 1}.wav', cut('1113550/06-audi-r8-revs-and-pops.mp3', start, end, 44100), 44100)
    clips[f'pop{i + 1}'] = {'file': f'pop{i + 1}.wav'}
# Exhaust crackles: single bangs from racing cars lifting off at the Nordschleife (Dominik_W, CC0). Recorded at
# the trackside, so each has a little of the passing car's engine under it (the bang is 10-15 dB louder).
for i, (start, end) in enumerate([(8.35, 8.6), (93.545, 93.8), (77.81, 78.08), (73.0, 73.25)]):
    save(f'crackle{i + 1}.wav', cut(X + 'exhaust-crackle-nordschleife-trackside.mp3', start, end, 44100), 44100)
    clips[f'crackle{i + 1}'] = {'file': f'crackle{i + 1}.wav'}
# Turbo letting go: the wastegate / blow-off moments of the Ferrari F40 recording.
for i, (start, end) in enumerate([(3.62, 4.5), (8.72, 9.4)]):
    save(f'blowoff{i + 1}.wav', cut('1113550/05-f40-turbo-wastegate.mp3', start, end, 44100, 1, 0.05), 44100)
    clips[f'blowoff{i + 1}'] = {'file': f'blowoff{i + 1}.wav'}
# Supercharger whine: the Hellcat's blower (pitch follows rpm in game). The recording is only rev-ups, so the
# whine climbs all the way through it (959 -> 1133 Hz here): its pitch is held still and its loudness evened
# out, or the loop would be heard starting over twice a second. The V8 underneath (everything below 500 Hz)
# is taken out, so that a four with a supercharger does not rumble like an eight.
# rpm: the whine is held at 1037 Hz; 5260 keeps the pitch the game had before (the car's true revs are not known).
whine = loop('1113550/04-hellcat-supercharger.mp3', 5.3, 1.4, 32000, 1, 0.25, (959, 1133), [(0, 500)], 'supercharger')
save('supercharger.wav', whine / np.sqrt((whine ** 2).mean()) * 0.3, 32000, peak=None)
clips['supercharger'] = {'file': 'supercharger.wav', 'rpm': 5260}

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
