export const TACERA_KNOWLEDGE_BASE = {
  sourceDocs: [
    "TIS-065 Tacera Messages that can be ignored",
    "TIS-084 Virtual Host Server Requirements",
    "TIS-089 Tacera System Capacity Planning Guidelines",
  ],

  ignoredLogPatterns: [
    {
      pattern: "JMX entry exists already",
      classification: "IGNORE",
      reason: "Known startup duplicate JMX registration warning. Usually no operational impact.",
      source: "TIS-065",
    },
    {
      pattern: "jacorb.home unset",
      classification: "IGNORE",
      reason: "Obsolete CORBA warning. Tacera does not use CORBA for current operation.",
      source: "TIS-065",
    },
    {
      pattern: "jacorb.properties",
      classification: "IGNORE",
      reason: "Obsolete CORBA-related warning.",
      source: "TIS-065",
    },
    {
      pattern: "Callback settings: type=RAM",
      classification: "IGNORE",
      reason: "Internal plugin message handling configuration/debug info.",
      source: "TIS-065",
    },
    {
      pattern: "allowDynamicPlugins=true",
      classification: "IGNORE_IF_STARTUP_ONLY",
      reason: "Known xmlBlaster startup warning. Only suspicious if paired with runtime failure.",
      source: "TIS-065",
    },
    {
      pattern: "Persistent and recoverable topics are switched off",
      classification: "IGNORE_IF_STARTUP_ONLY",
      reason: "Known startup warning; MOM messages are RAM based by design.",
      source: "TIS-065",
    },
  ],

  criticalPatterns: [
    {
      pattern: "CertificateExpiredException",
      classification: "CRITICAL",
      rootCause: "Expired TLS certificate",
      human: "A secure service connection is failing because the certificate is expired.",
      nextChecks: [
        "Check VM date/time.",
        "Inspect certificate NotAfter date.",
        "Renew or replace expired certificate.",
        "Verify Java truststore contains the correct CA/cert.",
      ],
    },
    {
      pattern: "PKIX path validation failed",
      classification: "CRITICAL",
      rootCause: "Java trust/certificate validation failure",
      human: "Java rejected the server certificate. This usually means expired cert, wrong CA, or truststore mismatch.",
      nextChecks: [
        "Verify certificate chain.",
        "Check Java keystore/truststore.",
        "Confirm host date/time.",
      ],
    },
    {
      pattern: "SSLHandshakeException",
      classification: "CRITICAL",
      rootCause: "TLS handshake failure",
      human: "Secure websocket/HTTPS communication failed before application data could pass.",
      nextChecks: [
        "Check certificate validity.",
        "Check TLS endpoint.",
        "Check Java truststore.",
      ],
    },
    {
      pattern: "Invalid call point ID or signal attributes",
      classification: "FAILURE",
      rootCause: "Invalid/stale callpoint mapping or CCP/IPConnect object mismatch",
      human: "A service is receiving callpoint IDs or signal objects that do not match active configuration.",
      nextChecks: [
        "Search affected callpoint IDs in IPConnect/CCP.",
        "Verify callpoint objects exist in active config.",
        "Verify signal profiles.",
        "Compare against recent CCP import.",
        "Check for stale integration replay/source mapping.",
      ],
    },
    {
      pattern: "Could not interpret new update",
      classification: "FAILURE",
      rootCause: "Callpoint not defined in CCP",
      human: "IPConnect received a call activation from a controller but could not match it to a defined CCP object.",
      nextChecks: [
        "Identify the callpoint ID.",
        "Fix or remove stale object in CCP.",
        "Re-import/reload configuration as required.",
      ],
    },
    {
      pattern: "WsClient is not ready",
      classification: "SECONDARY_EFFECT",
      rootCause: "Websocket client unavailable",
      human: "Monitoring/event sync is not active because the websocket client is not connected.",
      nextChecks: [
        "Look earlier in logs for SSL, certificate, DNS, or service bind failure.",
      ],
    },
  ],

  capacityRules: {
    cpu: "CPU load average should not exceed 70% of allocated VM CPU.",
    ram: "Combined RAM requirements should not exceed 70% of allocated VM RAM.",
    disk: "Avoid spinning disks; disk I/O and excessive logging can cause timeouts.",
    logging: "Do not leave DEBUG/TRACE logging enabled in production.",
    vmware: "VMware ESXi 6.7 or later is recommended; PC-based virtualization is not supported.",
  },

  deploymentRules: [
    {
      rule: "Floor Controller VM should only run IPConnect Server and ADX/DES where applicable.",
      reason: "Do not install integrations/core services on Floor Controller VM.",
    },
    {
      rule: "Integration Server VM should not run IPConnect.",
      reason: "Only integrations/core components should run on Integration Server VM.",
    },
    {
      rule: "Pulse Manage should preferably be alone or only with non-database/no-host-dependent components.",
      reason: "Re-image/host ID changes can damage licensing or local databases.",
    },
    {
      rule: "License Service should preferably be alone or only with safe components.",
      reason: "Host ID changes can invalidate licensing.",
    },
    {
      rule: "Integration Gateway is a central component and heavy CPU/RAM consumer.",
      reason: "Avoid overloading shared VM.",
    },
    {
      rule: "Pulse Gateway is central and should not compete with many components for CPU/RAM.",
      reason: "Resource contention can cause runtime instability.",
    },
  ],

  componentRoles: {
    "IP-Connect": "Routing/configuration truth for nurse call events.",
    "Integration Gateway": "Integration/event middleware; often evidence holder for invalid/stale objects.",
    "Pulse Gateway": "Pulse runtime gateway; can show downstream symptoms.",
    "Pulse Manage": "Central config/orchestration component.",
    "License Service": "Licensing validation; host ID sensitive.",
    "RTLS Gateway": "RTLS/badge/location workflow layer.",
    "HL7": "Patient/resident/name integration layer.",
    "Mobile Gateway": "Pulse Mobile server-side gateway.",
    "Nurse Station": "UI/client endpoint layer; usually downstream unless direct app failure exists.",
    "Annunciator": "Display/notification endpoint layer.",
    "Controller": "Hardware/network truth for room/callpoint layer.",
    "Switch": "PoE/VLAN/link truth.",
  },
};

