import type {
  AustcoDevice,
  DiagnosticIssue,
  DiagnosticModule,
  DiagnosticResult,
  SiteConfig,
} from "./types";
import { mockDevices, mockEvents } from "@/data/mockSite";
import { rankRootCauses } from "./rootCauseEngine";

export const DIAGNOSTIC_MODULES: Omit<DiagnosticModule, "status" | "findings">[] = [
  { id: "m1", name: "Laptop Network Check", description: "IP, gateway, DNS, duplicate IP, subnet reachability" },
  { id: "m2", name: "Switch Discovery", description: "SNMP / LLDP / MAC table / port errors / VLANs" },
  { id: "m3", name: "Server Reachability", description: "Primary, Secondary, VIP ICMP + service ports" },
  { id: "m4", name: "Redundancy / VIP Check", description: "Active owner, replication, split-brain risk" },
  { id: "m5", name: "Pulse Service Check", description: "Core, event, comm, DB, queue, HL7 services" },
  { id: "m6", name: "Database / Event Queue", description: "Backlog, processing rate, dead letters" },
  { id: "m7", name: "CCT Logic Validation", description: "Active/cancel pairs, group/zone, output mapping" },
  { id: "m8", name: "Controller Discovery", description: "Heartbeat, firmware, latency, ack timing" },
  { id: "m9", name: "IP-IN8 Input Analysis", description: "Stuck active, bounce, external contact state" },
  { id: "m10", name: "IP-APP1 Health Check", description: "Heartbeat, session freshness, stuck calls" },
  { id: "m11", name: "Signal / Zone Light Output", description: "Output event vs physical activation" },
  { id: "m12", name: "Event Flow Trace", description: "End-to-end active → cancel → output trace" },
  { id: "m13", name: "Root Cause Ranking", description: "Cross-module evidence correlation" },
  { id: "m14", name: "Escalation Package Builder", description: "Bundle evidence for dev escalation" },
];

