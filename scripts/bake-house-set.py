#!/usr/bin/env python3
"""Bake the 13 Blender house models + the 47-plot assignment.

Reuses the GLB reader from scripts/bake-kenney.py (load_glb, read_acc,
matrix helpers) but keeps primitives separate so each model splits
into three runtime meshes by material:
  'wall' -> walls mesh (vertex colours forced white: per-plot tint)
  'roof' -> roof mesh  (vertex colours forced white: per-plot tint)
  else   -> details mesh (material colours as modelled)
The glTF exporter already converted Blender Z-up to glTF Y-up, so
fronts built at Blender -Y arrive at game +Z (verified per model by
the door-colour check below).

Assignment (deterministic, Random(7)): plots in the same gx/gz order
as world.js, skipping the plaza (0,0) and the sample plot (0,-14).
Towers (18%) get tall models, inner-ring plots (50%) get shop models,
the rest get house models. A neighbour-contrast rule retries the
pick when the model AND wall tint match the left or upper neighbour.

Usage: python3 bake-house-set.py
Writes: js/vendor/house-set.js + vendor-src/houses/assignment.json
"""
import importlib.util
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HOUSES = os.path.join(ROOT, 'vendor-src', 'houses')

spec = importlib.util.spec_from_file_location(
    'bake_kenney', os.path.join(HERE, 'bake-kenney.py'))
bk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bk)

DOOR_RGB = (0.420, 0.259, 0.149)
WALL_TINTS = ['#f2e2c4', '#f2d98c', '#e8c0b0', '#b8c8a8',
              '#a8c0d0', '#d8c0a0', '#b0d0b8', '#c8c0d0']
ROOF_TINTS = ['#b08060', '#7a7a80', '#8a6a5a', '#7a8a6a', '#a06050', '#5a5a60']


def bake_split(path):
    """Return {walls, roof, details} geometries + door-front check."""
    doc, binchunk = bk.load_glb(path)
    nodes = doc.get('nodes', [])
    scenes = doc.get('scenes', [])
    roots = scenes[doc.get('scene', 0)]['nodes'] if scenes else list(range(len(nodes)))
    buckets = {k: {'pos': [], 'nor': [], 'col': [], 'index': []}
               for k in ('walls', 'roof', 'details')}
    door_z = []
    stack = [(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) for r in roots]
    while stack:
        ni, parent = stack.pop()
        node = nodes[ni]
        local = node['matrix'] if 'matrix' in node else bk.mat4_from_trs(node)
        world = bk.mat4_mult(parent, local)
        if 'mesh' in node:
            mesh = doc['meshes'][node['mesh']]
            for prim in mesh['primitives']:
                mat = doc['materials'][prim.get('material', 0)]
                name = mat.get('name', '')
                rgb = mat.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3]
                bucket = 'walls' if name == 'wall' else 'roof' if name == 'roof' else 'details'
                out = buckets[bucket]
                base = len(out['pos']) // 3
                positions = bk.read_acc(doc, binchunk, prim['attributes']['POSITION'])
                normals = bk.read_acc(doc, binchunk, prim['attributes']['NORMAL'])
                for p, n in zip(positions, normals):
                    wp = bk.apply_mat(world, p)
                    wn = bk.apply_normal(world, n)
                    out['pos'].extend(round(c, 4) for c in wp)
                    out['nor'].extend(round(c, 4) for c in wn)
                    col = (1.0, 1.0, 1.0) if bucket in ('walls', 'roof') else rgb
                    out['col'].extend(round(c, 4) for c in col)
                    if all(abs(rgb[k] - DOOR_RGB[k]) < 0.02 for k in range(3)):
                        door_z.append(wp[2])
                if 'indices' in prim:
                    for (i,) in bk.read_acc(doc, binchunk, prim['indices']):
                        out['index'].append(base + i)
                else:
                    out['index'].extend(range(base, base + len(positions)))
        for child in node.get('children', []):
            stack.append((child, world))
    for b in buckets.values():
        assert b['pos'], f'{path}: empty bucket'
    return buckets, door_z


def fmt_arr(vals):
    return bk.fmt_nums(vals)


