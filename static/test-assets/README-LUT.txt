LUT (.cube) test files — Effects tab
====================================

identity-lut-2.cube
  "Identity" LUT: output color = input color. The loader and shader work, but
  the image looks UNCHANGED. This is correct — it only checks that the pipeline runs.

invert-lut-2.cube
  Inverts RGB (like a photo negative). You should see a strong visible change
  when LUT is enabled and intensity = 1.

For real film/creative looks, use .cube files from grading software or LUT packs;
they are usually 33³ or 65³, not 2³.

The viewer accepts text .cube and .lut (same Iridas/Adobe ASCII format):
  - 3D LUT (LUT_3D_SIZE or infer n³ rows), edge length up to 128 (GPU texture limit)
  - 1D LUT (LUT_1D_SIZE or infer when row count is not a full cube), up to 16384 rows
  - Headers: LUT_3D_SIZE / LUT3D_SIZE / 3D LUT SIZE style; commas or semicolons in RGB lines; UTF-8 or UTF-16 BOM
  - Binary .cube is not supported — export as ASCII from Resolve/Nuke/etc.
If loading fails, the error line explains the reason.
