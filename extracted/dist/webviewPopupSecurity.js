"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPopupSecurityLabel = formatPopupSecurityLabel;
exports.formatConnectionInfo = formatConnectionInfo;
exports.attachPopupConnectionInfoMenu = attachPopupConnectionInfoMenu;
const electron_1 = require("electron");
function extractOrigin(rawUrl) {
    if (!rawUrl) {
        return undefined;
    }
    try {
        const parsed = new URL(rawUrl);
        return parsed.origin === 'null' ? undefined : parsed.origin;
    }
    catch {
        return undefined;
    }
}
/**
 * Chrome's omnibox wording: a secure page gets no label (Chrome shows only its
 * neutral page info icon), and both an http page and a rejected certificate
 * read "Not secure". Chrome tells those two apart by color, which a title bar
 * cannot show, so the certificate error also gets a warning sign.
 */
const POPUP_TITLE_SECURITY_LABELS = {
    secure: '',
    insecure: '不安全',
    dangerous: '⚠ 不安全',
    neutral: '',
};
/**
 * Returns the trusted title-bar security label for a popup showing
 * `displayUrl`, or `''` when `state` does not describe that URL's origin.
 */
function formatPopupSecurityLabel(state, displayUrl) {
    const origin = extractOrigin(displayUrl);
    if (!state || !origin || extractOrigin(state.url) !== origin) {
        return '';
    }
    return POPUP_TITLE_SECURITY_LABELS[state.level];
}
const NOT_SECURE_SUMMARY = [
    '您与此网站的连接不安全',
    'You should not enter any sensitive information on this site (for ' +
        'example, passwords or credit cards), because it could be stolen by ' +
        'attackers.',
];
/** Chrome's page info wording for each level. */
const SECURITY_LEVEL_SUMMARIES = {
    secure: [
        '连接安全',
        'Your information (for example, passwords or credit card numbers) is ' +
            'private when it is sent to this site.',
    ],
    insecure: NOT_SECURE_SUMMARY,
    dangerous: NOT_SECURE_SUMMARY,
    neutral: ['无法获取此页面的连接安全信息'],
};
function formatDate(ms) {
    return ms > 0 ? new Date(ms).toLocaleString() : 'unknown';
}
/** Formats `state` as the message and detail lines of a connection dialog. */
function formatConnectionInfo(state) {
    const lines = [...SECURITY_LEVEL_SUMMARIES[state.level]];
    const certificate = state.certificate;
    if (certificate) {
        lines.push('', state.level === 'secure' ? 'Certificate is valid' : 'Certificate details');
        if (state.certificateError) {
            lines.push(`Error: ${state.certificateError}`);
        }
        lines.push(`Issued to: ${certificate.subjectName}`, `Issued by: ${certificate.issuer}`, `Valid from: ${formatDate(certificate.validFromMs)}`, `Valid until: ${formatDate(certificate.validToMs)}`);
        if (certificate.protocol) {
            lines.push(`Protocol: ${certificate.protocol}`);
        }
    }
    return {
        message: extractOrigin(state.url) ?? (state.url || 'This page'),
        detail: lines.join('\n'),
    };
}
/**
 * Adds standard edit actions (`cut`, `copy`, `paste`, `selectAll`) and a
 * "Connection info…" item to a popup window that has no browser chrome,
 * opening a native dialog with the popup's current {@link WebviewSecurityState}.
 */
function attachPopupConnectionInfoMenu(popup, contents, getState) {
    contents.on('context-menu', (_event, params) => {
        if (popup.isDestroyed?.()) {
            return;
        }
        const hasSelection = Boolean(params?.selectionText);
        const isEditable = Boolean(params?.isEditable);
        const canCut = params === undefined
            ? true
            : (params.editFlags?.canCut ?? (isEditable && hasSelection));
        const canCopy = params === undefined
            ? true
            : (params.editFlags?.canCopy ?? hasSelection);
        const canPaste = params === undefined
            ? true
            : (params.editFlags?.canPaste ?? isEditable);
        const canSelectAll = params === undefined ? true : (params.editFlags?.canSelectAll ?? true);
        const window = popup;
        electron_1.Menu.buildFromTemplate([
            { role: 'cut', enabled: canCut },
            { role: 'copy', enabled: canCopy },
            { role: 'paste', enabled: canPaste },
            { role: 'selectAll', enabled: canSelectAll },
            { type: 'separator' },
            {
                label: '连接信息…',
                click: () => {
                    if (popup.isDestroyed?.()) {
                        return;
                    }
                    // Before the first commit there is no state yet; say so instead of
                    // ignoring the click.
                    const state = getState() ?? {
                        webContentsId: contents.id,
                        seq: 0,
                        url: '',
                        level: 'neutral',
                    };
                    const { message, detail } = formatConnectionInfo(state);
                    void electron_1.dialog
                        .showMessageBox(window, {
                        type: state.level === 'secure' ? 'info' : 'warning',
                        title: '连接信息',
                        message,
                        detail,
                        buttons: ['确定'],
                    })
                        // The popup can close while the dialog is open.
                        .catch(() => undefined);
                },
            },
        ]).popup({ window });
    });
}
