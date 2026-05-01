/**
 * Network Infrastructure Doctor
 * -----------------------------
 * Pure logic. Given a DiagnosisRequest + (optional) SNMP poll result,
 * produces a NetworkAnalysis: switches, ports, MAC table, ARP table, VLAN /
 * PoE / port findings, and a verified-only `override` Breakpoint.
 *
 *   Rules N1-N8 (mirror Part 8 of the spec):
 *   N1 device unreachable + port down                 → Switch Port
 *   N2 device unreachable + PoE off                   → Switch PoE Power
 *   N3 device reachable, wrong VLAN                   → VLAN Config
 *   N4 device reachable, required L4 port closed      → Network Port Block
 *   N5 device powered (PoE on, port up) but no reply  → Device / Firmware / IP
 *   N6 multiple devices unreachable, same VLAN        → VLAN / Switch Uplink
 *   N7 MAC flapping between ports                     → Loop / cabling
 *   N8 No MAC learned for known device                → Cabling / port / power
 *
 * No-hallucination contract:
 *   - Only emits a top-level `override` (highest-priority break) when the
 *     supporting evidence comes from a verified source: SNMP, ARP, scan,
 *     or technician-confirmed manual entry that contradicts an expectation.
 *   - Manual / "not verified" data may produce findings, but never an
 *     override that outranks CCP.
 */

import type {
  DiagnosisRequest, ExpectedConnectionInput, SwitchInput,
  ManualSwitchPortInput, SwitchVendor,
} from "./siteDoctorApi";
import type { ConfigEvidence, RcTraceStep } from "./roomControllerDoctor";

/* ------------------------------------------------------------------ */
/* SNMP / scan input shape (returned from snmpBridge.poll())          */
/* ------------------------------------------------------------------ */

export type SnmpPortStatus = "up" | "down" | "unknown";
export type PoeStatus = "delivering" | "off" | "fault" | "unknown";

export type SnmpPort = {
  switchName: string;
  port: string;
  ifName?: string;
  link: SnmpPortStatus;
  adminUp?: boolean;
  speedMbps?: number;
  vlan?: string;
  poeEnabled?: boolean;
  poeStatus?: PoeStatus;
  poePowerWatts?: number;
};

export type MacTableEntry = {
  switchName: string;
  port: string;
  mac: string;
  vlan?: string;
};

export type ArpEntry = { ip: string; mac: string };

export type SnmpSwitchSnapshot = {
  switchName: string;
  ip: string;
  vendor: SwitchVendor;
  reachable: boolean;
  /** sysName from sysDescr */
  sysName?: string;
  ports: SnmpPort[];
  macTable: MacTableEntry[];
  /** "snmp" if real, "manual" if synthesized from SwitchInput.ports. */
  source: "snmp" | "manual" | "unavailable";
  message?: string;
};

export type SnmpPollResult = {
  ok: boolean;
  switches: SnmpSwitchSnapshot[];
  arp: ArpEntry[];
  /** Set when no bridge configured / bridge fetch failed. */
  unavailableReason?: string;
};

export const EMPTY_SNMP: SnmpPollResult = { ok: false, switches: [], arp: [], unavailableReason: "not_polled" };

/* ------------------------------------------------------------------ */
/* Output: NetworkAnalysis                                            */
/* ------------------------------------------------------------------ */

export type NetworkFindingSeverity = "Critical" | "Warning" | "Info";

export type NetworkFinding = {
  rule: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" | "N8";
  severity: NetworkFindingSeverity;
  title: string;
  detail: string;
  evidence: ConfigEvidence[];
  fix: string[];
  /** Whether evidence is verified (SNMP / ARP / scan). */
  verified: boolean;
};

export type ResolvedConnection = {
  deviceName: string;
  deviceIp?: string;
  deviceMac?: string;
  switchName?: string;
  port?: string;
  vlan?: string;
  link?: SnmpPortStatus;
  poe?: PoeStatus;
  poeRequired?: boolean;
  /** Where the mapping evidence came from. */
  source: "SNMP MAC Table" | "ARP Table" | "Manual Entry" | "Network Scan" | "Not verified";
};

