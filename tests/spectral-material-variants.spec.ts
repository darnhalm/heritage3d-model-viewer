import { expect, test } from '@playwright/test';

import {
    classifySpectralMaterialVariant,
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
