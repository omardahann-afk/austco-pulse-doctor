/**
 * Evidence-only safe command runner.
 *
 * Rules:
 *   - Frontend NEVER passes commands. Only this file can build them.
 *   - All commands are read-only. Hard-blocked patterns enforced as defense in depth.
 *   - Two execution modes: local (on the diagnostic VM via child_process) and
 *     remote (on a target VM via the existing SSH client).
 *
 * Local exec is restricted to a small whitelist of binaries: ping, getent,
 * ip, ss, host, dig, arp, hostname, uptime, df, free.
 */
import { spawn } from "node:child_process";
import { Client } from "ssh2";

const LOCAL_TIMEOUT_DEFAULT = 8_000;
const SSH_TIMEOUT_DEFAULT = 10_000;
const SSH_READY_TIMEOUT = 8_000;
const MAX_OUT = 64 * 1024;

const LOCAL_ALLOWED_BINS = new Set([
  "ping", "getent", "ip", "ss", "host", "dig", "arp",
  "hostname", "uptime", "df", "free",
]);

/* Same defense-in-depth blocklist used by the Autopilot SSH executor. */
const BLOCKED_PATTERNS = [
  /\brm\b/, /\bmv\b/, /\bcp\b\s+.*\/etc\//, /\bchmod\b/, /\bchown\b/,
  /\bsed\b/, /\bnano\b/, /\bvim?\b/,
  /\breboot\b/, /\bshutdown\b/, /\bhalt\b/, /\bpoweroff\b/,
  /\bdd\b/, /\bmkfs\b/, /\b>\s*\/etc\//, /\bcurl\b/, /\bwget\b/,
  /[`$]\(/, /\|\s*sh\b/, /\|\s*bash\b/,
];

function assertSafe(cmd) {
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(cmd)) {
      const e = new Error(`security_violation: blocked pattern ${re}`);
      e.code = "security_violation";
      throw e;
    }
  }
}

/* ===== Host validation ===== */

const HOST_RE = /^[A-Za-z0-9._:-]{1,253}$/;
export function safeHost(host) {
  if (typeof host !== "string" || !HOST_RE.test(host)) {
    const e = new Error(`security_violation: invalid host '${host}'`);
    e.code = "security_violation";
    throw e;
  }
  return host;
}

export function safePort(port) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    const e = new Error(`security_violation: invalid port`);
    e.code = "security_violation";
    throw e;
  }
  return p;
}

/* ===== Local exec via spawn (no shell) ===== */

/**
 * Execute a local command using spawn (no shell). bin must be in
 * LOCAL_ALLOWED_BINS. args is an array of strings; each is validated against a
 * permissive but strict character class.
 */
export function localExec(bin, args = [], timeoutMs = LOCAL_TIMEOUT_DEFAULT) {
  return new Promise((resolve) => {
    if (!LOCAL_ALLOWED_BINS.has(bin)) {
      return resolve({ ok: false, stage: "blocked", error: `bin '${bin}' not allowed`, exitCode: null, stdout: "", stderr: "", durationMs: 0 });
    }
    for (const a of args) {
      if (typeof a !== "string" || a.length > 256 || /[;&|`$<>\n\r]/.test(a)) {
        return resolve({ ok: false, stage: "blocked", error: `unsafe argument`, exitCode: null, stdout: "", stderr: "", durationMs: 0 });
      }
    }
    const start = Date.now();
    let stdout = "", stderr = "", done = false;
    let child;
    try { child = spawn(bin, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (err) {
      return resolve({ ok: false, stage: "spawn_error", error: err?.message || String(err), exitCode: null, stdout: "", stderr: "", durationMs: Date.now() - start });
    }
    const finish = (r) => { if (done) return; done = true; try { child.kill("SIGTERM"); } catch {} resolve({ durationMs: Date.now() - start, command: `${bin} ${args.join(" ")}`.trim(), ...r }); };
    const t = setTimeout(() => finish({ ok: false, stage: "timeout", error: `timed out after ${timeoutMs}ms`, exitCode: null, stdout, stderr }), timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); if (stdout.length > MAX_OUT) stdout = stdout.slice(-MAX_OUT); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > MAX_OUT) stderr = stderr.slice(-MAX_OUT); });
    child.on("error", (err) => { clearTimeout(t); finish({ ok: false, stage: "exec_error", error: err?.message || String(err), exitCode: null, stdout, stderr }); });
    child.on("close", (code) => { clearTimeout(t); finish({ ok: code === 0, exitCode: code, stdout, stderr }); });
  });
}

