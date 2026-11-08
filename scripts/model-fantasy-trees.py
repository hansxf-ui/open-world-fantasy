#!/usr/bin/env python3
"""Fantasy tree set for stage 1 (game comes alive): 4 Blender models.

Run: ~/workspace/blender/blender -b --python scripts/model-fantasy-trees.py
Writes: vendor-src/trees/<name>.glb + vendor-src/trees/models.json

Models (all origins at the ground, z=0, no floating parts):
  ancient : hero broadleaf — tapered trunk, 3 large canopy blobs +
            1 top puff, hanging moss strands, half-buried root flares
  bloom   : flowering fantasy tree — pink canopy blobs
  birch   : pale trunk + light-green canopy
  pine    : snow-zone fantasy pine — 3 teal tiers + white cap cone

Conventions (same as model-house-set.py):
- Blender coords, Z-up; the glTF exporter converts to game Y-up.
- Materials become vertex colours in the bake (bake-fantasy-trees.py).
- No custom meshes are built here: every part is a Blender primitive
  (cone / icosphere / box), which carries correct outward winding by
  construction, so no mesh_from winding fix is needed. The renders in
  veg-audit/ are the visual proof (no invisible or black faces).
- No bevels: flat-shaded low-poly is the intended stylised look, and
  bevels would only cost triangles on parts the player never inspects
  up close.
- Blender primitive counts (measured from the GLB, not guessed):
  closed 8-seg cone = 28 tris, icosphere subdiv 1 = 20, subdiv 2 = 80,
  box = 12. So cones are built as OPEN custom meshes (side quads only,
  16 tris) via mesh_from — their caps would be hidden anyway (trunk
  base at the ground, tier bases inside the tier below, trunk tops
  inside the canopy). Main canopy blobs use subdiv 2 (80 tris);
  top puffs and root flares use subdiv 1 (20).
- Tri budget per model (audit counts base x instances): ancient 384,
  bloom 196, birch 176, pine 112 (16 trunk + 3 x 24 capped tiers +
  24 capped snow cap). With the game's spot counts (44/43/43/100)
  the trees cost 44,092 tris, replacing 48,940 Kenney tree tris.
"""
import json
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'vendor-src', 'trees')
os.makedirs(ROOT, exist_ok=True)

COLOURS = {
    'bark': (0.350, 0.260, 0.190),
    'barkPale': (0.850, 0.820, 0.780),
    'leaf': (0.220, 0.420, 0.200),
    'leafLight': (0.350, 0.600, 0.280),
    'leafTeal': (0.160, 0.420, 0.380),
    'snow': (0.950, 0.970, 1.000),
    'bloomPink': (0.950, 0.550, 0.700),
    'bloomLight': (0.980, 0.750, 0.850),
    'moss': (0.550, 0.700, 0.350),
}


def mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*COLOURS[name], 1.0)
    return m


M = {n: mat(n) for n in COLOURS}


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def mesh_from(name, verts, faces, material, center):
    """Custom mesh; each triangle is flipped until its normal points
    away from the given centre (copied pattern from model-house-set.py)."""
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


def cone(name, z_bottom, r_bottom, r_top, h, material, segments=8, cap_bottom=False):
    """Truncated cone, side quads only (16 tris at 8 segments) plus an
    optional bottom cap fan (+8 tris). The top is always open: it
    hides inside the canopy/tier above. The bottom cap is REQUIRED
    for the pine tiers and snow cap — their bottom rims stick out
    beyond the tier below, so an open bottom reads as a see-through
    slit under each tier (caught in veg-audit/pine.png). Trunk bottoms
    stay open: they sit at the ground, where a cap is invisible.
    Verts are absolute (Blender z-up)."""
    verts = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        verts.append((r_bottom * math.cos(a), r_bottom * math.sin(a), z_bottom))
    for i in range(segments):
        a = 2 * math.pi * i / segments
        verts.append((r_top * math.cos(a), r_top * math.sin(a), z_bottom + h))
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, segments + j, segments + i))
    if cap_bottom:
        centre = len(verts)
        verts.append((0, 0, z_bottom))
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((centre, j, i))
    return mesh_from(name, verts, faces, material, center=(0, 0, z_bottom + h / 2))


