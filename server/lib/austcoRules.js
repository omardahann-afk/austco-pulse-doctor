/**
 * Austco / Tacera deterministic diagnosis rule engine.
 * No AI, no heuristics beyond explicit rules below.
 *
 * Inputs come from real evidence only:
 *   - deviceResults  : output of runDiagnosis (per-device ping/DNS/TCP)
 *   - serviceResults : per-service results from diagnoseService()
 *   - parsedLogs     : flattened parsed log files (per-service)
 *
 * Output shape:
 *   {
 *     mode: "REAL DIAGNOSIS",
 *     breakFoundAt, primaryCause, confidence (0-100), confidenceReasons[],
 *     evidence[], fixActions[], affectedServices[], traceSteps[], warnings[]
 *   }
 */

const FINDING_TYPES = new Set([
  "TIMEOUT", "CONNECTION_REFUSED", "DISCONNECT", "RECONNECT",
  "AUTH_FAILURE", "CERTIFICATE_ERROR", "LICENSE_ERROR",
  "MQTT_EVENT", "WEBSOCKET_EVENT", "GENERIC_ERROR",
]);

function pushUnique(arr, value) {
  if (value && !arr.includes(value)) arr.push(value);
}

function severityRank(t) {
  // ERROR-class signals
  if (["LICENSE_ERROR", "CERTIFICATE_ERROR", "AUTH_FAILURE", "CONNECTION_REFUSED", "TIMEOUT"].includes(t)) return 3;
  if (["DISCONNECT", "GENERIC_ERROR"].includes(t)) return 2;
  return 1;
}

function summarizeFindings(parsedLogs) {
  // map: serviceName -> { typeCounts, samples: { type: [LogFinding...] }, paths: Set, role }
  const byService = new Map();
  for (const p of parsedLogs || []) {
    if (!p || !p.ok) continue;
    const svcName = p.serviceName || p.service || "unknown";
    let s = byService.get(svcName);
    if (!s) {
      s = { name: svcName, role: p.role || "", typeCounts: {}, samples: {}, paths: new Set() };
      byService.set(svcName, s);
    }
    s.paths.add(p.path);
    if (p.role && !s.role) s.role = p.role;
    for (const f of p.findings || []) {
      const t = f.type || "GENERIC_ERROR";
      s.typeCounts[t] = (s.typeCounts[t] || 0) + 1;
      if (!s.samples[t]) s.samples[t] = [];
      if (s.samples[t].length < 3) s.samples[t].push(f);
    }
  }
  return byService;
}

function findServicesWithType(byService, type) {
  const hits = [];
  for (const s of byService.values()) {
    if (s.typeCounts[type]) hits.push(s);
  }
  return hits;
}

function findServicesByRoleAndError(byService, roleNeedle) {
  const hits = [];
  for (const s of byService.values()) {
    const matchesRole = (s.role || s.name || "").toLowerCase().includes(roleNeedle.toLowerCase());
    if (!matchesRole) continue;
    const total = Object.values(s.typeCounts).reduce((a, b) => a + b, 0);
    if (total > 0) hits.push(s);
  }
  return hits;
}

function evidenceLinesFromSamples(svc, types) {
  const lines = [];
  for (const t of types) {
    for (const f of svc.samples[t] || []) {
      const ts = f.timestamp ? `${f.timestamp} ` : "";
      lines.push(`[${svc.name}] ${ts}${t}: ${(f.raw || f.message || "").trim().slice(0, 300)}`);
    }
  }
  return lines;
}

