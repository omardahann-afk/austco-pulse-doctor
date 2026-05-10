/**
 * Linux Ops Snapshot Collector (read-only)
 * ----------------------------------------
 * Captures a deterministic operational snapshot for a Linux appliance:
 * date, uptime, df, free, top, plus heuristic flags for clock drift,
 * disk pressure, memory pressure and recent reboot (boot-recovery window).
 *
 * Used by the live-capture pipeline so M2 correlation can avoid alarming
 * about errors generated inside an appliance's recoveryWindowSeconds.
 *
 * SSH access goes through the existing safe `sshExecutor` allowlist;
 * commands here are read-only diagnostics only.
 */
import { execOverSsh } from "./sshExecutor.js";

const SAFE_COMMANDS = [
  { key: "date", cmd: "date -u +%FT%TZ" },
  { key: "uptime", cmd: "uptime" },
  { key: "df", cmd: "df -h --output=source,size,used,avail,pcent,target" },
  { key: "free", cmd: "free -m" },
  { key: "top", cmd: "top -b -n1 | head -30" },
];

function parseDfPressure(out) {
  if (!out) return { diskFull: false, worstPct: null };
  let worst = 0;
  for (const line of String(out).split("\n").slice(1)) {
    const m = line.match(/(\d{1,3})%/);
    if (m) worst = Math.max(worst, Number(m[1]));
  }
  return { diskFull: worst >= 95, worstPct: worst };
}

function parseMemPressure(out) {
  if (!out) return { memExhausted: false, freePct: null };
  // "Mem:        total       used       free       shared..."
  const line = String(out).split("\n").find((l) => /^Mem:/.test(l));
  if (!line) return { memExhausted: false, freePct: null };
  const nums = line.trim().split(/\s+/).slice(1).map(Number);
  const total = nums[0], free = nums[2];
  if (!total) return { memExhausted: false, freePct: null };
  const freePct = Math.round((free / total) * 100);
  return { memExhausted: freePct < 5, freePct };
}

function parseClockDrift(remoteIso, localIso) {
  if (!remoteIso || !localIso) return { driftSeconds: null, drifted: false };
  const r = Date.parse(String(remoteIso).trim());
  const l = Date.parse(localIso);
  if (Number.isNaN(r) || Number.isNaN(l)) return { driftSeconds: null, drifted: false };
  const drift = Math.abs(Math.round((r - l) / 1000));
  return { driftSeconds: drift, drifted: drift > 30 };
}

function parseUptimeRecentBoot(out) {
  if (!out) return { recentReboot: false, uptimeText: null };
  const text = String(out).trim();
  // "up 4 minutes" / "up 12 min" → recent
  const m = text.match(/up\s+(\d+)\s*(min|minute|minutes|hour|hours)\b/i);
  if (!m) return { recentReboot: false, uptimeText: text };
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("min") && n <= 10) return { recentReboot: true, uptimeText: text, ageMinutes: n };
  if (unit.startsWith("hour") && n <= 1) return { recentReboot: true, uptimeText: text, ageMinutes: n * 60 };
  return { recentReboot: false, uptimeText: text };
}

/**
 * Collect a snapshot from one appliance.
 * Returns { ok, results: { date, uptime, ... }, flags: {...}, errors: [...] }
 */
export async function collectLinuxOpsSnapshot({ host, port, username, password }) {
  const results = {};
  const errors = [];
  if (!host || !username || !password) {
    return {
      ok: false,
      collectedAt: new Date().toISOString(),
      results,
      flags: {},
      errors: [{ key: "ssh", message: "host/username/password required" }],
    };
  }
  for (const c of SAFE_COMMANDS) {
    try {
      const r = await execOverSsh({ host, port, username, password }, c.cmd, 10000);
      results[c.key] = r?.stdout || "";
      if (r?.stderr) results[c.key + "_stderr"] = r.stderr;
    } catch (e) {
      errors.push({ key: c.key, message: e?.message || String(e) });
      results[c.key] = null;
    }
  }
  const localIso = new Date().toISOString();
  const drift = parseClockDrift(results.date, localIso);
  const disk = parseDfPressure(results.df);
  const mem = parseMemPressure(results.free);
  const uptime = parseUptimeRecentBoot(results.uptime);
  return {
    ok: errors.length === 0,
    collectedAt: localIso,
    results,
    flags: {
      ...drift,
      ...disk,
      ...mem,
      ...uptime,
    },
    errors,
  };
}
