/**
 * Safe read-only log reader for monitored devices.
 *
 * Hard rules:
 *   - Only reads paths from the device's saved `meta.logPaths` allowlist.
 *   - No arbitrary command execution from clients.
 *   - Hard line cap (500) and byte cap.
 *   - Strips obvious secret-looking lines from output.
 *   - SSH password never persisted (stripped by healthDb); supplied per-request.
 */
import SftpClient from "ssh2-sftp-client";
import { getDevice } from "./healthDb.js";

const MAX_LINES = 500;
const MAX_BYTES = 1024 * 1024; // 1MB tail
const CONNECT_TIMEOUT = 8000;

const SECRET_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /passwd\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
];

function sanitizeLine(line) {
  let out = String(line);
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => m.split(/[:=]/)[0] + "=***");
  return out;
}

function getAllowedPaths(device) {
  const meta = device?.meta || {};
  const paths = Array.isArray(meta.logPaths) ? meta.logPaths : [];
  return paths.map((p) => String(p).trim()).filter(Boolean);
}

function isPathAllowed(allowed, requested) {
  if (!requested) return false;
  for (const a of allowed) {
    if (a === requested) return true;
    // directory allowlist: requested must start with a + "/" and not contain ".."
    const dir = a.endsWith("/") ? a : a + "/";
    if (requested.startsWith(dir) && !requested.includes("..")) return true;
  }
  return false;
}

/** Recent lines from a single log path on a device. */
export async function readRecentLogs({ deviceId, path: rawPath, lines, sshPassword }) {
  const device = getDevice(deviceId);
  if (!device) return { ok: false, reason: "device_not_found" };

  const meta = device.meta || {};
  const ssh = meta.ssh || {};
  const host = device.host;
  if (!host) return { ok: false, reason: "no_host" };

  const allowed = getAllowedPaths(device);
  if (allowed.length === 0) return { ok: false, reason: "no_log_paths_configured" };

  // Default to first allowed path if caller didn't specify
  const requested = rawPath ? String(rawPath).trim() : allowed[0];
  if (!isPathAllowed(allowed, requested)) {
    return { ok: false, reason: "path_not_allowed", allowed };
  }

  const username = ssh.username;
  const password = sshPassword || ssh.password || "";
  const port = Number(ssh.port) || 22;
  if (!username) return { ok: false, reason: "no_ssh_username" };
  if (!password) return { ok: false, reason: "ssh_password_required" };

  const lineCap = Math.min(MAX_LINES, Math.max(1, Number(lines) || 100));
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host, port, username, password, readyTimeout: CONNECT_TIMEOUT, tryKeyboard: true });

    let stat;
    try { stat = await sftp.stat(requested); }
    catch (err) {
      const msg = err?.message || String(err);
      const reason = /No such file/i.test(msg) ? "not_found"
        : /Permission denied/i.test(msg) ? "permission_denied"
        : "stat_error";
      return { ok: false, reason, error: msg };
    }

    if (stat.isDirectory) {
      // pick newest .log file
      const entries = await sftp.list(requested.replace(/\/+$/, "") || "/");
      const files = entries
        .filter((e) => e.type === "-" && /\.log(\.\d+)?$|log$/i.test(e.name))
        .sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0));
      if (files.length === 0) return { ok: false, reason: "no_log_files_in_directory" };
      const newest = files[0];
      const dir = requested.endsWith("/") ? requested : requested + "/";
      return await tailFile(sftp, dir + newest.name, newest.size, lineCap);
    }

    return await tailFile(sftp, requested, Number(stat.size) || 0, lineCap);
  } catch (err) {
    const msg = err?.message || String(err);
    let reason = "ssh_error";
    if (/All configured authentication methods failed/i.test(msg)) reason = "ssh_auth_failed";
    else if (/ECONNREFUSED/.test(msg)) reason = "connection_refused";
    else if (/ETIMEDOUT|timed out/i.test(msg)) reason = "timeout";
    else if (/ENOTFOUND/.test(msg)) reason = "dns_failed";
    return { ok: false, reason, error: msg };
  } finally {
    try { await sftp.end(); } catch {}
  }
}

async function tailFile(sftp, path, size, lineCap) {
  let buf;
  if (size > MAX_BYTES) {
    buf = await sftp.get(path, undefined, { readStreamOptions: { start: size - MAX_BYTES, end: size - 1 } });
  } else {
    buf = await sftp.get(path);
  }
  const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
  const allLines = text.split(/\r?\n/);
  const tail = allLines.slice(-lineCap).map(sanitizeLine);
  return {
    ok: true,
    path,
    sizeBytes: size,
    truncated: size > MAX_BYTES,
    lineCount: tail.length,
    fetchedAt: new Date().toISOString(),
    lines: tail,
  };
}

export function listDeviceLogPaths(deviceId) {
  const device = getDevice(deviceId);
  if (!device) return { ok: false, reason: "device_not_found" };
  return { ok: true, deviceId, paths: getAllowedPaths(device) };
}