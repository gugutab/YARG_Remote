# YARG Remote — web song visualizer

Point the browser at a songs folder (e.g. `A:\music\Songs\`), see the list, pick an instrument and a
difficulty, and play the song with the chart in sync and the volume of each individual track.
Visualization only: no hit/miss detection.

## How to run

```bash
npm run start:static  # python -m http.server 8080 --bind 127.0.0.1 (python3 where `python` does not exist) — then open http://localhost:8080 (folder picker only)
npm start             # node server.mjs [songs folder]: the app plus your songs, no folder picker (see "Server with the library")
npm test             # unit tests (MIDI / chart / song.ini / settings / server hardening ...), no browser
npm run smoke        # starts server.mjs on a free port over a tiny synthetic song and checks the app, library and path-traversal refusals
```

- Use **Chrome or Edge** (folder selection uses the File System Access API). In other browsers the
  button falls back to `<input webkitdirectory>`, which works but does not keep the folder between sessions.
- The folder is read by the browser, not by path: the button opens the picker and you choose `A:\music\Songs`.
- A song can also be a single `.sng` file (metadata, chart, stems and cover packed together; the plain public format, not YARG's encrypted variant).
- Each song is a folder with `song.ini` + `notes.mid` (or `notes.chart`) + audio stems (`song.ogg`, `guitar.ogg`,
  `drums.ogg`, `vocals.ogg`, `bass.ogg`…). Any `.ogg/.mp3/.opus/.wav/.flac` in the folder becomes a track
  in the mixer.

## Structure

The app is plain HTML + ES modules under `src/`, with no build step. `CLAUDE.md` §4 lists every file with its
role (and the test suites); in short: `midi.js`, `chartfile.js` and `sng.js` parse songs, `chart.js` applies the YARG
rules, `highway.js` / `highway3d.js` draw, `player.js` plays the stems, `library.js` and `server.mjs` find the songs,
`settings-*.js` and `themes.js` hold the settings. `vendor/` has SoundTouchJS (LGPL-2.1) and
`scripts/find-special-notes.mjs` searches a catalog of MIDIs.

For whoever continues the project, `CLAUDE.md` has the current state, the YARG rules with references
and the working conventions.

## Features and keys

- **Deep links:** `#/song/<id>` opens a song's details and `#/song/<id>/play` its chart. A `play?i=guitar:expert,bass:expert,drums-pro:expert,vocals`
  suffix (`#/song/<id>/play?i=...`) lists the instruments and difficulties on screen; the first one is the active one.
- **Settings and themes:** the gear (or `,`) opens Settings: themes (presets and a studio), fonts, the library cards,
  song details, panels, the highway (background visualizers, fretboard opacity, neck speed, countdowns), a performance overlay
  and a settings backup (export / import / reset).
- **Shortcuts:** all of them are editable in Settings -> Shortcuts, which also shows the defaults (play / pause, seek,
  sections, loop, fretboard windows, 2D / 3D, karaoke, visualizers, library, details, bar, full screen, settings).
- **A-B loop:** the loop button (key `R`) starts a loop around the current section; drag its two handles on the seek bar
  (they snap to section starts) to adjust it.
- **Environment variables** (server): `SONGS_DIR`, `PORT`, `HOST`, `CACHE_DIR` (see "Server with the library").
- **Tests:** `npm test` (unit tests, no browser) and `npm run smoke` (the server end to end).

## How the `.mid` is interpreted (references)

Checked against the YARG.Core code (`github.com/YARC-Official/YARG.Core`, also present in
`github.com/YARC-Official/YARG/YARG.Core`):

- **Track names** — `MoonscraperChartParser/IO/Midi/MidIOHelper.cs`: `PART GUITAR`, `PART BASS`,
  `PART RHYTHM`, `PART KEYS`, `PART DRUMS` (alias `PART DRUM`), `PART VOCALS`, `HARM1-3`, `EVENTS`, `BEAT`.
- **Difficulty by pitch** — `Song/MidiPreparsers/MidiInstrumentPreparser.cs` (`NOTES_PER_DIFFICULTY = 12`):
  Easy 60–64, Medium 72–76, Hard 84–88, Expert 96–100. Offset 0..4 = green→orange lane.
- **Guitar/bass** — `Song/MidiPreparsers/MidiFiveFretPreparser.cs`: `FIVEFRET_MIN = 59`; offset 0 is the
  green lane. *Open* notes use the `PS` sysex or the `[ENHANCED_OPENS]` text event (the note below each difficulty's green); both are supported.
- **Drums** — `Song/MidiPreparsers/MidiDrumsPreparser.cs` and `MidReader.ProcessLists.cs`: 101 = 5-lane
  drums (100 = orange, 101 = green); 110/111/112 = tom markers for yellow/blue/green (pitch 98/99/100): on those lanes the note is a cymbal by default, and an active marker turns it into a tom,
  from the marker's note-on to its note-off, in Pro and 5-lane drums. Without 101 and with 110–112 = Pro; with neither = 4 lanes.
- **Specials** — `MidIOHelper.cs`: `103` = solo, `116` = star power, `12`/`13` = measure/beat in the
  `BEAT` track, `105` = lyric phrase in vocals.
- **Vocals** — range 36–84 are the notes; text that does not start with `[` is a lyric.
- **Tempo** — `Chart/Sync/SyncTrack.cs`: tempo changes (meta `0x51`) integrated tick by tick
  (`midi.js` does the same in `createTickToSeconds`).
- **song.ini** — `IO/Ini/SongIniHandler.cs`: list of keys (`name`, `artist`, `song_length`,
  `diff_*`, `delay`…). The MVP reads `name`, `artist`, `album`, `delay`/`delay_seconds` and the raw values of `diff_*`.
- **Delay** — `SongMetadata.cs` and `SongRunner.cs`: the audio position is `chart_time + delay`. The player aligns each
  stem once at load time (`alignChannel`, `src/player.js`): a positive delay discards the start of the file, a negative one
  puts silence in front.

### Verification with the sample file

With the Aerosmith `notes.mid` — "Toys in the Attic" (outside the repository):

- Tracks: `notes`, `PART DRUMS`, `PART GUITAR`, `PART BASS`, `PART VOCALS`, `HARM1-3`, `EVENTS`, `BEAT`.
- Computed duration: 191.43 s (`song_length` in `song.ini`: 191.726 s).
- Expert drums: 531/311/264/196/98 notes per pitch 96–100 — identical to the raw count.
- Expert guitar: 1000 notes, 154 sustains, 2 solos (103), 13 star power (116), 12 sections.
- No `PART RHYTHM`/`PART KEYS` in the file: those instruments do not appear in the list.

## Limitations

The current list of what is and is not supported, and what has never been checked by ear, is in `CLAUDE.md` §2 and §10.
In short: no hit/miss detection; no Pro guitar, bass or keys and no Elite Drums; star power and solo are a background
band (star power also recolours its notes); audio sync and the delays have not been checked by ear with real stems.

## Finding examples of special notes in the catalog

```bash
node scripts/find-special-notes.mjs <folder> [--only open,accent,ghost] [--max 5] [--json]
```

Looks for `.mid` in all subfolders and shows, per song, instrument and difficulty, the time and the section of
each occurrence: open, tap, HOPO, accent, ghost, double kick, rolls, percussion and vocal harmonies, solos and star power.
At the end, a summary with the total of each category. Without `--only`, it lists all categories.

## Server with the library (no folder permission prompt)

```bash
npm start                      # node server.mjs; songs in A:\music\Songs, port 8080, this machine only (127.0.0.1)
node server.mjs D:\Musicas     # another folder (or SONGS_DIR); PORT and HOST also via environment variable
HOST=0.0.0.0 npm start         # explicit opt-in: also serve other devices on the LAN (anyone on the network can then read the app and the songs folder)
```

The server delivers the app, the index (`/api/library`, stored in `.cache/library.json`) and the files (`/songs/<path>`, with Range support). The app detects the server and opens the library on its own, in any browser (Firefox included) and, when started with `HOST=0.0.0.0`, on other devices on the LAN (`http://<PC-IP>:8080`), with no folder picker. By default the server binds `127.0.0.1` only and, while bound to loopback, refuses requests whose `Host` header is not an IP, `localhost` or the machine name (DNS-rebinding guard). `/songs` only serves song-pack file types (audio, images, charts, ini/txt/json), never html/js/css/svg. The refresh button (⟳) redoes the scan. Without the server (`npm run start:static`, or static hosting) the app goes back to the browser's folder picker, described above: in Chrome/Edge on `localhost` the folder is remembered; otherwise only the list is stored.

## Licence

- `vendor/soundtouch.js` is SoundTouchJS 0.1.30, licensed LGPL-2.1 (see `vendor/SOUNDTOUCH-LICENSE.txt`).
- The instrument icons in `index.html` are traced from YARG's icon sheet (LGPL-3.0, see `vendor/README.md`).
- No licence has been chosen yet: all rights reserved until the owner adds a LICENSE file.
