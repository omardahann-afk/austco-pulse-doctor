/**
 * Deterministic remediation playbooks. Each playbook decides:
 *   - matches(ctx) — does the detected issue look like this problem?
 *   - build(ctx)   — produce a remediation plan (actions reference template ids)
 *
 * Playbooks NEVER produce raw shell strings. They reference template ids
 * resolved by sshExecutor.resolveCommand(...) at execution time.
 *
 * Risk levels:
 *   LOW    — read-only check
 *   MEDIUM — restart of an allowlisted service / container
 *   HIGH   — config/cert/CCP/db change. Always blocked from automatic fix.
 */

const SYSTEMD_BY_ROLE = {
  "Integration Gateway":   ["inga", "integration-gateway"],
  "Pulse Gateway":         ["pulse-gateway"],
  "Pulse Manage":          ["pulse-manage"],
  "License Service":       ["license-service"],
  "MQTT Broker":           ["mosquitto"],
  "WebSocket MQTT Adapter":["websocket-adapter"],
  "IPConnect":             ["ipconnect"],
  "RTLS Gateway":          ["rtls-gateway"],
  "HL7":                   ["hl7"],
  "File Server":           ["file-server"],
  "Mobile Gateway":        ["mobile-gateway"],
};

const DOCKER_BY_ROLE = {
  "Integration Gateway":   ["inga", "integration-gateway"],
  "Pulse Gateway":         ["pulse-gateway"],
  "MQTT Broker":           ["mqtt-broker"],
  "WebSocket MQTT Adapter":["websocket-adapter"],
  "License Service":       ["license-service"],
};

function pickAllowed(candidates, allowlist) {
  for (const name of candidates) if (allowlist.includes(name)) return name;
  return null;
}

function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }

function readChecks(role) {
  return [
    { id: uid("act"), label: "Hostname", templateId: "hostname", params: {}, risk: "LOW", verifyTemplateId: null },
    { id: uid("act"), label: "Disk usage", templateId: "df", params: {}, risk: "LOW", verifyTemplateId: null },
    { id: uid("act"), label: "Memory", templateId: "free", params: {}, risk: "LOW", verifyTemplateId: null },
  ];
}

/* ===== Playbooks ===== */

/** 1. SERVICE DOWN — host reachable, expected service port closed, logs show service not responding. */
const ServiceDown = {
  id: "service_down",
  title: "Service down",
  matches(ctx) {
    const s = ctx.serviceResult;
    if (!s) return false;
    const portClosed = s.steps?.some((st) => /^tcp:/i.test(st.name) && st.status === "FAIL");
    const reachable = s.steps?.some((st) => st.name === "ping" && st.status === "PASS")
                   || s.steps?.some((st) => st.name === "ssh" && st.status === "PASS");
    return Boolean(portClosed && reachable);
  },
  build(ctx) {
    const role = ctx.serviceResult.role;
    const systemd = pickAllowed(SYSTEMD_BY_ROLE[role] || [], ctx.allowlist.systemd);
    const docker  = pickAllowed(DOCKER_BY_ROLE[role]  || [], ctx.allowlist.docker);
    const actions = [...readChecks(role)];
    if (systemd) {
      actions.push({ id: uid("act"), label: `systemctl status ${systemd}`, templateId: "systemctl_status", params: { unit: systemd }, risk: "LOW" });
      actions.push({
        id: uid("act"),
        label: `Restart ${systemd}`,
        templateId: "systemctl_restart",
        params: { unit: systemd },
        risk: "MEDIUM",
        verifyTemplateId: "systemctl_is_active",
        verifyParams: { unit: systemd },
        verifyExpect: /^active$/m,
      });
    } else if (docker) {
      actions.push({ id: uid("act"), label: "docker ps", templateId: "docker_ps", params: {}, risk: "LOW" });
      actions.push({
        id: uid("act"),
        label: `Restart container ${docker}`,
        templateId: "docker_restart",
        params: { container: docker },
        risk: "MEDIUM",
        verifyTemplateId: "docker_ps",
        verifyParams: {},
        verifyExpect: new RegExp(`\\b${docker}\\b.*Up\\b`),
      });
    } else {
      actions.push({ id: uid("act"), label: "ss -tulpn", templateId: "ss_ports", params: {}, risk: "LOW" });
    }
    return {
      issueType: "SERVICE_DOWN",
      summary: `${role} appears down — service port closed while host is reachable.`,
      riskLevel: systemd || docker ? "MEDIUM" : "LOW",
      requiresApproval: true,
      actions,
      rollbackAvailable: false,
    };
  },
};

