import { sshExec } from "./taceraMachineExaminer.js";

export const TACERA_LOG_PATHS = [
  "/home/xcare/runtime/xcare/log/xcare00.log",
  "/home/xcare/runtime/xcare/log/xcare01.log",
  "/home/xcare/runtime/xcare/log/xcare02.log",
  "/home/xcare/runtime/xcare/log/xcare03.log",
  "/home/xcare/runtime/wscli/log/wscli.log",
  "/home/xcare/runtime/certs/logs/certificateupdatetool.log",
  "/home/xcare/runtime/pulse-gateway/log/error.log",
  "/home/xcare/runtime/integration-gateway/logs/app.log",
  "/home/xcare/runtime/license-service/log/app.log",
  "/home/xcare/runtime/system-monitor/logs/app.log",
  "/home/xcare/runtime/lmx/logs/lmx-serv.log",
  "/home/xcare/runtime/tomcat/logs/tomcat.log",
  "/home/xcare/runtime/edx/log/app.log"
];

const IGNORE_PATTERNS = [
  {
    id: "JMX_DUPLICATE",
    rx: /JMX entry exists already/i,
    explain: "Known startup JMX duplicate-registration warning. Usually ignorable."
  },
  {
    id: "JACORB_OBSOLETE",
    rx: /jacorb\.home unset|jacorb\.properties/i,
    explain: "Obsolete JacORB/CORBA warning. Usually ignorable."
  },
  {
    id: "CALLBACK_SETTINGS",
    rx: /Callback settings:\s*type=RAM/i,
    explain: "Internal callback/message handling config output. Usually not a fault."
  },
  {
    id: "DYNAMIC_PLUGINS_STARTUP",
    rx: /allowDynamicPlugins=true/i,
    explain: "Known xmlBlaster startup warning unless paired with runtime failures."
  },
  {
    id: "TOPIC_STORE_RAM",
    rx: /Persistent and recoverable topics are switched off/i,
    explain: "Known startup message. RAM-based topic handling is expected."
  }
];

