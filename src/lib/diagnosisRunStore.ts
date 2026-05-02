/**
 * Diagnosis Run Store
 * --------------------
 * Lightweight module-level store that holds the OUTPUT of the most recent
 * `Run Full Diagnosis` invocation, so the input page (`/`) can hand off to
 * the trace-first results page (`/diagnosis`) without prop drilling or a
 * heavy state library.
 *
 * The store is also responsible for actually running the diagnosis (calling
 * the existing engines: breakpoint, callPoint, roomController, architecture,
 * and the optional local-bridge backend). Engines are unchanged — this is
 * pure orchestration + storage.
 */

import { useSyncExternalStore } from "react";
import {
  type DiagnosisRequest, type DiagnosisResponse, runDiagnosis,
  type CallPointEntry,
} from "./siteDoctorApi";
import {
  traceSignalPath, readHardwareHealth, readDeploymentHealth,
  type ChainStep, type Breakpoint,
  type HardwareHealthRow, type DeploymentHealthCheck,
} from "./breakpointEngine";
import { validateArchitecture, type ArchitectureReport } from "./architectureValidator";
import { traceCallPoint, type CallPointStep, type CallPointBreakpoint } from "./callPointTrace";
import {
  buildRoomControllerReports, traceCallpointSim046,
  type RcReport, type RcTraceStep, type RcTraceBreak,
  type ConfigEvidence,
} from "./roomControllerDoctor";
import type { ServiceTarget, ServiceLogResult } from "./logEngine";
import { parseCcp, EMPTY_PARSE, type CcpParseResult } from "./ccpParser";
import { validateCcp, type CcpFinding, type CcpValidationResult } from "./ccpDoctor";
import { analyzeNetwork, type NetworkAnalysis } from "./networkDoctor";
import { pollSnmp } from "./snmpBridge";

export type ModuleToggleKey =
  | "pulseGateway" | "ipconnect" | "inga" | "license"
  | "controllers" | "webDevices" | "vocera" | "voip";

export type ModuleToggles = Record<ModuleToggleKey, boolean>;

export const DEFAULT_MODULE_TOGGLES: ModuleToggles = {
  pulseGateway: true,
  ipconnect: true,
  inga: true,
  license: true,
  controllers: true,
  webDevices: false,
  vocera: false,
  voip: false,
};

export type RunState =
  | { status: "idle" }
  | { status: "running"; startedAt: string }
  | { status: "ready"; finishedAt: string; site: string; deploymentType: string; backendOk: boolean; backendMessage?: string }
  | { status: "error"; message: string };

export type DiagnosisRunSnapshot = {
  state: RunState;
  /** Snapshot of the inputs used for this run. */
  payload: DiagnosisRequest | null;
  services: ServiceTarget[];
  modules: ModuleToggles;
  backendUrl: string;

  /** Outputs */
  backendResult: DiagnosisResponse | null;
  hwHealth: HardwareHealthRow[] | null;
  deployHealth: DeploymentHealthCheck[] | null;
  chainSteps: ChainStep[];
  chainBreak: Breakpoint | null;
  chainConclusion: string;
  arch: ArchitectureReport | null;
  cpSteps: CallPointStep[];
  cpBreak: CallPointBreakpoint | null;
  cpConclusion: string;
  tracedCallPoint: CallPointEntry | null;
  rcReports: RcReport[] | null;
  rcSteps: RcTraceStep[];
  rcBreak: RcTraceBreak | null;
  rcConclusion: string;
  logAnalysis: ServiceLogResult[] | null;
  /* CCP — config truth layer */
  ccpParse: CcpParseResult;
  ccpStep: RcTraceStep | null;
  ccpFindings: CcpFinding[];
  ccpOverride: CcpValidationResult["override"];
  ccpConclusion: string;
  /* Network infrastructure — physical/L2/L3 truth layer */
  network: NetworkAnalysis | null;
};