function buildIssues(): DiagnosticIssue[] {
  return [
    {
      id: "iss-1",
      title: "Group Signal Lights Not Activating (East Wing)",
      severity: "Critical",
      confidence: "High",
      affectedDevice: "Group Signal Light — East Wing",
      affectedIp: "10.20.7.50",
      module: "Signal / Zone Light Output",
      whatIsHappening:
        "Active calls reach the server and CCT group logic matches East Wing, but the expected group signal light output is not activating in the field.",
      evidence: [
        "Server received active call from Room 230 (evt-1)",
        "CCT group logic matched 'East Wing Signal Lights'",
        "Output event generated and sent to Controller West Wing (evt-2)",
        "No controller acknowledgement received within 5000ms (evt-3)",
        "East-Sw port Gi1/0/18 reports 412 input errors / 88 CRC errors",
        "Controller West Wing latency 38ms / packet loss 4.2%",
      ],
      likelyRootCause:
        "Event delivery path between Pulse server and Controller West Wing is degraded. Switch port errors on the controller uplink are causing dropped output commands and missed acknowledgements.",
      recommendedSteps: [
        "Confirm active server / VIP routing (VIP currently owned by Primary).",
        "Verify Controller West Wing heartbeat and last-seen timestamp.",
        "Inspect East-Sw port Gi1/0/18 — clear counters and re-test under load.",
        "Replace or re-terminate uplink cable to Controller West Wing IDF.",
        "Re-run a Trace This Call after each change and confirm output ack.",
      ],
      escalationRecommendation:
        "Escalate to network team first (port errors). If errors clear and ack still missing, escalate to Austco dev with full event trace and controller logs.",
    },
    {
      id: "iss-2",
      title: "Controller West Wing — Output Not Acknowledged",
      severity: "Critical",
      confidence: "High",
      affectedDevice: "Controller West Wing",
      affectedIp: "10.20.4.22",
      module: "Controller Discovery",
      whatIsHappening:
        "Server generated the output event and addressed it to Controller West Wing, but no acknowledgement was received and the output did not execute.",
      evidence: [
        "Heartbeat last seen 42s ago (threshold 15s)",
        "Latency 38ms vs site baseline 4ms",
        "4.2% packet loss on uplink",
        "Output event evt-2 sent at " + new Date().toISOString(),
        "Ack event evt-3 timed out",
      ],
      likelyRootCause:
        "Communication instability between switch port and controller. Controller may be receiving partial frames and silently dropping output commands.",
      recommendedSteps: [
        "Check controller heartbeat and physical link LED.",
        "Check switch port Gi1/0/18 errors and shut/no-shut if approved.",
        "Confirm controller receives output event via local controller log.",
        "Restart affected controller communication path if approved by site.",
        "Escalate with event trace and controller log if behaviour persists.",
      ],
      escalationRecommendation:
        "Bundle evt-1 through evt-3, controller heartbeat history, and switch port counters. Send to Austco dev as 'Controller Output Ack Failure'.",
    },
    {
      id: "iss-3",
      title: "IP-APP1 Stuck Calls — Nursing Station East",
      severity: "Critical",
      confidence: "High",
      affectedDevice: "IP-APP1 Nursing Station East",
      affectedIp: "10.20.6.30",
      module: "IP-APP1 Health Check",
      whatIsHappening:
        "Calls are cancelled on the server but remain displayed as active on the IP-APP1 nursing station.",
      evidence: [
        "Server cancel event evt-5 logged for Room 214",
        "IP-APP1 last heartbeat ~3 minutes ago (stale)",
        "Cancel push to IP-APP1 (evt-6) failed",
        "Device still shows Room 214 as active",
      ],
      likelyRootCause:
        "IP-APP1 lost its live session with the app communication service and missed the cancel push. Heartbeat staleness confirms session is not being kept alive.",
      recommendedSteps: [
        "Confirm IP-APP1 network connectivity (ping, switch port).",
        "Confirm heartbeat freshness in Pulse app comm service.",
        "Restart app/display communication service if approved.",
        "Re-test cancel event end-to-end after recovery.",
        "Escalate if missed cancel events repeat after restart.",
      ],
      escalationRecommendation:
        "Send heartbeat history, evt-5/evt-6, and IP-APP1 device log to Austco dev as 'IP-APP1 Stale Session — Missed Cancel'.",
    },
    {
      id: "iss-4",
      title: "IP-IN8 Input Held Active — Basement Doors",
      severity: "Warning",
      confidence: "High",
      affectedDevice: "IP-IN8 Access Control — Basement Doors",
      affectedIp: "10.20.5.40",
      module: "IP-IN8 Input Analysis",
      whatIsHappening:
        "Pulse is receiving a continuous active alarm from IP-IN8 Input 3 with no cancel transition.",
      evidence: [
        "Input 3 active continuously since evt-7",
        "No cancel transition observed",
        "Alarm follows external contact closure pattern",
      ],
      likelyRootCause:
        "External access control / fire alarm relay is holding the contact closed. The nurse call system is correctly reflecting that state.",
      recommendedSteps: [
        "Confirm physical contact closure state on IP-IN8 Input 3.",
        "Ask access control / fire contractor to verify their relay output.",
        "Confirm nurse call clears as soon as the external contact opens.",
      ],
      escalationRecommendation:
        "Not an Austco issue — escalate to access control / fire contractor with timestamps.",
    },
    {
      id: "iss-5",
      title: "Pulse Secondary Server Replication Delay",
      severity: "Warning",
      confidence: "High",
      affectedDevice: "Pulse Secondary Server",
      affectedIp: "10.20.1.11",
      module: "Redundancy / VIP Check",
      whatIsHappening:
        "Primary server is healthy and owns the VIP. Secondary is reachable but lagging behind in replication.",
      evidence: [
        "Primary active, VIP owned by Primary",
        "Secondary reachable (1.4ms)",
        "Replication delay ~14s",
        "No split-brain detected",
      ],
      likelyRootCause:
        "Secondary is online but not fully synchronised with primary. Likely transient — monitor before any failover.",
      recommendedSteps: [
        "Verify redundancy service on secondary.",
        "Check replication status and let secondary catch up.",
        "Confirm secondary catches up before any maintenance.",
        "Do NOT force failover until fully synchronised.",
      ],
      escalationRecommendation:
        "Monitor only. Escalate to Austco dev if delay exceeds 60s or grows.",
    },
    {
      id: "iss-6",
      title: "East Wing Access Switch — Port Errors",
      severity: "Warning",
      confidence: "High",
      affectedDevice: "East Wing Access Switch",
      affectedIp: "10.20.0.3",
      module: "Switch Discovery",
      whatIsHappening:
        "Switch is reachable, but port Gi1/0/18 (Controller West Wing uplink) shows packet errors and intermittent loss.",
      evidence: [
        "412 input errors on Gi1/0/18",
        "88 CRC errors on Gi1/0/18",
        "1.1% overall switch packet loss",
      ],
      likelyRootCause:
        "Layer 1 / cabling issue on Controller West Wing uplink — likely bad termination, damaged cable, or duplex/speed mismatch.",
      recommendedSteps: [
        "Clear interface counters and observe over 5 minutes.",
        "Re-seat or replace the patch cable to Controller West Wing.",
        "Verify duplex/speed negotiation matches on both ends.",
        "Move controller to a known-good port to isolate.",
      ],
      escalationRecommendation:
        "Escalate to network team. This is the most likely upstream cause of Issue #1 and #2.",
    },
    {
      id: "iss-7",
      title: "CCT Logic Verified — Programming Not At Fault",
      severity: "Info",
      confidence: "High",
      module: "CCT Logic Validation",
      whatIsHappening:
        "All CCT active/cancel pairs, group assignments, zone assignments and output mappings validate cleanly.",
      evidence: [
        "All active events have matching cancel logic",
        "East Wing group assignment present and correct",
        "Room 230 mapped to East Wing group",
        "Output mapping for East Wing group → Controller West Wing relay 4 present",
        "No conflicting logic detected",
      ],
      likelyRootCause:
        "Logic is not the suspected failure point. Live behavior indicates the issue occurs after event generation.",
      recommendedSteps: [
        "Do not change CCT programming.",
        "Focus investigation on event delivery, controller, and output layers.",
      ],
      escalationRecommendation:
        "When escalating to dev, explicitly note: 'CCT logic verified, configuration appears valid'.",
    },
  ];
}

