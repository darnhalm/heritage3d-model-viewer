import React from 'react';

import { t } from '../i18n/translations';
import { SetProperty, ObserverData } from '../types';

class SelectedNode extends React.Component < { observerData: ObserverData; setProperty: SetProperty } > {
    shouldComponentUpdate(nextProps: Readonly<{ observerData: ObserverData; setProperty: SetProperty; }>): boolean {
        const a = nextProps.observerData;
        const b = this.props.observerData;
        return (
            a.scene?.nodes !== b.scene?.nodes ||
            a.scene?.selectedNode?.path !== b.scene?.selectedNode?.path ||
            a.scene?.selectedNode?.name !== b.scene?.selectedNode?.name ||
            a.scene?.selectedNode?.position !== b.scene?.selectedNode?.position ||
            a.scene?.selectedNode?.rotation !== b.scene?.selectedNode?.rotation ||
            a.scene?.selectedNode?.scale !== b.scene?.selectedNode?.scale ||
            a.scene?.selectedMaterialNames !== b.scene?.selectedMaterialNames ||
            a.scene?.variants?.list !== b.scene?.variants?.list ||
            a.scene?.variant?.selected !== b.scene?.variant?.selected ||
            a.scene?.availableUvSets !== b.scene?.availableUvSets ||
            a.debug?.selectedUvSet !== b.debug?.selectedUvSet ||
            a.scene?.texelDensitySummary !== b.scene?.texelDensitySummary ||
            a.scene?.texelDensityReport !== b.scene?.texelDensityReport ||
            a.ui?.language !== b.ui?.language
        );
    }

    private renderDetail(label: string, value: string | number, multiline = false) {
        return (
            <div className={`panel-option${multiline ? ' selected-node-detail-multiline' : ''}`}>
                <div className='panel-label'>{label}</div>
                <div className='panel-value' title={String(value)}>{String(value)}</div>
            </div>
        );
    }

    render() {
        const { observerData, setProperty } = this.props;
        const scene = observerData.scene;
        const lang = observerData?.ui?.language;
        if (!scene) return null;
        const hasHierarchy = scene.nodes !== '[]';
        const nodeSelected = scene.selectedNode.path;
        const selectedMaterialNames = (() => {
            try {
                const parsed = JSON.parse(scene?.selectedMaterialNames ?? '[]');
                return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
            } catch {
                return [];
            }
        })();
        const variantListOptions: Array<{ v: string; t: string }> = (() => {
            try {
                const parsed = JSON.parse(scene?.variants?.list ?? '[]');
                return Array.isArray(parsed) ? parsed.map((v: string) => ({ v: String(v), t: String(v) })) : [];
            } catch {
                return [];
            }
        })();
        const uvSetOptions: Array<{ v: number; t: string }> = (() => {
            try {
                const parsed = JSON.parse(scene?.availableUvSets ?? '[]');
                return Array.isArray(parsed) ? parsed.map((v: number) => ({ v: Number(v), t: `UV${Number(v)}` })) : [];
            } catch {
                return [];
            }
        })();
        const activeUvSetLabel = uvSetOptions.length > 0 ?
            (uvSetOptions.find(option => option.v === (observerData?.debug?.selectedUvSet ?? 0))?.t ?? `UV${observerData?.debug?.selectedUvSet ?? 0}`) :
            '-';
        const texelDensityEntries = (() => {
            try {
                const parsed = JSON.parse(scene?.texelDensityReport ?? '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        })();
        const texelDensityPrimary = texelDensityEntries[0] as {
            resolution?: string;
            channel?: string;
            triangles?: number;
            worldAreaM2?: number;
        } | undefined;
        const texelDensityLines = String(scene?.texelDensitySummary || 'n/a')
        .split('|')
        .map(part => part.trim())
        .filter(Boolean);

        return hasHierarchy && nodeSelected ? (
            <div className='selected-node-panel-parent'>
                <div className='selected-node-panel'>
                    {this.renderDetail(t('Name', lang), scene.selectedNode.name || '-', true)}
                    {this.renderDetail(t('Material', lang), selectedMaterialNames.length > 0 ? selectedMaterialNames.join(', ') : '-', true)}

                    {variantListOptions.length > 0 && (
                        <div className='panel-option'>
                            <div className='panel-label'>{t('Material Variant', lang)}</div>
                            <select
                                className='panel-value selected-node-native-select'
                                value={scene?.variant?.selected ?? ''}
                                onChange={event => setProperty('scene.variant.selected', event.target.value)}
                            >
                                {variantListOptions.map(option => (
                                    <option key={option.v} value={option.v}>{option.t}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {this.renderDetail(t('Active UV', lang), activeUvSetLabel)}

                    {uvSetOptions.length > 1 && (
                        <div className='panel-option'>
                            <div className='panel-label'>{t('UV Set', lang)}</div>
                            <select
                                className='panel-value selected-node-native-select'
                                value={String(observerData?.debug?.selectedUvSet ?? 0)}
                                onChange={event => setProperty('debug.selectedUvSet', Number(event.target.value))}
                            >
                                {uvSetOptions.map(option => (
                                    <option key={option.v} value={String(option.v)}>{option.t}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className='panel-option selected-node-multiline-detail'>
                        <div className='panel-label'>{t('Texel Density', lang)}</div>
                        <div className='panel-value selected-node-multiline-value'>
                            {texelDensityLines.map((line, index) => (
                                <div key={`${line}-${index}`}>{line}</div>
                            ))}
                        </div>
                    </div>

                    {texelDensityPrimary && (
                        <>
                            {this.renderDetail(t('Texture Size', lang), texelDensityPrimary.resolution || '-')}
                            {this.renderDetail(t('Texture Channel', lang), texelDensityPrimary.channel || '-')}
                            {this.renderDetail(t('Triangles', lang), texelDensityPrimary.triangles ?? '-')}
                            {this.renderDetail(t('Surface Area', lang), String(texelDensityPrimary.worldAreaM2 ?? '-'))}
                        </>
                    )}
                </div>
            </div>
        ) : null;
    }
}

export default SelectedNode;
