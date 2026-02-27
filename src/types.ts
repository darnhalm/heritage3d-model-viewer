export interface MorphTargetData {
    name: string,
    targetIndex: number,
    weight?: number
}

export interface File {
    url: string,
    filename?: string
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
        error?: string,
        warnings?: string[],
        language?: 'en' | 'ru' | 'zh',
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
        materialChannelsWithTextures?: string,
        materialChannelFilenames?: string,
        selectedMaterialNames?: string,
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
        selectedCamera: string
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
    measure: {
        enabled: boolean,
        unit: 'mm' | 'cm' | 'm',
        /** Meters represented by 1 scene/model unit. */
        unitScale: number,
        /** Last measured distance in meters. */
        lastDistance: number | null,
        pointCount: 0 | 1,
        /** Known real-world distance (in current unit) for recalibrating unitScale. */
        knownDistance: number
    },
    enableWebGPU: boolean,
    centerScene: boolean,
    /** Dublin Core metadata */
    metadata?: {
        title?: string;
        creator?: string;
        subject?: string;
        description?: string;
        publisher?: string;
        contributor?: string;
        date?: string;
        type?: string;
        format?: string;
        identifier?: string;
        source?: string;
        language?: string;
        relation?: string;
        coverage?: string;
        rights?: string;
        /** ЕГРОКН — объект в реестре культурного наследия */
        egrokn?: boolean;
        /** Уровень значения: федеральный, региональный, муниципальный */
        egroknLevel?: 'federal' | 'regional' | 'municipal';
        /** Номер объекта */
        objectNumber?: string;
        /** Музейный предмет */
        isMuseumItem?: boolean;
        /** Ссылка на Госкаталог */
        goskatalogLink?: string;
    };
}

export type SetProperty = (path: string, value: any) => void;

export const DUBLIN_CORE_KEYS = ['title', 'creator', 'subject', 'description', 'publisher', 'contributor', 'date', 'type', 'format', 'identifier', 'source', 'language', 'relation', 'coverage', 'rights'] as const;