function buildTraceSteps({ siteConfig, deviceResults, serviceResults }) {
  const steps = [];

  for (const d of deviceResults || []) {
    steps.push({
      label: d.name || d.role || "Device",
      role: d.role || "Device",
      status: d.status || "NOT VERIFIED",
      evidence: [d.message || ""].filter(Boolean),
      source: "REAL TEST",
    });
  }

  for (const s of serviceResults || []) {
    let status = s.status || "NOT VERIFIED";
    if (status === "UNKNOWN") status = "NOT VERIFIED";
    const ev = [];
    if (s.message) ev.push(s.message);
    if (s.parsed && (s.parsed.totalErrors || s.parsed.totalWarnings)) {
      ev.push(`logs: ${s.parsed.totalErrors} errors, ${s.parsed.totalWarnings} warnings`);
    }
    const usedLogs = (s.parsedLogs || []).some((p) => p.ok);
    steps.push({
      label: s.name || s.role || "Service",
      role: s.role || "Service",
      status,
      evidence: ev,
      source: usedLogs ? "PULLED LOG" : "REAL TEST",
    });
  }
  return steps;
}

function emptyResult(extra = {}) {
  return {
    mode: "REAL DIAGNOSIS",
    breakFoundAt: "No confirmed break",
    primaryCause: "No confirmed root cause from available evidence",
    confidence: 10,
    confidenceReasons: ["Insufficient evidence — no failing tests and no error log lines."],
    evidence: [],
    fixActions: [
      "Pull additional logs (enable more services or add log paths).",
      "Add more device/service IPs to broaden coverage.",
      "Verify the issue can be reproduced on-site, then re-run diagnosis.",
    ],
    affectedServices: [],
    traceSteps: [],
    warnings: [],
    ...extra,
  };
}

