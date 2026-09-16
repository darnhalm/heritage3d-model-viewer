"""Run with Blender --background --factory-startup --python this_file -- ZIP OUTPUT_DIR."""
import json
import pathlib
import sys
import time
import struct
import subprocess
import bpy

zip_path, output_dir = map(pathlib.Path, sys.argv[sys.argv.index('--') + 1:])
output_dir.mkdir(parents=True, exist_ok=True)
# Install the actual ZIP into an isolated repository; caller provides isolated Blender user dirs.
repo = bpy.context.preferences.extensions.repos.new(name='HDR Test', module='hdr_test', custom_directory=str(output_dir / 'repo'))
result = bpy.ops.extensions.package_install_files(filepath=str(zip_path), repo=repo.module, enable_on_install=True)
assert result == {'FINISHED'}, result
from bl_ext.hdr_test.heritage3d_hdr.exporter import export_steps
from bl_ext.hdr_test.heritage3d_hdr.glb import unpack
from bl_ext.hdr_test.heritage3d_hdr.encoder import executable

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add()
obj = bpy.context.object
for polygon in obj.data.polygons:
    for loop, uv in zip(polygon.loop_indices, ((0, 0), (1, 0), (1, 1), (0, 1))):
        obj.data.uv_layers.active.data[loop].uv = uv
image = bpy.data.images.new('Linear HDR test', width=16, height=16, float_buffer=True)
# Asymmetric radiance catches clipping and flipped texture preparation.
values = [value for y in range(16) for x in range(16) for value in ([4, 0.25, 0.5, 1] if y >= 8 else [0.25, 0.5, 2, 1])]
image.colorspace_settings.name = 'Linear Rec.709'
image.pixels[:] = values
exr_scene = bpy.data.scenes.new('EXR settings')
exr_scene.render.image_settings.file_format = 'OPEN_EXR'
exr_scene.render.image_settings.color_depth = '32'
image.save_render(str(output_dir / 'original.exr'), scene=exr_scene)
bpy.data.scenes.remove(exr_scene)
bpy.data.images.remove(image)
image = bpy.data.images.load(str(output_dir / 'original.exr'))
print('SOURCE_COLORSPACE', image.colorspace_settings.name, 'PIXELS', list(image.pixels[:4]), flush=True)
original_pixels = list(image.pixels)
for unlit in (False, True):
    material = bpy.data.materials.new('Original Unlit' if unlit else 'Original Lit')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    output = nodes.get('Material Output')
    principled = nodes.get('Principled BSDF')
    if unlit:
        emission = nodes.new('ShaderNodeEmission')
        transparent = nodes.new('ShaderNodeBsdfTransparent')
        light_path = nodes.new('ShaderNodeLightPath')
        mix = nodes.new('ShaderNodeMixShader')
        material.node_tree.links.new(texture.outputs['Color'], emission.inputs['Color'])
        material.node_tree.links.new(transparent.outputs[0], mix.inputs[1])
        material.node_tree.links.new(emission.outputs[0], mix.inputs[2])
        material.node_tree.links.new(light_path.outputs['Is Camera Ray'], mix.inputs[0])
        material.node_tree.links.new(mix.outputs[0], output.inputs['Surface'])
    else:
        material.node_tree.links.new(texture.outputs['Color'], principled.inputs['Base Color'])
        principled.inputs['Roughness'].default_value = 0.37
        principled.inputs['Metallic'].default_value = 0.2
    obj.data.materials.clear()
    obj.data.materials.append(material)
    before_counts = len(bpy.data.materials), len(bpy.data.images)
    path = output_dir / ('unlit.glb' if unlit else 'lit.glb')
    assert bpy.ops.export_scene.heritage3d_hdr(filepath=str(path), resolution='2048') == {'FINISHED'}
    doc, binary = unpack(path.read_bytes())
    m = doc['materials'][0]
    assert ('KHR_materials_unlit' in m.get('extensions', {})) == unlit, m
    if not unlit:
        assert abs(m['pbrMetallicRoughness']['roughnessFactor'] - 0.37) < 0.001
        assert abs(m['pbrMetallicRoughness']['metallicFactor'] - 0.2) < 0.001
    assert 'baseColorTexture' in m['pbrMetallicRoughness']
    assert len(doc['extras']['HERITAGE3D_hdr_surface']['textures']) == 1
    binding = doc['extras']['HERITAGE3D_hdr_surface']['textures'][0]
    view = doc['bufferViews'][binding['bufferView']]
    ktx = output_dir / 'texture.ktx2'
    ktx.write_bytes(binary[view['byteOffset']:view['byteOffset'] + view['byteLength']])
    raw = output_dir / 'decoded.bin'
    if raw.exists():
        raw.unlink()
    subprocess.run([executable(), 'extract', '--transcode', 'rgba16f', '--raw', str(ktx), str(raw)], check=True)
    decoded = raw.read_bytes()
    assert struct.unpack_from('<4e', decoded, 0) == (4.0, 0.25, 0.5, 1.0)
    assert struct.unpack_from('<4e', decoded, 15 * 16 * 8) == (0.25, 0.5, 2.0, 1.0)
    assert all('bufferView' in i for i in doc['images'])
    assert obj.active_material == material and texture.image == image
    assert before_counts == (len(bpy.data.materials), len(bpy.data.images))
    assert original_pixels == list(image.pixels)
    # Cancellation between preparation/encoding steps leaves no output or orphan resources.
    cancelled = output_dir / 'cancelled.glb'
    steps = export_steps(bpy.context, cancelled, maximum=2048)
    next(steps)
    next(steps)
    steps.close()
    assert not cancelled.exists()
    assert before_counts == (len(bpy.data.materials), len(bpy.data.images))
    assert obj.active_material == material
# HDR disabled exports a standard GLB without an HDR attachment.
plain = output_dir / 'plain.glb'
assert bpy.ops.export_scene.heritage3d_hdr(filepath=str(plain), embed_hdr=False) == {'FINISHED'}
plain_doc, _ = unpack(plain.read_bytes())
assert 'HERITAGE3D_hdr_surface' not in plain_doc.get('extras', {})
assert not hasattr(bpy.types.Material, 'heritage3d_hdr')
# Explicitly excluding all materials must fail when HDR is enabled.
try:
    list(export_steps(bpy.context, output_dir / 'empty.glb', chosen=[]))
    raise AssertionError('Empty HDR selection accepted')
except ValueError as error:
    assert 'Select 1–16' in str(error)
# Invalid color space fails before touching output or source.
image.colorspace_settings.name = 'Non-Color'
try:
    list(export_steps(bpy.context, output_dir / 'invalid.glb', chosen=[material]))
    raise AssertionError('Invalid color space accepted')
except ValueError as error:
    assert 'Linear Rec.709' in str(error)
assert not (output_dir / 'invalid.glb').exists()
print('HERITAGE3D_TEST_PASS: ZIP install, Lit, Unlit, embedded textures, source preservation, cancellation, invalid color space')
