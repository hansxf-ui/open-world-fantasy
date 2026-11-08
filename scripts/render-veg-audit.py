#!/usr/bin/env python3
"""Render the fantasy trees for visual audit (stage 1).

Run: ~/workspace/blender/blender -b --python scripts/render-veg-audit.py
Writes: veg-audit/<name>.png (front view per tree) + veg-audit/forest.png

The default scene is cleared FIRST (a stray default Cube once leaked
into an audit render of this project). EEVEE + one sun + sky
background; the GLB materials (Principled, base colour) render as-is.
The forest view approximates the JS undergrowth with equivalent
Blender objects (crossed grass quads, emissive mushroom caps) for
look-checking only — the JS builders are what tests + audit measure.
"""
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'veg-audit')
TREES = os.path.join(ROOT, 'vendor-src', 'trees')
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
    # Cycles on CPU: EEVEE needs libEGL (GPU) which this sandbox
    # lacks; Cycles CPU renders headless. 32 samples is plenty for
    # flat-colour low-poly audit renders.
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


def frame_camera(target, height, dist, z_up=True):
    bpy.ops.object.camera_add(location=(0, -dist, target[2] + height * 0.55))
    cam = bpy.context.active_object
    cam.data.lens = 40
    cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.scene.camera = cam
    # Look at the target: camera at -Y looking along +Y, level.
    cam.location = (target[0], target[1] - dist, target[2] + height * 0.5)
    return cam


def bbox_of(objects):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in objects:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector((min(mins[i], w[i]) for i in range(3)))
            maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
    return mins, maxs


def ground_plane(size, color):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    p = bpy.context.active_object
    m = bpy.data.materials.new('Ground')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1.0)
    p.data.materials.append(m)
    return p


def import_tree(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TREES, name + '.glb'))
    return [o for o in bpy.data.objects if o not in before]


def move(objects, dx, dy, scale):
    for o in objects:
        o.location.x += dx
        o.location.y += dy
        o.scale = (o.scale.x * scale, o.scale.y * scale, o.scale.z * scale)


def render_to(filename):
    bpy.context.scene.render.filepath = os.path.join(OUT, filename)
    bpy.ops.render.render(write_still=True)
    print('rendered', filename)


def tree_fronts():
    for name in ['ancient', 'bloom', 'birch', 'pine']:
        clear_scene()
        setup_render()
        objs = import_tree(name)
        mins, maxs = bbox_of(objs)
        height = maxs.z - mins.z
        dist = max(height * 1.4, 4.0)
        ground_plane(30, (0.32, 0.42, 0.24))
        frame_camera((0, 0, 0), height, dist)
        render_to(name + '.png')
        print(name, 'bbox z', round(mins.z, 2), '..', round(maxs.z, 2))


def forest_view():
    clear_scene()
    setup_render()
    ground_plane(40, (0.25, 0.36, 0.20))
    move(import_tree('ancient'), 0, 0, 1.2)
    move(import_tree('bloom'), -3.5, 1.5, 1.1)
    move(import_tree('birch'), 3.5, -1.0, 1.0)
    move(import_tree('ancient'), -5.0, -3.0, 0.9)
    move(import_tree('bloom'), 4.5, 3.0, 0.95)

    def mat(name, rgb, emission=None):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
        if emission is not None:
            bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
            bsdf.inputs['Emission Strength'].default_value = 1.5
        return m

    grass_mat = mat('Grass', (0.30, 0.55, 0.22))
    # Grass: crossed tapered quads, like the game tufts.
    import random
    rng = random.Random(7)
    for _ in range(60):
        x, y = rng.uniform(-7, 7), rng.uniform(-6, 6)
        s = rng.uniform(0.7, 1.3)
        for rot in (0, math.pi / 2):
            bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, 0.32 * s))
            q = bpy.context.active_object
            q.dimensions = (0.56 * s, 0.65 * s, 0)
            q.rotation_euler = (0, 0, rot)
            # Tilt the plane upright: plane starts flat (XY in Blender
            # is horizontal after creation? primitive_plane lies in XY,
            # i.e. vertical in Z-up? No: it lies flat on the ground
            # (normal +Z). Rotate X 90 to stand it up, then Z for yaw.
            q.rotation_euler = (math.radians(90), 0, rot)
            q.location = (x, y, 0.32 * s)
            q.data.materials.append(grass_mat)
    # Mushrooms: stem + emissive cap, clustered near the trees.
    cap_mats = [mat('CapTeal', (0.35, 0.88, 0.75), (0.35, 0.88, 0.75)),
                mat('CapPurple', (0.75, 0.50, 1.0), (0.75, 0.50, 1.0))]
    stem_mat = mat('Stem', (1.0, 0.95, 0.87))
    for cx, cy in [(-1.5, 1.0), (2.0, -0.5), (-4.0, -2.0)]:
        for j in range(7):
            a = j / 7 * math.pi * 2 + rng.uniform(0, 0.5)
            r = rng.uniform(0.4, 1.2)
            x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
            s = rng.uniform(0.7, 1.3)
            bpy.ops.mesh.primitive_cylinder_add(radius=0.07, depth=0.35,
                                                vertices=6, location=(x, y, 0.175 * s))
            st = bpy.context.active_object
            st.scale = (s, s, s)
            st.data.materials.append(stem_mat)
            bpy.ops.mesh.primitive_cone_add(radius1=0.32 * s, radius2=0.02,
                                            depth=0.30, vertices=10,
                                            location=(x, y, 0.40 * s))
            cap = bpy.context.active_object
            cap.data.materials.append(cap_mats[j % 2])
    # Flowers: small crossed quads near grass.
    flower_mats = [mat('PetalPink', (1.0, 0.54, 0.69)),
                   mat('PetalYellow', (1.0, 0.82, 0.10))]
    for _ in range(14):
        x, y = rng.uniform(-6, 6), rng.uniform(-5, 5)
        s = rng.uniform(0.8, 1.3)
        for rot in (0, math.pi / 2):
            bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, 0.22 * s))
            q = bpy.context.active_object
            q.dimensions = (0.30 * s, 0.35 * s, 0)
            q.rotation_euler = (math.radians(90), 0, rot)
            q.location = (x, y, 0.22 * s)
            q.data.materials.append(flower_mats[_ % 2])
    # Eye-level camera, 3/4 view into the grove.
    bpy.ops.object.camera_add(location=(6, -6, 1.7))
    cam = bpy.context.active_object
    cam.data.lens = 40
    direction = Vector((0, 0, 2.0)) - Vector((6, -6, 1.7))
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    render_to('forest.png')


tree_fronts()
forest_view()
print('veg-audit renders done')
