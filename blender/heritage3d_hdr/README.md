# HERITAGE3D HDR Export 0.2.0 — preview

Offline Blender extension exporting selected meshes with embedded UASTC HDR 4×4 Base Color maps. Material type is determined by Blender's glTF exporter and is never inferred from the presence of HDR. Other maps and Lit material parameters remain in the GLB. Source images/materials are preserved.

## Install and use

1. Install the platform ZIP via Blender Preferences → Get Extensions → Install from Disk.
2. Use a linear Rec.709 EXR directly connected to Principled BSDF Base Color for Lit. For Unlit, use Blender's official glTF shadeless graph: Image Color → Emission Color; Transparent and Emission → Mix Shader inputs 1 and 2; Light Path `Is Camera Ray` → Mix factor; Mix Shader → Material Output Surface. This exports as Base Color with `KHR_materials_unlit` and prevents the surface from lighting the scene in Cycles. Legacy direct Image → Output and Background strength 1 graphs remain accepted. Other complex node graphs require baking before this preview can export them.
3. Select the objects, switch to Object Mode, then File → Export → HERITAGE3D HDR (.glb).
4. In the export window enable **Embed HDR textures** and select the materials in the **Material → Base Color texture** list. Eligible maps start checked; unsupported materials show a reason and remain ordinary materials. No material-panel checkbox or persistent material changes are needed.
5. Choose 2K / 4K / Original and Balanced / High quality. Disable **Embed HDR textures** for an ordinary GLB export without HDR attachments or encoder execution. Esc cancels between preparation stages and during encoding. Large image preparation and Blender's own GLB export are synchronous.

The preview rejects unsupported color spaces rather than relabeling them. It does not bake viewport exposure into HDR. Intermediate EXR is written with dedicated scene settings, preserving linear values. HDR 4×4 uses the encoder's default quality or its additional endpoint quantization search; ordinary LDR UASTC quality flags are not used.

The embedded SDR fallback uses luminance Reinhard + sRGB with peak normalization; it is a viewing derivative. RGB HDR compression is lossy. Alpha stays in the SDR Base Color image; the viewer retains that original opacity path. Keep original EXRs as archival sources.

## Distribution and compatibility

- This preview ZIP is built and tested on **macOS arm64, Blender 5.2**. The manifest minimum is Blender 4.2; compatibility with 4.2 and other versions still needs testing. Windows, Intel Mac and Linux packages are planned, not validated releases.
- KTX CLI **5.0.0-rc2** and libktx are bundled. No network requests, Node.js, npm, system KTX or developer tools are required at runtime. SHA-256 checks protect against accidental binary changes. Verified tools are copied to the extension's user cache, without changing the installed extension directory.
- This is a local preview, not a signed/notarized public macOS release and not a Blender Extensions catalog submission. Before a public release, verify binary provenance, exact component license/notice inventory and platform signing requirements.
- Private `HERITAGE3D_hdr_surface` version 1 requires the HDR-capable HERITAGE3D viewer. Ordinary glTF readers use the embedded SDR fallback. Third-party re-export can discard the private HDR attachment.
- At most 16 HDR material bindings, 8192 pixels per axis, and 256 MiB total equivalent RGBA16F full mip-chain memory. 8K square exceeds this budget. Reduce size for multiple 4K maps. Export preparation can temporarily require substantially more CPU RAM than this GPU budget.
- Textures must be ordinary 2D EXR images. UDIM, multilayer EXR, negative/non-finite samples, RGB >65504, EXR alpha outside [0,1], arbitrary node graphs and HDR environment maps are not supported in this preview.

New extension code is GPL-3.0-or-later. The existing installed KTX Blender extension was not copied or modified. Bundled KTX tools remain separate executables under their own upstream component licenses; see `licenses/KTX` and `NOTICE`. Do not interpret the add-on's GPL declaration as relicensing those executables.
