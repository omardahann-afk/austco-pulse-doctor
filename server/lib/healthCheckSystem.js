import fs from "fs";
import path from "path";
import { NodeSSH } from "node-ssh";

const DATA_DIR = path.resolve("server/data");
const APPLIANCES_FILE = path.join(DATA_DIR, "appliances.json");
const FIXES_FILE = path.join(DATA_DIR, "pendingFixes.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function listAppliances() {
  return readJson(APPLIANCES_FILE, []);
}

export function saveAppliance(appliance) {
  const appliances = listAppliances();
  const id = appliance.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const safe = {
    id,
    name: appliance.name || "Unnamed Appliance",
    role: appliance.role || "Other",
    host: appliance.host,
    techUser: appliance.techUser || "tech",
    techPass: appliance.techPass || "tech",
    rootUser: appliance.rootUser || "root",
    rootPass: appliance.rootPass || "root",
    services: appliance.services || [],
    expectedPorts: appliance.expectedPorts || [],
    logPaths: appliance.logPaths || [],
    intervalSeconds: Number(appliance.intervalSeconds || 60),
    createdAt: appliance.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const idx = appliances.findIndex(x => x.id === id || x.host === safe.host);
  if (idx >= 0) appliances[idx] = safe;
  else appliances.push(safe);

  writeJson(APPLIANCES_FILE, appliances);
  return safe;
}

async function sshRun({ host, user, pass, command }) {
  const ssh = new NodeSSH();
  await ssh.connect({
    host,
    username: user,
    password: pass,
    readyTimeout: 20000,
    tryKeyboard: true,
  });

  const result = await ssh.execCommand(command, { cwd: "/tmp" });
  ssh.dispose();

  return {
    command,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    code: result.code,
  };
}

function summarize(appliance, evidence) {
  const problems = [];
  const proof = [];
  const fixes = [];

  const failedServices = evidence.failedServices?.stdout || "";
  const disk = evidence.disk?.stdout || "";
  const ports = evidence.ports?.stdout || "";
  const errors = evidence.taceraErrors?.stdout || "";
  const journal = evidence.journal?.stdout || "";

  if (/failed/i.test(failedServices) && !/0 loaded units listed/i.test(failedServices)) {
    problems.push("One or more Linux services are failed.");
    proof.push("systemctl --failed returned failed services.");
    fixes.push("Open the failed service proof, identify the exact unit, then restart only that service if approved.");
  }

  if (/Use%/i.test(disk) && /9[0-9]%|100%/i.test(disk)) {
    problems.push("Disk usage is critically high.");
    proof.push("df -h shows a filesystem near or above 90%.");
    fixes.push("Clear old logs or expand disk after reviewing which path is full.");
  }

  if (/CertificateExpiredException|PKIX|SSLHandshakeException/i.test(errors + journal)) {
    problems.push("Certificate or Java trust failure detected.");
    proof.push("Logs contain certificate/PKIX/SSL handshake errors.");
    fixes.push("Check VM time, inspect cert expiry, renew cert, and verify Java truststore.");
  }

  if (/Invalid call point ID|Could not interpret new update/i.test(errors)) {
    problems.push("Invalid or stale callpoint/config mapping detected.");
    proof.push("Tacera logs show invalid callpoint/object mapping errors.");
    fixes.push("Check CCP/IPConnect mapping, affected callpoint IDs, and recent config imports.");
  }

  if (/BAD|bad message/i.test(errors)) {
    problems.push("BAD messages detected in Tacera/controller logs.");
    proof.push("Logs contain BAD message patterns.");
    fixes.push("Correlate BAD message timestamp with PST/CCT activation and firmware/config state.");
  }

  for (const port of appliance.expectedPorts || []) {
    if (!ports.includes(`:${port}`)) {
      problems.push(`Expected port ${port} is not listening.`);
      proof.push(`ss -tulpn did not show port ${port}.`);
      fixes.push(`Confirm ${port} is actually required for ${appliance.role}; if yes, check the owning service.`);
    }
  }

  const status = problems.length >= 2 ? "CRITICAL" : problems.length === 1 ? "WARNING" : "OK";

  return {
    status,
    whatIsBroken:
      problems[0] ||
      "No confirmed issue found on this scan.",
    whyItMatters:
      problems.length
        ? "This can affect Tacera service routing, live monitoring, integrations, or appliance stability."
        : "The appliance responded and no major failure pattern was detected.",
    likelyRootCause:
      problems.join(" ") || "No root cause detected.",
    nextSteps:
      fixes.length
        ? fixes
        : ["Keep monitoring. Re-run scan during the exact failure window."],
    proof,
    developerEvidence: {
      failedServices,
      disk,
      ports,
      taceraErrors: errors.slice(-5000),
      journal: journal.slice(-5000),
    },
  };
}

export async function scanAppliance(appliance) {
  const root = {
    host: appliance.host,
    user: appliance.rootUser || "root",
    pass: appliance.rootPass || "root",
  };

  const logPathExpr = (appliance.logPaths || [])
    .map(p => `"${p}"`)
    .join(" ");

  const commands = {
    identity: "hostname; date; uptime; whoami",
    disk: "df -h",
    memory: "free -m",
    cpu: "top -b -n1 | head -40",
    ports: "ss -tulpn",
    failedServices: "systemctl --failed --no-pager",
    runningServices: "systemctl --type=service --state=running --no-pager",
    selectedServices: appliance.services?.length
      ? appliance.services.map(s => `systemctl status ${s} --no-pager 2>/dev/null || true`).join("; ")
      : "true",
    docker: "docker ps 2>/dev/null; docker ps -a 2>/dev/null",
    journal: "journalctl -p warning..alert --since '60 minutes ago' --no-pager 2>/dev/null | tail -300",
    webmin: "systemctl status webmin --no-pager 2>/dev/null; tail -120 /var/webmin/miniserv.error 2>/dev/null",
    taceraErrors: logPathExpr
      ? `grep -R -iE 'error|severe|fatal|exception|failed|refused|expired|pkix|sslhandshake|invalid call point|not ready|disconnect|timeout|BAD|watchdog|reset' ${logPathExpr} 2>/dev/null | tail -500`
      : `grep -R -iE 'error|severe|fatal|exception|failed|refused|expired|pkix|sslhandshake|invalid call point|not ready|disconnect|timeout|BAD|watchdog|reset' /home/xcare /var/opt/xcare /home/pst/log 2>/dev/null | tail -500`,
    certs: "find /home/xcare /var/opt/xcare /etc /home/pst -type f \\( -name '*.crt' -o -name '*.pem' -o -name '*.jks' -o -name '*.p12' \\) 2>/dev/null | head -300",
    ha: "crm status 2>/dev/null || true; cat /proc/drbd 2>/dev/null || true; drbd-overview 2>/dev/null || true",
  };

  const evidence = {};

  for (const [name, command] of Object.entries(commands)) {
    try {
      evidence[name] = await sshRun({ ...root, command });
    } catch (err) {
      evidence[name] = { command, error: err.message };
    }
  }

  const summary = summarize(appliance, evidence);

  return {
    appliance: {
      id: appliance.id,
      name: appliance.name,
      role: appliance.role,
      host: appliance.host,
      services: appliance.services,
      expectedPorts: appliance.expectedPorts,
      logPaths: appliance.logPaths,
    },
    scannedAt: new Date().toISOString(),
    summary,
    evidence,
  };
}

export async function scanAllAppliances() {
  const appliances = listAppliances();
  const results = [];
  for (const appliance of appliances) {
    results.push(await scanAppliance(appliance));
  }
  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    results,
  };
}

export function suggestFix(scanResult) {
  const fixes = readJson(FIXES_FILE, []);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const firstStep = scanResult.summary?.nextSteps?.[0] || "Review developer proof.";

  const fix = {
    id,
    host: scanResult.appliance.host,
    applianceName: scanResult.appliance.name,
    risk: "REVIEW_REQUIRED",
    status: "PENDING_APPROVAL",
    plainEnglish: firstStep,
    exactCommand: "echo 'No automatic command generated. Review proof and choose a specific approved fix.'",
    rollback: "No change made unless approved.",
    proof: scanResult.summary?.proof || [],
    createdAt: new Date().toISOString(),
  };

  fixes.push(fix);
  writeJson(FIXES_FILE, fixes);
  return fix;
}

export function listFixes() {
  return readJson(FIXES_FILE, []);
}