export function buildAustcoDiagnosis({ siteConfig = {}, deviceResults = [], serviceResults = [], parsedLogs = [] } = {}) {
  // Normalize parsedLogs to include serviceName/role from serviceResults if not present
  const flatLogs = [];
  for (const s of serviceResults || []) {
    for (const p of s.parsedLogs || []) {
      flatLogs.push({ ...p, serviceName: s.name, role: s.role });
    }
  }
  for (const p of parsedLogs || []) flatLogs.push(p);

  const byService = summarizeFindings(flatLogs);
  const traceSteps = buildTraceSteps({ siteConfig, deviceResults, serviceResults });
  const warnings = [];
  for (const d of deviceResults || []) if (d.status === "WARN" && d.message) warnings.push(`${d.name}: ${d.message}`);
  for (const s of serviceResults || []) if (s.status === "WARN" && s.message) warnings.push(`${s.name}: ${s.message}`);

  // -------- Rule 1: Network reachability --------
  const netFails = [];
  for (const d of deviceResults || []) {
    if (d.ping && d.ping.performed && !d.ping.reachable) netFails.push({ kind: "device", item: d });
  }
  for (const s of serviceResults || []) {
    const pingStep = (s.steps || []).find((st) => st.name === "ping");
    if (pingStep && pingStep.status === "FAIL") netFails.push({ kind: "service", item: s });
  }
  if (netFails.length > 0) {
    const first = netFails[0].item;
    const evidence = netFails.slice(0, 5).map((f) => {
      const x = f.item;
      const host = x.ip || x.host || x.hostname || "(no host)";
      const raw = x.ping?.raw ? `\n${(x.ping.raw || "").trim().slice(0, 400)}` : "";
      return `[${x.name}] (${x.role}) ping ${host} → unreachable${raw}`;
    });
    const reasons = [`${netFails.length} device/service failed ping from the diagnostic VM.`];
    if (netFails.length >= 2) reasons.push("Multiple unreachable hosts → network/VLAN-level fault is likely.");
    const confidence = netFails.length >= 2 ? 90 : 70;
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "Network reachability",
      primaryCause: `${first.name || first.role} is unreachable from the diagnostic VM`,
      confidence,
      confidenceReasons: reasons,
      evidence,
      fixActions: [
        `Confirm IP address for ${first.name || first.role} (${first.ip || first.host || first.hostname || "n/a"}).`,
        "Confirm VLAN/routing between the diagnostic VM and the target.",
        "Check switch port, uplink, and device power/link state.",
      ],
      affectedServices: netFails.map((f) => f.item.name).filter(Boolean),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 2: SSH/SFTP access failures --------
  const sshFails = [];
  for (const s of serviceResults || []) {
    if (s.connection === "failed") {
      const portStep = (s.steps || []).find((st) => st.name && st.name.startsWith("tcp:"));
      const authStep = (s.steps || []).find((st) => st.name === "ssh_auth");
      const portClosed = portStep && portStep.status === "FAIL";
      const authBad = authStep && authStep.status === "FAIL";
      if (portClosed || authBad) sshFails.push({ svc: s, portClosed, authBad, portStep, authStep });
    }
  }
  if (sshFails.length > 0) {
    const first = sshFails[0];
    const reasons = [];
    if (first.authBad) reasons.push("SSH authentication failed with provided credentials.");
    if (first.portClosed) reasons.push(`Port ${first.svc.port || 22} closed/blocked on target.`);
    if (sshFails.length >= 2) reasons.push(`${sshFails.length} services share the same SSH access problem.`);
    const evidence = sshFails.slice(0, 5).flatMap(({ svc, portStep, authStep }) => {
      const e = [];
      if (portStep) e.push(`[${svc.name}] tcp:${svc.port || 22} → ${portStep.status} — ${portStep.detail}`);
      if (authStep) e.push(`[${svc.name}] ssh_auth → ${authStep.status} — ${authStep.detail}`);
      return e;
    });
    const confidence = (sshFails.length >= 2 ? 85 : 70);
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "Server access / SSH-SFTP",
      primaryCause: "Server reachable, but log access failed",
      confidence,
      confidenceReasons: reasons,
      evidence,
      fixActions: [
        `Verify SSH service is running on ${first.svc.host}:${first.svc.port || 22}.`,
        "Verify the tech credentials (username/password) for this VM.",
        `Confirm host firewall/VLAN allows port ${first.svc.port || 22} from the diagnostic VM.`,
      ],
      affectedServices: sshFails.map((x) => x.svc.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 3: License failure --------
  const licenseHits = findServicesWithType(byService, "LICENSE_ERROR");
  if (licenseHits.length > 0) {
    const total = licenseHits.reduce((s, x) => s + x.typeCounts.LICENSE_ERROR, 0);
    const reasons = [`${total} LICENSE_ERROR line(s) across ${licenseHits.length} service log(s).`];
    if (licenseHits.some((s) => /license/i.test(s.role || s.name))) reasons.push("Originates in License Service logs.");
    const confidence = (licenseHits.length >= 2 || total >= 3) ? 90 : 75;
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "License Service",
      primaryCause: "License failure detected in logs",
      confidence,
      confidenceReasons: reasons,
      evidence: licenseHits.flatMap((s) => evidenceLinesFromSamples(s, ["LICENSE_ERROR"])),
      fixActions: [
        "Verify license status on the License Service VM.",
        "Restart the license service if appropriate after capturing current state.",
        "Escalate to licensing with the captured log evidence.",
      ],
      affectedServices: licenseHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 4: Certificate / TLS --------
  const certHits = findServicesWithType(byService, "CERTIFICATE_ERROR");
  if (certHits.length > 0) {
    const total = certHits.reduce((s, x) => s + x.typeCounts.CERTIFICATE_ERROR, 0);
    const reasons = [`${total} CERTIFICATE_ERROR line(s) across ${certHits.length} service log(s).`];
    const vpnish = certHits.some((s) => /vpn|ipconnect|pulse/i.test(s.role || s.name));
    if (vpnish) reasons.push("Affects OpenVPN / IPConnect / Pulse — TLS chain likely impacted.");
    const confidence = (certHits.length >= 2 || total >= 3) ? 85 : 70;
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "Certificate / TLS",
      primaryCause: "Certificate or TLS failure detected",
      confidence,
      confidenceReasons: reasons,
      evidence: certHits.flatMap((s) => evidenceLinesFromSamples(s, ["CERTIFICATE_ERROR"])),
      fixActions: [
        "Check certificate expiry and validity on the affected service host.",
        "Validate OpenVPN / Pulse certificate paths and CA chain.",
        "Renew or replace the certificate, then restart the dependent service.",
      ],
      affectedServices: certHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 5: Auth failure (in logs) --------
  const authLogHits = findServicesWithType(byService, "AUTH_FAILURE");
  if (authLogHits.length > 0) {
    const total = authLogHits.reduce((s, x) => s + x.typeCounts.AUTH_FAILURE, 0);
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "Application authentication",
      primaryCause: "Authentication failures detected in service logs",
      confidence: total >= 3 ? 80 : 60,
      confidenceReasons: [`${total} AUTH_FAILURE line(s) across ${authLogHits.length} service log(s).`],
      evidence: authLogHits.flatMap((s) => evidenceLinesFromSamples(s, ["AUTH_FAILURE"])),
      fixActions: [
        "Verify the application credentials used by the affected service.",
        "Check upstream identity provider / token issuer availability.",
        "Review recent credential or secret rotations.",
      ],
      affectedServices: authLogHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 6: Service failure (CONNECTION_REFUSED) --------
  const refusedHits = findServicesWithType(byService, "CONNECTION_REFUSED");
  if (refusedHits.length > 0) {
    const total = refusedHits.reduce((s, x) => s + x.typeCounts.CONNECTION_REFUSED, 0);
    const ipconnect = refusedHits.find((s) => /ipconnect|xcare/i.test(s.role || s.name));
    const breakAt = ipconnect ? "IPConnect" : "Application service";
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: breakAt,
      primaryCause: "Service is reachable but refusing connections",
      confidence: total >= 3 ? 85 : 65,
      confidenceReasons: [`${total} CONNECTION_REFUSED line(s) across ${refusedHits.length} service log(s).`],
      evidence: refusedHits.flatMap((s) => evidenceLinesFromSamples(s, ["CONNECTION_REFUSED"])),
      fixActions: [
        `Check ${breakAt} service status (active/listening) on the host.`,
        "Restart the affected service after capturing current state.",
        "Review local firewall and bind-address configuration.",
      ],
      affectedServices: refusedHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 7: Repeated TIMEOUT --------
  const timeoutHits = findServicesWithType(byService, "TIMEOUT");
  if (timeoutHits.length > 0) {
    const total = timeoutHits.reduce((s, x) => s + x.typeCounts.TIMEOUT, 0);
    if (total >= 2) {
      const pulse = timeoutHits.find((s) => /pulse/i.test(s.role || s.name));
      const breakAt = pulse ? "Pulse Gateway" : "Service timeout";
      return {
        mode: "REAL DIAGNOSIS",
        breakFoundAt: breakAt,
        primaryCause: "Repeated timeout events detected",
        confidence: total >= 5 ? 85 : 70,
        confidenceReasons: [`${total} TIMEOUT line(s) across ${timeoutHits.length} service log(s).`],
        evidence: timeoutHits.flatMap((s) => evidenceLinesFromSamples(s, ["TIMEOUT"])),
        fixActions: [
          "Check network latency between the affected service and its dependencies.",
          "Check service load (CPU/memory) on the host.",
          "Verify downstream dependency health (DB, broker, gateway).",
        ],
        affectedServices: timeoutHits.map((s) => s.name),
        traceSteps,
        warnings,
      };
    }
  }

  // -------- Rule 8: MQTT / WebSocket --------
  const mqttHits = findServicesWithType(byService, "MQTT_EVENT");
  const wsHits = findServicesWithType(byService, "WEBSOCKET_EVENT");
  if (mqttHits.length + wsHits.length > 0) {
    const all = [...new Map([...mqttHits, ...wsHits].map((s) => [s.name, s])).values()];
    const total = all.reduce((s, x) => s + (x.typeCounts.MQTT_EVENT || 0) + (x.typeCounts.WEBSOCKET_EVENT || 0), 0);
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "MQTT/WebSocket messaging",
      primaryCause: "Messaging layer issue detected",
      confidence: total >= 3 ? 75 : 55,
      confidenceReasons: [`${total} MQTT/WebSocket event line(s) across ${all.length} service log(s).`],
      evidence: all.flatMap((s) => evidenceLinesFromSamples(s, ["MQTT_EVENT", "WEBSOCKET_EVENT"])),
      fixActions: [
        "Verify MQTT broker is running and accepting connections.",
        "Verify the WebSocket MQTT adapter is healthy.",
        "Check broker connectivity and recent broker logs for disconnects.",
      ],
      affectedServices: all.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 9: Integration Gateway role-specific --------
  const igHits = findServicesByRoleAndError(byService, "Integration Gateway");
  if (igHits.length > 0) {
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "Integration Gateway",
      primaryCause: "Integration Gateway log errors detected",
      confidence: 70,
      confidenceReasons: [`Errors in Integration Gateway logs (${igHits.map((s) => s.name).join(", ")}).`],
      evidence: igHits.flatMap((s) => evidenceLinesFromSamples(s, Object.keys(s.samples))),
      fixActions: [
        "Check Integration Gateway service status.",
        "Validate downstream integration endpoints.",
        "Review integration-gateway.log evidence above.",
      ],
      affectedServices: igHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 10: IPConnect role-specific --------
  const ipcHits = findServicesByRoleAndError(byService, "IPConnect");
  if (ipcHits.length > 0) {
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "IPConnect",
      primaryCause: "IPConnect communication/config issue detected",
      confidence: 70,
      confidenceReasons: [`Errors in IPConnect logs (${ipcHits.map((s) => s.name).join(", ")}).`],
      evidence: ipcHits.flatMap((s) => evidenceLinesFromSamples(s, Object.keys(s.samples))),
      fixActions: [
        "Check IPConnect service status on the host.",
        "Validate controller routing/config.",
        "Review xcare00.log evidence above.",
      ],
      affectedServices: ipcHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 11: Pulse Gateway role-specific --------
  const pgHits = findServicesByRoleAndError(byService, "Pulse Gateway");
  if (pgHits.length > 0) {
    return {
      mode: "REAL DIAGNOSIS",
      breakFoundAt: "Pulse Gateway",
      primaryCause: "Pulse Gateway service issue detected",
      confidence: 70,
      confidenceReasons: [`Errors in Pulse Gateway logs (${pgHits.map((s) => s.name).join(", ")}).`],
      evidence: pgHits.flatMap((s) => evidenceLinesFromSamples(s, Object.keys(s.samples))),
      fixActions: [
        "Check Pulse Gateway service status.",
        "Review Pulse Gateway error.log lines above.",
        "Confirm upstream/downstream service connectivity.",
      ],
      affectedServices: pgHits.map((s) => s.name),
      traceSteps,
      warnings,
    };
  }

  // -------- Rule 12: Generic disconnect/reconnect noise --------
  const discHits = findServicesWithType(byService, "DISCONNECT");
  const recHits = findServicesWithType(byService, "RECONNECT");
  if (discHits.length + recHits.length > 0) {
    const total = [...discHits, ...recHits].reduce((s, x) => s + (x.typeCounts.DISCONNECT || 0) + (x.typeCounts.RECONNECT || 0), 0);
    if (total >= 3) {
      const all = [...new Map([...discHits, ...recHits].map((s) => [s.name, s])).values()];
      return {
        mode: "REAL DIAGNOSIS",
        breakFoundAt: "Service connection stability",
        primaryCause: "Repeated disconnect/reconnect cycles detected",
        confidence: 60,
        confidenceReasons: [`${total} DISCONNECT/RECONNECT line(s) across ${all.length} service log(s).`],
        evidence: all.flatMap((s) => evidenceLinesFromSamples(s, ["DISCONNECT", "RECONNECT"])),
        fixActions: [
          "Inspect network stability between affected services and dependencies.",
          "Check service keepalive / session timeout configuration.",
          "Look for upstream broker/gateway restarts in the same timeframe.",
        ],
        affectedServices: all.map((s) => s.name),
        traceSteps,
        warnings,
      };
    }
  }

  // -------- Rule 13: Insufficient evidence --------
  return emptyResult({ traceSteps, warnings });
}