const FAULT_PATTERNS = [
  {
    id: "CERT_EXPIRED",
    severity: "critical",
    rx: /CertificateExpiredException|NotAfter:/i,
    simpleIssue: "A secure websocket/HTTPS connection is failing because a certificate is expired.",
    why: "Java is rejecting the certificate because the certificate validity date has passed.",
    layer: "certificate / trust",
    nextSteps: [
      "Check VM date/time.",
      "Identify which service endpoint presents the expired certificate.",
      "Inspect the certificate NotAfter date.",
      "Renew or replace the expired certificate.",
      "Verify Java truststore trusts the new cert or CA chain.",
      "Restart only the affected service after certificate replacement.",
      "Confirm logs no longer show CertificateExpiredException, PKIX, or SSLHandshakeException."
    ],
    commands: [
      "date",
      "grep -RiE \"CertificateExpiredException|PKIX|SSLHandshakeException|NotAfter\" /home/xcare/runtime 2>/dev/null | tail -80",
      "openssl s_client -connect <host>:443 -showcerts",
      "openssl s_client -connect <host>:8443 -showcerts",
      "keytool -list -keystore <truststore>"
    ],
    doNotTouch: [
      "Do not reboot all VMs first.",
      "Do not blame controllers first.",
      "Do not replace displays.",
      "Do not treat websocket errors as root cause until certificate evidence is checked."
    ]
  },
  {
    id: "PKIX_TRUST_FAILURE",
    severity: "critical",
    rx: /PKIX path validation failed|CertPathValidatorException|timestamp check failed/i,
    simpleIssue: "Java does not trust the service certificate chain.",
    why: "The certificate may be expired, missing an intermediate CA, signed by an untrusted CA, or the VM time may be wrong.",
    layer: "certificate / trust",
    nextSteps: [
      "Check VM date/time.",
      "Inspect the remote certificate chain.",
      "Check Java truststore.",
      "Import the correct CA/intermediate certificate if required.",
      "Replace expired certificates.",
      "Restart only the affected service."
    ],
    commands: [
      "date",
      "grep -RiE \"PKIX|CertPathValidatorException|CertificateExpiredException|SSLHandshakeException\" /home/xcare/runtime 2>/dev/null | tail -80",
      "openssl s_client -connect <host>:443 -showcerts"
    ],
    doNotTouch: [
      "Do not call this a network outage if ping/SSH/Webmin work.",
      "Do not restart unrelated services until cert trust is checked."
    ]
  },
  {
    id: "SSL_HANDSHAKE",
    severity: "critical",
    rx: /SSLHandshakeException|General SSLEngine problem/i,
    simpleIssue: "Secure websocket/HTTPS negotiation is failing.",
    why: "The services cannot complete TLS negotiation. Usually this is caused by expired certificates, wrong truststore, wrong certificate chain, or bad VM time.",
    layer: "websocket / TLS",
    nextSteps: [
      "Look nearby in logs for PKIX or CertificateExpiredException.",
      "Check VM date/time.",
      "Inspect certificate on HTTPS/websocket endpoint.",
      "Verify Java truststore.",
      "Restart only the affected service after fixing TLS."
    ],
    commands: [
      "grep -RiE \"SSLHandshakeException|PKIX|CertificateExpiredException|NotAfter\" /home/xcare/runtime 2>/dev/null | tail -80",
      "date",
      "openssl s_client -connect <host>:443 -showcerts"
    ],
    doNotTouch: [
      "Do not treat the websocket error as the root cause by itself.",
      "Do not reboot every VM before checking certificate evidence."
    ]
  },
  {
    id: "INVALID_CALLPOINT",
    severity: "high",
    rx: /Invalid call point ID or signal attributes|Could not interpret new update|Input is not defined for Call point/i,
    simpleIssue: "The system is receiving a callpoint/signal object that does not match active IPConnect/CCP configuration.",
    why: "IPConnect or Integration Gateway is seeing callpoint IDs/signals that are missing, stale, removed, replaced, or not mapped correctly.",
    layer: "IPConnect / CCP configuration truth",
    nextSteps: [
      "Extract the affected callpoint IDs.",
      "Search the affected callpoint IDs in IPConnect/CCP.",
      "Verify the callpoint objects exist in active configuration.",
      "Verify signal profiles and call types.",
      "Compare against most recent CCP import.",
      "Check if devices were removed/replaced.",
      "Check stale integration replay/source mapping."
    ],
    commands: [
      "grep -RiE \"Invalid call point ID|Could not interpret new update|Input is not defined\" /home/xcare/runtime 2>/dev/null | tail -120",
      "grep -R \"<callpoint_id>\" /path/to/ccp/or/config"
    ],
    doNotTouch: [
      "Do not restart Pulse first.",
      "Do not reboot all VMs first.",
      "Do not replace displays first.",
      "Do not blame event bridge/MQTT unless direct evidence exists."
    ]
  },
  {
    id: "CONNECTION_REFUSED",
    severity: "high",
    rx: /Connection refused|connect\(\) failed.*111|ECONNREFUSED/i,
    simpleIssue: "A service tried to connect to another service, but the target application port refused the connection.",
    why: "The VM may be alive, but the target application service is stopped, bound to the wrong interface, restarting, or not listening on that port.",
    layer: "application service / port listener",
    nextSteps: [
      "Identify the exact upstream host and port from the log line.",
      "Confirm that port is actually expected for that service.",
      "Run ss -tulpn on the target VM.",
      "Check systemctl and docker container status.",
      "Check the target service logs before restarting.",
      "Restart only the affected service after capturing state."
    ],
    commands: [
      "ss -tulpn | grep <port>",
      "systemctl --failed --no-pager",
      "docker ps",
      "docker ps -a",
      "grep -RiE \"Connection refused|connect\\(\\) failed|ECONNREFUSED\" /home/xcare/runtime 2>/dev/null | tail -120"
    ],
    doNotTouch: [
      "Do not assume the full VM is down if SSH/Webmin work.",
      "Do not blame the network if ping/SSH work and only one app port refuses.",
      "Do not restart everything before identifying the target service."
    ]
  },
  {
    id: "WSCLIENT_NOT_READY",
    severity: "medium",
    rx: /WsClient is not ready|Monitoring is not active/i,
    simpleIssue: "The websocket client is not connected, so monitoring/event sync is not active.",
    why: "This is usually a symptom. The earlier root cause is often certificate failure, DNS, service bind failure, or connection refused.",
    layer: "websocket client state",
    nextSteps: [
      "Search earlier logs for SSLHandshakeException, PKIX, CertificateExpiredException, DNS failure, or Connection refused.",
      "Fix the first upstream failure before restarting unrelated services."
    ],
    commands: [
      "grep -RiE \"WsClient is not ready|SSLHandshakeException|PKIX|CertificateExpiredException|Connection refused\" /home/xcare/runtime 2>/dev/null | tail -120"
    ],
    doNotTouch: [
      "Do not treat WsClient not ready as root cause by itself."
    ]
  },
  {
    id: "XMLBLASTER_DISCONNECT",
    severity: "medium",
    rx: /xmlBlaster|communication\.noConnection|Callback server is lost|Lost client connection|Session timeout/i,
    simpleIssue: "A Tacera internal client/session disconnected.",
    why: "This can be harmless during startup/shutdown, but it matters if it lines up with application failures, certificate errors, or repeated disconnect loops.",
    layer: "Tacera internal messaging/session",
    nextSteps: [
      "Check whether this occurred during startup/shutdown.",
      "Look earlier for certificate, port, DNS, or application failures.",
      "Do not treat it as root cause unless it repeats with operational symptoms."
    ],
    commands: [
      "grep -RiE \"xmlBlaster|communication.noConnection|Callback server is lost|Lost client connection|Session timeout\" /home/xcare/runtime 2>/dev/null | tail -120"
    ],
    doNotTouch: [
      "Do not restart messaging/session services until the first upstream error is identified."
    ]
  }
];

