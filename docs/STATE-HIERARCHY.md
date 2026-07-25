# Состояние элементов вьюера — иерархия для сохранения

Ниже — дерево состояния (observer). Значения можно сохранять в JSON и восстанавливать по этой структуре.

**Сейчас в localStorage сохраняется** только ветка из `saveOptions`: `camera`, `skybox`, `light`, `debug`, `shadowCatcher`, `enableWebGPU`. Остальное — полный список того, что можно при желании тоже сохранять (например, для привязки к модели).

---

## 1. Сохраняемые сейчас (saveOptions)

```
camera
├── fov                    number   (35–150)
├── tonemapping            string   'None' | 'Linear' | 'Neutral' | 'Filmic' | 'Hejl' | 'ACES' | 'ACES2'
├── pixelScale             number   1 | 2 | 4 | 8 | 16
├── multisampleSupported   boolean  (read-only, можно не сохранять)
├── multisample            boolean
├── hq                     boolean
└── mode                   string   'orbit' | 'fly'

skybox
├── value                  string   имя из списка (None, Paul Lobe Haus, …)
├── options                string   (список опций, обычно не перезаписывать при загрузке)
├── exposure               number   (-6 … 6)
├── rotation               number   (-180 … 180)
├── background             string   'Solid Color' | 'Infinite Sphere' | 'Projective Dome' | 'Projective Box'
├── backgroundColor        object
│   ├── r                  number   (0–1)
│   ├── g                  number   (0–1)
│   └── b                  number   (0–1)
├── blur                   number   (0–5)
└── domeProjection         object
    ├── domeRadius         number   (0–1000)
    └── tripodOffset       number   (0–1)

light
├── enabled                boolean
├── color                  object   { r, g, b } (0–1)
├── intensity              number   (0–6)
├── follow                 boolean
└── shadow                 boolean

shadowCatcher
├── enabled                boolean
└── intensity              number   (0–1)

debug
├── renderMode             string   'default' | 'lighting' | 'albedo' | 'emission' | …
├── stats                  boolean
├── wireframe              boolean
├── wireframeColor         object   { r, g, b } (0–1)
├── bounds                 boolean
├── skeleton               boolean
├── axes                   boolean
├── grid                   boolean
└── normals                number   (0–1)

enableWebGPU               boolean
```

---

## 2. Вся иерархия состояния (полный список для сохранения)

```
camera
├── fov
├── tonemapping
├── pixelScale
├── multisampleSupported
├── multisample
├── hq
└── mode

skybox
├── value
├── options
├── exposure
├── rotation
├── background
├── backgroundColor
│   ├── r
│   ├── g
│   └── b
├── blur
└── domeProjection
    ├── domeRadius
    └── tripodOffset

light
├── enabled
├── color
│   ├── r
│   ├── g
│   └── b
├── intensity
├── follow
└── shadow

shadowCatcher
├── enabled
└── intensity

debug
├── renderMode
├── stats
├── wireframe
├── wireframeColor
│   ├── r
│   ├── g
│   └── b
├── bounds
├── skeleton
├── axes
├── grid
└── normals

animation
├── playing
├── speed
├── transition
├── loops
├── list              string   (JSON array имён клипов)
├── progress
└── selectedTrack

scene
├── urls               string[]
├── filenames          string[]
├── nodes              string   (JSON иерархии)
├── selectedNode
│   ├── path
│   ├── name
│   ├── position       { 0, 1, 2 }
│   ├── rotation       { 0, 1, 2, 3 }
│   └── scale          { 0, 1, 2 }
├── meshCount
├── materialCount
├── textureCount
├── vertexCount
├── primitiveCount
├── textureVRAM
├── meshVRAM
├── bounds
├── variant
│   └── selected
├── variants
│   └── list
├── loadTime
├── cameras            string   (JSON)
└── selectedCamera

ui
├── fullscreen
├── active
├── spinner
├── loadProgress
├── error
└── warnings

runtime                 (обычно не сохраняют — зависит от устройства)
├── activeDeviceType
├── viewportWidth
├── viewportHeight
├── xrSupported
└── xrActive

morphs                  (зависит от модели)
enableWebGPU            boolean
centerScene             boolean
```

---

## 3. Рекомендации при сохранении «на модель»

- **Сохранять (хорошо для профиля под модель):**  
  `camera`, `skybox`, `light`, `shadowCatcher`, `debug`, `enableWebGPU`, при желании `animation` (speed, selectedTrack, progress), `scene.selectedNode` (если хотите запоминать выбор узла), `centerScene`.

- **Не сохранять или подставлять осторожно:**  
  `skybox.options` (зависит от списка skybox в приложении), `scene.urls` / `filenames` / `nodes` / `cameras` (зависят от загруженной модели), `ui` (spinner, error, loadProgress), `runtime`, `morphs`.

- **При загрузке из файла:**  
  применять только разрешённые пути (whitelist), проверять тип и диапазон значений, для `skybox.value` — только из списка допустимых (как в текущем `loadOptions`).
