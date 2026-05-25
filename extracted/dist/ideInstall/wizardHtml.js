"use strict";
/**
 * IDE Install Wizard — HTML template for the wizard UI.
 *
 * This is a self-contained page with all CSS/JS embedded, rendered inline
 * in a standalone BrowserWindow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWizardHtml = getWizardHtml;
/**
 * Returns the inline HTML for the IDE install wizard.
 * This is a self-contained page with all CSS/JS embedded.
 */
function getWizardHtml(iconBase64) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Welcome to Antigravity</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :root {
    --bg-primary: #000000;
    --bg-secondary: #1A1A1A;
    --bg-tertiary: #242424;
    --bg-hover: #2A2A2A;
    --text-primary: #F5F5F5;
    --text-secondary: #A0A0A0;
    --text-muted: #666;
    --accent: #2F80ED;
    --accent-hover: #2D74D7;
    --border: #2A2A2A;
    --radius: 12px;
    --radius-sm: 8px;
    --transition: 200ms ease;
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    -webkit-app-region: drag;
    -webkit-user-select: none;
    user-select: none;
  }

  /* Traffic-light spacer for macOS */
  .titlebar-spacer {
    height: 38px;
    flex-shrink: 0;
  }

  .container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0 68px 68px;
    -webkit-app-region: no-drag;
  }

  /* --- Step screens --- */
  .step {
    display: none;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 480px;
    width: 100%;
    animation: fadeIn 0.4s ease;
  }
  .step.active {
    display: flex;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Icon */
  .icon-wrapper {
    width: 80px;
    height: 80px;
    margin-bottom: 32px;
  }
  .icon-wrapper img {
    width: 100%;
    height: 100%;
    border-radius: 18px;
  }

  h1 {
    font-size: 19px;
    font-weight: 700;
    line-height: 1.3;
    margin-bottom: 8px;
    letter-spacing: -0.02em;
  }

  p {
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin-bottom: 36px;
  }

  /* Loader styling */
  .loader {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  .loader div {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--accent);
    opacity: 0.3;
    animation: dot-pulse 1.5s infinite ease-in-out;
  }
  .loader div:nth-child(1) { animation-delay: 0s; }
  .loader div:nth-child(2) { animation-delay: 0.3s; }
  .loader div:nth-child(3) { animation-delay: 0.6s; }

  @keyframes dot-pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.9); }
    50% { opacity: 0.7; transform: scale(1.1); }
  }

  /* Checkbox styling */
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    color: var(--text-secondary);
    transition: color var(--transition);
    margin-bottom: 18px;
    -webkit-app-region: no-drag;
  }

  .checkbox-label:hover {
    color: var(--text-primary);
  }

  .checkbox-label input {
    display: none;
  }

  .custom-checkbox {
    width: 18px;
    height: 18px;
    border: 2px solid #333;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: var(--transition);
    background: var(--bg-secondary);
  }

  .checkbox-label:hover .custom-checkbox {
    border-color: var(--accent);
  }

  .checkbox-label input:checked + .custom-checkbox {
    background: var(--accent);
    border-color: var(--accent);
  }

  .custom-checkbox::after {
    content: '';
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg) translate(-1px, -1px);
    display: none;
  }

  .checkbox-label input:checked + .custom-checkbox::after {
    display: block;
  }

  /* Buttons */
  .button-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 320px;
  }

  button {
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    padding: 13px 24px;
    border-radius: var(--radius-sm);
    border: none;
    cursor: pointer;
    transition: all var(--transition);
    -webkit-app-region: no-drag;
  }

  .btn-primary {
    background: var(--accent);
    color: #fff;
  }
  .btn-primary:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }
  .btn-primary:active {
    transform: translateY(0);
  }

</style>
</head>
<body>
  <div class="titlebar-spacer"></div>
  <div class="container">

    <!-- Step 0: Setting up -->
    <div id="step-setup" class="step active">
      <div class="loader">
        <div></div><div></div><div></div>
      </div>
      <div class="text" style="font-size: 13px; opacity: 0.6; letter-spacing: 0.03em;">Setting up…</div>
    </div>

    <!-- Step 1: Welcome -->
    <div id="step-ask" class="step">
      <div class="icon-wrapper">
        <img src="data:image/png;base64,${iconBase64}" alt="Antigravity Icon">
      </div>
      <h1>Welcome to the new Antigravity!</h1>
      <p>Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named <b>Antigravity IDE</b>.</p>
      
      <label class="checkbox-label">
        <input type="checkbox" id="chk-download" checked>
        <span class="custom-checkbox"></span>
        <span>Download the Antigravity IDE</span>
      </label>

      <div class="button-group">
        <button class="btn-primary" id="btn-skip">Explore the new Antigravity</button>
      </div>
    </div>

  </div>

<script>
  function showStep(stepId) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
  }

  document.getElementById('btn-skip').addEventListener('click', async () => {
    const chk = document.getElementById('chk-download');
    const shouldDownload = chk ? chk.checked : false;
    await window.wizardAPI.completeWizard(shouldDownload);
  });

  window.wizardAPI.onSetupComplete(() => {
    showStep('step-ask');
  });
</script>
</body>
</html>`;
}
