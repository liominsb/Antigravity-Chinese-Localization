"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webAuthnBridgeApi = void 0;
exports.isTopLevelWebAuthnFrame = isTopLevelWebAuthnFrame;
exports.shouldUseCableWebAuthnAssertion = shouldUseCableWebAuthnAssertion;
exports.isUnfulfillableWebAuthnAssertion = isUnfulfillableWebAuthnAssertion;
exports.attachIsolatedWebAuthnBridgePort = attachIsolatedWebAuthnBridgePort;
exports.buildWebviewWebAuthnMainWorldScript = buildWebviewWebAuthnMainWorldScript;
exports.installWebviewWebAuthnBridge = installWebviewWebAuthnBridge;
const electron_1 = require("electron");
const WEBAUTHN_CABLE_AVAILABLE_CHANNEL = 'webauthn:cable-available';
const WEBAUTHN_CABLE_GET_ASSERTION_CHANNEL = 'webauthn:cable-get-assertion';
const WEBAUTHN_CABLE_CANCEL_ASSERTION_CHANNEL = 'webauthn:cable-cancel-assertion';
/**
 * Returns `true` when the preload is executing in a top-level frame rather
 * than an embedded `<iframe>` subframe.
 */
function isTopLevelWebAuthnFrame(frame = electron_1.webFrame, win = globalThis.window) {
    if (win &&
        typeof win === 'object' &&
        'top' in win &&
        win.top !== null &&
        win.top !== undefined) {
        return win.top === win;
    }
    if (frame &&
        typeof frame === 'object' &&
        'top' in frame &&
        frame.top !== null &&
        frame.top !== undefined) {
        const topObj = frame.top;
        if (typeof frame.routingId === 'number' &&
            topObj &&
            typeof topObj === 'object' &&
            typeof topObj.routingId === 'number') {
            return topObj.routingId === frame.routingId;
        }
        return frame.top === frame;
    }
    return true;
}
/**
 * Returns `true` when a `navigator.credentials.get({ publicKey })` request
 * should be fulfilled via the Hub's macOS `caBLEv2` (QR + BLE + tunnel)
 * initiator rather than Electron's native authenticator discovery.
 */
function shouldUseCableWebAuthnAssertion(options, hasPlatformAuthenticator, hasCableSupport) {
    if (!hasCableSupport ||
        !options ||
        typeof options !== 'object' ||
        !options.publicKey) {
        return false;
    }
    if (options.mediation === 'conditional') {
        return false;
    }
    const allow = options.publicKey.allowCredentials;
    if (!Array.isArray(allow) || allow.length === 0) {
        return !hasPlatformAuthenticator;
    }
    if (hasPlatformAuthenticator &&
        allow.some((c) => !Array.isArray(c?.transports) ||
            c.transports.length === 0 ||
            c.transports.includes('internal'))) {
        return false;
    }
    return allow.some((cred) => {
        const transports = cred?.transports;
        if (!Array.isArray(transports) || transports.length === 0) {
            return true;
        }
        return transports.some((t) => t === 'hybrid' || t === 'cable');
    });
}
/**
 * Returns `true` when a `navigator.credentials.get()` request in an Electron
 * `<webview>` cannot be satisfied by any local authenticator and `caBLEv2` is
 * unavailable, so failing fast with `NotAllowedError` avoids a silent
 * 180-second `FidoHidDiscovery` hang.
 */
function isUnfulfillableWebAuthnAssertion(options, hasPlatformAuthenticator) {
    if (!options || typeof options !== 'object' || !options.publicKey) {
        return false;
    }
    if (options.mediation === 'conditional' && !hasPlatformAuthenticator) {
        return true;
    }
    const allow = options.publicKey.allowCredentials;
    if (!Array.isArray(allow) || allow.length === 0) {
        return false;
    }
    return allow.every((cred) => {
        const transports = cred?.transports;
        if (!Array.isArray(transports) || transports.length === 0) {
            return false;
        }
        return transports.every((t) => t === 'hybrid' ||
            t === 'cable' ||
            (t === 'internal' && !hasPlatformAuthenticator));
    });
}
/**
 * Attaches the isolated-world `caBLEv2` IPC bridge handler to `port1` of a
 * private `MessageChannel` whose paired `port2` is transferred to the
 * main-world WebAuthn wrapper closure.
 */
