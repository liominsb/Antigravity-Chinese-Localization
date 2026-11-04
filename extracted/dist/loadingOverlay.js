"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachLoadingOverlay = attachLoadingOverlay;
const electron_1 = require("electron");
const utils_1 = require("./utils");
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
  .logo {
    width: 64px;
    height: 64px;
    color: ${foregroundColor};
    animation: logo-pulse 2.2s infinite ease-in-out;
  }
  @keyframes logo-pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.5; }
  }
</style>
</head>
<body>
  <svg
    class="logo"
    viewBox="0 0 180 180"
    fill="none"
    xmlns="http://www.w3.org/2000/svg">
    <path
      d="M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z"
      fill="currentColor"
    />
  </svg>
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
        if (win.isDestroyed?.() || view.webContents?.isDestroyed?.()) {
            return;
        }
        const [width, height] = win.getContentSize();
        view.setBounds({ x: 0, y: 0, width, height });
    };
    updateBounds();
    win.on('resize', updateBounds);
    const hubContents = (0, utils_1.getHubWebContents)(win) ?? win.webContents;
    let cleanedUp = false;
    const cleanupOverlay = () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;
        try {
            if (!win.isDestroyed?.()) {
                win.contentView.removeChildView(view);
            }
        }
        catch (_) {
            // In case window was closed quickly
        }
        if (!win.isDestroyed?.()) {
            win.off?.('resize', updateBounds);
        }
    };
    hubContents?.once('did-finish-load', cleanupOverlay);
    win.once?.('closed', () => {
        hubContents?.off?.('did-finish-load', cleanupOverlay);
        cleanupOverlay();
        if (!view.webContents?.isDestroyed?.()) {
            view.webContents.close?.();
        }
    });
}
