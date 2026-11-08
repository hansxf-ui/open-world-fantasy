#!/usr/bin/env python3
"""Model ONE sample house in Blender (headless) at real walker scale.

Run: ~/workspace/blender/blender -b --python scripts/model-sample-house.py
Writes: vendor-src/blender/sample-house.glb

v2 — "lebih 3D" upgrade (pemilik: v1 terasa kurang):
- Beveled edges on every chunky part (edges catch light, no more
  CG-flat boxes). Bevel is applied AFTER transform_apply so the width
  is uniform world units, and skipped on thin parts.
- Real relief volumes: bay window on the east side, porch posts
  under the awning, two-tier steps, corner boards, water table,
  frieze under the eaves, ridge cap, door panels.
- Windows get cross muntins + side shutters; bushes flank the steps.
v3 — "naik tingkat + detailnya juga" (pemilik: v2 bagus, FPS aman):
- Roof tile rows on both slopes, a dormer on the south slope,
  flower boxes + flowers under the front windows, a wall lantern
  beside the door, door architrave + hinges + welcome mat, and a
  stepping-stone path from the steps to the street.

Design (meters, Blender coords: X right, Y depth, Z up):
- Front faces Blender -Y, which the glTF exporter maps to +Z, so the
  door faces the plaza when placed at plot (0, -14) in the game.
- Walker scale throughout: door 2.0 m tall, walls 3.0 m, roof peak
  4.8 m — the proportions Kenney Suburban could not give this game.
- Materials are plain base colors (no textures), so the existing
  vertex-color bake pipeline (scripts/bake-blender.py) handles it.
"""
import math
import os

import bpy

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'vendor-src', 'blender', 'sample-house.glb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

CREAM = (0.949, 0.816, 0.627)   # walls
TERRA = (0.690, 0.502, 0.376)   # roof / awning
BROWN = (0.420, 0.259, 0.149)   # door
DARKBROWN = (0.329, 0.200, 0.110)  # door panels
AMBER = (1.000, 0.851, 0.541)   # lit windows
WHITE = (1.000, 0.949, 0.867)   # frames / sills / trim
STONE = (0.604, 0.584, 0.557)   # foundation / steps / chimney cap
BRICK = (0.659, 0.376, 0.314)   # chimney
GREEN = (0.478, 0.604, 0.478)   # shutters
BUSH = (0.353, 0.541, 0.353)    # bushes
DARKTERRA = (0.580, 0.420, 0.310)  # roof tile rows
PINK = (0.910, 0.478, 0.604)    # flowers
YELLOW = (0.949, 0.816, 0.353)  # flowers
IRON = (0.250, 0.250, 0.270)    # hinges / lantern bracket


def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1.0)
    return m


M = {n: mat(n, c) for n, c in [
    ('cream', CREAM), ('terra', TERRA), ('brown', BROWN), ('darkbrown', DARKBROWN),
    ('amber', AMBER), ('white', WHITE), ('stone', STONE), ('brick', BRICK),
    ('green', GREEN), ('bush', BUSH), ('darkterra', DARKTERRA),
    ('pink', PINK), ('yellow', YELLOW), ('iron', IRON)]}


def box(name, loc, size, material, rot=(0.0, 0.0, 0.0)):
    """Box with real-meter dimensions, rotation applied, then a small
    bevel (skipped on thin parts where it would collapse)."""
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


# Foundation + walls (centered on origin, y 0-based via location z).
box('Foundation', (0, 0, 0.15), (6.4, 5.4, 0.3), M['stone'])
box('Walls', (0, 0, 1.8), (6.0, 5.0, 3.0), M['cream'])

# Trim: corner boards, water table at the base, frieze under the eaves.
for sx in (-1, 1):
    for sy in (-1, 1):
        box(f'Corner{sx:+d}{sy:+d}', (sx * 3.0, sy * 2.5, 1.8), (0.18, 0.18, 3.0), M['white'])
box('WaterTable', (0, 0, 0.39), (6.2, 5.2, 0.18), M['white'])
box('Frieze', (0, 0, 2.95), (6.2, 5.2, 0.2), M['white'])

