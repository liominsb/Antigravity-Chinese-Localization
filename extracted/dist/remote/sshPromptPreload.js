"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Preload of the ssh prompt window (sshPrompts.ts): fills in its static page,
 * which runs no script, and sends back the answer.
 */
const electron_1 = require("electron");
/** ssh reads no more of an answer. */
const MAX_ANSWER_BYTES = 1023;
/** Until then, keys and clicks meant for the window underneath go nowhere. */
const ARMING_MS = 500;
electron_1.ipcRenderer.once('ssh-prompt:show', (_event, { label, message, retry }) => {
    const [asks, text, note, long, input, ok, cancel] = [
        'asks',
        'message',
        'retry',
        'long',
        'answer',
        'continue',
        'cancel',
    ].map((id) => document.getElementById(id));
    if (!asks || !text || !note || !long || !input || !ok || !cancel) {
        return;
    }
    asks.textContent = `${label} 询问：`;
    text.textContent = message;
    note.hidden = !retry;
    // Armed once writable: nothing typed or pressed before then counts.
    input.readOnly = true;
    setTimeout(() => (input.readOnly = false), ARMING_MS);
    const submit = () => {
        if (input.readOnly) {
            return;
        }
        // Refused here, where it can be fixed: ssh would read only part of it.
        long.hidden =
            new TextEncoder().encode(input.value).length <= MAX_ANSWER_BYTES;
        if (long.hidden) {
            void electron_1.ipcRenderer.invoke('ssh-prompt:submit', input.value);
        }
    };
    const dismiss = () => void electron_1.ipcRenderer.invoke('ssh-prompt:cancel');
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', dismiss);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            submit();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            dismiss();
        }
    });
    input.focus();
});
