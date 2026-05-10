/**
 * IPConnect CCP Doctor
 * --------------------
 * Bridges the CCP parser into the trace + final-result pipeline.
 *
 *   Callpoint → Room Controller → IPConnect CCP → Pulse Gateway / Output
 *
 * - Produces the "IPConnect CCP Config Validation" trace step.
 * - Generates findings per Rules 1-8 (controller/device/calltype/group/output/cancel).
 * - When CCP validation fails, returns an override `Breakpoint` so the Final
 *   Result block surfaces it ABOVE generic chain/RC/CP breakpoints.
 *
 * No-hallucination: when CCP is not provided the step is "Skipped" and the
 * doctor emits no findings. When parser confidence is low, findings are
 * downgraded from Critical to Warning unless trace/scan also confirms them.
 */

import type { DiagnosisRequest, CallPointEntry, RoomController } from "./siteDoctorApi";
import type { CcpParseResult } from "./ccpParser";
import type { ConfigEvidence, RcTraceStep } from "./roomControllerDoctor";

export type CcpFindingSeverity = "Critical" | "Warning" | "Info";

export type CcpFinding = {
  rule: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8";
  severity: CcpFindingSeverity;
  title: string;
  detail: string;
  evidence: ConfigEvidence[];
  fix: string[];
};

export type CcpValidationResult = {
  /** "IPConnect CCP Config Validation" trace step. */
  step: RcTraceStep;
  /** Per-rule findings derived from CCP vs site payload. */
  findings: CcpFinding[];
  /** Override Breakpoint when CCP fails — replaces lower-priority breaks. */
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
  /** "CCP confirmed everything we could verify" message for happy path. */
  conclusion: string;
};

const CCP_SOURCE = "IPConnect CCP" as const;

function ev(field: string, expected: string, actual: string, impact: string): ConfigEvidence {
  return { source: CCP_SOURCE, field, expected, actual, impact };
}

function lc(s: string) { return (s || "").toLowerCase().trim(); }

/* ------------------------------------------------------------------ */
/* Rule helpers                                                       */
/* ------------------------------------------------------------------ */

function controllerInCcp(parsed: CcpParseResult, rc: RoomController): boolean {
  return parsed.controllers.some((c) =>
    lc(c.controllerId) === lc(rc.controllerId)
    || lc(c.name) === lc(rc.name)
    || (rc.ip && lc(c.ip) === lc(rc.ip))
  );
}

function callpointInCcp(parsed: CcpParseResult, cp: CallPointEntry): boolean {
  return parsed.devices.some((d) =>
    lc(d.name) === lc(cp.name) || lc(d.address) === lc(String(cp.inputIndex))
  );
}

function groupSignalInCcp(parsed: CcpParseResult, name: string): boolean {
  if (!name) return true; // nothing expected — vacuously true
  return parsed.groupSignals.some((g) => lc(g.name) === lc(name));
}

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

