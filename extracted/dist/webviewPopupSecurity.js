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
    '请勿在此网站输入任何敏感信息（例如密码或信用卡信息），否则可能会被攻击者窃取。',
];
/** Chrome's page info wording for each level. */
const SECURITY_LEVEL_SUMMARIES = {
    secure: [
        '连接安全',
        '您的信息（例如密码或信用卡号）在发送到此网站时受隐私保护。',
    ],
    insecure: NOT_SECURE_SUMMARY,
    dangerous: NOT_SECURE_SUMMARY,
    neutral: ['无法获取此页面的连接安全信息'],
};
function formatDate(ms) {
    return ms > 0 ? new Date(ms).toLocaleString() : '未知';
}
/** Formats `state` as the message and detail lines of a connection dialog. */
function formatConnectionInfo(state) {
    const lines = [...SECURITY_LEVEL_SUMMARIES[state.level]];
    const certificate = state.certificate;
    if (certificate) {
        lines.push('', state.level === 'secure' ? '证书有效' : '证书详情');
        if (state.certificateError) {
            lines.push(`错误：${state.certificateError}`);
        }
        lines.push(`颁发给：${certificate.subjectName}`, `颁发者：${certificate.issuer}`, `有效期自：${formatDate(certificate.validFromMs)}`, `有效期至：${formatDate(certificate.validToMs)}`);
        if (certificate.protocol) {
            lines.push(`协议：${certificate.protocol}`);
        }
    }
    return {
        message: extractOrigin(state.url) ?? (state.url || '此页面'),
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
            { role: 'cut', label: '剪切', enabled: canCut },
            { role: 'copy', label: '复制', enabled: canCopy },
            { role: 'paste', label: '粘贴', enabled: canPaste },
            { role: 'selectAll', label: '全选', enabled: canSelectAll },
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