/** 2. WEBMIN DOWN — Integration Gateway host reachable, port 10000 closed. */
const WebminDown = {
  id: "webmin_down",
  title: "Webmin down",
  matches(ctx) {
    const s = ctx.serviceResult;
    if (!s) return false;
    const reachable = s.steps?.some((st) => st.name === "ping" && st.status === "PASS")
                   || s.steps?.some((st) => st.name === "ssh" && st.status === "PASS");
    const findings = (s.parsedLogs || []).flatMap((p) => p.findings || []);
    const webminClue = findings.some((f) => /webmin|miniserv|10000/i.test(f.raw || f.message || ""));
    // Heuristic: only fire on the gateway role, OR when logs explicitly mention webmin.
    return reachable && (webminClue || /Integration Gateway|Pulse Manage/.test(s.role));
  },
  build(ctx) {
    const unit = pickAllowed(["webmin", "miniserv"], ctx.allowlist.systemd);
    const actions = [
      { id: uid("act"), label: "Test port 10000", templateId: "test_port", params: { port: 10000 }, risk: "LOW" },
    ];
    if (unit) {
      actions.push({ id: uid("act"), label: `systemctl status ${unit}`, templateId: "systemctl_status", params: { unit }, risk: "LOW" });
      actions.push({
        id: uid("act"), label: `Restart ${unit}`, templateId: "systemctl_restart", params: { unit }, risk: "MEDIUM",
        verifyTemplateId: "test_port", verifyParams: { port: 10000 }, verifyExpect: /open/,
      });
    }
    return {
      issueType: "WEBMIN_DOWN",
      summary: "Webmin port 10000 closed while host reachable.",
      riskLevel: unit ? "MEDIUM" : "LOW",
      requiresApproval: true,
      actions,
      rollbackAvailable: false,
    };
  },
};

/** 3. DISK FULL — df > 90% on host. Diagnostic only — never auto-deletes. */
const DiskFull = {
  id: "disk_full",
  title: "Disk usage critical",
  matches(ctx) {
    const findings = (ctx.serviceResult?.parsedLogs || []).flatMap((p) => p.findings || []);
    return findings.some((f) => /no space left on device|disk full/i.test(f.raw || f.message || ""));
  },
  build() {
    return {
      issueType: "DISK_FULL",
      summary: "Disk pressure detected. Scan only — deletion is high-risk and blocked.",
      riskLevel: "LOW",
      requiresApproval: true,
      actions: [
        { id: uid("act"), label: "df -h", templateId: "df", params: {}, risk: "LOW" },
        { id: uid("act"), label: "Memory snapshot", templateId: "free", params: {}, risk: "LOW" },
      ],
      rollbackAvailable: false,
      manualNotes: ["Deletion of logs/files is HIGH risk and must be performed manually."],
    };
  },
};

/** 4. ERROR STORM — same error signature repeats. */
const ErrorStorm = {
  id: "error_storm",
  title: "Repeating error storm",
  matches(ctx) {
    const findings = (ctx.serviceResult?.parsedLogs || []).flatMap((p) => p.findings || []);
    if (findings.length < 20) return false;
    const counts = new Map();
    for (const f of findings) {
      const key = (f.message || f.type || "").slice(0, 80);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.values()).some((c) => c >= 15);
  },
  build(ctx) {
    const role = ctx.serviceResult.role;
    const systemd = pickAllowed(SYSTEMD_BY_ROLE[role] || [], ctx.allowlist.systemd);
    const docker  = pickAllowed(DOCKER_BY_ROLE[role]  || [], ctx.allowlist.docker);
    const actions = [];
    if (systemd) actions.push({ id: uid("act"), label: `journalctl ${systemd} (last 100)`, templateId: "journalctl", params: { unit: systemd }, risk: "LOW" });
    if (docker)  actions.push({ id: uid("act"), label: `docker logs ${docker} (last 100)`, templateId: "docker_logs", params: { container: docker }, risk: "LOW" });
    if (!actions.length) actions.push({ id: uid("act"), label: "Disk usage", templateId: "df", params: {}, risk: "LOW" });
    if (systemd) {
      actions.push({
        id: uid("act"), label: `Restart ${systemd}`, templateId: "systemctl_restart", params: { unit: systemd }, risk: "MEDIUM",
        verifyTemplateId: "systemctl_is_active", verifyParams: { unit: systemd }, verifyExpect: /^active$/m,
      });
    }
    return {
      issueType: "ERROR_STORM",
      summary: `${role} is emitting a repeating error signature.`,
      riskLevel: systemd ? "MEDIUM" : "LOW",
      requiresApproval: true,
      actions,
      rollbackAvailable: false,
    };
  },
};

