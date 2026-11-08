#!/usr/bin/env python3
"""Bake the Blender character GLB into runtime JS (PHASE 1).

Reuses the GLB reader from scripts/bake-kenney.py (load_glb, read_acc,
matrix helpers). Unlike the house bake (which keeps world-space
geometry for instancing), this bake subtracts the absolute pivot per
part, so the output geometry is PIVOT-LOCAL: phase 2 positions each
mesh at its pivot with the exact same position values character.js
uses today, and only swaps the geometry arrays.

Pivots (group space, from js/character.js):
  legL (-0.14, 0.85, 0), legR (0.14, 0.85, 0)   (leg pivot groups)
  torso (0, 1.20, 0), head (0, 1.85, 0), hat (0, 2.07, 0)
  armL (-0.34, 1.50, 0), armR (0.34, 1.50, 0)   (shoulder pivots)
Phase-2 frames (recorded in the JS as `pivots`): legs in group
space; torso/head/hat/arms in body space (body group at y=0.85):
  torso (0, 0.35, 0), head (0, 1.0, 0), hat (0, 1.22, 0),
  armL (-0.34, 0.65, 0), armR (0.34, 0.65, 0).

Material rule: 'shirt' -> WHITE (1,1,1) vertex colours, the
recolour marker phase 2 recolorShirt must remap to the player's
colour. Every other material keeps its modelled (linear) colour.
The bake asserts white appears ONLY in torso/armL/armR.

Checks (all asserted, bake fails loudly otherwise):
  0 NaN/inf, 0 degenerate triangles, feet exactly on the ground
  (character-space min y == 0), total height ~2.36 (pompom top),
  face features (eye/nose material) on the +z front, pivot-local
  ranges sane per part, total tris <= 2,640 (audit boots 41 players).

Usage: python3 bake-character.py
Writes: js/vendor/character-blender.js
"""
import importlib.util
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GLB = os.path.join(ROOT, 'vendor-src', 'character', 'character.glb')

spec = importlib.util.spec_from_file_location(
    'bake_kenney', os.path.join(HERE, 'bake-kenney.py'))
bk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bk)

PARTS = ('legL', 'legR', 'torso', 'head', 'hat', 'armL', 'armR')

# Absolute pivots in group space (subtracted during bake).
ABS_PIVOT = {
    'legL': (-0.14, 0.85, 0.0),
    'legR': (0.14, 0.85, 0.0),
    'torso': (0.0, 1.20, 0.0),
    'head': (0.0, 1.85, 0.0),
    'hat': (0.0, 2.07, 0.0),
    'armL': (-0.34, 1.50, 0.0),
    'armR': (0.34, 1.50, 0.0),
}

# Pivots as phase 2 will use them (legs in group space, the rest in
# body space with the body group at y=0.85).
PIVOTS = {
    'legL': (-0.14, 0.85, 0.0),
    'legR': (0.14, 0.85, 0.0),
    'torso': (0.0, 0.35, 0.0),
    'head': (0.0, 1.0, 0.0),
    'hat': (0.0, 1.22, 0.0),
    'armL': (-0.34, 0.65, 0.0),
    'armR': (0.34, 0.65, 0.0),
}

# Generous pivot-local sanity ranges (min_y, max_y) per part.
Y_RANGE = {
    'legL': (-0.90, 0.05),
    'legR': (-0.90, 0.05),
    'torso': (-0.50, 0.55),
    'head': (-0.35, 0.35),
    'hat': (-0.20, 0.35),
    'armL': (-0.85, 0.15),
    'armR': (-0.85, 0.15),
}

TRI_BUDGET = 2640


def is_white(c):
    return all(abs(v - 1.0) < 0.01 for v in c)


