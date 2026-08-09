const isEmbedMode = () => {
    if (typeof window === 'undefined') return false;
    const value = new URL(window.location.href).searchParams.get('embed');
    return value === '1' || value === 'true';
};

const parseHttpOrigin = (value: string | null | undefined): string | null => {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
    } catch {
        return null;
    }
};

const getReferrerOrigin = (): string | null => {
    if (typeof document === 'undefined') return null;
    return parseHttpOrigin(document.referrer);
};

// Explicit parentOrigin wins; the iframe referrer is a safe zero-config fallback.
const getEmbedParentOrigin = (): string | null => {
    if (typeof window === 'undefined' || !isEmbedMode()) return null;
    const explicit = parseHttpOrigin(new URL(window.location.href).searchParams.get('parentOrigin'));
    return explicit ?? getReferrerOrigin();
};

// Standalone keeps its legacy local integration behavior. Embed accepts messages from
// itself or from its direct parent at the configured/referrer origin only.
const isTrustedViewerMessage = (event: MessageEvent): boolean => {
    if (!isEmbedMode()) return true;
    if (event.source === window) return event.origin === window.location.origin;
    if (event.source !== window.parent) return false;
    const parentOrigin = getEmbedParentOrigin();
    return parentOrigin !== null && event.origin === parentOrigin;
};

// Send an event to the host without using a wildcard in embed mode.
const postToViewerParent = (message: unknown): boolean => {
    if (typeof window === 'undefined' || window.parent === window) return false;
    const targetOrigin = isEmbedMode() ? getEmbedParentOrigin() : '*';
    if (!targetOrigin) return false;
    try {
        window.parent.postMessage(message, targetOrigin);
        return true;
    } catch {
        return false;
    }
};

// Reply to the exact origin that sent an already trusted request.
const replyToViewerMessage = (event: MessageEvent, message: unknown): boolean => {
    const target = event.source as Window | null;
    if (!target || !isTrustedViewerMessage(event)) return false;
    const targetOrigin = event.origin && event.origin !== 'null' ? event.origin : '*';
    try {
        target.postMessage(message, targetOrigin);
        return true;
    } catch {
        return false;
    }
};

export {
    getEmbedParentOrigin,
    isEmbedMode,
    isTrustedViewerMessage,
    postToViewerParent,
    replyToViewerMessage
};
