# CLAUDE.md — guide for whoever takes over the project

This file is the handoff. Read it all before touching the code. `README.md` is the user-facing overview; this holds what you need to continue without asking everything again.

## 1. What it is

Web visualizer (HTML + ES modules, no build) for songs in the Rock Band / YARG format:
- the user points to a songs folder (`A:\music\Songs\`, or any folder), the app lists the songs;
- on picking a song, they choose instrument and difficulty, and the app plays the audio stems with a synchronized
  highway (notes, sustains, solos, star power, rolls, HOPO, open, drums, vocals with lyrics);
- controls: play/pause, seek, sections, per-stem volume, speed (0.2×–2×) without changing pitch, neck speed
  (spacing only), chart delay (−1 s to +1 s), audio delay coming from `song.ini`.
- There is no hit/miss detection. It is visualization only.

Language: the app UI, code, comments, commit messages and docs are all in English. The user may still chat in
Portuguese, so chat replies stay in Portuguese.

## 2. Current state

- UI redesigned on branch `claude/ui-redesign` (derived from the one below): full-screen chart, top bar with icons, collapsible library on the left (search, instrument/genre filter, sorting in `src/songlist.js`), settings and mixer in popovers. Song info screen (opens when a song is chosen, with loading already in progress; Play stays disabled until `ready`; the I key or the ⓘ button reopens it): cards per instrument (song.ini level, own difficulty buttons and chart counts; `renderPickers`), Settings and mixer (state shared with the top bar popovers via `settings`/`stemStates`). Top bar with 2 fixed rows (92 px): cover art across both rows, seekbar as divider, section as chip + list (`#sectionBtn`/`#sectionPop`; the `<select id="sectionSelect">` stays hidden as state). Instrument and difficulty are a single chip (`#partBtn`) that opens a compact list; the `<select id="instrument|difficulty">` stay hidden as the source of truth. Selectors use the `.chip-select`/`.chip-btn` style. Shortcuts: Space, I, L, F, [ ], arrows. The user's real test folder: `A:\music\Songs` (e.g. Guitar Hero\Quickplay, 'Smoke On The Water' at 0:40; 'More Than A Feeling' at 1:00). The share 192.16.0.202 did not respond (port 445).
- Previous working branch: `claude/upbeat-knuth-87adga` (remote `origin` = `gugutab/YARG_Remote`). Do not create a PR without an
  explicit request. The remote also has `main`, which is not used.
- 54 unit tests passing (`npm test`).
- Works in Chromium (File System Access API). In other browsers, `<input webkitdirectory>` is the
  fallback, without persistence.

Supported: guitar, bass, rhythm, keys (5 lanes); drums in 4 lanes, Pro (with cymbal markers),
5 lanes; solo vocals (`PART VOCALS`) and Harmony (its own instrument: HARM1 leads, HARM2/3 behind; lyrics and percussion fall back to `PART VOCALS`), no difficulty for vocals; lyrics, percussion; open (PhaseShift SysEx); tap; forced HOPO and strum;
accent and ghost; double kick; rolls (tremolo, trill, kick roll); solos and star power (background bands; the notes inside star power are coloured too); enhanced opens; drum fills and BRE (background band); beat grid generated from tempo + time signatures when there is no BEAT track; sections
(EVENTS); audio and chart delay; speed and neck; persistence of the folder and the list (IndexedDB).

UI labels (English): instruments Guitar, Bass, Rhythm, Keys, Drums, Vocals, Harmony; difficulties Easy, Medium, Hard, Expert; drum modes "Drums (4 lanes)", "Drums (5 lanes)", "Drums (Pro)", "Drums (Pro 7 lanes)"; panels Library, Settings, Stem volume, Other song.ini properties.

**Not supported** (pending items, in order of likely value):
- `.sng` containers are read (`src/sng.js`; metadata replaces song.ini, inner files are lazy, XOR mask undone per file); not the YARG-encrypted wrapper variant, and a .sng inside a folder that is also a song is a separate song;
- `.chart` is read (`src/chartfile.js`), but not GHL tracks, co-op guitar (`DoubleGuitar`), per-difficulty star power or cymbal flags that differ between difficulties at the same tick, and the vocal pitches (a .chart has lyrics only, drawn as talkie notes);
- Pro guitar and bass (`PART REAL_GUITAR`, `REAL_BASS`) and Pro keys (`PART REAL_KEYS_*`);
- open by 5-lane note pattern (only the SysEx and `[ENHANCED_OPENS]` forms are read);
- fill / BRE only as a faint band; no BRE-specific graphics or scoring, and no coda `Coda` phrase;
- Elite Drums (`PART ELITE_DRUMS`) and VENUE/lights;
- solo only as a background band (star power also recolours its notes, see `markStarPowerNotes` in `highway.js`);
- lyrics: `§`/`=` handled only in a basic way; `#`, `+`, `^`, `*`, `%`, `/`, `$` are hidden (their meaning is applied, see §5); the Unity-side vocal UI is not in YARG.Core, so how YARG draws talkies and uses range shifts is inferred from the data
  as in YARG (see §4).

**Never verified** (only by synthetic test or code reading):
- audio sync with real `.ogg` stems and the `PitchShifter` latency;
- the sign of the audio delay and the chart delay, by ear;
- time-stretch quality at extreme speeds;
- accent and ghost in real songs (none of the sample MIDIs has them; see §6).

## 3. How to run and test

```bash
npm start   # python3 -m http.server 8080; open http://localhost:8080
npm test    # node --test test/*.test.js (no browser)
node scripts/find-special-notes.mjs <folder> [--only open,accent] [--max 5] [--json]
```

Unit tests use synthetic MIDIs generated by `test/smf.js` (an SMF writer for tests only). **Do not commit the
user's real songs**: they are copyrighted and stay outside the repository.

Visual verification (done this way so far):
- System Chromium: `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`. Do not run
  `playwright install`. Playwright comes from `npm root -g`.
- To load a folder, use `page.setInputFiles('#folderInput', '<directory path>')`. The input is
  `webkitdirectory`, so it needs a real directory, not a list of files.
- Each test song is a folder with `notes.mid`, `song.ini` and a silent `song.wav` (the audio is needed
  for the song to open; an 8 kHz mono WAV of N seconds works).
- To position: `#seek` takes `value` and the `input` and `change` events.
- The canvas has height `min(70vh, 620px)`. Crop the screenshot to the full height, or the lyrics
  (below the canvas) are left out.
- Do not use `pkill -f <pattern>`: the pattern matches the shell itself and kills the session (exit 144). Keep the PID
  of the `http.server` and use `kill`.
- The `Read` tool does not read `.mid` (binary). To inspect, use the project parser (`src/midi.js`) or a
  Python script with `struct`.

User sample files (uploaded MIDIs, outside the repository): they live in
`/root/.claude/uploads/d26c26e2-528c-5e88-b1e8-1ab751f2ced1/`. The names are `<id>-notes.mid`. The identification
of the songs is in the conversation history (see §6).

## 4. Architecture

Flow: folder → `library.js` (songs) → click → `midi.js` (parse) + `chart.js` (chart) → `highway.js`
(drawing, a pure function of `t`) and `player.js` (audio). `app.js` wires up the UI.

| File | Role |
|---|---|
| `index.html`, `styles.css` | UI. Control IDs are used by `app.js`. |
| `server.mjs` | Optional server (`npm start`): app + `/api/library` + `/songs/*`. The app uses it automatically (`startLibrary` in `app.js`). Index cache in `.cache/`. |
| `src/gfx.js` | Drawing constants and helpers shared by both views. |
| `src/highway3d.js` | 3D highway view (perspective on the 2D canvas, no WebGL; vocals use the flat view). Button ⬡ / V key; preference in localStorage. Note style (circles or rounded rectangles, `noteShape` in `gfx.js`): button below the 3D one / N key, also in localStorage. |
| (drums) | "Drums (Pro 7 lanes)" mode (id `drums-extended`): 7 lanes, tom and cymbal each in their own (`EXTENDED_DRUM_LANES` in `chart.js`). In YARG this is per profile (Split/Merge in `DrumsHighwaySpecs.cs`); the exact order after the split was not confirmed. Cymbals are triangles. |
| `src/songinfo.js` | Data for the info screen: song.ini metadata and levels, BPM and chart counts (pure functions). |
| `src/songlist.js` | List search, filter and sorting (pure functions). |
| `src/app.js` | Events, song/instrument/difficulty selection, `frame()` loop (clock, section, highway). |
| `src/midi.js` | SMF parser: notes with `tick`/`endTick`/`velocity`, `texts` (meta 0x01), `lyrics` (meta 0x05), `sysex` (F0), `tempos`; `toSeconds` converts tick to seconds. |
| `src/chartfile.js` | notes.chart reader (YARG.Core `MoonscraperChartParser/IO/Chart`). Returns the same shape as `parseMidi` by translating .chart events into MIDI-convention notes (tap/forced travel as `n.tap`/`n.forced`, open as the enhanced-open note, cymbal flags as inverted tom markers, `source: 'chart'` selects the .chart HOPO threshold, sustain and star power defaults in `chartSettings`). `notes.mid` wins when a song has both. |
| `src/chart.js` | YARG rules (see §5). Exports `instrumentOptions`, `buildChart`, `availableDifficulties`, `phraseWindows`, `naturalHopo`, `parseSectionName`, `sectionIndexAt`, `displayLyric`, `drumKind`. |
| `src/highway.js` | Canvas drawing. `render(t)` keeps no time state. Drawing order matters: hit line → pedals/open → sustains → heads. Visual constants at the top. |
| `src/player.js` | `MultiTrackPlayer`: stems in `AudioBuffer`, aligned to the chart (`alignChannel`) and played by `PitchShifter` (SoundTouch, `vendor/`). Speed via `tempo`. |
| `src/sng.js` | .sng reader (YARG.Core `IO/SngHandler`): header, metadata (same shape as `parseSongIni`), file index, `readSngBytes` with range and mask. Works on any source `{size, read(start,end)}` (`blobSource`, `bufferSource`). |
| `src/library.js` | Folder scan (FSA or input), serializable index, `resolveFile`. A `.sng` is one song: id = its path, inner files at `<sng path>/<name>` (entries carry `sng` so `restoreSongs` reads them through the container; `server.mjs` serves the same URLs, ranges included). |
| `src/store.js` | IndexedDB: folder handle, index and album thumbnails (`thumbs` store, db v2). Failures are silent. |
| `src/virtuallist.js` | Windowed library list with a custom scrollbar rail (group ticks, short anchor labels, press/drag to jump, snaps to headers). Fixed-height rows and headers; `ROW_H`/`HEAD_H` must match the CSS. |
| `src/songlist.js` | Search/filter/sort/group of the library list. Search accepts fields (`artist:`, `album:`, `genre:`, `charter:`, `year:1990-1999`, `len:<4` in minutes, `inst:drums`, `no:vocals`, `-field:` to exclude); filters: instrument chips (all selected), minimum level, genre, decade. `songSummary()` feeds the large card. |
| `src/thumbs.js` | Library thumbnails: 128 px JPEG (stored under `id@128`) made in the browser, LRU of object URLs (cap 300) + IndexedDB, 3 jobs at a time, dropped if the row scrolled away. |
| `src/ini.js` | `song.ini` and `songDelaySeconds` (`delay` in ms or `delay_seconds`). |
| `vendor/` | SoundTouchJS 0.1.30 (LGPL-2.1), no build. License included. |
| `test/` | `node:test` tests. `smf.js` writes synthetic MIDIs. |
| `scripts/find-special-notes.mjs` | Search for special notes in a catalog, with time and section. |

Chart data model (`buildChart`):
- `mode`: `'lanes'` (guitar, bass, rhythm, keys, drums) or `'vocals'`.
- lanes: `notes[] = {time, end, length, lane, cymbal, tap, hopo, open, accent, ghost, doubleKick}`, `lanes`,
  `laneColors`, `drumKind`, `rolls[]`, `solos[]`, `starPower[]`, `beats[]`, `sections[]`, `duration`.
  In drums, `lane = -1` is the kick (full-width bar, not a column).
- vocals: `notes[] = {time, end, length, pitch}`, `harmonies[] = {part, notes}`, `percussion[] = {time, played}`,
  `lyrics[] = {time, text}`.

Clock: `player.currentTime()` = chart position. The highway receives `t − chartDelay`, so a positive delay
makes the notes arrive after the audio. The current section uses the same time as the highway.

## 5. YARG rules (source: `yarg.core` at `github.com/YARC-Official/YARG.Core`)

Reference clone used: `/home/user/yarc-official/yarg.core` (may not exist in the new session; clone with
`GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/YARC-Official/yarg.core`).

| Topic | Rule | Where in YARG.Core |
|---|---|---|
| Difficulties | Base 60/72/84/96 (Easy/Medium/Hard/Expert). Offsets 0–4 = lanes; +5 and +6 = forced HOPO and forced strum. | `MidiInstrumentPreparser.cs`, `MidiFiveFretPreparser.cs` |
| Tap | Note 104 marks a window `[start, end)`; notes inside are tap (all difficulties). | `MidReader.ProcessLists.cs` |
| Natural HOPO | Not a chord, has a previous note (another fret or chord) and distance ≤ `resolution/3 + 1`. | `MoonNote.IsNaturalHopo`, `MidReader.cs` |
| Forced | A 101 window forces HOPO; 102 forces strum. Strum wins over HOPO. | `MidReader.cs` (`ProcessEventAsGuitarForcedTypePostDelay`) |
| Open | SysEx `PS\0`, type 0, difficulty (0–3, 0xFF = all), code 1 = open, value 1 start / 0 end, F7. Notes in the window become open. | `PhaseShiftSysEx.cs`, `MidReader.cs` |
| Sustain | A note has a sustain if it lasts ≥ `resolution/3` ticks. Drums have no sustain. | `SustainCutoffThreshold` in `MidReader.cs` |
| Drums: type | 101 present = 5 lanes; 110–112 present = Pro; otherwise 4 lanes. | `MidiDrumsPreparser.cs` |
| Drums: pads | Offsets 0 kick, 1 red, 2 yellow, 3 blue, 4 orange (5 lanes) or green (4 lanes), 5 green (5 lanes). | `DrumPadToMidiKey` in `MidReader.ProcessLists.cs` |
| Cymbal (Pro) | Yellow, blue and orange/green are **cymbal by default**. Notes 110/111/112 are **tom markers**: the window of each one does an XOR. Cymbal = even number of markers covering the note. | `DrumPadDefaultFlags`, `PAD_TO_CYMBAL_LOOKUP` in `MidIOHelper.cs`, `ProcessNoteOnEventAsFlagToggle` (`note.flags ^= flags`) |
| Pro 4-lane mode | Same notes, no cymbals. The option appears as "Drums (4 lanes)". In the selectors (cards and top menu) the drums are a single item, "Drums", with a mode selector (4 lanes / 5 lanes / Pro / Pro 7 lanes); `instrumentGroups()` in `app.js` (vocals and harmony are also a single "Vocals" item with a selector). | `MoonNoteToFourLane` |
| Accent / ghost | Velocity 127 = accent, 1 = ghost, pads only (not kick). | `MidIOHelper.VELOCITY_ACCENT/GHOST` |
| Double kick | A note one below the difficulty's kick (95 on Expert) becomes its own kick, at its tick, with the flag. | `MidReader.ProcessLists.cs` (`key - 1` with `InstrumentPlus`) |
| Rolls | 125 kick roll, 126 tremolo, 127 trill (time spans). | `MidIOHelper.cs` |
| Sections | Text in the `EVENTS` track as `[section Name]` or `prc_name`. Current section = last one started; before the first, the first. | `TextEvents.TryParseSectionEvent`, `PracticeManager.FindSectionAtTime` |
| Lyrics | Lyric events (meta 0x05) in the vocal track; if there are none, text without brackets (e.g. `5395826e`, `5875318f`). | `MidReader.cs`, `LyricSymbols.cs` |
| Lyric symbols | Hidden: `+ # ^ * % / $`. `=` = hyphen. `§` = joined syllables (`‿`). `-` stays. | `LyricSymbols.cs` |
| Vocals | Notes 36–84 (0 range shift, 1 lyric shift; 96 played and 97 not played are percussion). Harmonies: `HARM1`–`HARM3` or `PART HARM1`–`HARM3`. | `MidIOHelper.cs` |
| Vocal phrases | Notes 105/106 are scoring and static lyric phrases (`phraseRanges` in `vocals.js`). Lyrics go to the notes in a phrase by tick; a lyric takes the length of its nearest unclaimed note and lyrics no note claims are dropped (`chart.lyrics[].end`). HARM3 uses HARM2's phrases. | `MoonSongLoader.Vocals.cs` (`GetVocalsPhrases`, `FixLyricLengths`), `MidReader.ProcessLists.cs` (`CopyDownPhrases`) |
| Karaoke lines | `chart.phrases` = static lyric phrases split at lyric-shift notes (note 1; else the end of a syllable marked `/`), at gaps ≥ 0.4 s between syllables (not after a joined one), and by character count (> 50: `ceil(chars/37.5)` chunks, cut at the first word boundary past the target). Charts without phrases fall back to the same time/character rules over the lyrics (`karaoke.js`). | `SplitStaticLyricPhrases`, `SplitPhraseByTime`, `SplitPhraseByCharacterCount`, `StaticLyricConstants.cs` |
| Pitch slide / talkie | A lyric ending in `+` makes its note a continuation of the previous one (`slide`, drawn joined; no syllable of its own); `#`, `^`, `*` make the note unpitched (`talkie`, drawn as a dashed box in the middle of the range, ignored by the range). | `LyricSymbols.cs`, `MoonSongLoader.Vocals.cs` (`GetVocalsPhrases`, `GetVocalNotePitch`) |
| Range shifts | Points: note 0 (length = its duration), `[range_shift]` / `[range_shift 0.5]` text, lyric ending in `%`. Each range covers the pitched notes up to the next point (`chart.rangeShifts`). With more than one range `Highway.vocalRange` uses the one in force at `t` (eased over its length); with one, it scans ahead. | `GetRangeShifts` |
| Harmony lyrics | Static phrases of HARM2 and HARM3 merge by start tick (words within a 16th note: same text keeps one with the earliest start and latest end, a lower-case start wins; otherwise both, in the order that reads best), then merge with HARM1's; `$` hides a lyric. | `MergePhrases`, `MergePhrasePair` |
| Delay | `delay` (ms) if ≠ 0, otherwise `delay_seconds`. File position = chart time + delay. | `SongMetadata.cs`, `SongRunner.cs` |
| Enhanced opens | Text `[ENHANCED_OPENS]` / `ENHANCED_OPENS` in a 5-fret track: from that tick on, the note one below each difficulty's green (59/71/83/95) is an open note (`n.open`, lane 0). | `SwitchToGuitarEnhancedOpensProcessMap`, `BuildGuitarNoteProcessDict` (`FretToMidiKey[Open] = -1`) in `MidReader.ProcessLists.cs` |
| Fills / BRE | Drums: notes 120–124 are activation phrases (`chart.fills`, kind `fill`); with a `coda`/`midcoda` event those starting inside a coda become `bre`. Guitar-like parts: note 120 is a BRE, valid only entirely inside a coda. Coda ranges: `midcoda`…`midcoda_end` pairs and a last `coda` to the end. | `DRUM_FILL_NOTE_*`, `ReplaceDrumFillDuringCoda`, `GetCodaRanges` (`MidReader.ProcessLists.cs`); `ValidateGuitarPhrase` (`MoonSongLoader.Guitar.cs`) |
| Time signature / beat grid | Meta 0x58 (numerator, denominator = 2^n) → `midi.timeSignatures`. BEAT track notes 12/13 win; with none, lines every `resolution*4/denominator` ticks, restarting at each signature change, a measure line every `numerator` lines (x/1: only the first), default 4/4. | `SyncTrack.GenerateBeatlines` (`FinishLoading`) in `Chart/Sync/SyncTrack.cs`; `ReadSongBeats` in `MidReader.cs` |
| Tempo | Tempo map summed across all tracks (meta 0x51), integrated `tick → seconds`. | `SyncTrack.cs` |

## 6. The user's sample songs

Identified by lyrics, track name and sections (varying confidence):
- `5395826e` — **Highway Star** (Deep Purple). Lyrics confirmed. Harmonies no. Percussion at 120 s (`chorus_2`/`organ_solo_a`). Lyrics at 43 s.
- `5875318f` — **Before I Forget** (Slipknot), probable. Harmonies HARM1/2 (H2 with its own notes at ~50 s). Lyrics at 39 s. Double kick at 33 s.
- `01b7a7a6` — **No One Like You** (Scorpions). Confirmed by the user. Harmonies H1/H2/H3 at 39 s, 68 s, 73 s. Lyrics at ~40 s.
- `b96f00af` — **Toys in the Attic** (Aerosmith). Confirmed by the user. Harmonies H1/H2 at 23 s, H3 at 148 s. Percussion at 108 s.
- `34e01570` — **Panic Attack** (Dream Theater), probable (track `panicattack`). Percussion at 135 s. Few lyrics.
- `cb619a04` — **unidentified**. Open on Expert bass from 11.7 s. Abundant lyrics.
- `38a7b2e3` — **unidentified**. No lyrics. Sections Scream, Ballad Of Metal.

Test findings: none of the six has accent or ghost on a pad. Tap (104) does not appear either. Double kick
appears in `5875318f` and `34e01570`. Rolls in `5395826e`. To test accent/ghost, generate a synthetic MIDI.

## 7. Working conventions

- Commits: message in English, with trailers
  `Co-Authored-By: Claude <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01CyeWZRtgcvqEJkCGi1jXRk`. Do **not** put a model name or version
  in commits, PRs or repository files.
- Git identity: use `git -c user.name=... -c user.email=...` with `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` if
  defined, otherwise `gugutab`.
- Always push with `git push -u origin claude/upbeat-knuth-87adga`. Do not push to another branch, nor force-push.
- Before each commit: `npm test` and `node --check` on the changed files.
- Visual changes: check with a screenshot (see §3). A unit test is not enough for drawing.
- For MIDI rules, cite the origin in YARG.Core (file and function) in the comment, as is already done.
- Files may change on disk between turns (the user edits). Before editing, re-read the section.
- Tools: `Edit` requires the file to have been read in the conversation. If it says "No changes to make", the text is already
  correct.

## 8. Points of attention

- Audio: `player.js` uses an `AudioWorklet` (`player-worklet.js` + `mixstretch.js`) that mixes all stems and applies the time-stretch (SoundTouch) once, with a single read position; the chart clock interpolates the position history that the worklet reports (`clock.js`), at the instant `ctx.currentTime − output latency` (extrapolating with the current speed caused jumps when changing speed; reports arrive ahead of what is heard, and `epoch` discards reports prior to a seek). This fixed the loss of sync between stems and chart of the old engine (one `ScriptProcessor` per stem on the main thread, still present as the fallback `LegacyPlayer`). Core test: `test/mixstretch.test.js`. Not verified by ear: stretch quality and real latency on devices. The legacy `LegacyPlayer` fallback adds latency; the highway clock does not compensate for it. Short difficulty badges (E/M/H/X) come from the `short` field of `DIFFICULTIES` in `chart.js`.
- `showDirectoryPicker` shows a native Chrome dialog; the page cannot suppress it. "Reopen folder"
  asks only for read permission, in one click.
- Lyrics and sections use the same `t` as the highway, with the chart delay applied. Changing one of them without the other
  breaks the alignment.
- Pro drums: since almost every pad is a cymbal by default, the screen shows many rings. This is YARG's behavior.
- `sectionIndexAt` returns the first section before any start. Do not use `-1` for "no section" if there are
  sections.
- Star power: background band + the phrase's notes in white with the lane outline (like YARG; `markStarPowerNotes`). Solo remains only a background band. The comparison with YARG's render and the suggestions are in `docs/yarg-render-review.md`.
- The 5-lane mode applies cymbal (flags) too. The user asked for this explicitly; do not remove it without asking.

- Large/wide screens (§ Round 56 in `styles.css`): breakpoints at 1800, 2300 and 3000 px widen the library (`--lib-w`) and the top bar's content cap (`.tb-main`); the detail screen (`.info-grid`) is capped at 1400 px; the 2D lanes grow with the stage height (`laneW` in `highway.js`). CSS `zoom` was tried and rejected: it breaks coordinates for popovers, the scrollbar rail and the canvas.
- Instrument icons (`i-guitar`, `i-bass`, `i-rhythm`, `i-keys`, `i-drum`, `i-mic`, `i-harmony` in `index.html`) are traced from YARG's icon sheet (LGPL-3.0, see `vendor/README.md`); regenerate with `scripts/build-yarg-icons.py`. The ids are used by `INSTRUMENT_ICON`/`CARD_INSTRUMENTS` in `app.js` and by `stemKind` in `songinfo.js`.
- Library index (`server.mjs`): each song also has `parts` (the instruments its `notes.mid` really has, from `instrumentOptions`; harmony counts as vocals). `song.ini` often has no `diff_*` or -1 for all, so the list icons and the instrument filter use `parts` when present and fall back to the ini levels (folder mode has no `parts`). `INDEX_VERSION` is 4 (adds .sng songs). Bump it when the index gets new fields: the `.cache/library.json` is then rebuilt (a full scan reads every `notes.mid`, ~8 s for 746 songs).
- Pack (game/DLC): `packOf(song)` in `ini.js` = the top-level folder of the song's path (40 values in the author's library: "Rock Band 2 DLC", "Guitar Hero III"...; the ini `icon` code is partial). Shown as the first header chip, as a line in the large card, a filter, a sort key with dividers, a `pack:` search field (and part of the free-text search). Songs in the library root have no pack.
- Layout: two panels. The library (search, filters, sort, card list) is the left panel, always open on a desktop screen (collapsing it with L/the close button only lasts for the session; on a phone it is a drawer), and the song (details, then the player) is the right panel. A divider between them resizes the library (`#splitter`, width kept in `yargremote.libWidth`, double-click resets); a wide panel flows its cards into columns (`list.setColumns(1, { minWidth: 440 })`).
- Deep links (`src/route.js`, the Deep links block at the end of `app.js`): the URL hash names the open song (`#/song/<id>` details, `#/song/<id>/play` chart); it is only replaced, never pushed, so Back leaves the app and the panels stay in place. A reload or a shared link opens the same song (`openFromHash`).

