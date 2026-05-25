"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachLoadingOverlay = attachLoadingOverlay;
const electron_1 = require("electron");
/**
 * Generates the HTML content for the initial loading screen overlay.
 * This is injected into a WebContentsView and shown to the user before
 * the main application bundle finishes loading.
 *
 * @param foregroundColor - The text and loader animation color (hex or CSS color string).
 * @param backgroundColor - The background color of the loading view.
 */
function getLoadingHtml(foregroundColor, backgroundColor) {
    return `
<!DOCTYPE html>
<html>
<head>
<style>
  body {
    margin: 0;
    padding: 0;
    background: ${backgroundColor};
    color: ${foregroundColor};
    font-family: system-ui, -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    overflow: hidden;
    -webkit-app-region: drag;
    -webkit-user-select: none;
  }
  .loader {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .loader div {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: ${foregroundColor};
    opacity: 0.3;
    animation: dot-pulse 1.5s infinite ease-in-out;
  }
  .loader div:nth-child(1) { animation-delay: 0s; }
  .loader div:nth-child(2) { animation-delay: 0.3s; }
  .loader div:nth-child(3) { animation-delay: 0.6s; }
  .text {
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.03em;
    opacity: 0.6;
  }
  @keyframes dot-pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.9); }
    50% { opacity: 0.7; transform: scale(1.1); }
  }
</style>
</head>
<body>
  <div class="loader">
    <div></div><div></div><div></div>
  </div>
  <div class="text">Loading Antigravity</div>
</body>
</html>
  `;
}
/**
 * Attaches a temporary WebContentsView overlay that shows a loading animation.
 * It is automatically removed when the window's main content finishes loading.
 */
function attachLoadingOverlay(win, foregroundColor, backgroundColor) {
    const view = new electron_1.WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    const html = getLoadingHtml(foregroundColor, backgroundColor);
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.contentView.addChildView(view);
    const updateBounds = () => {
        const [width, height] = win.getContentSize();
        view.setBounds({ x: 0, y: 0, width, height });
    };
    updateBounds();
    win.on('resize', updateBounds);
    win.webContents.once('did-finish-load', () => {
        try {
            win.contentView.removeChildView(view);
        }
        catch (_) {
            // In case window was closed quickly
        }
        win.off('resize', updateBounds);
    });
}
