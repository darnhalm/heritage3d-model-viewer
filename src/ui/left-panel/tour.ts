import { driver, type DriveStep } from 'driver.js';

import { t } from '../../i18n/translations';

// Inlined driver.js CSS (v1.4.0) + small dark-theme tweaks for HERITAGE3D viewer.
// This avoids touching the Rollup/SASS pipeline just to ship one extra stylesheet.
const DRIVER_CSS = '.driver-active .driver-overlay,.driver-active *{pointer-events:none}.driver-active .driver-active-element,.driver-active .driver-active-element *,.driver-popover,.driver-popover *{pointer-events:auto}@keyframes animate-fade-in{0%{opacity:0}to{opacity:1}}.driver-fade .driver-overlay{animation:animate-fade-in .2s ease-in-out}.driver-fade .driver-popover{animation:animate-fade-in .2s}.driver-popover{all:unset;box-sizing:border-box;color:#2d2d2d;margin:0;padding:15px;border-radius:5px;min-width:250px;max-width:300px;box-shadow:0 1px 10px #0006;z-index:1000000000;position:fixed;top:0;right:0;background-color:#fff}.driver-popover *{font-family:Helvetica Neue,Inter,ui-sans-serif,"Apple Color Emoji",Helvetica,Arial,sans-serif}.driver-popover-title{font:19px/normal sans-serif;font-weight:700;display:block;position:relative;line-height:1.5;zoom:1;margin:0}.driver-popover-close-btn{all:unset;position:absolute;top:0;right:0;width:32px;height:28px;cursor:pointer;font-size:18px;font-weight:500;color:#d2d2d2;z-index:1;text-align:center;transition:color;transition-duration:.2s}.driver-popover-close-btn:hover,.driver-popover-close-btn:focus{color:#2d2d2d}.driver-popover-title[style*=block]+.driver-popover-description{margin-top:5px}.driver-popover-description{margin-bottom:0;font:14px/normal sans-serif;line-height:1.5;font-weight:400;zoom:1}.driver-popover-footer{margin-top:15px;text-align:right;zoom:1;display:flex;align-items:center;justify-content:space-between}.driver-popover-progress-text{font-size:13px;font-weight:400;color:#727272;zoom:1}.driver-popover-footer button{all:unset;display:inline-block;box-sizing:border-box;padding:3px 7px;text-decoration:none;text-shadow:1px 1px 0 #fff;background-color:#fff;color:#2d2d2d;font:12px/normal sans-serif;cursor:pointer;outline:0;zoom:1;line-height:1.3;border:1px solid #ccc;border-radius:3px}.driver-popover-footer .driver-popover-btn-disabled{opacity:.5;pointer-events:none}:not(body):has(>.driver-active-element){overflow:hidden!important}.driver-no-interaction,.driver-no-interaction *{pointer-events:none!important}.driver-popover-footer button:hover,.driver-popover-footer button:focus{background-color:#f7f7f7}.driver-popover-navigation-btns{display:flex;flex-grow:1;justify-content:flex-end}.driver-popover-navigation-btns button+button{margin-left:4px}.driver-popover-arrow{content:"";position:absolute;border:5px solid #fff}.driver-popover-arrow-side-over{display:none}.driver-popover-arrow-side-left{left:100%;border-right-color:transparent;border-bottom-color:transparent;border-top-color:transparent}.driver-popover-arrow-side-right{right:100%;border-left-color:transparent;border-bottom-color:transparent;border-top-color:transparent}.driver-popover-arrow-side-top{top:100%;border-right-color:transparent;border-bottom-color:transparent;border-left-color:transparent}.driver-popover-arrow-side-bottom{bottom:100%;border-left-color:transparent;border-top-color:transparent;border-right-color:transparent}.driver-popover-arrow-side-center{display:none}.driver-popover-arrow-side-left.driver-popover-arrow-align-start,.driver-popover-arrow-side-right.driver-popover-arrow-align-start{top:15px}.driver-popover-arrow-side-top.driver-popover-arrow-align-start,.driver-popover-arrow-side-bottom.driver-popover-arrow-align-start{left:15px}.driver-popover-arrow-align-end.driver-popover-arrow-side-left,.driver-popover-arrow-align-end.driver-popover-arrow-side-right{bottom:15px}.driver-popover-arrow-side-top.driver-popover-arrow-align-end,.driver-popover-arrow-side-bottom.driver-popover-arrow-align-end{right:15px}.driver-popover-arrow-side-left.driver-popover-arrow-align-center,.driver-popover-arrow-side-right.driver-popover-arrow-align-center{top:50%;margin-top:-5px}.driver-popover-arrow-side-top.driver-popover-arrow-align-center,.driver-popover-arrow-side-bottom.driver-popover-arrow-align-center{left:50%;margin-left:-5px}.driver-popover-arrow-none{display:none}';

