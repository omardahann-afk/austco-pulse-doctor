import https from "https";
import net from "net";
import { Client } from "ssh2";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export const TACERA_EXPECTED_PORTS = {
  "ipconnect": [22, 10000],
  "integration-gateway": [22, 10000],
  "pulse-gateway": [22, 443, 10000],
  "pulse-manage": [22, 10000],
  "license-service": [22, 10000],
  "rtls-gateway": [22, 10000],
  "hl7": [22, 10000],
  "mobile-gateway": [22, 10000],
  "annunciator-server": [22, 10000],
  "nursestation-server": [22, 10000],
  "appstation-server": [22, 10000],
  "controller": [],
  "switch": [],
  "event-bridge-optional": [],
  "custom": []
};

export const TACERA_NEXT_STEP_LIBRARY = {
  certificate: [
    "Check VM date/time.",
    "Inspect the certificate presented by HTTPS/WebSocket endpoint.",
    "Check certificate NotAfter expiry date.",
    "Renew or replace expired certificate.",
    "Verify Java truststore contains the correct certificate/CA.",
    "Restart only the affected service after certificate repair.",
    "Confirm SSLHandshakeException/PKIX errors stop."
  ],
  servicePort: [
    "Confirm the checked port is actually expected for this appliance profile.",
    "Run ss -tulpn to see listening services.",
    "Identify which process should own the closed port.",
    "Check docker ps and docker ps -a.",
    "Check systemctl --failed.",
    "Check recent journal warnings/errors.",
    "Restart only the affected service after capturing current state."
  ],
  webmin: [
    "Open Webmin at https://<host>:10000.",
    "Confirm Webmin/admin portal loads.",
    "Use Webmin to inspect running services if SSH output is unclear.",
    "Do not treat Webmin working as proof the Tacera app is healthy."
  ],
  ipconnectCcp: [
    "Search affected callpoint IDs in IPConnect/CCP.",
    "Verify callpoint objects exist in active configuration.",
    "Verify signal profiles and call types.",
    "Compare against most recent CCP import.",
    "Check for removed/replaced callpoints.",
    "Check stale integration replay/source mapping.",
    "Reload/import configuration only after confirming mismatch."
  ],
  vmHealth: [
    "Check disk usage with df -h.",
    "Check memory with free -m.",
    "Check CPU/load with uptime and top.",
    "Check failed services.",
    "Check Docker containers.",
    "Check system date/time.",
    "Check recent warnings/errors."
  ],
  network: [
    "Confirm ping/ARP reachability.",
    "Confirm SSH reachability.",
    "Confirm expected profile ports only.",
    "Do not mark random unconfigured ports as failures.",
    "Check VLAN/PoE/switch only if controller/device layer evidence points there."
  ],
  doNotTouch: [
    "Do not reboot all VMs first.",
    "Do not restart Pulse first unless evidence points to Pulse.",
    "Do not blame MQTT/event broker unless explicitly configured and failing.",
    "Do not treat port 8080 as required unless profile says it is.",
    "Do not replace displays before checking routing/config.",
    "Do not treat Webmin access as application health.",
    "Do not ignore certificate expiry/PKIX errors.",
    "Do not run destructive remediation from AI output."
  ]
};

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms))
  ]);
}

export async function checkTcp(host, port, ms = 2500) {
  return withTimeout(new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(ms);
    socket.once("connect", () => {
      socket.destroy();
      resolve({ port, open: true });
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve({ port, open: false, reason: "timeout" });
    });
    socket.once("error", err => {
      socket.destroy();
      resolve({ port, open: false, reason: err.code || err.message });
    });
    socket.connect(port, host);
  }), ms + 500, { port, open: false, reason: "timeout" });
}

export function sshExec({ host, port = 22, username, password, command, timeoutMs = 15000 }) {
  return new Promise(resolve => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;

    const done = result => {
      if (settled) return;
      settled = true;
      try { conn.end(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ ok: false, command, stdout, stderr, error: "ssh_timeout" });
    }, timeoutMs);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          return done({ ok: false, command, stdout, stderr, error: err.message });
        }

        stream.on("close", code => {
          clearTimeout(timer);
          done({ ok: code === 0, code, command, stdout: stdout.slice(0, 12000), stderr: stderr.slice(0, 4000) });
        });

        stream.on("data", d => { stdout += d.toString(); });
        stream.stderr.on("data", d => { stderr += d.toString(); });
      });
    });

    conn.on("error", err => {
      clearTimeout(timer);
      done({ ok: false, command, stdout, stderr, error: err.message });
    });

    conn.connect({ host, port, username, password, readyTimeout: timeoutMs });
  });
}

