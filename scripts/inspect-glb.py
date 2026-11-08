#!/usr/bin/env python3
"""Inspect a GLB file: meshes, materials, textures, triangle counts.

Usage: python3 inspect-glb.py <file.glb> [...]  (or a directory: scans *.glb)
Prints one line per file: name, size, mesh count, primitive count,
triangle total, material count, image count (textures), node count.
Exit 0 always (report-only).
"""
import json
import os
import struct
import sys


def inspect(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 12 or data[0:4] != b'glTF':
        return f'{path}: NOT A GLB'
    _magic, _ver, _length = struct.unpack('<III', data[0:12])
    off = 12
    json_doc = None
    while off + 8 <= len(data):
        chunk_len, chunk_type = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:  # JSON
            json_doc = json.loads(chunk.decode('utf-8'))
        off += 8 + chunk_len
    if json_doc is None:
        return f'{path}: NO JSON CHUNK'
    accessors = json_doc.get('accessors', [])
    meshes = json_doc.get('meshes', [])
    mats = json_doc.get('materials', [])
    images = json_doc.get('images', [])
    nodes = json_doc.get('nodes', [])
    tris = 0
    prims = 0
    for mesh in meshes:
        for prim in mesh.get('primitives', []):
            prims += 1
            idx = prim.get('indices')
            if idx is not None:
                tris += accessors[idx]['count'] // 3
            else:
                tris += accessors[prim['attributes']['POSITION']]['count'] // 3
    return (f'{os.path.basename(path)}: {len(data)//1024} KiB, '
            f'meshes={len(meshes)}, prims={prims}, tris={tris}, '
            f'materials={len(mats)}, images={len(images)}, nodes={len(nodes)}')


def main():
    paths = []
    for arg in sys.argv[1:]:
        if os.path.isdir(arg):
            for root, _dirs, files in os.walk(arg):
                for fn in sorted(files):
                    if fn.lower().endswith('.glb'):
                        paths.append(os.path.join(root, fn))
        else:
            paths.append(arg)
    for p in sorted(paths):
        try:
            print(inspect(p))
        except Exception as e:  # noqa: BLE001 - report-only tool
            print(f'{p}: ERROR {e}')


if __name__ == '__main__':
    main()