const THEME_CSS = `
.driver-popover.h3d-tour-popover {
    background-color: #1f2937;
    color: #f5f7fa;
    border: 1px solid #3a4250;
    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
}
.driver-popover.h3d-tour-popover .driver-popover-title {
    color: #ffffff;
    font-size: 16px;
}
.driver-popover.h3d-tour-popover .driver-popover-description {
    color: #d7dce5;
    font-size: 13px;
}
.driver-popover.h3d-tour-popover .driver-popover-footer button {
    background-color: #2a3341;
    color: #e5e7eb;
    border: 1px solid #3a4250;
    text-shadow: none;
}
.driver-popover.h3d-tour-popover .driver-popover-footer button:hover,
.driver-popover.h3d-tour-popover .driver-popover-footer button:focus {
    background-color: #88bce8;
    color: #0d1520;
    border-color: #88bce8;
}
.driver-popover.h3d-tour-popover .driver-popover-close-btn {
    color: #9ba4b3;
}
.driver-popover.h3d-tour-popover .driver-popover-close-btn:hover,
.driver-popover.h3d-tour-popover .driver-popover-close-btn:focus {
    color: #ffffff;
}
.driver-popover.h3d-tour-popover .driver-popover-progress-text {
    color: #9ba4b3;
}
.driver-popover.h3d-tour-popover .driver-popover-arrow {
    border-color: #1f2937;
}
.driver-popover.h3d-tour-popover.driver-popover-arrow-side-left .driver-popover-arrow { border-left-color: #1f2937; }
.driver-popover.h3d-tour-popover.driver-popover-arrow-side-right .driver-popover-arrow { border-right-color: #1f2937; }
.driver-popover.h3d-tour-popover.driver-popover-arrow-side-top .driver-popover-arrow { border-top-color: #1f2937; }
.driver-popover.h3d-tour-popover.driver-popover-arrow-side-bottom .driver-popover-arrow { border-bottom-color: #1f2937; }

.left-panel-tour-button {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 4px;
    border-radius: 50%;
    background-color: rgba(136, 188, 232, 0.15);
    color: #88bce8;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
    flex-shrink: 0;
}
.left-panel-tour-button:hover,
.left-panel-tour-button:focus {
    background-color: #88bce8;
    color: #0d1520;
}
`;

const STYLE_ID = 'h3d-tour-styles';
const TOUR_SEEN_KEY = 'h3d.tour.v1.seen';

