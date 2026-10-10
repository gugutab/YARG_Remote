#!/usr/bin/env python3
"""Turns YARG's instrument icon sheets into SVG <symbol>s (the white silhouette inside the badge -> one filled path, tinted with currentColor).

The sheets live in the YARG repository (Git LFS, LGPL-3.0, see vendor/README.md):
  https://github.com/YARC-Official/YARG/tree/master/Assets/Art/Menu/Common
Usage: python scripts/build-yarg-icons.py <InstrumentIcons.png> <HarmonyVocalsIcons.png> > symbols.html
Needs numpy and Pillow. The output goes into the <svg> sprite at the top of index.html.
"""
import sys
import numpy as np
from PIL import Image

CELL = 512
# (symbol id, sheet, column, row from the TOP). Names follow the Unity sprite metadata of the sheets.
ICONS = [
    ('guitar', 0, 1, 0),   # guitar
    ('bass', 0, 0, 0),     # bass
    ('drum', 0, 2, 0),     # drums
    ('keys', 0, 3, 0),     # keys
    ('mic', 0, 0, 2),      # vocals
    ('harmony', 0, 1, 2),  # harmVocals
    ('rhythm', 0, 0, 3),   # rhythm
]
INNER_RADIUS = 216  # the badge's white ring lies outside this radius (of 256): it is dropped, only the silhouette stays
GRID = 128          # the 512 px cell is averaged down to GRID x GRID before tracing
EPSILON = 0.35      # Douglas-Peucker tolerance, in grid units


def field(sheet, col, row):
    cell = sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL)).convert('RGBA')
    a = np.asarray(cell, dtype=np.float32) / 255.0
    f = a[..., 3] * a[..., :3].mean(axis=2)  # "white" where opaque and bright
    yy, xx = np.mgrid[0:CELL, 0:CELL]
    r = np.hypot(xx + 0.5 - CELL / 2, yy + 0.5 - CELL / 2)
    f = f * np.clip(INNER_RADIUS - r + 0.5, 0, 1)  # cut the ring off (anti-aliased edge)
    k = CELL // GRID
    f = f.reshape(GRID, k, GRID, k).mean(axis=(1, 3))
    return np.pad(f, 1)  # a zero border so every contour closes


def trace(f, level=0.5):
    h, w = f.shape
    inside = f >= level

    def cross(p, q, vp, vq):  # linear interpolation of the crossing between two grid points
        t = (level - vp) / (vq - vp) if vq != vp else 0.5
        return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)

    def edge_point(kind, i, j):
        if kind == 'h':  # between (i, j) and (i + 1, j)
            return cross((i, j), (i + 1, j), f[j, i], f[j, i + 1])
        return cross((i, j), (i, j + 1), f[j, i], f[j + 1, i])  # 'v': between (i, j) and (i, j + 1)

    segs = {
        1: [('L', 'T')], 2: [('T', 'R')], 3: [('L', 'R')], 4: [('R', 'B')], 6: [('T', 'B')], 7: [('L', 'B')],
        8: [('L', 'B')], 9: [('T', 'B')], 11: [('R', 'B')], 12: [('L', 'R')], 13: [('T', 'R')], 14: [('L', 'T')],
    }
    adj = {}
    for j in range(h - 1):
        for i in range(w - 1):
            case = (1 if inside[j, i] else 0) | (2 if inside[j, i + 1] else 0) | (4 if inside[j + 1, i + 1] else 0) | (8 if inside[j + 1, i] else 0)
            if case in (0, 15):
                continue
            if case == 5:
                center = (f[j, i] + f[j, i + 1] + f[j + 1, i + 1] + f[j + 1, i]) / 4 >= level
                pairs = [('T', 'R'), ('L', 'B')] if center else [('L', 'T'), ('R', 'B')]
            elif case == 10:
                center = (f[j, i] + f[j, i + 1] + f[j + 1, i + 1] + f[j + 1, i]) / 4 >= level
                pairs = [('L', 'T'), ('R', 'B')] if center else [('T', 'R'), ('L', 'B')]
            else:
                pairs = segs[case]
            key = {'T': ('h', i, j), 'B': ('h', i, j + 1), 'L': ('v', i, j), 'R': ('v', i + 1, j)}
            for a, b in pairs:
                adj.setdefault(key[a], []).append(key[b])
                adj.setdefault(key[b], []).append(key[a])
    loops = []
    seen = set()
    for start in adj:
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        prev, cur = None, start
        while True:
            nxt = [n for n in adj[cur] if n != prev] or adj[cur]
            n = nxt[0]
            if n == start or n in seen:
                break
            loop.append(n)
            seen.add(n)
            prev, cur = cur, n
        loops.append([edge_point(*k) for k in loop])
    return loops


def simplify(points, eps):
    """Douglas-Peucker on a closed loop (split at the two farthest points)."""
    if len(points) < 4:
        return points
    pts = np.array(points)
    i0 = 0
    i1 = int(np.argmax(np.linalg.norm(pts - pts[0], axis=1)))

    def dp(a, b):
        if b - a < 2:
            return [a]
        p, q = pts[a], pts[b]
        d = q - p
        n = np.hypot(*d) or 1e-9
        dist = np.abs(d[0] * (pts[a + 1:b, 1] - p[1]) - d[1] * (pts[a + 1:b, 0] - p[0])) / n
        k = int(np.argmax(dist))
        if dist[k] > eps:
            m = a + 1 + k
            return dp(a, m) + dp(m, b)
        return [a]

    first = dp(i0, i1)
    pts2 = np.concatenate([pts[i1:], pts[:i0 + 1]]) if i1 else pts
    # second half: from i1 back around to the start
    ring = np.concatenate([pts[i1:], pts[:1]])
    pts_save, pts = pts, ring
    second = [i1 + k for k in dp(0, len(ring) - 1)]
    pts = pts_save
    idx = sorted(set(first + second))
    return [tuple(pts[i]) for i in idx]


def path_for(f):
    """Returns (path data, viewBox) with the viewBox a square around the silhouette."""
    d = []
    scale = CELL / GRID
    xs, ys = [], []
    for loop in trace(f):
        loop = simplify(loop, EPSILON)
        if len(loop) < 3:
            continue
        pts = [((x - 1) * scale, (y - 1) * scale) for x, y in loop]  # undo the 1-cell padding
        xs += [p[0] for p in pts]
        ys += [p[1] for p in pts]
        d.append('M' + 'L'.join(f'{x:.0f} {y:.0f}' for x, y in pts) + 'Z')
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    side = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.04  # 2% of breathing room on each side
    return ''.join(d), f'{cx - side / 2:.0f} {cy - side / 2:.0f} {side:.0f} {side:.0f}'


def main():
    sheets = [Image.open(p) for p in sys.argv[1:3]]
    for name, sheet_index, col, row in ICONS:
        d, box = path_for(field(sheets[sheet_index], col, row))
        print(f'      <symbol id="i-{name}" viewBox="{box}"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="{d}"/></symbol>')


if __name__ == '__main__':
    main()
