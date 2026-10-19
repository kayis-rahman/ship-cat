"""Build the small animated Shipcat Ember USD scene headlessly with Blender.

Run through scripts/build-ember.sh, which packages the generated USDC as USDZ.
The deliberately simple character uses an actual armature with independently
weighted bones for its four legs, ears, and one segmented tail.
"""

import bpy
import math
import os
import sys


def arguments():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


args = arguments()
if not args:
    raise SystemExit("usage: blender -b --python scripts/build_ember.py -- <output.usdc> [<preview-dir>]")
output_path = os.path.abspath(args[0])
preview_dir = os.path.abspath(args[1]) if len(args) > 1 else None
os.makedirs(os.path.dirname(output_path), exist_ok=True)
if preview_dir:
    os.makedirs(preview_dir, exist_ok=True)

# Start with an entirely deterministic scene. The screen-space character is a
# clean, soft-shaded sculpt from the approved front/side/rear references.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.armatures):
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 384
scene.render.resolution_y = 384
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = True
scene.render.resolution_percentage = 100
scene.render.engine = "BLENDER_EEVEE"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "Medium High Contrast"
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 96
scene.render.film_transparent = True

# Use the accepted regenerated turnaround images as measurable silhouette
# constraints. These are the accepted front, two side, and rear three-quarter
# views; the failed three-ear rear candidates are intentionally excluded.
reference_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "App", "Assets", "Ember", "References")
reference_names = ("front-seed81032.png", "side-left-seed81002.png",
                   "side-right-seed81012.png", "rear-three-quarter-seed81025.png")

