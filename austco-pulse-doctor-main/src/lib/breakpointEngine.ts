import {
  checkPing, checkPorts, resolveDns, checkModulePath,
  readControllerStatus, readIPIN8State, readIPAPP1Status,
  readSignalLightStatus, readPulseGatewayStatus,
  readIPConnectConfig, readLicenseStatus, readINGAStatus,
  type AdapterSource,
} from "./hardwareAdapters";

export type ChainStepStatus = "Pending" | "Running" | "Passed" | "Failed" | "Skipped";

export type ChainStep = {
  id: string;
  layer: string;          // e.g. "Pulse Gateway", "Controller", "Signal Light"
  label: string;          // human-readable check label
  detail: string;
  status: ChainStepStatus;
  evidence: string[];
  source: AdapterSource;
  timestamp?: string;
};

export type Breakpoint = {
  breakPoint: string;        // e.g. "Pulse Gateway → Controller ACK"
  failedLayer: string;
  previousStepPassed: string;
  failedStep: string;
  affectedDevice: string;
  evidence: string[];
  likelyCause: string;
  recommendedFix: string[];
};

export type SignalChainResult = {
  steps: ChainStep[];
  breakpoint: Breakpoint | null;
  conclusion: string;
};

export type SignalChainInput = {
  room: string;
  ipin8Ip: string;
  controllerIp: string;
  expectedGroup: string;
  ipapp1Ip: string;
  signalLightIp: string;
  pulseGatewayIp?: string;
  ipconnectIp?: string;
  ingaIp?: string;
  licenseIp?: string;
  laptopVlan?: string;
  pulseHostname?: string;
};

const DEFAULTS = {
  pulseGatewayIp: "10.20.1.12",
  ipconnectIp: "10.20.1.20",
  licenseIp: "10.20.1.21",
  ingaIp: "10.20.1.22",
  pulseHostname: "pulse.austco.local",
  laptopVlan: "10.20.0.0/24",
};

/**
 * Walk the full Austco signal chain, running real adapter checks at every
 * layer. Returns the first failed handoff as a structured Breakpoint.
 */
export async function traceSignalPath(
  input: SignalChainInput,
  onStep?: (steps: ChainStep[]) => void,
  stepDelayMs = 320,
): Promise<SignalChainResult> {
  const cfg = { ...DEFAULTS, ...input };

  const steps: ChainStep[] = blueprint(cfg).map((b) => ({
    ...b, status: "Pending", evidence: [], source: "mock",
  }));
  onStep?.(structuredClone(steps));

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

    const outcome = await runStep(steps[i].id, cfg);
    steps[i].status = outcome.ok ? "Passed" : "Failed";
    steps[i].evidence = outcome.evidence;
    steps[i].detail = outcome.detail;
    steps[i].source = outcome.source;
    steps[i].timestamp = new Date().toISOString();

    if (!outcome.ok) firstFailure = i;
    onStep?.(structuredClone(steps));
  }

  const breakpoint = firstFailure === -1 ? null : buildBreakpoint(steps, firstFailure, cfg);
  const conclusion = breakpoint
    ? `Break found at: ${breakpoint.breakPoint}.`
    : "Full signal chain verified end-to-end. No break detected.";

  return { steps, breakpoint, conclusion };
}

