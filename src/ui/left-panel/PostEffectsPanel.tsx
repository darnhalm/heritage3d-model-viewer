import { Panel, Container, Button } from '@playcanvas/pcui/react';
import React, { useRef } from 'react';

import { t } from '../../i18n/translations';
import { SetProperty, ObserverData } from '../../types';
import { Slider, Toggle, Numeric, Select } from '../components';

interface PostEffectsPanelProps {
    observerData: ObserverData;
    setProperty: SetProperty;
}

const getViewerLut = () =>
    (window as unknown as { viewer?: { loadLutFromCubeFile?: (f: globalThis.File) => void; clearLut?: () => void } }).viewer;

const PostEffectsPanel: React.FC<PostEffectsPanelProps> = ({ observerData, setProperty }) => {
    const posteffects = observerData.posteffects;
    const lang = observerData.ui?.language || 'en';
    const lutFileRef = useRef<HTMLInputElement>(null);

    if (!posteffects) return null;

    const camera = observerData.camera;

    return (
        <Container id="effects-panel-content">
            <Select
                label={t('Tonemap', lang)}
                type='string'
                options={['None', 'Linear', 'Neutral', 'Filmic', 'Hejl', 'ACES', 'ACES2'].map(v => ({ v, t: v }))}
                value={camera?.tonemapping ?? 'Linear'}
                setProperty={(value: string) => setProperty('camera.tonemapping', value)}
            />

            {/* Bloom */}
            <Panel headerText="Bloom" collapsible={false}>
                <Toggle
                    label={t('Enabled', lang)}
                    value={!!posteffects.bloom?.enabled}
                    setProperty={(value: boolean) => setProperty('posteffects.bloom.enabled', value)}
                />
                <Slider
                    label={t('Intensity', lang)}
                    value={posteffects.bloom?.intensity || 0}
                    min={0}
                    max={5}
                    precision={2}
                    setProperty={(value: number) => setProperty('posteffects.bloom.intensity', value)}
                />
                <Slider
                    label={t('Threshold', lang)}
                    value={posteffects.bloom?.threshold || 0}
                    min={0}
                    max={1}
                    precision={2}
                    setProperty={(value: number) => setProperty('posteffects.bloom.threshold', value)}
                />
                <Numeric
                    label={t('Blur amount', lang)}
                    value={posteffects.bloom?.blurAmount || 0}
                    min={1}
                    max={20}
                    setProperty={(value: number) => setProperty('posteffects.bloom.blurAmount', value)}
                />
            </Panel>

            {/* SSAO */}
            <Panel headerText="SSAO" collapsible={false}>
                <Toggle
                    label={t('Enabled', lang)}
                    value={!!posteffects.ssao?.enabled}
                    setProperty={(value: boolean) => setProperty('posteffects.ssao.enabled', value)}
                />
                <Slider
                    label={t('Radius', lang)}
                    value={posteffects.ssao?.radius || 0}
                    min={0.01}
                    max={1}
                    precision={3}
                    setProperty={(value: number) => setProperty('posteffects.ssao.radius', value)}
                />
                <Slider
                    label={t('Intensity', lang)}
                    value={posteffects.ssao?.intensity || 0}
                    min={0}
                    max={5}
                    precision={2}
                    setProperty={(value: number) => setProperty('posteffects.ssao.intensity', value)}
                />
                <Numeric
                    label={t('Samples', lang)}
                    value={posteffects.ssao?.samples || 0}
                    min={4}
                    max={64}
                    setProperty={(value: number) => setProperty('posteffects.ssao.samples', value)}
                />
            </Panel>

            {/* Color Correction */}
            <Panel headerText={t('Color Correction', lang)} collapsible={false}>
                <Panel headerText={t('Brightness/Contrast', lang)} collapsible={false}>
                    <Toggle
                        label={t('Enabled', lang)}
                        value={!!posteffects.brightnessContrast?.enabled}
                        setProperty={(value: boolean) => setProperty('posteffects.brightnessContrast.enabled', value)}
                    />
                    <Slider
                        label={t('Brightness', lang)}
                        value={posteffects.brightnessContrast?.brightness || 0}
                        min={-1}
                        max={1}
                        precision={2}
                        setProperty={(value: number) => setProperty('posteffects.brightnessContrast.brightness', value)}
                    />
                    <Slider
                        label={t('Contrast', lang)}
                        value={posteffects.brightnessContrast?.contrast || 0}
                        min={-1}
                        max={1}
                        precision={2}
                        setProperty={(value: number) => setProperty('posteffects.brightnessContrast.contrast', value)}
                    />
                </Panel>

                <Panel headerText={t('Hue/Saturation', lang)} collapsible={false}>
                    <Toggle
                        label={t('Enabled', lang)}
                        value={!!posteffects.hueSaturation?.enabled}
                        setProperty={(value: boolean) => setProperty('posteffects.hueSaturation.enabled', value)}
                    />
                    <Slider
                        label={t('Hue', lang)}
                        value={posteffects.hueSaturation?.hue || 0}
                        min={-1}
                        max={1}
                        precision={2}
                        setProperty={(value: number) => setProperty('posteffects.hueSaturation.hue', value)}
                    />
                    <Slider
                        label={t('Saturation', lang)}
                        value={posteffects.hueSaturation?.saturation || 0}
                        min={-1}
                        max={1}
                        precision={2}
                        setProperty={(value: number) => setProperty('posteffects.hueSaturation.saturation', value)}
                    />
                </Panel>
            </Panel>

            {/* LUT (.cube) */}
            <Panel headerText={t('LUT', lang)} collapsible={false}>
                <Toggle
                    label={t('Enabled', lang)}
                    value={!!posteffects.lut?.enabled}
                    setProperty={(value: boolean) => setProperty('posteffects.lut.enabled', value)}
                    enabled={!!posteffects.lut?.fileName}
                />
                <Slider
                    label={t('Intensity', lang)}
                    value={posteffects.lut?.intensity ?? 1}
                    min={0}
                    max={1}
                    precision={2}
                    setProperty={(value: number) => setProperty('posteffects.lut.intensity', value)}
                    enabled={!!posteffects.lut?.fileName}
                />
                <input
                    ref={lutFileRef}
                    type="file"
                    accept=".cube,.CUBE,.lut,.LUT,text/plain"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                            getViewerLut()?.loadLutFromCubeFile?.(f);
                        }
                        e.target.value = '';
                    }}
                />
                <Container class={['effects-lut-action-row', 'effects-lut-dual-row']}>
                    <Button
                        class={['secondary', 'effects-lut-load-button']}
                        text={t('Load LUT file', lang)}
                        onClick={() => lutFileRef.current?.click()}
                    />
                    <Button
                        class={['secondary', 'effects-lut-clear-button']}
                        text={t('Clear LUT', lang)}
                        enabled={!!posteffects.lut?.fileName}
                        onClick={() => getViewerLut()?.clearLut?.()}
                    />
                </Container>
                {posteffects.lut?.fileName && (
                    <Container class="effects-lut-file-row">
                        <span className="lut-file-name">{posteffects.lut.fileName}</span>
                    </Container>
                )}
            </Panel>

            {/* Other Effects */}
            <Panel headerText={t('Other', lang)} collapsible={false}>
                <Toggle
                    label="FXAA"
                    value={!!posteffects.fxaa?.enabled}
                    setProperty={(value: boolean) => setProperty('posteffects.fxaa.enabled', value)}
                />
            </Panel>
        </Container>
    );
};

export default PostEffectsPanel;