async function webminFetch(url, options = {}) {
  const res = await fetch(url, { ...options, redirect: "manual", agent: insecureAgent });
  const text = await res.text().catch(() => "");
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text };
}

export async function examineWebmin({ host, port = 10000, username = "tech", password = "tech" }) {
  const base = `https://${host}:${port}`;
  const portCheck = await checkTcp(host, port);

  if (!portCheck.open) {
    return {
      reachable: false,
      port,
      url: base,
      summary: `Webmin is not reachable on ${host}:${port}.`,
      evidence: [portCheck]
    };
  }

  try {
    const loginBody = new URLSearchParams({ user: username, pass: password, page: "/", save: "1" });
    const login = await webminFetch(`${base}/session_login.cgi`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: loginBody.toString()
    });

    const cookie = login.headers["set-cookie"] || "";
    const pages = ["/sysinfo.cgi", "/proc/index.cgi", "/status/index.cgi"];

    const fetched = [];
    for (const page of pages) {
      try {
        const r = await webminFetch(`${base}${page}`, { headers: cookie ? { cookie } : {} });
        fetched.push({
          page,
          status: r.status,
          preview: r.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 1600)
        });
      } catch (err) {
        fetched.push({ page, error: err.message });
      }
    }

    return {
      reachable: true,
      loggedInAttempted: true,
      port,
      url: base,
      summary: "Webmin/admin portal is reachable. This proves admin access, not Tacera application health.",
      pages: fetched
    };
  } catch (err) {
    return {
      reachable: true,
      loggedInAttempted: true,
      port,
      url: base,
      summary: "Webmin port is open, but automated Webmin read failed. SSH read-only checks should still be used.",
      error: err.message
    };
  }
}

function detectFromSsh(outputs = []) {
  const joined = outputs.map(x => `${x.command}\n${x.stdout}\n${x.stderr}\n${x.error || ""}`).join("\n");
  const findings = [];

  if (/CertificateExpiredException|PKIX path validation failed|SSLHandshakeException/i.test(joined)) {
    findings.push({
      type: "certificate_or_tls",
      severity: "critical",
      plain: "Certificate or Java trust failure detected.",
      why: "Logs contain TLS/PKIX/certificate failure patterns.",
      nextSteps: TACERA_NEXT_STEP_LIBRARY.certificate
    });
  }

  if (/No space left|100%|Use%.*9[0-9]%/i.test(joined)) {
    findings.push({
      type: "disk_pressure",
      severity: "high",
      plain: "Disk may be full or close to full.",
      why: "Disk output/logs indicate high usage.",
      nextSteps: ["Run df -h.", "Clear old logs only after preserving evidence.", "Check debug/trace logging.", "Restart affected service only after disk pressure is resolved."]
    });
  }

  if (/failed|inactive|dead/i.test(joined)) {
    findings.push({
      type: "failed_service",
      severity: "high",
      plain: "One or more services may be failed/inactive.",
      why: "systemctl/docker output contains failed/inactive/dead indicators.",
      nextSteps: TACERA_NEXT_STEP_LIBRARY.servicePort
    });
  }

  return findings;
}

