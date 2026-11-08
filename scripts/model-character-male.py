#!/usr/bin/env python3
"""Parametric Blender MALE character for the game (MODEL PHASE only).

Run: ~/workspace/blender/blender -b --python scripts/model-character-male.py
Writes: vendor-src/character-male/character-male.glb (intermediate,
gitignored)

Pair of the female character (scripts/model-character.py): same
cozy style, same beanie + pompom, same jacket (collar/buttons/
belt/buckle/hem/pockets), same hands (palm + 4 tiered fingers +
thumb), same shoes + soles, same skeleton — but reading male:
short hair (NO long side locks), NO blush, slightly wider
shoulders/torso, slightly firmer jaw (wider skull + wider mouth).
Still friendly, not exaggerated macho.

Coordinate conventions (identical to the female generator):
game (x, up y, front z) -> Blender (x, -z, y); fronts built at
game +z arrive at game +z after the glTF exporter (Z-up -> Y-up).

Skeleton compatibility (MUST match js/character.js AND the female
bake, verified by scripts/bake-character-male.py):
  pivots (group space): legL (-0.14, 0.85, 0), legR (0.14, 0.85, 0)
  body group at y=0.85; torso (0, 0.35, 0), head (0, 1.0, 0),
  hat (0, 1.22, 0), armL (-0.34, 0.65, 0), armR (0.34, 0.65, 0)
  in body space. Total height 2.36 (pompom top), so the name label
  at 2.65 and chat balloon at 3.25 keep clearing the head.
  All geometry is built in character space with objects at the
  origin; the bake subtracts the absolute pivot per part to produce
  pivot-local geometry.

Materials drive the bake split (same rule as the female bake):
  'shirt' -> WHITE vertex colours (1,1,1): the recolour marker.
    Phase-2 recolorShirt must remap white (not the old shirt
    colour) to the player's colour. White is unique: no other
    part uses it.
  everything else -> modelled colour (linear values of the
    character.js palette).

Triangle budget (HARD, audit boots 41 players): total across the
7 meshes <= 2,640 per player (female: 1,878; target similar).
The bake prints per-part counts and asserts the total.
"""
import math
import os

import bpy

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'vendor-src', 'character-male')
os.makedirs(ROOT, exist_ok=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(hexv):
    return tuple(srgb_to_linear(((hexv >> shift) & 255) / 255)
                 for shift in (16, 8, 0))


# sRGB hexes from js/character.js (SKIN/HAIR/PANTS/SHOE/BELT/CREAM/
# EYE/HAT) + a darker sole + the white shirt marker. NO blush: the
# male face deliberately has no blush spheres.
PALETTE = {
    'skin': 0xf2c9a0,
    'hair': 0x6b4a30,
    'pants': 0x6b7fa8,
    'shoe': 0x5a4632,
    'sole': 0x3a2c1e,
    'belt': 0x6b4226,
    'cream': 0xfff2dd,
    'eye': 0x2a1e14,
    'hat': 0xc98a5a,
    'shirt': 0xffffff,
}


def mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(PALETTE[name]), 1.0)
    return m


M = {n: mat(n) for n in PALETTE}


def B(x, y, z):
    """Game (x, up y, front z) -> Blender (x, -z, y)."""
    return (x, -z, y)


def S(sx, sy, sz):
    """Game scale (x, y, z) -> Blender scale (x, z, y)."""
    return (sx, sz, sy)


