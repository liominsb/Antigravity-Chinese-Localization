"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_ROTATE_BYTES = exports.KEEPER = void 0;
exports.shQuote = shQuote;
exports.buildBootstrapScript = buildBootstrapScript;
/**
 * Builds the POSIX sh script the Hub writes to `ssh -T ... -- <host> sh -s`.
 * It attaches to the user's running language server (LS), whatever its
 * version, unless the Hub asks it to replace exactly that server
 * (BootstrapParams.displace: an older one the Hub decided to restart). When
 * none runs, or once that one is stopped, it installs the Hub's version and
 * starts it detached in --persistent_mode, with what the user's login shell
 * adds to the environment (as in a terminal). Then it relays the sign-in URLs
 * the LS logs (see parseBootstrapLine).
 *
 * Caller contract:
 * - After the script, keep stdin open and write nothing; after NEED_UPLOAD,
 *   write the binary gzipped and end stdin (EOF alone declines).
 * - STATUS `checking`, then `attached`, or `waiting`, `invalid binary
 *   removed`, `downloading`, `installed`, `replacing` and `starting` as they
 *   apply, and `checking other host` and `taking over` (a home shared with
 *   another host); then
 *   FEATURES, READY and OPEN_URL lines, or OTHER_HOST and ERROR.
 * - An empty line every heartbeatSec during long waits and while streaming:
 *   once the Hub is gone, the next write fails and ends ssh and the script.
 * - SERVER_GONE once the LS it serves is gone, then it exits 0: ssh itself
 *   may stay up, waiting for forwarded channels to close (e.g. a browser's
 *   idle pooled socket). It also exits once its log's tail or the connection
 *   is gone (not 0, no event). The LS keeps running.
 */
const loginShellPolicy_1 = require("../loginShellPolicy");
const bootstrapProtocol_1 = require("./bootstrapProtocol");
const types_1 = require("./types");
const DEFAULT_START_TIMEOUT_SEC = 60;
/**
 * Ends before the Hub's connect timeout, leaving time to read the login
 * shell's environment and start the LS (roughly: ssh's setup and a download
 * aren't counted): the user sees who holds the lock.
 */
const DEFAULT_LOCK_TIMEOUT_SEC = types_1.REMOTE_CONNECT_TIMEOUT_SEC -
    DEFAULT_START_TIMEOUT_SEC -
    loginShellPolicy_1.LOGIN_SHELL_ENV_WAIT_SEC;
const DEFAULT_HEARTBEAT_SEC = 30;
/** Bounds how long a session outlives its LS; each check is a cheap kill -0. */
const DEFAULT_TICK_SEC = 2;
/** What the login shell is given (loginShellPolicy.ts), as `NAME='value' ...`. */
const LOGIN_ENV_GIVEN = Object.entries(loginShellPolicy_1.LOGIN_SHELL_INJECTED_ENV)
    .map(([name, value]) => `${name}=${shQuote(value)}`)
    .join(' ');
/** What isn't taken from it: the names above, and the dropped ones. */
const LOGIN_ENV_GIVEN_NAMES = Object.keys(loginShellPolicy_1.LOGIN_SHELL_INJECTED_ENV).join(' ');
const LOGIN_ENV_DROPPED = loginShellPolicy_1.LOGIN_SHELL_DROPPED_VARS.join(' ');
/** The login shells given the command on stdin, as a case pattern. */
const LOGIN_SHELLS_ON_STDIN = loginShellPolicy_1.LOGIN_SHELLS_READING_STDIN.join('|');
const MAX_LOCK_TIMEOUT_SEC = 24 * 60 * 60;
const MAX_START_TIMEOUT_SEC = 60 * 60;
const MAX_HEARTBEAT_SEC = 60 * 60;
const MAX_TICK_SEC = 60;
/**
 * A home directory shared by hosts: the keeper of the server that one of
 * them runs renews its lease this often, ...
 */
const SHARED_HOME_LEASE_SEC = 30;
/** ... others take a lease this old over (after watching it not change), ... */
const SHARED_HOME_STALE_SEC = 180;
/** ... and wait this long for its keeper to stop the server they take over. */
const SHARED_HOME_TAKE_OVER_SEC = 90;
/**
 * How often a keeper looks: a stop waits up to this long for it, against
 * forks and NFS round trips at each look.
 */
const KEEPER_TICK_SEC = 10;
/** A server asked to stop (SIGTERM) gets this long before SIGKILL. */
const SERVER_STOP_GRACE_SEC = 12;
/**
 * The shared-home protocol, between hosts that share one home directory and
 * may run different Hub versions (a keeper outlives Hub updates). Next to
 * the discovery file DISC:
 * - DISC.host `HOST PID`: the host and pid of the server DISC names, written
 *   by the bootstrap that starts it or attaches to it (older Hubs too).
 * - DISC.lease `HOST PID N v1`: renewed every SHARED_HOME_LEASE_SEC by that
 *   server's keeper, N counting up. Readers match the `HOST PID ` prefix,
 *   compare whole lines, and ignore later fields.
 * - DISC.stop `HOST PID`: another host asks that server's keeper to stop it.
 * - DISC.keeper `HOST KPID KSTART PID`: that keeper itself (its pid and the
 *   start time in /proc/KPID/stat), so that no second one runs.
 * Writers write a temp file and rename it. A keeper removes the notes that
 * name its server once the server is gone.
 *
 * The keeper: `AGY_KEEPER=KEEPER sh -c 'eval "$AGY_KEEPER"' agy-keeper DISC
 * HOST PID LEASE_SEC TICK_SEC START_SEC DISC_RE`. Its script is in the
 * environment, so that its arguments lead its command line: ps shows them,
 * and pgrep finds them (busybox reads only the first 1 KB). DISC_RE is DISC
 * as an ERE. It's started (in a session of its own) with each server, and
 * for a server of this host that we attach to, and runs for as long as that
 * process (its pid and start time, not a reused pid) does. Once DISC names
 * that server, it records itself and renews the lease, and it exits at once
 * if another live keeper of it is recorded (or, while it can't record
 * itself, if pgrep finds an older one). A failed write, and that pgrep, wait
 * a lease period before the next try, so a home that takes no writes (full,
 * read-only, AFS tokens gone) costs no more. If DISC doesn't name it within
 * START_SEC (the bootstrap's start timeout and a quarter, so that a
 * bootstrap still waiting acts first), its start failed and the Hub that
 * waited for it is gone: the keeper stops it. It stops the server
 * (SIGTERM, which the LS takes as its Exit RPC; SIGKILL after
 * SERVER_STOP_GRACE_SEC, to its group too if it leads one) when another host
 * asks (DISC.stop) or, once DISC has named it, another server takes DISC
 * over (which it then puts back: the LS removes it as it exits).
 */
