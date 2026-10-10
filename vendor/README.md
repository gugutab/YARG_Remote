# vendor

`soundtouch.js` is SoundTouchJS 0.1.30 (`dist/soundtouch.js`), copied unchanged so the app needs no build step.
It provides `PitchShifter`, which changes playback speed without changing pitch.

License: LGPL-2.1, see `SOUNDTOUCH-LICENSE.txt`. Source: https://github.com/cutterbl/SoundTouchJS

## Instrument icons (YARG)

The guitar, bass, rhythm, keys, drums, vocals and harmony icons in the SVG sprite of `index.html` are the silhouettes of the
icons in the YARG game, traced from `Assets/Art/Menu/Common/InstrumentIcons.png` with `scripts/build-yarg-icons.py` (the
badge ring is dropped; the shape is tinted with `currentColor`). Source: https://github.com/YARC-Official/YARG, licensed
LGPL-3.0 (the repository has no separate license for its art). To rebuild them, download the sheets from the repository
(Git LFS: `https://media.githubusercontent.com/media/YARC-Official/YARG/master/Assets/Art/Menu/Common/InstrumentIcons.png`)
and run `python scripts/build-yarg-icons.py InstrumentIcons.png HarmonyVocalsIcons.png`.