def main():
    with open(os.path.join(HOUSES, 'models.json')) as f:
        meta = json.load(f)
    models_js = []
    model_tris = []
    for m in meta:
        buckets, door_z = bake_split(os.path.join(HOUSES, m['name'] + '.glb'))
        tris = {k: len(b['index']) // 3 for k, b in buckets.items()}
        total = sum(tris.values())
        model_tris.append(total)
        front_ok = door_z and min(door_z) > 0
        print(f"{m['name']:12s} walls={tris['walls']:5d} roof={tris['roof']:5d} "
              f"details={tris['details']:5d} total={total:5d} "
              f"door_z_min={min(door_z) if door_z else 0:.2f} {'FRONT +Z OK' if front_ok else 'FRONT FLIPPED!'}")
        assert front_ok, f"{m['name']}: door not on +Z front"
        parts = []
        for part in ('walls', 'roof', 'details'):
            b = buckets[part]
            parts.append(
                f"      {part}: {{ pos: [{fmt_arr(b['pos'])}], nor: [{fmt_arr(b['nor'])}], "
                f"col: [{fmt_arr(b['col'])}], index: [{','.join(str(i) for i in b['index'])}] }}")
        models_js.append(
            f"    {{ name: '{m['name']}', type: '{m['type']}', hw: {m['hw']}, hd: {m['hd']},\n"
            + ',\n'.join(parts) + ' }')
    # Assignment: same plot order as world.js (gx outer, gz inner).
    # Models are DEALT from a shuffled deck per type (not picked
    # uniformly): uniform picks gave one shop model 11 of 15 shop
    # plots. Dealing keeps every model at 2-8 uses, and the tint
    # retry below keeps neighbours from sharing model + wall colour.
    by_type = {'house': [], 'tall': [], 'shop': []}
    for i, m in enumerate(meta):
        by_type[m['type']].append(i)
    rng = random.Random(7)
    decks = {}
    for t, pool in by_type.items():
        deck = list(pool)
        rng.shuffle(deck)
        decks[t] = {'deck': deck, 'i': 0}

    def deal(pool_type):
        d = decks[pool_type]
        if d['i'] >= len(d['deck']):
            rng.shuffle(d['deck'])
            d['i'] = 0
        mi = d['deck'][d['i']]
        d['i'] += 1
        return mi

    assign = []
    placed = {}
    for gx in range(-42, 43, 14):
        for gz in range(-42, 43, 14):
            if abs(gx) < 14 and abs(gz) < 14:
                continue
            if gx == 0 and gz == -14:
                continue  # the Blender sample keeps this plot
            inner = abs(gx) <= 14 or abs(gz) <= 14
            if rng.random() < 0.18:
                pool_type = 'tall'
            elif inner and rng.random() < 0.5:
                pool_type = 'shop'
            else:
                pool_type = 'house'
            mi = deal(pool_type)
            neighbours = [placed.get((gx - 14, gz)), placed.get((gx, gz - 14))]
            for _ in range(7):
                wt = rng.choice(WALL_TINTS)
                if all(n is None or (n['model'], n['wallTint']) != (mi, wt)
                       for n in neighbours):
                    break
            rt = rng.choice(ROOF_TINTS)
            s = round(0.95 + rng.random() * 0.10, 3)
            entry = {'x': gx, 'z': gz, 'model': mi, 'wallTint': wt, 'roofTint': rt, 's': s}
            assign.append(entry)
            placed[(gx, gz)] = entry
    assert len(assign) == 47, f'assignment has {len(assign)} plots, want 47'
    city_tris = sum(model_tris[a['model']] for a in assign)
    counts = {}
    for a in assign:
        counts[meta[a['model']]['name']] = counts.get(meta[a['model']]['name'], 0) + 1
    print('uses per model:', counts)
    print(f'city house tris: {city_tris} (allowance 117428)')
    print(f'projected audit: {79982 + 3206 + city_tris + 99384} / 300000')
    assert city_tris <= 117428, 'house set over the triangle allowance'
    lines = [
        '// Baked Blender house set (walker scale, meters). Generated by',
        '// scripts/bake-house-set.py from vendor-src/houses/*.glb — do not edit by hand.',
        '// walls/roof vertex colours are white: the runtime tints them per',
        '// plot via instanceColor; details carry their modelled colours.',
        'export const HOUSE_SET = {',
        '  models: [',
        ',\n'.join(models_js),
        '  ],',
        '};',
        'export const HOUSE_ASSIGN = [',
        ',\n'.join(
            f"  {{ x: {a['x']}, z: {a['z']}, model: {a['model']}, "
            f"wallTint: '{a['wallTint']}', roofTint: '{a['roofTint']}', s: {a['s']} }}"
            for a in assign),
        '];',
        '',
    ]
    out = os.path.join(ROOT, 'js', 'vendor', 'house-set.js')
    with open(out, 'w') as f:
        f.write('\n'.join(lines))
    with open(os.path.join(HOUSES, 'assignment.json'), 'w') as f:
        json.dump(assign, f, indent=1)
    print(f'wrote {out} ({os.path.getsize(out)//1024} KiB) + assignment.json')


if __name__ == '__main__':
    main()