## Settings page (customization)

- `src/settings-schema.js` lists every setting by section (appearance, library and cards, song details, panels, highway, general, data). A setting is added to the schema only when it is wired; `app.js` applies each one through the `EFFECTS` map and an initial pass.
- `prefs` (store in `src/settings.js`, only non-default values in `localStorage['yargremote.settings']`) is not the playback `settings` object (`speed/neck/chartDelay`).
- Themes: `src/themes.js` (presets, derive, resolve/apply as CSS variables on `<html>`), theme studio in `src/settings-custom.js`.
- Cards: `DEFAULT_CARDS`/`cardHeight`/`setCards` in `src/virtuallist.js`. Details screen: `applyDetails()` sets `data-*` attributes on `#info`.
- Audio loads on demand (`ensureAudio`, called by Play, the Listen card or Space) behind `#loadScreen`; picking a song only reads the chart.
- Panels: library and song panel close/reopen (`setLibraryOpen`, `setSongPanelOpen`, keys L and D, edge tabs); never both closed on desktop; state in `yargremote.panelState`.
- Several fretboards: `Highway.setCharts([{chart,label}])` draws every chart (`drawPane` clips and translates, so the lane renderers still see one canvas). Vocals take a band across the top, lane charts sit side by side; when `width / paneMin` does not fit them all, `focus` selects the first one in view (swipe/drag on the canvas, keys `[` `]`, dots at the bottom). In the app, `current.pins` holds the instrument groups pinned (layers button on cards / menu rows) next to the active one; the active chart still drives the timeline, sections and seek.
- Karaoke (`src/karaoke.js` + `Highway.renderKaraoke`): vocals as the lyrics only, lines are `chart.phrases` (see §5, Karaoke lines), sung part filled per syllable. Key `K`, "Vocals" group in the chart-options popover, setting `highway.vocalView`.
- Special notes (`src/specials.js`): `specialNotes(chart)` lists the kinds a chart has (open, tap, accent, ghost, double kick, star power, solos, fills/BRE, rolls; for vocals slides, talkies, percussion, range shifts) with counts and jump times; the UI is the "Special notes" card on the details screen and a group in the chart-options popover (`renderSpecials` in app.js), with previous/next buttons that seek 1.5 s before the occurrence. Vocal notes use one colour (`VOCAL_LEAD`) and a lighter shade past the hit line (no yellow); percussion hits are drum-head markers on their own row.
- Harmony lyrics: `chart.lyrics` are YARG's merged static lyrics (karaoke without split), `chart.lyrics1` the lead voice's own words, `chart.lyrics2` the other voices' own words (what the lead does not sing at the same moment). Notes view: lyrics2 is a row above the pitch area. Karaoke alone: two sheets (VOCAL 1 / VOCAL 2, side by side when wide), each with its own scroll state (`Highway.sheets`, `sheetAt`, `scrollSheet`, `sheetLineAt`).
- Wait countdowns (`src/countdown.js`, `Highway.drawCountdown`; vocal notes view: left of the hit line, karaoke: a row of its own above the next line to be sung): a chart with nothing to play for 9 s or more (also before the first note) shows a ring with the seconds until its next note, per pane; suppressed in a coda (`GetWaitCountdowns`, `WaitCountdown.MIN_SECONDS`). Setting `highway.countdown`.
- Resizable panes: dividers between fretboards (and under the vocal band) are drawn by `Highway.drawDivider` and listed in `highway.dividers`; app.js pointer handlers drag them (`dragDivider`: weights per pane key, or `vocalH`), double click resets (`resetSizes`), sizes persist in `localStorage['yargremote.paneSizes']`.
- Lyric sheets (karaoke): manual scroll (wheel/drag) stops the autoscroll until the "Autoscroll" button, a seek or the "jump to" button; countdown rows sit before every line that follows a rest of 9 s or more (running = live ring, others grey with the length); a non-interactive rail at the right edge shows the song (progress and %, rests, percussion sections, entries, the visible window): `Highway.drawSheetRail`, `lyricCtx`.
