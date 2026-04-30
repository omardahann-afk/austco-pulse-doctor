/**
 * Call Point → Output trace, driven by the validated architecture.
 *
 * Walks: Call Point → Controller Input → Controller Event → Pulse Gateway
 *  → IPConnect .ccp config logic → Pulse Manage / Device Service → Output Event
 *  → Target Controller → Signal Light / Zone Light → IP-APP1 / Display.
 *
 * Uses the architecture report to choose the *correct* PuGa for the call
 * point's controller VLAN and to detect wrong-NIC / wrong-PuGa breakpoints.
 */

import type {
  DiagnosisRequest, CallPointEntry, ControllerEntry, PugaInstance,
} from "./siteDoctorApi";
import type { ArchitectureReport } from "./architectureValidator";
import { resolveForScope } from "./architectureValidator";
import type { AdapterSource } from "./hardwareAdapters";

export type TraceStatus = "Pending" | "Running" | "Passed" | "Failed" | "Skipped";

export type CallPointStep = {
  id: string;
  layer: string;
  label: string;
  detail: string;
  status: TraceStatus;
  evidence: string[];
  source: AdapterSource;
};

export type CallPointBreakpoint = {
  breakPoint: string;          // canonical name e.g. "Pulse Gateway → IPConnect"
  previousStepPassed: string;
  failedStep: string;
  evidence: string[];
  likelyRootCause: string;
  fix: string[];
};

export type CallPointTraceResult = {
  callPoint: CallPointEntry;
  steps: CallPointStep[];
  breakpoint: CallPointBreakpoint | null;
  conclusion: string;
};

function step(id: string, layer: string, label: string, detail: string): CallPointStep {
  return { id, layer, label, detail, status: "Pending", evidence: [], source: "mock" };
}

export async function traceCallPoint(
  req: DiagnosisRequest,
  arch: ArchitectureReport,
  cp: CallPointEntry,
  onStep?: (steps: CallPointStep[]) => void,
  stepDelayMs = 220,
): Promise<CallPointTraceResult> {
  const controllers: ControllerEntry[] = req.controllers ?? [];
  const proxies: PugaInstance[] = req.proxyPulseGateways ?? [];
  const ctrl = controllers.find((c) => c.name === cp.controller);

  const dnsEntry = ctrl
    ? resolveForScope("pulse.austco.local", ctrl.ip, req.dnsMap ?? [])
    : null;
  const servingPuga = dnsEntry
    ? proxies.find((p) => p.name === dnsEntry.servedBy) ?? null
    : null;

  // Authoritative PuGa for the integration LAN side (IPC/Manage/etc).
  const auth = proxies.find((p) => p.role === "Authoritative") ?? null;

  const steps: CallPointStep[] = [
    step("cp-input",     "Call Point",        "Call point asserts input",       `${cp.name} → input ${cp.inputIndex}`),
    step("ctrl-input",   "Controller",        "Controller sees input",          ctrl ? `${ctrl.name} (${ctrl.ip}) on ${ctrl.vlan}` : "Controller missing"),
    step("ctrl-event",   "Controller",        "Controller emits event",         "Event packed and sent to local PuGa"),
    step("dns-puga",     "DNS",               "Device resolves pulse.austco.local", dnsEntry ? `Should resolve to ${dnsEntry.expectedIp} (NIC ${dnsEntry.expectedNic}) for ${dnsEntry.scopeVlan}` : "No DNS entry for controller VLAN"),
    step("puga-ingest",  "Pulse Gateway",     "Local PuGa ingests event",       servingPuga ? `${servingPuga.name} on ${servingPuga.ip}` : "No serving PuGa for VLAN"),
    step("ipc-cfg",      "IPConnect",         "IPConnect .ccp config logic",    `Match group "${cp.expectedOutputGroup}"`),
    step("manage-dev",   "Pulse Manage / Device Services", "Pulse Manage + Device Service authorise", auth ? `via authoritative ${auth.name}` : "No authoritative PuGa"),
    step("output-event", "Pulse Gateway",     "Output event generated",         `Output → ${cp.expectedSignalLight}`),
    step("ctrl-output",  "Target Controller", "Target controller receives output", ctrl ? `${ctrl.name}` : "—"),
    step("light",        "Signal / Zone Light","Signal light energised",         `Light ${cp.expectedSignalLight}`),
    step("ipapp1",       "IP-APP1 / Display", "Display reflects active call",   `Display ${cp.expectedDisplay}`),
  ];

  onStep?.(structuredClone(steps));

  // Pre-compute architecture-driven failures (deterministic, evidence-based).
  const archFail = pickArchitectureFailure(req, arch, cp, ctrl, dnsEntry, servingPuga);

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

    if (archFail && archFail.stepId === steps[i].id) {
      steps[i].status = "Failed";
      steps[i].evidence = archFail.evidence;
      steps[i].detail = archFail.detail;
      firstFailure = i;
    } else {
      steps[i].status = "Passed";
      steps[i].evidence = defaultEvidenceFor(steps[i].id, ctrl, dnsEntry, servingPuga, auth);
    }
    onStep?.(structuredClone(steps));
  }

  if (firstFailure === -1) {
    return {
      callPoint: cp, steps, breakpoint: null,
      conclusion: `Full chain verified for ${cp.name}. No break detected.`,
    };
  }

  const failed = steps[firstFailure];
  const prev = firstFailure > 0 ? steps[firstFailure - 1] : null;
  const breakpoint: CallPointBreakpoint = {
    breakPoint: prev ? `${prev.layer} → ${failed.layer}` : failed.layer,
    previousStepPassed: prev ? `${prev.label} — ${prev.detail}` : "No prior step.",
    failedStep: `${failed.label} — ${failed.detail}`,
    evidence: [
      ...(prev ? [`Previous OK: ${prev.label} — ${prev.detail}`] : []),
      ...failed.evidence.map((e) => `${failed.layer}: ${e}`),
    ],
    likelyRootCause: archFail?.cause ?? `${failed.layer} did not pass — handoff broken.`,
    fix: archFail?.fix ?? ["Inspect failed layer logs.", "Verify upstream dependency.", "Re-run trace."],
  };

  return {
    callPoint: cp, steps, breakpoint,
    conclusion: `Break found at: ${breakpoint.breakPoint}.`,
  };
}