let stylesInjected = false;
const ensureStyles = () => {
    if (stylesInjected || typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) {
        stylesInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `${DRIVER_CSS}\n${THEME_CSS}`;
    document.head.appendChild(style);
    stylesInjected = true;
};

const expandLeftPanel = () => {
    const leftPanel = document.getElementById('panel-left');
    if (leftPanel && !leftPanel.classList.contains('expanded')) {
        leftPanel.classList.add('expanded');
    }
};

const switchToSceneTab = () => {
    // The Settings ("scene") tab is the tab we're explaining — activate it if the user is elsewhere.
    const tab = document.querySelector<HTMLButtonElement>('.left-panel-tab-scene');
    if (tab && !tab.classList.contains('active')) {
        tab.click();
    }
};

const waitForElement = (selector: string, timeoutMs = 1500): Promise<HTMLElement | null> => {
    return new Promise((resolve) => {
        const existing = document.querySelector<HTMLElement>(selector);
        if (existing) {
            resolve(existing);
            return;
        }
        const start = Date.now();
        const timer = window.setInterval(() => {
            const element = document.querySelector<HTMLElement>(selector);
            if (element) {
                window.clearInterval(timer);
                resolve(element);
            } else if (Date.now() - start >= timeoutMs) {
                window.clearInterval(timer);
                resolve(null);
            }
        }, 50);
    });
};

type Lang = string | undefined;

type StepDef = {
    // Tab that must be active for this step; `null` means the step is global
    // (e.g. the measurement button lives in the bottom popup, outside the tabs).
    switchTab: string | null;
    // Primary element to highlight.
    elementSelector: string;
    // Fallback if the primary element isn't in the DOM yet (e.g. React
    // hasn't re-rendered after a tab click).
    fallbackSelector: string;
    titleKey: string;
    bodyKey: string;
    side?: 'top' | 'right' | 'bottom' | 'left' | 'over';
    align?: 'start' | 'center' | 'end';
};

const STEP_DEFS: StepDef[] = [
    {
        switchTab: '.left-panel-tab-alignment',
        elementSelector: '#alignment-panel',
        fallbackSelector: '.left-panel-tab-alignment',
        titleKey: 'Tour: Alignment title',
        bodyKey: 'Tour: Alignment body',
        side: 'right',
        align: 'start'
    },
    {
        switchTab: null,
        elementSelector: '#measurement-button',
        fallbackSelector: '#measurement-button',
        titleKey: 'Tour: Measurement title',
        bodyKey: 'Tour: Measurement body',
        side: 'left',
        align: 'center'
    },
    {
        switchTab: '.left-panel-tab-scene',
        elementSelector: '#camera-panel',
        fallbackSelector: '.left-panel-tab-scene',
        titleKey: 'Tour: Camera title',
        bodyKey: 'Tour: Camera body',
        side: 'right',
        align: 'start'
    },
    {
        switchTab: '.left-panel-tab-scene',
        elementSelector: '#sky-panel',
        fallbackSelector: '.left-panel-tab-scene',
        titleKey: 'Tour: Background title',
        bodyKey: 'Tour: Background body',
        side: 'right',
        align: 'start'
    },
    {
        switchTab: '.left-panel-tab-scene',
        elementSelector: '#light-panel',
        fallbackSelector: '.left-panel-tab-scene',
        titleKey: 'Tour: Light title',
        bodyKey: 'Tour: Light body',
        side: 'right',
        align: 'start'
    },
    {
        switchTab: '.left-panel-tab-poi',
        elementSelector: '#poi-panel',
        fallbackSelector: '.left-panel-tab-poi',
        titleKey: 'Tour: POI title',
        bodyKey: 'Tour: POI body',
        side: 'right',
        align: 'start'
    },
    {
        switchTab: '.left-panel-tab-metadata',
        elementSelector: '#metadata-panel',
        fallbackSelector: '.left-panel-tab-metadata',
        titleKey: 'Tour: Metadata title',
        bodyKey: 'Tour: Metadata body',
        side: 'right',
        align: 'start'
    },
    {
        switchTab: '.left-panel-tab-scene',
        elementSelector: '.export-settings-button',
        fallbackSelector: '.left-panel-tab-scene',
        titleKey: 'Tour: Export title',
        bodyKey: 'Tour: Export body',
        side: 'right',
        align: 'end'
    }
];

const clickTabIfNeeded = (selector: string | null): boolean => {
    if (!selector) return false;
    const btn = document.querySelector<HTMLButtonElement>(selector);
    if (!btn) return false;
    if (btn.classList.contains('active')) return false;
    btn.click();
    return true;
};

// Give React a moment to re-render after a tab click before we re-highlight.
const TAB_RENDER_DELAY_MS = 140;

let activeDriver: ReturnType<typeof driver> | null = null;

const buildDriveSteps = (defs: StepDef[], lang: Lang): DriveStep[] => {
    return defs.map((def, index) => ({
        element: () => {
            const primary = document.querySelector<HTMLElement>(def.elementSelector);
            if (primary) return primary;
            const fallback = document.querySelector<HTMLElement>(def.fallbackSelector);
            return fallback ?? document.body;
        },
        popover: {
            title: t(def.titleKey, lang),
            description: t(def.bodyKey, lang),
            side: def.side,
            align: def.align,
            onNextClick: () => {
                const drv = activeDriver;
                if (!drv) return;
                const nextDef = defs[index + 1];
                if (!nextDef) {
                    drv.destroy();
                    return;
                }
                const switched = nextDef.switchTab && nextDef.switchTab !== def.switchTab ?
                    clickTabIfNeeded(nextDef.switchTab) :
                    false;
                if (switched) {
                    window.setTimeout(() => drv.moveNext(), TAB_RENDER_DELAY_MS);
                } else {
                    drv.moveNext();
                }
            },
            onPrevClick: () => {
                const drv = activeDriver;
                if (!drv) return;
                const prevDef = defs[index - 1];
                if (!prevDef) return;
                const switched = prevDef.switchTab && prevDef.switchTab !== def.switchTab ?
                    clickTabIfNeeded(prevDef.switchTab) :
                    false;
                if (switched) {
                    window.setTimeout(() => drv.movePrevious(), TAB_RENDER_DELAY_MS);
                } else {
                    drv.movePrevious();
                }
            }
        }
    }));
};

// Keep only step definitions whose *fallback* element is in the DOM. This way
// embed / gsplat / non-enabled tabs don't get highlighted as empty popovers.
const filterAvailable = (defs: StepDef[]): StepDef[] => {
    return defs.filter(def => !!document.querySelector(def.fallbackSelector) ||
        !!document.querySelector(def.elementSelector));
};

export const startLeftPanelTour = async (lang: Lang): Promise<void> => {
    ensureStyles();
    expandLeftPanel();

    const availableDefs = filterAvailable(STEP_DEFS);
    if (availableDefs.length === 0) return;

    // Make sure the very first step's tab is active before we start highlighting.
    const firstDef = availableDefs[0];
    if (firstDef.switchTab) {
        clickTabIfNeeded(firstDef.switchTab);
    } else {
        switchToSceneTab();
    }

    await waitForElement(firstDef.elementSelector, 1500);

    if (activeDriver) {
        try {
            activeDriver.destroy();
        } catch { /* no-op */ }
        activeDriver = null;
    }

    const driveSteps = buildDriveSteps(availableDefs, lang);

    activeDriver = driver({
        animate: true,
        allowClose: true,
        showProgress: true,
        popoverClass: 'h3d-tour-popover',
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 6,
        smoothScroll: true,
        nextBtnText: t('Next', lang),
        prevBtnText: t('Previous', lang),
        doneBtnText: t('Done', lang),
        progressText: '{{current}} / {{total}}',
        steps: driveSteps,
        onDestroyed: () => {
            try {
                window.localStorage?.setItem(TOUR_SEEN_KEY, '1');
            } catch {
                /* storage may be unavailable */
            }
            activeDriver = null;
        }
    });

    activeDriver.drive();
};

export const hasSeenTour = (): boolean => {
    try {
        return window.localStorage?.getItem(TOUR_SEEN_KEY) === '1';
    } catch {
        return true;
    }
};

export const markTourSeen = (): void => {
    try {
        window.localStorage?.setItem(TOUR_SEEN_KEY, '1');
    } catch {
        /* no-op */
    }
};

// Fires once per browser (persisted in localStorage) and is intended to be
// called from the left-panel expand handler — so the tour is tied to the
// user actually opening the settings panel, not to player startup.
export const maybeAutoStartTour = (lang: Lang): void => {
    if (hasSeenTour()) return;
    const leftPanel = document.getElementById('panel-left');
    if (!leftPanel || !leftPanel.classList.contains('expanded')) {
        // Panel isn't actually open — nothing to tour.
        return;
    }
    // Mark as seen up-front so rapid toggling of the panel doesn't re-trigger
    // the tour; re-running it later is still available via the (?) button.
    markTourSeen();
    // Let the expand animation settle for a beat before we start highlighting.
    window.setTimeout(() => startLeftPanelTour(lang), 250);
};