function summarise(devices: AustcoDevice[]) {
  return {
    healthy: devices.filter((d) => d.status === "Healthy").length,
    warnings: devices.filter((d) => d.status === "Warning").length,
    critical: devices.filter((d) => d.status === "Critical").length,
    offline: devices.filter((d) => d.status === "Offline").length,
  };
}

const MODULE_OUTCOMES: Record<string, { status: DiagnosticModule["status"]; findings: string[] }> = {
  m1: { status: "Passed", findings: ["Laptop 10.20.0.99/24 → gateway 10.20.0.1 OK", "DNS 10.20.0.1 OK", "Server subnet 10.20.1.0/24 reachable", "Controller subnet 10.20.4.0/24 reachable", "No duplicate IP detected"] },
  m2: { status: "Warning", findings: ["3 switches discovered (Core / East / West)", "East-Sw port Gi1/0/18 — 412 input errors, 88 CRC", "LLDP map built — 12 devices mapped to ports"] },
  m3: { status: "Passed", findings: ["Primary 10.20.1.10 reachable (1.2ms)", "Secondary 10.20.1.11 reachable (1.4ms)", "VIP 10.20.1.12 reachable (1.3ms)"] },
  m4: { status: "Warning", findings: ["VIP owned by Primary (Active)", "Replication delay 14s", "No split-brain detected"] },
  m5: { status: "Passed", findings: ["Pulse Core / Event / Comm / DB / Queue services running", "HL7 service: not enabled at this site"] },
  m6: { status: "Warning", findings: ["Event queue backlog elevated (28 pending)", "Processing rate normal", "0 dead letters"] },
  m7: { status: "Passed", findings: ["CCT logic verified", "All active/cancel pairs valid", "Group/zone/output mapping complete", "No conflicting logic"] },
  m8: { status: "Failed", findings: ["Controller East — healthy", "Controller West — heartbeat stale (42s), output ack missing"] },
  m9: { status: "Warning", findings: ["IP-IN8 Basement — Input 3 held active by external contact"] },
  m10: { status: "Failed", findings: ["IP-APP1 East — heartbeat stale, missed cancel push", "IP-APP1 West — healthy"] },
  m11: { status: "Failed", findings: ["East Wing group signal light — output event sent, no activation"] },
  m12: { status: "Failed", findings: ["Trace Room 230: server OK → CCT OK → output OK → controller ack FAILED"] },
  m13: { status: "Passed", findings: ["7 issues correlated and ranked by impact"] },
  m14: { status: "Passed", findings: ["Escalation package built with 7 issues, 8 events, 14 devices"] },
};