function attachIsolatedWebAuthnBridgePort(port, bridgeApi = exports.webAuthnBridgeApi) {
    port.onmessage = (event) => {
        const msg = event?.data;
        if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number') {
            return;
        }
        const { id, type } = msg;
        if (type === 'check-cable-available') {
            Promise.resolve(bridgeApi.checkCableAvailable())
                .then((available) => {
                port.postMessage({ id, ok: true, result: Boolean(available) });
            })
                .catch(() => {
                port.postMessage({ id, ok: true, result: false });
            });
            return;
        }
        if (type === 'get-cable-assertion') {
            Promise.resolve(bridgeApi.getCableAssertion(msg.request))
                .then((result) => {
                port.postMessage({ id, ok: true, result });
            })
                .catch((err) => {
                const errorName = err &&
                    typeof err === 'object' &&
                    typeof err.name === 'string'
                    ? err.name
                    : 'Error';
                const errorMessage = err &&
                    typeof err === 'object' &&
                    typeof err.message === 'string'
                    ? err.message
                    : String(err ?? '');
                port.postMessage({ id, ok: false, errorName, errorMessage });
            });
            return;
        }
        if (type === 'cancel-cable-assertion') {
            Promise.resolve(bridgeApi.cancelCableAssertion(String(msg.requestId ?? '')))
                .then(() => {
                port.postMessage({ id, ok: true, result: null });
            })
                .catch(() => {
                port.postMessage({ id, ok: true, result: null });
            });
        }
    };
    if (typeof port.start === 'function') {
        port.start();
    }
}
/**
 * Builds the self-contained main-world script injected into top-level
 * `<webview>` frames to report WebAuthn capabilities, route cross-device
 * passkey assertions to the macOS `caBLEv2` initiator over a private
 * `MessagePort`, and fail fast on unfulfillable assertions without exposing
 * any properties or symbols on `window` or `PublicKeyCredential`.
 */