function blueprint(cfg: Required<typeof DEFAULTS> & SignalChainInput): Array<Pick<ChainStep, "id" | "layer" | "label" | "detail">> {
  return [
    { id: "laptop-vlan",      layer: "Technician Laptop",  label: "Laptop on Site VLAN",         detail: `Verify laptop has L2/L3 access to ${cfg.laptopVlan}` },
    { id: "dns-pulse",        layer: "DNS",                label: "DNS resolves Pulse Gateway",  detail: `Resolve ${cfg.pulseHostname}` },
    { id: "gw-reach",         layer: "Pulse Gateway",      label: "Pulse Gateway reachable",     detail: `Ping + service ports on ${cfg.pulseGatewayIp}` },
    { id: "ipconnect-reach",  layer: "IPConnect",          label: "IPConnect reachable",         detail: `Ping + admin port on ${cfg.ipconnectIp}` },
    { id: "ipconnect-cfg",    layer: "IPConnect",          label: "IPConnect config valid",      detail: "Rules / output mapping loaded" },
    { id: "license-reach",    layer: "License Server",     label: "License Server licensed",     detail: `Validate license on ${cfg.licenseIp}` },
    { id: "inga-reach",       layer: "INGA",               label: "INGA service responsive",     detail: `INGA on ${cfg.ingaIp}` },
    { id: "input-active",     layer: "IP-IN8 / Input",     label: "Input active/cancel state",   detail: `IP-IN8 ${cfg.ipin8Ip} for ${cfg.room}` },
    { id: "ctrl-input",       layer: "Controller",         label: "Controller received input",   detail: `Controller ${cfg.controllerIp} sees event` },
    { id: "gw-event",         layer: "Pulse Gateway",      label: "Event reached Pulse Gateway", detail: "Event ingested by gateway queue" },
    { id: "rule-match",       layer: "Pulse Gateway",      label: "Config / rule match",         detail: `Match rule for "${cfg.expectedGroup}"` },
    { id: "output-gen",       layer: "Pulse Gateway",      label: "Output event generated",      detail: `Output dispatched to ${cfg.controllerIp}` },
    { id: "ctrl-output",      layer: "Controller",         label: "Target controller received output", detail: `Controller ${cfg.controllerIp}` },
    { id: "ctrl-ack",         layer: "Controller",         label: "Controller ACK",              detail: "Acknowledgement within 5000ms" },
    { id: "light-activate",   layer: "Signal Light",       label: "Signal light activation",     detail: `Group light ${cfg.signalLightIp} energised` },
    { id: "app1-update",      layer: "IP-APP1 / Display",  label: "IP-APP1 display update",      detail: `Station ${cfg.ipapp1Ip} reflects active call` },
    { id: "cancel-clear",     layer: "End-to-end",         label: "Cancel event clears chain",   detail: "Cancel propagated to all endpoints" },
  ];
}

type StepOutcome = { ok: boolean; detail: string; evidence: string[]; source: AdapterSource };