exports.KEEPER = `set +aCefmvx
unset AGY_KEEPER
d=$1 h=$2 pid=$3 lease=$4 tick=$5 start=$6 re=$7 me="$2 $3" n=0 t=$4 w=0 r=$4
kf=$1.keeper armed=
ident() {
  id= pg= st=
  { IFS= read -r st <"/proc/$1/stat"; } 2>/dev/null || return 1
  st=\${st##*') '}
  set -- "$1" $st
  id="$1 \${21:-}" pg=\${4:-}
}
alive() {
  ident "$pid" && [ "$id" = "$sid" ]
}
other() {
  case $1 in "$h "*" $pid") ;; *) return 1 ;; esac
  [ "$1" != "$kid" ] || return 1
  set -- $1
  ident "$2" && [ "$id" = "$2 $3" ]
}
record() {
  { printf '%s\\n' "$kid" >"$kf.$$" && mv -f "$kf.$$" "$kf"; } 2>/dev/null ||
    rm -f "$kf.$$" 2>/dev/null
}
# Whether pgrep finds an older keeper of this server. Not pid order: our own
# command substitution's subshell has our command line, and may get a lower pid.
older() {
  for p in $(pgrep -f "[a]gy-keeper $re $h $pid " 2>/dev/null); do
    [ "$p" != "$$" ] && ident "$p" || continue
    set -- $id
    case $2 in ''|*[!0-9]*) continue ;; esac
    if [ "$2" -lt "$kst" ] || { [ "$2" = "$kst" ] && [ "$p" -lt "$$" ]; }; then
      return 0
    fi
  done
  return 1
}
stop() {
  kill -TERM "$pid" 2>/dev/null
  i=0
  while alive && [ "$i" -lt ${SERVER_STOP_GRACE_SEC} ]; do
    sleep 1
    i=$((i + 1))
  done
  if alive; then
    [ "$pg" != "$pid" ] || kill -KILL "-$pid" 2>/dev/null
    kill -KILL "$pid" 2>/dev/null
  fi
}
ident "$pid" || exit 0
sid=$id
ident $$ || exit 0
kid="$h $id $pid" kst=\${id#* }
while alive; do
  s=
  { IFS= read -r s <"$d.stop"; } 2>/dev/null
  if [ "$s" = "$me" ]; then
    stop
    break
  fi
  j= l=
  { while IFS= read -r l; do j=$j$l; done <"$d"; } 2>/dev/null
  j=$j$l
  case $j in
    *'"pid"'*)
      p=\${j#*'"pid"'}
      p=\${p#"\${p%%[!: ]*}"}
      p=\${p%%[!0-9]*}
      if [ "$p" = "$pid" ]; then
        armed=1
      elif [ -n "$p" ] && [ -n "$armed" ]; then
        stop
        # On its way out, the server removed the discovery file: another's.
        [ -e "$d" ] ||
          { printf '%s' "$j" >"$d.$$" && mv -f "$d.$$" "$d"; } 2>/dev/null
        break
      fi
      ;;
  esac
  if [ -z "$armed" ]; then
    # Not up after the start timeout: the Hub that waited for it is gone.
    if [ "$w" -gt "$start" ]; then
      stop
      break
    fi
  else
    k=
    { IFS= read -r k <"$kf"; } 2>/dev/null
    if [ "$k" != "$kid" ]; then
      other "$k" && exit 0
      if [ "$r" -ge "$lease" ]; then
        r=0
        record
        # Still unrecorded (e.g. a full home): the oldest keeper stays.
        k=
        { IFS= read -r k <"$kf"; } 2>/dev/null
        if [ "$k" != "$kid" ] && older; then
          exit 0
        fi
      fi
    fi
    if [ "$t" -ge "$lease" ]; then
      n=$((n + 1))
      t=0
      { printf '%s %s v1\\n' "$me" "$n" >"$d.lease.$$" && mv -f "$d.lease.$$" "$d.lease"; } 2>/dev/null ||
        rm -f "$d.lease.$$" 2>/dev/null
    fi
  fi
  sleep "$tick" 2>/dev/null
  t=$((t + tick)) w=$((w + tick)) r=$((r + tick))
done
for f in "$d.lease" "$d.host" "$d.stop"; do
  s=
  { IFS= read -r s <"$f"; } 2>/dev/null
  case $s in "$me"|"$me "*) rm -f "$f" 2>/dev/null ;; esac
done
k=
{ IFS= read -r k <"$kf"; } 2>/dev/null
[ "$k" != "$kid" ] || rm -f "$kf" 2>/dev/null
rm -f "$d.lease.$$" "$kf.$$" "$d.$$" 2>/dev/null
`;
/** An LS log bigger than this moves to `<log>.1` before a start. */
exports.LOG_ROTATE_BYTES = 50 * 1024 * 1024;
/** Quotes `s` as one POSIX shell word; throws on NUL, which none can hold. */
function shQuote(s) {
    if (s.includes('\0')) {
        throw new Error('shQuote: value contains a NUL character');
    }
    return `'${s.replace(/'/g, "'\\''")}'`;
}
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DISCOVERY_FILE_PATTERN = /^ls_[a-f0-9]{16}\.json$/;
// Printable ASCII without spaces; the scheme rules out a leading '-'.
const HTTPS_URL_PATTERN = /^https:\/\/[!-~]+$/;
const INSECURE_URL_PATTERN = /^(?:http|file):\/\/[!-~]+$/;
function hasControlChar(s) {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x20 || c === 0x7f) {
            return true;
        }
    }
    return false;
}
function checkName(what, value) {
    if (typeof value !== 'string' ||
        !NAME_PATTERN.test(value) ||
        /^\.+$/.test(value)) {
        throw new Error(`buildBootstrapScript: invalid ${what}: ${String(value)}`);
    }
}
function checkSeconds(what, value, defaultValue, max) {
    const v = value ?? defaultValue;
    if (!Number.isInteger(v) || v < 1 || v > max) {
        throw new Error(`buildBootstrapScript: invalid ${what}: ${String(value)}`);
    }
    return v;
}
function checkArtifactUrl(arch, url, allowInsecure) {
    const u = url ?? '';
    if (u &&
        !HTTPS_URL_PATTERN.test(u) &&
        !(allowInsecure && INSECURE_URL_PATTERN.test(u))) {
        throw new Error(`buildBootstrapScript: invalid ${arch} artifact URL (https:// required)`);
    }
    return u;
}
/** Linux PATH_MAX. */
const MAX_SERVER_PATH = 4096;
function checkServerPath(serverPath) {
    if (serverPath === undefined) {
        return '';
    }
    if (typeof serverPath !== 'string' ||
        !serverPath.startsWith('/') ||
        serverPath.length > MAX_SERVER_PATH ||
        hasControlChar(serverPath)) {
        throw new Error('buildBootstrapScript: invalid serverPath (an absolute path is required)');
    }
    return serverPath;
}
/** What agy_safe leaves of a host name, as OTHER_HOST reports it. */
const HOST_PATTERN = /^[A-Za-z0-9._/@+:,~-]{1,255}$/;
/** p.displace, checked: only on a full connect, with valid values. */
function checkDisplace(p) {
    const d = p.displace;
    if (d === undefined) {
        return undefined;
    }
    if (p.attachOnly === true) {
        throw new Error(`buildBootstrapScript: ${d.kind} needs a full connect`);
    }
    if (d.kind === 'replace') {
        checkName('replace version', d.server.version);
    }
    else if (typeof d.server.host !== 'string' ||
        !HOST_PATTERN.test(d.server.host)) {
        throw new Error('buildBootstrapScript: invalid takeOver host');
    }
    const { pid } = d.server;
    if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff) {
        throw new Error(`buildBootstrapScript: invalid ${d.kind} pid: ${String(pid)}`);
    }
    return d;
}
/** A Go flag's value (`--n v`, `-n=v`, ...; the last one wins, as in Go). */
function flagValue(args, name) {
    let value;
    for (let i = 0; i < args.length; i++) {
        for (const prefix of [`--${name}`, `-${name}`]) {
            if (args[i] === prefix && i + 1 < args.length) {
                value = args[i + 1];
            }
            else if (args[i].startsWith(`${prefix}=`)) {
                value = args[i].slice(prefix.length + 1);
            }
        }
    }
    return value;
}
/** `args` without any of a Go flag's occurrences (as flagValue reads them). */
function withoutFlag(args, name) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === `--${name}` || arg === `-${name}`) {
            i++; // Its value.
        }
        else if (!arg.startsWith(`--${name}=`) && !arg.startsWith(`-${name}=`)) {
            out.push(arg);
        }
    }
    return out;
}
function checkLsArgs(p) {
    if (!Array.isArray(p.lsArgs)) {
        throw new Error('buildBootstrapScript: lsArgs must be an array');
    }
    for (const arg of p.lsArgs) {
        if (typeof arg !== 'string' || hasControlChar(arg)) {
            throw new Error('buildBootstrapScript: lsArgs must be strings without control characters');
        }
    }
    // The script finds the LS through these; a mismatch would never attach.
    const ideVersion = flagValue(p.lsArgs, 'override_ide_version');
    if (ideVersion !== undefined && ideVersion !== p.version) {
        throw new Error('buildBootstrapScript: --override_ide_version must equal version');
    }
    const appDataDir = flagValue(p.lsArgs, 'app_data_dir');
    if (appDataDir !== undefined && appDataDir !== p.appDataDir) {
        throw new Error('buildBootstrapScript: --app_data_dir must equal appDataDir');
    }
    const workspaceId = flagValue(p.lsArgs, 'workspace_id');
    if (workspaceId !== undefined &&
        (0, bootstrapProtocol_1.discoveryFileNameFor)(workspaceId) !== p.discoveryFileName) {
        throw new Error('buildBootstrapScript: discoveryFileName does not match --workspace_id');
    }
}
/**
 * Tag for shell source: raw text (`\n` reaches the shell as is), and `\${`
 * for a shell `${`. Values go in verbatim: callers must quote them.
 */
