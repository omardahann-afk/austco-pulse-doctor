const IGNORE_PATTERNS = [
  {
    id: "JMX_DUPLICATE",
    match: /JMX entry exists already/i,
    why: "Known startup duplicate JMX registration warning. Usually no operational impact."
  },
  {
    id: "JACORB_OBSOLETE",
    match: /jacorb\.home unset|jacorb\.properties/i,
    why: "Obsolete CORBA/JacORB warning. Usually ignorable."
  },
  {
    id: "CALLBACK_SETTINGS_RAM",
    match: /Callback settings:\s*type=RAM/i,
    why: "Internal plugin callback configuration/debug info."
  },
  {
    id: "XMLBLASTER_DYNAMIC_PLUGIN_STARTUP",
    match: /allowDynamicPlugins=true/i,
    why: "Known xmlBlaster startup warning. Ignore unless paired with runtime failures."
  },
  {
    id: "TOPIC_STORE_RAM_STARTUP",
    match: /Persistent and recoverable topics are switched off/i,
    why: "Known startup message. Topics are RAM based by design."
  }
];

const FAILURE_PATTERNS = [
  {
    id: "CERT_EXPIRED",
    severity: "critical",
    match: /CertificateExpiredException|NotAfter:/i,
    issue: "Secure websocket/HTTPS connection is failing because the certificate is expired.",
    cause: "Java rejected the certificate because its validity date has passed.",
    impact: "The websocket client cannot connect, so monitoring/event synchronization may never become active.",
    fixSteps: [
      "Confirm the VM date/time is correct.",
      "Inspect the certificate presented by the HTTPS/websocket endpoint.",
      "Renew or replace the expired certificate.",
      "Verify the Java truststore trusts the new certificate or CA chain.",
      "Restart the affected service after certificate replacement.",
      "Confirm the log no longer shows SSLHandshakeException or CertificateExpiredException."
    ],
    commands: [
      "date",
      "openssl s_client -connect <host>:443 -showcerts",
      "openssl s_client -connect <host>:8443 -showcerts",
      "keytool -list -keystore <truststore>"
    ],
    doNotDo: [
      "Do not reboot every VM first.",
      "Do not blame controllers first.",
      "Do not replace displays.",
      "Do not ignore SSLHandshakeException.",
      "Do not treat websocket errors as root cause until TLS/cert evidence is checked."
    ]
  },
  {
    id: "PKIX_TRUST_FAILURE",
    severity: "critical",
    match: /PKIX path validation failed|CertPathValidatorException|timestamp check failed/i,
    issue: "Java does not trust the certificate chain used by the service.",
    cause: "The certificate is expired, signed by an untrusted CA, missing an intermediate cert, or the VM date/time is wrong.",
    impact: "Secure service-to-service communication fails before application traffic can pass.",
    fixSteps: [
      "Check VM date/time first.",
      "Inspect the remote certificate chain.",
      "Confirm the Java truststore contains the correct CA/intermediate certificate.",
      "Replace expired or incorrect certificates.",
      "Restart the affected service and confirm clean reconnect."
    ],
    commands: [
      "date",
      "openssl s_client -connect <host>:443 -showcerts",
      "keytool -list -keystore <truststore>"
    ],
    doNotDo: [
      "Do not call this an IPConnect application crash first.",
      "Do not restart unrelated services until the certificate chain is confirmed.",
      "Do not ignore PKIX errors."
    ]
  },
  {
    id: "SSL_HANDSHAKE",
    severity: "critical",
    match: /SSLHandshakeException|General SSLEngine problem/i,
    issue: "Secure websocket/HTTPS negotiation is failing.",
    cause: "The services cannot complete TLS negotiation. This is commonly caused by expired certificates, truststore mismatch, wrong certificate chain, or bad VM time.",
    impact: "The websocket connection repeatedly fails and dependent monitoring/event sync stays offline.",
    fixSteps: [
      "Look for CertificateExpiredException or PKIX errors nearby.",
      "Check VM date/time.",
      "Inspect the certificate on the target endpoint.",
      "Verify Java truststore.",
      "Renew/import the correct certificate if needed."
    ],
    commands: [
      "date",
      "grep -i \"CertificateExpiredException\\|PKIX\\|SSLHandshakeException\" /var/opt/xcare/log/xcare00.log",
      "openssl s_client -connect <host>:443 -showcerts"
    ],
    doNotDo: [
      "Do not treat the websocket failure as the root cause by itself.",
      "Do not reboot all services before checking certificate evidence."
    ]
  },
  {
    id: "INVALID_CALLPOINT",
    severity: "failure",
    match: /Invalid call point ID or signal attributes|Could not interpret new update/i,
    issue: "Invalid or stale callpoint mapping detected.",
    cause: "The system is receiving a callpoint ID or signal object that does not match active IPConnect/CCP configuration.",
    impact: "Calls/signals may not route correctly because the server cannot match the incoming object to valid configuration.",
    fixSteps: [
      "Search the affected callpoint IDs in IPConnect/CCP.",
      "Verify the callpoint objects exist in the active config.",
      "Verify signal profiles and call types.",
      "Check whether devices were removed/replaced.",
      "Compare against the most recent CCP import.",
      "Check integration replay/source mapping if the IDs are stale."
    ],
    commands: [
      "grep -i \"Invalid call point ID\\|Could not interpret new update\" /var/opt/xcare/log/xcare00.log",
      "grep -R \"<callpoint_id>\" /path/to/ccp/or/config"
    ],
    doNotDo: [
      "Do not restart Pulse first.",
      "Do not reboot all VMs first.",
      "Do not replace displays first.",
      "Do not blame unrelated middleware without direct evidence."
    ]
  },
  {
    id: "WS_CLIENT_NOT_READY",
    severity: "secondary",
    match: /WsClient is not ready|Monitoring is not active/i,
    issue: "Monitoring/websocket client is not connected.",
    cause: "This is usually a symptom. Look earlier for SSL, certificate, DNS, service, or port failure.",
    impact: "Monitoring/event sync will not work until the upstream connection problem is fixed.",
    fixSteps: [
      "Search earlier logs for SSLHandshakeException, PKIX, CertificateExpiredException, DNS, or connection refused.",
      "Fix the first upstream failure before restarting unrelated services."
    ],
    commands: [
      "grep -i \"SSLHandshakeException\\|PKIX\\|CertificateExpiredException\\|Connection refused\\|WsClient\" /var/opt/xcare/log/xcare00.log"
    ],
    doNotDo: [
      "Do not treat WsClient not ready as the root cause by itself."
    ]
  },
  {
    id: "CONNECTION_REFUSED",
    severity: "failure",
    match: /connect\(\) failed.*Connection refused|ECONNREFUSED|Connection refused/i,
    issue: "A service tried to connect to another service, but the target port refused the connection.",
    cause: "The target service may be stopped, bound to the wrong interface, blocked locally, or not listening on that port.",
    impact: "Dependent services may fail even if the VM itself is reachable.",
    fixSteps: [
      "Identify the target host and port in the log.",
      "Check whether the service owning that port is running.",
      "Check whether the port is listening.",
      "Review local firewall/bind-address configuration.",
      "Only restart the affected service after capturing current state."
    ],
    commands: [
      "ss -tulpn | grep <port>",
      "systemctl status <service>",
      "docker ps",
      "docker logs --tail=200 <container>",
      "curl -vk https://<host>:<port>"
    ],
    doNotDo: [
      "Do not assume the whole VM is down if SSH/ping still works.",
      "Do not reboot the VM before checking the service bound to that port."
    ]
  }
];