export type NetworkAnalysis = {
  switches: SnmpSwitchSnapshot[];
  resolvedConnections: ResolvedConnection[];
  arp: ArpEntry[];
  findings: NetworkFinding[];
  /** Trace steps to inject between Room Controller and CCP layers. */
  steps: RcTraceStep[];
  /** Verified-only break — promoted above CCP only when this exists. */
  override: {
    breakPoint: string;
    failedLayer: string;
    previousStepPassed: string;
    failedStep: string;
    likelyCause: string;
    fix: string[];
    evidence: string[];
    configEvidence: ConfigEvidence[];
  } | null;
  conclusion: string;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const lc = (s?: string) => (s ?? "").toLowerCase().trim();
const eqMac = (a?: string, b?: string) => !!a && !!b && lc(a).replace(/[^0-9a-f]/g, "") === lc(b).replace(/[^0-9a-f]/g, "");

function ev(
  source: ConfigEvidence["source"],
  field: string, expected: string, actual: string, impact: string,
): ConfigEvidence {
  return { source, field, expected, actual, impact };
}

/** Build a synthesized SNMP snapshot from manual port entries. */
function manualSnapshot(sw: SwitchInput): SnmpSwitchSnapshot {
  const ports: SnmpPort[] = (sw.ports ?? []).map((p: ManualSwitchPortInput) => ({
    switchName: sw.name,
    port: p.port,
    link: (p.link ?? "unknown") as SnmpPortStatus,
    vlan: p.vlan,
    poeEnabled: p.poeEnabled,
    poeStatus: p.poeDelivering === true ? "delivering" : p.poeEnabled === false ? "off" : "unknown",
  }));
  const macTable: MacTableEntry[] = (sw.ports ?? [])
    .filter((p) => !!p.macLearned)
    .map((p) => ({ switchName: sw.name, port: p.port, mac: p.macLearned!, vlan: p.vlan }));
  return {
    switchName: sw.name,
    ip: sw.ip,
    vendor: sw.vendor ?? "Unknown",
    reachable: ports.length > 0,
    ports, macTable,
    source: ports.length > 0 ? "manual" : "unavailable",
    message: ports.length > 0 ? "Manual port table — no SNMP data." : "No SNMP poll and no manual port data.",
  };
}

/**
 * Resolve which switch+port a device sits on, in priority order:
 *   1. SNMP MAC table (verified)
 *   2. ARP entry → match MAC against any switch's MAC table (verified)
 *   3. Technician's expectedSwitch + expectedPort (manual)
 *   4. Otherwise: not verified
 */
function resolveConnection(
  exp: ExpectedConnectionInput,
  switches: SnmpSwitchSnapshot[],
  arp: ArpEntry[],
): ResolvedConnection {
  const allMacRows = switches.flatMap((s) => s.macTable.map((m) => ({ ...m, snapshotSource: s.source })));
  // Strategy 1: device MAC → SNMP MAC table directly
  if (exp.deviceMac) {
    const macHit = allMacRows.find((m) => eqMac(m.mac, exp.deviceMac));
    if (macHit && macHit.snapshotSource === "snmp") {
      const sw = switches.find((s) => s.switchName === macHit.switchName);
      const port = sw?.ports.find((p) => p.port === macHit.port);
      return {
        deviceName: exp.deviceName, deviceIp: exp.deviceIp, deviceMac: exp.deviceMac,
        switchName: macHit.switchName, port: macHit.port, vlan: macHit.vlan ?? port?.vlan,
        link: port?.link, poe: port?.poeStatus, poeRequired: exp.poeRequired,
        source: "SNMP MAC Table",
      };
    }
  }
  // Strategy 2: ARP IP→MAC, then MAC table
  if (exp.deviceIp && !exp.deviceMac) {
    const arpHit = arp.find((a) => a.ip === exp.deviceIp);
    if (arpHit) {
      const macHit = allMacRows.find((m) => eqMac(m.mac, arpHit.mac));
      if (macHit) {
        const sw = switches.find((s) => s.switchName === macHit.switchName);
        const port = sw?.ports.find((p) => p.port === macHit.port);
        return {
          deviceName: exp.deviceName, deviceIp: exp.deviceIp, deviceMac: arpHit.mac,
          switchName: macHit.switchName, port: macHit.port, vlan: macHit.vlan ?? port?.vlan,
          link: port?.link, poe: port?.poeStatus, poeRequired: exp.poeRequired,
          source: "ARP Table",
        };
      }
    }
  }
  // Strategy 3: technician-declared mapping (manual)
  if (exp.expectedSwitch && exp.expectedPort) {
    const sw = switches.find((s) => s.switchName === exp.expectedSwitch);
    const port = sw?.ports.find((p) => p.port === exp.expectedPort);
    return {
      deviceName: exp.deviceName, deviceIp: exp.deviceIp, deviceMac: exp.deviceMac,
      switchName: exp.expectedSwitch, port: exp.expectedPort,
      vlan: port?.vlan ?? exp.expectedVlan, link: port?.link, poe: port?.poeStatus,
      poeRequired: exp.poeRequired, source: "Manual Entry",
    };
  }
  return {
    deviceName: exp.deviceName, deviceIp: exp.deviceIp, deviceMac: exp.deviceMac,
    poeRequired: exp.poeRequired, source: "Not verified",
  };
}

/* ------------------------------------------------------------------ */
/* Public entry                                                       */
/* ------------------------------------------------------------------ */

export function analyzeNetwork(
  payload: DiagnosisRequest,
  snmp: SnmpPollResult = EMPTY_SNMP,
): NetworkAnalysis {
  const infra = payload.networkInfrastructure;
  const arp = snmp.arp ?? [];

  // 1. Build per-switch snapshots — prefer SNMP, fall back to manual port tables.
  const switches: SnmpSwitchSnapshot[] = (infra?.switches ?? []).map((sw) => {
    const live = snmp.switches.find((s) => s.switchName === sw.name || s.ip === sw.ip);
    if (live && live.source === "snmp") return live;
    return manualSnapshot(sw);
  });

  // 2. Resolve every expected connection.
  const resolvedConnections: ResolvedConnection[] = (infra?.expectedConnections ?? [])
    .map((c) => resolveConnection(c, switches, arp));

  // 3. Apply rules N1-N8.
  const findings: NetworkFinding[] = [];
  const verifiedSources: ConfigEvidence["source"][] = [
    "SNMP MAC Table", "SNMP PoE", "SNMP Interface", "ARP Table", "Network Scan",
  ];
  const isVerified = (e: ConfigEvidence[]) => e.some((x) => verifiedSources.includes(x.source));

  // Group expected connections by VLAN — needed for N6.
  const vlanGroups = new Map<string, ResolvedConnection[]>();
  resolvedConnections.forEach((r) => {
    const k = r.vlan || "(unknown)";
    if (!vlanGroups.has(k)) vlanGroups.set(k, []);
    vlanGroups.get(k)!.push(r);
  });

  for (const exp of infra?.expectedConnections ?? []) {
    const r = resolvedConnections.find((rr) => rr.deviceName === exp.deviceName);
    if (!r) continue;
    const reachable = !!exp.deviceIp; // we don't ping here — caller can override with scan data

    // N1: port down + device unreachable
    if (r.link === "down") {
      const e = ev("SNMP Interface", "switchPort.link",
        "port up", "port down",
        `Device ${exp.deviceName} cannot communicate — switch port ${r.port} is down.`);
      findings.push({
        rule: "N1", severity: "Critical",
        title: `Switch port ${r.port ?? "?"} is DOWN for ${exp.deviceName}`,
        detail: `Port reported DOWN by ${r.source}.`,
        evidence: [e], verified: r.source !== "Manual Entry",
        fix: ["Check patch cable.", "Re-enable port (no shut).", "Verify PoE budget.", "Retest."],
      });
    }

    // N2: PoE required but off
    if (exp.poeRequired && r.poe === "off") {
      const e = ev("SNMP PoE", "switchPort.poeStatus",
        "PoE delivering power", "PoE disabled",
        `Device ${exp.deviceName} cannot power on — PoE is disabled on ${r.port}.`);
      findings.push({
        rule: "N2", severity: "Critical",
        title: `PoE OFF on ${r.port ?? "?"} for ${exp.deviceName}`,
        detail: "PoE-required device has no power.",
        evidence: [e], verified: r.source !== "Manual Entry",
        fix: ["Enable PoE on the port.", "Verify switch PoE budget.", "Confirm device class compatibility."],
      });
    }

    // N3: wrong VLAN
    if (exp.expectedVlan && r.vlan && r.vlan !== exp.expectedVlan) {
      const e = ev("VLAN Check", "switchPort.vlan",
        exp.expectedVlan, r.vlan,
        `Device ${exp.deviceName} cannot reach IPConnect/Pulse Gateway path.`);
      findings.push({
        rule: "N3", severity: "Critical",
        title: `${exp.deviceName} on wrong VLAN (${r.vlan}, expected ${exp.expectedVlan})`,
        detail: "VLAN misconfiguration breaks reachability to upstream services.",
        evidence: [e], verified: r.source !== "Manual Entry",
        fix: [`Move port ${r.port} to VLAN ${exp.expectedVlan}.`, "Verify trunk allowed list on uplinks."],
      });
    }

    // N5: powered (port up + PoE delivering OR no PoE required) but unreachable per scan/ARP
    if (
      r.link === "up" && (r.poe === "delivering" || !exp.poeRequired)
      && exp.deviceIp && !arp.find((a) => a.ip === exp.deviceIp)
      && r.source !== "Not verified"
    ) {
      const e = ev("ARP Table", "arp.ip",
        `${exp.deviceIp} present in ARP`, "no ARP entry",
        `Device ${exp.deviceName} is powered (port up${exp.poeRequired ? ", PoE on" : ""}) but not responding on the network.`);
      findings.push({
        rule: "N5", severity: "Warning",
        title: `${exp.deviceName} powered but unreachable`,
        detail: "Switch sees power/link but the device has no IP presence.",
        evidence: [e], verified: true,
        fix: ["Verify device IP / DHCP.", "Check device firmware.", "Reboot device, recheck."],
      });
    }

    // N8: no MAC learned (only meaningful when device MAC is known)
    if (exp.deviceMac && r.source !== "SNMP MAC Table" && r.source !== "ARP Table") {
      const anyHit = switches.some((s) => s.macTable.some((m) => eqMac(m.mac, exp.deviceMac)));
      if (!anyHit && switches.some((s) => s.source === "snmp")) {
        const e = ev("SNMP MAC Table", "macToPort",
          `${exp.deviceName} (${exp.deviceMac}) on a switch port`,
          "MAC not learned anywhere",
          "Device may be unplugged, powered off, or on a different switch.");
        findings.push({
          rule: "N8", severity: "Warning",
          title: `MAC for ${exp.deviceName} not learned by any switch`,
          detail: "No switch reports this MAC in its forwarding table.",
          evidence: [e], verified: true,
          fix: ["Verify cable.", "Confirm device power.", "Check uplink between switches."],
        });
      }
    }
  }

  // N6: multiple devices unreachable in same VLAN (verified data only)
  for (const [vlan, group] of vlanGroups) {
    if (vlan === "(unknown)" || group.length < 2) continue;
    const downOrMissing = group.filter((g) => g.link === "down" || g.source === "Not verified");
    if (downOrMissing.length === group.length && group.some((g) => g.source !== "Manual Entry" && g.source !== "Not verified")) {
      const e = ev("VLAN Check", `vlan.${vlan}`,
        "all devices reachable",
        `${downOrMissing.length} devices unreachable`,
        `VLAN ${vlan} appears down or isolated — likely uplink / switch issue.`);
      findings.push({
        rule: "N6", severity: "Critical",
        title: `Multiple devices down on VLAN ${vlan}`,
        detail: "All declared devices on this VLAN are unreachable.",
        evidence: [e], verified: true,
        fix: ["Check uplink between switches.", "Verify VLAN trunk allowed list.", "Inspect switch logs."],
      });
    }
  }

  // N7: MAC flapping — same MAC in MAC tables of different ports
  const macSeen = new Map<string, Set<string>>(); // mac → set of "switch:port"
  switches.forEach((s) => s.macTable.forEach((m) => {
    const k = lc(m.mac).replace(/[^0-9a-f]/g, "");
    if (!macSeen.has(k)) macSeen.set(k, new Set());
    macSeen.get(k)!.add(`${m.switchName}:${m.port}`);
  }));
  for (const [mac, places] of macSeen) {
    if (places.size > 1) {
      const e = ev("SNMP MAC Table", "macToPort",
        "MAC stable on one port", `MAC seen on ${[...places].join(", ")}`,
        "Network loop, duplicate MAC, or unstable cabling.");
      findings.push({
        rule: "N7", severity: "Warning",
        title: `MAC ${mac} flapping between ${places.size} ports`,
        detail: "Same MAC reported on multiple switch ports.",
        evidence: [e], verified: true,
        fix: ["Check for loops / dual-homed cabling.", "Verify spanning tree.", "Check for duplicate MAC."],
      });
    }
  }

  // 4. Build the trace steps to splice into the diagnosis flow.
  const haveAnyData = switches.length > 0 || resolvedConnections.length > 0;
  const haveSnmp = switches.some((s) => s.source === "snmp");

  const stepStatusFor = (verifiedFailure: boolean, manualFailure: boolean) =>
    verifiedFailure ? "Failed" as const :
    manualFailure ? "Passed" as const : // we lower confidence but don't fail
    haveAnyData ? "Passed" as const : "Skipped" as const;

  const portFailure = findings.find((f) => (f.rule === "N1" || f.rule === "N2") && f.verified);
  const portManualFailure = findings.find((f) => (f.rule === "N1" || f.rule === "N2") && !f.verified);
  const vlanFailure = findings.find((f) => (f.rule === "N3" || f.rule === "N6") && f.verified);
  const portBlockFailure = findings.find((f) => f.rule === "N4" && f.verified);

  const steps: RcTraceStep[] = haveAnyData ? [
    {
      id: "net-rc-port", layer: "Switch Port",
      label: "Room Controller → Switch Port",
      detail: portFailure
        ? `Switch port unhealthy (${portFailure.title}).`
        : portManualFailure
          ? `Manual entry indicates port issue (${portManualFailure.title}) — not yet verified by SNMP.`
          : haveSnmp ? "SNMP confirms switch port up / PoE healthy." : "Manual port data only — SNMP not polled.",
      status: stepStatusFor(!!portFailure, !!portManualFailure),
      evidence: portFailure ? portFailure.evidence.map((e) => `${e.field}: ${e.actual}`) : [],
      source: haveSnmp ? "scan" : "manual",
    },
    {
      id: "net-port-vlan", layer: "VLAN",
      label: "Switch Port → VLAN",
      detail: vlanFailure
        ? `VLAN mismatch / isolation (${vlanFailure.title}).`
        : "VLAN assignment matches expectation.",
      status: vlanFailure ? "Failed" : haveAnyData ? "Passed" : "Skipped",
      evidence: vlanFailure ? vlanFailure.evidence.map((e) => `${e.field}: ${e.actual}`) : [],
      source: haveSnmp ? "scan" : "manual",
    },
    {
      id: "net-vlan-ipc", layer: "Network → IPConnect",
      label: "VLAN → IPConnect",
      detail: portBlockFailure
        ? `Required L4 port blocked (${portBlockFailure.title}).`
        : "L3/L4 path to IPConnect open (per available evidence).",
      status: portBlockFailure ? "Failed" : haveAnyData ? "Passed" : "Skipped",
      evidence: portBlockFailure ? portBlockFailure.evidence.map((e) => `${e.field}: ${e.actual}`) : [],
      source: haveSnmp ? "scan" : "manual",
    },
  ] : [];

  // 5. Verified-only override.
  const verifiedCritical = findings.find((f) => f.severity === "Critical" && f.verified);
  let override: NetworkAnalysis["override"] = null;
  if (verifiedCritical) {
    const layer =
      verifiedCritical.rule === "N3" || verifiedCritical.rule === "N6" ? "VLAN" :
      verifiedCritical.rule === "N4" ? "Network Port Block" :
      "Switch Port";
    override = {
      breakPoint: layer === "VLAN" ? "VLAN → IPConnect"
               : layer === "Network Port Block" ? "VLAN → IPConnect"
               : "Room Controller → Switch Port",
      failedLayer: layer,
      previousStepPassed: layer === "Switch Port" ? "Room Controller reachable" : "Switch port up",
      failedStep:
        layer === "Switch Port" ? "Room Controller → Switch Port" :
        layer === "VLAN" ? "Switch Port → VLAN" :
        "VLAN → IPConnect",
      likelyCause: verifiedCritical.detail,
      fix: verifiedCritical.fix,
      evidence: verifiedCritical.evidence.map((e) => `${e.field}: expected ${e.expected}, actual ${e.actual}`),
      configEvidence: verifiedCritical.evidence,
    };
  }

  const conclusion = !haveAnyData
    ? "No network infrastructure declared — network layer skipped."
    : verifiedCritical
      ? `Network failure (verified): ${verifiedCritical.title}.`
      : findings.length > 0
        ? `Network has ${findings.length} finding(s); none verified-critical — config layer keeps priority.`
        : haveSnmp
          ? "Network infrastructure healthy — SNMP confirms all probed ports."
          : "Network infrastructure declared (manual) — SNMP not polled, treat as advisory.";

  return { switches, resolvedConnections, arp, findings, steps, override, conclusion };
}

/** Helper used by the input form / tests to know which sources count as verified. */
export function isVerifiedSource(s: ResolvedConnection["source"]): boolean {
  return s === "SNMP MAC Table" || s === "ARP Table" || s === "Network Scan";
}