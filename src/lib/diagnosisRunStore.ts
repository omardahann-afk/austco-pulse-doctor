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
};

/**
 * Distill the highest-confidence break across all engines into a single
 * "Where did the system break?" answer for the top of the diagnosis page.
 * Priority: SIM-046 break > Call-point break > generic chain break > backend.
 */
export function deriveFinalResult(s: DiagnosisRunSnapshot): FinalResult {
  // Priority (per "Network > CCP only when network proven failed"):
  //   1. Network override — but ONLY when the supporting evidence is
  //      verified (SNMP / ARP / scan). networkDoctor already enforces
  //      this: it never sets `override` from manual-only data.
  //   2. CCP override (config truth).
  //   3. SIM-046 trace, Call-point trace, Signal chain, Backend conclusion.
  if (s.network?.override) {
    return {
      ok: false,
      breakAt: s.network.override.breakPoint,
      why: s.network.override.likelyCause,
      evidence: s.network.override.evidence,
      fix: s.network.override.fix,
      source: "Network Infrastructure",
      configEvidence: s.network.override.configEvidence,
      failedLayer: s.network.override.failedLayer,
      previousStepPassed: s.network.override.previousStepPassed,
    };
  }
  if (s.ccpOverride) {
    return {
      ok: false,
      breakAt: s.ccpOverride.breakPoint,
      why: s.ccpOverride.likelyCause,
      evidence: s.ccpOverride.evidence,
      fix: s.ccpOverride.fix,
      source: "IPConnect CCP",
      configEvidence: s.ccpOverride.configEvidence,
      failedLayer: s.ccpOverride.failedLayer,
      previousStepPassed: s.ccpOverride.previousStepPassed,
    };
  }
  if (s.rcBreak) {
    return {
      ok: false,
      breakAt: s.rcBreak.breakPoint,
      why: s.rcBreak.likelyCause,
      evidence: s.rcBreak.evidence,
      fix: s.rcBreak.fix,
      source: "SIM-046 Trace",
      configEvidence: s.rcBreak.configEvidence ?? [],
      failedLayer: s.rcBreak.failedStep,
      previousStepPassed: s.rcBreak.previousStepPassed,
    };
  }
  if (s.cpBreak) {
    return {
      ok: false,
      breakAt: s.cpBreak.breakPoint,
      why: s.cpBreak.likelyRootCause,
      evidence: s.cpBreak.evidence,
      fix: s.cpBreak.fix,
      source: "Call Point Trace",
      configEvidence: [],
      failedLayer: s.cpBreak.failedStep,
      previousStepPassed: s.cpBreak.previousStepPassed,
    };
  }
  if (s.chainBreak) {
    return {
      ok: false,
      breakAt: s.chainBreak.breakPoint,
      why: s.chainBreak.likelyCause,
      evidence: s.chainBreak.evidence,
      fix: s.chainBreak.recommendedFix,
      source: "Signal Chain",
      configEvidence: [],
      failedLayer: s.chainBreak.failedLayer,
      previousStepPassed: s.chainBreak.previousStepPassed,
    };
  }
  if (s.backendResult && s.backendResult.issues.some((i) => i.severity === "Critical")) {
    const top = s.backendResult.issues.find((i) => i.severity === "Critical")!;
    return {
      ok: false,
      breakAt: top.title,
      why: s.backendResult.conclusion,
      evidence: s.backendResult.issues.map((i) => `[${i.severity}] ${i.title}`),
      fix: ["Review backend issues list and remediate the highest-severity finding first."],
      source: "Backend Conclusion",
      configEvidence: [],
    };
  }
  // No break detected anywhere.
  // If CCP passed and no behavior break either, lead with that fact.
  const ccpPassed = s.ccpParse.status === "parsed" || s.ccpParse.status === "parsed_low_confidence";
  return {
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
  };
}