export async function examineMachine({
  host,
  profile = "custom",
  ssh = {},
  webmin = {},
  expectedPorts = null,
  includeWebmin = true,
  includeSsh = true,
  includeClaude = false
}) {
  const normalizedProfile = String(profile || "custom").toLowerCase();
  const ports = expectedPorts?.length
    ? expectedPorts.map(Number).filter(Boolean)
    : (TACERA_EXPECTED_PORTS[normalizedProfile] || TACERA_EXPECTED_PORTS.custom);

  const portResults = [];
  for (const port of ports) portResults.push(await checkTcp(host, port));

  const readOnlyCommands = [
    "date",
    "uptime",
    "hostname -I",
    "df -h",
    "free -m",
    "top -b -n1 | head -40",
    "ss -tulpn",
    "systemctl --type=service --state=running --no-pager | head -120",
    "systemctl --failed --no-pager",
    "docker ps",
    "docker ps -a",
    "journalctl -p warning..alert --since '60 minutes ago' --no-pager | tail -200",
    "find /var/opt/xcare/log /home/xcare/runtime -type f \\( -name '*.log' -o -name '*.out' \\) 2>/dev/null | head -80"
  ];

  const sshResults = [];
  if (includeSsh && ssh?.username && ssh?.password) {
    for (const command of readOnlyCommands) {
      sshResults.push(await sshExec({ host, port: ssh.port || 22, username: ssh.username, password: ssh.password, command }));
    }
  }

  const webminResult = includeWebmin ? await examineWebmin({
    host,
    port: webmin.port || 10000,
    username: webmin.username || ssh.username || "tech",
    password: webmin.password || ssh.password || "tech"
  }) : null;

  const webminOpen = portResults.some(p => p.port === 10000 && p.open) || webminResult?.reachable;
  const sshOpen = portResults.some(p => p.port === 22 && p.open);
  const closedExpected = portResults.filter(p => !p.open);
  const openExpected = portResults.filter(p => p.open);
  const sshFindings = detectFromSsh(sshResults);

  const whatIsProven = [
    webminOpen ? "Webmin/admin portal is reachable on port 10000." : null,
    sshOpen ? "SSH is reachable on port 22." : null,
    openExpected.length ? `Open expected ports: ${openExpected.map(p => p.port).join(", ")}.` : null,
    sshResults.length ? "Read-only SSH machine inspection ran." : null
  ].filter(Boolean);

  const whatIsNotProven = [
    "Webmin being open does not prove Tacera services are healthy.",
    "A closed port only matters if that port is expected for the selected appliance profile.",
    "Port 8080 is not checked unless explicitly configured.",
    "MQTT/event broker is not relevant unless explicitly configured or directly evidenced.",
    "Ping/SSH success proves VM reachability, not application correctness."
  ];

  let whatIsBroken = "No confirmed application fault from profile ports alone.";
  let why = "Management access is reachable. Application health must be proven by process, listener, service, and log evidence.";
  let confidence = 55;
  let nextSteps = [
    ...TACERA_NEXT_STEP_LIBRARY.webmin,
    ...TACERA_NEXT_STEP_LIBRARY.vmHealth,
    ...TACERA_NEXT_STEP_LIBRARY.servicePort
  ];

  if (closedExpected.length > 0) {
    whatIsBroken = "One or more profile-expected ports are closed.";
    why = `Only profile-defined ports were checked. Closed expected ports: ${closedExpected.map(p => p.port).join(", ")}.`;
    confidence = 75;
  }

  if (sshFindings.length > 0) {
    whatIsBroken = sshFindings[0].plain;
    why = sshFindings[0].why;
    confidence = sshFindings[0].severity === "critical" ? 95 : 85;
    nextSteps = sshFindings.flatMap(f => f.nextSteps || []);
  }

  const result = {
    ok: true,
    host,
    profile: normalizedProfile,
    expectedPortsUsed: ports,
    importantNote: "Port 8080 is NOT checked unless explicitly added. Webmin is port 10000.",
    topSummary: {
      whatIsBroken,
      why,
      whatIsProven,
      whatIsNotProven,
      nextSteps: [...new Set(nextSteps)].slice(0, 30),
      doNotTouch: TACERA_NEXT_STEP_LIBRARY.doNotTouch,
      confidence,
      plainEnglish: `${whatIsBroken} ${why}`
    },
    webmin: webminResult,
    ports: portResults,
    sshReadOnly: sshResults,
    detectedFindings: sshFindings,
    devProof: {
      expectedPortsUsed: ports,
      openExpectedPorts: openExpected,
      closedExpectedPorts: closedExpected,
      sshCommandCount: sshResults.length,
      webminReachable: !!webminOpen,
      sshReachable: !!sshOpen
    }
  };

  if (includeClaude && process.env.ANTHROPIC_API_KEY) {
    result.claudePromptPayload = {
      topSummary: result.topSummary,
      ports: result.ports,
      sshReadOnly: result.sshReadOnly.map(x => ({ command: x.command, ok: x.ok, stdout: String(x.stdout || "").slice(0, 2000), stderr: String(x.stderr || "").slice(0, 500), error: x.error })),
      instruction: "Explain this to a less experienced Tacera technician. Do not invent facts. Give exact next steps. Keep developer proof separate."
    };
  }

  return result;
}
