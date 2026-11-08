#!/usr/bin/env python3
"""Parametric Blender house set for the whole city (13 models).

Run: ~/workspace/blender/blender -b --python scripts/model-house-set.py
Writes: vendor-src/houses/<name>.glb + vendor-src/houses/models.json

Why 13 models instead of 48 unique houses: the audit counts every
rendered triangle (instancing saves draw calls, not triangles), and
48 unique ~2,300-tri houses would cost ~110k tris. 13 models x 3
meshes (walls/roof/details) instanced over 47 plots costs ~30k tris
of geometry, 39 draw calls, and still reads varied: per-plot wall
tint + roof tint + scale (0.95-1.05) + a neighbour-contrast rule in
the bake, so no two adjacent plots share model + wall colour.

Conventions (Blender coords, like model-sample-house.py):
- Front faces -Y (game +Z, the door side, like the sample + the old
  procedural houses). Walker scale: door 2.0 m, foundation top 0.3.
- Every front-facing part is positioned relative to FRONT = -d/2
  (the front wall face) -- never absolute Y, or wide houses would
  swallow their own doors.
- Materials drive the runtime split (see bake-house-set.py):
  'wall'  -> tintable walls mesh (vertex colours forced white)
  'roof'  -> tintable roof mesh (vertex colours forced white)
  everything else -> shared details mesh (colours as modelled)
- Footprints keep every house clear of curbs: hw <= 4.6, hd <= 4.5
  (plot at 14, curb face at 9.05, so house face at >= 9.4).
- Bevels: applied AFTER transform_apply (uniform world width),
  skipped on thin parts (< 0.15), like the sample.
"""
import json
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'vendor-src', 'houses')
os.makedirs(ROOT, exist_ok=True)

COLOURS = {
    'wall': (1.0, 1.0, 1.0),        # tinted per plot at runtime
    'roof': (1.0, 1.0, 1.0),        # tinted per plot at runtime
    'trim': (1.0, 0.949, 0.867),     # cream-white trim
    'door': (0.420, 0.259, 0.149),
    'darkdoor': (0.329, 0.200, 0.110),
    'glass': (1.0, 0.851, 0.541),
    'shutter': (0.478, 0.604, 0.478),
    'stone': (0.604, 0.584, 0.557),
    'brick': (0.659, 0.376, 0.314),
    'iron': (0.25, 0.25, 0.27),
    'pink': (0.910, 0.478, 0.604),
    'yellow': (0.949, 0.816, 0.353),
    'accentA': (0.847, 0.353, 0.353),  # shop-a awning red
    'accentB': (0.353, 0.659, 0.627),  # shop-b awning teal
}


def mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*COLOURS[name], 1.0)
    return m


M = {n: mat(n) for n in COLOURS}


