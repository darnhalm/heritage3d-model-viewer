#!/usr/bin/env bash
# Кладёт несколько тайлсетов из CesiumGS/3d-tiles-samples в dist/models/3d-tiles/,
# откуда их отдаёт `npm run serve`. Каталог в .gitignore — в репозиторий ничего не попадает.
#
# Выбраны три набора, каждый проверяет свою часть рантайма:
#   MetadataGranularities  — 3D Tiles 1.1, refine ADD, несколько content на тайл, GLB, локальные координаты;
#   TilesetWithDiscreteLOD — 1.0, refine REPLACE, три уровня детализации, b3dm, ECEF-трансформ корня;
#   BoundingBoxTests       — одиночные тайлы с заведомо известными OBB, проверка математики габаритов.
set -euo pipefail

BASE="https://raw.githubusercontent.com/CesiumGS/3d-tiles-samples/main"
DEST="${1:-dist/models/3d-tiles}"

FILES=(
    "1.1/MetadataGranularities/tileset.json"
    "1.1/MetadataGranularities/house-3-0.glb"
    "1.1/MetadataGranularities/house1-1.glb"
    "1.1/MetadataGranularities/house-4-2.glb"
    "1.1/MetadataGranularities/house-5-3.glb"
    "1.1/MetadataGranularities/tree-spruce-0-0.glb"
    "1.1/MetadataGranularities/tree-spruce-0-1.glb"
    "1.1/MetadataGranularities/tree-spruce-0-2.glb"
    "1.1/MetadataGranularities/tree-spruce-0-3.glb"
    "1.1/MetadataGranularities/tree-beech-1-0.glb"
    "1.1/MetadataGranularities/tree-beech-1-1.glb"
    "1.1/MetadataGranularities/tree-beech-1-2.glb"
    "1.1/MetadataGranularities/tree-beech-1-3.glb"
    "1.1/MetadataGranularities/tree-lime-2-0.glb"
    "1.1/MetadataGranularities/tree-lime-2-1.glb"
    "1.1/MetadataGranularities/tree-lime-2-2.glb"
    "1.1/MetadataGranularities/tree-lime-2-3.glb"
    "1.1/MetadataGranularities/tree-lime-3-0.glb"
    "1.1/MetadataGranularities/tree-lime-3-1.glb"
    "1.1/MetadataGranularities/tree-lime-3-2.glb"
    "1.1/MetadataGranularities/tree-lime-3-3.glb"

    "1.0/TilesetWithDiscreteLOD/tileset.json"
    "1.0/TilesetWithDiscreteLOD/dragon_low.b3dm"
    "1.0/TilesetWithDiscreteLOD/dragon_medium.b3dm"
    "1.0/TilesetWithDiscreteLOD/dragon_high.b3dm"

    "1.1/BoundingBoxTests/0_0_0-1_1_2/tileset.json"
    "1.1/BoundingBoxTests/0_0_0-1_1_2/0_0_0-1_1_2.glb"
    "1.1/BoundingBoxTests/2_0_0-4_1_1/tileset.json"
    "1.1/BoundingBoxTests/2_0_0-4_1_1/2_0_0-4_1_1.glb"
)

for rel in "${FILES[@]}"; do
    out="$DEST/$rel"
    mkdir -p "$(dirname "$out")"
    if [[ -s "$out" ]]; then
        printf '  = %s\n' "$rel"
        continue
    fi
    printf '  ↓ %s\n' "$rel"
    curl -fsSL --retry 2 -o "$out" "$BASE/$rel"
done

printf '\nГотово: %s\n' "$DEST"
