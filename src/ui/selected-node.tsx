import { Container } from '@playcanvas/pcui/react';
import React from 'react';

import { SetProperty, ObserverData } from '../types';
import { Vector, Detail, Select } from './components';
import { t } from '../i18n/translations';

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
        const activeUvSetLabel = uvSetOptions.find((option) => option.v === (observerData?.debug?.selectedUvSet ?? 0))?.t ?? `UV${observerData?.debug?.selectedUvSet ?? 0}`;
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
        return hasHierarchy && nodeSelected ? (
            <div className='selected-node-panel-parent'>
                <Container class='selected-node-panel' flex>
                    <Detail label={t('Name', lang)} value={scene.selectedNode.name || '-'} />
                    <Vector label={t('Position', lang)} dimensions={3} value={scene.selectedNode.position} enabled={false}/>
                    <Vector label={t('Rotation', lang)} dimensions={3} value={scene.selectedNode.rotation} enabled={false}/>
                    <Vector label={t('Scale', lang)} dimensions={3} value={scene.selectedNode.scale} enabled={false}/>
                    <Detail label={t('Material', lang)} value={selectedMaterialNames.length > 0 ? selectedMaterialNames.join(', ') : '-'} />
                    {variantListOptions.length > 0 && (
                        <Select
                            label={t('Material Variant', lang)}
                            type='string'
                            options={variantListOptions}
                            value={scene?.variant?.selected ?? ''}
                            setProperty={(value: string) => setProperty('scene.variant.selected', value)}
                            enabled={true}
                        />
                    )}
                    <Detail label={t('Active UV', lang)} value={activeUvSetLabel} />
                    {uvSetOptions.length > 1 && (
                        <Select
                            label={t('UV Set', lang)}
                            type='number'
                            options={uvSetOptions}
                            selectKey={`${scene?.availableUvSets ?? '[]'}:${observerData?.debug?.selectedUvSet ?? 0}`}
                            value={observerData?.debug?.selectedUvSet ?? 0}
                            setProperty={(value: number) => setProperty('debug.selectedUvSet', value)}
                            enabled={true}
                        />
                    )}
                    <Detail label={t('Texel Density', lang)} value={scene?.texelDensitySummary || 'n/a'} />
                    {texelDensityPrimary && (
                        <>
                            <Detail label={t('Texture Size', lang)} value={texelDensityPrimary.resolution || '-'} />
                            <Detail label={t('Texture Channel', lang)} value={texelDensityPrimary.channel || '-'} />
                            <Detail label={t('Triangles', lang)} value={texelDensityPrimary.triangles ?? '-'} />
                            <Detail label={t('Surface Area', lang)} value={String(texelDensityPrimary.worldAreaM2 ?? '-')} />
                        </>
                    )}
                </Container>
            </div>
        ) : null;
    }
}

export default SelectedNode;
