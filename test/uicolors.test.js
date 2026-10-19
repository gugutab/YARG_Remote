import test from 'node:test';
import assert from 'node:assert/strict';
import { mixHex, shiftHue, countdownColors, vocalColors, isHex } from '../src/uicolors.js';

const theme = { accent: '#2f80ed', text: '#e6edf3', muted: '#8b949e', panel: '#161b22' };

test('mixHex and shiftHue', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#ff0000', '#ff0000', 0.3), '#ff0000');
  assert.equal(shiftHue('#888888', 90), '#888888'); // a grey has no hue
  assert.equal(shiftHue('#ff0000', 120), '#00ff00');
  assert.equal(shiftHue('#ff0000', 360), '#ff0000');
});

test('classic modes keep the old fixed colours, whatever the theme', () => {
  assert.equal(countdownColors('classic', '', theme).ring, '#6cb6ff');
  assert.equal(vocalColors('classic', '', theme).lead, '#5b8def');
  assert.equal(vocalColors('classic', '', theme).lyrics[1], '#13f0a6');
});

test('theme mode derives from the theme, custom from the picked colour', () => {
  assert.equal(countdownColors('theme', '#ff0000', theme).ring, theme.accent); // the picked colour is ignored in theme mode
  assert.equal(vocalColors('theme', '#ff0000', theme).lead, theme.accent);
  assert.equal(countdownColors('custom', '#ff0000', theme).ring, '#ff0000');
  assert.equal(vocalColors('custom', '#ff0000', theme).lead, '#ff0000');
  assert.equal(vocalColors('custom', 'nope', theme).lead, theme.accent); // an invalid colour falls back to the theme's
  const v = vocalColors('theme', '', theme);
  assert.equal(v.lyrics[0], theme.text);
  assert.ok([1, 2, 3].every((p) => isHex(v.harmony[p])));
  assert.notEqual(v.harmony[1], v.harmony[2]);
  assert.equal(countdownColors('theme', '', theme).text, theme.text);
});

test('the unsung lyric colours stay the Dark theme ones, the sung colour follows the accent', () => {
  const light = { accent: '#d33682', text: '#111111', muted: '#666666', panel: '#ffffff' };
  const a = vocalColors('theme', '', theme);
  const b = vocalColors('theme', '', light);
  const c = vocalColors('custom', '#e08a1e', light);
  assert.equal(a.lyrics[0], '#e6edf3'); // the words keep the dark theme's colour in every theme
  assert.equal(b.lyrics[0], a.lyrics[0]);
  assert.equal(c.lyrics[2], a.lyrics[2]);
  assert.notEqual(a.lyrics[1], b.lyrics[1]); // the sung part follows the theme's accent
  assert.notEqual(b.lyrics[1], c.lyrics[1]); // ...or the picked colour
  assert.equal(b.present, b.lyrics[1]);
  assert.notEqual(a.lead, b.lead); // the notes follow the theme
});
