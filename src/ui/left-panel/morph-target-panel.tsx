import { Panel } from '@playcanvas/pcui/react';
import React from 'react';
import { InView } from 'react-intersection-observer';

import { MorphTargetData, SetProperty, ObserverData } from '../../types';
import { MorphSlider } from '../components';

class MorphTargetPanel extends React.Component <{ morphs: ObserverData['morphs'], progress: number, setProperty: SetProperty, headerText?: string, bare?: boolean }> {
    shouldComponentUpdate(nextProps: Readonly<{ morphs: ObserverData['morphs']; progress: number; setProperty: SetProperty; headerText?: string; bare?: boolean; }>): boolean {
        return (
            JSON.stringify(nextProps.morphs) !== JSON.stringify(this.props.morphs) ||
            nextProps.headerText !== this.props.headerText ||
            nextProps.bare !== this.props.bare
        );
    }

    render() {
        const morphs = this.props.morphs;
        if (!morphs || Object.keys(morphs).length === 0) return null;
        const content = Object.keys(morphs).map((morphIndex) => {
            const morph = morphs[morphIndex];
            return (
                <div key={`${morphIndex}.${morph.name}`}>
                    <Panel headerText={morph.name} collapsible class='morph-target-panel'>
                        {Object.keys(morph.targets).map((targetIndex: string) => {
                            const morphTarget: MorphTargetData = morph.targets[targetIndex];
                            return <div key={targetIndex}>
                                <InView rootMargin="750px 0px">
                                    {({ inView, ref }) => (
                                        <div ref={ref}>{
                                            inView ?
                                                <MorphSlider name={`${morphTarget.name}`} precision={2} min={0} max={1}
                                                    value={morphTarget.weight}
                                                    setProperty={(value: number) => this.props.setProperty(`morphs.${morphIndex}.targets.${targetIndex}.weight`, value)}
                                                /> :
                                                <div style={{ width: 30, height: 30 }}></div>
                                        }</div>
                                    )}
                                </InView>
                            </div>;
                        })}
                    </Panel>
                </div>
            );
        });
        return this.props.bare ? (
            <div className='scene-morph-panel'>{content}</div>
        ) : (
            <Panel headerText={this.props.headerText ?? 'Morph targets'} class='scene-morph-panel' collapsible={false}>{content}</Panel>
        );
    }
}

export default MorphTargetPanel;
