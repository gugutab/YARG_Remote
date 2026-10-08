#!/usr/bin/env node
// Finds special notes in .mid files under a folder (recursively), to pick test examples.
//
//   node scripts/find-special-notes.mjs <folder> [--max N] [--json]
//
// For each song it reports, per instrument and difficulty, where these occur, with the time and the
// section playing at that time:
//   open, tap, HOPO, accent, ghost, double kick, drum rolls (tremolo / trill / kick roll),
//   vocal percussion (played / not played), vocal harmonies, solo and star power spans.
// --max N caps how many occurrences are listed per category per song (default 5); counts are always full.
// --json prints one JSON object per occurrence group instead of text.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseMidi } from '../src/midi.js';
import { buildChart, instrumentOptions, availableDifficulties, sectionIndexAt, DIFFICULTIES } from '../src/chart.js';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
const maxPerCategory = Number(valueOf('--max') ?? 5);
const asJson = args.includes('--json');
// --only open,accent,ghost keeps just the categories whose name starts with one of these words
const only = valueOf('--only')?.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
const wanted = (category) => !only || only.some((w) => category.toLowerCase().startsWith(w));
const catalogTotals = new Map();

if (!root) {
  console.error('usage: node scripts/find-special-notes.mjs <folder> [--max N] [--json]');
  process.exit(1);
}

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function* midiFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* midiFiles(path);
    else if (name.toLowerCase().endsWith('.mid')) yield path;
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(2).padStart(5, '0')}`;
}

function scanSong(path) {
  const midi = parseMidi(readFileSync(path));
  const rows = [];
  let sections = [];

  const add = (category, instrument, difficulty, time, extra = {}) => {
    rows.push({ category, instrument, difficulty, time, ...extra });
  };

  for (const option of instrumentOptions(midi)) {
    for (const difficulty of availableDifficulties(midi, option)) {
      const chart = buildChart(midi, option, difficulty);
      if (!chart) continue;
      if (sections.length === 0) sections = chart.sections;
      const who = { instrument: option.label, difficulty: difficulty.label };

      if (chart.mode === 'vocals') {
        for (const p of chart.percussion) add(p.played ? 'percussion (played)' : 'percussion (not played)', who.instrument, who.difficulty, p.time);
        for (const h of chart.harmonies) {
          // one row per harmony part, at its first note, with the note count
          if (h.notes.length) add(`harmony HARM${h.part}`, who.instrument, who.difficulty, h.notes[0].time, { count: h.notes.length });
        }
        continue;
      }

      for (const n of chart.notes) {
        if (n.open) add('open note', who.instrument, who.difficulty, n.time);
        if (n.tap) add('tap', who.instrument, who.difficulty, n.time);
        if (n.hopo) add('HOPO', who.instrument, who.difficulty, n.time);
        if (n.accent) add('accent', who.instrument, who.difficulty, n.time);
        if (n.ghost) add('ghost', who.instrument, who.difficulty, n.time);
        if (n.doubleKick) add('double kick', who.instrument, who.difficulty, n.time);
      }
      for (const r of chart.rolls ?? []) add(`roll (${r.type})`, who.instrument, who.difficulty, r.start, { end: r.end });
      for (const s of chart.solos) add('solo', who.instrument, who.difficulty, s.start, { end: s.end });
      for (const s of chart.starPower) add('star power', who.instrument, who.difficulty, s.start, { end: s.end });
    }
  }

  return { sections, rows };
}

function sectionAt(sections, time) {
  const i = sectionIndexAt(sections, time);
  return i >= 0 ? sections[i].name : '(sem seção)';
}

const files = [...midiFiles(root)];
let totalFiles = 0;
let totalFound = 0;
for (const path of files) {
  const name = relative(root, path);
  let result;
  try {
    result = scanSong(path);
  } catch (err) {
    console.error(`! ${name}: ${err.message}`);
    continue;
  }
  totalFiles++;
  const { sections, rows } = result;
  if (rows.length === 0) continue;

  // group by category, counting all and keeping up to --max examples
  const byCategory = new Map();
  for (const row of rows) {
    if (!wanted(row.category)) continue;
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  if (asJson) {
    const out = { file: name, categories: {} };
    for (const [category, list] of byCategory) {
      out.categories[category] = {
        count: list.length,
        examples: list.slice(0, maxPerCategory).map((r) => ({
          instrument: r.instrument, difficulty: r.difficulty, time: Number(r.time.toFixed(2)),
          end: r.end !== undefined ? Number(r.end.toFixed(2)) : undefined,
          section: sectionAt(sections, r.time), count: r.count,
        })),
      };
      totalFound += list.length;
    }
    console.log(JSON.stringify(out));
    continue;
  }

  console.log(`\n== ${name}`);
  for (const [category, list] of byCategory) catalogTotals.set(category, (catalogTotals.get(category) ?? 0) + list.length);
  for (const [category, list] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    totalFound += list.length;
    console.log(`  ${category}: ${list.length}`);
    for (const r of list.slice(0, maxPerCategory)) {
      const span = r.end !== undefined ? ` até ${formatTime(r.end)}` : '';
      const extra = r.count ? ` (${r.count} notas)` : '';
      console.log(`    ${formatTime(r.time)}${span} · seção: ${sectionAt(sections, r.time)} · ${r.instrument} ${r.difficulty}${extra}`);
    }
    if (list.length > maxPerCategory) console.log(`    ... mais ${list.length - maxPerCategory}`);
  }
}

if (!asJson) {
  console.log('\nResumo (ocorrências em todos os arquivos):');
  for (const [category, count] of [...catalogTotals].sort((a, b) => b[1] - a[1])) console.log(`  ${category}: ${count}`);
  console.log(`\n${totalFiles} arquivo(s) lidos, ${totalFound} ocorrência(s).`);
}
