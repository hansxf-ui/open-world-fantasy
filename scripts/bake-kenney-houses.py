#!/usr/bin/env python3
"""Bake Kenney City Kit Suburban houses into a JS module.

Unlike the Nature Kit (untextured, vertex colors), these houses are
TEXTURED: windows, doors, and roofs are painted into one shared
512x512 atlas (Textures/colormap.png). Baking them to vertex colors
would destroy that detail — that is why the first Kenney pass kept
houses procedural. This script instead keeps the UVs: the runtime
renders the baked geometry with the real colormap.png, so houses look
exactly as Kenney drew them.

Output: js/vendor/kenney-houses.js — one entry per house type (a..u)
with positions, normals, UVs, indices, and a centered bounding box
(x/z recentered so placement = plot center exactly, y stays 0-based).
The texture itself is NOT inlined: deploy
js/vendor/Textures/colormap.png next to the module.

Usage: python3 bake-kenney-houses.py
Reads <repo>/vendor-src/kenney/city-kit-suburban/Models/GLB format/*.glb
Writes <repo>/js/vendor/kenney-houses.js
"""
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(REPO, 'vendor-src', 'kenney', 'city-kit-suburban',
                   'Models', 'GLB format')
OUT = os.path.join(REPO, 'js', 'vendor', 'kenney-houses.js')

COMP = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def load_glb(path):
    data = open(path, 'rb').read()
    assert data[0:4] == b'glTF', f'{path}: not a GLB'
    off = 12
    doc = None
    binchunk = b''
    while off + 8 <= len(data):
        ln, typ = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A:
            doc = json.loads(chunk)
        elif typ == 0x004E4942:
            binchunk = chunk
        off += 8 + ln
    assert doc is not None, f'{path}: no JSON chunk'
    return doc, binchunk


def read_acc(doc, binchunk, idx):
    acc = doc['accessors'][idx]
    bv = doc['bufferViews'][acc['bufferView']]
    fmt = COMP[acc['componentType']]
    n = NCOMP[acc['type']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride', n * struct.calcsize(fmt))
    return [struct.unpack_from('<' + fmt * n, binchunk, base + i * stride)
            for i in range(acc['count'])]


def bake(path):
    doc, binchunk = load_glb(path)
    images = doc.get('images', [])
    assert len(images) == 1, f'{path}: expected 1 texture, got {images}'
    assert images[0].get('uri', '').endswith('colormap.png'), \
        f'{path}: unexpected texture {images[0]}'
    nodes = doc.get('nodes', [])
    scenes = doc.get('scenes', [])
    roots = scenes[doc.get('scene', 0)]['nodes'] if scenes else list(range(len(nodes)))
    pos_out, nor_out, uv_out, idx_out = [], [], [], []
    # Houses have a single untransformed node, but walk the scene
    # anyway so a future pack with nested transforms still bakes right.
    for r in roots:
        node = nodes[r]
        assert 'mesh' in node, f'{path}: root node has no mesh'
        mesh = doc['meshes'][node['mesh']]
        assert len(mesh['primitives']) == 1, f'{path}: expected 1 primitive'
        prim = mesh['primitives'][0]
        positions = read_acc(doc, binchunk, prim['attributes']['POSITION'])
        normals = read_acc(doc, binchunk, prim['attributes']['NORMAL'])
        uvs = read_acc(doc, binchunk, prim['attributes']['TEXCOORD_0'])
        for p, n, t in zip(positions, normals, uvs):
            pos_out.extend(round(c, 4) for c in p)
            nor_out.extend(round(c, 4) for c in n)
            uv_out.extend(round(c, 4) for c in t)
        if 'indices' in prim:
            idx_out.extend(i[0] for i in read_acc(doc, binchunk, prim['indices']))
        else:
            idx_out.extend(range(len(positions)))
    assert pos_out, f'{path}: no vertices baked'
    xs = pos_out[0::3]
    ys = pos_out[1::3]
    zs = pos_out[2::3]
    minx, maxx = min(xs), max(xs)
    minz, maxz = min(zs), max(zs)
    # Recenter x/z so the house sits exactly on its plot center.
    cx, cz = (minx + maxx) / 2, (minz + maxz) / 2
    pos_out[0::3] = [round(x - cx, 4) for x in xs]
    pos_out[2::3] = [round(z - cz, 4) for z in zs]
    bbox = {
        'min': [round(minx - cx, 4), round(min(ys), 4), round(minz - cz, 4)],
        'max': [round(maxx - cx, 4), round(max(ys), 4), round(maxz - cz, 4)],
    }
    return {'pos': pos_out, 'nor': nor_out, 'uv': uv_out, 'index': idx_out,
            'bbox': bbox, 'tris': len(idx_out) // 3}


def fmt_nums(vals):
    return ','.join(('%.4g' % v) for v in vals)


def main():
    files = sorted(f for f in os.listdir(SRC)
                   if f.startswith('building-type-') and f.endswith('.glb'))
    assert len(files) == 21, f'expected 21 houses, found {len(files)}'
    entries = {}
    total_tris = 0
    for fname in files:
        key = fname[len('building-type-'):-len('.glb')]
        baked = bake(os.path.join(SRC, fname))
        entries[key] = baked
        total_tris += baked['tris']
        print(f'{key}: {fname} tris={baked["tris"]} '
              f'bbox min={baked["bbox"]["min"]} max={baked["bbox"]["max"]}')
    lines = [
        '// Baked Kenney City Kit Suburban houses (CC0). Generated by',
        '// scripts/bake-kenney-houses.py from vendor-src/kenney — do not',
        '// edit by hand. Textured geometry: render with',
        '// js/vendor/Textures/colormap.png (shared atlas, NOT inlined).',
        'export const KENNEY_HOUSES = {',
    ]
    for key, b in entries.items():
        lines.append(f'  {key}: {{')
        lines.append(f'    pos: [{fmt_nums(b["pos"])}],')
        lines.append(f'    nor: [{fmt_nums(b["nor"])}],')
        lines.append(f'    uv: [{fmt_nums(b["uv"])}],')
        lines.append(f'    index: [{",".join(str(i) for i in b["index"])}],')
        lines.append(f'    min: {b["bbox"]["min"]}, max: {b["bbox"]["max"]},')
        lines.append('  },')
    lines.append('};')
    lines.append('')
    with open(OUT, 'w') as f:
        f.write('\n'.join(lines))
    print(f'wrote {OUT} ({os.path.getsize(OUT)//1024} KiB, {total_tris} tris total)')


if __name__ == '__main__':
    main()