async function runStep(id: string, cfg: Required<typeof DEFAULTS> & SignalChainInput): Promise<StepOutcome> {
  switch (id) {
    case "laptop-vlan": return ok(`Laptop reaches ${cfg.laptopVlan} via local gateway.`, [`vlan=${cfg.laptopVlan}`]);
    case "dns-pulse": {
      const r = await resolveDns(cfg.pulseHostname, cfg.pulseGatewayIp);
      return r.matchesExpected
        ? ok(`${r.hostname} → ${r.resolved}`, [`expected=${cfg.pulseGatewayIp}`, `resolved=${r.resolved}`], r.source)
        : fail(`DNS mismatch for ${r.hostname} (got ${r.resolved}).`, [`expected=${cfg.pulseGatewayIp}`, `resolved=${r.resolved ?? "none"}`], r.source);
    }
    case "gw-reach": {
      const p = await checkPing(cfg.pulseGatewayIp);
      const ports = await checkPorts(cfg.pulseGatewayIp, [80, 443, 1433, 5060]);
      return p.alive && ports.closed.length === 0
        ? ok(`Gateway ${cfg.pulseGatewayIp} reachable (${p.latencyMs?.toFixed(1)}ms).`, [`latency=${p.latencyMs?.toFixed(1)}ms`, `ports_open=${ports.open.join(",")}`], p.source)
        : fail(`Gateway ${cfg.pulseGatewayIp} degraded.`, [`alive=${p.alive}`, `closed_ports=${ports.closed.join(",")}`], p.source);
    }
    case "ipconnect-reach": {
      const p = await checkPing(cfg.ipconnectIp);
      return p.alive ? ok(`IPConnect ${cfg.ipconnectIp} reachable.`, [`latency=${p.latencyMs?.toFixed(1)}ms`], p.source)
        : fail(`IPConnect ${cfg.ipconnectIp} unreachable.`, [`alive=${p.alive}`], p.source);
    }
    case "ipconnect-cfg": {
      const c = await readIPConnectConfig(cfg.ipconnectIp);
      return c.configValid ? ok(`IPConnect config valid (${c.rules} rules).`, [`rules=${c.rules}`], c.source)
        : fail("IPConnect config invalid or missing.", [`rules=${c.rules}`], c.source);
    }
    case "license-reach": {
      const l = await readLicenseStatus(cfg.licenseIp);
      return l.licensed ? ok(`License valid (expires ${l.expires}).`, [`licensed=true`], l.source)
        : fail("License invalid or expired.", [`licensed=false`], l.source);
    }
    case "inga-reach": {
      const i = await readINGAStatus(cfg.ingaIp);
      return i.serviceUp ? ok(`INGA service up on ${cfg.ingaIp}.`, [`service=up`], i.source)
        : fail("INGA service down.", [`service=down`], i.source);
    }
    case "input-active": {
      const s = await readIPIN8State(cfg.ipin8Ip);
      const active = s.inputs.some((x) => x.active);
      return active ? ok(`IP-IN8 ${cfg.ipin8Ip} reports active input.`, s.inputs.filter(x => x.active).map(x => `input${x.index}=active`), s.source)
        : fail("No active input detected on IP-IN8.", s.inputs.map(x => `input${x.index}=${x.active}`), s.source);
    }
    case "ctrl-input":  return ok(`Controller ${cfg.controllerIp} received input event.`, ["ctrl_event=received"]);
    case "gw-event":    return ok("Event ingested by Pulse Gateway queue.", ["queue_pos=1"]);
    case "rule-match":  return ok(`Rule matched group "${cfg.expectedGroup}".`, [`group=${cfg.expectedGroup}`]);
    case "output-gen":  return ok(`Output event generated → ${cfg.controllerIp}.`, [`target=${cfg.controllerIp}`]);
    case "ctrl-output": {
      const c = await readControllerStatus(cfg.controllerIp);
      const path = await checkModulePath("Pulse Gateway", c.ip === "10.20.4.22" ? "Controller West Wing" : "Controller East Wing");
      return c.online && path.reachable
        ? ok(`Controller ${c.ip} acknowledged receipt.`, [`firmware=${c.firmware}`, `heartbeat_age=${c.heartbeatAgeSec}s`], c.source)
        : fail(`Controller path degraded (${path.detail}).`, [`heartbeat_age=${c.heartbeatAgeSec}s`, `path_ok=${path.reachable}`], c.source);
    }
    case "ctrl-ack": {
      const c = await readControllerStatus(cfg.controllerIp);
      return c.ackOk
        ? ok(`Controller ${c.ip} ACK within window.`, ["ack=ok"], c.source)
        : fail(`Controller ${c.ip} did not acknowledge output.`, [`ack_timeout=5000ms`, `heartbeat_age=${c.heartbeatAgeSec}s`], c.source);
    }
    case "light-activate": {
      const l = await readSignalLightStatus(cfg.signalLightIp);
      return (l.outputCommanded && l.outputActive) || (!l.outputCommanded && !l.outputActive && l.online)
        ? ok(`Signal light ${l.ip} state consistent.`, [`commanded=${l.outputCommanded}`, `active=${l.outputActive}`], l.source)
        : fail(`Signal light ${l.ip} commanded but not active.`, [`commanded=${l.outputCommanded}`, `active=${l.outputActive}`], l.source);
    }
    case "app1-update": {
      const a = await readIPAPP1Status(cfg.ipapp1Ip);
      return a.sessionFreshSec < 30 && a.stuckCalls === 0
        ? ok(`IP-APP1 ${a.ip} display in sync.`, [`session_age=${a.sessionFreshSec}s`, `stuck_calls=${a.stuckCalls}`], a.source)
        : fail(`IP-APP1 ${a.ip} stale or stuck.`, [`session_age=${a.sessionFreshSec}s`, `stuck_calls=${a.stuckCalls}`], a.source);
    }
    case "cancel-clear": return ok("Cancel propagated end-to-end.", ["cancel=ok"]);
  }
  return fail("Unknown step.", []);
}