let snap: DiagnosisRunSnapshot = {
  state: { status: "idle" },
  payload: null,
  services: [],
  modules: { ...DEFAULT_MODULE_TOGGLES },
  backendUrl: "",
  backendResult: null,
  hwHealth: null,
  deployHealth: null,
  chainSteps: [],
  chainBreak: null,
  chainConclusion: "",
  arch: null,
  cpSteps: [],
  cpBreak: null,
  cpConclusion: "",
  tracedCallPoint: null,
  rcReports: null,
  rcSteps: [],
  rcBreak: null,
  rcConclusion: "",
  logAnalysis: null,
  ccpParse: { ...EMPTY_PARSE },
  ccpStep: null,
  ccpFindings: [],
  ccpOverride: null,
  ccpConclusion: "",
  network: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<DiagnosisRunSnapshot>) => { snap = { ...snap, ...patch }; emit(); };

function subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); }
const getSnapshot = () => snap;

export function useDiagnosisRun() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Read latest snapshot outside React (e.g. navigation guards). */
export function readDiagnosisRun() { return snap; }

/* ------------------------------------------------------------------ */

export type StartDiagnosisInput = {
  payload: DiagnosisRequest;
  services: ServiceTarget[];
  modules: ModuleToggles;
  backendUrl: string;
};

/** Run the full diagnostic pipeline and update the store as steps complete. */
export async function startDiagnosis(input: StartDiagnosisInput): Promise<void> {
  const startedAt = new Date().toISOString();
  // Reset prior outputs but keep inputs.
  set({
    state: { status: "running", startedAt },
    payload: input.payload,
    services: input.services,
    modules: input.modules,
    backendUrl: input.backendUrl,
    backendResult: null, hwHealth: null, deployHealth: null,
    chainSteps: [], chainBreak: null, chainConclusion: "",
    arch: null, cpSteps: [], cpBreak: null, cpConclusion: "", tracedCallPoint: null,
    rcReports: null, rcSteps: [], rcBreak: null, rcConclusion: "", logAnalysis: null,
    ccpParse: { ...EMPTY_PARSE }, ccpStep: null, ccpFindings: [], ccpOverride: null, ccpConclusion: "",
    network: null,
  });

  try {
    const { payload } = input;
    /* ---- Parse CCP first so it can drive everything downstream ---- */
    const ccpInput = payload.ccpConfig;
    const ccpRaw = ccpInput?.rawText ?? "";
    const ccpParse = parseCcp(ccpRaw);
    const ccpResult = validateCcp(payload, ccpParse);
    set({
      ccpParse, ccpStep: ccpResult.step, ccpFindings: ccpResult.findings,
      ccpOverride: ccpResult.override, ccpConclusion: ccpResult.conclusion,
    });

    /* ---- Network infrastructure (Parts 1-8 + 13). Best-effort SNMP. ---- */
    const infra = payload.networkInfrastructure;
    if (infra && (infra.switches.length > 0 || infra.expectedConnections.length > 0)) {
      // Show preliminary network analysis built from manual data only,
      // so the UI has something to show even before the SNMP poll returns.
      set({ network: analyzeNetwork(payload) });
      void pollSnmp({
        switches: infra.switches,
        arpHints: [
          ...payload.knownDevices.map((d) => d.ip),
          ...(payload.roomControllers ?? []).map((r) => r.ip).filter(Boolean) as string[],
        ],
      }).then((snmp) => {
        set({ network: analyzeNetwork(payload, snmp) });
      });
    }

    // Pick representative IPs for the hardware/breakpoint engines.
    const firstCtrl  = payload.knownDevices.find((d) => /controller/i.test(d.type))?.ip ?? "10.20.4.22";
    const firstApp1  = payload.knownDevices.find((d) => /app1/i.test(d.type))?.ip       ?? "10.20.6.30";
    const firstIn8   = payload.knownDevices.find((d) => /in8/i.test(d.type))?.ip        ?? "10.20.5.40";
    const firstLight = payload.knownDevices.find((d) => /light/i.test(d.type))?.ip      ?? "10.20.7.50";

    // Deployment + architecture are synchronous.
    const deployHealth = readDeploymentHealth();
    const arch = validateArchitecture(payload);
    set({ deployHealth, arch });

    // Hardware probe (mock-deterministic).
    const hwPromise = readHardwareHealth({
      controllerIp: firstCtrl, ipapp1Ip: firstApp1, ipin8Ip: firstIn8,
      signalLightIp: firstLight, pulseGatewayIp: payload.virtualIp ?? undefined,
    });

    // Live signal-chain trace, streaming step updates into the store.
    const chainPromise = traceSignalPath(
      {
        room: "Room 230", expectedGroup: "East Wing Signal Lights",
        ipin8Ip: firstIn8, controllerIp: firstCtrl,
        ipapp1Ip: firstApp1, signalLightIp: firstLight,
        pulseGatewayIp: payload.virtualIp ?? undefined,
      },
      (steps) => set({ chainSteps: steps }),
      80,
    );

    // Call-point + SIM-046 traces, also streaming.
    const firstCp = payload.callPoints?.[0] ?? null;
    if (firstCp) {
      set({ tracedCallPoint: firstCp, rcReports: buildRoomControllerReports(payload) });
      void traceCallPoint(payload, arch, firstCp, (s) => set({ cpSteps: s }), 80)
        .then((r) => set({ cpBreak: r.breakpoint, cpConclusion: r.conclusion }));
      void traceCallpointSim046(payload, firstCp, (s) => set({ rcSteps: s }), 60)
        .then((r) => set({ rcBreak: r.breakpoint, rcConclusion: r.conclusion }));
    } else {
      set({ rcReports: buildRoomControllerReports(payload) });
    }

    // Backend + SSH log collection (optional — degrades gracefully).
    let backendOk = false;
    let backendMessage: string | undefined;
    const backendPromise = runDiagnosis({ ...payload, services: input.services }, input.backendUrl).then(
      (r) => { set({ backendResult: r, logAnalysis: r.logAnalysis ?? null }); backendOk = true; return null; },
      (err) => { backendMessage = err instanceof Error ? err.message : String(err); return backendMessage; },
    );

    const [hw, chain] = await Promise.all([hwPromise, chainPromise, backendPromise]);
    set({
      hwHealth: hw,
      chainBreak: chain.breakpoint,
      chainConclusion: chain.conclusion,
      state: {
        status: "ready",
        finishedAt: new Date().toISOString(),
        site: payload.name,
        deploymentType: payload.deploymentType ?? "Standalone",
        backendOk,
        backendMessage,
      },
    });
  } catch (err) {
    set({ state: { status: "error", message: err instanceof Error ? err.message : String(err) } });
  }
}

