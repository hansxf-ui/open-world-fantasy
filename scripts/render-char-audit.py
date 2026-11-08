#!/usr/bin/env python3
"""Render the Blender character for visual audit (PHASE 1).

Run: ~/workspace/blender/blender -b --python scripts/render-char-audit.py
Writes: char-audit/front.png, side.png, three-quarter.png,
face-closeup.png

Pattern from render-veg-audit.py: default scene cleared FIRST
(a stray default Cube once leaked into an audit render), Cycles
CPU 32 samples (EEVEE needs libEGL, absent in this sandbox),
512x512, sky background, one sun. The GLB is imported as-is, so
the renders show exactly what bake-character.py baked (same
materials, same assembly). Blender coords: feet at z=0, front
at -Y (game +z).
"""
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'char-audit')
GLB = os.path.join(ROOT, 'vendor-src', 'character', 'character.glb')
os.makedirs(OUT, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.worlds):
        for x in coll:
            coll.remove(x)


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    world = bpy.data.worlds.new('AuditWorld')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.78, 0.92, 1.0)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    scene.world = world
    bpy.ops.object.light_add(type='SUN', location=(5, -5, 10))
    sun = bpy.context.active_object
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), 0, math.radians(30))


def ground_plane(size, color):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    p = bpy.context.active_object
    m = bpy.data.materials.new('Ground')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1.0)
    p.data.materials.append(m)
    return p


def camera_look_at(location, target, filename):
    bpy.ops.object.camera_add(location=location)
    cam = bpy.context.active_object
    cam.data.lens = 40
    direction = Vector(target) - Vector(location)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = os.path.join(OUT, filename)
    bpy.ops.render.render(write_still=True)
    print('rendered', filename)


def bbox_z(objects):
    mins, maxs = 1e9, -1e9
    for o in objects:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = min(mins, w.z)
            maxs = max(maxs, w.z)
    return mins, maxs


def main():
    clear_scene()
    setup_render()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    objs = [o for o in bpy.data.objects if o not in before]
    mins, maxs = bbox_z(objs)
    print(f'character bbox z (Blender up): {mins:.3f}..{maxs:.3f} (want 0..2.36)')
    ground_plane(30, (0.80, 0.74, 0.62))
    # Front: camera at Blender -Y looks at the face (game +z).
    camera_look_at((0, -4.5, 1.3), (0, 0, 1.2), 'front.png')
    # Side: camera at +X.
    camera_look_at((4.5, 0, 1.3), (0, 0, 1.2), 'side.png')
    # 3/4 view.
    camera_look_at((3.2, -3.2, 1.8), (0, 0, 1.2), 'three-quarter.png')
    # Face close-up (head centre ~1.85 in game y = Blender z).
    camera_look_at((0, -1.0, 1.95), (0, 0, 1.88), 'face-closeup.png')
    # Hand close-up (right hand ~game (0.34, 0.85, 0.01) -> Blender
    # (0.34, -0.01, 0.85)): proves palm + fingers + thumb read.
    camera_look_at((0.5, -0.6, 1.0), (0.34, -0.01, 0.85), 'hand-closeup.png')
    print('char-audit renders done')


main()