export function classifyTaceraLine(line = "") {
  const raw = String(line);

  for (const item of TACERA_KNOWLEDGE_BASE.criticalPatterns) {
    if (raw.includes(item.pattern)) {
      return {
        classification: item.classification,
        pattern: item.pattern,
        rootCause: item.rootCause,
        human: item.human,
        nextChecks: item.nextChecks || [],
      };
    }
  }

  for (const item of TACERA_KNOWLEDGE_BASE.ignoredLogPatterns) {
    if (raw.includes(item.pattern)) {
      return {
        classification: item.classification,
        pattern: item.pattern,
        rootCause: "Known ignorable Tacera message",
        human: item.reason,
        nextChecks: [],
      };
    }
  }

  return {
    classification: "UNKNOWN",
    pattern: null,
    rootCause: null,
    human: null,
    nextChecks: [],
  };
}

export function buildHumanDiagnosisFromLines(lines = []) {
  const classified = lines.map((line, index) => ({
    index,
    line,
    ...classifyTaceraLine(line),
  }));

  const critical = classified.filter(x => ["CRITICAL", "FAILURE"].includes(x.classification));
  const secondary = classified.filter(x => x.classification === "SECONDARY_EFFECT");
  const ignored = classified.filter(x => x.classification.startsWith("IGNORE"));

  let finalAnswer = "Insufficient evidence to identify a confirmed root cause.";
  let simpleExplanation = "The logs did not contain a deterministic failure pattern yet.";
  let rootCause = null;
  let confidence = 0;

  const certIssue = critical.find(x =>
    x.pattern === "CertificateExpiredException" ||
    x.pattern === "PKIX path validation failed" ||
    x.pattern === "SSLHandshakeException"
  );

  const invalidCallpoint = critical.find(x =>
    x.pattern === "Invalid call point ID or signal attributes" ||
    x.pattern === "Could not interpret new update"
  );

  if (certIssue) {
    rootCause = "Expired or untrusted TLS certificate causing websocket/HTTPS failure";
    finalAnswer = "Certificate/trust failure is the most likely reason the service keeps failing.";
    simpleExplanation =
      "A secure websocket/HTTPS connection is failing because Java does not trust the certificate. The logs show certificate expiration or PKIX trust failure. Fix the certificate/trust chain before blaming IPConnect, Pulse, or controllers.";
    confidence = 0.95;
  } else if (invalidCallpoint) {
    rootCause = "Invalid/stale callpoint mapping or CCP/IPConnect object mismatch";
    finalAnswer = "Invalid/stale callpoint mapping is the most likely issue.";
    simpleExplanation =
      "The system is receiving callpoint IDs or signal objects that do not match active configuration. Check CCP/IPConnect mapping before restarting Pulse or unrelated services.";
    confidence = 0.9;
  }

  const nextSteps = Array.from(new Set(critical.flatMap(x => x.nextChecks || []))).slice(0, 12);

  return {
    finalAnswer,
    rootCause,
    confidence,
    simpleExplanation,
    whatHappenedFirst: critical[0]?.line || null,
    criticalEvidence: critical.slice(0, 20),
    secondaryEffects: secondary.slice(0, 20),
    ignoredNoise: ignored.slice(0, 30),
    nextSteps,
    doNotDo: [
      "Do not reboot all VMs first.",
      "Do not restart unrelated middleware without evidence.",
      "Do not replace controllers/displays until configuration and certificate evidence is checked.",
      "Do not treat known ignorable startup warnings as root cause.",
    ],
    developerProof: {
      criticalPatterns: critical.map(x => x.pattern).filter(Boolean),
      ignoredPatterns: ignored.map(x => x.pattern).filter(Boolean),
      evidenceLines: critical.slice(0, 50).map(x => x.line),
      sourceDocs: TACERA_KNOWLEDGE_BASE.sourceDocs,
    },
  };
}