function getSeverityScore(x) {
  if (!x) return 0;
  if (x.severity === "critical") return 100;
  if (x.severity === "high") return 80;
  if (x.severity === "medium") return 50;
  return 10;
}

function normalizeLine(line) {
  return String(line || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
}

function classifyLine(line, sourceFile) {
  const text = normalizeLine(line);
  if (!text) return null;

  for (const f of FAULT_PATTERNS) {
    if (f.rx.test(text)) {
      return { ...f, line: text, sourceFile };
    }
  }

  for (const n of IGNORE_PATTERNS) {
    if (n.rx.test(text)) {
      return {
        id: n.id,
        severity: "ignore",
        layer: "known noise",
        simpleIssue: "Known ignorable Tacera message",
        why: n.explain,
        line: text,
        sourceFile,
        nextSteps: [],
        commands: [],
        doNotTouch: []
      };
    }
  }

  return null;
}

function extractIds(text) {
  const ids = new Set();
  const rx = /\b\d{4,6}\.\d+\.\d+\.\d+\b/g;
  let m;
  while ((m = rx.exec(text || ""))) ids.add(m[0]);
  return [...ids];
}

export function buildTaceraLogDiagnosis({ host, profile, logFindings = [], machine = null }) {
  const actionable = logFindings.filter(x => x.severity !== "ignore");
  const ignoredNoise = logFindings.filter(x => x.severity === "ignore");

  const counts = {};
  for (const f of actionable) counts[f.id] = (counts[f.id] || 0) + 1;

  const ranked = [...actionable].sort((a, b) => {
    const diff = getSeverityScore(b) - getSeverityScore(a);
    if (diff) return diff;
    return (counts[b.id] || 0) - (counts[a.id] || 0);
  });

  const primary = ranked[0] || null;
  const allText = actionable.map(x => x.line).join("\n");
  const affectedCallpoints = extractIds(allText);

  let whatIsBroken = "No confirmed Tacera application fault found in pulled logs.";
  let why = "Machine/admin checks may be reachable, but no high-confidence Tacera log pattern was found.";
  let confidence = 35;
  let nextSteps = [
    "Run the scan during the exact failure window.",
    "Pull more recent Tacera logs.",
    "Confirm which VM owns IPConnect, Pulse Gateway, Integration Gateway, and License Service.",
    "Collect service-specific logs before restarting anything."
  ];
  let commands = [];
  let doNotTouch = [
    "Do not reboot all VMs first.",
    "Do not blame MQTT/event broker unless explicitly configured and failing.",
    "Do not treat Webmin reachability as Tacera app health."
  ];

  if (primary) {
    whatIsBroken = primary.simpleIssue;
    why = primary.why;
    confidence = primary.severity === "critical" ? 95 : primary.severity === "high" ? 85 : 70;
    nextSteps = primary.nextSteps || nextSteps;
    commands = primary.commands || [];
    doNotTouch = [...new Set([...(primary.doNotTouch || []), ...doNotTouch])];
  }

  return {
    host,
    profile,
    whatIsBroken,
    why,
    confidence,
    layer: primary?.layer || "unknown",
    primaryPattern: primary?.id || null,
    whatIsProven: [
      machine?.topSummary?.whatIsProven?.length ? `Machine proof: ${machine.topSummary.whatIsProven.join(" ")}` : null,
      primary ? `Detected ${primary.id} in Tacera logs.` : null,
      affectedCallpoints.length ? `Affected callpoint/object IDs found: ${affectedCallpoints.slice(0, 30).join(", ")}` : null
    ].filter(Boolean),
    whatIsNotProven: [
      "Webmin being open proves admin reachability, not application health.",
      "SSH working proves remote access, not that Tacera services are healthy.",
      "Generic Linux failed services are not Tacera root cause unless logs connect them.",
      "MQTT/event broker is not relevant unless direct evidence exists.",
      "Port 8080 is not relevant unless explicitly configured."
    ],
    nextSteps,
    exactCommands: commands,
    doNotTouch,
    affectedCallpoints,
    evidenceCounts: counts,
    keyEvidence: actionable.slice(0, 40).map(x => ({
      pattern: x.id,
      severity: x.severity,
      sourceFile: x.sourceFile,
      line: x.line
    })),
    ignoredNoise: ignoredNoise.slice(0, 40).map(x => ({
      pattern: x.id,
      sourceFile: x.sourceFile,
      reason: x.why,
      line: x.line
    })),
    developerProof: {
      host,
      profile,
      primaryPattern: primary?.id || null,
      counts,
      evidenceCount: actionable.length,
      ignoredNoiseCount: ignoredNoise.length,
      affectedCallpoints,
      sourcesScanned: [...new Set(logFindings.map(x => x.sourceFile).filter(Boolean))]
    }
  };
}

export async function scanTaceraLogsOnHost({ host, profile = "custom", ssh, logPaths = TACERA_LOG_PATHS, machine = null }) {
  const pathList = logPaths.map(p => `'${p.replace(/'/g, "'\\''")}'`).join(" ");
  const command = `
for f in ${pathList}; do
  if [ -f "$f" ]; then
    echo "===== FILE:$f ====="
    tail -n 500 "$f"
  fi
done
`.trim();

  const result = await sshExec({
    host,
    port: ssh?.port || 22,
    username: ssh?.username || "tech",
    password: ssh?.password || "tech",
    command,
    timeoutMs: 25000
  });

  const lines = String(result.stdout || "").split(/\r?\n/);
  let currentFile = null;
  const findings = [];

  for (const line of lines) {
    const m = line.match(/^===== FILE:(.*) =====$/);
    if (m) {
      currentFile = m[1];
      continue;
    }
    const c = classifyLine(line, currentFile);
    if (c) findings.push(c);
  }

  return {
    ok: result.ok,
    host,
    profile,
    command,
    stderr: result.stderr,
    error: result.error,
    scannedPaths: logPaths,
    findings,
    diagnosis: buildTaceraLogDiagnosis({ host, profile, logFindings: findings, machine })
  };
}
