/**
 * SSH/SFTP helpers for pulling Austco service logs from remote VMs.
 * Uses ssh2 (raw client) for connection/auth tests and ssh2-sftp-client
 * for file pulls. No fake fallbacks — failures surface to the UI verbatim.
 */
import { Client } from "ssh2";
import SftpClient from "ssh2-sftp-client";

const DEFAULT_TIMEOUT = 8000;
const MAX_LOG_BYTES = 512 * 1024; // 512KB tail per file

function authOpts({ host, port = 22, username, password }) {
  return {
    host,
    port: Number(port) || 22,
    username,
    password,
    readyTimeout: DEFAULT_TIMEOUT,
    tryKeyboard: true,
  };
}

/** Test SSH auth on port 22. Resolves with structured result, never throws. */
export function testSshAuth(opts) {
  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { conn.end(); } catch {} resolve(r); } };
    const t = setTimeout(() => finish({ ok: false, stage: "timeout", error: `SSH auth timed out after ${DEFAULT_TIMEOUT}ms` }), DEFAULT_TIMEOUT + 1000);
    conn.on("ready", () => { clearTimeout(t); finish({ ok: true }); });
    conn.on("error", (err) => {
      clearTimeout(t);
      const msg = err?.message || String(err);
      let stage = "error";
      if (/All configured authentication methods failed/i.test(msg)) stage = "auth_failed";
      else if (/ECONNREFUSED/.test(msg)) stage = "connection_refused";
      else if (/ETIMEDOUT|timed out/i.test(msg)) stage = "timeout";
      else if (/EHOSTUNREACH|ENETUNREACH/.test(msg)) stage = "unreachable";
      else if (/ENOTFOUND/.test(msg)) stage = "dns_failed";
      finish({ ok: false, stage, error: msg });
    });
    conn.on("keyboard-interactive", (_n, _i, _l, prompts, cb) => cb(prompts.map(() => opts.password || "")));
    try { conn.connect(authOpts(opts)); }
    catch (err) { clearTimeout(t); finish({ ok: false, stage: "error", error: err?.message || String(err) }); }
  });
}

/**
 * Pull a list of log paths from a host via SFTP. Each result includes
 * file path, size, content (tail up to MAX_LOG_BYTES), and any error.
 */
export async function pullLogs(opts, paths) {
  const sftp = new SftpClient();
  const results = [];
  let connected = false;
  try {
    await sftp.connect({ ...authOpts(opts), tryKeyboard: true });
    connected = true;
    for (const p of paths) {
      const path = String(p || "").trim();
      if (!path) continue;
      try {
        const stat = await sftp.stat(path);
        const size = Number(stat.size) || 0;
        // Tail: read last MAX_LOG_BYTES bytes for big files.
        let buf;
        if (size > MAX_LOG_BYTES) {
          buf = await sftp.get(path, undefined, { readStreamOptions: { start: size - MAX_LOG_BYTES, end: size - 1 } });
        } else {
          buf = await sftp.get(path);
        }
        const content = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
        results.push({ path, ok: true, sizeBytes: size, truncated: size > MAX_LOG_BYTES, content });
      } catch (err) {
        const msg = err?.message || String(err);
        let reason = "error";
        if (/No such file/i.test(msg) || err?.code === 2) reason = "not_found";
        else if (/Permission denied/i.test(msg) || err?.code === 3) reason = "permission_denied";
        results.push({ path, ok: false, reason, error: msg });
      }
    }
  } catch (err) {
    return { ok: false, connected, stage: connected ? "sftp_error" : "connect_failed", error: err?.message || String(err), files: results };
  } finally {
    try { await sftp.end(); } catch {}
  }
  return { ok: true, connected, files: results };
}
