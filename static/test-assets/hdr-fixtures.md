# HDR codec fixtures

`hdr-uastc-4x4.ktx2` and `hdr-uastc-6x6.ktx2` are synthetic 16×16 images with constant linear RGB radiance 4.0, opaque alpha, and a complete mip chain. Generated with official KTX-Software v5.0.0-rc2 CLI from an OpenEXR float RGB image:

```sh
ktx create --format R16G16B16A16_SFLOAT --encode uastc-hdr-4x4 \
  --generate-mipmap --assign-tf linear --assign-primaries bt709 \
  --assign-texcoord-origin top-left constant.exr hdr-uastc-4x4.ktx2
```

The second fixture substitutes `uastc-hdr-6x6`. These fixtures test values above 1, dimensions, decoding targets and transfer semantics; they do not establish visual fidelity for photographic data. `scripts/hdr-fixtures.cjs` supplies the companion synthetic Unlit GLB using the existing BoxTextured fixture and raw FP16 data.