function buildWebviewWebAuthnMainWorldScript(options) {
    const handshakeToken = options?.handshakeToken ?? '';
    const isCableSupported = Boolean(options?.isCableSupported ?? Boolean(handshakeToken));
    return `(() => {
  if (
    typeof window === 'undefined' ||
    (window.top && window.top !== window) ||
    !window.PublicKeyCredential
  ) {
    return;
  }
  const PublicKeyCredentialCtor = window.PublicKeyCredential;
  const handshakeToken = ${JSON.stringify(handshakeToken)};
  const isCableSupported = ${JSON.stringify(isCableSupported)};

  let portPromise = null;
  let nextRpcId = 1;
  const pendingRpcs = new Map();

  if (
    isCableSupported &&
    handshakeToken &&
    typeof window.addEventListener === 'function' &&
    typeof window.dispatchEvent === 'function'
  ) {
    portPromise = new Promise((resolve) => {
      window.addEventListener(
        'message',
        function onHandshakeMessage(event) {
          if (
            event.source === window &&
            event.data === handshakeToken &&
            event.ports &&
            event.ports[0]
          ) {
            event.stopImmediatePropagation();
            window.removeEventListener('message', onHandshakeMessage, true);
            const port = event.ports[0];
            port.onmessage = function onPortMessage(msgEvent) {
              const payload = msgEvent && msgEvent.data;
              if (!payload || typeof payload.id !== 'number') {
                return;
              }
              const entry = pendingRpcs.get(payload.id);
              if (!entry) {
                return;
              }
              pendingRpcs.delete(payload.id);
              if (payload.ok) {
                entry.resolve(payload.result);
              } else {
                const err = new Error(
                  typeof payload.errorMessage === 'string'
                    ? payload.errorMessage
                    : ''
                );
                if (typeof payload.errorName === 'string' && payload.errorName) {
                  err.name = payload.errorName;
                }
                entry.reject(err);
              }
            };
            if (typeof port.start === 'function') {
              port.start();
            }
            resolve(port);
          }
        },
        true
      );
      window.dispatchEvent(new Event(handshakeToken));
    });
  }

  function invokeIsolatedBridge(type, payload) {
    if (!portPromise) {
      return Promise.reject(new Error('Isolated WebAuthn bridge unavailable'));
    }
    return portPromise.then((port) => {
      const id = nextRpcId++;
      return new Promise((resolve, reject) => {
        pendingRpcs.set(id, { resolve, reject });
        port.postMessage(Object.assign({ id, type }, payload));
      });
    });
  }

  const injectedBridge =
    typeof arguments !== 'undefined' &&
    arguments.length >= 3 &&
    arguments[2] &&
    typeof arguments[2] === 'object'
      ? arguments[2]
      : null;

  const bridge =
    injectedBridge ||
    (portPromise
      ? {
          isCableSupported: true,
          checkCableAvailable: () =>
            invokeIsolatedBridge('check-cable-available', {}),
          getCableAssertion: (request) =>
            invokeIsolatedBridge('get-cable-assertion', { request }),
          cancelCableAssertion: (requestId) =>
            invokeIsolatedBridge('cancel-cable-assertion', { requestId }),
        }
      : null);

  let cableAvailablePromise = null;
  async function resolveHasCable() {
    if (!bridge) {
      return false;
    }
    if (typeof bridge.checkCableAvailable === 'function') {
      if (!cableAvailablePromise) {
        cableAvailablePromise = Promise.resolve(bridge.checkCableAvailable())
          .then((v) => Boolean(v))
          .catch(() => false);
      }
      return cableAvailablePromise;
    }
    return Boolean(bridge.isCableSupported);
  }
  const shouldUseCable = ${shouldUseCableWebAuthnAssertion.toString()};
  const isUnfulfillable = ${isUnfulfillableWebAuthnAssertion.toString()};

  function toUint8Array(bufSource) {
    if (bufSource instanceof Uint8Array) {
      return bufSource;
    }
    if (ArrayBuffer.isView(bufSource)) {
      return new Uint8Array(bufSource.buffer, bufSource.byteOffset, bufSource.byteLength);
    }
    if (bufSource instanceof ArrayBuffer) {
      return new Uint8Array(bufSource);
    }
    throw new TypeError('Expected BufferSource');
  }

  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToArrayBuffer(b64url) {
    const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function buildPublicKeyCredentialFromCable(res) {
    const rawIdBuffer = base64UrlToArrayBuffer(res.rawIdBase64Url);
    const clientDataBuffer = base64UrlToArrayBuffer(res.clientDataJSONBase64Url);
    const authDataBuffer = base64UrlToArrayBuffer(res.authenticatorDataBase64Url);
    const sigBuffer = base64UrlToArrayBuffer(res.signatureBase64Url);
    const userHandleBuffer = res.userHandleBase64Url
      ? base64UrlToArrayBuffer(res.userHandleBase64Url)
      : null;

    const respProto = window.AuthenticatorAssertionResponse
      ? window.AuthenticatorAssertionResponse.prototype
      : Object.prototype;
    const assertionResp = Object.create(respProto);
    Object.defineProperties(assertionResp, {
      clientDataJSON: { value: clientDataBuffer, enumerable: true },
      authenticatorData: { value: authDataBuffer, enumerable: true },
      signature: { value: sigBuffer, enumerable: true },
      userHandle: { value: userHandleBuffer, enumerable: true },
    });

    const cred = Object.create(PublicKeyCredentialCtor.prototype);
    Object.defineProperties(cred, {
      id: { value: res.id, enumerable: true },
      rawId: { value: rawIdBuffer, enumerable: true },
      type: { value: 'public-key', enumerable: true },
      authenticatorAttachment: { value: 'cross-platform', enumerable: true },
      response: { value: assertionResp, enumerable: true },
      getClientExtensionResults: {
        value: function getClientExtensionResults() {
          return {};
        },
      },
      toJSON: {
        value: function toJSON() {
          return {
            id: res.id,
            rawId: res.rawIdBase64Url,
            type: 'public-key',
            authenticatorAttachment: 'cross-platform',
            response: {
              clientDataJSON: res.clientDataJSONBase64Url,
              authenticatorData: res.authenticatorDataBase64Url,
              signature: res.signatureBase64Url,
              userHandle: res.userHandleBase64Url,
            },
            clientExtensionResults: {},
          };
        },
      },
    });
    return cred;
  }

  const origUvpaa =
    typeof PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable.bind(PublicKeyCredentialCtor)
      : async () => false;

  if (typeof PublicKeyCredentialCtor.isConditionalMediationAvailable === 'function') {
    PublicKeyCredentialCtor.isConditionalMediationAvailable = async function isConditionalMediationAvailable() {
      return Boolean(await origUvpaa());
    };
  }

  if (typeof PublicKeyCredentialCtor.getClientCapabilities === 'function') {
    const origGetCaps = PublicKeyCredentialCtor.getClientCapabilities.bind(PublicKeyCredentialCtor);
    PublicKeyCredentialCtor.getClientCapabilities = async function getClientCapabilities(...args) {
      const [caps, uvpaa, hasCable] = await Promise.all([
        origGetCaps(...args),
        origUvpaa(),
        resolveHasCable(),
      ]);
      const hasPlatform = Boolean(uvpaa);
      return {
        ...caps,
        conditionalCreate: hasPlatform,
        conditionalGet: hasPlatform,
        hybridTransport: hasCable,
        passkeyPlatformAuthenticator: hasPlatform,
        userVerifyingPlatformAuthenticator: hasPlatform,
      };
    };
  }

  if (navigator.credentials && typeof navigator.credentials.get === 'function') {
    const origGet = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async function get(options) {
      if (options && options.publicKey) {
        if (options.signal && options.signal.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
        const [hasPlatform, hasCable] = await Promise.all([
          origUvpaa().then(Boolean),
          resolveHasCable(),
        ]);
        if (shouldUseCable(options, hasPlatform, hasCable) && bridge && typeof bridge.getCableAssertion === 'function') {
          const pk = options.publicKey;
          const challengeBase64Url = bytesToBase64Url(toUint8Array(pk.challenge));
          const allowCredentials = Array.isArray(pk.allowCredentials)
            ? pk.allowCredentials.map((c) => ({
                idBase64Url: bytesToBase64Url(toUint8Array(c.id)),
                transports: Array.isArray(c.transports) ? c.transports.slice() : undefined,
              }))
            : undefined;
          const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
          const onAbort = () => {
            if (typeof bridge.cancelCableAssertion === 'function') {
              void bridge.cancelCableAssertion(requestId);
            }
          };
          if (options.signal && typeof options.signal.addEventListener === 'function') {
            options.signal.addEventListener('abort', onAbort, { once: true });
          }
          if (options.signal && options.signal.aborted) {
            if (typeof options.signal.removeEventListener === 'function') {
              options.signal.removeEventListener('abort', onAbort);
            }
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          try {
            const res = await bridge.getCableAssertion({
              requestId,
              rpId: pk.rpId,
              challengeBase64Url,
              allowCredentials,
              userVerification: pk.userVerification,
              timeoutMs: pk.timeout,
            });
            return buildPublicKeyCredentialFromCable(res);
          } catch (err) {
            if (options.signal && options.signal.aborted) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }
            const msg =
              err && typeof err === 'object' && typeof err.message === 'string'
                ? err.message
                : String(err || '');
            if (err instanceof TypeError || /\\[TypeError\\]/i.test(msg)) {
              throw new TypeError(msg);
            }
            if (
              (err && typeof err === 'object' && err.name === 'SecurityError') ||
              /\\[SecurityError\\]|Invalid WebAuthn rpId/i.test(msg)
            ) {
              throw new DOMException(
                msg || 'The operation is insecure.',
                'SecurityError'
              );
            }
            if (
              (err && typeof err === 'object' && err.name === 'AbortError') ||
              /\\[AbortError\\]/i.test(msg)
            ) {
              throw new DOMException('The operation was aborted.', 'AbortError');
            }
            throw new DOMException(
              'The operation either timed out or was not allowed.',
              'NotAllowedError'
            );
          } finally {
            if (options.signal && typeof options.signal.removeEventListener === 'function') {
              options.signal.removeEventListener('abort', onAbort);
            }
          }
        }
        if (isUnfulfillable(options, hasPlatform)) {
          throw new DOMException(
            'The operation either timed out or was not allowed.',
            'NotAllowedError'
          );
        }
      }
      return origGet(options);
    };
  }
})();`;
}
let cachedCableAvailablePromise = null;
exports.webAuthnBridgeApi = {
    isCableSupported: process.platform === 'darwin',
    checkCableAvailable: () => {
        if (process.platform !== 'darwin') {
            return Promise.resolve(false);
        }
        if (!cachedCableAvailablePromise) {
            cachedCableAvailablePromise = Promise.resolve(electron_1.ipcRenderer.invoke(WEBAUTHN_CABLE_AVAILABLE_CHANNEL))
                .then((available) => Boolean(available))
                .catch(() => false);
        }
        return cachedCableAvailablePromise;
    },
    getCableAssertion: (request) => electron_1.ipcRenderer.invoke(WEBAUTHN_CABLE_GET_ASSERTION_CHANNEL, request),
    cancelCableAssertion: (requestId) => electron_1.ipcRenderer.invoke(WEBAUTHN_CABLE_CANCEL_ASSERTION_CHANNEL, requestId),
};
const installedFrameTargets = new WeakSet();
/**
 * Installs the WebAuthn preload bridge in top-level `<webview>` frames using
 * an isolated-world `MessageChannel` handshake rather than
 * `contextBridge.exposeInMainWorld`, leaving `window` free of custom globals.
 */
