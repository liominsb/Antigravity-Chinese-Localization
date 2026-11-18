"use strict";
/**
 * The desktop host: everything a machine needs to serve the `computer`
 * actuator and its live preview, with no Electron:
 *
 * - the helper supervisor (DesktopHelper, with the fd 3 frame pipe when the
 *   preview is on) and the Mac surface (Layer 3);
 * - Layer 2 (`registerComputerActuator`) on a Layer 1 ActuatorClient;
 * - the agents' overlay cursors (helper-drawn on the controlled Mac);
 * - the kill switch and the persisted pause;
 * - the preview (P3-1): PreviewManager (helper streams for what the agents
 *   work in) feeding RtcSender (WebRTC to viewers, loopback only).
 *
 * The Hub embeds it (src/computer/index.ts adds the HUD and Electron
 * lifecycle); `main.ts` runs it headless.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scriptRunnerFor = scriptRunnerFor;
exports.stopLikePause = stopLikePause;
exports.typingActivity = typingActivity;
exports.startDesktopHost = startDesktopHost;
const computerActuator_1 = require("../computerActuator");
const desktopHelper_1 = require("../computer/desktopHelper");
const macComputerDriver_1 = require("../computer/macComputerDriver");
const overlay_1 = require("../computer/overlay");
const config_1 = require("./config");
const activityThrottle_1 = require("./activityThrottle");
const scriptSelftest_1 = require("./scriptSelftest");
const colors_1 = require("./colors");
const previewManager_1 = require("./previewManager");
const takeovers_1 = require("./takeovers");
const protocol_1 = require("./protocol");
const pairing_1 = require("./pairing");
const rtcSender_1 = require("./rtcSender");
const viewerHandler_1 = require("./viewerHandler");
const rtcTransport_1 = require("./rtcTransport");
/**
 * Script mode's runner: a fresh ScriptRunner (one sandboxed child) per
 * script. Logs only the runner's content-free fields (lengths, codes, a
 * sha256 prefix; never source, text or values). `available` gates it (the
 * sandbox selftest); by default it always is.
 */
function scriptRunnerFor(binaryPath, log, available) {
    return {
        ...(available ? { available } : {}),
        run: (source, o) => new computerActuator_1.ScriptRunner({
            binaryPath,
            log: (event, fields) => log(`[ComputerUse] ${event} ${Object.entries(fields)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join(' ')}`),
        }).run(source, o),
    };
}
/**
 * A pause that must end the previews like the user's Stop: Layer 2 names a
 * cause other than a takeover (USER_STOP from the LS, the LS fence;
 * rt-security P3-SEC-UC-3). Without a cause (older Layer 2) a pause reads
 * as a takeover.
 */
function stopLikePause(s) {
    return (s.paused && s.pauseCause !== undefined && s.pauseCause !== 'user_takeover');
}
/**
 * The activity of a helper `typing` event: caret progress of a running agent
 * of the lease, as an ax_set_value activity with the caret as `bounds`.
 * Undefined for an unknown or stopped agent, or a malformed event.
 */