function lineText(x) {
  if (typeof x === "string") return x;
  if (!x) return "";
  return x.rawMessage || x.line || x.message || JSON.stringify(x);
}

function classifyLine(line) {
  const text = lineText(line);

  for (const rule of FAILURE_PATTERNS) {
    if (rule.match.test(text)) return { ...rule, line: text };
  }

  for (const rule of IGNORE_PATTERNS) {
    if (rule.match.test(text)) {
      return {
        id: rule.id,
        severity: "ignore",
        issue: "Known ignorable/noise message",
        cause: rule.why,
        impact: "Usually no direct operational impact.",
        fixSteps: [],
        commands: [],
        doNotDo: [],
        line: text
      };
    }
  }

  return {
    id: "UNKNOWN",
    severity: "unknown",
    issue: null,
    cause: null,
    impact: null,
    fixSteps: [],
    commands: [],
    doNotDo: [],
    line: text
  };
}

function scoreFinding(finding, index) {
  let score = 0;
  if (finding.severity === "critical") score += 100;
  if (finding.severity === "failure") score += 80;
  if (finding.severity === "secondary") score += 30;
  if (finding.id === "CERT_EXPIRED") score += 50;
  if (finding.id === "PKIX_TRUST_FAILURE") score += 40;
  if (finding.id === "SSL_HANDSHAKE") score += 25;
  if (finding.id === "WS_CLIENT_NOT_READY") score -= 10;
  score -= index * 0.01;
  return score;
}