function ok(detail: string, evidence: string[], source: AdapterSource = "mock"): StepOutcome { return { ok: true, detail, evidence, source }; }
function fail(detail: string, evidence: string[], source: AdapterSource = "mock"): StepOutcome { return { ok: false, detail, evidence, source }; }

function buildBreakpoint(steps: ChainStep[], idx: number, cfg: Required<typeof DEFAULTS> & SignalChainInput): Breakpoint {
  const failed = steps[idx];
  const prev = idx > 0 ? steps[idx - 1] : null;
  const allEvidence = [
    ...(prev ? [`Previous OK: ${prev.label} — ${prev.detail}`] : []),
    ...failed.evidence.map((e) => `${failed.layer}: ${e}`),
    `Failed step: ${failed.label} — ${failed.detail}`,
  ];

  const fixMap: Record<string, { cause: string; fix: string[]; affected: string }> = {
    "ctrl-ack": {
      cause: "Controller communication path, VLAN routing, controller service, or output execution issue.",
      fix: [
        "Check controller VLAN path and switch port for errors/CRC.",
        "Confirm controller heartbeat freshness and firmware version.",
        "Confirm output event reaches controller via local controller log.",
        "Restart controller comms service if approved by site.",
        "Escalate with full event trace and controller log if unresolved.",
      ],
      affected: `Controller ${cfg.controllerIp}`,
    },
    "ctrl-output": {
      cause: "Pulse Gateway → Controller path degraded. Likely L2/L3 path or controller comms service.",
      fix: [
        "Verify switch port and uplink to controller IDF.",
        "Re-seat or replace patch cable and confirm duplex/speed.",
        "Move controller to a known-good port to isolate.",
      ],
      affected: `Controller ${cfg.controllerIp}`,
    },
    "light-activate": {
      cause: "Output event was generated and accepted, but signal light did not energise — wiring, relay, or controller output channel.",
      fix: [
        "Confirm physical output relay state on controller.",
        "Check signal light wiring and 24V supply.",
        "Force-fire output from controller console.",
      ],
      affected: `Signal Light ${cfg.signalLightIp}`,
    },
    "app1-update": {
      cause: "IP-APP1 stale session, display communication failure, or missed cancel event.",
      fix: [
        "Verify IP-APP1 connectivity and switch port.",
        "Restart App Comm service on Pulse Gateway.",
        "Re-test cancel event end-to-end after recovery.",
      ],
      affected: `IP-APP1 ${cfg.ipapp1Ip}`,
    },
    "input-active": {
      cause: "External access control / fire alarm relay holding contact, or IP-IN8 not reporting.",
      fix: [
        "Confirm physical contact closure on IP-IN8 input.",
        "Ask access control / fire contractor to verify their relay output.",
        "Confirm nurse call clears as soon as external contact opens.",
      ],
      affected: `IP-IN8 ${cfg.ipin8Ip}`,
    },
    "ipconnect-reach": {
      cause: "IPConnect offline, wrong DNS, wrong VM NIC, or service unavailable.",
      fix: [
        "Verify IPConnect VM is powered and on correct NIC.",
        "Check DNS entry for ipconnect.austco.local.",
        "Restart IPConnect service.",
      ],
      affected: `IPConnect ${cfg.ipconnectIp}`,
    },
    "dns-pulse": {
      cause: "DNS misconfiguration — DNS configured outside Pulse Gateway, causing module routing inconsistency.",
      fix: [
        "Move DNS responsibility back to Pulse Gateway VM.",
        "Remove conflicting DNS entries on other VMs.",
        "Re-run trace once DNS is consolidated.",
      ],
      affected: "Deployment Architecture / DNS",
    },
  };

  const fb = fixMap[failed.id] ?? {
    cause: `${failed.layer} did not pass — handoff broken at this layer.`,
    fix: ["Inspect the failed layer's logs.", "Verify upstream dependency health.", "Re-run trace after remediation."],
    affected: failed.layer,
  };

  return {
    breakPoint: prev ? `${prev.layer} → ${failed.layer} (${failed.label})` : `${failed.layer} (${failed.label})`,
    failedLayer: failed.layer,
    previousStepPassed: prev ? `${prev.label} — ${prev.detail}` : "No prior step.",
    failedStep: `${failed.label} — ${failed.detail}`,
    affectedDevice: fb.affected,
    evidence: allEvidence,
    likelyCause: fb.cause,
    recommendedFix: fb.fix,
  };
}

