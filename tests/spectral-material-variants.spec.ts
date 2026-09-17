import { expect, test } from '@playwright/test';

import {
    classifySpectralMaterialVariant,
    nextSpectralVariantKey,
    parseVariantColorMap
} from '../src/spectral-material-variants';

test('spectral material codes require an explicit uppercase marker', () => {
    expect(classifySpectralMaterialVariant('Harpocrates IRR')).toBeNull();
    expect(classifySpectralMaterialVariant('Harpocrates @irr')).toBeNull();
    expect(classifySpectralMaterialVariant('Harpocrates @850NM')).toBeNull();
    expect(classifySpectralMaterialVariant('Harpocrates @IRR')?.code).toBe('IRR');
});

test('longest marked spectral alias wins', () => {
    expect(classifySpectralMaterialVariant('Harpocrates @IRRFC')?.code).toBe('IRFC');
    expect(classifySpectralMaterialVariant('Harpocrates @UVRFC')?.code).toBe('UVFC');
    expect(classifySpectralMaterialVariant('Harpocrates @VIL')?.code).toBe('VIL');
});

test('manual variant colors accept only complete hexadecimal colors', () => {
    expect(parseVariantColorMap({ VIS: '#AABBCC', disabled: '#000000', broken: '#123', numeric: 123 }))
    .toEqual({ VIS: '#aabbcc' });
});

test('spectrum zone navigation cycles its markers and falls back to the nearest marker', () => {
    const variants = [
        { key: 'Visible', position: 0.55 },
        { key: 'IR 850', position: 0.72 },
        { key: 'IR 1000', position: 0.84 }
    ];
    expect(nextSpectralVariantKey(variants, 'Visible', 0.67, 1)).toBe('IR 850');
    expect(nextSpectralVariantKey(variants, 'IR 850', 0.67, 1)).toBe('IR 1000');
    expect(nextSpectralVariantKey(variants, 'IR 1000', 0.67, 1)).toBe('IR 850');
    expect(nextSpectralVariantKey(variants, 'Visible', 0.22, 0.40)).toBe('Visible');
});