def reference_bounds(name):
    image = bpy.data.images.load(os.path.join(reference_dir, name), check_existing=True)
    width, height = image.size
    pixels = image.pixels[:]
    has_alpha = min(pixels[3::4]) < 0.99
    points = []
    for index in range(width * height):
        offset = index * 4
        visible = pixels[offset + 3] > 0.08 if has_alpha else max(pixels[offset:offset + 3]) > 0.06
        if visible:
            points.append((index % width, index // width))
    if not points:
        raise RuntimeError("Reference image has no visible fox: " + name)
    return (min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points))

def bounds_ratio(bounds):
    return (bounds[2] - bounds[0]) / (bounds[3] - bounds[1])

bounds = {name: reference_bounds(name) for name in reference_names}
side_ratio = (bounds_ratio(bounds[reference_names[1]]) +
              bounds_ratio(bounds[reference_names[2]])) / 2
front_ratio = bounds_ratio(bounds[reference_names[0]])
# Keep authored anatomy proportions but fit the overall side length and frontal
# depth to the accepted views. F-01 remains the canonical visual/style reference.
model_side_ratio = 3.02 / 1.98
model_front_ratio = 0.95 / 1.98
reference_scale = (side_ratio / model_side_ratio,
                   front_ratio / model_front_ratio, 1.0)

def scaled_point(point):
    return tuple(point[i] * reference_scale[i] for i in range(3))

def scaled_size(size):
    return tuple(size[i] * reference_scale[i] for i in range(3))


def material(name, color, roughness=0.82):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


orange = material("Ember russet", (0.86, 0.27, 0.07))
light_orange = material("Ember ear and cheek", (0.98, 0.49, 0.19))
cream = material("Warm cream", (0.98, 0.86, 0.65))
dark = material("Paw charcoal", (0.13, 0.10, 0.09))
green = material("Jade green eyes", (0.14, 0.66, 0.29), 0.36)
black = material("Eye pupils", (0.025, 0.02, 0.018), 0.3)

# Build an actual deform skeleton. One mesh per stylized anatomical piece is
# fully weighted to the bone that owns it; limbs and tail segments pivot at
# their joint roots rather than being parented wholesale to the spine.
arm_data = bpy.data.armatures.new("EmberSkeleton")
arm = bpy.data.objects.new("EmberRig", arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
edit = arm_data.edit_bones
bones = {}

def add_bone(name, head, tail, parent=None):
    bone = edit.new(name)
    bone.head = scaled_point(head)
    bone.tail = scaled_point(tail)
    if parent:
        bone.parent = bones[parent]
    bone.use_connect = False
    bones[name] = bone
    return bone

add_bone("Root", (0, 0, 0.05), (0, 0, 0.35))
add_bone("Spine", (0, 0, 0.62), (0.22, 0, 0.82), "Root")
add_bone("Head", (0.66, 0, 1.15), (0.95, 0, 1.30), "Spine")
add_bone("EarNear", (0.70, -0.17, 1.54), (0.75, -0.17, 1.87), "Head")
add_bone("EarFar", (0.70, 0.17, 1.54), (0.75, 0.17, 1.87), "Head")
add_bone("TailBase", (-0.72, 0, 0.82), (-1.08, 0, 0.94), "Spine")
add_bone("TailTip", (-1.08, 0, 0.94), (-1.46, 0, 1.02), "TailBase")
add_bone("FrontNearLeg", (0.43, -0.22, 0.58), (0.48, -0.22, 0.17), "Spine")
add_bone("FrontFarLeg", (0.43, 0.22, 0.58), (0.48, 0.22, 0.17), "Spine")
add_bone("HindNearLeg", (-0.52, -0.22, 0.56), (-0.57, -0.22, 0.16), "Spine")
add_bone("HindFarLeg", (-0.52, 0.22, 0.56), (-0.57, 0.22, 0.16), "Spine")
bpy.ops.object.mode_set(mode="OBJECT")
arm.select_set(False)


def sphere(name, location, scale, mat, bone, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=scaled_point(location))
    obj = bpy.context.object
    obj.name = name
    obj.scale = scaled_size(scale)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    obj.data.materials.append(mat)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("Ember armature", "ARMATURE")
    modifier.object = arm
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    return obj


# One broad, softly tapered torso with the front of Ember pointing +X.
sphere("Torso", (-0.12, 0, 0.78), (0.91, 0.47, 0.51), orange, "Spine", 32, 20)
sphere("Chest", (0.49, 0, 0.73), (0.34, 0.40, 0.47), cream, "Spine")
sphere("Head", (0.69, 0, 1.18), (0.57, 0.48, 0.49), orange, "Head", 32, 20)
sphere("Muzzle", (1.07, -0.015, 1.01), (0.34, 0.35, 0.23), cream, "Head")
sphere("Nose", (1.35, -0.015, 1.06), (0.09, 0.12, 0.08), dark, "Head", 16, 12)
# Two separate eyes are set around the visible near/far sides; green iris and
# dark pupil remain distinct even at the pet's intended small screen size.
for side, y in (("Near", -0.423), ("Far", 0.423)):
    sphere("EyeWhite" + side, (0.80, y, 1.34), (0.16, 0.075, 0.18), cream, "Head", 20, 14)
    iris_y = y * 1.13
    sphere("Iris" + side, (0.84, iris_y, 1.34), (0.085, 0.055, 0.105), green, "Head", 18, 12)
    pupil_y = iris_y * 1.08
    sphere("Pupil" + side, (0.86, pupil_y, 1.34), (0.037, 0.027, 0.064), black, "Head", 16, 10)

# Exactly two ears.
sphere("EarNear", (0.64, -0.19, 1.60), (0.23, 0.19, 0.36), orange, "EarNear")
sphere("EarInnerNear", (0.69, -0.355, 1.61), (0.12, 0.045, 0.22), light_orange, "EarNear")
sphere("EarFar", (0.64, 0.19, 1.60), (0.23, 0.19, 0.36), orange, "EarFar")
sphere("EarInnerFar", (0.69, 0.355, 1.61), (0.12, 0.045, 0.22), light_orange, "EarFar")

# Exactly one tail, made of two overlapping tapered/rounded sections on one
# bone chain. The ivory tip is a section of that single tail, not a second tail.
sphere("TailBaseMesh", (-0.91, 0, 0.91), (0.48, 0.27, 0.27), orange, "TailBase")
sphere("TailTipMesh", (-1.28, 0, 1.00), (0.30, 0.23, 0.22), cream, "TailTip")

# Four individually weighted leg meshes, two on each side of the torso.
for name, x, y, bone in (
    ("FrontNearLeg", 0.43, -0.22, "FrontNearLeg"),
    ("FrontFarLeg", 0.43, 0.22, "FrontFarLeg"),
    ("HindNearLeg", -0.52, -0.22, "HindNearLeg"),
    ("HindFarLeg", -0.52, 0.22, "HindFarLeg"),
):
    sphere(name, (x, y, 0.37), (0.20, 0.17, 0.34), dark, bone)
    sphere(name + "Paw", (x + 0.055, y, 0.12), (0.22, 0.18, 0.14), dark, bone)

# One deterministic USD timeline: idle (1-24), walk (25-48), turn (49-60),
# jump (61-96). The saved 30 fps animation reference is a side-on fox walk:
# level torso, small rhythmic body bob, smooth diagonal-pair leg alternation,
# and a relaxed counter-swinging tail. Its loop is used for cadence and gait
# only; Ember's own accepted F-01/turnaround set remains the shape/color source.
scene.frame_set(1)
pose = arm.pose.bones

def key_rot(name, frame, axis, degrees):
    p = pose[name]
    p.rotation_mode = "XYZ"
    p.rotation_euler[axis] = math.radians(degrees)
    p.keyframe_insert(data_path="rotation_euler", frame=frame, group=name)

def key_z(name, frame, value):
    p = pose[name]
    p.location.z = value
    p.keyframe_insert(data_path="location", frame=frame, group=name)

# Idle: breathe and make a restrained ear/tail response, not a static pose.
for frame, phase in ((1, 0), (7, 1), (13, 0), (19, -1), (24, 0)):
    key_rot("Spine", frame, 2, 0.7 * phase)
    key_rot("Head", frame, 2, -0.3 * phase)
    key_rot("EarNear", frame, 1, 1.2 * phase)
    key_rot("EarFar", frame, 1, -1.0 * phase)
    key_rot("TailBase", frame, 1, -1.4 * phase)
    key_rot("TailTip", frame, 1, -2.0 * phase)

# Walk: one seamless 24-frame / 1-second loop, matching the observed reference
# cadence. Opposite diagonal pairs move together, as in a trot; shoulders and
# hips stay coordinated while the body remains level with a subtle 2 cm bob.
for offset in range(0, 25, 3):
    frame = 25 + offset
    phase = 2 * math.pi * offset / 24
    swing = 22 * math.sin(phase)
    body_bob = 0.02 * (1 - math.cos(2 * phase))
    key_rot("FrontNearLeg", frame, 1, swing)
    key_rot("HindFarLeg", frame, 1, swing)
    key_rot("FrontFarLeg", frame, 1, -swing)
    key_rot("HindNearLeg", frame, 1, -swing)
    key_rot("Spine", frame, 2, 0.8 * math.sin(2 * phase))
    key_z("Spine", frame, body_bob)
    key_rot("TailBase", frame, 1, -5 * math.sin(phase))
    key_rot("TailTip", frame, 1, -8 * math.sin(phase + 0.3))
# Turn: 49-60, pivot the complete root to the opposite travel direction.
for frame, angle in ((49, 0), (52, 55), (57, 145), (60, 180)):
    key_rot("Root", frame, 2, angle)
# Jump: explicit crouch, rise, apex, fall and land beats. Root height is animated
# while each leg is articulated; the app additionally moves the panel in screen space.
for frame, z, tuck in ((61, 0, 0), (64, -0.06, 20), (67, 0.18, 38), (72, 0.55, 43), (77, 0.68, 30), (82, 0.46, 18), (87, 0.12, 8), (90, 0, 0), (96, 0, 0)):
    # The app owns final travel direction. Reset turn yaw at jump start to avoid
    # applying the renderer's window-facing transform twice.
    key_rot("Root", frame, 2, 0)
    key_z("Root", frame, z)
    key_rot("Spine", frame, 2, -8 if frame == 64 else (5 if frame == 77 else 0))
    for limb in ("FrontNearLeg", "FrontFarLeg", "HindNearLeg", "HindFarLeg"):
        key_rot(limb, frame, 1, tuck if "Front" in limb else -tuck)
# Blender's current layered actions default to Bezier interpolation. The app
# playback controller applies its own eased phase timing.
scene.frame_set(1)
scene.render.image_settings.file_format = "PNG"

# Stage a soft studio render for anatomy QA. Camera is side-on so exactly four
# legs are counted from turnaround outputs rather than obscured by perspective.
world = bpy.data.worlds.new("Ember studio") if not bpy.data.worlds else bpy.data.worlds[0]
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.13, 0.15, 0.18, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45

cam_data = bpy.data.cameras.new("PreviewCamera")
cam = bpy.data.objects.new("PreviewCamera", cam_data)
scene.collection.objects.link(cam)
cam_data.type = "ORTHO"
cam_data.ortho_scale = 3.9
scene.camera = cam

key_data = bpy.data.lights.new("KeyLight", "AREA")
key = bpy.data.objects.new("KeyLight", key_data)
scene.collection.objects.link(key)
key.location = (0.2, -4, 4)
key_data.energy = 500
key_data.shape = "DISK"
key_data.size = 5
fill_data = bpy.data.lights.new("FillLight", "AREA")
fill = bpy.data.objects.new("FillLight", fill_data)
scene.collection.objects.link(fill)
fill.location = (3, 3, 2.5)
fill_data.energy = 230
fill_data.size = 4

def aim(obj, point):
    direction = (point[0] - obj.location.x, point[1] - obj.location.y, point[2] - obj.location.z)
    obj.rotation_euler = direction_to_track_quat(direction, "-Z", "Y").to_euler()

from mathutils import Vector

def direction_to_track_quat(direction, track, up):
    return Vector(direction).to_track_quat(track, up)

# Export only character meshes and armature. Preview camera/lights remain out of
# the packaged runtime so the app can choose its own camera and lighting.
preview_objects = list(scene.objects)
character_objects = [obj for obj in preview_objects if obj == arm or obj.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for obj in character_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.wm.usd_export(
    filepath=output_path,
    selected_objects_only=True,
    export_animation=True,
    export_armatures=True,
    export_materials=True,
    export_cameras=False,
    export_lights=False,
    convert_scene_units="METERS",
)

if preview_dir:
    for name, camera_location in (
        ("side", (0, -7, 1.02)),
        ("front", (7, -0.15, 1.25)),
        ("rear", (-7, -0.15, 1.05)),
    ):
        cam.location = camera_location
        aim(cam, (-0.02, 0, 0.96))
        scene.camera = cam
        scene.render.filepath = os.path.join(preview_dir, name + ".png")
        bpy.ops.render.render(write_still=True)

print("EMBER_USDC", output_path, os.path.getsize(output_path))
print("EMBER_BONES", len(arm.data.bones), ",".join(b.name for b in arm.data.bones))
print("EMBER_MESHES", sum(1 for obj in scene.objects if obj.type == "MESH"))
print("EMBER_FRAME_RANGE", scene.frame_start, scene.frame_end, "24fps")
print("EMBER_REFERENCE_FILES", ",".join(reference_names))
print("EMBER_REFERENCE_RATIOS", "side", round(side_ratio, 4), "front", round(front_ratio, 4),
      "scale", tuple(round(value, 4) for value in reference_scale))