function typingActivity(m, agents) {
    const id = m['actor_id'];
    const agent = typeof id === 'string' && id
        ? agents.find((x) => x.actor.id === id && !x.stopped)
        : undefined;
    const bounds = (0, macComputerDriver_1.boundsOf)(m['bounds']);
    if (!agent || !bounds) {
        return undefined;
    }
    const a = {
        actor: agent.actor,
        rootConversationId: agent.rootConversationId,
        kind: 'ax_set_value',
        mode: 'background',
        ok: true,
        bounds,
    };
    const app = m['bundle_id'];
    if (typeof app === 'string' && app) {
        a.appId = app;
    }
    return a;
}
function startDesktopHost(o) {
    const log = o.log ?? ((m) => console.log(m));
    const helper = new desktopHelper_1.DesktopHelper(o.helperPath, log, o.helperArgs ?? [], {
        framePipe: !!o.preview,
        ...(o.helperEnv ? { env: o.helperEnv } : {}),
    });
    const driver = new macComputerDriver_1.MacComputerSurfaceDriver(helper, o.actuatorId, {
        idleProbe: o.idleProbe,
    });
    const overlay = o.overlay === false ? undefined : new overlay_1.OverlayFeed(helper, log);
    let overlayLive = false;
    let wasConnected = false;
    const clientName = o.clientName ?? 'desktop-host';
    let latest;
    /** One color per agent in the lease, the same on every surface. */
    const colors = new colors_1.AgentColors();
    /** Typing chunks: at most ~15 activities/s per agent, the latest kept. */
    const activities = new activityThrottle_1.ActivityThrottle((a) => {
        overlay?.activity(a);
        sender?.sendActivity(a);
        safe(() => o.onAgentActivity?.(a), log);
    });
    /** The user pressed Stop (until Resume): previews end. */
    let userStopped = false;
    /** The lease's agents plus the retained taken-over ones. */
    const agentsView = () => takeovers.view(latest?.agents ?? []);
    let sender;
    let transport;
    let manager;
    // Set once registered (the callbacks below run only afterwards).
    const ref = {};
    const syncPreview = () => {
        if (!manager || !latest) {
            return;
        }
        manager.update(driver.previewTargets(), agentsView().map((a) => ({
            actorId: a.actor.id,
            stopped: a.stopped,
            mode: a.mode,
            root: a.rootConversationId,
            userControl: takeovers.has(a.actor.id),
        })), latest.paused, userStopped || stopLikePause(latest));
    };
    /** The agents as viewers see them (colors, who the user controls). */
    const pushAgents = () => {
        if (!latest) {
            return;
        }
        sender?.setAgents(agentsView().map((a) => takeovers.has(a.actor.id)
            ? { ...a, userInControl: true, takenOverBy: 'local' }
            : a), latest.paused);
    };
    const stopAgent = (actorId) => {
        takeovers.end(actorId);
        overlay?.clear(actorId);
        // C13b per-agent stop: that agent's batches answer AGENT_STOPPED (also
        // after its lease ends); other agents continue.
        ref.reg?.stopAgent(actorId);
        driver.forgetPreviewTargets(actorId);
    };
    /** Agents the user took over from their tile (stopped, still streamed). */
    const takeovers = new takeovers_1.Takeovers({
        // Its batches answer AGENT_STOPPED until handBack; the targets (and so
        // the stream) are kept.
        // A non-sticky per-agent pause (AGENT_PAUSED, #1377) when Layer 2 has
        // it; otherwise a stop (AGENT_STOPPED: hand-back then can't revive the
        // agent on the LS side).
        stopAgent: (id) => {
            const reg = ref.reg;
            if (reg?.pauseAgent) {
                reg.pauseAgent(id);
            }
            else {
                reg?.stopAgent(id);
            }
        },
        resumeAgent: async (id) => {
            await ref.reg?.resumeAgent(id);
        },
        // A retained agent's tile goes with its takeover.
        onReleased: (id) => driver.forgetPreviewTargets(id),
        onExpired: (id) => {
            log('[DesktopHost] takeover not handed back in time: stopping the agent');
            stopAgent(id);
            pushAgents();
            syncPreview();
        },
    });
    const takeOver = (actorId) => {
        const agent = latest?.agents.find((a) => a.actor.id === actorId);
        if (!agent) {
            log('[DesktopHost] takeOver: not an agent of this lease');
        }
        if (!takeovers.take(actorId, agent)) {
            return;
        }
        overlay?.clear(actorId);
        pushAgents();
        syncPreview();
    };
    const handBack = async (actorId) => {
        // resumeAgent clears the stop (and pushes the state) synchronously, so
        // the stream never sees a stopped agent without the takeover.
        if (await takeovers.handBack(actorId)) {
            pushAgents();
            syncPreview();
        }
    };
    const stopAll = async (detail) => {
        userStopped = true;
        takeovers.clear();
        syncPreview();
        await ref.reg?.stop(detail);
    };
    const resume = async () => {
        userStopped = false;
        syncPreview();
        await ref.reg?.resume();
    };
    /** The running agents of a root conversation. */
    const agentsOf = (root) => (latest?.agents ?? []).filter((a) => a.rootConversationId === root && !a.stopped);
    const onControl = (m, sessionId, root) => {
        log(`[DesktopHost] ${root === undefined ? 'viewer' : 'remote viewer'} ${sessionId.slice(0, 8)}: ${m.t}`);
        if (root !== undefined) {
            // A remote viewer controls only its own conversation's agents: its
            // Stop all stops those agents one by one, never the whole actuator.
            const mine = (latest?.agents ?? [])
                .filter((a) => a.rootConversationId === root)
                .map((a) => a.actor.id);
            const running = agentsOf(root).map((a) => a.actor.id);
            switch (m.t) {
                case 'stopAgent':
                    if (mine.includes(m.actorId)) {
                        stopAgent(m.actorId);
                    }
                    break;
                case 'stopAll':
                    running.forEach(stopAgent);
                    break;
                case 'takeOver':
                case 'handBack':
                    // Remote takeover is P3-3 (the remote user must keep seeing the
                    // window, which remote sessions don't while the user is in
                    // control); not accepted yet.
                    log(`[DesktopHost] remote ${m.t} ignored (P3-3)`);
                    break;
            }
            return;
        }
        switch (m.t) {
            case 'stopAgent':
                stopAgent(m.actorId);
                break;
            case 'stopAll':
                void stopAll('viewer Stop');
                break;
            case 'takeOver':
                takeOver(m.actorId);
                break;
            case 'handBack':
                void handBack(m.actorId);
                break;
        }
    };
    const closedListeners = new Set();
    if (o.preview) {
        const p = o.preview;
        if (!p.transport && !p.rtcPath) {
            throw new Error('the preview needs the agy-desktop-rtc path');
        }
        transport =
            p.transport ?? new rtcTransport_1.SidecarRtcTransport(p.rtcPath, log, o.helperEnv);
        const slots = (0, protocol_1.clampVideoSlots)(p.maxSlots ?? protocol_1.DEFAULT_VIDEO_SLOTS);
        sender = new rtcSender_1.RtcSender(transport, {
            onControl,
            onDemand: (local, roots) => {
                manager?.setDemand(local, roots);
                safe(() => o.onLocalViewers?.(local), log);
            },
            onNeedKeyframe: () => manager?.requestKeyframes(),
            onStreamKeyframe: (id) => manager?.requestKeyframe(id),
            onSessionClosed: (id) => {
                for (const l of [...closedListeners]) {
                    safe(() => l(id), log);
                }
            },
            log,
        }, undefined, { slots });
        const s = sender;
        manager = new previewManager_1.PreviewManager(helper, {
            onStreams: (streams) => s.setStreams(streams),
            onFrame: (stream, r) => s.sendFrame(stream, r),
        }, {
            maxFps: p.maxFps,
            maxLongEdgePx: p.maxLongEdgePx,
            maxStreams: slots,
            log,
        });
        driver.onPreviewTargets(syncPreview);
    }
    let viewer;
    if (o.remoteView) {
        if (!sender) {
            throw new Error('remote viewing needs the preview');
        }
        viewer = new viewerHandler_1.ComputerViewerHandler({
            actuatorId: o.actuatorId,
            desktopLabel: o.remoteView.desktopLabel,
            sender,
            pairing: new pairing_1.PairingStore(o.remoteView.pairingFile),
            prompter: helper,
            log,
        });
        viewer.register(o.client);
        log('[DesktopHost] remote viewing on (computer_viewer)');
    }
    // Script mode only once the child's sandbox selftest passed (then the
    // Hello is re-sent with supports_script).
    let scriptVerified = false;
    const scriptPath = o.scriptPath;
    const registration = (0, computerActuator_1.registerComputerActuator)({
        client: o.client,
        driver,
        script: scriptPath
            ? scriptRunnerFor(scriptPath, log, () => scriptVerified)
            : undefined,
        scriptTimeoutMs: o.scriptTimeoutMs,
        initialPaused: o.pauseStore?.load() ?? false,
        onPausedChanged: (paused) => o.pauseStore?.save(paused),
        onAgentActivity: (raw) => activities.push(colors.recolor(raw)),
        onState: (raw) => {
            colors.sync(raw.agents.map((a) => a.actor.id));
            const s = {
                ...raw,
                agents: raw.agents.map((a) => colors.recolor(a)),
            };
            if (s.connected && !wasConnected) {
                log(`[ComputerUse] subscribed actuator_type=computer actuator_id=${driver.surfaceId} client=${clientName}`);
            }
            wasConnected = s.connected;
            // Agents that left the lease no longer get a preview.
            if (latest) {
                const now = new Set(s.agents.map((a) => a.actor.id));
                for (const a of latest.agents) {
                    if (now.has(a.actor.id)) {
                        continue;
                    }
                    // A taken-over agent returned on AGENT_STOPPED: its tile stays.
                    if (!takeovers.leftLease(a)) {
                        driver.forgetPreviewTargets(a.actor.id);
                    }
                }
            }
            for (const a of raw.agents) {
                takeovers.inLease(a.actor.id);
            }
            // A resume from anywhere (e.g. the LS) ends the user's Stop.
            if (!s.paused) {
                userStopped = false;
            }
            latest = s;
            // Stop, takeover or the end of the lease: no stale cursors or pills.
            const live = s.agentActive && !s.paused;
            if (overlayLive && !live) {
                overlay?.clear();
            }
            overlayLive = live;
            pushAgents();
            syncPreview();
            safe(() => o.onState?.(s), log);
        },
        maxConfinementVersion: o.maxConfinementVersion ?? (() => (0, config_1.confinementCap)()),
        log,
    });
    ref.reg = registration;
    if (scriptPath) {
        void (0, scriptSelftest_1.scriptSandboxVerified)(scriptPath, {
            run: o.scriptSelftest,
            log,
        }).then((ok) => {
            scriptVerified = ok;
            if (ok) {
                void registration.refreshHello();
            }
        });
    }
    // The helper's caret progress while it types (#1459): an activity for that
    // agent (bounds only, never text), throttled like the rest.
    helper.onEvent('typing', (m) => {
        const a = typingActivity(m, latest?.agents ?? []);
        if (a && !takeovers.has(a.actor.id)) {
            activities.push(colors.recolor(a));
        }
    });
    const killSwitch = o.killSwitch ?? (() => (0, config_1.killSwitchEngaged)());
    const poll = () => void registration.setEnabled(!killSwitch());
    poll();
    const killTimer = setInterval(poll, config_1.KILL_SWITCH_POLL_MS);
    const preview = sender
        ? {
            open: () => sender.open(),
            answer: (id, sdp) => sender.answer(id, sdp),
            renew: (id) => sender.renew(id),
            close: (id) => sender.close(id),
            onClosed: (cb) => {
                closedListeners.add(cb);
                return () => {
                    closedListeners.delete(cb);
                };
            },
        }
        : undefined;
    let stopped = false;
    return {
        registration,
        helper,
        driver,
        preview,
        stopAgent,
        takeOver,
        handBack,
        stopAll,
        resume,
        revokeViewerDevice: (id) => viewer?.revokeDevice(id) ?? false,
        setOverlaySuppressed: (s) => overlay?.setSuppressed(s),
        stop: async () => {
            if (stopped) {
                return;
            }
            stopped = true;
            clearInterval(killTimer);
            takeovers.clear();
            activities.clear();
            sender?.closeAll();
            transport?.stop();
            await manager?.stop();
            await registration.dispose();
            await viewer?.dispose();
            helper.stop();
        },
    };
}
function safe(f, log) {
    try {
        f();
    }
    catch (err) {
        log(`[DesktopHost] embedder hook failed: ${String(err)}`);
    }
}
