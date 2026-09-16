# SPDX-License-Identifier: GPL-3.0-or-later
import bpy
from bpy.props import BoolProperty, CollectionProperty, EnumProperty, StringProperty
from bpy_extras.io_utils import ExportHelper
from .exporter import export_steps, source_node, export_materials


class H3D_HDR_material(bpy.types.PropertyGroup):
    material_key: StringProperty()
    material_name: StringProperty()
    enabled: BoolProperty(name='HDR', default=True)
    texture: StringProperty()
    error: StringProperty()


def refresh_selection(self, context):
    self.scan_materials(context)


class H3D_OT_export(bpy.types.Operator, ExportHelper):
    bl_idname = 'export_scene.heritage3d_hdr'
    bl_label = 'Export HERITAGE3D HDR GLB'
    filename_ext = '.glb'
    filter_glob: StringProperty(default='*.glb', options={'HIDDEN'})
    selected: BoolProperty(name='Selected objects only', default=True, update=refresh_selection)
    embed_hdr: BoolProperty(name='Embed HDR textures', default=True)
    hdr_materials: CollectionProperty(type=H3D_HDR_material, options={'SKIP_SAVE'})
    scanned: BoolProperty(default=False, options={'HIDDEN', 'SKIP_SAVE'})
    resolution: EnumProperty(name='Maximum texture size', items=[('2048', '2K', ''), ('4096', '4K', ''), ('0', 'Original', '')], default='4096')
    quality: EnumProperty(name='Encoding quality', items=[('2', 'Balanced', ''), ('4', 'High', 'Slower endpoint quantization search')], default='2')

    def scan_materials(self, context):
        previous = {row.material_key: row.enabled for row in self.hdr_materials}
        self.hdr_materials.clear()
        for material in export_materials(context, self.selected):
            row = self.hdr_materials.add()
            row.material_key = str(material.as_pointer())
            row.material_name = material.name
            try:
                row.texture = source_node(material).image.name
                row.enabled = previous.get(row.material_key, True)
            except ValueError as error:
                row.error = str(error)
                row.enabled = False
        self.scanned = True

    def invoke(self, context, event):
        self.scan_materials(context)
        return ExportHelper.invoke(self, context, event)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, 'selected')
        layout.prop(self, 'embed_hdr')
        if self.embed_hdr:
            box = layout.box()
            box.label(text='Material → Base Color texture')
            if not self.hdr_materials:
                box.label(text='No mesh materials in export selection', icon='INFO')
            for item in self.hdr_materials:
                row = box.row()
                row.enabled = not bool(item.error)
                row.prop(item, 'enabled', text=item.material_name)
                row.label(text=item.texture if not item.error else 'Unavailable')
                if item.error:
                    box.label(text=item.error, icon='INFO')
            layout.prop(self, 'resolution')
            layout.prop(self, 'quality')

    def execute(self, context):
        if context.mode != 'OBJECT':
            self.report({'ERROR'}, 'Switch to Object Mode before export')
            return {'CANCELLED'}
        if not self.scanned:
            self.scan_materials(context)
        available = {str(m.as_pointer()): m for m in export_materials(context, self.selected)}
        enabled = [row for row in self.hdr_materials if row.enabled]
        if self.embed_hdr and any(row.material_key not in available for row in enabled):
            self.report({'ERROR'}, 'Material selection changed; reopen the export window')
            return {'CANCELLED'}
        chosen = [available[row.material_key] for row in enabled if row.material_key in available]
        self._steps = export_steps(context, self.filepath, self.selected, int(self.resolution), int(self.quality), chosen, self.embed_hdr)
        if bpy.app.background:
            try:
                for _ in self._steps:
                    import time
                    time.sleep(0.05)
                return {'FINISHED'}
            except Exception as error:
                self.report({'ERROR'}, str(error))
                return {'CANCELLED'}
        self._timer = context.window_manager.event_timer_add(0.1, window=context.window)
        context.window_manager.modal_handler_add(self)
        return {'RUNNING_MODAL'}

    def finish(self, context):
        if getattr(self, '_steps', None) is not None:
            self._steps.close()
            self._steps = None
        if getattr(self, '_timer', None) is not None:
            context.window_manager.event_timer_remove(self._timer)
            self._timer = None
        context.workspace.status_text_set(None)

    def cancel(self, context):
        self.finish(context)

    def modal(self, context, event):
        if event.type == 'ESC':
            self.finish(context)
            self.report({'INFO'}, 'HDR export cancelled; source materials preserved')
            return {'CANCELLED'}
        if event.type == 'TIMER':
            try:
                context.workspace.status_text_set(next(self._steps))
            except StopIteration:
                self.finish(context)
                self.report({'INFO'}, 'GLB exported with embedded textures')
                return {'FINISHED'}
            except Exception as error:
                self.finish(context)
                self.report({'ERROR'}, str(error))
                return {'CANCELLED'}
        return {'RUNNING_MODAL'}


def menu(self, context):
    self.layout.operator(H3D_OT_export.bl_idname, text='HERITAGE3D HDR (.glb)')


def register():
    for cls in (H3D_HDR_material, H3D_OT_export):
        bpy.utils.register_class(cls)
    bpy.types.TOPBAR_MT_file_export.append(menu)


def unregister():
    bpy.types.TOPBAR_MT_file_export.remove(menu)
    for cls in (H3D_OT_export, H3D_HDR_material):
        bpy.utils.unregister_class(cls)