export function validateCcp(
  payload: DiagnosisRequest,
  parsed: CcpParseResult,
): CcpValidationResult {
  const findings: CcpFinding[] = [];
  const evidence: ConfigEvidence[] = [];
  const cp = payload.callPoints?.[0];
  const expectedGroup = cp?.expectedOutputGroup ?? "";
  const targetCtrlName = cp?.controller ?? "";

  // --- Skipped: CCP not provided ---
  if (parsed.status === "not_provided") {
    return {
      step: {
        id: "ccp", layer: "IPConnect CCP",
        label: "IPConnect CCP Config Validation",
        detail: "CCP not provided — configuration validation skipped.",
        status: "Skipped", evidence: [], source: "config",
      },
      findings: [], override: null,
      conclusion: "CCP not provided — config evidence limited to manual/site inputs.",
    };
  }

  // --- Failed parse ---
  if (parsed.status === "parse_failed") {
    findings.push({
      rule: "C8", severity: "Warning",
      title: "CCP parse failed",
      detail: "File did not contain recognizable Tacera/IPConnect markers.",
      evidence: [ev("ccp.parse", "valid CCP export", "unrecognized format", "Cannot validate any config rules.")],
      fix: ["Re-export the CCP from IPConnect.", "Or paste the CCP text directly.", "Confirm the file is a Tacera/IPConnect site config."],
    });
    return {
      step: {
        id: "ccp", layer: "IPConnect CCP",
        label: "IPConnect CCP Config Validation",
        detail: "CCP parse failed — unable to validate config.",
        status: "Failed", evidence: ["Unrecognized CCP format."], source: "config",
      },
      findings, override: null,
      conclusion: "CCP parse failed — verify the export.",
    };
  }

  const lowConfidence = parsed.status === "parsed_low_confidence" || parsed.confidence === "low";
  const downgrade = (s: CcpFindingSeverity): CcpFindingSeverity =>
    lowConfidence && s === "Critical" ? "Warning" : s;

  // --- Rule 1: Controller exists physically but missing in CCP ---
  for (const rc of payload.roomControllers ?? []) {
    if (!controllerInCcp(parsed, rc)) {
      const e = ev("controllers[*].controllerId", rc.controllerId || rc.name, "missing",
        `Controller ${rc.name} is not declared in CCP.`);
      evidence.push(e);
      findings.push({
        rule: "C1", severity: downgrade("Critical"),
        title: `Controller ${rc.name} discovered on network but missing from CCP`,
        detail: "Controller is reachable / configured in site payload but no matching entry exists in IPConnect CCP.",
        evidence: [e],
        fix: ["Add controller to IPConnect CCP.", "Update All Controllers.", "Re-run diagnosis."],
      });
    }
  }

  // --- Rule 2: Controller in CCP but not in site payload ---
  for (const c of parsed.controllers) {
    const declared = (payload.roomControllers ?? []).some((rc) =>
      lc(rc.controllerId) === lc(c.controllerId) || lc(rc.name) === lc(c.name));
    if (!declared && c.confidence !== "low") {
      const e = ev("controllers[*].controllerId", c.controllerId || c.name, "not declared / unreachable",
        `Controller present in CCP but not seen by Tacera Doctor.`);
      evidence.push(e);
      findings.push({
        rule: "C2", severity: "Warning",
        title: `Controller ${c.name} configured in CCP but offline / unreachable`,
        detail: "CCP declares this controller but it is not present in the site payload.",
        evidence: [e],
        fix: ["Verify controller power/network.", "Confirm IP matches CCP.", "Re-run diagnosis after restoring."],
      });
    }
  }

  // --- Rule 3: Callpoint seen but not in CCP ---
  if (cp && !callpointInCcp(parsed, cp)) {
    const e = ev("devices[*].name", cp.name, "missing",
      "Callpoint observed by Tacera Doctor but not assigned in IPConnect CCP.");
    evidence.push(e);
    findings.push({
      rule: "C3", severity: downgrade("Critical"),
      title: `Callpoint "${cp.name}" not assigned in IPConnect CCP`,
      detail: "Controller sees the callpoint but CCP has no matching device assignment.",
      evidence: [e],
      fix: ["Add the callpoint to the room/zone in CCP.", "Assign call type.", "Update All Controllers."],
    });
  }

  // --- Rule 4: Callpoint has no call type assignment in CCP ---
  if (cp) {
    const cpDev = parsed.devices.find((d) => lc(d.name) === lc(cp.name));
    if (cpDev && cpDev.callTypes.length === 0) {
      const e = ev("devices[*].callTypes", "≥1 call type", "none",
        "Callpoint has no call type assignment in CCP.");
      evidence.push(e);
      findings.push({
        rule: "C4", severity: downgrade("Critical"),
        title: `Callpoint "${cp.name}" has no call type assignment`,
        detail: "Without a call type, the callpoint will not generate an event.",
        evidence: [e],
        fix: ["Assign a call type (e.g. Patient Call) in CCP.", "Update controllers."],
      });
    }
  }

  // --- Rule 5: Expected group signal not in CCP ---
  if (expectedGroup && !groupSignalInCcp(parsed, expectedGroup)) {
    const e = ev("groupSignals[*].name", expectedGroup, "missing",
      "Expected output group is not configured in CCP.");
    evidence.push(e);
    findings.push({
      rule: "C5", severity: downgrade("Critical"),
      title: `Expected group signal "${expectedGroup}" not found in CCP`,
      detail: "No output rule exists for this signal — the call will not light the expected output.",
      evidence: [e],
      fix: [
        `Add group signal "${expectedGroup}" in IPConnect CCP.`,
        "Assign correct zones / target ODL.",
        "Update All Controllers, retest.",
      ],
    });
  }

  // --- Rule 6: Output target controller offline ---
  if (expectedGroup) {
    const gs = parsed.groupSignals.find((g) => lc(g.name) === lc(expectedGroup));
    if (gs && gs.targetController && gs.targetController !== "unknown") {
      const reachable = (payload.roomControllers ?? []).some((rc) =>
        lc(rc.controllerId) === lc(gs.targetController) || lc(rc.name) === lc(gs.targetController));
      if (!reachable) {
        const e = ev("groupSignals[*].targetController", gs.targetController, "unreachable",
          "Output target controller not present in site payload.");
        evidence.push(e);
        findings.push({
          rule: "C6", severity: downgrade("Critical"),
          title: `Output target controller "${gs.targetController}" unreachable`,
          detail: "Group signal is configured but its target controller is offline / not declared.",
          evidence: [e],
          fix: ["Bring target controller online.", "Or update CCP target to the correct controller."],
        });
      }
    }
  }

  // --- Rule 7: Cancel rule missing for declared callpoint ---
  if (cp) {
    const hasCancel = parsed.cancelRules.some((cr) =>
      lc(cr.source).includes(lc(cp.name)) || lc(cr.cancels).includes(lc(cp.name)));
    if (!hasCancel) {
      const e = ev("cancelRules[*]", `cancel rule for ${cp.name}`, "missing",
        "No cancel behavior defined for this callpoint.");
      evidence.push(e);
      findings.push({
        rule: "C7", severity: "Warning",
        title: `Cancel rule missing for "${cp.name}"`,
        detail: "Calls from this callpoint may not cancel correctly at the bedside.",
        evidence: [e],
        fix: ["Define a cancel rule in CCP for this callpoint.", "Update controllers."],
      });
    }
  }

  // --- Build override Breakpoint if any Critical found ---
  const critical = findings.find((f) => f.severity === "Critical");
  const stepStatus: RcTraceStep["status"] =
    critical ? "Failed" :
    lowConfidence ? "Passed" : // still a pass, but warning
    findings.some((f) => f.severity === "Warning") ? "Passed" :
    "Passed";

  const stepDetail =
    critical ? `CCP missing required config: ${critical.title}` :
    lowConfidence ? `CCP loaded with low confidence — ${parsed.controllers.length} controllers, ${parsed.groupSignals.length} group signals.` :
    `CCP confirms controller / device / call type / output rule${expectedGroup ? ` for ${targetCtrlName}` : ""}.`;

  const step: RcTraceStep = {
    id: "ccp", layer: "IPConnect CCP",
    label: "IPConnect CCP Config Validation",
    detail: stepDetail,
    status: stepStatus,
    evidence: evidence.slice(0, 4).map((e) => `${e.field}: expected ${e.expected}, actual ${e.actual}`),
    source: "config",
  };

  let override: CcpValidationResult["override"] = null;
  if (critical) {
    override = {
      breakPoint: "IPConnect CCP Config",
      failedLayer: "IPConnect CCP",
      previousStepPassed: "Room Controller reachable",
      failedStep: "IPConnect CCP Config Validation",
      likelyCause: "Required controller / device / call type / group signal / output rule is missing or mismatched in CCP.",
      fix: critical.fix,
      evidence: critical.evidence.map((e) => `${e.field}: expected ${e.expected}, actual ${e.actual}`),
      configEvidence: evidence,
    };
  }

  const conclusion = critical
    ? `CCP validation failed: ${critical.title}.`
    : lowConfidence
      ? "CCP parsed with low confidence — verify entities against the live CCP."
      : "CCP validation passed — config matches site payload.";

  return { step, findings, override, conclusion };
}