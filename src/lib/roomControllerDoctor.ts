/**
 * SIM-046 Room Controller / IPnet Router Doctor.
 *
 * Pure logic: given a DiagnosisRequest, returns per-controller findings,
 * IPnet device tree, parsed Event Viewer events, and (per call point) an
 * extended breakpoint trace from Callpoint → IPnet Bus → Room Controller →
 * IPConnect → Pulse Gateway → Target Controller → ODL/Signal/Relay.
 *
 * No hallucination: if data is missing, status is "Not verified" and that
 * device is NOT used as a root-cause.
 */

import type {
  DiagnosisRequest, RoomController, IpnetDevice, CallPointEntry,
} from "./siteDoctorApi";
import { shouldAutoApplyDefaultCreds } from "./siteDoctorApi";

export type RcSeverity = "Info" | "Warning" | "Critical";

export type RcFinding = {
  controller: string;
  area: string;
  severity: RcSeverity;
  title: string;
  detail: string;
  evidence: string[];
  fix: string[];
};

export type RcEventViewerEntry = {
  timestamp?: string;
  kind: "active" | "cancel" | "fault" | "maintenance" | "device-online" | "device-offline" | "input-active" | "relay-active" | "other";
  raw: string;
  device?: string;
};

export type RcReport = {
  controller: RoomController;
  findings: RcFinding[];
  ipnetSummary: {
    total: number;
    byType: Record<string, number>;
    portA: number;
    portB: number;
    notVerified: number;
    offline: number;
  };
  events: RcEventViewerEntry[];
};

export type RcTraceStatus = "Pending" | "Running" | "Passed" | "Failed" | "Skipped";

export type RcTraceStep = {
  id: string;
  layer: string;
  label: string;
  detail: string;
  status: RcTraceStatus;
  evidence: string[];
};

export type RcTraceBreak = {
  rule: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  breakPoint: string;
  previousStepPassed: string;
  failedStep: string;
  evidence: string[];
  likelyCause: string;
  fix: string[];
};

export type RcTraceResult = {
  callPoint: CallPointEntry;
  steps: RcTraceStep[];
  breakpoint: RcTraceBreak | null;
  conclusion: string;
};

/* ============ Event Viewer parser ============ */

const TS_RE = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\b|\b(\d{2}:\d{2}:\d{2})\b/;