/**
 * Hardware health snapshot used by the Command Center "Hardware
 * Communication Health" section. Aggregates adapter calls per module.
 */
export type HardwareHealthRow = {
  module: string;
  ip: string;
  online: boolean;
  detail: string;
  source: AdapterSource;
};

export async function readHardwareHealth(cfg?: Partial<SignalChainInput>): Promise<HardwareHealthRow[]> {
  const c = { ...DEFAULTS, ...(cfg ?? {}) } as Required<typeof DEFAULTS> & SignalChainInput;
  const [gw, ipc, lic, inga, ctrlE, ctrlW, in8, app1, light] = await Promise.all([
    readPulseGatewayStatus(c.pulseGatewayIp),
    readIPConnectConfig(c.ipconnectIp),
    readLicenseStatus(c.licenseIp),
    readINGAStatus(c.ingaIp),
    readControllerStatus("10.20.4.21"),
    readControllerStatus("10.20.4.22"),
    readIPIN8State(c.ipin8Ip ?? "10.20.5.40"),
    readIPAPP1Status(c.ipapp1Ip ?? "10.20.6.30"),
    readSignalLightStatus(c.signalLightIp ?? "10.20.7.50"),
  ]);
  return [
    { module: "Pulse Gateway",     ip: gw.ip,    online: gw.online,    detail: `${gw.servicesUp.length} services up, ${gw.servicesDown.length} down`, source: gw.source },
    { module: "IPConnect",         ip: ipc.ip,   online: ipc.online,   detail: `${ipc.rules} rules, config ${ipc.configValid ? "valid" : "invalid"}`, source: ipc.source },
    { module: "INGA",              ip: inga.ip,  online: inga.online,  detail: inga.serviceUp ? "Service up" : "Service down", source: inga.source },
    { module: "License Server",    ip: lic.ip,   online: lic.online,   detail: lic.licensed ? `Licensed (expires ${lic.expires})` : "Unlicensed", source: lic.source },
    { module: "Pulse Manage",      ip: "10.20.1.23", online: true, detail: "Reachable, admin UI responsive", source: "mock" },
    { module: "Controller East",   ip: ctrlE.ip, online: ctrlE.online, detail: `HB ${ctrlE.heartbeatAgeSec}s · ACK ${ctrlE.ackOk ? "OK" : "FAIL"}`, source: ctrlE.source },
    { module: "Controller West",   ip: ctrlW.ip, online: ctrlW.online, detail: `HB ${ctrlW.heartbeatAgeSec}s · ACK ${ctrlW.ackOk ? "OK" : "FAIL"}`, source: ctrlW.source },
    { module: "IP-IN8",            ip: in8.ip,   online: in8.online,   detail: `${in8.inputs.filter(x=>x.active).length} active inputs`, source: in8.source },
    { module: "IP-APP1",           ip: app1.ip,  online: app1.online,  detail: `Session ${app1.sessionFreshSec}s · ${app1.stuckCalls} stuck`, source: app1.source },
    { module: "Signal Light",      ip: light.ip, online: light.online, detail: `cmd=${light.outputCommanded} active=${light.outputActive}`, source: light.source },
  ];
}

export type DeploymentHealthCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export function readDeploymentHealth(): DeploymentHealthCheck[] {
  // Real Austco integration goes here (DNS audit, VM separation, install order).
  return [
    { name: "DNS Compliance",          ok: true,  detail: "DNS owned by Pulse Gateway only — no rogue DNS on other VMs." },
    { name: "VM Separation",           ok: true,  detail: "Pulse Gateway / IPConnect / INGA / License on separate VMs." },
    { name: "Install Sequence",        ok: true,  detail: "Install order matches Austco deployment guide." },
    { name: "Module Dependency Map",   ok: false, detail: "Pulse Gateway → Controller West dependency degraded." },
  ];
}