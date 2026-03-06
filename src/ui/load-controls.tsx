import { Container, Label, Button, TextInput } from '@playcanvas/pcui/react';
import React, { useRef, useState } from 'react';

import { t } from '../i18n/translations';
import { File, SetProperty, ObserverData } from '../types';

const validUrl = (url: string) => {
    try {
        /* eslint-disable-next-line no-new */
        new URL(url);
        return true;
    } catch {
        return false;
    }
};

const LoadControls = (props: { observerData: ObserverData; setProperty: SetProperty }) => {
    const [urlInputValid, setUrlInputValid] = useState(false);
    const inputFile = useRef<HTMLInputElement | null>(null);

    const onLoadButtonClick = () => {
        // `current` points to the mounted file input element
        inputFile.current?.click();
    };

    const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
        // `event` points to the selected file
        const viewer = window.viewer;
        const files = event.target.files;
        if (viewer && files && files.length > 0) {
            const loadList: Array<File> = [];
            for (let i = 0; i < files.length; ++i) {
                const file = files[i];
                loadList.push({
                    url: URL.createObjectURL(file),
                    filename: file.name,
                    sizeBytes: file.size
                });
            }
            viewer.loadFiles(loadList);
        }
    };

    const onUrlSelected = () => {
        const viewer = window.viewer;
        const inputElement = document.getElementById('glb-url-input') as (HTMLElement & { ui?: { value?: string } }) | null;
        const value = inputElement?.ui?.value;
        if (!value) return;
        const url = new URL(value);
        const filename = url.pathname.split('/').pop();
        const hasExtension = !!filename?.split('.').splice(1).pop();
        viewer.loadFiles([{
            url: value,
            filename: filename + (hasExtension ? '' : '.glb')
        }]);
    };

    const lang = props.observerData?.ui?.language;
    return (
        <div id='load-controls'>
            <Container class="load-button-panel" enabled flex>
                <div className='header'>
                    <img src={'static/heritage3d-logo.svg'}/>
                    <div>
                        <Label text='HERITAGE3D Viewer v1.0' />
                    </div>
                    <Button onClick={() => {
                        window.open('https://github.com/playcanvas/model-viewer', '_blank').focus();
                    }} icon='E259'/>
                </div>
                <input type='file' id='file' accept='.glb,.gltf,.ply,.json' multiple onChange={onFileSelected} ref={inputFile} style={{ display: 'none' }} />
                <div id="drag-drop" onClick={onLoadButtonClick}>
                    <Button id="drag-drop-search-icon" icon='E129' />
                    <Label class='desktop' text={t('Drag & drop .glb, .gltf, or .ply files, or click to open files', lang)} />
                    <Label class='mobile' text={t('Click to open files', lang)} />
                </div>
                <Label id='or-text' text={t('OR', lang)} class="centered-label" />
                <TextInput class='secondary' id='glb-url-input' placeholder='Enter .glb, .gltf, or .ply URL' keyChange onValidate={(value: string) => {
                    const isValid = validUrl(value);
                    setUrlInputValid(isValid);
                    return isValid;
                }}/>
                <Button class='secondary' id='glb-url-button' text={t('LOAD MODEL FROM URL', lang)} onClick={onUrlSelected} enabled={urlInputValid}></Button>
            </Container>
        </div>
    );
};

export default LoadControls;