def blob(name, loc, radius, scale, material, subdiv=1):
    """Icosphere blob. Blender counts subdiv 1 as the base icosahedron
    (20 tris); subdiv 2 = 80 tris. Main blobs use 2, puffs/roots 1."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    return o


def strand(name, top, length, material):
    """Hanging moss strand: thin box whose top 0.1 m is embedded in
    the canopy blob above, so it can never read as floating."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(top[0], top[1], top[2] - length / 2))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = (0.07, 0.07, length)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(material)
    return o


def root_flare(name, loc, material):
    """Squashed icosphere, centre 0.10 m up: bottom 0.15 m buried, top
    0.35 m proud — a root flare that touches trunk and ground."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.5, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (1.0, 0.6, 0.5)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    return o


def trunk(r_bottom, r_top, h, material):
    return cone('Trunk', 0, r_bottom, r_top, h, material)


def build_ancient():
    clear()
    trunk(0.30, 0.18, 3.0, M['bark'])
    blob('CanopyMain', (0, 0, 3.6), 1.6, (1.15, 1.0, 0.85), M['leaf'], subdiv=2)
    blob('CanopySideL', (-1.1, 0.4, 3.1), 1.2, (1.0, 1.0, 0.8), M['leafLight'], subdiv=2)
    blob('CanopySideR', (1.0, -0.5, 3.3), 1.1, (1.0, 1.0, 0.8), M['leaf'], subdiv=2)
    blob('CanopyTop', (0.2, 0.2, 4.4), 0.8, (1.0, 1.0, 0.8), M['leafLight'], subdiv=1)
    # Moss hangs from canopy undersides (tops embedded in the blobs).
    strand('Moss1', (-0.9, 0.5, 2.4), 0.8, M['moss'])
    strand('Moss2', (0.9, -0.4, 2.6), 0.7, M['moss'])
    strand('Moss3', (-0.3, -0.9, 2.5), 0.9, M['moss'])
    strand('Moss4', (0.5, 0.8, 2.7), 0.6, M['moss'])
    root_flare('Root1', (0.35, 0.2, 0.10), M['bark'])
    root_flare('Root2', (-0.35, -0.2, 0.10), M['bark'])
    root_flare('Root3', (0.0, -0.4, 0.10), M['bark'])


def build_bloom():
    clear()
    trunk(0.26, 0.16, 2.6, M['bark'])
    blob('CanopyMain', (0, 0, 3.2), 1.5, (1.1, 1.0, 0.85), M['bloomPink'], subdiv=2)
    blob('CanopySide', (-0.9, 0.3, 2.8), 1.1, (1.0, 1.0, 0.8), M['bloomPink'], subdiv=2)
    blob('CanopyTop', (0.7, -0.3, 3.8), 0.7, (1.0, 1.0, 0.8), M['bloomLight'], subdiv=1)


def build_birch():
    clear()
    trunk(0.22, 0.14, 2.8, M['barkPale'])
    blob('CanopyMain', (0, 0, 3.4), 1.4, (1.1, 1.0, 0.85), M['leaf'], subdiv=2)
    blob('CanopySide', (0.8, 0.4, 3.0), 1.0, (1.0, 1.0, 0.8), M['leafLight'], subdiv=2)


def build_pine():
    clear()
    trunk(0.20, 0.12, 1.0, M['bark'])
    cone('Tier1', 1.0, 1.3, 0.02, 1.8, M['leafTeal'], cap_bottom=True)
    cone('Tier2', 1.7, 1.0, 0.02, 1.6, M['leafTeal'], cap_bottom=True)
    cone('Tier3', 2.4, 0.7, 0.02, 1.4, M['leafTeal'], cap_bottom=True)
    cone('SnowCap', 3.35, 0.35, 0.02, 0.7, M['snow'], cap_bottom=True)


BUILDERS = {
    'ancient': build_ancient,
    'bloom': build_bloom,
    'birch': build_birch,
    'pine': build_pine,
}


def main():
    meta = []
    for name, build in BUILDERS.items():
        build()
        out = os.path.join(ROOT, name + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)
        meta.append({'name': name})
        print('wrote', name)
    with open(os.path.join(ROOT, 'models.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('wrote models.json with', len(meta), 'models')


main()