/** 5. CERTIFICATE ISSUE — TLS/cert errors in logs. Scan only. */
const CertIssue = {
  id: "cert_issue",
  title: "Certificate / TLS issue",
  matches(ctx) {
    const findings = (ctx.serviceResult?.parsedLogs || []).flatMap((p) => p.findings || []);
    return findings.some((f) => /(certificate|ssl|tls|x509|expired)/i.test(f.message || f.raw || ""));
  },
  build() {
    return {
      issueType: "CERT_ISSUE",
      summary: "Certificate or TLS error detected. Replacement is HIGH risk and blocked.",
      riskLevel: "LOW",
      requiresApproval: true,
      actions: [
        { id: uid("act"), label: "Hostname", templateId: "hostname", params: {}, risk: "LOW" },
      ],
      rollbackAvailable: false,
      manualNotes: ["Certificate replacement is HIGH risk. Perform manually with the customer's PKI process."],
    };
  },
};

/** 6. LICENSE ISSUE — license expired/invalid. */
const LicenseIssue = {
  id: "license_issue",
  title: "License invalid / expired",
  matches(ctx) {
    if (ctx.serviceResult?.role !== "License Service") {
      const findings = (ctx.serviceResult?.parsedLogs || []).flatMap((p) => p.findings || []);
      return findings.some((f) => /licen[sc]e (invalid|expired|missing|denied)/i.test(f.message || f.raw || ""));
    }
    return ctx.serviceResult.status === "FAIL" || ctx.serviceResult.status === "WARN";
  },
  build(ctx) {
    const unit = pickAllowed(["license-service"], ctx.allowlist.systemd);
    const actions = [
      { id: uid("act"), label: "License service status", templateId: "systemctl_status", params: { unit: unit || "license-service" }, risk: "LOW" },
    ];
    if (unit) {
      actions.push({
        id: uid("act"), label: "Restart license-service", templateId: "systemctl_restart", params: { unit }, risk: "MEDIUM",
        verifyTemplateId: "systemctl_is_active", verifyParams: { unit }, verifyExpect: /^active$/m,
      });
    }
    return {
      issueType: "LICENSE_ISSUE",
      summary: "License error detected. Restart of license service may clear transient errors. License file is NOT modified.",
      riskLevel: unit ? "MEDIUM" : "LOW",
      requiresApproval: true,
      actions,
      rollbackAvailable: false,
      manualNotes: ["License file replacement is HIGH risk and must be performed manually."],
    };
  },
};

/** 7. MQTT BROKER DOWN — MQTT port closed or disconnect loop. */
const MqttDown = {
  id: "mqtt_down",
  title: "MQTT broker down",
  matches(ctx) {
    const s = ctx.serviceResult;
    if (!s || s.role !== "MQTT Broker") return false;
    const portClosed = s.steps?.some((st) => /^tcp:/i.test(st.name) && st.status === "FAIL");
    return Boolean(portClosed) || s.status === "FAIL";
  },
  build(ctx) {
    const unit = pickAllowed(["mosquitto"], ctx.allowlist.systemd);
    const docker = pickAllowed(["mqtt-broker"], ctx.allowlist.docker);
    const actions = [
      { id: uid("act"), label: "Test MQTT port 1883", templateId: "test_port", params: { port: 1883 }, risk: "LOW" },
      { id: uid("act"), label: "Test MQTT TLS port 8883", templateId: "test_port", params: { port: 8883 }, risk: "LOW" },
    ];
    if (unit) {
      actions.push({
        id: uid("act"), label: `Restart ${unit}`, templateId: "systemctl_restart", params: { unit }, risk: "MEDIUM",
        verifyTemplateId: "test_port", verifyParams: { port: 1883 }, verifyExpect: /open/,
      });
    } else if (docker) {
      actions.push({
        id: uid("act"), label: `Restart container ${docker}`, templateId: "docker_restart", params: { container: docker }, risk: "MEDIUM",
        verifyTemplateId: "test_port", verifyParams: { port: 1883 }, verifyExpect: /open/,
      });
    }
    return {
      issueType: "MQTT_DOWN",
      summary: "MQTT broker port closed or service down.",
      riskLevel: unit || docker ? "MEDIUM" : "LOW",
      requiresApproval: true,
      actions,
      rollbackAvailable: false,
    };
  },
};

export const PLAYBOOKS = [
  WebminDown, MqttDown, LicenseIssue, ServiceDown, ErrorStorm, DiskFull, CertIssue,
];

/**
 * Match a service result against all playbooks. Returns the first playbook
 * whose matches() returns true, or null.
 */
export function matchPlaybook(serviceResult, allowlist) {
  const ctx = { serviceResult, allowlist };
  for (const pb of PLAYBOOKS) {
    try { if (pb.matches(ctx)) return pb; } catch { /* ignore playbook errors */ }
  }
  return null;
}