export function buildTechnicianReadableDiagnosis(input = {}) {
  const rawLines = Array.isArray(input.lines)
    ? input.lines
    : Array.isArray(input.logs)
      ? input.logs
      : Array.isArray(input.rawEvidence)
        ? input.rawEvidence
        : String(input.text || "").split(/\r?\n/);

  const lines = rawLines.map(lineText).filter(Boolean);
  const classified = lines.map((line, index) => ({ index, ...classifyLine(line) }));

  const actionable = classified.filter(x => ["critical", "failure", "secondary"].includes(x.severity));
  const ignoredNoise = classified.filter(x => x.severity === "ignore");
  const unknown = classified.filter(x => x.severity === "unknown");

  const ranked = [...actionable].sort((a, b) => scoreFinding(b, b.index) - scoreFinding(a, a.index));
  const primary = ranked[0] || null;

  const secondaryEffects = actionable.filter(x =>
    x.id !== primary?.id &&
    (x.severity === "secondary" || x.id === "WS_CLIENT_NOT_READY" || x.id === "SSL_HANDSHAKE")
  );

  const unique = arr => [...new Set(arr.filter(Boolean))];

  const fixSteps = unique(primary?.fixSteps || []);
  const exactCommands = unique(primary?.commands || []);
  const doNotDo = unique([
    ...(primary?.doNotDo || []),
    "Do not let raw logs drive the fix without identifying the first failure point."
  ]);

  let confidence = 0;
  if (primary) {
    if (primary.id === "CERT_EXPIRED") confidence = 97;
    else if (primary.id === "PKIX_TRUST_FAILURE") confidence = 92;
    else if (primary.id === "INVALID_CALLPOINT") confidence = 88;
    else if (primary.id === "CONNECTION_REFUSED") confidence = 82;
    else confidence = 70;
  }

  const simpleIssue = primary?.issue || "Insufficient evidence to identify a confirmed issue.";
  const simpleCause = primary?.cause || "No deterministic failure pattern was found in the provided logs.";
  const operationalImpact = primary?.impact || "Collect more logs during the problem window.";
  const proofLines = actionable
    .filter(x => x.id === primary?.id || x.severity === "critical")
    .slice(0, 12)
    .map(x => x.line);

  return {
    simpleIssue,
    simpleCause,
    operationalImpact,
    confidence,
    confidenceMeaning: primary
      ? `Confidence is ${confidence}% because the logs contain ${primary.id} evidence.`
      : "Confidence is low because no deterministic failure pattern was found.",
    whatToCheckFirst: fixSteps[0] || "Collect more evidence during the failure window.",
    fixSteps,
    exactCommands,
    doNotDo,
    proofSummary: primary
      ? `Primary evidence pattern: ${primary.id}. ${proofLines.length} supporting proof line(s) found.`
      : "No strong proof pattern found.",
    proofLines,
    secondaryEffects: secondaryEffects.slice(0, 12).map(x => ({
      pattern: x.id,
      explanation: x.issue,
      line: x.line
    })),
    ignoredNoise: ignoredNoise.slice(0, 20).map(x => ({
      pattern: x.id,
      reason: x.cause,
      line: x.line
    })),
    developerPackage: {
      problem: input.problem || null,
      appliance: input.appliance || null,
      primaryPattern: primary?.id || null,
      primarySeverity: primary?.severity || null,
      confidence,
      proofLines,
      secondaryEffects: secondaryEffects.map(x => ({ id: x.id, line: x.line })),
      ignoredNoise: ignoredNoise.map(x => ({ id: x.id, line: x.line })),
      unknownLines: unknown.slice(0, 50).map(x => x.line),
      rawLineCount: lines.length
    }
  };
}
