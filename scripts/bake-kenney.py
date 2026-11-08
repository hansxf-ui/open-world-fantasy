#!/usr/bin/env python3
"""Bake selected Kenney Nature Kit GLB models into a JS module.

Kenney Nature GLBs are untextured: each primitive has a solid material
color (baseColorFactor). This script parses the GLB directly (no three.js
dependency), applies node world transforms, and emits indexed geometry
with per-vertex colors plus a bounding box, as `js/vendor/kenney.js`.

Models with textures (e.g. City Kit Suburban houses, whose windows and
doors are painted into colormap.png) are DELIBERATELY excluded: baking
them to vertex colors would destroy that painted detail. Houses stay
procedural (real 3D proud windows/doors).

Usage: python3 bake-kenney.py
Reads <repo>/vendor-src/kenney/nature-kit/Models/GLTF format/*.glb
Writes <repo>/js/vendor/kenney.js
"""
import json
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC = os.path.join(REPO, 'vendor-src', 'kenney', 'nature-kit', 'Models', 'GLTF format')
OUT = os.path.join(REPO, 'js', 'vendor', 'kenney.js')

# name -> file: the models swapped into the world.
MODELS = {
    'treeDefault': 'tree_default.glb',
    'treeDetailed': 'tree_detailed.glb',
    'pineDefault': 'tree_pineDefaultA.glb',
    'pineTall': 'tree_pineTallA.glb',
    'rockLarge': 'rock_largeA.glb',
    'rockSmall': 'rock_smallA.glb',
    'cactusTall': 'cactus_tall.glb',
    'cactusShort': 'cactus_short.glb',
    'bush': 'plant_bush.glb',
}

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
    assert not doc.get('images'), f'{path}: textured model, refusing to bake'
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


def mat4_mult(a, b):
    # Column-major 4x4 multiply (glTF convention): out = a * b.
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return out


def mat4_from_trs(node):
    t = node.get('translation', [0, 0, 0])
    r = node.get('rotation', [0, 0, 0, 1])
    s = node.get('scale', [1, 1, 1])
    x, y, z, w = r
    m = [0.0] * 16
    m[0] = (1 - 2 * (y * y + z * z)) * s[0]
    m[1] = (2 * (x * y + z * w)) * s[0]
    m[2] = (2 * (x * z - y * w)) * s[0]
    m[4] = (2 * (x * y - z * w)) * s[1]
    m[5] = (1 - 2 * (x * x + z * z)) * s[1]
    m[6] = (2 * (y * z + x * w)) * s[1]
    m[8] = (2 * (x * z + y * w)) * s[2]
    m[9] = (2 * (y * z - x * w)) * s[2]
    m[10] = (1 - 2 * (x * x + y * y)) * s[2]
    m[12], m[13], m[14] = t
    m[15] = 1.0
    return m


def apply_mat(m, v):
    x, y, z = v
    return (
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    )


def apply_normal(m, v):
    # Normal matrix = inverse-transpose of the upper 3x3. Kenney nodes
    # are rigid (rotation/translation only), so the 3x3 itself works.
    x, y, z = v
    nx = m[0] * x + m[4] * y + m[8] * z
    ny = m[1] * x + m[5] * y + m[9] * z
    nz = m[2] * x + m[6] * y + m[10] * z
    ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / ln, ny / ln, nz / ln)


def bake(path):
    doc, binchunk = load_glb(path)
    nodes = doc.get('nodes', [])
    scenes = doc.get('scenes', [])
    roots = scenes[doc.get('scene', 0)]['nodes'] if scenes else list(range(len(nodes)))
    pos_out, nor_out, col_out, idx_out = [], [], [], []
    # (node index, world matrix) traversal.
    stack = [(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) for r in roots]
    while stack:
        ni, parent = stack.pop()
        node = nodes[ni]
        local = node['matrix'] if 'matrix' in node else mat4_from_trs(node)
        world = mat4_mult(parent, local)
        if 'mesh' in node:
            mesh = doc['meshes'][node['mesh']]
            for prim in mesh['primitives']:
                mat = doc['materials'][prim.get('material', 0)]
                rgba = mat.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])
                rgb = rgba[:3]
                base = len(pos_out) // 3
                positions = read_acc(doc, binchunk, prim['attributes']['POSITION'])
                normals = read_acc(doc, binchunk, prim['attributes']['NORMAL'])
                for p, n in zip(positions, normals):
                    wp = apply_mat(world, p)
                    wn = apply_normal(world, n)
                    pos_out.extend(round(c, 4) for c in wp)
                    nor_out.extend(round(c, 4) for c in wn)
                    col_out.extend(round(c, 4) for c in rgb)
                if 'indices' in prim:
                    for (i,) in read_acc(doc, binchunk, prim['indices']):
                        idx_out.append(base + i)
                else:
                    idx_out.extend(range(base, base + len(positions)))
        for child in node.get('children', []):
            stack.append((child, world))
    assert pos_out, f'{path}: no vertices baked'
    xs = pos_out[0::3]
    ys = pos_out[1::3]
    zs = pos_out[2::3]
    bbox = {
        'min': [round(min(xs), 4), round(min(ys), 4), round(min(zs), 4)],
        'max': [round(max(xs), 4), round(max(ys), 4), round(max(zs), 4)],
    }
    tris = len(idx_out) // 3
    return {'pos': pos_out, 'nor': nor_out, 'col': col_out, 'index': idx_out,
            'bbox': bbox, 'tris': tris}


def fmt_nums(vals):
    # Compact: strip trailing zeros (round() already applied).
    return ','.join(('%.4g' % v) for v in vals)


def main():
    entries = {}
    total_tris = 0
    for name, fname in MODELS.items():
        baked = bake(os.path.join(SRC, fname))
        entries[name] = baked
        total_tris += baked['tris']
        print(f'{name}: {fname} tris={baked["tris"]} '
              f'bbox min={baked["bbox"]["min"]} max={baked["bbox"]["max"]}')
    lines = [
        '// Baked Kenney Nature Kit geometry (CC0). Generated by',
        '// scripts/bake-kenney.py from vendor-src/kenney — do not edit by hand.',
        '// Untextured models only: per-primitive material colors become vertex',
        '// colors, so the runtime needs no GLTFLoader and no texture files.',
        'export const KENNEY = {',
    ]
    for name, b in entries.items():
        lines.append(f'  {name}: {{')
        lines.append(f'    pos: [{fmt_nums(b["pos"])}],')
        lines.append(f'    nor: [{fmt_nums(b["nor"])}],')
        lines.append(f'    col: [{fmt_nums(b["col"])}],')
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
