import type { DiagnosticResult, SiteConfig } from "./types";

export function buildEscalationSummary(result: DiagnosticResult, config: SiteConfig): string {
  const lines: string[] = [];
  lines.push("AUSTCO SITE DOCTOR — ESCALATION SUMMARY");
  lines.push("==========================================");
  lines.push(`Site:        ${result.siteName}`);
  lines.push(`Technician:  ${config.technician}`);
  lines.push(`Scan time:   ${new Date(result.scanTime).toLocaleString()}`);
  lines.push(`Laptop IP:   ${config.laptopIp}`);
  lines.push(`Server IPs:  Primary 10.20.1.10 / Secondary 10.20.1.11 / VIP 10.20.1.12`);
  lines.push(`VIP owner:   Primary (Active)`);
  lines.push("");
  lines.push(`Summary:     ${result.summary.healthy} healthy / ${result.summary.warnings} warnings / ${result.summary.critical} critical / ${result.summary.offline} offline`);
  lines.push("");
  lines.push("FAILED MODULES");
  lines.push("--------------");
  result.modules
    .filter((m) => m.status === "Failed" || m.status === "Warning")
    .forEach((m) => {
      lines.push(`[${m.status.toUpperCase()}] ${m.name}`);
      m.findings.forEach((f) => lines.push(`   - ${f}`));
    });
  lines.push("");
  lines.push("ROOT CAUSE RANKING");
  lines.push("------------------");
  result.rootCauseRanking.forEach((iss, i) => {
    lines.push(`${i + 1}. [${iss.severity}/${iss.confidence}] ${iss.title}`);
    lines.push(`   Module: ${iss.module}`);
    if (iss.affectedDevice) lines.push(`   Affected: ${iss.affectedDevice} (${iss.affectedIp ?? "n/a"})`);
    lines.push(`   Likely cause: ${iss.likelyRootCause}`);
    lines.push(`   Evidence:`);
    iss.evidence.forEach((e) => lines.push(`     - ${e}`));
    lines.push(`   Recommended:`);
    iss.recommendedSteps.forEach((s) => lines.push(`     - ${s}`));
    lines.push(`   Escalation: ${iss.escalationRecommendation}`);
    lines.push("");
  });
  lines.push("EVENT TRACE");
  lines.push("-----------");
  result.events.forEach((e) => {
    lines.push(`[${new Date(e.timestamp).toLocaleTimeString()}] ${e.eventType.padEnd(9)} ${e.status.padEnd(8)} ${e.room.padEnd(22)} ${e.sourceDevice} → ${e.targetDevice ?? "—"}`);
    lines.push(`   ${e.details}`);
  });
  lines.push("");
  lines.push("--- end of report ---");
  return lines.join("\n");
}