function installWebviewWebAuthnBridge(options) {
    const frame = options?.frame !== undefined ? options.frame : electron_1.webFrame;
    const win = options?.win !== undefined
        ? options.win
        : (globalThis.window ?? null);
    if (!isTopLevelWebAuthnFrame(frame, win)) {
        return false;
    }
    const dedupeKey = (win && typeof win === 'object' ? win : null) ??
        (frame && typeof frame === 'object' ? frame : null);
    if (dedupeKey) {
        if (installedFrameTargets.has(dedupeKey)) {
            return false;
        }
        installedFrameTargets.add(dedupeKey);
    }
    const platform = options?.platform ?? process.platform;
    const bridgeApi = options?.bridgeApi ?? exports.webAuthnBridgeApi;
    const isCableSupported = platform === 'darwin';
    let handshakeToken = '';
    if (isCableSupported &&
        win &&
        typeof win.addEventListener === 'function' &&
        typeof win.postMessage === 'function') {
        const createChannel = options?.createMessageChannel ??
            (() => new MessageChannel());
        handshakeToken =
            '__agy_wa_' +
                Math.random().toString(36).slice(2) +
                Date.now().toString(36);
        win.addEventListener(handshakeToken, (event) => {
            event.stopImmediatePropagation?.();
            const channel = createChannel();
            attachIsolatedWebAuthnBridgePort(channel.port1, bridgeApi);
            win.postMessage(handshakeToken, '*', [channel.port2]);
        }, { capture: true, once: true });
    }
    if (frame && typeof frame.executeJavaScript === 'function') {
        try {
            void frame.executeJavaScript(buildWebviewWebAuthnMainWorldScript({
                handshakeToken,
                isCableSupported,
            }));
            return true;
        }
        catch {
            // Ignore non-HTML or restricted frames where script execution is disabled.
        }
    }
    return false;
}
installWebviewWebAuthnBridge();
