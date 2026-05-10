/**
 * SSH Executor — strict template-only command runner.
 *
 * Architecture rules (enforced):
 *   1. NO free-form commands accepted from the frontend.
 *   2. Frontend sends only { planId, actionId }.
 *   3. Commands are produced ONLY from this file's templates.
 *   4. Site config may extend allowlists with named systemd services and
 *      docker container names. It may NOT define raw shell commands.
 *   5. Anything not in FINAL_ALLOWLIST is BLOCKED.
 */
import { Client } from "ssh2";

const DEFAULT_TIMEOUT = 8000;

/* ===== Allowlists ===== */

export const ALLOWLIST_CORE = {
  systemd: [
    "ipconnect", "pulse-gateway", "inga", "integration-gateway",
    "webmin", "miniserv", "mosquitto", "hl7", "license-service",
    "pulse-manage", "rtls-gateway", "mobile-gateway", "file-server",
  ],
  docker: [
    "pulse-gateway", "mqtt-broker", "websocket-adapter", "inga",
    "integration-gateway", "license-service",
  ],
};

/** Service-name token rule: lowercase letters, digits, dot, underscore, dash. */
const SAFE_NAME = /^[a-z0-9._-]{1,64}$/;

/** Build the merged allowlist from site config overrides (still names only). */
export function buildAllowlist(siteOverrides = {}) {
  const safeList = (arr) => Array.from(new Set([
    ...((Array.isArray(arr) ? arr : []).filter((n) => typeof n === "string" && SAFE_NAME.test(n))),
  ]));
  return {
    systemd: safeList([...ALLOWLIST_CORE.systemd, ...(siteOverrides.systemd || [])]),
    docker:  safeList([...ALLOWLIST_CORE.docker,  ...(siteOverrides.docker  || [])]),
  };
}

/* ===== Read templates (low-risk) ===== */

const READ_TEMPLATES = {
  hostname:        () => "hostname",
  uptime:          () => "uptime",
  df:              () => "df -h",
  free:            () => "free -m",
  docker_ps:       () => "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Image}}'",
  ss_ports:        () => "ss -tulpn",
  systemctl_status: ({ unit }) => `systemctl status ${unit} --no-pager -n 30`,
  systemctl_is_active: ({ unit }) => `systemctl is-active ${unit}`,
  docker_logs:     ({ container }) => `docker logs --tail 100 ${container}`,
  journalctl:      ({ unit }) => `journalctl -u ${unit} --no-pager -n 100`,
  test_port:       ({ port }) => `bash -lc 'exec 3<>/dev/tcp/127.0.0.1/${port} && echo open && exec 3<&- || echo closed'`,
};

/* ===== Write templates (medium-risk) ===== */

const WRITE_TEMPLATES = {
  systemctl_restart: ({ unit }) => `sudo -n systemctl restart ${unit}`,
  docker_restart:    ({ container }) => `docker restart ${container}`,
};

/** All template ids exposed to the engine. */
export const TEMPLATE_IDS = {
  read:  Object.keys(READ_TEMPLATES),
  write: Object.keys(WRITE_TEMPLATES),
};

/**
 * Resolve a template id + params into a final shell command string,
 * or throw a security_violation error if disallowed.
 */
export function resolveCommand(templateId, params = {}, allowlist = ALLOWLIST_CORE) {
  if (READ_TEMPLATES[templateId]) {
    return { kind: "read", risk: "LOW", requiresSudo: false, command: validateAndRender(templateId, READ_TEMPLATES[templateId], params, allowlist) };
  }
  if (WRITE_TEMPLATES[templateId]) {
    const requiresSudo = templateId === "systemctl_restart";
    return { kind: "write", risk: "MEDIUM", requiresSudo, command: validateAndRender(templateId, WRITE_TEMPLATES[templateId], params, allowlist) };
  }
  const err = new Error(`security_violation: unknown template '${templateId}'`);
  err.code = "security_violation";
  throw err;
}

function validateAndRender(templateId, fn, params, allowlist) {
  // Validate every param value is in the appropriate allowlist.
  if (params.unit !== undefined) requireAllowed(params.unit, allowlist.systemd, "systemd unit");
  if (params.container !== undefined) requireAllowed(params.container, allowlist.docker, "docker container");
  if (params.port !== undefined) {
    const p = Number(params.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw security("invalid port");
  }
  // No other free-form fields are permitted.
  for (const k of Object.keys(params)) {
    if (!["unit", "container", "port"].includes(k)) throw security(`unsupported param '${k}'`);
  }
  return fn(params);
}

function requireAllowed(value, list, kind) {
  if (typeof value !== "string" || !SAFE_NAME.test(value)) throw security(`invalid ${kind} name`);
  if (!list.includes(value)) throw security(`${kind} '${value}' not in allowlist`);
}

function security(msg) {
  const err = new Error(`security_violation: ${msg}`);
  err.code = "security_violation";
  return err;
}

/* ===== Hard-block patterns (defense in depth) ===== */

const BLOCKED_PATTERNS = [
  /\brm\b/, /\bmv\b/, /\bcp\b\s+.*\/etc\//, /\bchmod\b/, /\bchown\b/, /\bsed\b/, /\bnano\b/, /\bvim?\b/,
  /\breboot\b/, /\bshutdown\b/, /\bhalt\b/, /\bpoweroff\b/,
  /\bdd\b/, /\bmkfs\b/, /\b>\s*\/etc\//, /\bcurl\b/, /\bwget\b/,
];

function assertSafeShell(cmd) {
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(cmd)) throw security(`command matched blocked pattern ${re}`);
  }
}

/* ===== Execution ===== */

/**
 * Execute a single rendered command over SSH. Returns { ok, exitCode, stdout, stderr, durationMs }.
 * Never accepts a free-form command from the caller — only templates resolved above.
 */
export function execOverSsh({ host, port = 22, username, password }, command, timeoutMs = 15000) {
  assertSafeShell(command);
  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const start = Date.now();
    const finish = (r) => {
      if (done) return;
      done = true;
      try { conn.end(); } catch {}
      resolve({ durationMs: Date.now() - start, ...r });
    };
    const t = setTimeout(() => finish({ ok: false, stage: "timeout", error: `command timed out after ${timeoutMs}ms`, exitCode: null, stdout: "", stderr: "" }), timeoutMs + 1000);
    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(t); return finish({ ok: false, stage: "exec_failed", error: err.message, exitCode: null, stdout: "", stderr: "" }); }
        let stdout = "", stderr = "", exitCode = null;
        stream.on("close", (code) => { clearTimeout(t); finish({ ok: code === 0, exitCode: code, stdout, stderr }); });
        stream.on("data", (d) => { stdout += d.toString("utf8"); if (stdout.length > 64 * 1024) stdout = stdout.slice(-64 * 1024); });
        stream.stderr.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024); });
      });
    });
    conn.on("error", (err) => { clearTimeout(t); finish({ ok: false, stage: "ssh_error", error: err?.message || String(err), exitCode: null, stdout: "", stderr: "" }); });
    conn.on("keyboard-interactive", (_n, _i, _l, prompts, cb) => cb(prompts.map(() => password || "")));
    try {
      conn.connect({
        host, port: Number(port) || 22, username, password,
        readyTimeout: DEFAULT_TIMEOUT, tryKeyboard: true,
      });
    } catch (err) {
      clearTimeout(t); finish({ ok: false, stage: "connect_error", error: err?.message || String(err), exitCode: null, stdout: "", stderr: "" });
    }
  });
}