def bake():
    doc, binchunk = bk.load_glb(GLB)
    nodes = doc.get('nodes', [])
    scenes = doc.get('scenes', [])
    roots = scenes[doc.get('scene', 0)]['nodes'] if scenes else list(range(len(nodes)))
    buckets = {p: {'pos': [], 'nor': [], 'col': [], 'index': []} for p in PARTS}
    # Character-space (pre-pivot-subtraction) extents + face check.
    all_y, face_z, white_parts = [], [], set()
    stack = [(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) for r in roots]
    while stack:
        ni, parent = stack.pop()
        node = nodes[ni]
        local = node['matrix'] if 'matrix' in node else bk.mat4_from_trs(node)
        world = bk.mat4_mult(parent, local)
        if 'mesh' in node:
            name = node.get('name', '')
            part = name.split('_')[0] if '_' in name else name
            assert part in PARTS, f'unexpected node {name!r} (want <part>_<detail>)'
            out = buckets[part]
            base = len(out['pos']) // 3
            px, py, pz = ABS_PIVOT[part]
            mesh = doc['meshes'][node['mesh']]
            for prim in mesh['primitives']:
                mat = doc['materials'][prim.get('material', 0)]
                mat_name = mat.get('name', '')
                rgb = mat.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3]
                positions = bk.read_acc(doc, binchunk, prim['attributes']['POSITION'])
                normals = bk.read_acc(doc, binchunk, prim['attributes']['NORMAL'])
                for p, n in zip(positions, normals):
                    wp = bk.apply_mat(world, p)
                    wn = bk.apply_normal(world, n)
                    for v in list(wp) + list(wn):
                        assert v == v and abs(v) != float('inf'), f'{name}: NaN/inf'
                    all_y.append(wp[1])
                    if mat_name in ('eye',):
                        face_z.append(wp[2])
                    col = (1.0, 1.0, 1.0) if mat_name == 'shirt' else rgb
                    if is_white(col):
                        white_parts.add(part)
                    # Pivot-local position; normals keep world rotation.
                    out['pos'].extend(round(c, 4) for c in (wp[0] - px, wp[1] - py, wp[2] - pz))
                    out['nor'].extend(round(c, 4) for c in wn)
                    out['col'].extend(round(c, 4) for c in col)
                if 'indices' in prim:
                    for (i,) in bk.read_acc(doc, binchunk, prim['indices']):
                        out['index'].append(base + i)
                else:
                    out['index'].extend(range(base, base + len(positions)))
        for child in node.get('children', []):
            stack.append((child, world))
    # ---- checks ----
    tris = {}
    for part in PARTS:
        b = buckets[part]
        assert b['pos'], f'{part}: empty bucket'
        assert len(b['index']) % 3 == 0, f'{part}: index count not a multiple of 3'
        pos = b['pos']
        degen = 0
        for t in range(0, len(b['index']), 3):
            ia, ib, ic = b['index'][t:t + 3]
            ax, ay, az = pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]
            bx, by, bz = pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]
            cx, cy, cz = pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]
            ux, uy, uz = bx - ax, by - ay, bz - az
            vx, vy, vz = cx - ax, cy - ay, cz - az
            cr = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
            if math.sqrt(cr[0] ** 2 + cr[1] ** 2 + cr[2] ** 2) < 1e-12:
                degen += 1
        assert degen == 0, f'{part}: {degen} degenerate triangles'
        ys = [pos[i + 1] for i in range(0, len(pos), 3)]
        lo, hi = Y_RANGE[part]
        assert min(ys) >= lo and max(ys) <= hi, \
            f'{part}: pivot-local y {min(ys):.3f}..{max(ys):.3f} outside {lo}..{hi}'
        tris[part] = len(b['index']) // 3
    total = sum(tris.values())
    min_y, max_y = min(all_y), max(all_y)
    print(f'character-space y: {min_y:.4f}..{max_y:.4f} '
          f'(feet 0, pompom top ~2.36)')
    assert abs(min_y) < 0.002, f'feet not on ground: min y {min_y}'
    assert abs(max_y - 2.36) < 0.05, f'height {max_y}, want ~2.36'
    assert face_z and max(face_z) > 0.2, 'face not on +z front'
    assert white_parts == {'torso', 'armL', 'armR'}, \
        f'white shirt marker in {sorted(white_parts)}, want torso/armL/armR only'
    for part in PARTS:
        print(f'  {part:6s} tris={tris[part]:5d}')
    print(f'  TOTAL  tris={total:5d} (budget {TRI_BUDGET})')
    assert total <= TRI_BUDGET, f'over budget: {total} > {TRI_BUDGET}'
    return buckets, tris, total


def main():
    buckets, tris, total = bake()
    parts_js = []
    for part in PARTS:
        b = buckets[part]
        parts_js.append(
            f"    {part}: {{ pos: [{bk.fmt_nums(b['pos'])}], "
            f"nor: [{bk.fmt_nums(b['nor'])}], "
            f"col: [{bk.fmt_nums(b['col'])}], "
            f"index: [{','.join(str(i) for i in b['index'])}] }}")
    piv_js = ',\n'.join(
        f"  {p}: [{PIVOTS[p][0]}, {PIVOTS[p][1]}, {PIVOTS[p][2]}]" for p in PARTS)
    tris_js = ',\n'.join(f"  {p}: {tris[p]}" for p in PARTS) + f",\n  total: {total}"
    lines = [
        '// Baked Blender character (walker scale, metres, pivot-local',
        '// geometry). Generated by scripts/bake-character.py from',
        '// vendor-src/character/character.glb — do not edit by hand.',
        '//',
        '// Pivot-local means: phase 2 positions each mesh at its PIVOT',
        '// (same values as js/character.js today) and uses this geometry',
        '// as-is. Legs/arms pivot at hip/shoulder so walk/run swing',
        '// rotations work unchanged. Shirt parts carry WHITE vertex',
        '// colours: phase 2 recolorShirt must remap white (not the old',
        '// shirt colour) to the player colour; no other part has white.',
        'export const CHARACTER_BLENDER = {',
        '  pivots: {',
        piv_js,
        '  },',
        '  parts: {',
        ',\n'.join(parts_js),
        '  },',
        '};',
        'export const CHARACTER_BLENDER_TRIS = {',
        tris_js,
        '};',
        '',
    ]
    out = os.path.join(ROOT, 'js', 'vendor', 'character-blender.js')
    with open(out, 'w') as f:
        f.write('\n'.join(lines))
    print(f'wrote {out} ({os.path.getsize(out)//1024} KiB)')


if __name__ == '__main__':
    main()
