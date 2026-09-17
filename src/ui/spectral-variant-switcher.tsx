import React from 'react';

import { t } from '../i18n/translations';
import {
    classifySpectralMaterialVariant,
    ORIGINAL_VARIANT_COLOR_KEY,
    parseVariantColorMap,
    SpectralMaterialVariant
} from '../spectral-material-variants';
import { ObserverData, SetProperty } from '../types';

type VariantDot = {
    name: string;
    key: string;
    spectral: SpectralMaterialVariant;
};

const parseNames = (value?: string): string[] => {
    try {
        const names = JSON.parse(value ?? '[]');
        return Array.isArray(names) ? names.map(String) : [];
    } catch {
        return [];
    }
};

const spreadPositions = (variants: VariantDot[]): Map<string, number> => {
    const result = new Map<string, number>();
    const zoneRanges: Record<SpectralMaterialVariant['zone'], [number, number]> = {
        xray: [0, 0.22],
        uv: [0.22, 0.40],
        visible: [0.40, 0.67],
        infrared: [0.67, 1]
    };
    (Object.keys(zoneRanges) as Array<SpectralMaterialVariant['zone']>).forEach((zone) => {
        const candidates = variants.filter(variant => variant.spectral.zone === zone)
        .sort((a, b) => a.spectral.wavelengthNm - b.spectral.wavelengthNm || a.name.localeCompare(b.name));
        if (candidates.length === 1) {
            result.set(candidates[0].key, candidates[0].spectral.position);
            return;
        }
        if (candidates.length > 1) {
            const [start, end] = zoneRanges[zone];
            const margin = Math.max((end - start) * 0.1, 0.015);
            candidates.forEach((candidate, index) => {
                result.set(candidate.key, start + margin + (index / (candidates.length - 1)) * (end - start - margin * 2));
            });
        }
    });
    return result;
};

const SpectralVariantSwitcher = (props: { observerData: ObserverData; setProperty: SetProperty }) => {
    const [tooltip, setTooltip] = React.useState('');
    const names = parseNames(props.observerData.scene?.variants?.list);
    if (names.length === 0) return null;

    const selected = props.observerData.scene?.variant?.selected ?? '';
    const loading = props.observerData.scene?.variants?.loading ?? '';
    const lang = props.observerData.ui?.language;
    const colors = parseVariantColorMap(props.observerData.scene?.variants?.colors);
    const known: VariantDot[] = names.flatMap((name) => {
        const spectral = classifySpectralMaterialVariant(name);
        return spectral ? [{ name, key: name, spectral }] : [];
    });
    const positions = spreadPositions(known);
    const custom = [
        ...(colors[ORIGINAL_VARIANT_COLOR_KEY] ? [{ name: t('Original material', lang), key: '', color: colors[ORIGINAL_VARIANT_COLOR_KEY] }] : []),
        ...names.filter(name => !classifySpectralMaterialVariant(name) && colors[name])
        .map(name => ({ name, key: name, color: colors[name] }))
    ];

    if (known.length === 0 && custom.length === 0) return null;

    return (
        <div
            className={`spectral-variant-switcher${known.length > 0 ? ' has-scale' : ' custom-only'}`}
            aria-label='Material layer switcher'
        >
            {tooltip && <div className='spectral-variant-tooltip' role='tooltip'>{tooltip}</div>}
            {custom.length > 0 && (
                <div className='spectral-variant-custom-dots'>
                    {custom.map(variant => (
                        <button
                            key={variant.key || ORIGINAL_VARIANT_COLOR_KEY}
                            type='button'
                            className={`spectral-variant-custom-dot${selected === variant.key ? ' active' : ''}${loading && loading === variant.key ? ' loading' : ''}`}
                            style={{ '--spectral-chip-color': variant.color } as React.CSSProperties}
                            title={variant.name}
                            aria-label={variant.name}
                            onMouseEnter={() => setTooltip(variant.name)}
                            onMouseLeave={() => setTooltip('')}
                            onFocus={() => setTooltip(variant.name)}
                            onBlur={() => setTooltip('')}
                            onClick={() => props.setProperty('scene.variant.selected', variant.key)}
                        />
                    ))}
                </div>
            )}
            {known.length > 0 && (
                <div className='spectral-variant-scale'>
                    <div className='spectral-variant-zones' aria-hidden='true'>
                        <span style={{ width: '22%' }}>X-ray</span>
                        <span style={{ width: '18%' }}>UV</span>
                        <span style={{ width: '27%' }}>VIS</span>
                        <span style={{ width: '33%' }}>IR</span>
                    </div>
                    <div className='spectral-variant-bar'>
                        {known.map(variant => (
                            <button
                                key={variant.key}
                                type='button'
                                className={`spectral-variant-dot spectral-variant-dot-${variant.spectral.zone}${selected === variant.key ? ' active' : ''}${loading === variant.key ? ' loading' : ''}`}
                                style={{
                                    left: `${(positions.get(variant.key) ?? variant.spectral.position) * 100}%`,
                                    '--spectral-chip-color': variant.spectral.color
                                } as React.CSSProperties}
                                title={variant.name}
                                aria-label={variant.name}
                                onMouseEnter={() => setTooltip(variant.name)}
                                onMouseLeave={() => setTooltip('')}
                                onFocus={() => setTooltip(variant.name)}
                                onBlur={() => setTooltip('')}
                                onClick={() => props.setProperty('scene.variant.selected', variant.key)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SpectralVariantSwitcher;