/**
 * TCP connect probe — pure node net, no shell. Resolves with { open, latencyMs, error }.
 */
import net from "node:net";
export function tcpProbe(host, port, timeoutMs = 4_000) {
  return new Promise((resolve) => {
    let h, p;
    try { h = safeHost(host); p = safePort(port); }
    catch (err) { return resolve({ open: false, latencyMs: null, error: err.message }); }
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve({ ...r, latencyMs: Date.now() - start }); };
    const t = setTimeout(() => finish({ open: false, error: "timeout" }), timeoutMs);
    sock.once("connect", () => { clearTimeout(t); finish({ open: true, error: null }); });
    sock.once("error", (err) => { clearTimeout(t); finish({ open: false, error: err?.message || String(err) }); });
    try { sock.connect(p, h); }
    catch (err) { clearTimeout(t); finish({ open: false, error: err?.message || String(err) }); }
  });
}

/* ===== Remote exec over SSH (read-only, allowlisted command strings) ===== */

/**
 * Execute a pre-built read-only command on a remote host. Caller MUST build the
 * command from a fixed template — this function only enforces hard-block.
 */
export function remoteExec({ host, port = 22, username, password }, command, timeoutMs = SSH_TIMEOUT_DEFAULT) {
  assertSafe(command);
  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const start = Date.now();
    const finish = (r) => {
      if (done) return; done = true;
      try { conn.end(); } catch {}
      resolve({ durationMs: Date.now() - start, command, ...r });
    };
    const t = setTimeout(() => finish({ ok: false, stage: "timeout", error: `command timed out after ${timeoutMs}ms`, exitCode: null, stdout: "", stderr: "" }), timeoutMs + 1_000);
    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) { clearTimeout(t); return finish({ ok: false, stage: "exec_failed", error: err.message, exitCode: null, stdout: "", stderr: "" }); }
        let stdout = "", stderr = "";
        stream.on("close", (code) => { clearTimeout(t); finish({ ok: code === 0, exitCode: code, stdout, stderr }); });
        stream.on("data", (d) => { stdout += d.toString("utf8"); if (stdout.length > MAX_OUT) stdout = stdout.slice(-MAX_OUT); });
        stream.stderr.on("data", (d) => { stderr += d.toString("utf8"); if (stderr.length > MAX_OUT) stderr = stderr.slice(-MAX_OUT); });
      });
    });
    conn.on("error", (err) => { clearTimeout(t); finish({ ok: false, stage: "ssh_error", error: err?.message || String(err), exitCode: null, stdout: "", stderr: "" }); });
    conn.on("keyboard-interactive", (_n, _i, _l, prompts, cb) => cb(prompts.map(() => password || "")));
    try {
      conn.connect({ host, port: Number(port) || 22, username, password, readyTimeout: SSH_READY_TIMEOUT, tryKeyboard: true });
    } catch (err) {
      clearTimeout(t); finish({ ok: false, stage: "connect_error", error: err?.message || String(err), exitCode: null, stdout: "", stderr: "" });
    }
  });
}

/* ===== Local network info ===== */

import os from "node:os";
export function localIfaces() {
  const out = [];
  const nics = os.networkInterfaces();
  for (const [name, list] of Object.entries(nics)) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) out.push({ iface: name, addr: a.address, netmask: a.netmask, mac: a.mac });
    }
  }
  return out;
}