# YARG Remote — web song visualizer

Point the browser at a songs folder (e.g. `A:\music\Songs\`), see the list, pick an instrument and a
difficulty, and play the song with the chart in sync and the volume of each individual track.
Visualization only: no hit/miss detection.

## How to run

```bash
npm start            # python3 -m http.server 8080 — then open http://localhost:8080
npm test             # tests for the MIDI parser / song.ini / chart
```

- Use **Chrome or Edge** (folder selection uses the File System Access API). In other browsers the
  button falls back to `<input webkitdirectory>`, which works but does not keep the folder between sessions.
- The folder is read by the browser, not by path: the button opens the picker and you choose `A:\music\Songs`.
- Each song is a folder with `song.ini` + `notes.mid` + audio stems (`song.ogg`, `guitar.ogg`,
  `drums.ogg`, `vocals.ogg`, `bass.ogg`…). Any `.ogg/.mp3/.opus/.wav/.flac` in the folder becomes a track
  in the mixer.

## Structure

| File | Responsibility |
| --- | --- |
| `src/midi.js` | SMF parser: notes with duration, texts, lyrics (meta 0x05), SysEx, tempo map. |
| `src/ini.js` | `song.ini` parser and delay reading. |
| `src/chart.js` | YARG rules: instruments and drum modes, special notes, sections, lyrics, harmonies and percussion. |
| `src/library.js` | Scans the folder (FSA or `webkitdirectory`), builds the index and resolves files. |
| `src/store.js` | Keeps the folder and the index in IndexedDB between visits. |
| `src/player.js` | Multitrack with chart alignment, speed change without changing pitch (SoundTouch), per-stem volume. |
| `src/highway.js` | Canvas drawing (notes, sustains, pedals, rolls, vocals with lyrics). |
| `src/songlist.js` | Search, filter (instrument, genre) and sorting of the library. |
| `src/app.js` | UI, selection, sections, delays and the draw loop. |
| `vendor/` | SoundTouchJS (LGPL-2.1), no build. |
| `scripts/find-special-notes.mjs` | Finds special notes in a catalog of MIDIs. |

For whoever continues the project, `CLAUDE.md` has the current state, the YARG rules with references
and the working conventions.

## How the `.mid` is interpreted (references)

Checked against the YARG.Core code (`github.com/YARC-Official/YARG.Core`, also present in
`github.com/YARC-Official/YARG/YARG.Core`):

- **Track names** — `MoonscraperChartParser/IO/Midi/MidIOHelper.cs`: `PART GUITAR`, `PART BASS`,
  `PART RHYTHM`, `PART KEYS`, `PART DRUMS` (alias `PART DRUM`), `PART VOCALS`, `HARM1-3`, `EVENTS`, `BEAT`.
- **Difficulty by pitch** — `Song/MidiPreparsers/MidiInstrumentPreparser.cs` (`NOTES_PER_DIFFICULTY = 12`):
  Easy 60–64, Medium 72–76, Hard 84–88, Expert 96–100. Offset 0..4 = green→orange lane.
- **Guitar/bass** — `Song/MidiPreparsers/MidiFiveFretPreparser.cs`: `FIVEFRET_MIN = 59`; offset 0 is the
  green lane. *Open* notes use the `PS` sysex (`ENHANCED_OPENS`), which this MVP does not handle yet.
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

## Reuse the current YARG Remote or start from scratch?

The `gugutab/YARG_Remote` repository **is empty**: the GitHub API answers `409 Git Repository is empty`,
there are no branches and the local clone has no commits. There is no code to reuse, so the project starts from scratch
on this branch (`claude/upbeat-knuth-87adga`).

For the requested scope, starting from scratch makes sense even if there were code. YARG itself is a
Unity/C# client (`Assets/` folder) and the parsing lives in YARG.Core in C#, which does not run in the browser. Porting the chart
logic (what this project does in `src/chart.js`) is simpler than embedding the whole client.
YARG.Core serves as a format reference, not as a dependency.

## Limitations

- Only `notes.mid`; `.chart` files are not read.
- Pro guitar and bass, Pro keys and Elite Drums are not drawn.
- Open via the "enhanced opens" mode (text) is not handled; open via SysEx is.
- Drum fills, BRE and coda are not drawn; venue and lights are not either.
- Star power and solo appear as a background band, not per note.
- Audio and delays have not been checked by ear with real stems.

## Suggested next steps

1. Check sync with real stems, and the `song.ini` delay.
2. Pro guitar and bass (`PART REAL_GUITAR`, `PART REAL_BASS`).
3. `.chart` files.
4. Star power and solo per note.

## Finding examples of special notes in the catalog

```bash
node scripts/find-special-notes.mjs <folder> [--only open,accent,ghost] [--max 5] [--json]
```

Looks for `.mid` in all subfolders and shows, per song, instrument and difficulty, the time and the section of
each occurrence: open, tap, HOPO, accent, ghost, double kick, rolls, percussion and vocal harmonies, solos and star power.
At the end, a summary with the total of each category. Without `--only`, it lists all categories.

## Server with the library (no folder permission prompt)

```bash
npm start                      # node server.mjs; songs in A:\music\Songs, port 8080, all interfaces
node server.mjs D:\Musicas     # another folder (or SONGS_DIR); PORT and HOST also via environment variable
```

The server delivers the app, the index (`/api/library`, stored in `.cache/library.json`) and the files (`/songs/<path>`, with Range support). The app detects the server and opens the library on its own, in any browser (Firefox included) and on other devices on the LAN (`http://<PC-IP>:8080`), with no folder picker. The refresh button (⟳) redoes the scan. Without the server (`npm run start:static`, or static hosting) the app goes back to the browser's folder picker, described above: in Chrome/Edge on `localhost` the folder is remembered; otherwise only the list is stored.
