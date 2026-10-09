# Review: how YARG renders × what we do

Source: YARG code (`github.com/YARC-Official/YARG`, branch `master`, folders `Assets/Script/Gameplay/Visuals` and
`Player`) and YARG.Core (`Game/Presets`). The reading was done by subagents that summarize the pages, so the values
below come from extraction and **must be checked before becoming requirements**. What did not appear in the files read is
marked **not confirmed**. The wiki (`wiki.yarg.in`) has no note numbers or render details.

## 1. What YARG does (confirmed in the files read)

**Highway (guitar/bass/keys)**
- Track with width 2, strike line at z = −2, notes spawn at z ≈ 5 (about 7 track units ahead). 5-position lanes:
  x = −0.8; −0.4; 0; 0.4; 0.8 (`TrackPlayer`, `TrackElement`).
- Default camera (YARG.Core `CameraPreset`): FOV 55, Y 2.66, Z 1.14 (−6 on the camera), rotation 24.12°, fade 1.25.
  Other presets: Circular, High FOV, Hero 2 (FOV 58, rot 12°), "Kinda Orthogonal" (high camera, fade 0).
- Default colors (`ColorProfile.Defaults`): green `#79D304`, red `#FF1D23`, yellow `#FFE900`, blue `#00BFFF`,
  orange `#FF8400`, purple (open) `#C800FF`; star power notes `#FFFFFF`; miss `#909090`.
- Guitar note types: strum, HOPO, tap, open, open HOPO, wildcard; each has its own model, and there is a star power
  model. Notes inside a star power phrase use the star power color.
- Sustain: width 0.1 (5% of the track, ~25% of a lane); when held it shrinks toward the strike line and glows
  (emission ×3); when missed it turns gray.
- Measure/beat lines on three levels: measure (height 0.07, alpha 0.6), strong beat (0.05, 0.4) and weak
  beat (0.03, 0.3).
- Track effects: solo, unison (star power), drum fill, BRE, and combinations.
- Frets (strike line buttons): 0.25 s fade, inactive color gray.

**Drums**
- Separate note types: normal, cymbal, kick, accent, ghost, cymbal accent, cymbal ghost, wildcard, dedicated-lane
  kick. Accent and ghost are **their own model groups**, not just a color change.
- Kick centered when there is no dedicated lane; double kick with its own color (`DOUBLE_KICK_FRET_INDEX`).
- Fills: the fill is associated with the activator chord (star power note) right after it; fills without an activator are removed.
  The activator note pulses when activation is possible.
- BRE/coda: lanes glow and fade from the last beat.

**Vocals**
- Pitch range adjusted to what is coming up: at least 20 semitones, 10% margin, smooth transition (min. 0.25 s).
- Lyric colors (static phrase): past `#595959`, present `#13F0A6`, future white; with star power, future
  `#FFEB04` and past `#757519`.
- Harmony: up to 3 lyric lanes; each part has its own color and a slight depth offset; unpitched (talkie) notes are
  semi-transparent (alpha 0.2); percussion is an object that spins when it appears.

## 2. Already applied in this round

| Change | Where |
|---|---|
| Guitar and open palette equal to YARG | `src/gfx.js`, `src/chart.js` |
| Notes inside star power in white, with an outline in the lane color (2D and 3D) | `markStarPowerNotes` in `src/highway.js` |
| Vocal pitch range adjusted to upcoming notes (min. 20 semitones, 10% margin, smoothed) | `vocalRange` |
| Lyrics: past gray, present aqua green, future white | `renderVocals` |
| `devicePixelRatio` capped at 2 (phones report 3+) | `Highway.resize` |

## 3. Suggestions (by estimated value)

**Visual fidelity**
1. **Beat lines on three levels**: today there are only measure and beat lines, with low alpha. Add the weak line
   (half beat) and raise the alphas to 0.6/0.4/0.3.
2. **Drum fills (notes 120–124)** and the activator note: today they are not drawn. Show the fill band and highlight
   the activator note. It is the biggest missing visual item for drums. The exact 120–124 mapping was not confirmed.
3. **Accent and ghost**: YARG uses distinct models; we use a thick outline and transparency. Evaluate a stronger
   highlight (e.g. a double ring for accent).
4. **Unpitched vocals (talkie)**: lyrics ending in `#`/`^` should have a semi-transparent bar (alpha 0.2).
5. **Star power in vocals**: star power phrases (note 116) turn the lyric yellow.
6. **Pitch range from the MIDI**: YARG uses the range-shift events; our version only adjusts to the notes
   coming up. Reading the events reduces framing jumps.
7. **Harmony lyrics in up to 3 lines** (one per part) instead of just one.
8. **BRE/coda**: glowing lanes; coda marker on the timeline.

**3D**
9. The ratio between the track size at the back and at the strike line, computed from the default camera (FOV 55, rotation
   24°), gives about **0.37**; we use 0.30. Worth testing `FAR_SCALE = 0.37` and comparing. Our calculation, not a value from the code.
10. Duration of the button glow on a hit: YARG uses 0.25 s; we use 0.14 s.
11. Held sustain with glow (emission ×3) and inactive fret in gray.

**Performance on phones**
12. Draw the static track background (lanes, dividers) once on an offscreen canvas and only copy it every frame.
13. Avoid creating the fade gradient every frame; cache it per height.
14. Cap the frame rate (30 fps) on slow devices or with low battery.
15. YARG uses an object pool and does the track bars in a shader; our drawing is immediate and already runs at over 100
    fps headless, but testing on a real device is pending.

**Data / correctness**
16. The vocal pitch range goes up to note 84; the wiki defines C2–B5, i.e. 36–83. Check whether note 84 should be
    ignored.
17. Drum and harmony colors: the `ColorProfile` values were not read; our drum colors follow the
    Rock Band convention, unconfirmed by YARG.

## 4. Not confirmed

Default value of `NoteSpeed`; fade curve and direction (shader); strike line appearance; note meshes; order and
colors of the drum pads; 120–124 mapping to fills; roll visuals (125–127); solo box; kick bar
geometry; harmony colors. To close these gaps, the way is to open YARG's prefabs and shader in Unity or
compare with game screenshots.