# Roof: two sloped boxes + two gable-end triangles (cream infill) + ridge cap.
# Slope: from eave (y=+-2.8, z=3.0) to ridge (y=0, z=4.8).
slope_len = math.hypot(2.8, 1.8) + 0.2  # slight eave overhang
slope_ang = math.atan2(1.8, 2.8)
box('RoofSouth', (0, -1.4, 3.9), (6.6, slope_len, 0.15), M['terra'], rot=(slope_ang, 0, 0))
box('RoofNorth', (0, 1.4, 3.9), (6.6, slope_len, 0.15), M['terra'], rot=(-slope_ang, 0, 0))
box('RidgeCap', (0, 0, 4.88), (6.7, 0.3, 0.12), M['terra'])

# Roof tile rows: thin darker boxes riding each slope (7 per slope),
# offset 0.06 along the slope normal so they read as tile courses.
for t in (0.08, 0.22, 0.36, 0.50, 0.64, 0.78, 0.92):
    box(f'TileRowS{t}', (0, -2.8 + 2.8 * t - 0.032, 3.05 + 1.8 * t),
        (6.6, 0.30, 0.06), M['darkterra'], rot=(slope_ang, 0, 0))
    box(f'TileRowN{t}', (0, 2.8 - 2.8 * t + 0.032, 3.05 + 1.8 * t),
        (6.6, 0.30, 0.06), M['darkterra'], rot=(-slope_ang, 0, 0))

# Gable ends: triangles at x=+-3.3, verified outward winding
# (west face -X, east face +X, viewed from outside).
verts = [(-3.3, -2.8, 3.0), (-3.3, 0, 4.8), (-3.3, 2.8, 3.0),
         (3.3, -2.8, 3.0), (3.3, 2.8, 3.0), (3.3, 0, 4.8)]
faces = [(0, 1, 2), (3, 4, 5)]
mesh = bpy.data.meshes.new('GableEnds')
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new('GableEnds', mesh)
bpy.context.collection.objects.link(obj)
obj.data.materials.append(M['cream'])

# Door on the front (-Y) face: panels, knob, two-tier steps,
# porch posts + a bigger awning.
box('Door', (0, -2.56, 1.3), (1.0, 0.12, 2.0), M['brown'])
box('DoorPanelLow', (0, -2.63, 0.95), (0.6, 0.04, 0.7), M['darkbrown'])
box('DoorPanelHigh', (0, -2.63, 1.75), (0.6, 0.04, 0.7), M['darkbrown'])
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.05,
                                     location=(0.35, -2.65, 1.3))
knob = bpy.context.active_object
knob.name = 'Knob'
knob.data.materials.append(M['white'])
box('StepTop', (0, -2.8, 0.15), (1.4, 0.6, 0.3), M['stone'])
box('StepBottom', (0, -3.0, 0.075), (1.7, 0.9, 0.15), M['stone'])
box('PorchPostL', (-0.7, -3.2, 1.3), (0.12, 0.12, 2.3), M['white'])
box('PorchPostR', (0.7, -3.2, 1.3), (0.12, 0.12, 2.3), M['white'])
box('Awning', (0, -3.05, 2.62), (1.9, 1.1, 0.08), M['terra'], rot=(0.3, 0, 0))

# Door architrave + hinges + welcome mat + wall lantern.
box('ArchL', (-0.56, -2.55, 1.3), (0.12, 0.1, 2.2), M['white'])
box('ArchR', (0.56, -2.55, 1.3), (0.12, 0.1, 2.2), M['white'])
box('ArchTop', (0, -2.55, 2.36), (1.24, 0.1, 0.12), M['white'])
box('HingeLow', (-0.44, -2.63, 0.9), (0.04, 0.1, 0.18), M['iron'])
box('HingeHigh', (-0.44, -2.63, 1.7), (0.04, 0.1, 0.18), M['iron'])
box('WelcomeMat', (0, -2.85, 0.32), (1.2, 0.5, 0.04), M['darkbrown'])
box('LanternBracket', (0.75, -2.62, 2.35), (0.06, 0.3, 0.06), M['iron'])
box('LanternGlass', (0.75, -2.72, 2.3), (0.16, 0.16, 0.22), M['amber'])
box('LanternCap', (0.75, -2.72, 2.44), (0.2, 0.2, 0.05), M['iron'])


def flower_box(x):
    box(f'FlowerBox{x}', (x, -2.62, 0.95), (1.0, 0.25, 0.22), M['brown'])
    for i, c in enumerate(['pink', 'yellow', 'pink']):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=5, radius=0.09,
                                             location=(x - 0.3 + i * 0.3, -2.68, 1.10))
        fl = bpy.context.active_object
        fl.name = f'Flower{x}_{i}'
        fl.data.materials.append(M[c])