/* ------------------------------------------------------------------ */
/* Final Result derivation                                            */
/* ------------------------------------------------------------------ */

export type FinalResult = {
  ok: boolean;
  breakAt: string;        // e.g. "Pulse Gateway → IPConnect"
  why: string;
  evidence: string[];
  fix: string[];
  source:
    | "Network Infrastructure"
    | "IPConnect CCP"
    | "SIM-046 Trace"
    | "Call Point Trace"
    | "Signal Chain"
    | "Backend Conclusion"
    | "None";
  /** Source-attributed config evidence rows that prove the finding. */
  configEvidence: ConfigEvidence[];
  /** Layer where the break happened, e.g. "Room Controller". */
  failedLayer?: string;
  /** The previous step that *did* pass — useful context above the trace. */
  previousStepPassed?: string;
  /** Truth-state pillars rendered under the Final Result block. */
  truth: TruthStates;
  /** Other verified failures that did NOT win primary, surfaced inline. */
  secondaryFindings: SecondaryFinding[];
  /** 0-100 confidence score for the primary diagnosis. */
  confidence: number;
  /** Bullet reasons explaining how the confidence was derived. */
  confidenceReasons: string[];
  /** Plain-English explanation of why this source won the priority. */
  priorityExplanation: string;
};

/** Per-pillar truth states. See user spec "Truth states". */
export type NetworkTruth  = "PASS" | "FAIL_VERIFIED" | "NOT_VERIFIED";
export type CcpTruth      = "PASS" | "FAIL_VERIFIED" | "NOT_PROVIDED" | "LOW_CONFIDENCE";
export type BehaviorTruth = "PASS" | "FAIL" | "MOCK";

export type TruthStates = {
  network: NetworkTruth;
  ccp: CcpTruth;
  behavior: BehaviorTruth;
};

export type SecondaryFinding = {
  source: FinalResult["source"];
  breakAt: string;
  why: string;
  evidence: string[];
  fix: string[];
  configEvidence: ConfigEvidence[];
};