/**
 * Run the full Austco diagnostic chain.
 * onProgress is called as each module transitions Pending → Scanning → final state.
 */
export async function runFullAustcoDiagnosis(
  _config: SiteConfig,
  onProgress?: (modules: DiagnosticModule[]) => void,
  perModuleDelayMs = 380,
): Promise<DiagnosticResult> {
  const modules: DiagnosticModule[] = DIAGNOSTIC_MODULES.map((m) => ({
    ...m,
    status: "Pending",
    findings: [],
  }));
  onProgress?.(structuredClone(modules));

  for (let i = 0; i < modules.length; i++) {
    modules[i].status = "Scanning";
    onProgress?.(structuredClone(modules));
    await new Promise((r) => setTimeout(r, perModuleDelayMs));
    const out = MODULE_OUTCOMES[modules[i].id];
    modules[i].status = out.status;
    modules[i].findings = out.findings;
    modules[i].durationMs = perModuleDelayMs + Math.floor(Math.random() * 120);
    onProgress?.(structuredClone(modules));
  }

  const issues = buildIssues();
  const ranking = rankRootCauses(issues);

  return {
    siteName: _config.siteName,
    scanTime: new Date().toISOString(),
    summary: summarise(mockDevices),
    devices: mockDevices,
    events: mockEvents,
    issues,
    rootCauseRanking: ranking,
    modules,
  };
}

/* ===== Real integration placeholders =====
 * Real Austco integration goes here.
 * These currently return mock data — wire to real Pulse APIs / SNMP / ICMP later.
 */

export async function pingHost(_ip: string): Promise<{ ok: boolean; latencyMs: number }> {
  // Real Austco integration goes here.
  return { ok: true, latencyMs: 1 + Math.random() * 4 };
}

export async function scanSubnet(_cidr: string): Promise<string[]> {
  // Real Austco integration goes here.
  return mockDevices.map((d) => d.ip);
}

export async function checkOpenPorts(_ip: string, _ports: number[]): Promise<number[]> {
  // Real Austco integration goes here.
  return _ports;
}

export async function readPulseServices(_serverIp: string) {
  // Real Austco integration goes here.
  return ["Pulse Core", "Event Processing", "Device Comm", "App Comm", "Database", "Queue Processor"].map((s) => ({ service: s, running: true }));
}

export async function readEventQueue(_serverIp: string) {
  // Real Austco integration goes here.
  return { pending: 28, processed: 14_204, deadLetters: 0 };
}

export async function readCCTLogic(_serverIp: string) {
  // Real Austco integration goes here.
  return { valid: true, conflicts: [], groupAssignments: 14, zoneAssignments: 22 };
}

export async function readControllerStatus(controllerIp: string) {
  // Real Austco integration goes here.
  const d = mockDevices.find((x) => x.ip === controllerIp);
  return d ? { ip: d.ip, status: d.status, heartbeat: d.lastHeartbeat, firmware: d.firmware } : null;
}

export async function readIPAPP1Status(deviceIp: string) {
  // Real Austco integration goes here.
  return mockDevices.find((d) => d.ip === deviceIp && d.type === "IP-APP1") ?? null;
}

export async function readIPIN8State(deviceIp: string) {
  // Real Austco integration goes here.
  return mockDevices.find((d) => d.ip === deviceIp && d.type === "IP-IN8") ?? null;
}

export async function readSwitchPorts(_switchIp: string) {
  // Real Austco integration goes here.
  return [
    { port: "Gi1/0/4", inputErrors: 0, crcErrors: 0, status: "up" },
    { port: "Gi1/0/12", inputErrors: 0, crcErrors: 0, status: "up" },
    { port: "Gi1/0/18", inputErrors: 412, crcErrors: 88, status: "up" },
  ];
}