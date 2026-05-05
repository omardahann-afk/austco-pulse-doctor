/**
 * SSH/SFTP helpers for pulling Austco service logs from remote VMs.
 * Uses ssh2 (raw client) for connection/auth tests and ssh2-sftp-client
 * for file pulls. No fake fallbacks — failures surface to the UI verbatim.
 */
import { Client } from "ssh2";
import SftpClient from "ssh2-sftp-client";

const DEFAULT_TIMEOUT = 8000;
const MAX_LOG_BYTES = 512 * 1024; // 512KB tail per file
const MAX_FILES_PER_SERVICE = 50;
const MAX_TOTAL_BYTES_PER_SERVICE = 25 * 1024 * 1024; // 25 MB
const EXCLUDE_EXTENSIONS = [".zip", ".gz", ".tar", ".7z", ".bz2", ".xz", ".rar"];

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

/* ===== Path expansion (file / directory / glob) ===== */

function isGlob(p) {
  return /[*?[\]]/.test(p);
}

function basename(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p) {
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return p.slice(0, i);
}

function joinPath(dir, name) {
  if (!dir || dir === ".") return name;
  if (dir.endsWith("/")) return dir + name;
  return dir + "/" + name;
}

/** Convert a glob pattern (basename only, supports * ? [..]) to a RegExp. */
function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      let j = i + 1;
      while (j < glob.length && glob[j] !== "]") j++;
      if (j >= glob.length) re += "\\[";
      else { re += "[" + glob.slice(i + 1, j) + "]"; i = j; }
    } else if (/[.+^${}()|\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  re += "$";
  return new RegExp(re);
}

/** Looks like a log file by name? */
function looksLikeLog(name) {
  const lower = name.toLowerCase();
  if (EXCLUDE_EXTENSIONS.some((e) => lower.endsWith(e))) return false;
  if (lower.startsWith(".")) return false; // hidden
  // Match common log shapes: *.log, *.log.N, error.log, audit.log, contains "log"
  if (/\.log(\.\d+)?$/.test(lower)) return true;
  if (/(^|[^a-z])log([^a-z]|$)/.test(lower)) return true;
  if (lower.includes("log")) return true;
  return false;
}

/**
 * Expand a single user-supplied logPath into a list of regular files on the
 * remote host. Supports:
 *   - Exact file:    /a/b/c.log
 *   - Directory:     /a/b/   or   /a/b
 *   - Glob:          /a/b/*.log   /a/b/app.log*
 * Returns: { ok, kind, input, files: [{path,sizeBytes,modifyTime}], discovered, error }
 */
export async function expandLogPath(sftp, inputPath) {
  const input = String(inputPath || "").trim();
  if (!input) return { ok: false, kind: "invalid", input, files: [], discovered: 0, error: "empty path" };

  // Glob path
  if (isGlob(input)) {
    const dir = dirname(input);
    const pattern = basename(input);
    if (isGlob(dir)) {
      return { ok: false, kind: "glob", input, files: [], discovered: 0, error: "glob in directory portion not supported" };
    }
    try {
      const entries = await sftp.list(dir);
      const re = globToRegExp(pattern);
      const files = entries
        .filter((e) => e.type === "-" && re.test(e.name))
        .map((e) => ({ path: joinPath(dir, e.name), sizeBytes: Number(e.size) || 0, modifyTime: Number(e.modifyTime) || 0 }));
      return { ok: true, kind: "glob", input, files, discovered: files.length };
    } catch (err) {
      return { ok: false, kind: "glob", input, files: [], discovered: 0, error: err?.message || String(err) };
    }
  }

  // Stat to decide file vs directory
  let stat;
  try { stat = await sftp.stat(input); }
  catch (err) {
    const msg = err?.message || String(err);
    const reason = /No such file/i.test(msg) || err?.code === 2 ? "not_found"
      : /Permission denied/i.test(msg) || err?.code === 3 ? "permission_denied"
      : "stat_error";
    return { ok: false, kind: "unknown", input, files: [], discovered: 0, error: msg, reason };
  }

  if (stat.isDirectory) {
    const dir = input.replace(/\/+$/, "") || "/";
    try {
      const entries = await sftp.list(dir);
      const files = entries
        .filter((e) => e.type === "-" && looksLikeLog(e.name))
        .map((e) => ({ path: joinPath(dir, e.name), sizeBytes: Number(e.size) || 0, modifyTime: Number(e.modifyTime) || 0 }));
      return { ok: true, kind: "directory", input, files, discovered: files.length };
    } catch (err) {
      return { ok: false, kind: "directory", input, files: [], discovered: 0, error: err?.message || String(err) };
    }
  }

  // Regular file
  return {
    ok: true,
    kind: "file",
    input,
    files: [{ path: input, sizeBytes: Number(stat.size) || 0, modifyTime: Number(stat.modifyTime) || 0 }],
    discovered: 1,
  };
}

/**
 * Pull a list of log paths from a host via SFTP. Each input path may be a
 * file, a directory (pulls likely log files inside), or a glob.
 *
 * Returns:
 *   { ok, connected, files: [...], expansions: [...] }
 *
 * `files`: per-pulled-file results (path, ok, sizeBytes, content, etc.) —
 * shape unchanged so existing parsers keep working. Each file also carries
 * `inputPath` (the original logPath that produced it).
 *
 * `expansions`: per-input metadata: { input, kind, ok, discovered, pulled,
 * skipped, error, reason }.
 */
export async function pullLogs(opts, paths) {
  const sftp = new SftpClient();
  const results = [];
  const expansions = [];
  let connected = false;
  let totalBytesPulled = 0;
  let totalFilesPulled = 0;

  try {
    await sftp.connect({ ...authOpts(opts), tryKeyboard: true });
    connected = true;
    for (const p of paths) {
      const inputPath = String(p || "").trim();
      if (!inputPath) continue;

      const exp = await expandLogPath(sftp, inputPath);
      if (!exp.ok) {
        expansions.push({ input: inputPath, kind: exp.kind, ok: false, discovered: 0, pulled: 0, skipped: 0, error: exp.error, reason: exp.reason });
        results.push({ path: inputPath, inputPath, ok: false, reason: exp.reason || "expand_error", error: exp.error || "" });
        continue;
      }

      // Sort newest first by modifyTime, then enforce per-service caps.
      const sorted = exp.files.slice().sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0));
      let pulled = 0;
      let skipped = 0;

      for (const f of sorted) {
        // Per-service file cap
        if (totalFilesPulled >= MAX_FILES_PER_SERVICE) { skipped++; continue; }
        // Per-service total-bytes cap (allow at least one file even if oversized — it'll be tailed)
        if (totalBytesPulled >= MAX_TOTAL_BYTES_PER_SERVICE) { skipped++; continue; }

        try {
          const size = Number(f.sizeBytes) || 0;
          let buf;
          if (size > MAX_LOG_BYTES) {
            buf = await sftp.get(f.path, undefined, { readStreamOptions: { start: size - MAX_LOG_BYTES, end: size - 1 } });
          } else {
            buf = await sftp.get(f.path);
          }
          const content = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf);
          const bytesRead = Buffer.isBuffer(buf) ? buf.length : Buffer.byteLength(content, "utf8");
          totalBytesPulled += bytesRead;
          totalFilesPulled++;
          pulled++;
          results.push({
            path: f.path,
            inputPath,
            ok: true,
            sizeBytes: size,
            truncated: size > MAX_LOG_BYTES,
            content,
          });
        } catch (err) {
          const msg = err?.message || String(err);
          let reason = "error";
          if (/No such file/i.test(msg) || err?.code === 2) reason = "not_found";
          else if (/Permission denied/i.test(msg) || err?.code === 3) reason = "permission_denied";
          results.push({ path: f.path, inputPath, ok: false, reason, error: msg });
        }
      }

      expansions.push({
        input: inputPath,
        kind: exp.kind,
        ok: true,
        discovered: exp.discovered,
        pulled,
        skipped,
      });
    }
  } catch (err) {
    return { ok: false, connected, stage: connected ? "sftp_error" : "connect_failed", error: err?.message || String(err), files: results, expansions };
  } finally {
    try { await sftp.end(); } catch {}
  }
  return { ok: true, connected, files: results, expansions };
}
