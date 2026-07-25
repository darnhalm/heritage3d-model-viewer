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
    ui: {
        fullscreen: boolean,
        active?: string,
        spinner: boolean,
        loadProgress?: number,
        loadingBackgroundReady?: boolean,
        error?: string,
        warnings?: string[],
        language?: 'en' | 'ru' | 'zh',
        embed?: {
            enabled: boolean,
            preset: 'full' | 'compact' | 'minimal',
            autoplay: boolean,
            animAutoplay: boolean,
            animControls: boolean,
            waiting?: boolean,
            placeholderUrl?: string | null,
            panel: boolean,
            poi: boolean,
            tour: boolean,
            measure: boolean,
            info: boolean,
            modelInfo: boolean,
            controls: boolean,
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
        position?: [number, number, number] | null,
        focus?: [number, number, number] | null
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
        alignmentGizmoMode?: 'move' | 'rotate',
        alignmentTarget?: 'model' | 'helper',
        normals: number,
        uvCheckerScale: number,
        selectedUvSet: number,
        withTextureOnly: boolean,
        texelDensityHeatmap?: boolean
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
        hasGsplat?: boolean
    },
    morphs?: Record<string, {
        name: string,
        targets: Record<string, MorphTargetData>
    }>,
    runtime: {
        activeDeviceType: string,
        viewportWidth: number,
        viewportHeight: number,
        xrSupported: boolean,
        xrActive: boolean
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
    dimensionBox: {
        enabled: boolean,
        /** Box dimensions in scene/model units. Real size = size * measure.unitScale. */
        size: [number, number, number],
        /** Box center in scene/model coordinates. */
        center: [number, number, number]
    },
    helpers?: {
        visible: boolean,
        editable: boolean,
        group: string,
        activeId?: string
    },
    posteffects?: {
        bloom: { enabled: boolean; intensity: number; threshold: number; blurAmount: number };
        ssao: { enabled: boolean; radius: number; intensity: number; samples: number };
        brightnessContrast: { enabled: boolean; brightness: number; contrast: number };
        hueSaturation: { enabled: boolean; hue: number; saturation: number };
        lut: { enabled: boolean; intensity: number; fileName: string | null };
        fxaa: { enabled: boolean };
    },
    enableWebGPU: boolean,
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
