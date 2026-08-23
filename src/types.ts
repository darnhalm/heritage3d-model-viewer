export interface MorphTargetData {
    name: string,
    targetIndex: number,
    weight?: number
}

export interface File {
    url: string,
    filename?: string,
    sizeBytes?: number
}

export interface Option {
    v: string | number | null,
    t: string
}

export interface HierarchyNode {
    name: string,
    path: string,
    children: Array<HierarchyNode>
}

export interface SceneCamera {
    name: string,
    path: string
}

export interface ObserverData {
    theme: {
        primaryColor: {
            r: number,
            g: number,
            b: number
        }
    },
    ui: {
        fullscreen: boolean,
        active?: string,
        spinner: boolean,
        loadProgress?: number,
        /** Показывать ли экран «перетащите модель»: он для пустого плеера. */
        cta?: boolean,
        loadingBackgroundReady?: boolean,
        error?: string,
        warnings?: string[],
        language?: 'en' | 'ru' | 'zh',
        embed?: {
            enabled: boolean,
            preset: 'full' | 'compact' | 'minimal' | 'none',
            autoplay: boolean,
            animAutoplay: boolean,
            animControls: boolean,
            waiting?: boolean,
            placeholderUrl?: string | null,
            parentOrigin?: string | null,
            panel: boolean,
            poi: boolean,
            tour: boolean,
            measure: boolean,
            info: boolean,
            fragment: boolean,
            controls: boolean,
            hd: boolean,
            share: boolean,
            cameraMode: boolean,
            fullscreen: boolean,
            fit: boolean,
            reset: boolean
        }
    },
    camera: {
        fov: number,
        tonemapping: string,
        pixelScale: number,
        multisampleSupported: boolean,
        multisample: boolean,
        hq: boolean,
        mode: 'orbit' | 'fly',
        flySpeed: number,
        position?: [number, number, number] | null,
        focus?: [number, number, number] | null,
        /** Проекция камеры ортогональна. */
        ortho?: boolean,
        /** Показан ли навигационный куб (и рядом с ним переключатель проекции). */
        viewCube?: boolean
    },
    skybox: {
        value: string,
        options: string,
        exposure: number,
        rotation: number,
        background: 'Solid Color' | 'Infinite Sphere' | 'Projective Dome' | 'Projective Box',
        backgroundColor: {
            r: number,
            g: number,
            b: number
        },
        blur: number,
        domeProjection: {
            domeRadius: number,
            tripodOffset: number
        }
    },
    light: {
        enabled: boolean,
        color: {
            r: number,
            g: number,
            b: number
        },
        intensity: number,
        follow: boolean,
        shadow: boolean
    },
    shadowCatcher: {
        enabled: boolean,
        intensity: number,
        heightOffset: number
    },
    debug: {
        renderMode: 'default' | 'albedo' | 'opacity' | 'worldNormal' | 'specularity' | 'gloss' | 'metalness' | 'ao' | 'emission' | 'lighting' | 'uv0' | 'uv_checker',
        stats: boolean,
        wireframe: boolean,
        wireframeColor: {
            r: number,
            g: number,
            b: number
        },
        bounds: boolean,
        skeleton: boolean,
        axes: boolean,
        grid: boolean,
        alignmentMode?: boolean,
        alignmentGizmoMode?: 'move' | 'rotate' | 'resize',
        alignmentTarget?: 'model' | 'helper' | 'box' | 'pivot',
        normals: number,
        uvCheckerScale: number,
        selectedUvSet: number,
        withTextureOnly: boolean,
        texelDensityHeatmap?: boolean,
        /** Отладочный оверлей тайлов: OBB активных тайлов + живой HUD. */
        tileDebug?: boolean,
        /** Раскраска OBB: по состоянию загрузки или по глубине LOD. */
        tileDebugMode?: 'state' | 'lod',
        /** Толщина контурных лент тайлов; 2 соответствует исходному размеру. */
        tileLineThickness?: number,
        /** Единый цвет каркаса или текущая шахматная схема. */
        tileLineStyle?: 'solid' | 'checker',
        /** Полупрозрачная заливка OBB в шахматном режиме. */
        tileCheckerFill?: boolean,
        /** Режим клика по поверхности для выбора и инспекции тайла. */
        tilePick?: boolean,
        /** Показывать только контент выбранного кликом тайла. */
        tileIsolatePick?: boolean,
        /** Заморозка отбора: LOD считается от камеры на момент заморозки. */
        tileFreeze?: boolean,
        /** Пауза загрузки тайлов; после снятия очередь продолжает работу. */
        tilePaused?: boolean,
        /** Зажим уровня LOD: показывать не глубже выбранной глубины. */
        tileLodLock?: boolean,
        /** Выбранная глубина LOD при зажиме. */
        tileLodLevel?: number,
        /** Раскрашивать потоковый GSplat по реально выбранному движком LOD. */
        /** Красить блоки тайлсета в цвет их уровня детализации. */
        tileLodColor?: boolean,
        gsplatLodColor?: boolean,
        /** Показывать границы leaf-узлов spatial LOD и диагностический HUD. */
        gsplatNodeBounds?: boolean,
        /** Цвет границ GSplat-узлов: состояние стриминга или текущий LOD. */
        gsplatDebugMode?: 'state' | 'lod',
        /** Заморозить камеру, по которой движок выбирает spatial LOD. */
        gsplatFreeze?: boolean,
        /** Не запускать новые GSplat-загрузки; уже идущие запросы завершаются. */
        gsplatPaused?: boolean
    },
    animation: {
        playing: boolean,
        speed: number,
        transition: number,
        loops: number,
        list: string,
        progress: number,
        selectedTrack: string
    },
    scene: {
        urls: string[],
        filenames: string[],
        // Постоянный глобально уникальный идентификатор цифрового двойника.
        // Read-only: назначается согласованным источником сайта/API, не генерируется
        // локально. При отсутствии показывается состояние «не назначен».
        twinId?: string | null,
        nodes: string,
        selectedNode: {
            path: string,
            name?: string,
            position: {
                0: number,
                1: number,
                2: number
            },
            rotation: {
                0: number,
                1: number,
                2: number,
                3: number
            },
            scale: {
                0: number,
                1: number,
                2: number
            }
        },
        meshCount?: number,
        materialCount?: number,
        textureCount?: number,
        vertexCount?: number,
        primitiveCount?: number,
        textureVRAM?: number,
        meshVRAM?: number,
        bounds?: any,
        boundsCenter?: any,
        materialChannelsWithTextures?: string,
        materialChannelFilenames?: string,
        /** Формат текстуры по каналу (JSON): имя, сжатость для GPU, размер в пикселях. */
        materialChannelFormats?: string,
        selectedMaterialNames?: string,
        selectedMaterialFactors?: {
            metallicPercent: number | null,
            roughnessPercent: number | null,
            opacityPercent: number | null
        },
        selectedMaterialColor?: {
            r: number,
            g: number,
            b: number
        } | null,
        selectedSpecularColor?: {
            r: number,
            g: number,
            b: number
        } | null,
        availableUvSets?: string,
        texelDensitySummary?: string,
        texelDensityReport?: string,
        variant: {
            selected: number
        },
        variants: {
            list: string
        },
        loadTime?: number,
        cameras: string,
        selectedCamera: string,
        hasGsplat?: boolean,
        /** Все материалы сцены unlit (KHR_materials_unlit): свет на затенение не влияет. */
        unlit?: boolean,
        isTileset?: boolean,
        tilesetLit?: boolean | null,
        /** Глубина дерева тайлов — верх ползунка LOD в панели. */
        tilesetMaxDepth?: number
    },
    morphs?: Record<string, {
        name: string,
        targets: Record<string, MorphTargetData>
    }>,
    runtime: {
        activeDeviceType: string,
        // User-requested graphics backend: 'auto' | 'webgpu' | 'webgl'. Device-local, never stored in model settings.
        requestedBackend: 'auto' | 'webgpu' | 'webgl',
        /** Resolved gsplat renderer, e.g. 'GPU sort' / 'CPU sort'. Debug/diagnostics only. */
        gsplatRenderer: string,
        viewportWidth: number,
        viewportHeight: number
    },
    poi: {
        enabled: boolean,
        activeId?: string,
        list: string,
        playing?: boolean
    },
    measure: {
        enabled: boolean,
        unit: 'mm' | 'cm' | 'm',
        referenceRuler: boolean,
        /** Meters represented by 1 scene/model unit. */
        unitScale: number,
        /** Current active tool. */
        mode: 'distance' | 'angle' | 'area',
        /** Last measured distance in meters. */
        lastDistance: number | null,
        /** Last measured angle in degrees (0..180). */
        lastAngle: number | null,
        /** Last measured area in square meters. */
        lastArea: number | null,
        /** Max deviation of picked points from the best-fit plane, in meters. */
        areaPlanarity: number | null,
        /** How many points are already picked in the current measurement. */
        pointCount: number,
        /** Known real-world distance (in current unit) for recalibrating unitScale. */
        knownDistance: number,
        /** Warning shown when scene-scale calibration collapses multiple distance segments to one. */
        knownDistanceWarning: boolean
    },
    /** Temporary production clipping tool; intentionally excluded from model settings. */
    fragment: {
        enabled: boolean,
        selecting: boolean,
        invert: boolean,
        /** Подсвечивать линию, по которой бокс рассекает поверхность модели. */
        outline?: boolean,
        /** Толщина подсветки контура в пикселях. */
        outlineWidth?: number,
        editMode: 'move' | 'resize' | 'rotate',
        center: [number, number, number],
        size: [number, number, number],
        rotation: [number, number, number],
        initialized: boolean
    },
    dimensionBox: {
        enabled: boolean,
        initialized: boolean,
        /** Box dimensions in scene/model units. Real size = size * measure.unitScale. */
        size: [number, number, number],
        /** Box center in scene/model coordinates. */
        center: [number, number, number],
        /** Box orientation in world-space Euler degrees. */
        rotation: [number, number, number]
    },
    helpers?: {
        visible: boolean,
        editable: boolean,
        group: string,
        activeId?: string
    },
    /**
     * Legacy observer field kept for state compatibility. Runtime selection is always
     * automatic; `?webgl` is the only supported override.
     */
    graphicsBackend: 'auto' | 'webgl',
    centerScene: boolean,
    /**
     * Метаданные убраны из плеера — источник правды портал. Остаётся только
     * невидимый идентификатор для связи файла с записью инструмента (через ?id=).
     */
    metadata?: {
        identifier?: string;
    };
}

export type SetProperty = (path: string, value: any) => void;
