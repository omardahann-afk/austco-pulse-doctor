import { examineMachine } from "./taceraMachineExaminer.js";
import { scanTaceraLogsOnHost } from "./taceraLogEvidenceScanner.js";

function detectRole(machine = {}, logs = {}) {
  const ports = machine?.ports || [];
  const ssh = machine?.sshReadOnly || [];
  const findings = logs?.findings || [];

  const text = JSON.stringify({ ports, ssh, findings }).toLowerCase();

  if (text.includes("ipconnect")) return "IPConnect";
  if (text.includes("pulse-gateway")) return "Pulse Gateway";
  if (text.includes("integration-gateway")) return "Integration Gateway";
  if (text.includes("license-service")) return "License Service";
  if (text.includes("pulse-manage")) return "Pulse Manage";
  if (text.includes("hl7")) return "HL7";
  if (text.includes("xmlblaster")) return "Tacera Messaging/xmlBlaster";
  if (text.includes("rtls")) return "RTLS";
  if (text.includes("xcare")) return "Tacera Runtime";

  if (ports.some(p => p.port === 3412 && p.open)) {
    return "Possible IPConnect Runtime";
  }

  return "Unknown / Mixed Role";
}

function summarizePorts(machine = {}) {
  return (machine?.ports || [])
    .filter(x => x.open)
    .map(x => x.port);
}

function summarizeLogs(logs = {}) {
  const findings = logs?.findings || [];
  const grouped = {};

  for (const f of findings) {
    grouped[f.id] = (grouped[f.id] || 0) + 1;
  }

  return grouped;
}

export async function generateDiscoveryDossier({
  targets = [],
  sshDefaults = {},
  webminDefaults = {}
}) {
  const vmResults = [];

  for (const target of targets) {
    const host = target.host;

    const machine = await examineMachine({
      host,
      profile: "custom",
      ssh: {
        username: target.ssh?.username || sshDefaults.username || "tech",
        password: target.ssh?.password || sshDefaults.password || "tech",
        port: target.ssh?.port || sshDefaults.port || 22
      },
      webmin: {
        username: target.webmin?.username || webminDefaults.username || "tech",
        password: target.webmin?.password || webminDefaults.password || "tech",
        port: target.webmin?.port || webminDefaults.port || 10000
      },
      includeWebmin: true,
      includeSsh: true
    });

    const logs = await scanTaceraLogsOnHost({
      host,
      profile: "custom",
      ssh: {
        username: target.ssh?.username || sshDefaults.username || "tech",
        password: target.ssh?.password || sshDefaults.password || "tech",
        port: target.ssh?.port || sshDefaults.port || 22
      },
      machine
    });

    vmResults.push({
      host,
      detectedRole: detectRole(machine, logs),
      importantPorts: summarizePorts(machine),
      importantLogSignals: summarizeLogs(logs),
      machine,
      logs
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    siteSummary: {
      totalVMs: vmResults.length,
      detectedRoles: vmResults.map(x => ({
        host: x.host,
        role: x.detectedRole
      }))
    },
    vmResults
  };
}