def apply_tr():
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def box(name, center, size, material):
    """Axis-aligned metre box, game coords (center, size)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.dimensions = S(*size)
    apply_tr()
    o.data.materials.append(material)
    return o


def cone(name, center, r_bottom, r_top, height, seg, material, rot=(0.0, 0.0, 0.0)):
    """Vertical tapered cylinder (game Y axis). rot=(pi/2,0,0) lays the
    axis along game +z (nose, buttons)."""
    bpy.ops.mesh.primitive_cone_add(radius1=r_bottom, radius2=r_top,
                                    depth=height, vertices=seg,
                                    location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = rot
    apply_tr()
    o.data.materials.append(material)
    return o


def cyl(name, center, radius, height, seg, material, rot=(0.0, 0.0, 0.0)):
    return cone(name, center, radius, radius, height, seg, material, rot)


def sphere(name, center, radius, seg, ring, material, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring,
                                         radius=radius, location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.scale = S(*scale)
    apply_tr()
    o.data.materials.append(material)
    return o


def ico(name, center, radius, subdiv, material, scale=(1.0, 1.0, 1.0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius,
                                          location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.scale = S(*scale)
    apply_tr()
    o.data.materials.append(material)
    return o


def torus(name, center, major, minor, major_seg, minor_seg, material):
    """Blender torus lies in the XY plane (axis Z) -> game XZ plane
    (axis Y): a horizontal ring, no rotation needed."""
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=major_seg,
                                     minor_segments=minor_seg,
                                     location=B(*center))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    return o


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def build_leg(sx):
    # Identical to the female: same pants, shoe + sole + rounded toe.
    x = sx * 0.14
    cone(f'leg{"L" if sx < 0 else "R"}_pants', (x, 0.425, 0),
         0.075, 0.11, 0.85, 8, M['pants'])
    box(f'leg{"L" if sx < 0 else "R"}_shoe', (x, 0.06, 0.04),
        (0.17, 0.12, 0.30), M['shoe'])
    box(f'leg{"L" if sx < 0 else "R"}_sole', (x, 0.015, 0.05),
        (0.19, 0.03, 0.34), M['sole'])
    sphere(f'leg{"L" if sx < 0 else "R"}_toe', (x, 0.07, 0.19),
           0.08, 6, 4, M['shoe'], scale=(1.0, 0.6, 0.8))


def build_torso():
    # Slightly wider than the female (jacket top 0.32 vs 0.30,
    # shoulders at +-0.35 vs +-0.33). Button radii recomputed from
    # the wider taper: r(y) = 0.22 + (y - 0.75) / 0.90 * 0.10.
    cone('torso_jacket', (0, 1.20, 0), 0.22, 0.32, 0.90, 10, M['shirt'])
    for sx in (-1, 1):
        ico(f'torso_shoulder{"L" if sx < 0 else "R"}', (sx * 0.35, 1.47, 0),
            0.12, 1, M['shirt'], scale=(1.0, 0.85, 1.0))
    torus('torso_collar', (0, 1.68, 0), 0.15, 0.045, 10, 4, M['cream'])
    for y, r in ((1.32, 0.283), (1.12, 0.261)):
        cyl(f'torso_button{y}', (0, y, r), 0.035, 0.04, 6, M['cream'],
            rot=(math.pi / 2, 0, 0))
    cyl('torso_belt', (0, 1.00, 0), 0.27, 0.10, 12, M['belt'])
    box('torso_buckle', (0, 1.00, 0.28), (0.08, 0.06, 0.03), M['cream'])
    cyl('torso_hem', (0, 0.79, 0), 0.235, 0.08, 10, M['shirt'])
    for sx in (-1, 1):
        box(f'torso_pocket{"L" if sx < 0 else "R"}', (sx * 0.16, 0.95, 0.24),
            (0.12, 0.14, 0.03), M['shirt'])


def build_head():
    # Firmer jaw: skull slightly wider and less tall than the female
    # (scale x 1.06, y 0.95). Short hair: cap only, NO long side
    # locks, NO blush.
    # (Same brim lesson as the female: no separate fringe/brow —
    # the beanie brim band swallows anything in that forehead band.)
    sphere('head_skull', (0, 1.85, 0), 0.23, 14, 12, M['skin'],
           scale=(1.06, 0.95, 1.0))
    sphere('head_hair', (0, 1.93, -0.06), 0.27, 14, 12, M['hair'],
           scale=(1.0, 0.8, 1.0))
    # NOTE: NO chin block. v1 had a chin box (front z 0.22) that stuck
    # out ~0.05 past the y-squashed skull surface (face front at chin
    # height is only ~0.167) and rendered as a stuck-on block in the
    # face close-up. A flat box cannot follow the sphere curvature
    # here (flush at the top = proud at the bottom), so jaw firmness
    # comes from the wider skull + wider mouth alone.
    for sx in (-1, 1):
        sphere(f'head_ear{"L" if sx < 0 else "R"}', (sx * 0.24, 1.85, 0),
               0.06, 6, 4, M['skin'], scale=(0.5, 1.0, 0.8))
        sphere(f'head_eye{"L" if sx < 0 else "R"}', (sx * 0.085, 1.88, 0.215),
               0.028, 6, 4, M['eye'], scale=(1.0, 1.25, 0.6))
    # Nose cone: base inside the face, tip proud at z 0.28.
    cone('head_nose', (0, 1.82, 0.24), 0.04, 0.0, 0.08, 6, M['skin'],
         rot=(math.pi / 2, 0, 0))
    # Mouth slightly wider than the female's, still a neutral bar.
    box('head_mouth', (0, 1.74, 0.205), (0.08, 0.015, 0.02), M['eye'])


def build_hat():
    # Identical beanie + pompom: the pair shares one hat.
    sphere('hat_dome', (0, 2.09, -0.01), 0.24, 12, 8, M['hat'],
           scale=(1.0, 0.75, 1.0))
    cyl('hat_brim', (0, 1.97, 0), 0.26, 0.09, 14, M['hat'])
    ico('hat_pompom', (0, 2.29, -0.01), 0.07, 1, M['cream'])


def build_arm(sx):
    # Identical to the female: sleeve + cuff + palm + 4 staggered
    # fingers + inner thumb.
    side = 'L' if sx < 0 else 'R'
    x = sx * 0.34
    cone(f'arm{side}_sleeve', (x, 1.275, 0), 0.06, 0.085, 0.65, 8, M['shirt'])
    cyl(f'arm{side}_cuff', (x, 0.98, 0), 0.065, 0.08, 8, M['cream'])
    box(f'arm{side}_palm', (x, 0.90, 0.01), (0.10, 0.12, 0.05), M['skin'])
    for i, (dx, length) in enumerate((
            (-0.039, 0.06), (-0.013, 0.085), (0.013, 0.07), (0.039, 0.05))):
        box(f'arm{side}_finger{i}', (x + dx, 0.845 - length / 2, 0.01),
            (0.022, length, 0.04), M['skin'])
    box(f'arm{side}_thumb', (sx * 0.28, 0.90, 0.01),
        (0.03, 0.06, 0.04), M['skin'])


def main():
    clear()
    build_leg(-1)
    build_leg(1)
    build_torso()
    build_head()
    build_hat()
    build_arm(-1)
    build_arm(1)
    out = os.path.join(ROOT, 'character-male.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)
    print('wrote', out)


main()