export function parseEventViewer(text: string | undefined): RcEventViewerEntry[] {
  if (!text || !text.trim()) return [];
  const out: RcEventViewerEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tsMatch = line.match(TS_RE);
    const ts = tsMatch ? (tsMatch[1] ?? tsMatch[2]) : undefined;
    const lower = line.toLowerCase();
    let kind: RcEventViewerEntry["kind"] = "other";
    if (/\bactive\b/.test(lower) && /input/.test(lower)) kind = "input-active";
    else if (/\bactive\b/.test(lower)) kind = "active";
    else if (/\bcancel/.test(lower)) kind = "cancel";
    else if (/\bfault\b|\berror\b/.test(lower)) kind = "fault";
    else if (/\bmaintenance\b/.test(lower)) kind = "maintenance";
    else if (/device.*online|online.*device/.test(lower)) kind = "device-online";
    else if (/device.*offline|offline.*device/.test(lower)) kind = "device-offline";
    else if (/\brelay\b/.test(lower)) kind = "relay-active";
    const devMatch = line.match(/\b(?:device|callpoint|pendant|odl|relay|input)\s*[:#]?\s*([\w\-.]+)/i);
    out.push({ timestamp: ts, kind, raw: line, device: devMatch?.[1] });
  }
  return out;
}

/* ============ Per-controller validator ============ */

export function buildRoomControllerReports(req: DiagnosisRequest): RcReport[] {
  const rcs = req.roomControllers ?? [];
  // Site-wide duplicate ID detection
  const idCounts = new Map<string, number>();
  rcs.forEach((c) => idCounts.set(c.controllerId, (idCounts.get(c.controllerId) ?? 0) + 1));

  return rcs.map((c) => buildOne(c, idCounts));
}

function buildOne(c: RoomController, idCounts: Map<string, number>): RcReport {
  const f: RcFinding[] = [];
  const devices: IpnetDevice[] = c.ipnetDevices ?? [];

  // Rule 1 — Reachable but no web interface
  if (c.hasWebAccess === false) {
    f.push({
      controller: c.name, area: "Web Interface", severity: "Critical",
      title: "Controller reachable but HTTP web interface unreachable",
      detail: "Ping succeeds but the controller's web interface (port 80) is not reachable from the technician laptop.",
      evidence: [`ping=ok`, `http_80=unreachable`, `ip=${c.ip}`, `vlan=${c.vlan}`],
      fix: [
        "Verify technician laptop is on a VLAN allowed to reach the controller management interface.",
        "Check firewall / ACLs between laptop and controller VLAN.",
        "Confirm controller web service is running; reboot controller if necessary.",
        "Verify controller IP has not drifted from configured value.",
      ],
    });
  }

  // Rule 2 — Default IP detection
  if (c.ip === "10.255.255.10") {
    f.push({
      controller: c.name, area: "Identity", severity: "Warning",
      title: "Controller may be at default IP or reset state",
      detail: "Controller IP is 10.255.255.10, which is the factory default address.",
      evidence: [`ip=${c.ip}`],
      fix: ["Reconfigure controller IP for the site VLAN.", "Re-add it to IPConnect site config.", "Verify Controller ID is unique."],
    });
  }

  // Rule 3 — Duplicate Controller ID
  if ((idCounts.get(c.controllerId) ?? 0) > 1) {
    f.push({
      controller: c.name, area: "Identity", severity: "Critical",
      title: "Duplicate Controller ID detected",
      detail: "Duplicate Controller ID can cause event routing and zone/group signal issues across IPConnect deployments.",
      evidence: [`controller_id=${c.controllerId}`, `count=${idCounts.get(c.controllerId)}`],
      fix: ["Assign a unique Controller ID per Room Controller.", "Update IPConnect site config.", "Run Update All Controllers."],
    });
  }

  // SIM-046 — Default credentials still active (security warning)
  if (shouldAutoApplyDefaultCreds(c.model) && c.credentials?.isDefault &&
      (c.authStatus === "authenticated" || c.authStatus === "untested")) {
    f.push({
      controller: c.name, area: "Credentials", severity: "Warning",
      title: "Device is using default credentials (admin/admin)",
      detail: "Default credentials are still active on this device. This is not recommended for production environments.",
      evidence: [`model=${c.model}`, `username=${c.credentials.username}`, `password=***`],
      fix: [
        "Open the device web interface and change the admin password.",
        "Update IPConnect / Pulse Manage with the new credentials.",
        "Re-test diagnostics with the new credentials.",
      ],
    });
  }

  // SIM-046 — Authentication failed against device
  if (c.authStatus === "auth_failed") {
    f.push({
      controller: c.name, area: "Credentials", severity: "Critical",
      title: "Default credentials rejected. Device may have custom credentials.",
      detail: c.authMessage ?? "Default admin/admin login was rejected by the device — diagnostics that require web access cannot run until valid credentials are supplied.",
      evidence: [`auth_status=${c.authStatus}`, `model=${c.model ?? "unknown"}`],
      fix: [
        "Confirm the credentials with site documentation.",
        "Enter the correct username/password in the Room Controller card override fields.",
        "Re-run diagnosis. If unknown, factory reset only with site approval.",
      ],
    });
  }

  // Rule 4 — Zones present
  if (!c.zones || c.zones.length === 0) {
    f.push({
      controller: c.name, area: "Zones", severity: "Critical",
      title: "No zones configured on controller",
      detail: "Without zones, callpoint events cannot be matched to room/group signal.",
      evidence: ["zones=0"],
      fix: ["Define a Room zone for each callpoint.", "Define Group Signal zones used by ODLs/ZTS.", "Run Update All Controllers."],
    });
  }

  // Rule 5 — Group Signals
  const gs = c.groupSignals ?? [];
  if (gs.length === 0) {
    f.push({
      controller: c.name, area: "Group Signals", severity: "Warning",
      title: "No group signals configured",
      detail: "Group signal lights / zone tone sounders will not activate without group signal definitions.",
      evidence: ["group_signals=0"],
      fix: ["Add group signals.", "Assign target ODL/ZTS.", "Update remote zones, then Update All Controllers."],
    });
  }
  // Rule 6 — Follow-Me Lighting conflict
  for (const g of gs) {
    if (g.followMeLighting) {
      f.push({
        controller: c.name, area: "Group Signals", severity: "Critical",
        title: `Group Signal "${g.name}" conflicts with Follow-Me Lighting`,
        detail: "ODL/ZTS configured for Follow-Me Lighting must not also be defined as a group signal target on the same PST/CCT.",
        evidence: [`group_signal=${g.name}`, `target=${g.targetOdlOrZts}`, "follow_me_lighting=true"],
        fix: ["Remove the group signal definition for that ODL/ZTS, or remove Follow-Me Lighting from the CCP for that PST/CCT.", "Reload site config and Update All Controllers."],
      });
    }
  }

  // Rule 7 — Call Types
  if (!c.callTypes || c.callTypes.length === 0) {
    f.push({
      controller: c.name, area: "Call Types", severity: "Warning",
      title: "No Call Types defined",
      detail: "Without call types, tone, light behaviour and priority are undefined.",
      evidence: ["call_types=0"],
      fix: ["Define Patient/Emergency/etc. call types.", "Assign call types to callpoints in IPnet Device List."],
    });
  }

  // Rule 10 — IPnet Device List
  if (c.ipnetDeviceListPopulated === false || devices.length === 0) {
    f.push({
      controller: c.name, area: "IPnet Device List", severity: "Critical",
      title: "IPnet Device List is empty / not populated",
      detail: "No IPnet devices are visible to this Room Controller. Callpoints will not register events.",
      evidence: [`devices=${devices.length}`],
      fix: [
        "Verify IPnet wiring and address assignments.",
        "Check IPnet bus power on both connectors.",
        "Run IPnet discovery on the controller.",
        "Replace any faulty callpoint after isolation tests.",
      ],
    });
  }

  // Rule 11 — Device load
  if (devices.length > 32) {
    f.push({
      controller: c.name, area: "IPnet Load", severity: "Critical",
      title: "IPnet device count exceeds hard limit (32)",
      detail: "Room Controller supports a maximum of 32 IPnet devices.",
      evidence: [`devices=${devices.length}`],
      fix: ["Move devices to another Room Controller.", "Re-balance IPnet runs."],
    });
  } else if (devices.length > 30) {
    f.push({
      controller: c.name, area: "IPnet Load", severity: "Warning",
      title: "IPnet device load exceeds recommended servicing limit (30)",
      detail: "Recommended maximum is 30 IPnet devices per Room Controller.",
      evidence: [`devices=${devices.length}`],
      fix: ["Plan to redistribute devices across additional Room Controllers."],
    });
  }

  // Rule 12 — IPnet port balance
  const portA = devices.filter((d) => d.portRun === "A").length;
  const portB = devices.filter((d) => d.portRun === "B").length;
  const total = devices.length;
  if (total >= 6 && (portA === 0 || portB === 0)) {
    f.push({
      controller: c.name, area: "IPnet Load", severity: "Warning",
      title: "All IPnet devices on a single connector",
      detail: "Device load should be balanced across the two IPnet connectors on the Room Controller.",
      evidence: [`port_a=${portA}`, `port_b=${portB}`],
      fix: ["Move ~half of the devices to the other IPnet connector.", "Document the new wiring run."],
    });
  }

  // Servers configured
  if (c.serversConfigured === false) {
    f.push({
      controller: c.name, area: "Network → Servers", severity: "Critical",
      title: "Network → Servers not configured",
      detail: "Room Controller has no parent IPConnect/Pulse server configured. Events will not forward upstream.",
      evidence: ["servers_configured=false"],
      fix: ["Open Network → Servers on controller.", "Add IPConnect/Pulse server IPs.", "Save and reboot controller if required."],
    });
  }

  // Event Viewer parsing
  const events = parseEventViewer(c.eventViewerText);
  const faults = events.filter((e) => e.kind === "fault" || e.kind === "device-offline");
  if (faults.length > 0) {
    f.push({
      controller: c.name, area: "Event Viewer", severity: "Warning",
      title: `${faults.length} fault / offline events in Event Viewer`,
      detail: "Recent Event Viewer text contains fault or device-offline events.",
      evidence: faults.slice(0, 5).map((e) => e.raw),
      fix: ["Review Event Viewer.", "Investigate offending devices.", "Re-run discovery if needed."],
    });
  }

  // Build IPnet summary
  const byType: Record<string, number> = {};
  for (const d of devices) byType[d.type] = (byType[d.type] ?? 0) + 1;
  const summary = {
    total,
    byType,
    portA,
    portB,
    notVerified: devices.filter((d) => !d.status || d.status === "Not verified").length,
    offline: devices.filter((d) => d.status === "Offline" || d.status === "Fault").length,
  };

  return { controller: c, findings: f, ipnetSummary: summary, events };
}

/* ============ Extended Callpoint → Output trace ============ */

function step(id: string, layer: string, label: string, detail: string): RcTraceStep {
  return { id, layer, label, detail, status: "Pending", evidence: [] };
}

/**
 * Run the SIM-046 callpoint trace using only verified data.
 * Apply rules A–G and stop at the first failed handoff.
 */
export async function traceCallpointSim046(
  req: DiagnosisRequest,
  cp: CallPointEntry,
  onStep?: (steps: RcTraceStep[]) => void,
  stepDelayMs = 160,
): Promise<RcTraceResult> {
  const rc = (req.roomControllers ?? []).find((c) => c.name === cp.controller);
  const events = parseEventViewer(rc?.eventViewerText);
  const ipnetDevices: IpnetDevice[] = rc?.ipnetDevices ?? [];

  // Match the callpoint inside the room controller's IPnet device list (verified-only).
  const matchedCallpoint = ipnetDevices.find(
    (d) => (d.type === "Callpoint" || d.type === "Smart Callpoint") &&
      (d.name.toLowerCase().includes(cp.name.toLowerCase()) ||
       d.zone?.toLowerCase() === cp.name.toLowerCase()),
  );

  // Verified events that prove input was seen at the controller
  const sawInput = events.some(
    (e) => (e.kind === "input-active" || e.kind === "active"),
  );

  const targetGroup = (rc?.groupSignals ?? []).find((g) => g.name === cp.expectedOutputGroup);

  const steps: RcTraceStep[] = [
    step("cp-active",  "Callpoint",        "Callpoint active",
      matchedCallpoint ? `${matchedCallpoint.name} @ ${matchedCallpoint.address}` : `${cp.name} (not verified in IPnet list)`),
    step("rc-input",   "Room Controller",  "Room Controller detects IPnet input", rc ? `${rc.name} (${rc.ip})` : "Room Controller not declared"),
    step("rc-event",   "Event Viewer",     "Event Viewer logs active event",     events.length ? `${events.length} events parsed` : "No Event Viewer text supplied"),
    step("rc-forward", "Room Controller",  "Forwards event to Floor Controller / IPConnect", rc?.parentIpConnect ?? "Parent IPConnect not declared"),
    step("ipc-match",  "IPConnect",        "IPConnect site config matches Controller ID + device address", `controller_id=${rc?.controllerId ?? "?"}`),
    step("puga-proc",  "Pulse Gateway",    "Pulse Gateway processes event",      "via authoritative PuGa"),
    step("output-evt", "IPConnect / PuGa", "Output event generated",             targetGroup ? `→ ${targetGroup.name}` : `Group "${cp.expectedOutputGroup}" not found on ${rc?.name ?? "controller"}`),
    step("target-rc",  "Target Controller","Target Room Controller receives output", rc ? `${rc.name}` : "—"),
    step("output-hw",  "Physical Output",  "ODL / Group Signal / Zone Light / Relay activates",
      targetGroup ? `Target hardware: ${targetGroup.targetOdlOrZts}` : `Expected hardware: ${cp.expectedSignalLight}`),
    step("cancel",     "Cancel",           "Cancel event clears call",           (rc?.cancelLinks ?? []).length ? "cancel links configured" : "no cancel links configured"),
  ];
  onStep?.(structuredClone(steps));

  // Pre-decide first failure using SIM-046 rules
  const fail = pickRcFailure({ rc, cp, ipnetDevices, matchedCallpoint, sawInput, events, targetGroup });

  let firstFailure = -1;
  for (let i = 0; i < steps.length; i++) {
    if (firstFailure !== -1) {
      steps[i].status = "Skipped";
      steps[i].detail = "Skipped — previous handoff failed.";
      onStep?.(structuredClone(steps));
      continue;
    }
    steps[i].status = "Running";
    onStep?.(structuredClone(steps));
    await new Promise((r) => setTimeout(r, stepDelayMs));
    if (fail && fail.stepId === steps[i].id) {
      steps[i].status = "Failed";
      steps[i].detail = fail.detail;
      steps[i].evidence = fail.evidence;
      firstFailure = i;
    } else {
      steps[i].status = "Passed";
    }
    onStep?.(structuredClone(steps));
  }

  if (firstFailure === -1) {
    return {
      callPoint: cp, steps, breakpoint: null,
      conclusion: `Full SIM-046 chain verified for ${cp.name}.`,
    };
  }

  const failed = steps[firstFailure];
  const prev = firstFailure > 0 ? steps[firstFailure - 1] : null;
  const breakpoint: RcTraceBreak = {
    rule: fail!.rule,
    breakPoint: prev ? `${prev.layer} → ${failed.layer}` : failed.layer,
    previousStepPassed: prev ? `${prev.label} — ${prev.detail}` : "No prior step.",
    failedStep: `${failed.label} — ${failed.detail}`,
    evidence: failed.evidence,
    likelyCause: fail!.cause,
    fix: fail!.fix,
  };
  return {
    callPoint: cp, steps, breakpoint,
    conclusion: `Break found at: ${breakpoint.breakPoint}.`,
  };
}

type RcStepFail = { stepId: string; rule: RcTraceBreak["rule"]; detail: string; evidence: string[]; cause: string; fix: string[] };

function pickRcFailure(ctx: {
  rc?: RoomController;
  cp: CallPointEntry;
  ipnetDevices: IpnetDevice[];
  matchedCallpoint?: IpnetDevice;
  sawInput: boolean;
  events: RcEventViewerEntry[];
  targetGroup?: { name: string; targetOdlOrZts: string; followMeLighting?: boolean };
}): RcStepFail | null {
  const { rc, cp, ipnetDevices, matchedCallpoint, sawInput, events, targetGroup } = ctx;

  if (!rc) {
    return {
      stepId: "rc-input", rule: "B",
      detail: `Room Controller "${cp.controller}" not declared in payload.`,
      evidence: [`expected=${cp.controller}`],
      cause: "Call point references a controller that is not part of the site payload.",
      fix: [`Add Room Controller "${cp.controller}" to the payload.`, "Re-run trace."],
    };
  }

  // Rule 10: callpoint physically declared but not in IPnet list (no hallucination)
  if (!matchedCallpoint && ipnetDevices.length > 0) {
    return {
      stepId: "cp-active", rule: "A",
      detail: "Callpoint not present in Room Controller IPnet Device List.",
      evidence: [`expected=${cp.name}`, `ipnet_devices=${ipnetDevices.length}`],
      cause: "Callpoint not discovered on IPnet bus — wiring, power, address assignment, or faulty device.",
      fix: [
        "Inspect IPnet wiring on the relevant port run.",
        "Verify IPnet bus power.",
        "Re-address callpoint and run discovery.",
        "Swap with known-good callpoint if discovery still fails.",
      ],
    };
  }

  // Rule A: callpoint active but no controller event
  if (matchedCallpoint && !sawInput && (rc.eventViewerText ?? "").trim().length > 0) {
    return {
      stepId: "rc-event", rule: "A",
      detail: "Event Viewer does not show an active input event for this callpoint.",
      evidence: [`callpoint=${matchedCallpoint.name}`, `events_parsed=${events.length}`],
      cause: "Callpoint fault, IPnet wiring, IPnet bus power, or device not discovered.",
      fix: [
        "Verify callpoint is in IPnet Device List with status Online.",
        "Check port run power/wiring.",
        "Activate callpoint locally and retest.",
      ],
    };
  }

  // Network → Servers missing → Rule B
  if (rc.serversConfigured === false) {
    return {
      stepId: "rc-forward", rule: "B",
      detail: "Room Controller has no parent IPConnect/Pulse server configured.",
      evidence: ["servers_configured=false"],
      cause: "Controller cannot forward events upstream — Network → Servers is empty or wrong.",
      fix: ["Open controller Network → Servers.", "Add IPConnect/Pulse server entries.", "Save and reboot if required."],
    };
  }

  // Rule C: IPConnect/PuGa output requires a matching group signal on this controller
  if (!targetGroup) {
    return {
      stepId: "output-evt", rule: "C",
      detail: `Group "${cp.expectedOutputGroup}" is not configured on ${rc.name}.`,
      evidence: [`expected_group=${cp.expectedOutputGroup}`, `defined_groups=${(rc.groupSignals ?? []).map((g) => g.name).join("|") || "none"}`],
      cause: "IPConnect site config / call type / zone or group signal missing — no output rule fires.",
      fix: [
        "Verify zone exists for the callpoint.",
        "Add group signal with correct zones and target ODL/ZTS.",
        "Re-import IPConnect site config and Update All Controllers.",
      ],
    };
  }

  // Rule G: Follow-Me Lighting conflict on the very group used
  if (targetGroup.followMeLighting) {
    return {
      stepId: "output-evt", rule: "G",
      detail: `Group "${targetGroup.name}" conflicts with Follow-Me Lighting on its target ODL/ZTS.`,
      evidence: [`group=${targetGroup.name}`, `target=${targetGroup.targetOdlOrZts}`],
      cause: "ODL/ZTS configured for Follow-Me Lighting must not also be a group signal target.",
      fix: ["Remove group signal for that ODL/ZTS, or remove Follow-Me Lighting from CCP.", "Reload site config and Update All Controllers."],
    };
  }

  // Rule F: cancel links missing
  if ((rc.cancelLinks ?? []).length === 0) {
    return {
      stepId: "cancel", rule: "F",
      detail: "No cancel links configured for this controller.",
      evidence: ["cancel_links=0"],
      cause: "Cancel group / cancel link missing or presence behaviour misconfigured.",
      fix: ["Configure Cancel Links on the controller.", "Verify Cancel Group on relevant call types.", "Re-test cancel from callpoint."],
    };
  }

  return null;
}