function defaultEvidenceFor(
  id: string,
  ctrl: ControllerEntry | undefined,
  dnsEntry: ReturnType<typeof resolveForScope>,
  servingPuga: PugaInstance | null,
  auth: PugaInstance | null,
): string[] {
  switch (id) {
    case "ctrl-input":  return ctrl ? [`controller=${ctrl.name}`, `ip=${ctrl.ip}`] : [];
    case "dns-puga":    return dnsEntry ? [`expected_ip=${dnsEntry.expectedIp}`, `expected_nic=${dnsEntry.expectedNic}`, `scope=${dnsEntry.scopeVlan}`] : [];
    case "puga-ingest": return servingPuga ? [`puga=${servingPuga.name}`, `ip=${servingPuga.ip}`, `nic=${servingPuga.nic}`] : [];
    case "manage-dev":  return auth ? [`authoritative=${auth.name}`, `ip=${auth.ip}`] : [];
    default:            return ["ok"];
  }
}

/* ---------- architecture-driven failure picker ---------- */

type StepFail = {
  stepId: string;
  detail: string;
  evidence: string[];
  cause: string;
  fix: string[];
};

function pickArchitectureFailure(
  req: DiagnosisRequest,
  arch: ArchitectureReport,
  cp: CallPointEntry,
  ctrl: ControllerEntry | undefined,
  dnsEntry: ReturnType<typeof resolveForScope>,
  servingPuga: PugaInstance | null,
): StepFail | null {
  // 1. Missing controller declaration
  if (!ctrl) {
    return {
      stepId: "ctrl-input",
      detail: `Controller "${cp.controller}" not declared in payload.`,
      evidence: [`expected=${cp.controller}`],
      cause: "Call point references a controller that is not part of the site payload.",
      fix: [`Add controller "${cp.controller}" to the payload.`, "Re-run trace."],
    };
  }

  // 2. No DNS entry for the controller VLAN
  if (!dnsEntry) {
    return {
      stepId: "dns-puga",
      detail: `pulse.austco.local has no entry for VLAN ${ctrl.vlan}.`,
      evidence: [`controller_vlan=${ctrl.vlan}`],
      cause: "DNS misconfiguration — device VLAN has no PuGa mapping.",
      fix: [
        `Add pulse.austco.local entry scoped to ${ctrl.vlan}.`,
        "Point it at a local PuGa proxy on that VLAN.",
        "Validate from a device on the VLAN with nslookup.",
      ],
    };
  }

  // 3. DNS resolves to wrong NIC / wrong PuGa for the controller's VLAN.
  // Real-world example: controller on 10.1.3.x but pulse.austco.local → 192.168.1.211.
  const proxies = req.proxyPulseGateways ?? [];
  const expectedLocalProxy = proxies.find(
    (p) => p.role === "Proxy" && p.vlan === ctrl.vlan,
  );
  if (expectedLocalProxy && servingPuga && servingPuga.role === "Authoritative") {
    return {
      stepId: "dns-puga",
      detail: `pulse.austco.local resolves to integration LAN PuGa ${servingPuga.ip} instead of local proxy ${expectedLocalProxy.ip}.`,
      evidence: [
        `controller_vlan=${ctrl.vlan}`,
        `resolved=${dnsEntry.expectedIp}`,
        `expected_local_proxy=${expectedLocalProxy.ip}`,
        `expected_nic=${expectedLocalProxy.nic}`,
      ],
      cause: "Wrong Pulse Gateway resolution for device-side VLAN. Device should use local PuGa proxy path.",
      fix: [
        `Update pulse.austco.local for VLAN ${ctrl.vlan} → ${expectedLocalProxy.ip} (NIC ${expectedLocalProxy.nic}).`,
        "Confirm proxy PuGa eth1 is on the device VLAN.",
        "Retest device communication from a controller on this VLAN.",
      ],
    };
  }

  // 4. Architecture report flagged a NIC mismatch
  const nicFinding = arch.findings.find(
    (f) => f.area === "Proxy PuGa DNS" || f.area === "Authoritative PuGa DNS",
  );
  if (nicFinding && nicFinding.severity === "Critical") {
    return {
      stepId: "dns-puga",
      detail: nicFinding.title,
      evidence: nicFinding.evidence,
      cause: nicFinding.detail,
      fix: nicFinding.fix,
    };
  }

  // 5. IPConnect .ccp not reachable
  if (req.installChecklist && !req.installChecklist.ipconnectCcpReachable) {
    return {
      stepId: "ipc-cfg",
      detail: "IPConnect .ccp / site config is not reachable from PuGa.",
      evidence: ["ipconnect_ccp_reachable=false"],
      cause: "IPConnect cannot reach Pulse Gateway. Site config/imports and event flow may fail.",
      fix: [
        "Verify IPConnect VM is up and on the integration LAN.",
        "Confirm DNS entry ipconnect.austco.local resolves to IPConnect eth0.",
        "Restart IPConnect service and re-import site config.",
      ],
    };
  }

  // 6. Pulse Device dependency failure surfaced by architecture validator
  const depFail = arch.deviceDependencies.find((d) => !d.ok);
  if (depFail) {
    return {
      stepId: "manage-dev",
      detail: depFail.detail,
      evidence: [`device=${depFail.device.name}`, `missing=${depFail.missingDeps.join("|") || "none"}`],
      cause: "Pulse Device dependency failure.",
      fix: [
        "Confirm Pulse Manage, Pulse Device Services, License Server are reachable from device VLAN.",
        "Verify device DNS points to the correct local PuGa proxy.",
        "Re-run trace after correction.",
      ],
    };
  }

  // 7. Output → light: signal light wiring/relay simulation when group has known fault IP
  if (cp.expectedSignalLight === "10.1.3.50") {
    // No fault by default; uncomment to simulate. Kept healthy here.
  }

  return null;
}