/* ------------------------------------------------------------------ */
/* Truth-state computation                                            */
/* ------------------------------------------------------------------ */

/** Network truth: PASS / FAIL_VERIFIED / NOT_VERIFIED. */
function computeNetworkTruth(s: DiagnosisRunSnapshot): NetworkTruth {
  const n = s.network;
  if (!n) return "NOT_VERIFIED";
  if (n.override) return "FAIL_VERIFIED"; // networkDoctor only emits override from verified evidence
  const haveVerified = n.switches.some((sw) => sw.source === "snmp")
    || n.resolvedConnections.some((c) => c.source === "SNMP MAC Table" || c.source === "ARP Table" || c.source === "Network Scan");
  return haveVerified ? "PASS" : "NOT_VERIFIED";
}

/** CCP truth: PASS / FAIL_VERIFIED / NOT_PROVIDED / LOW_CONFIDENCE. */
function computeCcpTruth(s: DiagnosisRunSnapshot): CcpTruth {
  if (s.ccpParse.status === "not_provided") return "NOT_PROVIDED";
  if (s.ccpParse.status === "parse_failed") return "LOW_CONFIDENCE";
  if (s.ccpParse.status === "parsed_low_confidence") {
    // Low-confidence CCP can never produce a verified failure.
    return "LOW_CONFIDENCE";
  }
  return s.ccpOverride ? "FAIL_VERIFIED" : "PASS";
}

/** Behavior truth: real backend logs vs deterministic mock data. */
function computeBehaviorTruth(s: DiagnosisRunSnapshot): BehaviorTruth {
  const anyBreak = !!(s.rcBreak || s.cpBreak || s.chainBreak
    || (s.backendResult && s.backendResult.issues.some((i) => i.severity === "Critical")));
  if (s.logAnalysis && s.logAnalysis.length > 0) return anyBreak ? "FAIL" : "PASS";
  // No real log analysis available — chain/CP/RC engines are deterministic mocks.
  return anyBreak ? "FAIL" : "MOCK";
}

function networkSecondary(s: DiagnosisRunSnapshot): SecondaryFinding | null {
  if (!s.network?.override) return null;
  return {
    source: "Network Infrastructure",
    breakAt: s.network.override.breakPoint,
    why: s.network.override.likelyCause,
    evidence: s.network.override.evidence,
    fix: s.network.override.fix,
    configEvidence: s.network.override.configEvidence,
  };
}

function ccpSecondary(s: DiagnosisRunSnapshot): SecondaryFinding | null {
  if (!s.ccpOverride) return null;
  return {
    source: "IPConnect CCP",
    breakAt: s.ccpOverride.breakPoint,
    why: s.ccpOverride.likelyCause,
    evidence: s.ccpOverride.evidence,
    fix: s.ccpOverride.fix,
    configEvidence: s.ccpOverride.configEvidence,
  };
}

/* ------------------------------------------------------------------ */
/* Confidence scoring                                                 */
/* ------------------------------------------------------------------ */