flower_box(-1.8)
flower_box(1.8)


def front_window(name, x):
    box(name + 'Frame', (x, -2.55, 1.8), (1.1, 0.1, 1.3), M['white'])
    box(name + 'Glass', (x, -2.56, 1.8), (0.9, 0.12, 1.1), M['amber'])
    box(name + 'Sill', (x, -2.57, 1.1), (1.2, 0.14, 0.1), M['white'])
    box(name + 'MuntV', (x, -2.62, 1.8), (0.06, 0.04, 1.1), M['white'])
    box(name + 'MuntH', (x, -2.62, 1.8), (0.9, 0.04, 0.06), M['white'])
    box(name + 'ShutL', (x - 0.75, -2.54, 1.8), (0.35, 0.08, 1.3), M['green'])
    box(name + 'ShutR', (x + 0.75, -2.54, 1.8), (0.35, 0.08, 1.3), M['green'])


front_window('WinFrontL', -1.8)
front_window('WinFrontR', 1.8)

# West side window (+ muntins, no shutters).
box('WinWestFrame', (-3.05, 0, 1.8), (0.1, 1.1, 1.3), M['white'])
box('WinWestGlass', (-3.06, 0, 1.8), (0.12, 0.9, 1.1), M['amber'])
box('WinWestMuntV', (-3.07, 0, 1.8), (0.04, 0.06, 1.1), M['white'])
box('WinWestMuntH', (-3.07, 0, 1.8), (0.04, 0.9, 0.06), M['white'])

# Bay window on the east side: a real protruding volume + its own
# roof + windows on three faces.
box('BayBody', (3.4, 0, 1.25), (0.8, 2.2, 1.9), M['cream'])
box('BayRoof', (3.5, 0, 2.35), (1.1, 2.5, 0.1), M['terra'], rot=(0, 0.3, 0))
box('BayFrontFrame', (3.86, 0, 1.4), (0.1, 1.2, 1.4), M['white'])
box('BayFrontGlass', (3.87, 0, 1.4), (0.12, 1.0, 1.2), M['amber'])
for sy in (-1, 1):
    box(f'BaySideFrame{sy:+d}', (3.4, sy * 1.16, 1.4), (0.9, 0.1, 1.1), M['white'])
    box(f'BaySideGlass{sy:+d}', (3.4, sy * 1.17, 1.4), (0.7, 0.12, 0.9), M['amber'])

# Dormer on the south slope: body + shed roof + window.
box('DormerBody', (0, -1.7, 3.95), (1.2, 0.9, 1.1), M['cream'])
box('DormerRoof', (0, -1.7, 4.55), (1.4, 1.1, 0.08), M['terra'], rot=(0.3, 0, 0))
box('DormerFrame', (0, -2.16, 3.95), (0.8, 0.1, 0.8), M['white'])
box('DormerGlass', (0, -2.17, 3.95), (0.6, 0.12, 0.6), M['amber'])

# Chimney on the north slope + cap.
box('Chimney', (1.8, 1.2, 4.28), (0.5, 0.5, 0.9), M['brick'])
box('ChimneyCap', (1.8, 1.2, 4.78), (0.7, 0.7, 0.12), M['stone'])

# Bushes flanking the door, OUTSIDE the house: centres at y = -3.15,
# so the spheres (-3.60..-2.70) touch the foundation face (-2.70)
# exactly instead of being planted through the front wall and water
# table (the v2/v3 bug: y = -2.2 sat inside the wall and only a green
# sliver poked out, reading as a weird lump straddling the trim).
for sx in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.45,
                                         location=(sx * 2.0, -3.15, 0.34))
    bush = bpy.context.active_object
    bush.name = f'Bush{sx:+d}'
    bush.scale = (1, 1, 0.75)
    bush.data.materials.append(M['bush'])

# Stepping-stone path from the steps toward the street (flat, no
# collider — walkable like the street ribbons; the last stone lands
# on the asphalt edge).
for i, y in enumerate((-3.9, -4.7, -5.5)):
    box(f'PathStone{i}', (0, y, 0.04), (0.9, 0.7, 0.08), M['stone'])

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True)
print('wrote', OUT)
