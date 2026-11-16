#!/usr/bin/env python3
"""unpack-fmod-bank.py — takes the recordings out of an FMOD ".bank" file (the sound format of
Assetto Corsa cars) and writes them as .wav files, so tools/build-audio.py can cut loops from them.

    python3 tools/unpack-fmod-bank.py  <file.bank>  <output folder>  <prefix for the file names>

A .bank holds one or more "FSB5" blocks, each a list of sounds. Only blocks stored as plain,
uncompressed sound (mode 2) are written; compressed ones (Vorbis, mode 15) are listed and skipped.
What was unpacked for the game, and from where: reference/audio/acfan-f1-v10/acfan-f1-v10.md
"""
import sys, struct, wave, os

RATES = {1: 8000, 2: 11000, 3: 11025, 4: 16000, 5: 22050, 6: 24000, 7: 32000, 8: 44100, 9: 48000}
bank_path, out_dir, prefix = sys.argv[1:4]
bank = open(bank_path, 'rb').read()
os.makedirs(out_dir, exist_ok=True)

at = bank.find(b'FSB5')
while at >= 0:
    version, count, headers_size, names_size, data_size, mode = struct.unpack_from('<IIIIII', bank, at + 4)
    p = at + (60 if version == 1 else 64)                       # the first sound's header
    sounds = []
    for _ in range(count):
        # One 64-bit number per sound: more-info flag, rate, channels, where its data starts, how many samples.
        packed, = struct.unpack_from('<Q', bank, p); p += 8
        more, rate, channels = packed & 1, RATES.get((packed >> 1) & 0xF), ((packed >> 5) & 1) + 1
        offset, samples = ((packed >> 6) & 0xFFFFFFF) * 16, (packed >> 34) & 0x3FFFFFFF
        while more:                                             # optional extras; only an exact rate or channel count matters here
            extra, = struct.unpack_from('<I', bank, p); p += 4
            more, size, kind = extra & 1, (extra >> 1) & 0xFFFFFF, (extra >> 25) & 0x7F
            if kind == 1: channels = bank[p]
            if kind == 2: rate, = struct.unpack_from('<I', bank, p)
            p += size
        sounds.append((rate, channels, offset, samples))
    names_at = at + (60 if version == 1 else 64) + headers_size
    data_at = names_at + names_size
    for k, (rate, channels, offset, samples) in enumerate(sounds):
        name_at = names_at + struct.unpack_from('<I', bank, names_at + 4 * k)[0]
        name = bank[name_at:bank.index(b'\0', name_at)].decode('latin1')
        file_name = prefix + ''.join(c if c.isalnum() or c in '-_.' else '_' for c in name) + '.wav'
        print(f"{'written' if mode == 2 else 'SKIPPED (compressed)':20s} {file_name:50s} {samples / rate:6.2f} s  {channels} ch")
        if mode != 2: continue
        with wave.open(os.path.join(out_dir, file_name), 'wb') as w:
            w.setnchannels(channels); w.setsampwidth(2); w.setframerate(rate)
            w.writeframes(bank[data_at + offset:data_at + offset + samples * channels * 2])
    at = bank.find(b'FSB5', at + 4)