function scoreConfidence(
  source: FinalResult["source"], truth: TruthStates, evidenceCount: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  if (source === "Network Infrastructure") {
    score = 95; reasons.push("Network failure verified by SNMP / ARP / scan");
    if (truth.ccp === "FAIL_VERIFIED") { score = 98; reasons.push("CCP also reports a verified failure (corroborates)"); }
  } else if (source === "IPConnect CCP") {
    score = 90; reasons.push("CCP parsed and validated against site payload");
    if (truth.behavior === "FAIL") { score = 96; reasons.push("Behavior trace confirms the configuration gap"); }
    if (truth.network === "NOT_VERIFIED") { reasons.push("Network truth not verified — cannot rule out an upstream network issue"); score = Math.min(score, 88); }
  } else if (source === "SIM-046 Trace") {
    score = truth.behavior === "FAIL" ? 82 : 70;
    reasons.push("SIM-046 / Room-Controller trace identified the failed step");
    if (truth.behavior === "MOCK") { score -= 15; reasons.push("Behavior truth is mock — no real log analysis returned"); }
  } else if (source === "Call Point Trace") {
    score = truth.behavior === "FAIL" ? 78 : 65;
    reasons.push("Call-point trace identified the failed step");
    if (truth.behavior === "MOCK") { score -= 15; reasons.push("Behavior truth is mock — no real log analysis returned"); }
  } else if (source === "Signal Chain") {
    score = 60; reasons.push("Signal-chain trace identified the failed layer");
    if (truth.behavior === "MOCK") { score -= 10; reasons.push("Behavior truth is mock — no real log analysis returned"); }
  } else if (source === "Backend Conclusion") {
    score = 70; reasons.push("Backend service returned a critical issue");
  } else {
    score = 55; reasons.push("No verified evidence — provisional finding");
  }
  if (evidenceCount >= 3) { score = Math.min(100, score + 3); reasons.push(`${evidenceCount} evidence rows support the finding`); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

function priorityExplanationFor(source: FinalResult["source"], truth: TruthStates): string {
  if (source === "Network Infrastructure") return "Network is primary because SNMP / ARP / scan verified the failure.";
  if (source === "IPConnect CCP") {
    if (truth.network === "NOT_VERIFIED") return "CCP is primary because the configuration failure is verified and network is not verified.";
    return "CCP is primary because configuration failure is verified and network is not failed.";
  }
  if (source === "SIM-046 Trace" || source === "Call Point Trace" || source === "Signal Chain")
    return "Behavior trace is primary because no verified network or CCP failure was found.";
  if (source === "Backend Conclusion") return "Backend reported a critical issue and no higher-priority verified failure exists.";
  return "No verified failure detected at any layer.";
}

function decorateOk(base: Omit<FinalResult, "confidence" | "confidenceReasons" | "priorityExplanation">): FinalResult {
  const reasons: string[] = [];
  if (base.truth.network === "PASS")  reasons.push("Network truth: PASS (verified)");
  if (base.truth.ccp === "PASS")      reasons.push("CCP truth: PASS (validated)");
  if (base.truth.behavior === "PASS") reasons.push("Behavior truth: PASS (real logs)");
  return {
    ...base,
    confidence: base.truth.behavior === "MOCK" ? 75 : 95,
    confidenceReasons: reasons.length ? reasons : ["No failure detected at any traced layer"],
    priorityExplanation: base.truth.behavior === "MOCK"
      ? "Behavior truth is mock — no real log analysis returned. Result reflects verified config + reachable layers only."
      : "All truth pillars verified or passing.",
  };
}

function decorate(base: Omit<FinalResult, "confidence" | "confidenceReasons" | "priorityExplanation">): FinalResult {
  if (base.ok) return decorateOk(base);
  const { score, reasons } = scoreConfidence(base.source, base.truth, base.evidence.length + base.configEvidence.length);
  return {
    ...base,
    confidence: score,
    confidenceReasons: reasons,
    priorityExplanation: priorityExplanationFor(base.source, base.truth),
  };
}

/**
 * Distill the highest-confidence break across all engines into a single
 * "Where did the system break?" answer for the top of the diagnosis page.
 * Priority: SIM-046 break > Call-point break > generic chain break > backend.
 */
export function deriveFinalResult(s: DiagnosisRunSnapshot): FinalResult {
  // Verified-priority logic. Truth pillars first.
  const truth: TruthStates = {
    network:  computeNetworkTruth(s),
    ccp:      computeCcpTruth(s),
    behavior: computeBehaviorTruth(s),
  };

  // 1. Network FAIL_VERIFIED wins. networkDoctor already enforces "override
  //    only from SNMP / ARP / scan" — manual-only never reaches this branch.
  if (truth.network === "FAIL_VERIFIED" && s.network?.override) {
    const secondary: SecondaryFinding[] = [];
    if (truth.ccp === "FAIL_VERIFIED") {
      const sf = ccpSecondary(s);
      if (sf) secondary.push(sf);
    }
    return decorate({
      ok: false,
      breakAt: s.network.override.breakPoint,
      why: s.network.override.likelyCause,
      evidence: s.network.override.evidence,
      fix: s.network.override.fix,
      source: "Network Infrastructure",
      configEvidence: s.network.override.configEvidence,
      failedLayer: s.network.override.failedLayer,
      previousStepPassed: s.network.override.previousStepPassed,
      truth, secondaryFindings: secondary,
    });
  }

  // 2. CCP FAIL_VERIFIED wins next. Low-confidence CCP cannot reach here
  //    because computeCcpTruth caps it at LOW_CONFIDENCE.
  if (truth.ccp === "FAIL_VERIFIED" && s.ccpOverride) {
    const secondary: SecondaryFinding[] = [];
    // Network may have unverified findings — never promote, but surface as secondary.
    if (s.network && (s.network.findings.length > 0 || s.network.override)) {
      const sf = networkSecondary(s);
      if (sf) secondary.push(sf);
    }
    return decorate({
      ok: false,
      breakAt: s.ccpOverride.breakPoint,
      why: s.ccpOverride.likelyCause,
      evidence: s.ccpOverride.evidence,
      fix: s.ccpOverride.fix,
      source: "IPConnect CCP",
      configEvidence: s.ccpOverride.configEvidence,
      failedLayer: s.ccpOverride.failedLayer,
      previousStepPassed: s.ccpOverride.previousStepPassed,
      truth, secondaryFindings: secondary,
    });
  }

  // 3. Room Controller / IPnet behavior failure.
  if (s.rcBreak) {
    return decorate({
      ok: false,
      breakAt: s.rcBreak.breakPoint,
      why: s.rcBreak.likelyCause,
      evidence: s.rcBreak.evidence,
      fix: s.rcBreak.fix,
      source: "SIM-046 Trace",
      configEvidence: s.rcBreak.configEvidence ?? [],
      failedLayer: s.rcBreak.failedStep,
      previousStepPassed: s.rcBreak.previousStepPassed,
      truth, secondaryFindings: [],
    });
  }

  // 4. Output / physical hardware (call-point + chain).
  if (s.cpBreak) {
    return decorate({
      ok: false,
      breakAt: s.cpBreak.breakPoint,
      why: s.cpBreak.likelyRootCause,
      evidence: s.cpBreak.evidence,
      fix: s.cpBreak.fix,
      source: "Call Point Trace",
      configEvidence: [],
      failedLayer: s.cpBreak.failedStep,
      previousStepPassed: s.cpBreak.previousStepPassed,
      truth, secondaryFindings: [],
    });
  }
  if (s.chainBreak) {
    return decorate({
      ok: false,
      breakAt: s.chainBreak.breakPoint,
      why: s.chainBreak.likelyCause,
      evidence: s.chainBreak.evidence,
      fix: s.chainBreak.recommendedFix,
      source: "Signal Chain",
      configEvidence: [],
      failedLayer: s.chainBreak.failedLayer,
      previousStepPassed: s.chainBreak.previousStepPassed,
      truth, secondaryFindings: [],
    });
  }
  if (s.backendResult && s.backendResult.issues.some((i) => i.severity === "Critical")) {
    const top = s.backendResult.issues.find((i) => i.severity === "Critical")!;
    return decorate({
      ok: false,
      breakAt: top.title,
      why: s.backendResult.conclusion,
      evidence: s.backendResult.issues.map((i) => `[${i.severity}] ${i.title}`),
      fix: ["Review backend issues list and remediate the highest-severity finding first."],
      source: "Backend Conclusion",
      configEvidence: [],
      truth, secondaryFindings: [],
    });
  }
  // No break detected anywhere.
  const ccpPassed = s.ccpParse.status === "parsed" || s.ccpParse.status === "parsed_low_confidence";
  return decorate({
    ok: true,
    breakAt: ccpPassed
      ? "CCP confirms config is correct. No behavior failure detected."
      : "End-to-end signal chain operational",
    why: ccpPassed
      ? "CCP validation passed and all probed layers responded as expected."
      : (s.chainConclusion || s.cpConclusion || s.rcConclusion || "All probed layers responded as expected."),
    evidence: [],
    fix: [],
    source: ccpPassed ? "IPConnect CCP" : s.rcConclusion ? "SIM-046 Trace" : s.cpConclusion ? "Call Point Trace" : s.chainConclusion ? "Signal Chain" : "None",
    configEvidence: [],
    truth, secondaryFindings: [],
  });
}