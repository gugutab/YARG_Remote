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
npm start   # node server.mjs [songsDir] (env SONGS_DIR, PORT=8080, HOST=127.0.0.1); open http://localhost:8080
npm run start:static   # python3 -m http.server 8080 --bind 127.0.0.1 (folder picker only, no server features)
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
- Karaoke (`src/karaoke.js` + `Highway.renderKaraoke`): vocals as the lyrics only, lines are `chart.phrases` (see §5, Karaoke lines), sung part filled per syllable. Key `K`, "Vocals" group in the instrument menu, setting `highway.vocalView`.
- Special notes (`src/specials.js`): `specialNotes(chart)` lists the kinds a chart has (open, tap, accent, ghost, double kick, star power, solos, fills/BRE, rolls; for vocals slides, talkies, percussion, range shifts) with counts and jump times; the UI is the "Special notes" card on the details screen (`renderSpecials` in app.js), with previous/next buttons that seek 1.5 s before the occurrence. Vocal notes use one colour (`VOCAL_LEAD`) and a lighter shade past the hit line (no yellow); percussion hits are drum-head markers on their own row.
- Harmony lyrics: `chart.lyrics` are YARG's merged static lyrics (karaoke without split), `chart.lyrics1` the lead voice's own words, `chart.lyrics2` the other voices' own words (what the lead does not sing at the same moment). Notes view: lyrics2 is a row above the pitch area. Karaoke alone: two sheets (VOCAL 1 / VOCAL 2, side by side when wide), each with its own scroll state (`Highway.sheets`, `sheetAt`, `scrollSheet`, `sheetLineAt`).
- Wait countdowns (`src/countdown.js`, `Highway.drawCountdown`; vocal notes view: left of the hit line, karaoke: a row of its own above the next line to be sung): a chart with nothing to play for 9 s or more (also before the first note) shows a ring with the seconds until its next note, per pane; suppressed in a coda (`GetWaitCountdowns`, `WaitCountdown.MIN_SECONDS`). Setting `highway.countdown`.
- Resizable panes: dividers between fretboards (and under the vocal band) are drawn by `Highway.drawDivider` and listed in `highway.dividers`; app.js pointer handlers drag them (`dragDivider`: weights per pane key, or `vocalH`), double click resets (`resetSizes`), sizes persist in `localStorage['yargremote.paneSizes']`.
- Lyric sheets (karaoke): manual scroll (wheel/drag) holds the sheet: the active line keeps changing with the music, the sheet scrolls only as much as needed to keep it in view, and the Autoscroll button shows only while it is out of view; autoscroll resumes with the "Autoscroll" button, a seek or the "jump to" button; countdown rows sit before every line that follows a rest of 9 s or more (running = live ring, others grey with the length); a non-interactive rail at the right edge shows the song (progress as a dimming overlay on the part already played, rests, percussion sections, entries, the visible window): `Highway.drawSheetRail`, `lyricCtx`.
- Instrument tags: `Highway.paneRects` (key, label, icon, x, y, w, h per chart, every frame) places a DOM tag (`.pane-tag`, `syncPaneTags` in app.js) over each chart, also with a single instrument. A tag opens `#paneMenu` (`buildPaneMenu`): difficulty and type (Pro / Harmony…) of that instrument, swap with / add another instrument (`replacePane`, `addPane`), the view options, then at the end swap, add and remove (`closePane`; remove is red; with a single instrument it does what swap does) (vocal view, 2D/3D, note shape; the old settings button over the chart was removed).
- Instrument chooser: Swap / Add instrument in the tag menu removes the fretboard (swap) or adds a slot (add); the slot is a pane without a chart (`chooser: true` in `Highway.setCharts`) that app.js fills with the instrument/type/difficulty cards (`fillChooser`, `current.choosers`). Swapping the only instrument keeps it as the timeline source (`current.hiddenActive`) until a card is picked; the slot's X cancels.
- Volume in the instrument menu: `menuVolume(group)` reuses `mixerRow` / `groupBlock` for the stems whose `stemGroup` equals the instrument group key (guitar, bass, drums, vocals…), registered as extra views of the same stem states (dropped on rebuild by `dropMenuMixViews`), so the menu and the Stem volume card always agree. No section when the song has no stem for that instrument.
- Section names: exactly like YARG.Core. The name is the text after the `section` / `prc` prefix, with leading `_` and spaces trimmed and read as YARG does (`TextEvents.TryParseSectionEvent`) and only tidied for display by `displaySectionName`: underscores become spaces and each word is capitalised (`chorus_1` -> Chorus 1, `gtr_solo_a` -> Gtr Solo A); no abbreviations are expanded. A song with no sections gets ten automatic ones, `0% - 10%` ... `90% - 100%`, over the song's last tick (`SongChart.AutoGeneration.cs`, `autoSections` in chart.js).
- Top bar and library open/close the same way: the top bar has a chevron to hide it (`#barHide`) and a small button to show it (`#barShow`); the library has a chevron in its header (`#closeLibrary`, points left) and a small chevron tab on the left edge while hidden (`#libTab`, always shown, also on a phone where the library is a drawer). The hamburger buttons (top bar, details screen) and the top bar's instrument chip (`#partBtn`; instrument, difficulty and type live in the tag menus and the details cards) were removed. The top bar slides in 0.2 s too (it moves up as one piece with a negative `margin-top`, like the library's `margin-left`, so nothing is squeezed) and its show button is a chevron tab glued to the top edge at the right corner (`#barShow`, `.edge-top`), styled like the library tab. Keys: B top bar, L library, D song panel.
- Peeking (`setupPeek` in app.js, `PEEK` timings): resting the pointer on the tab of a hidden menu (library `#libTab`, song panel `#songTab`, top bar `#barShow`) for 1 s opens it temporarily and saves nothing; it closes again 2 s after the pointer leaves the menu or 3 s after the pointer stops moving over it, unless a popover is open or an input inside it has focus. A click on the tab opens it for good. No peek on touch screens or phones.
- Seek by wheel: the mouse wheel over the seek bar (`#seekbox`) moves the song, up = forward, 5 s per notch (1 s with Shift), clamped to the song; only once the audio is loaded.
- Seek animation: `visualChartTime` (app.js) eases only the time the highway draws when the song jumps (more than 0.75 s between two frames: seek bar, wheel, arrows, section, lyric line): ease-out from where the chart is shown to the new time, 0.28 s + 25 ms per second of distance, 0.7 s at most. The clock, sections and audio use the real time. Setting `highway.seekAnimation`.
- Motion blur: while a seek animation moves the drawn time faster than 0.06 s per frame, `Highway.renderBlur` draws the chart at 8 moments across most of that frame's time step (on an offscreen canvas, averaged with a running 1/(i+1) alpha) so rushing notes leave a trail. Setting `highway.motionBlur` (depends on `highway.seekAnimation`).
- Performance overlay (`src/perf.js` collector, `src/perf-overlay.js` DOM chip in `#stage`): `frame()` in app.js timestamps each frame and times the `highway.render`/`renderBlur` call; the overlay repaints at most 4x/s. Settings `perf.overlay` (off/compact/detailed) and `perf.position`; key P and a click on the chip cycle the mode and save it. Detailed shows fps, frame avg/p95/max, draw ms, dropped frames (gap > 1.5x median or > 25 ms), long tasks, canvas size, dpr, panes, JS heap (Chromium) and audio output latency. Notes-on-screen and audio drift are not measured.
- Background visualizers (`src/visualizers.js`, `Highway.setVisualizer`, popover `#visualizerPop` + key G, Shift+G backwards): one animated background for the whole chart canvas, drawn in `Highway.draw` right after the background fill, under every pane (motion blur draws it once per frame and reuses it for the samples). Every effect is a pure function of the song time `t` (beat position from `chart.beats`, note density integral, star power spans, vocal and percussion activity, chart notes as a spectrum) plus the cover palette (32x32 downscale, `extractPalette`), so pausing freezes it and seeks just land; `createDriver` builds the per-song data (`buildSongData`, rebuilt when `highway.panes` changes), draws the effect and an overlay of the stage colour at `1 - visibility` (`highway.visualizerVisibility`, 10-95, default 65). Effects: Album art, Aurora, Synthwave, Warp, Beat rings, MIDI equalizer, Embers, Radial spectrum, Spotlights, Tunnel (default `none`). A throwing effect disables itself. The lyric sheets/3D road fades still dissolve into the plain stage colour, so they look like a slightly darker edge over a visualizer. `stats` (exported) keeps the running draw cost per effect. Pure helpers tested in `test/visualizers.test.js`. No audio analysis (the player graph is untouched).
- A-B loop (`src/looprange.js` pure logic, tested in `test/loop.test.js`; UI in the Loop block of `app.js`, button `#loopBtn` / key R): a range of player time (seek bar scale), so it survives instrument/difficulty changes and is cleared when a song opens. Starts around the current section (or t +- 10 s without sections); two draggable handles (`#loopStart`/`#loopEnd`, pointer capture) snap to section starts and the song ends within 10 px (Alt disables), minimum length 1 s; `#loopBand` highlights the region. The frame loop wraps to the start only when playback leaves the end from inside (`shouldWrap`; dormant outside the region), asking `player.outputLatency` early so the restart is heard on time, and sets `instantJump` so the seek animation/motion blur skip it. Section list rows have a loop button (no loop: loop that section; outside the loop: extend to include it; inside: narrow to it). Hovering the seek bar shows `#seekTip` (section name and time; a handle's time over a handle), fixed-positioned so it also works with the top bar collapsed.
- Loop edits while playing: when a section loop button or a handle drag (on release) leaves the playhead outside the loop, `rewindIntoLoop` seeks to the loop start. Visualizers no longer punch on the beat (`beat.pulse`/`measurePulse` forced to 0 in the driver); tempo-locked motion stays.
- The fretboards have no base layer of the stage colour (it was removed on request): the road is only the faint white tint and lane guides, so a background visualizer shows through. The vocal band still has its own base (`trackBase`).
- Visualizer fixes: Album art keeps a sharp 512 px copy of the cover (mild zoom, no rotation, no blur); Aurora draws at full resolution; the MIDI equalizer hangs from the top edge (90% of the height), each note lights a wide hill (`spectrumAt` has a `spread` argument), with delayed echo copies (0.09/0.2/0.34 s back), a glowing tip and falling peak caps.
- Visualizer menu: the popover has a scrolling effect list (`.viz-list`) and a foot (`.viz-foot`) that stays in view with two icon sliders (eye = `highway.visualizerVisibility`, 10-95%, default 65, overlay alpha = 1 - visibility; drop = `highway.visualizerBlur`, 0-40 px, default 0), both hidden with None; the old `visualizerTransparency` / `visualizerIntensity` prefs are ignored. Blur (`drawBlurred` in the driver): the effect is drawn on a small offscreen canvas (scale 0.5 / 0.35 / 0.25 by strength; the downscale is already a blur), blurred there with `ctx.filter` when supported (else just the upsample) and painted over the stage before the overlay; it also works in `Highway.renderBlur` since that calls the same driver function. At 0 nothing extra is drawn. A "Background" colour picker (shown with None too, "Theme" resets) sets `highway.stageColor` + `highway.stageColorOn`, applied by `applyStage()` over the theme's stage colour. Visualizers that want the stage colour read `hw.bgRgb`.
- Newer effects: Album art is drawn as cloth (48 vertical strips, source slices of the cover, offsets/scale/ripple from `clothAt`, slope shading with plain rgba, 1 px overlap so no seams; no beat flash). Radial spectrum (`radialLayout`: mirrored 2x40 bars around a ring, wide hills, echo outlines, peak caps, the cover as a record turning with `beat.pos`, palette disc without a cover). Spotlights (`beamAngle`: 5-6 additive cones from the top edge swinging on their own beat periods, floor pools, haze; density/vocal brighten, star power warms them). Tunnel (14 rounded 6/8-gons at depth `fract(pos*0.05 + travel*0.12 + i/N)`, colours cycling through the palette, twist eased per section with `sectionValue`). Costs measured at 1500x900: about 0.15 ms (tunnel, spotlights), 0.2 ms (radial), blur adds roughly 0.2 ms of JS (the filter runs on the GPU).
- Edge fades with a visualizer: when a visualizer is set, each lane pane is drawn on its own offscreen layer (`drawPane` / `layerFor`, `this.layered`) and the top and bottom fades erase it (`destination-out` via `fadeStyle`) instead of painting the stage colour, so the visualizer stays visible behind them. Without a visualizer the old stage-colour fade is used (no extra layer).
- Add all: the instrument chooser has an "Add all" button (when 2+ instruments are off screen) that pins every one of them at once, each with the type and difficulty its card shows (`addAllInto`).
- Vocal track: with a visualizer on, the vocal band (chart, karaoke) and the lyric area under it get a semi-transparent stage-colour base (`trackBase`, 0.72) so notes and words read well; no change without a visualizer.
- Lyric sheet fades with a visualizer: the rows are drawn on their own layer (`rowLayer`) and the top/bottom fades erase only the words; the rail and the jump button are drawn after, on the stage. Without a visualizer the stage-colour fade is unchanged.
- Seek bar: the thumb and the time counter show the real position (the thumb is already at the target after a seek); the fill and the fretboards animate towards it together (the fill uses the eased `shownTime`). `.seekbox.animating` keeps the thumb visible meanwhile.
- The seek thumb is hidden until hover, but `.seekbox.animating` (set from `vis.anim` in `frame()`) keeps it visible while a seek animation runs.
- A `#/song/<id>/play` link (startup, reload, hashchange) loads the audio together with the song (`loadAudioWithSong` → `ensureAudio()`), ready to press Play; browsers block sound before a click, so it does not start by itself. `#/song/<id>` (details) still loads no audio.
- Dragging the seek thumb: only the thumb (and the time label) follow the pointer; the fill keeps following the playing position (`paintSeek(t)` in `frame()`) until the button is released, when the seek happens.
- Scrub on seek: while the song plays, a long seek (> 0.75 s, animation setting on) goes through `seekTo` (app.js) → `player.scrubTo(t, ms)`: the worklet (`player-worklet.js`, helpers in `scrub.js`) rushes through the skipped stretch as short Hann grains whose source follows the same ease-out path as the fretboards, for the same duration (`seekAnimMs`, handed over by `pendingSeekDur`), then plays on from the target with a short fade-in. The chart clock (`player.currentTime()`) is the target at once during the scrub. Paused seeks, the loop wrap and the legacy engine cut immediately. Never heard in a real listening test (headless only checks the clock).
- Vocal notes view track: the note area has a nearly see-through base (0.15) and only the lyric rows (the bottom one and the harmony line above the chart) keep the 0.72 base (`renderVocals`); karaoke keeps the full base.
- Fretboard opacity: the board has a neutral black base (not the stage colour) whose opacity is `highway.trackOpacity` (0-100, default 75; `Highway.trackOpacity`, drawn in `renderLanes` and `renderLanes3D`). This replaces the removed stage-colour base.
- Links carry the instruments: `#/song/<id>/play?i=guitar:expert,bass:expert,drums-pro:expert,vocals` (the active one first, then the pinned ones; id and difficulty). `syncUrl()` runs at the end of `updateChart`; `applyInstruments` restores them when a link opens a song (`pendingInstruments`) or when the hash changes inside the same song.
- No overlay on visualizers and black protections: the visualizer is drawn as is (the Visibility slider and its pref were removed; blur stays). The stage colour is passed to effects as `s.stage` ('r, g, b') for those that want it. Readability helpers never use the stage colour any more: the vocal/lyric `trackBase`, the karaoke "already played" dimming and the sheet fades use black; the fretboard and lyric-row edge fades always erase their own layer (`destination-out`), with or without a visualizer.
- Vocal lyric track (notes view): centred on the words (±0.75 × font around the letters' middle), 0.3 opacity, and it fades out (0.2 s) while a percussion section or a rest with a countdown runs (`chart.trackFade`, driven by `countdownState`; needs the countdowns setting on).
- Fretboard base and edge fades: the edge fades erase the notes, guides and halos (`destination-out` on the pane layer), but the board's neutral black base (`trackOpacity`) is added last with `destination-over`, so it is not thinned at the top and bottom: the board no longer fades into the stage colour. The vocal lyric track is centred on `lyricY` (the words use a middle baseline).
- Edge fades again: the top fade is a transparency mask over everything, base included (the base is added before it); the bottom fade only erases the notes/guides and the board's black base stays, so it reads as a fade to black. The bottom fade is limited by the room under the pads: the pads must not move up (3D keeps 26 px under them, 2D `HIT_Y` stays 0.93).
- Pane dividers are dark (`rgba(0,0,0,0.25)`), light blue only while hovered or dragged (`drawDivider`).
- Karaoke has no vocal base layer (removed on request): the lyrics sit directly on the stage / visualizer. The notes view keeps its lyric-row track (`renderVocals`).
- Per-window options: neck speed, chart delay, 2D/3D and circles/rectangles live in each instrument's menu and only apply to that window (`Highway.paneOpts`, `setPaneOpt/paneOpt/clearPaneOpt`, applied around each pane in `drawPane`; reset when a song opens). The global neck/delay sliders were removed from the settings popover and the song panel; `highway.neck` (settings page) is the default neck speed, and the V/N keys and the global view/shape prefs set every window again. The old global `settings.chartDelay` stays at 0 now (audio/song.ini delay is separate).
- Top fade of the fretboards: shorter (3D 26% of the height, 2D 12%) with a smootherstep ramp (12 stops) so it eases at both ends.
- Vocal window: the default band height is 20 px shorter than before (alone `min(34%, 280) - 20`, with other instruments `- 40`), and in the notes view the lyric line and its track sit flush with the bottom of the window (`lyricY = h - 0.75 × font`).
- Vocal notes view: the lyric syllables have a dark outline (`strokeText` under the fill, width 0.16 × font, min 3 px).
- Vocals alone, notes view: the karaoke part under the band has no base layer either (same as karaoke mode); only the band's own lyric row keeps its track.
- The instrument tag of each window sits in its top right corner (it was top left) and its menu opens right-aligned under it (`syncPaneTags`, no `align-left` on `#paneMenu`).
- The instrument tags are more see-through: background 0.3 normally, 0.55 on hover or when open.
- 3D fretboard overlays (star power, solos, fills, rolls) are no longer cut at the hit line: the band runs down to the end of the board (`ROAD_NEAR`).
- Neck speed also works on the vocal chart, and the vocal speed is fixed in pixels: `VOCAL_PX_PER_SEC` (340 px/s, a 1000 px window shows 2.5 s) times `neck / global neck`; a wider window shows more music ahead, a narrower one less.
- The instrument tags show only the icon and the arrow; the name (with the difficulty) is the tooltip and the aria-label.
- Album art visualizer: back to the strip cloth (the two-pass organic version was rejected), but its drift uses only the song time, so it freezes when paused.
- Album art camera: it pans very slowly (periods of ~5 and ~6.5 minutes of song time) over the whole cover, including the parts cropped off screen, up to the picture's edge (`room` in `coverViz`).
- Smooth music clock: `WorkletPlayer.currentTime()` runs on the real clock between frames and is pulled towards the audio position (time constant 0.15 s; gaps over 0.1 s snap), because the raw audio clock moves in steps (worklet reports every ~12 ms, `ctx.currentTime` in audio blocks) and the notes advanced unevenly even at a high frame rate (measured clock jitter rms 4.6 ms, max 10 ms; now rms 0.5 ms, max 1.2 ms). The perf overlay (detailed) shows the "music clock jitter" line to check it (`perf.clock`).
- Micro-stutter work: the sampling heap profiler (CDP `HeapProfiler.startSampling` with `includeObjectsCollectedBy*GC`) showed ~280 KB of garbage per frame with 3 fretboards (note outlines as arrays of [x, y] pairs, colour strings rebuilt per note, a new `visible` array per pane). Now the note outlines go into one reused `Float64Array` (`gfx.js`), colour strings are cached per colour and quantised amount (`tintWhite`/`darken`/`withAlpha`), `renderLanes3D` indexes the notes instead of copying them and `taperedStrip` reuses a scratch buffer: ~35 KB per frame. The music clock also uses the animation frame's own timestamp (`player.frameNow`, jitter rms 0.3 ms). To measure again: Playwright `page.context().newCDPSession(page)` and sum `selfSize` per function after `stopSampling`. The remaining garbage is mostly the closures made on each `renderLanes3D` / `renderLanes` call.
- Vocal notes view: the harmony lyric line sits right at the top edge of the window (no margin), and the talkie boxes keep 10 px of room at the top.
- Vocal notes view without a harmony line: the pitch area starts 8 px from the top (no empty strip where the harmony lyrics would be).
- `vocalCenterY` (percussion markers and the countdown badge in the vocal notes view) now uses the same pitch area as `renderVocals` (below the harmony line, above the lyrics), so they are centred on the notes, not on the whole band.
- Top bar as a glass window: the visualizer and the stage colour are now drawn on one background canvas (`#bgCanvas`, first child of `.main`, `Highway.setBackgroundCanvas` / `drawBackground`) that sits behind both the top bar and the stage; the fretboard canvas is transparent (it is cleared, not filled) and the bar has a translucent blurred panel colour (62%), so the visualizer shows behind the bar. The stage colour is the CSS background of `.main` (`setBackground`). The bar is still full width above the stage (collapse, immersive and edge tabs unchanged), not a floating inset window.
- In the glass top bar the section selector (`.chip-btn`) has no background and the hover of the icon buttons (prev/next, tools) is a 30% translucent panel colour; the play button keeps its accent colour.
- Hide the song panel: the top bar's own button was removed (the `D` key, the edge tab and the info screen's button remain). "Hide the top bar" (`#barHide`, key B, `.app.bar-hidden`) now makes the bar compact instead of collapsing it: half the height (`--bar-h: 56px`), one row (small cover, title, transport, tools), smaller icons; the same button expands it again; the old `#barShow` tab is hidden. The glass background is 10 points more transparent (52%).
- Frame loop resilience: `frame()` in app.js schedules the next `requestAnimationFrame` first and runs each part (clock/loop, draw, pane tags, seek bar and time, perf) under `guarded(...)`, so one throwing part cannot freeze the chart or the seek bar. Errors go to `console.error` plus a small toast through `createErrorGate` (`src/errorgate.js`: a message is reported at once, the same message again at most every 5 s). `Highway.render`/`renderBlur` call `recover()` on a throw (restores `this.g`, `layered`, `vizFrame`, and resets the canvas state, so a leaked `save()`/clip cannot stick); `drawPane` restores in `finally`. Tests: `test/resilience.test.js`.
- Stem decode failures: `decodeAll` (`src/stemdecode.js`) decodes the stems one by one and skips the ones that throw (`console.warn` with the id); only if none decodes does `load()` fail (with the first error's message). Both players only know the decoded stems (worklet id list, volumes, `setVolume` of a failed id is a no-op) and expose `player.failedStems = [{ id, label, error }]`. app.js marks those `stemStates` as `failed` (row disabled, tooltip "Could not be decoded") and the ready text says "N stems could not be decoded". Not tested with a real corrupt file in the browser.
- Server hardening (`server.mjs`): binds `127.0.0.1` by default (`HOST=0.0.0.0` is an explicit opt-in for the LAN, then any Host header is accepted; while on loopback a Host that is not an IP literal, `localhost` or the machine name gets 403). App files are resolved after decoding and must be `index.html`/`styles.css` or a script/style/image under `src/` or `vendor/` (`resolveAppFile`; never dotfiles, `server.mjs`, `package*.json`, docs, `test/`, `scripts/`); `/songs` serves only song-pack extensions (`SONG_EXTS`: audio, images, charts, ini/txt/json/sng), checks `realpath` stays inside the songs folder, and sends `Content-Security-Policy: sandbox`; every response has `X-Content-Type-Options: nosniff`; 500s are logged and answered generically. Tests: `test/server-security.test.js`.
- MIDI hardening (`src/midi.js`, text helpers in `src/text.js`): `parseMidi` treats the file as hostile. VLQs are at most 4 bytes, every length is checked against the end of its track, `pos` must advance on each event, file size (64 MB) and event count (8M) are capped, division 0 and truncated tracks/events/status bytes 0xF1-0xFE throw `Error('Invalid MIDI: ...')` (app.js shows it as the load error). Text/lyric/track-name events are UTF-8 when valid, else Latin-1 (like YARG). `phraseWindows` ignores PhaseShift SysEx that is short or has a difficulty byte outside 0-3/0xFF. Out-of-spec velocity bytes with the high bit set are tolerated (a real Rock Band chart has one). Tests: `test/midi-hardening.test.js` (hostile cases run in a worker with a 2 s limit).
- Worklet start watchdog: `AudioWorklet.addModule` can stay pending forever in Chrome (the worklet thread never starts; seen as "Loading audio" stuck at 2% with an empty console, while decodeAudioData and the audio clock still work). `WorkletPlayer.setup()` gives up after `WORKLET_START_MS` (6 s) and `MultiTrackPlayer.load` falls back to the legacy ScriptProcessor player (console warning "AudioWorklet unavailable, using the legacy player"). The cause of the hang itself is not known; it went away in a fresh browser context.
- Visualizer quality (`highway.visualizerQuality`: high/medium/low = 1/0.6/0.4, default medium): the background canvas is drawn at that fraction of the resolution and stretched by the compositor (`Highway.vizScale`, `drawBackground`), because the cost of the heavy effects (Radial, Tunnel, Warp) is GPU fill rate, not JS (0.1-0.4 ms). The album art always stays at full resolution. Measured frame time at 160 Hz vsync (6.4 ms): Radial 9.0 / Tunnel 8.7 / Warp 7.2 at high, 6.8 / 7.3 / 6.3 at medium, ~6.4 at low.
- Gotcha: never put `backdrop-filter` (or `filter`/`transform`) on an element that contains `position: fixed` popovers: it becomes their containing block and they are placed relative to it (this pushed the section list far to the right and made the page scroll sideways). The glass top bar blurs through `.topbar::before` for that reason.
- The top bar no longer has a fullscreen button (the F key still toggles it); the former settings button (it only holds the speed now) has a speed gauge icon (`#i-speed`).
- Mobile top bar (≤ 700 px): extended shows the cover again (40 px) with the title row centred (the info icon stays right after the title text); compact aligns all buttons to the right.
- Mobile top bar, second pass (≤ 700 px): extended = the cover and the title/artist are one centred group; compact = icons centred vertically above the seek line, the title and artist are shown (small, left) and the prev/next section buttons are hidden to make room.
- Mobile compact bar, third pass: the title starts at the left edge (only the button group is pushed right) and the info icon (22 px) sits on the title line, with the artist below (`.now` as a 2x2 grid with `.now-text` as `display: contents`).
- Compact bar on wider screens (> 700 px): same title/info/artist arrangement as on mobile (info icon on the title line, artist below).
- Top bar content width (> 700 px): one maximum (`--bar-content-max`, 1400 px) centred through the bar's horizontal padding; the old `.tb-main` max-widths that grew with the screen are removed.
- Mobile extended bar (≤ 700 px), final layout: the cover (76 px) is on the left over both rows; the title/artist (with the info icon) are on the top row next to it and the transport on the second row; the tools (volume, speed, loop, visualizer, compact) are a 2-column grid on the right (`.tb-bottom` and `.tb-main` are `display: contents` there).
- Mobile bar, fourth pass: extended = the compact button sits alone on the last row of the right column of the tools grid and the transport (prev .. section) is centred; compact with room (≥ 440 px) shows a 40 px album art left of the title/artist.
- Mobile bar, fifth pass: the time text is shown in the extended bar and, wrapped onto two lines, in the compact one; when the main area is ≤ 520 px the section selector is icon-only (extended) or hidden (compact).
- Mobile compact bar, sixth pass: the time is two stacked lines without the slash (`.time-sep` is hidden; `#timeNow` and `#timeTotal` are blocks), 8 px from the play button, and the title is 14 px.
- Play and pause icons are solid everywhere: the document stylesheet's `svg path.fill` rule does not reach the elements inside a `<symbol>` used through `<use>`, so `#i-play` / `#i-pause` carry an inline `style="fill:currentColor;stroke:none"`. Mobile compact bar: the title is no longer capped (it only ellipsizes when the buttons need the room).
- Mobile compact bar: the right padding is 4 px (the expand button is 4 px from the edge).
- The transport block (prev .. section selector) has `margin-inline: auto` inside `.tb-bottom`: it is centred in the room left between the title and the tools (extended bar, compact bar, mobile and desktop). In the compact mobile bar the title block no longer stretches (`flex: 0 1 auto`), it only shrinks when the room runs out.
- Compact bar and narrow main area: the compact-bar rules for narrow layouts are container queries on `.main` (`@container song (max-width: 700px)`, album art from 440 px), so they also apply when the library is open and the window is 700-900 px wide; the transport block does not stretch (`flex: 0 0 auto`) so its auto margins centre it between the title and the tools, and the buttons keep their size (`flex: none`).
- Compact bar content is centred between the top edge and the seek line (padding 4/10 px) whether or not the album art is there; the extended bar's time is two lines (no slash) when the main area is under 360 px.
- Extended bar in a main area ≥ 800 px (container query): the transport is a centred two-row block (prev/play/next on top, time + section selector below, `.tp-row1` / `.tp-row2` wrappers that are `display: contents` elsewhere) between the title (up to two lines) and the tools.
- Extended bar, wide main area: the bar is a symmetric grid (cover column | title | transport | tools | an equal spacer column), so the transport is centred on the bar itself; before, it was centred inside `.tb-main`, which starts after the cover (about 56 px off). The prev/next buttons are 38 px, play 46 px, and the time + section row sits low, close to the seek bar.