def box(name, loc, size, material, rot=(0.0, 0.0, 0.0)):
    """Metre box, rotation baked, then a small bevel (thin parts skip)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.dimensions = size
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    thin = min(size)
    if thin >= 0.15:
        mod = o.modifiers.new('Bevel', 'BEVEL')
        mod.width = min(0.04, thin * 0.2)
        mod.segments = 2
    o.data.materials.append(material)
    return o


def mesh_from(name, verts, faces, material, center):
    """Custom mesh; each triangle is flipped until its normal points
    away from the given centre (so winding mistakes vanish)."""
    fixed = []
    for f in faces:
        tris = [f] if len(f) == 3 else [(f[0], f[1], f[2]), (f[0], f[2], f[3])]
        for t in tris:
            a, b, c = (Vector(v) for v in (verts[t[0]], verts[t[1]], verts[t[2]]))
            n = (b - a).cross(c - a)
            ctr = (a + b + c) / 3
            if n.dot(ctr - Vector(center)) < 0:
                t = (t[0], t[2], t[1])
            fixed.append(t)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], fixed)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


FT = 0.3  # foundation top


def build_base(spec):
    w, d, h = spec['w'], spec['d'], spec['h']
    box('Foundation', (0, 0, 0.15), (w + 0.4, d + 0.4, 0.3), M['stone'])
    box('Walls', (0, 0, FT + h / 2), (w, d, h), M['wall'])
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(f'Corner{sx:+d}{sy:+d}', (sx * w / 2, sy * d / 2, FT + h / 2),
                (0.18, 0.18, h), M['trim'])
    box('WaterTable', (0, 0, 0.39), (w + 0.2, d + 0.2, 0.18), M['trim'])
    box('Frieze', (0, 0, FT + h - 0.35), (w + 0.2, d + 0.2, 0.2), M['trim'])
    return w, d, h


def door_set(front, with_porch):
    box('Door', (0, front - 0.06, 1.3), (1.0, 0.12, 2.0), M['door'])
    box('DoorPanelLow', (0, front - 0.13, 0.95), (0.6, 0.04, 0.7), M['darkdoor'])
    box('DoorPanelHigh', (0, front - 0.13, 1.75), (0.6, 0.04, 0.7), M['darkdoor'])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.05,
                                         location=(0.35, front - 0.15, 1.3))
    knob = bpy.context.active_object
    knob.name = 'Knob'
    knob.data.materials.append(M['trim'])
    box('ArchL', (-0.56, front - 0.05, 1.3), (0.12, 0.1, 2.2), M['trim'])
    box('ArchR', (0.56, front - 0.05, 1.3), (0.12, 0.1, 2.2), M['trim'])
    box('ArchTop', (0, front - 0.05, 2.36), (1.24, 0.1, 0.12), M['trim'])
    box('StepTop', (0, front - 0.3, 0.15), (1.4, 0.6, 0.3), M['stone'])
    box('StepBottom', (0, front - 0.5, 0.075), (1.7, 0.9, 0.15), M['stone'])
    if with_porch:
        box('PorchPostL', (-0.7, front - 0.7, 1.3), (0.12, 0.12, 2.3), M['trim'])
        box('PorchPostR', (0.7, front - 0.7, 1.3), (0.12, 0.12, 2.3), M['trim'])
        box('Awning', (0, front - 0.55, 2.62), (1.9, 1.1, 0.08), M['roof'], rot=(0.3, 0, 0))


def window(x, z, front, shutters=False, flowers=False, big=False):
    fw, fh = (1.6, 1.4) if big else (1.1, 1.3)
    box(f'WinFrame{x}_{z}', (x, front - 0.05, z), (fw, 0.1, fh), M['trim'])
    box(f'WinGlass{x}_{z}', (x, front - 0.06, z), (fw - 0.2, 0.12, fh - 0.2), M['glass'])
    box(f'WinSill{x}_{z}', (x, front - 0.07, z - fh / 2 - 0.05), (fw + 0.1, 0.14, 0.1), M['trim'])
    if not big:
        box(f'WinMuntV{x}_{z}', (x, front - 0.12, z), (0.06, 0.04, fh - 0.2), M['trim'])
        box(f'WinMuntH{x}_{z}', (x, front - 0.12, z), (fw - 0.2, 0.04, 0.06), M['trim'])
    if shutters:
        box(f'ShutL{x}_{z}', (x - fw / 2 - 0.22, front - 0.04, z), (0.35, 0.08, fh), M['shutter'])
        box(f'ShutR{x}_{z}', (x + fw / 2 + 0.22, front - 0.04, z), (0.35, 0.08, fh), M['shutter'])
    if flowers:
        box(f'FlowerBox{x}_{z}', (x, front - 0.12, z - fh / 2 - 0.18), (fw, 0.25, 0.22), M['door'])
        for i, c in enumerate(['pink', 'yellow', 'pink']):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=5, radius=0.09,
                                                 location=(x - 0.3 + i * 0.3, front - 0.18,
                                                           z - fh / 2 - 0.18 + 0.15))
            fl = bpy.context.active_object
            fl.name = f'Flower{x}_{z}_{i}'
            fl.data.materials.append(M[c])


def side_window(sx, z, w):
    box(f'SideFrame{sx}_{z}', (sx * (w / 2 + 0.05), 0, z), (0.1, 1.1, 1.3), M['trim'])
    box(f'SideGlass{sx}_{z}', (sx * (w / 2 + 0.06), 0, z), (0.12, 0.9, 1.1), M['glass'])


def gable_roof(w, d, h, rise, tile_rows=False):
    eave_y = d / 2 + 0.2
    eave_z = FT + h - 0.3
    run = eave_y
    slope_len = math.hypot(run, rise) + 0.2
    ang = math.atan2(rise, run)
    box('RoofSouth', (0, -run / 2, eave_z + rise / 2), (w + 0.6, slope_len, 0.15),
        M['roof'], rot=(ang, 0, 0))
    box('RoofNorth', (0, run / 2, eave_z + rise / 2), (w + 0.6, slope_len, 0.15),
        M['roof'], rot=(-ang, 0, 0))
    box('RidgeCap', (0, 0, eave_z + rise + 0.08), (w + 0.7, 0.3, 0.12), M['roof'])
    gx = w / 2 + 0.3
    verts = [(-gx, -eave_y, eave_z), (-gx, 0, eave_z + rise), (-gx, eave_y, eave_z),
             (gx, -eave_y, eave_z), (gx, eave_y, eave_z), (gx, 0, eave_z + rise)]
    mesh_from('GableEnds', verts, [(0, 1, 2), (3, 4, 5)], M['wall'], center=(0, 0, eave_z))
    if tile_rows:
        for t in (0.08, 0.22, 0.36, 0.50, 0.64, 0.78, 0.92):
            box(f'TileRowS{t}', (0, -eave_y + run * t - 0.032, eave_z + 0.05 + rise * t),
                (w + 0.6, 0.30, 0.06), M['roof'], rot=(ang, 0, 0))
            box(f'TileRowN{t}', (0, eave_y - run * t + 0.032, eave_z + 0.05 + rise * t),
                (w + 0.6, 0.30, 0.06), M['roof'], rot=(-ang, 0, 0))


def hip_roof(w, d, h, rise):
    ex, ey = w / 2 + 0.2, d / 2 + 0.2
    ez = FT + h - 0.3
    rz = ez + rise
    rl = (w - d) / 2  # ridge half-length; all hip specs keep w > d
    verts = [(-ex, -ey, ez), (ex, -ey, ez), (ex, ey, ez), (-ex, ey, ez),
             (-rl, 0, rz), (rl, 0, rz)]
    faces = [(0, 1, 5, 4), (3, 2, 5, 4), (1, 2, 5), (3, 0, 4)]
    mesh_from('HipRoof', verts, faces, M['roof'], center=(0, 0, (ez + rz) / 2))
    box('RidgeCap', (0, 0, rz + 0.08), (rl * 2 + 0.3, 0.3, 0.12), M['roof'])


def flat_roof(w, d, h):
    box('RoofSlab', (0, 0, FT + h - 0.15), (w + 0.4, d + 0.4, 0.3), M['roof'])
    ph = FT + h + 0.25
    box('ParapetS', (0, -(d / 2 + 0.1), ph), (w + 0.4, 0.2, 0.5), M['wall'])
    box('ParapetN', (0, d / 2 + 0.1, ph), (w + 0.4, 0.2, 0.5), M['wall'])
    box('ParapetW', (-(w / 2 + 0.1), 0, ph), (0.2, d, 0.5), M['wall'])
    box('ParapetE', (w / 2 + 0.1, 0, ph), (0.2, d, 0.5), M['wall'])


def bay(w):
    box('BayBody', (w / 2 + 0.4, 0, 1.25), (0.8, 2.2, 1.9), M['wall'])
    box('BayRoof', (w / 2 + 0.5, 0, 2.35), (1.1, 2.5, 0.1), M['roof'], rot=(0, 0.3, 0))
    box('BayFrontFrame', (w / 2 + 0.86, 0, 1.4), (0.1, 1.2, 1.4), M['trim'])
    box('BayFrontGlass', (w / 2 + 0.87, 0, 1.4), (0.12, 1.0, 1.2), M['glass'])
    for sy in (-1, 1):
        box(f'BaySideFrame{sy:+d}', (w / 2 + 0.4, sy * 1.16, 1.4), (0.9, 0.1, 1.1), M['trim'])
        box(f'BaySideGlass{sy:+d}', (w / 2 + 0.4, sy * 1.17, 1.4), (0.7, 0.12, 0.9), M['glass'])


def dormer(eave_y, eave_z, rise):
    y_d = -eave_y * 0.63
    surf = eave_z + 0.37 * rise
    zc = surf + 0.28
    box('DormerBody', (0, y_d, zc), (1.2, 0.9, 1.1), M['wall'])
    box('DormerRoof', (0, y_d, zc + 0.60), (1.4, 1.1, 0.08), M['roof'], rot=(0.3, 0, 0))
    box('DormerFrame', (0, y_d - 0.46, zc), (0.8, 0.1, 0.8), M['trim'])
    box('DormerGlass', (0, y_d - 0.47, zc), (0.6, 0.12, 0.6), M['glass'])


def lantern(front):
    box('LanternBracket', (0.75, front - 0.12, 2.35), (0.06, 0.3, 0.06), M['iron'])
    box('LanternGlass', (0.75, front - 0.22, 2.3), (0.16, 0.16, 0.22), M['glass'])
    box('LanternCap', (0.75, front - 0.22, 2.44), (0.2, 0.2, 0.05), M['iron'])


def chimney(roof, eave_y, eave_z, rise, x=1.8):
    y = eave_y * 0.44
    surf = eave_z + (eave_y - y) / eave_y * rise
    xc = 0.0 if roof == 'hip' else x
    zc = surf + 0.28
    box('Chimney', (xc, y, zc), (0.5, 0.5, 0.9), M['brick'])
    box('ChimneyCap', (xc, y, zc + 0.50), (0.7, 0.7, 0.12), M['stone'])


def shopfront(accent, w, front):
    box('ShopWinL', (-2.0, front - 0.05, 1.6), (1.6, 0.1, 1.4), M['trim'])
    box('ShopGlassL', (-2.0, front - 0.06, 1.6), (1.4, 0.12, 1.2), M['glass'])
    box('ShopWinR', (2.0, front - 0.05, 1.6), (1.6, 0.1, 1.4), M['trim'])
    box('ShopGlassR', (2.0, front - 0.06, 1.6), (1.4, 0.12, 1.2), M['glass'])
    box('ShopAwning', (0, front - 0.55, 2.62), (w - 1.0, 1.1, 0.08), M[accent], rot=(0.3, 0, 0))
    box('ShopSign', (0, front - 0.05, 3.1), (2.2, 0.12, 0.7), M['trim'])


# w/d body metres, h wall height, rise roof rise. Bay adds 0.8 to hw.
MODELS = [
    dict(name='gable-a', type='house', w=7.0, d=6.0, h=3.0, roof='gable', rise=1.8,
         porch=True, bay=False, dormer=False, flowers=True, lantern=False,
         chimney=1.8, shutters=True, tile_rows=True, floors=1),
    dict(name='gable-b', type='house', w=6.5, d=6.5, h=3.0, roof='gable', rise=1.6,
         porch=False, bay=False, dormer=True, flowers=False, lantern=True,
         chimney=-1.8, shutters=False, tile_rows=True, floors=1),
    dict(name='gable-c2', type='house', w=7.5, d=7.0, h=5.4, roof='gable', rise=1.8,
         porch=True, bay=False, dormer=False, flowers=False, lantern=True,
         chimney=1.8, shutters=True, tile_rows=False, floors=2),
    dict(name='hip-a', type='house', w=7.0, d=6.5, h=3.0, roof='hip', rise=1.7,
         porch=True, bay=True, dormer=False, flowers=False, lantern=False,
         chimney=None, shutters=True, tile_rows=False, floors=1),
    dict(name='hip-b2', type='house', w=7.5, d=7.0, h=5.4, roof='hip', rise=1.8,
         porch=False, bay=False, dormer=False, flowers=True, lantern=True,
         chimney=1.8, shutters=False, tile_rows=False, floors=2),
    dict(name='flat-a', type='house', w=7.0, d=6.0, h=3.0, roof='flat', rise=0,
         porch=True, bay=False, dormer=False, flowers=True, lantern=False,
         chimney=None, shutters=False, tile_rows=False, floors=1),
    dict(name='flat-b2', type='house', w=7.5, d=7.0, h=5.4, roof='flat', rise=0,
         porch=False, bay=False, dormer=False, flowers=False, lantern=True,
         chimney=None, shutters=True, tile_rows=False, floors=2),
    dict(name='cottage', type='house', w=5.5, d=5.0, h=2.7, roof='gable', rise=2.2,
         porch=False, bay=False, dormer=False, flowers=True, lantern=True,
         chimney=1.5, shutters=True, tile_rows=True, floors=1),
    dict(name='gable-d', type='house', w=7.5, d=6.5, h=3.0, roof='gable', rise=1.9,
         porch=True, bay=True, dormer=True, flowers=False, lantern=True,
         chimney=-1.8, shutters=True, tile_rows=True, floors=1),
    dict(name='tall-gable', type='tall', w=5.5, d=5.5, h=7.5, roof='gable', rise=2.0,
         porch=False, bay=False, dormer=False, flowers=False, lantern=True,
         chimney=None, shutters=False, tile_rows=False, floors=3),
    dict(name='tall-hip', type='tall', w=6.0, d=5.5, h=7.2, roof='hip', rise=1.8,
         porch=False, bay=False, dormer=False, flowers=False, lantern=False,
         chimney=1.5, shutters=True, tile_rows=False, floors=3),
    dict(name='shop-a', type='shop', w=7.5, d=6.5, h=3.2, roof='gable', rise=1.5,
         porch=False, bay=False, dormer=False, flowers=False, lantern=False,
         chimney=None, shutters=False, tile_rows=False, floors=1, accent='accentA'),
    dict(name='shop-b', type='shop', w=7.0, d=6.0, h=3.2, roof='flat', rise=0,
         porch=False, bay=False, dormer=False, flowers=False, lantern=True,
         chimney=None, shutters=False, tile_rows=False, floors=1, accent='accentB'),
]


def build_model(spec):
    clear()
    w, d, h = build_base(spec)
    front = -d / 2
    if spec['type'] == 'shop':
        box('Door', (0, front - 0.06, 1.3), (1.2, 0.12, 2.0), M['door'])
        box('DoorPanelLow', (0, front - 0.13, 0.95), (0.6, 0.04, 0.7), M['darkdoor'])
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.05,
                                             location=(0.35, front - 0.15, 1.3))
        knob = bpy.context.active_object
        knob.name = 'Knob'
        knob.data.materials.append(M['trim'])
        box('ArchL', (-0.66, front - 0.05, 1.3), (0.12, 0.1, 2.2), M['trim'])
        box('ArchR', (0.66, front - 0.05, 1.3), (0.12, 0.1, 2.2), M['trim'])
        box('StepTop', (0, front - 0.3, 0.15), (1.6, 0.6, 0.3), M['stone'])
        box('StepBottom', (0, front - 0.5, 0.075), (1.9, 0.9, 0.15), M['stone'])
        shopfront(spec['accent'], w, front)
    else:
        door_set(front, spec['porch'])
    floors = spec['floors']
    cols = 2 if w < 7 else 3
    xs = [-w / 4, w / 4] if cols == 2 else [-w / 3, 0, w / 3]
    for f in range(floors):
        if floors == 1:
            z = FT + h / 2
        else:
            z = FT + h * (0.32 + 0.40 * f / (floors - 1))
        # Shops get NO plain front windows: their storefront (door +
        # big shop windows + awning + sign) already fills the front,
        # and plain windows at x=+-2.5 would overlap the shop windows
        # at x=+-2.0 on coplanar faces (z-fighting). Side windows stay.
        if spec['type'] != 'shop':
            for x in xs:
                if f == 0 and abs(x) < 1.1:
                    continue  # ground-floor centre is the door
                window(x, z, front, shutters=spec['shutters'],
                       flowers=spec['flowers'] and f == 0)
        for sx in (-1, 1):
            if spec['bay'] and sx == 1:
                continue  # the bay covers the east side centre
            side_window(sx, z, w)
    if spec['bay']:
        bay(w)
    eave_y = d / 2 + 0.2
    eave_z = FT + h - 0.3
    if spec['dormer']:
        dormer(eave_y, eave_z, spec['rise'])
    if spec['lantern']:
        lantern(front)
    if spec['chimney'] is not None:
        chimney(spec['roof'], eave_y, eave_z, spec['rise'], spec['chimney'])
    if spec['roof'] == 'gable':
        gable_roof(w, d, h, spec['rise'], tile_rows=spec['tile_rows'])
    elif spec['roof'] == 'hip':
        hip_roof(w, d, h, spec['rise'])
    else:
        flat_roof(w, d, h)


def main():
    meta = []
    for spec in MODELS:
        build_model(spec)
        out = os.path.join(ROOT, spec['name'] + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)
        hw = spec['w'] / 2 + (0.8 if spec['bay'] else 0)
        hd = spec['d'] / 2 + 0.3
        meta.append({**{k: spec[k] for k in ('name', 'type', 'w', 'd', 'h')},
                     'hw': round(hw, 2), 'hd': round(hd, 2)})
        print('wrote', spec['name'], 'hw', hw, 'hd', hd)
    with open(os.path.join(ROOT, 'models.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('wrote models.json with', len(meta), 'models')


main()