function sh(strings, ...values) {
    let out = '';
    for (const [i, chunk] of strings.raw.entries()) {
        out += chunk.replace(/\\\$\{/g, () => '${');
        if (i < values.length) {
            out += values[i];
        }
    }
    return out;
}
/**
 * Validates every input (throws) and shQuote()s every value. CSRF tokens
 * appear only in READY; OPEN_URL lines and LS_START_FAILED text mask them.
 */
function buildBootstrapScript(p) {
    if (typeof p.marker !== 'string' || !bootstrapProtocol_1.MARKER_PATTERN.test(p.marker)) {
        throw new Error('buildBootstrapScript: invalid marker');
    }
    checkName('version', p.version);
    checkName('appDataDir', p.appDataDir);
    if (typeof p.discoveryFileName !== 'string' ||
        !DISCOVERY_FILE_PATTERN.test(p.discoveryFileName)) {
        throw new Error('buildBootstrapScript: invalid discoveryFileName');
    }
    const overrides = p.testOverrides ?? {};
    const allowInsecure = overrides.allowInsecureArtifactUrls === true;
    const urlX64 = checkArtifactUrl('x64', p.artifacts?.x64?.url, allowInsecure);
    const urlArm64 = checkArtifactUrl('arm64', p.artifacts?.arm64?.url, allowInsecure);
    checkLsArgs(p);
    const serverPath = checkServerPath(p.serverPath);
    const displace = checkDisplace(p);
    const replace = displace?.kind === 'replace' ? displace.server : undefined;
    const takeOver = displace?.kind === 'takeOver' ? displace.server : undefined;
    const leaseSec = checkSeconds('leaseSec', overrides.leaseSec, SHARED_HOME_LEASE_SEC, SHARED_HOME_LEASE_SEC);
    const takeOverSec = checkSeconds('takeOverSec', overrides.takeOverSec, SHARED_HOME_TAKE_OVER_SEC, SHARED_HOME_TAKE_OVER_SEC);
    const lockTimeout = checkSeconds('lockTimeoutSec', p.lockTimeoutSec, DEFAULT_LOCK_TIMEOUT_SEC, MAX_LOCK_TIMEOUT_SEC);
    const startTimeout = checkSeconds('startTimeoutSec', p.startTimeoutSec, DEFAULT_START_TIMEOUT_SEC, MAX_START_TIMEOUT_SEC);
    const heartbeat = checkSeconds('heartbeatSec', p.heartbeatSec, DEFAULT_HEARTBEAT_SEC, MAX_HEARTBEAT_SEC);
    const tick = checkSeconds('tickSec', overrides.tickSec, DEFAULT_TICK_SEC, MAX_TICK_SEC);
    const envTimeout = checkSeconds('loginEnvTimeoutSec', overrides.loginEnvTimeoutSec, loginShellPolicy_1.LOGIN_SHELL_ENV_WAIT_SEC, loginShellPolicy_1.LOGIN_SHELL_ENV_WAIT_SEC);
    const token = flagValue(p.lsArgs, 'csrf_token') ?? '';
    const workspaceId = flagValue(p.lsArgs, 'workspace_id') ?? '';
    // The token goes in separately (agy_exec_ls).
    const lsArgs = withoutFlag(p.lsArgs, 'csrf_token')
        .map((a) => ` \\\n    ${shQuote(a)}`)
        .join('');
    const header = sh `#!/bin/sh
set +aCefmvx
# Undoes a login environment's options (bash as sh imports SHELLOPTS; xtrace
# would print the token). agy_main runs last: sh -s has read it all by then.

agy_main() {
  agy_marker=${shQuote(p.marker)}
  agy_version=${shQuote(p.version)}
  agy_appdir=${shQuote(p.appDataDir)}
  agy_discname=${shQuote(p.discoveryFileName)}
  agy_wsid=${shQuote(workspaceId)}
  agy_rootname=${shQuote(types_1.REMOTE_INSTALL_ROOT)}
  agy_url_x64=${shQuote(urlX64)}
  agy_url_arm64=${shQuote(urlArm64)}
  agy_serverpath=${shQuote(serverPath)}
  agy_attach_only=${p.attachOnly === true ? '1' : '0'}
  agy_rep_ver=${shQuote(replace?.version ?? '')}
  agy_rep_pid=${replace ? String(replace.pid) : "''"}
  agy_to_host=${shQuote(takeOver?.host ?? '')}
  agy_to_pid=${takeOver ? String(takeOver.pid) : "''"}
  agy_lease_sec=${String(leaseSec)}
  agy_stale=${String(SHARED_HOME_STALE_SEC)}
  agy_to_wait=${String(takeOverSec)}
  agy_ktick=${String(Math.min(KEEPER_TICK_SEC, leaseSec))}
  agy_keeper_sh=${shQuote(exports.KEEPER)}
  agy_tok=${shQuote(token)}
  agy_lock_timeout=${String(lockTimeout)}
  agy_upload_timeout=${String(types_1.REMOTE_UPLOAD_TIMEOUT_SEC)}
  agy_start_timeout=${String(startTimeout)}
  agy_hb=${String(heartbeat)}
  agy_tick=${String(tick)}
  agy_env_timeout=${String(envTimeout)}
  agy_rotate_bytes=${String(exports.LOG_ROTATE_BYTES)}
  agy_binchk=${overrides.skipServerBinaryCheck === true ? '0' : '1'}
  agy_run
}

# Its stdio must not hold the SSH channel open. Its argv, which ps shows to
# every user of the host, has no token: an LS that reads
# ANTIGRAVITY_SERVER_CSRF_TOKEN gets it in its environment, which only the user
# and root can read; an older one as --csrf_token (agy_token_via, README).
# The former also keeps it out of its start page (GET /), which anyone on the
# host can load: the Hub opens the page with a one-time token instead (#t=).
agy_exec_ls() {
  set --${lsArgs}
  unset ANTIGRAVITY_SERVER_CSRF_TOKEN AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP \
    ANTIGRAVITY_ENABLE_CREDENTIAL_IMPORT
  case $agy_tokvia in
    env)
      # Credential import works only on such a server (the LS checks).
      ANTIGRAVITY_SERVER_CSRF_TOKEN=$agy_tok
      AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP=1
      ANTIGRAVITY_ENABLE_CREDENTIAL_IMPORT=1
      export ANTIGRAVITY_SERVER_CSRF_TOKEN AGY_REQUIRE_AUTHENTICATED_UI_BOOTSTRAP \
        ANTIGRAVITY_ENABLE_CREDENTIAL_IMPORT
      ;;
    argv) set -- "$@" --csrf_token "$agy_tok" ;;
  esac
  exec \${agy_ss:+"$agy_ss"} \${agy_nh:+"$agy_nh"} "$agy_bin" "$@" \
    </dev/null >>"$agy_log" 2>&1
}
`;
    return header + SCRIPT_BODY;
}
const SCRIPT_BODY = sh `
agy_run() {
  # End a partial line the login shell printed.
  printf '\n'
  set -u
  agy_nl='
'
  agy_cr=$(printf '\r')
  agy_tmpf=
  agy_bgpid=
  agy_envpg=
  agy_lockdir=
  agy_brk=
  agy_stopnote=
  agy_json=
  agy_dpid=
  agy_dver=
  agy_dtok=
  agy_ss=
  agy_nh=
  agy_tokvia=none
  agy_uiboot=
  agy_tailfrom='-n 0'
  agy_host=$(uname -n 2>/dev/null) || agy_host=
  trap agy_cleanup EXIT
  # Signals (SIGPIPE: the Hub is gone) exit through the EXIT trap's cleanup.
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 141' PIPE
  trap 'exit 143' TERM
  agy_umask0=$(umask)
  umask 077
  if sleep 0.01 2>/dev/null; then
    agy_nap_s=0.2
    agy_naps=5
  else
    agy_nap_s=1
    agy_naps=1
  fi
  agy_emit STATUS checking
  agy_probe
  agy_paths
  agy_check_paths
  # A replace decides under the lock (agy_attach_or_start).
  if [ -z "$agy_rep_pid" ] && agy_read_disc && agy_is_ls_pid "$agy_dpid"; then
    # Installs nothing, so no lock.
    agy_attached
  elif [ "$agy_attach_only" = 1 ]; then
    # A connect from elsewhere may be starting one, e.g. replacing the server
    # this session served: wait while it holds the install lock.
    agy_await_unlocked
    if ! { agy_read_disc_settled && agy_is_ls_pid "$agy_dpid"; }; then
      # Another pool machine sharing this home may run it (its lease is
      # live, or an older Hub left no lease): say where, not that it stopped.
      agy_check_other_host unlocked
      agy_fail LS_STOPPED 'no server is running'
    fi
    agy_attached
  else
    agy_check_other_host unlocked
    mkdir -p "$agy_root/bin" "$agy_datadir" 2>/dev/null ||
      agy_fail INSTALL_FAILED "cannot create $agy_root"
    chmod 700 "$agy_root" 2>/dev/null
    # Attach-or-start under the lock too: concurrent connects start one LS.
    agy_lock
    agy_attach_or_start
    agy_unlock
  fi
  agy_emit FEATURES "\${agy_uiboot:+ui-bootstrap}"
  agy_emit READY "$agy_json"
  agy_stream && agy_emit SERVER_GONE ''
}

agy_emit() {
  agy_p=$2
  case $agy_p in
    *"$agy_nl"*|*"$agy_cr"*) agy_p=$(printf '%s' "$agy_p" | tr '\r\n' '  ') ;;
  esac
  printf '%s %s %s\n' "$agy_marker" "$1" "$agy_p"
}

agy_fail() {
  agy_emit ERROR "code=$1 $2"
  exit 1
}

agy_cleanup() {
  if [ -n "$agy_bgpid" ]; then
    kill "$agy_bgpid" 2>/dev/null
  fi
  if [ -n "$agy_envpg" ]; then
    kill -KILL "-$agy_envpg" 2>/dev/null
    # tcsh puts its background jobs in groups of their own.
    pkill -KILL -s "$agy_envpg" 2>/dev/null
  fi
  if [ -n "$agy_tmpf" ]; then
    rm -f "$agy_tmpf" 2>/dev/null
  fi
  if [ -n "$agy_brk" ]; then
    rmdir "$agy_brk" 2>/dev/null
  fi
  agy_withdraw_stop
  agy_unlock
}

agy_nap() {
  sleep "$agy_nap_s" 2>/dev/null || sleep 1
}

# Keep-alive; a failed write (SIGPIPE may be ignored) means the Hub is gone.
agy_beat() {
  printf '\n' 2>/dev/null || exit 141
}

# agy_beating CMD...: runs CMD with keep-alives; sets agy_rc to its status.
agy_beating() {
  "$@" </dev/null >/dev/null 2>&1 &
  agy_bgpid=$!
  agy_i=0
  while kill -0 "$agy_bgpid" 2>/dev/null; do
    agy_nap
    agy_i=$((agy_i + 1))
    if [ "$agy_i" -ge $((agy_hb * agy_naps)) ]; then
      agy_i=0
      agy_beat
    fi
  done
  wait "$agy_bgpid"
  agy_rc=$?
  agy_bgpid=
}

# Sets agy_s to $1 with unusual characters replaced by _.
agy_safe() {
  case $1 in
    *[!A-Za-z0-9._/@+:,~-]*)
      agy_s=$(printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9._/@+:,~-' '_') ;;
    *) agy_s=$1 ;;
  esac
}

# Sets agy_r to $1 with both CSRF tokens (ours, the server's) masked.
agy_redact() {
  agy_r=$1
  agy_redact1 "$agy_tok"
  agy_redact1 "$agy_dtok"
}

agy_redact1() {
  [ -n "$1" ] || return 0
  agy_rest=$agy_r
  agy_r=
  while :; do
    case $agy_rest in
      *"$1"*)
        agy_r=$agy_r\${agy_rest%%"$1"*}'<redacted>'
        agy_rest=\${agy_rest#*"$1"}
        ;;
      *) break ;;
    esac
  done
  agy_r=$agy_r$agy_rest
}

# Refuses hosts the LS can't run on, and those without awk (for sign-in URLs).
agy_probe() {
  agy_os=$(uname -s 2>/dev/null) || agy_os=
  agy_march=$(uname -m 2>/dev/null) || agy_march=
  agy_safe "\${agy_os:-unknown}"
  agy_p_os=$agy_s
  agy_safe "\${agy_march:-unknown}"
  agy_p_arch=$agy_s
  [ "$agy_os" = Linux ] ||
    agy_fail UNSUPPORTED_HOST "unsupported operating system: $agy_p_os (Linux is required)"
  case $agy_march in
    x86_64|amd64) agy_arch=x64 ;;
    aarch64|arm64) agy_arch=arm64 ;;
    *) agy_fail UNSUPPORTED_HOST "unsupported CPU architecture: $agy_p_arch (x86_64 or aarch64 is required)" ;;
  esac
  agy_lb=$(getconf LONG_BIT 2>/dev/null) || agy_lb=
  [ "$agy_lb" != 32 ] ||
    agy_fail UNSUPPORTED_HOST "32-bit userland on $agy_p_arch is not supported"
  agy_libc
  command -v awk >/dev/null 2>&1 ||
    agy_fail UNSUPPORTED_HOST 'awk is required'
}

# Needs glibc 2.26 or newer, not musl; carries on when it can't tell.
agy_libc() {
  agy_g=$(getconf GNU_LIBC_VERSION 2>/dev/null) || agy_g=
  case $agy_g in
    'glibc '*) agy_g=\${agy_g#glibc } ;;
    *)
      agy_g=$(ldd --version 2>&1 </dev/null | head -n 1)
      case $agy_g in
        *musl*) agy_fail UNSUPPORTED_HOST 'musl libc is not supported (glibc 2.26 or newer is required)' ;;
        *GLIBC*|*'GNU libc'*|*'GNU C Library'*) agy_g=\${agy_g##* } ;;
        *) return 0 ;;
      esac
      ;;
  esac
  case $agy_g in
    [0-9]*.[0-9]*) ;;
    *) return 0 ;;
  esac
  agy_gmaj=\${agy_g%%.*}
  agy_gmin=\${agy_g#*.}
  agy_gmin=\${agy_gmin%%[!0-9]*}
  case $agy_gmaj in *[!0-9]*) return 0 ;; esac
  if [ "$agy_gmaj" -lt 2 ] || { [ "$agy_gmaj" -eq 2 ] && [ "$agy_gmin" -lt 26 ]; }; then
    agy_safe "$agy_g"
    agy_fail UNSUPPORTED_HOST "glibc $agy_s is too old (2.26 or newer is required)"
  fi
  return 0
}

agy_paths() {
  case \${HOME:-} in
    /*) ;;
    *) agy_fail INSTALL_FAILED 'HOME is not set to an absolute path' ;;
  esac
  agy_root=$HOME/$agy_rootname
  agy_bindir=$agy_root/bin/$agy_version-$agy_arch
  agy_bin=$agy_bindir/language_server
  agy_datadir=$agy_root/data
  agy_log=$agy_datadir/ls-$agy_version.log
  agy_daemon=$HOME/.gemini/$agy_appdir/daemon
  agy_disc=$agy_daemon/$agy_discname
  agy_disc_re=
  if [ "$agy_arch" = arm64 ]; then
    agy_url=$agy_url_arm64
  else
    agy_url=$agy_url_x64
  fi
  [ -z "$agy_serverpath" ] || agy_bin=$agy_serverpath
}

# Other users must not swap our binary or plant a server: what exists must
# be ours (-O follows symlinks). A server path is the user's own choice.
agy_check_paths() {
  set -- "$agy_root" "$agy_root/bin" "$agy_datadir" "$agy_daemon" "$agy_disc"
  [ -n "$agy_serverpath" ] || set -- "$@" "$agy_bindir" "$agy_bin"
  for agy_f do
    [ -e "$agy_f" ] || continue
    [ -O "$agy_f" ] ||
      agy_fail INSTALL_FAILED "$agy_f is not owned by you"
  done
}

# mkdir lock; its pid file names the holder (agy_holder). A gone holder of
# this host is taken over; others are waited for (can't check other hosts).
agy_lock() {
  agy_ld=$agy_root/install.lock.d
  agy_waited=0
  until mkdir "$agy_ld" 2>/dev/null; do
    if [ ! -d "$agy_ld" ]; then
      # The holder just left, or we can't create it.
      mkdir "$agy_ld" 2>/dev/null && break
      [ -d "$agy_ld" ] ||
        agy_fail INSTALL_FAILED "cannot create $agy_ld"
    fi
    agy_o=
    { IFS= read -r agy_o <"$agy_ld/pid"; } 2>/dev/null
    # Holder gone: one waiter at a time (break) removes the lock, only if it
    # still names that holder; a killed breaker leaves it to the timeout.
    if agy_holder_gone "$agy_o" && mkdir "$agy_ld/break" 2>/dev/null; then
      agy_brk=$agy_ld/break
      agy_o2=
      { IFS= read -r agy_o2 <"$agy_ld/pid"; } 2>/dev/null
      if [ "$agy_o2" = "$agy_o" ]; then
        rm -rf "$agy_ld" 2>/dev/null
      else
        rmdir "$agy_brk" 2>/dev/null
      fi
      agy_brk=
      continue
    fi
    [ "$agy_waited" -gt 0 ] || agy_emit STATUS waiting
    [ "$agy_waited" -lt "$agy_lock_timeout" ] || agy_lock_timed_out
    sleep 1
    agy_waited=$((agy_waited + 1))
    [ $((agy_waited % agy_hb)) -ne 0 ] || agy_beat
  done
  agy_lockdir=$agy_ld
  agy_holder $$
  { printf '%s\n' "$agy_h" >"$agy_ld/pid"; } 2>/dev/null
  return 0
}

# Names agy_o's holder: its pid here, else its host (only it can check).
agy_lock_timed_out() {
  agy_record_age "$agy_ld/pid"
  agy_m='no connect is running'
  case $agy_o in
    "$agy_host "[0-9]*) agy_w=\${agy_o#"$agy_host "}; agy_w="pid \${agy_w%% *}" ;;
    *' '[0-9]*)
      agy_safe "\${agy_o%% *}"
      agy_w="host $agy_s"
      agy_m="$agy_s is no longer connecting"
      ;;
    *) agy_w='another process' ;;
  esac
  agy_fail INSTALL_FAILED "timed out after $agy_lock_timeout s waiting for another installation (held by $agy_w$agy_hage); delete $agy_ld if $agy_m"
}

# Sets agy_h to "<host> <PID> <start time>": the start time (empty once PID
# is gone) tells PID from a later process with that pid, e.g. after a reboot.
# Sets agy_pg to PID's process group.
agy_holder() {
  agy_h=
  { IFS= read -r agy_h <"/proc/$1/stat"; } 2>/dev/null
  # Strip "pid (comm) " (comm may have spaces), then split the rest unquoted.
  agy_h=\${agy_h##*') '}
  set -- "$1" $agy_h
  agy_pg=\${4:-}
  agy_h="$agy_host $1 \${21:-}"
}

# Whether lock holder $1 (as agy_holder names it) is gone from this host.
agy_holder_gone() {
  case $1 in "$agy_host "[0-9]*) ;; *) return 1 ;; esac
  agy_lp=\${1#"$agy_host "}
  agy_holder "\${agy_lp%% *}"
  [ "$agy_h" != "$1" ]
}

agy_unlock() {
  if [ -n "$agy_lockdir" ]; then
    rm -rf "$agy_lockdir" 2>/dev/null
    agy_lockdir=
  fi
}

# $1 starts like a 64-bit little-endian ELF executable for agy_arch.
agy_elf_ok() {
  [ "$agy_binchk" = 1 ] || return 0
  agy_e=$(od -An -tu1 -N20 "$1" 2>/dev/null </dev/null) || return 1
  set -- $agy_e
  [ "$#" -eq 20 ] && [ "$1.$2.$3.$4.$5.$6" = 127.69.76.70.2.1 ] || return 1
  case $agy_arch in
    x64) [ "\${19}.\${20}" = 62.0 ] ;;
    arm64) [ "\${19}.\${20}" = 183.0 ] ;;
    *) return 1 ;;
  esac
}

agy_bin_ok() {
  [ -f "$agy_bin" ] && [ -x "$agy_bin" ] && agy_elf_ok "$agy_bin"
}

# Fails before a download where nothing can run (noexec): not every test -x
# sees that, so this runs a tiny script.
agy_check_exec() {
  agy_tmpf=$agy_bindir/.exec-test.$$
  if printf '#!/bin/sh\nexit 0\n' 2>/dev/null >"$agy_tmpf"; then
    chmod 755 "$agy_tmpf" 2>/dev/null
    "$agy_tmpf" </dev/null >/dev/null 2>&1
    agy_rc=$?
    rm -f "$agy_tmpf" 2>/dev/null
    [ "$agy_rc" -ne 126 ] ||
      agy_fail INSTALL_FAILED "cannot run programs from $agy_bindir (is it on a noexec mount?)"
  fi
  agy_tmpf=
}

# Removes exec tests, and .partial.<pid> downloads whose pid is gone.
agy_clean_partials() {
  for agy_f in "$agy_bindir"/.partial.* "$agy_bindir"/.exec-test.*; do
    [ -e "$agy_f" ] || continue
    case $agy_f in
      */.partial.*)
        agy_op=\${agy_f##*.}
        case $agy_op in
          ''|*[!0-9]*) ;;
          *) ! kill -0 "$agy_op" 2>/dev/null || continue ;;
        esac
        ;;
    esac
    rm -f "$agy_f" 2>/dev/null
  done
}

agy_install() {
  agy_clean_partials
  agy_check_exec
  if [ -e "$agy_bin" ] || [ -L "$agy_bin" ]; then
    if [ -f "$agy_bin" ] && agy_elf_ok "$agy_bin"; then
      [ -x "$agy_bin" ] || chmod 755 "$agy_bin" 2>/dev/null
      return 0
    fi
    rm -rf "$agy_bin" 2>/dev/null
    agy_emit STATUS 'invalid binary removed'
  fi
  [ -n "$agy_url" ] ||
    agy_fail INSTALL_FAILED "no download URL for linux-$agy_arch"
  agy_tmpf=$agy_bindir/.partial.$$
  agy_download || agy_upload
  chmod 755 "$agy_tmpf" 2>/dev/null && mv -f "$agy_tmpf" "$agy_bin" 2>/dev/null ||
    agy_fail INSTALL_FAILED 'could not install the binary'
  agy_tmpf=
  agy_emit STATUS installed
  agy_prune
}

# On failure, agy_why says why. Timeouts: a stall must not hold the lock.
agy_download() {
  agy_emit STATUS downloading
  if command -v curl >/dev/null 2>&1; then
    agy_dl=curl
    set -- -fsSL --connect-timeout 10 --speed-time 60 --speed-limit 1024
    case $agy_url in
      https://*) set -- "$@" --proto =https --proto-redir =https ;;
    esac
    agy_beating curl "$@" -o "$agy_tmpf" "$agy_url"
  elif command -v wget >/dev/null 2>&1; then
    agy_dl=wget
    set -- -q -T 20 -t 2
    case $agy_url in
      https://*)
        # A redirect could go to http:// (--https-only is for recursive
        # downloads); a wget that can't refuse it (busybox) isn't used.
        case $(wget --help 2>&1 </dev/null) in
          *--max-redirect*) set -- "$@" --max-redirect=0 ;;
          *) agy_why='wget cannot enforce https (install curl)'; return 1 ;;
        esac
        ;;
    esac
    agy_beating wget "$@" -O "$agy_tmpf" "$agy_url"
  else
    agy_why='neither curl nor wget is installed'
    return 1
  fi
  agy_why="$agy_dl exit code $agy_rc"
  [ "$agy_rc" -eq 0 ] || return 1
  agy_why="not a linux-$agy_arch executable"
  agy_elf_ok "$agy_tmpf"
}

# NEED_UPLOAD, then the binary gzipped on stdin until EOF (gzip checks length
# and CRC; no data: the Hub can't). It holds the lock: fail after two
# keep-alives without data (sshd may take hours to notice a sleeping laptop).
agy_upload() {
  command -v gzip >/dev/null 2>&1 ||
    agy_fail INSTALL_FAILED "download failed: $agy_why (an upload needs gzip)"
  agy_emit NEED_UPLOAD "$agy_arch $agy_why"
  # A background job's stdin is /dev/null: pass ours on fd 4.
  exec 4<&0
  gzip -dc <&4 >"$agy_tmpf" 2>/dev/null 4<&- &
  agy_bgpid=$!
  exec 4<&-
  agy_t=0
  agy_idle=0
  agy_sz0=
  while kill -0 "$agy_bgpid" 2>/dev/null; do
    sleep 1
    agy_t=$((agy_t + 1))
    # Not only wc -c (POSIX): busybox's reads the whole file each time.
    agy_sz=$(stat -c %s "$agy_tmpf" 2>/dev/null </dev/null) ||
      agy_sz=$({ wc -c <"$agy_tmpf"; } 2>/dev/null) || agy_sz=
    [ "$agy_sz" = "$agy_sz0" ] && agy_idle=$((agy_idle + 1)) || agy_idle=0
    agy_sz0=$agy_sz
    [ "$agy_idle" -lt $((2 * agy_hb)) ] ||
      agy_fail INSTALL_FAILED "upload failed: no data for $agy_idle s"
    [ "$agy_t" -lt "$agy_upload_timeout" ] ||
      agy_fail INSTALL_FAILED "upload failed: not done after $agy_upload_timeout s"
    [ $((agy_t % agy_hb)) -ne 0 ] || agy_beat
  done
  wait "$agy_bgpid"
  agy_rc=$?
  agy_bgpid=
  [ -s "$agy_tmpf" ] || agy_fail INSTALL_FAILED "download failed: $agy_why"
  [ "$agy_rc" -eq 0 ] ||
    agy_fail INSTALL_FAILED 'upload failed: incomplete or corrupt'
  agy_elf_ok "$agy_tmpf" ||
    agy_fail INSTALL_FAILED "upload failed: not a linux-$agy_arch executable"
}

# Keeps the two newest installs (another Hub may use one) and what a process
# runs; removes other versions, and logs of uninstalled ones. Nothing while
# another host runs a server (its processes are invisible here).
agy_prune() {
  for agy_f in "$HOME"/.gemini/*/daemon/ls_*.json; do
    [ -f "$agy_f" ] || continue
    ! agy_foreign "$agy_f" || return 0
  done
  # procps ps cuts args at an exported COLUMNS even when piped.
  agy_procs=$(unset COLUMNS; ps -eo args 2>/dev/null </dev/null) || return 0
  [ -n "$agy_procs" ] || return 0
  set --
  for agy_f in "$agy_root"/bin/*/language_server; do
    agy_n=\${agy_f%/language_server}
    agy_n=\${agy_n##*/}
    case $agy_n in .*|*[!A-Za-z0-9._-]*) continue ;; esac
    [ ! -f "$agy_f" ] || set -- "$@" "$agy_n"
  done
  [ "$#" -gt 0 ] || return 0
  agy_new=$(cd "$agy_root/bin" && ls -1dt -- "$@" 2>/dev/null </dev/null) ||
    return 0
  agy_k1=\${agy_new%%"$agy_nl"*}
  agy_new=\${agy_new#*"$agy_nl"}
  agy_k2=\${agy_new%%"$agy_nl"*}
  for agy_d in "$agy_root"/bin/*; do
    [ -d "$agy_d" ] || continue
    agy_n=\${agy_d##*/}
    case $agy_n in .*|*[!A-Za-z0-9._-]*) continue ;; esac
    case $agy_n in "$agy_version-$agy_arch"|"$agy_k1"|"$agy_k2") continue ;; esac
    case $agy_procs in *"$agy_d/"*) continue ;; esac
    rm -rf "$agy_d" 2>/dev/null
  done
  for agy_f in "$agy_datadir"/ls-*.log "$agy_datadir"/ls-*.log.*; do
    [ -f "$agy_f" ] || continue
    agy_lv=\${agy_f##*/ls-}
    agy_lv=\${agy_lv%.log*}
    case $agy_lv in ''|.*|*[!A-Za-z0-9._-]*) continue ;; esac
    [ -d "$agy_root/bin/$agy_lv-x64" ] || [ -d "$agy_root/bin/$agy_lv-arm64" ] ||
      rm -f "$agy_f" 2>/dev/null
  done
  return 0
}

# agy_jnum/agy_jstr JSON KEY: set agy_v to that field of the flat JSON.
agy_jnum() {
  agy_v=
  agy_k="\"$2\""
  case $1 in *"$agy_k"*) ;; *) return 1 ;; esac
  agy_v=\${1#*"$agy_k"}
  agy_v=\${agy_v#"\${agy_v%%[!: ]*}"}
  agy_v=\${agy_v%%[!0-9]*}
  [ -n "$agy_v" ]
}

agy_jstr() {
  agy_v=
  agy_k="\"$2\""
  case $1 in *"$agy_k"*) ;; *) return 1 ;; esac
  agy_v=\${1#*"$agy_k"}
  agy_v=\${agy_v#"\${agy_v%%[!: ]*}"}
  case $agy_v in '"'*) ;; *) agy_v=; return 1 ;; esac
  agy_v=\${agy_v#?}
  agy_v=\${agy_v%%'"'*}
  return 0
}

# Sets agy_json, agy_dpid, agy_dver, agy_dtok. Fails on a file not ours, or
# partial (the LS doesn't write it atomically).
agy_read_disc() {
  agy_json=
  agy_dpid=
  agy_dver=
  agy_dtok=
  [ -f "$agy_disc" ] && [ -O "$agy_disc" ] || return 1
  agy_j=$({ tr -d '\r\n' <"$agy_disc"; } 2>/dev/null) || return 1
  case $agy_j in '{'*'}') ;; *) return 1 ;; esac
  case $agy_j in *'"csrfToken"'*) ;; *) return 1 ;; esac
  agy_jnum "$agy_j" pid || return 1
  agy_jp=$agy_v
  agy_jstr "$agy_j" lsVersion || return 1
  agy_jv=$agy_v
  agy_jstr "$agy_j" csrfToken || agy_v=
  agy_json=$agy_j
  agy_dpid=$agy_jp
  agy_dver=$agy_jv
  agy_dtok=$agy_v
  return 0
}

# PID runs a server with our --workspace_id and --app_data_dir, whatever its
# binary, so it isn't a reused pid, nor another app's server (insiders and
# stable share the install root, not the app data dir). 2: alive, but its
# command line can't be read (e.g. tr can't fork).
agy_is_ls_pid() {
  case $1 in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$1" 2>/dev/null || return 1
  agy_c=$({ tr '\000' ' ' <"/proc/$1/cmdline"; } 2>/dev/null) ||
    { kill -0 "$1" 2>/dev/null && return 2; return 1; }
  case $agy_c in *" --workspace_id $agy_wsid "*) ;; *) return 1 ;; esac
  case $agy_c in *" --app_data_dir $agy_appdir "*) return 0 ;; esac
  return 1
}

# SIGTERM (to its group under setsid), up to SERVER_STOP_GRACE_SEC to exit,
# then SIGKILL, to its process group too if it leads one. With "alone" (a
# server being replaced), SIGTERM goes to PID alone, as its Exit RPC would:
# the LS shuts down gracefully and stops its agents.
agy_stop() {
  agy_sp=$1
  [ "\${2:-}" = alone ] || [ -z "$agy_ss" ] || agy_sp=-$1
  kill -TERM "$agy_sp" 2>/dev/null || kill -TERM "$1" 2>/dev/null || return 0
  agy_i=0
  while kill -0 "$1" 2>/dev/null; do
    agy_i=$((agy_i + 1))
    if [ "$agy_i" -gt $((${String(SERVER_STOP_GRACE_SEC)} * agy_naps)) ]; then
      agy_holder "$1"
      [ "$agy_pg" != "$1" ] || kill -KILL "-$1" 2>/dev/null
      kill -KILL "$1" 2>/dev/null
      break
    fi
    agy_nap
  done
  return 0
}

# agy_read_disc, giving a server that is writing the file a moment.
agy_read_disc_settled() {
  agy_i=0
  until agy_read_disc || [ ! -f "$agy_disc" ]; do
    agy_i=$((agy_i + 1))
    [ "$agy_i" -le $((2 * agy_naps)) ] || return 1
    agy_nap
  done
}

# agy_foreign DISC: DISC.host (agy_record_host) names another host, and DISC
# still holds its pid. Sets agy_ohost and agy_opid.
agy_foreign() {
  [ -n "$agy_host" ] || return 1
  agy_o=
  { IFS= read -r agy_o <"$1.host"; } 2>/dev/null
  agy_ohost=\${agy_o% *}
  agy_opid=\${agy_o##* }
  [ -n "$agy_ohost" ] && [ "$agy_ohost" != "$agy_o" ] &&
    [ "$agy_ohost" != "$agy_host" ] || return 1
  agy_j=$({ tr -d '\r\n' <"$1"; } 2>/dev/null) || return 1
  agy_jnum "$agy_j" pid && [ "$agy_v" = "$agy_opid" ]
}

# Notes "<host> <PID>" next to the discovery file (one server per app data
# dir) for hosts sharing this home (NFS), which can't see our processes.
agy_record_host() {
  [ -n "$agy_host" ] || return 0
  agy_nn=
  { IFS= read -r agy_nn <"$agy_disc.host"; } 2>/dev/null
  [ "$agy_nn" != "$agy_host $1" ] || return 0
  { printf '%s %s\n' "$agy_host" "$1" >"$agy_disc.host.$$" &&
    mv -f "$agy_disc.host.$$" "$agy_disc.host"; } 2>/dev/null
  return 0
}

# Another host's server is invisible here, and a second one would take over
# its discovery file. Its keeper's lease (agy_lease_state) says whether it
# still runs. $1: unlocked (look only), locked (take over a server whose
# lease is stale, or the one the Hub asked for), or strict (refuse any).
agy_check_other_host() {
  agy_foreign "$agy_disc" || return 0
  agy_lease_state
  if [ "$1" != strict ] && { [ "$agy_lstate" = stale ] || agy_take_over_asked; }; then
    [ "$1" = locked ] || return 0
    agy_take_over
    return 0
  fi
  agy_other_host_fail
}

agy_take_over_asked() {
  [ -n "$agy_to_pid" ] && [ "$agy_ohost" = "$agy_to_host" ] &&
    [ "$agy_opid" = "$agy_to_pid" ]
}

# Sets agy_lstate for the server agy_foreign found: live while its keeper
# renews DISC.lease, stale once that's agy_stale s old by this host's
# clock, unknown without one for that server (an older Hub started it).
agy_lease_state() {
  agy_lstate=unknown
  agy_lease=
  { IFS= read -r agy_lease <"$agy_disc.lease"; } 2>/dev/null
  case $agy_lease in "$agy_ohost $agy_opid "*) ;; *) return 0 ;; esac
  agy_lstate=live
  agy_age "$agy_disc.lease" || return 0
  [ "$agy_a" -lt "$agy_stale" ] || agy_lstate=stale
}

# Under the lock, takes the server's notes over from the other host, so
# ours starts: once its lease didn't change for agy_lease_sec + 5 s (clocks
# can differ between hosts), or, if the Hub asked, once its keeper stopped
# it (DISC.stop) or, with no keeper (unknown), at once: the user confirmed.
agy_take_over() {
  if [ "$agy_lstate" = stale ]; then
    agy_emit STATUS 'checking other host'
    agy_wait_lease_gone
  fi
  agy_emit STATUS 'taking over'
  if [ "$agy_lstate" = live ]; then
    # Noted first: a signal right after the write still withdraws it.
    agy_stopnote="$agy_ohost $agy_opid"
    { printf '%s %s\n' "$agy_ohost" "$agy_opid" >"$agy_disc.stop.$$" &&
      mv -f "$agy_disc.stop.$$" "$agy_disc.stop"; } 2>/dev/null ||
      agy_fail INSTALL_FAILED "cannot write $agy_disc.stop"
    agy_wait_lease_gone
    agy_stopnote=
  fi
  rm -f "$agy_disc.host" "$agy_disc.lease" "$agy_disc.stop" \
    "$agy_disc.keeper" 2>/dev/null
}

# Waits until no note names that server: its keeper removes them once the
# server's pid is gone, which can be well after the server deleted its
# discovery file (as it starts shutting down). Or until its lease doesn't
# change for agy_lease_sec + 5 s: no keeper renews it. A stale lease that is
# renewed makes it live: only the Hub's request (the user's) goes on then,
# to ask its keeper.
agy_wait_lease_gone() {
  agy_l0=$agy_lease
  agy_same=0
  agy_w=0
  while agy_notes_name_other; do
    agy_l=
    { IFS= read -r agy_l <"$agy_disc.lease"; } 2>/dev/null
    # A lease that vanished (its keeper cleaning up) isn't a renewal.
    if [ -z "$agy_l" ] || [ "$agy_l" = "$agy_l0" ]; then
      agy_same=$((agy_same + 1))
      [ "$agy_same" -le $((agy_lease_sec + 5)) ] || return 0
    elif [ "$agy_lstate" = stale ]; then
      agy_lstate=live
      agy_take_over_asked || agy_other_host_fail
      return 0
    else
      agy_same=0
      agy_l0=$agy_l
    fi
    if [ "$agy_w" -ge "$agy_to_wait" ]; then
      # Told it didn't stop, the user expects it to keep running.
      agy_withdraw_stop
      agy_safe "$agy_ohost"
      agy_fail SHARED_HOME_UNSUPPORTED "the Antigravity server on host $agy_s (pid $agy_opid) did not stop within $agy_to_wait s"
    fi
    sleep 1
    agy_w=$((agy_w + 1))
    [ $((agy_w % agy_hb)) -ne 0 ] || agy_beat
  done
}

# Whether .host or .lease still names the server agy_foreign found.
agy_notes_name_other() {
  agy_nn=
  { IFS= read -r agy_nn <"$agy_disc.host"; } 2>/dev/null
  [ "$agy_nn" != "$agy_ohost $agy_opid" ] || return 0
  agy_nn=
  { IFS= read -r agy_nn <"$agy_disc.lease"; } 2>/dev/null
  case $agy_nn in "$agy_ohost $agy_opid "*) return 0 ;; esac
  return 1
}

# Withdraws agy_take_over's request that the other host's keeper stop its
# server, if no one is waiting for it any more (a timeout, or the Hub left).
agy_withdraw_stop() {
  [ -n "$agy_stopnote" ] || return 0
  rm -f "$agy_disc.stop.$$" 2>/dev/null
  agy_nn=
  { IFS= read -r agy_nn <"$agy_disc.stop"; } 2>/dev/null
  [ "$agy_nn" != "$agy_stopnote" ] || rm -f "$agy_disc.stop" 2>/dev/null
  agy_stopnote=
}

# OTHER_HOST <live|unknown> <pid> <its host> <this host>, then the error.
agy_other_host_fail() {
  agy_safe "\${agy_host:--}"
  agy_me=$agy_s
  agy_safe "$agy_ohost"
  agy_record_age "$agy_disc.host"
  agy_emit OTHER_HOST "$agy_lstate $agy_opid $agy_s $agy_me"
  agy_fail SHARED_HOME_UNSUPPORTED "the Antigravity server for this home directory runs on host $agy_s (pid $agy_opid$agy_hage)"
}

# Sets agy_a to $1's age in seconds by this host's clock, if it can tell.
agy_age() {
  agy_hmt=$(stat -c %Y "$1" 2>/dev/null </dev/null) || return 1
  agy_hnow=$(date +%s 2>/dev/null </dev/null) || return 1
  case $agy_hmt in ''|*[!0-9]*) return 1 ;; esac
  case $agy_hnow in ''|*[!0-9]*) return 1 ;; esac
  agy_a=$((agy_hnow - agy_hmt))
}

# Sets agy_hage to ", recorded <age> ago" from $1's mtime, or to nothing.
agy_record_age() {
  agy_hage=
  agy_age "$1" || return 0
  if [ "$agy_a" -ge 172800 ]; then
    agy_hage=", recorded $((agy_a / 86400)) days ago"
  elif [ "$agy_a" -ge 7200 ]; then
    agy_hage=", recorded $((agy_a / 3600)) hours ago"
  elif [ "$agy_a" -ge 0 ]; then
    agy_hage=", recorded $((agy_a / 60)) minutes ago"
  fi
}

# Under the lock: attaches to a server that started meanwhile, or starts one.
# The server the Hub asked to replace is stopped once ours is installed, so a
# failed download leaves it running.
agy_attach_or_start() {
  agy_read_disc_settled
  if agy_is_ls_pid "$agy_dpid"; then
    if [ -z "$agy_rep_pid" ] || [ "$agy_dpid" != "$agy_rep_pid" ] ||
      [ "$agy_dver" != "$agy_rep_ver" ]; then
      agy_attached
      return 0
    fi
    # Never one that another host's note claims (its pid may be reused here).
    agy_check_other_host strict
    agy_prepare
    agy_emit STATUS replacing
    agy_stop "$agy_dpid" alone
  else
    # Again: another host may have started one while we waited for the lock.
    # Refuse now, but take nothing over before ours is installed: a failed
    # or slow install must leave the other host's server running.
    agy_check_other_host unlocked
    agy_prepare
    agy_check_other_host locked
  fi
  agy_start
}

# The binary to start: the server path, or ours, installed if needed.
agy_prepare() {
  if [ -n "$agy_serverpath" ]; then
    agy_check_server_path
  else
    mkdir -p "$agy_bindir" 2>/dev/null ||
      agy_fail INSTALL_FAILED "cannot create $agy_bindir"
    agy_install
  fi
}

agy_check_server_path() {
  [ -e "$agy_bin" ] ||
    agy_fail INSTALL_FAILED "$agy_bin does not exist"
  [ -f "$agy_bin" ] && agy_elf_ok "$agy_bin" ||
    agy_fail INSTALL_FAILED "$agy_bin is not a linux-$agy_arch executable"
  [ -x "$agy_bin" ] ||
    agy_fail INSTALL_FAILED "$agy_bin is not executable"
}

# Its log is ls-<its version>.log (its stdout), not ours after a Hub update.
agy_attached() {
  agy_emit STATUS attached
  agy_record_host "$agy_dpid"
  agy_keep_attached
  # Its page takes one-time UI tokens if its binary reads the token from the
  # environment (agy_token_via); older ones may mint tokens their page can't use.
  ! grep -q -F ANTIGRAVITY_SERVER_CSRF_TOKEN "/proc/$agy_dpid/exe" </dev/null >/dev/null 2>&1 ||
    agy_uiboot=1
  agy_l=$(readlink "/proc/$agy_dpid/fd/1" 2>/dev/null </dev/null) || agy_l=
  case $agy_l in
    "$agy_datadir/ls-"*.log)
      agy_l=\${agy_l#"$agy_datadir/ls-"}
      agy_l=\${agy_l%.log}
      ;;
    *) agy_l= ;;
  esac
  for agy_n in "$agy_l" "$agy_dver"; do
    case $agy_n in ''|*[!A-Za-z0-9._-]*) continue ;; esac
    agy_log=$agy_datadir/ls-$agy_n.log
    break
  done
  agy_mark_log
}

# Sets agy_sz (0 without a log).
agy_log_size() {
  agy_sz=$({ wc -c <"$agy_log"; } 2>/dev/null) || agy_sz=0
  agy_sz=\${agy_sz##* }
  case $agy_sz in ''|*[!0-9]*) agy_sz=0 ;; esac
}

# Streams from the log's current end: earlier sign-in URLs are stale.
agy_mark_log() {
  agy_log_size
  agy_tailfrom="-c +$((agy_sz + 1))"
}

# The new LS's last log line: masked before it's cut (no token prefix left).
agy_lastline() {
  agy_last=$(tail -c +$((agy_logoff + 1)) "$agy_log" 2>/dev/null </dev/null |
    LC_ALL=C tr -c '\040-\176\n' ' ' | grep -v '^ *$' | tail -n 1)
  agy_redact "\${agy_last:-(no output)}"
  agy_last=$(printf '%.300s' "$agy_r")
}

# Sets agy_envsh to commands exporting what the user's login shell, started
# as a terminal's (interactive login), adds to or changes in our environment;
# else to nothing. One line in the LS log says which. It takes at most about
# agy_env_timeout s, however slow or broken the rc files.
# TODO(nathanjuan): Leave this to the LS's own login shell reader (shellenv)
# once it reads the whole environment for its subprocesses. It's read here as
# the LS's environment is set when it starts.
agy_login_env() {
  agy_envsh=
  agy_why=
  agy_envdrop='${LOGIN_ENV_DROPPED}'
  agy_pw=$(getent passwd "$(id -u 2>/dev/null)" 2>/dev/null </dev/null) || agy_pw=
  for agy_lsh in "\${agy_pw##*:}" "\${SHELL:-}" /bin/sh; do
    case $agy_lsh in /*) [ -f "$agy_lsh" ] && [ -x "$agy_lsh" ] && break ;; esac
  done
  agy_lin=
  case \${agy_lsh##*/} in
    # Their -l works only alone, and makes no login shell with -c: they read
    # the command on stdin.
    ${LOGIN_SHELLS_ON_STDIN}) set -- -l; agy_lin=1 ;;
    *) set -- -l -i ;;
  esac
  agy_awk=$(command -v awk 2>/dev/null) || agy_awk=awk
  case $agy_awk in [!/]*|*[!A-Za-z0-9/._+-]*) agy_awk=awk ;; esac
  agy_em=agy-login-env-$$
  # One line without quotes, !, $ or backslashes: csh and fish pass it as is.
  agy_dump='function e(s,c,r,o,i){o="";while((i=index(s,c))>0){o=o substr(s,1,i-1) r;s=substr(s,i+1)}return o s}BEGIN{b=sprintf("%c",92);n=sprintf("%c",10);printf "%s%s{%s",n,m,n;for(k in ENVIRON)printf "%s=%s%s",k,e(e(ENVIRON[k],b,b b),n,b "n"),n;printf "%s}%s",m,n}'
  agy_cmd="exec $agy_awk -v m=$agy_em '$agy_dump'"
  agy_tmpf=$agy_datadir/.login-env.$$
  # Private (umask 077) before the shell gets the user's umask.
  : 2>/dev/null >"$agy_tmpf"
  (
    umask "$agy_umask0"
    # For rc files that skip slow or interactive work.
    export ${LOGIN_ENV_GIVEN}
    # No terminal, and its own session (setsid), which a timeout ends with
    # what the rc files started.
    if [ -n "$agy_lin" ]; then
      exec \${agy_ss:+"$agy_ss"} "$agy_lsh" "$@" 2>/dev/null >"$agy_tmpf" <<AGY_EOF
$agy_cmd
AGY_EOF
    fi
    exec \${agy_ss:+"$agy_ss"} "$agy_lsh" "$@" -c "$agy_cmd" \
      2>/dev/null </dev/null >"$agy_tmpf"
  ) &
  agy_bgpid=$!
  [ -z "$agy_ss" ] || agy_envpg=$agy_bgpid
  # Short naps first: most shells answer in well under a second.
  for agy_q in 1 2 3 4; do
    kill -0 "$agy_bgpid" 2>/dev/null && sleep 0.05 2>/dev/null || break
  done
  agy_i=0
  while kill -0 "$agy_bgpid" 2>/dev/null; do
    if [ "$agy_i" -ge $((agy_env_timeout * agy_naps)) ]; then
      agy_why="no answer within $agy_env_timeout s"
      agy_end_login
      break
    fi
    agy_nap
    agy_i=$((agy_i + 1))
    [ $((agy_i % (agy_hb * agy_naps))) -ne 0 ] || agy_beat
  done
  if [ -z "$agy_why" ]; then
    # Not after a timeout: a process stuck in the kernel can't be waited for.
    wait "$agy_bgpid"
    agy_rc=$?
    if [ "$agy_rc" -ne 0 ]; then
      agy_why="exit code $agy_rc"
    else
      agy_envsh=$(agy_parse_env "$agy_tmpf") ||
        { agy_envsh=; agy_why='no environment in its output'; }
    fi
  fi
  agy_bgpid=
  agy_envpg=
  rm -f "$agy_tmpf" 2>/dev/null
  agy_tmpf=
  if [ -n "$agy_envsh" ]; then
    printf 'antigravity: starting the language server with the environment of %s %s (new or changed variables: %s)\n' \
      "$agy_lsh" "$*" "\${agy_envsh##*# }"
  else
    printf "antigravity: starting the language server with the SSH session's environment: %s %s gave none (%s)\n" \
      "$agy_lsh" "$*" "$agy_why"
  fi 2>/dev/null >>"$agy_log"
}

# Ends the login shell's session as a closed terminal would (SIGHUP), then
# for good; pkill -s also gets tcsh's background jobs, each in a group of its
# own.
agy_end_login() {
  if [ -n "$agy_envpg" ]; then
    kill -HUP "-$agy_envpg" 2>/dev/null
    sleep 1
    kill -KILL "-$agy_envpg" 2>/dev/null
    pkill -KILL -s "$agy_envpg" 2>/dev/null
  fi
  kill -KILL "$agy_bgpid" 2>/dev/null
}

# Prints commands exporting the variables of agy_dump's output in $1 that are
# new or changed, then "# <how many>"; fails without its closing marker.
agy_parse_env() {
  AGY_M=$agy_em AGY_SKIP="$agy_envdrop ${LOGIN_ENV_GIVEN_NAMES} SSH_AUTH_SOCK SSH_AGENT_PID DISPLAY XAUTHORITY ANTIGRAVITY_VSCODE_HOST HOME IFS" "$agy_awk" '
    function dec(s,    o, i, c) {
      o = ""
      while ((i = index(s, b)) > 0) {
        c = substr(s, i + 1, 1)
        o = o substr(s, 1, i - 1) (c == "n" ? n : c)
        s = substr(s, i + 2)
      }
      return o s
    }
    function shq(s,    o, i) {
      o = ""
      while ((i = index(s, q)) > 0) {
        o = o substr(s, 1, i - 1) q b q q
        s = substr(s, i + 1)
      }
      return q o s q
    }
    BEGIN {
      b = sprintf("%c", 92); n = sprintf("%c", 10); q = sprintf("%c", 39)
      m = ENVIRON["AGY_M"]
      split(ENVIRON["AGY_SKIP"], a, " ")
      for (i in a) skip[a[i]] = 1
    }
    !on { on = ($0 == m "{"); next }
    $0 == m "}" { done = 1; exit }
    {
      i = index($0, "=")
      k = substr($0, 1, i - 1)
      v = dec(substr($0, i + 1))
      # HOME places the discovery file; IFS and agy_* belong to this script.
      if (k !~ /^[A-Za-z_][A-Za-z0-9_]*$/ || k ~ /^agy_/ || k in skip) next
      # Unchanged, or one awk adds to ENVIRON (gawk: AWKPATH).
      if ((k in ENVIRON) && ENVIRON[k] == v) next
      printf "command export %s=%s 2>/dev/null%s", k, shq(v), n
      count++
    }
    END {
      if (!done) exit 1
      printf "# %d%s", count, n
    }' "$1"
}

agy_start() {
  agy_log_size
  if [ "$agy_sz" -gt "$agy_rotate_bytes" ]; then
    mv -f "$agy_log" "$agy_log.1" 2>/dev/null
  fi
  # Created under umask 077 before the LS appends to it.
  true 2>/dev/null >>"$agy_log" ||
    agy_fail LS_START_FAILED "cannot write $agy_log"
  agy_detacher
  agy_emit STATUS starting
  agy_login_env
  agy_token_via
  agy_spawn_ls
  agy_i=0
  agy_max=$((agy_start_timeout * agy_naps))
  # Only accept the server started here, with our token.
  until agy_started; do
    if ! kill -0 "$agy_lspid" 2>/dev/null; then
      wait "$agy_lspid"
      agy_rc=$?
      if [ -n "$agy_envsh" ]; then
        # Its environment may be why (e.g. a malformed GOMEMLIMIT, which any Go
        # program dies of): once more with the session's, or it would fail
        # every time.
        printf "antigravity: the language server exited during startup (exit code %s) with the login shell's environment; starting it with the SSH session's\n" \
          "$agy_rc" 2>/dev/null >>"$agy_log"
        agy_envsh=
        agy_spawn_ls
        continue
      fi
      agy_lastline
      if [ "$agy_rc" -eq 126 ] || [ "$agy_rc" -eq 127 ]; then
        # Not runnable: reinstall next time, unless the binary is fine (the
        # host lacks a library) or is the user's server path.
        [ -n "$agy_serverpath" ] || agy_bin_ok || rm -f "$agy_bin" 2>/dev/null
        agy_fail LS_START_FAILED "the language server could not be run (exit code $agy_rc): $agy_last"
      fi
      agy_fail LS_START_FAILED "the language server exited during startup (exit code $agy_rc): $agy_last"
    fi
    agy_i=$((agy_i + 1))
    if [ "$agy_i" -gt "$agy_max" ]; then
      agy_stop "$agy_lspid"
      agy_lastline
      agy_fail LS_START_FAILED "the language server did not start within $agy_start_timeout s: $agy_last"
    fi
    [ $((agy_i % (agy_hb * agy_naps))) -ne 0 ] || agy_beat
    agy_nap
  done
  agy_record_host "$agy_lspid"
  [ "$agy_tokvia" != env ] || agy_uiboot=1
  # Stream all it logged, so an early sign-in URL isn't missed.
  agy_tailfrom="-c +$((agy_logoff + 1))"
}

# Sets agy_tokvia to how agy_exec_ls passes our token: env if the binary
# reads it from there (it names the variable; such servers also mint the
# UI's one-time tokens), else argv (older releases, which ignore it: they
# would run without one), or none without a token.
agy_token_via() {
  agy_tokvia=none
  [ -n "$agy_tok" ] || return 0
  agy_tokvia=argv
  if grep -q -F ANTIGRAVITY_SERVER_CSRF_TOKEN "$agy_bin" </dev/null >/dev/null 2>&1; then
    agy_tokvia=env
  else
    printf "antigravity: this language server can't take its token from its environment, so it gets it as --csrf_token, which other users of this host can see\n" \
      2>/dev/null >>"$agy_log"
  fi
}

# The server started here wrote its discovery file, with our token. One that
# has none or another (it didn't read the environment) is stopped and, if it
# had the token there, started again with --csrf_token.
agy_started() {
  agy_read_disc && [ "$agy_dpid" = "$agy_lspid" ] && agy_is_ls_pid "$agy_dpid" ||
    return 1
  [ "$agy_dtok" != "$agy_tok" ] || return 0
  agy_stop "$agy_lspid"
  wait "$agy_lspid" 2>/dev/null
  [ "$agy_tokvia" = env ] ||
    agy_fail LS_START_FAILED 'the language server did not take its token'
  printf 'antigravity: the language server did not take its token from its environment; starting it with --csrf_token\n' \
    2>/dev/null >>"$agy_log"
  agy_tokvia=argv
  agy_spawn_ls
  return 1
}

# Sets agy_ss (setsid) or agy_nh (nohup), what detaches the server and its
# keeper from the session.
agy_detacher() {
  # By path: the LS's PATH may be the login shell's.
  agy_ss=$(command -v setsid 2>/dev/null) || agy_ss=
  agy_nh=
  if [ -z "$agy_ss" ]; then
    # Fallback only: everything the LS starts inherits the ignored SIGHUP.
    agy_nh=$(command -v nohup 2>/dev/null) || agy_nh=
  fi
}

# The server we attach to runs here (agy_is_ls_pid): it gets a keeper, which
# exits at once if another one of it runs (else an older Hub started it, or
# its keeper was killed). Hosts sharing the home then see it live, and can
# ask it to stop.
agy_keep_attached() {
  agy_detacher
  agy_spawn_keeper "$agy_dpid"
}

# Sets agy_disc_re to the discovery file's path as an extended regular
# expression (pgrep's patterns), once.
agy_disc_ere() {
  [ -z "$agy_disc_re" ] || return 0
  agy_disc_re=$(printf '%s\n' "$agy_disc" | sed 's/[][\\.*^$+?(){}|]/\\&/g')
}

# For an attach-only connect: waits while another connect holds the install
# lock, up to agy_start_timeout s, or until a holder on this host is gone.
agy_await_unlocked() {
  agy_ld=$agy_root/install.lock.d
  agy_w=0
  while [ -d "$agy_ld" ] && [ "$agy_w" -lt "$agy_start_timeout" ]; do
    agy_lo=
    { IFS= read -r agy_lo <"$agy_ld/pid"; } 2>/dev/null
    ! agy_holder_gone "$agy_lo" || return 0
    [ "$agy_w" -gt 0 ] || agy_emit STATUS waiting
    sleep 1
    agy_w=$((agy_w + 1))
    [ $((agy_w % agy_hb)) -ne 0 ] || agy_beat
  done
}

# Starts the server's keeper (KEEPER), detached like the server.
agy_spawn_keeper() {
  [ -n "$agy_host" ] || return 0
  agy_disc_ere
  # Its script in the environment: its arguments lead its command line.
  AGY_KEEPER=$agy_keeper_sh \${agy_ss:+"$agy_ss"} \${agy_nh:+"$agy_nh"} \
    /bin/sh -c 'eval "$AGY_KEEPER"' agy-keeper "$agy_disc" "$agy_host" "$1" \
    "$agy_lease_sec" "$agy_ktick" "$((agy_start_timeout + agy_start_timeout / 4))" \
    "$agy_disc_re" \
    </dev/null >/dev/null 2>&1 &
}

# Starts the LS in the background (agy_lspid), with agy_envsh's environment
# if set; its output starts at agy_logoff in its log.
agy_spawn_ls() {
  agy_log_size
  agy_logoff=$agy_sz
  (
    cd "$HOME" 2>/dev/null || cd / 2>/dev/null
    umask "$agy_umask0"
    if [ -n "$agy_envsh" ]; then
      eval "$agy_envsh"
      command unset $agy_envdrop 2>/dev/null
    fi
    # Outlives the session: no agent/X11 forwarding; the LS uses SSH_CONNECTION.
    unset SSH_AUTH_SOCK DISPLAY XAUTHORITY
    ANTIGRAVITY_VSCODE_HOST=1
    export ANTIGRAVITY_VSCODE_HOST
    agy_exec_ls
  ) &
  agy_lspid=$!
  # Now, not once it's up: a drop during the start must not leave a server
  # that other hosts sharing the home can't see.
  mkdir -p "\${agy_disc%/*}" 2>/dev/null
  agy_record_host "$agy_lspid"
  agy_spawn_keeper "$agy_lspid"
}

# Relays sign-in URLs. Each tick checks tail and the server (kill -0; at
# keep-alive time its command line too, for a reused pid); keep-alives go to
# fd 3. Then it returns 0 if the server is gone, else 2.
agy_stream() {
  # Untrapped: a trapped signal would wait until the pipeline ends.
  trap - HUP INT PIPE TERM
  exec 3>&1
  [ "$agy_hb" -ge "$agy_tick" ] || agy_tick=$agy_hb
  {
    tail $agy_tailfrom -F "$agy_log" 2>/dev/null </dev/null 3>&- &
    agy_tp=$!
    # A failed keep-alive must not kill this subshell before it stops tail.
    trap '' PIPE
    agy_t=0
    while sleep "$agy_tick" 3>&-; do
      kill -0 "$agy_tp" 2>/dev/null || break
      agy_t=$((agy_t + agy_tick))
      if [ "$agy_t" -lt "$agy_hb" ]; then
        kill -0 "$agy_dpid" 2>/dev/null || break
      else
        agy_t=0
        agy_is_ls_pid "$agy_dpid" || break
        printf '\n' >&3 2>/dev/null || break
      fi
    done
    kill "$agy_tp" 2>/dev/null
  } | agy_filter_log 3>&-
  agy_is_ls_pid "$agy_dpid"
  [ $? = 1 ] || return 2
}

# Only lines that are exactly "ANTIGRAVITY_OPEN_URL: <url>", tokens masked.
agy_filter_log() {
  # mawk buffers a pipe: the lone sign-in URL would wait for more output.
  case $(awk -W version 2>&1 </dev/null) in
    mawk*) agy_ai='-W interactive' ;;
    *) agy_ai= ;;
  esac
  AGY_M=$agy_marker AGY_T1=$agy_tok AGY_T2=$agy_dtok awk $agy_ai '
    function redact(s, t,    out, i) {
      if (t == "") return s
      out = ""
      while ((i = index(s, t)) > 0) {
        out = out substr(s, 1, i - 1) "<redacted>"
        s = substr(s, i + length(t))
      }
      return out s
    }
    {
      sub(/\r$/, "")
      if ($0 !~ /^ANTIGRAVITY_OPEN_URL: [^ \t]+$/) next
      url = substr($0, length("ANTIGRAVITY_OPEN_URL: ") + 1)
      printf "%s OPEN_URL %s\n", ENVIRON["AGY_M"], redact(redact(url, ENVIRON["AGY_T1"]), ENVIRON["AGY_T2"])
      fflush()
    }'
}

agy_main; exit $?
`;
