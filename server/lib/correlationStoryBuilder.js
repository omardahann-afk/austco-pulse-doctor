/**
 * Correlation Story Builder
 * --------------------------
 * Pure deterministic. Translates the existing diagnosis (rootCause,
 * downstreamSymptoms, evidenceTimeline, contradictions, etc.) into a HUMAN,
 * field-tech-readable story. NEVER invents new truth — every classification
 * here is derived from data already in the diagnosis.
 */

import { getApplianceProfile } from "./taceraApplianceProfiles.js";

const KNOWN_EVENT_TYPES = new Set([
  "INVALID_CALLPOINT_SIGNAL", "CONTROLLER_HEARTBEAT_LOST", "LOW_BUS_VOLTAGE",
  "ACCESS_INPUT_ACTIVE", "RTLS_ROOM_MAPPING_FAILURE", "RTLS_BADGE_CANCEL_LIMITATION",
  "PST_TRACE_ENABLED", "PST_DISK_RISK", "PULSE_MOBILE_PORT_BLOCKED",
  "LICENSE_FAILURE", "CONNECTION_REFUSED", "WEBSOCKET_SESSION_ERROR",
  "WEBSOCKET_CLOSED", "BOOT_RECOVERY", "SERVICE_RESTARTED", "CLOCK_DRIFT",
]);

/* --------------------------------------------------------------- helpers */

function tsMs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function applianceLabel(type) {
  if (!type) return "Unknown appliance";
  const p = getApplianceProfile(type);
  return p?.displayName || type;
}

function applianceRole(type) {
  const p = getApplianceProfile(type);
  return p?.roleSummary || p?.kindLabel || (type || "unknown");
}

function eventTypeHumans(et) {
  switch (et) {
    case "INVALID_CALLPOINT_SIGNAL": return "rejected callpoint signal";
    case "CONTROLLER_HEARTBEAT_LOST": return "controller heartbeat lost";
    case "LOW_BUS_VOLTAGE": return "low bus voltage";
    case "ACCESS_INPUT_ACTIVE": return "access-control input asserted";
    case "RTLS_ROOM_MAPPING_FAILURE": return "RTLS room mapping failure";
    case "RTLS_BADGE_CANCEL_LIMITATION": return "RTLS cancel-by-presence limitation";
    case "PST_TRACE_ENABLED": return "PST trace logging enabled (disk risk)";
    case "PST_DISK_RISK": return "PST disk risk";
    case "PULSE_MOBILE_PORT_BLOCKED": return "Pulse Mobile push port blocked";
    case "LICENSE_FAILURE": return "license failure";
    case "CONNECTION_REFUSED": return "TCP connection refused";
    case "WEBSOCKET_SESSION_ERROR": return "WebSocket session error";
    case "WEBSOCKET_CLOSED": return "WebSocket session closed";
    case "BOOT_RECOVERY": return "boot recovery";
    case "SERVICE_RESTARTED": return "service restarted";
    case "CLOCK_DRIFT": return "host clock drift";
    default: return et ? et.toLowerCase().replace(/_/g, " ") : "event";
  }
}

function shortTime(ts) {
  if (!ts) return "—";
  // keep the HH:mm:ss for tech readability
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(ts);
  return m ? m[1] : ts;
}

function eventWhyItMatters(e, { rootApplianceType, firstFailureTs }) {
  const isRoot = e.applianceType === rootApplianceType;
  const t = tsMs(e.timestamp);
  if (e.eventType === "INVALID_CALLPOINT_SIGNAL") {
    return "Integration layer rejected a callpoint ID — strong signal that mapping/CCP truth is wrong.";
  }
  if (e.eventType === "CONTROLLER_HEARTBEAT_LOST" || e.eventType === "LOW_BUS_VOLTAGE") {
    return "Controller went silent — anything that depends on it (Pulse, displays, mobile) will look broken downstream.";
  }
  if (e.eventType === "ACCESS_INPUT_ACTIVE") {
    return "An IP-IN8 dry contact is asserting — call origin is the access-control side, not nurse-call hardware.";
  }
  if (e.eventType === "CONNECTION_REFUSED") {
    if (firstFailureTs != null && t != null && t < firstFailureTs) {
      return "TCP refusal happened BEFORE the first deterministic failure — could be the upstream cause.";
    }
    return "TCP refusal happened AFTER the first failure — likely a downstream service consequence, not the cause.";
  }
  if (/WEBSOCKET/i.test(e.eventType || "")) {
    if (firstFailureTs != null && t != null && t > firstFailureTs) {
      return "WebSocket session fallout — appeared after the first failure, so most likely a downstream symptom.";
    }
    return "WebSocket session error — check whether this preceded or followed the first failure.";
  }
  if (e.eventType === "BOOT_RECOVERY" || e.eventType === "SERVICE_RESTARTED") {
    return "A service restarted — events inside the recovery window can be noise, not new failures.";
  }
  if (isRoot) return "Same appliance as the root cause candidate — corroborating evidence.";
  return "Supporting evidence in the reproduction window.";
}

function classifyEvent(e, ctx) {
  const { rootApplianceType, firstFailureTs, evidenceEventIds, downstreamIds, contradictionIds, suppressedIds } = ctx;
  if (suppressedIds.has(e.eventId)) return "noise";
  if (contradictionIds.has(e.eventId)) return "contradiction";
  if (evidenceEventIds.has(e.eventId)) {
    const t = tsMs(e.timestamp);
    if (firstFailureTs != null && t === firstFailureTs) return "first_failure";
    return "root_cause_evidence";
  }
  if (downstreamIds.has(e.eventId)) return "downstream_symptom";
  if (e.applianceType === rootApplianceType) return "root_cause_evidence";
  return "supporting_evidence";
}

/* ------------------------------------------------------- main entry point */

/**
 * @param {Object} args
 * @param {Object} args.session            live capture session
 * @param {Object} args.diagnosis          output of correlateIncident()
 * @returns {Object} correlationStory
 */
export function buildCorrelationStory({ session, diagnosis }) {
  const devices = Array.isArray(session?.devicesIncluded) ? session.devicesIncluded : [];
  const rootApplianceType = diagnosis?.rootCause?.applianceType || null;
  const firstFailureTs = tsMs(diagnosis?.firstFailurePoint?.timestamp);

  const evidenceEventIds = new Set(diagnosis?.rootCause?.evidenceEventIds || []);
  const downstreamIds = new Set((diagnosis?.downstreamSymptoms || []).map((d) => d.eventId));
  const contradictionIds = new Set();
  for (const c of diagnosis?.contradictions || []) {
    for (const e of c.events || []) if (e?.id) contradictionIds.add(e.id);
  }
  const suppressedIds = new Set(); // already filtered out before scoring

  const timeline = (diagnosis?.evidenceTimeline || []).slice();

  /* ---- incidentSequence (chronological story of what happened) ---- */
  const incidentSequence = timeline.map((e, i) => {
    const classification = classifyEvent(e, {
      rootApplianceType, firstFailureTs, evidenceEventIds, downstreamIds, contradictionIds, suppressedIds,
    });
    return {
      order: i + 1,
      timestamp: e.timestamp,
      appliance: applianceLabel(e.applianceType),
      applianceType: e.applianceType,
      eventType: e.eventType,
      severity: e.severity,
      summary: `${shortTime(e.timestamp)} — ${applianceLabel(e.applianceType)} — ${eventTypeHumans(e.eventType)}${e.callpointId ? ` (callpoint ${e.callpointId})` : ""}`,
      whyItMatters: eventWhyItMatters(e, { rootApplianceType, firstFailureTs }),
      classification,
    };
  });

  /* ---- whatHappenedFirst ---- */
  const firstEvent = timeline[0];
  const firstFailureEvent = diagnosis?.firstFailurePoint?.eventId
    ? timeline.find((e) => e.eventId === diagnosis.firstFailurePoint.eventId) || firstEvent
    : firstEvent;
  const whatHappenedFirst = firstFailureEvent ? {
    timestamp: firstFailureEvent.timestamp,
    appliance: applianceLabel(firstFailureEvent.applianceType),
    applianceType: firstFailureEvent.applianceType,
    eventType: firstFailureEvent.eventType,
    rawMessage: firstFailureEvent.rawMessage,
    whyItMatters: eventWhyItMatters(firstFailureEvent, { rootApplianceType, firstFailureTs }),
  } : null;

  /* ---- applianceBreakdown (per monitored appliance) ---- */
  const includedTypes = new Map(); // applianceType -> deviceRef
  for (const d of devices) {
    const at = d.applianceType || d.kind || null;
    if (at) includedTypes.set(at, d);
  }
  // Also include any appliance type we saw evidence from, even if not explicitly added.
  for (const e of timeline) if (e.applianceType && !includedTypes.has(e.applianceType)) {
    includedTypes.set(e.applianceType, { id: null, name: applianceLabel(e.applianceType), applianceType: e.applianceType });
  }

  const applianceBreakdown = Array.from(includedTypes.entries()).map(([type, dev]) => {
    const evs = timeline.filter((e) => e.applianceType === type);
    const firstRel = evs[0] || null;
    const isRoot = rootApplianceType === type;
    const isDownstream = !isRoot && evs.some((e) => downstreamIds.has(e.eventId));
    let classification = "no_relevant_evidence";
    let explanation = `${applianceLabel(type)} produced no events that could be correlated to the failure in this window.`;
    let whatItProves = "Nothing on its own.";
    let whatItDoesNotProve = "Cannot rule this appliance in or out without targeted evidence.";
    let nextCheck = `Pull a focused log/probe from ${applianceLabel(type)} during the next reproduction.`;

    if (isRoot) {
      classification = "likely_root_cause";
      explanation = `${applianceLabel(type)} produced the first deterministic failure (${eventTypeHumans(firstRel?.eventType)}). The other appliances reacted afterwards.`;
      whatItProves = `${applianceLabel(type)} is the most likely origin of the incident.`;
      whatItDoesNotProve = "It does not prove the underlying configuration cause — that needs the next-check evidence.";
      nextCheck = (diagnosis?.nextChecks || [])[0] || `Inspect ${applianceLabel(type)} during the reproduction.`;
    } else if (isDownstream) {
      classification = "downstream_symptom";
      explanation = `${applianceLabel(type)} only started failing AFTER ${applianceLabel(rootApplianceType)} did — these are likely symptoms, not causes.`;
      whatItProves = "The fault propagated through this appliance.";
      whatItDoesNotProve = "It does NOT prove this appliance is broken.";
      nextCheck = `Re-test ${applianceLabel(type)} only after ${applianceLabel(rootApplianceType)} is restored.`;
    } else if (evs.length > 0) {
      classification = "evidence_holder";
      explanation = `${applianceLabel(type)} produced ${evs.length} event(s) inside the window — useful supporting evidence.`;
      whatItProves = "Provides a corroborating timestamp and event trail.";
      whatItDoesNotProve = "Does not by itself name the root cause.";
      nextCheck = `Cross-reference these events with ${rootApplianceType ? applianceLabel(rootApplianceType) : "the root cause candidate"}.`;
    } else {
      // No events at all — explicitly call out missing evidence rather than 'no confirmed fault'.
      classification = "missing_evidence_needed";
      explanation = `No events from ${applianceLabel(type)} were captured in the reproduction window — cannot confirm or rule it out.`;
      whatItProves = "Nothing — there is no evidence to evaluate.";
      whatItDoesNotProve = "Silence is NOT proof of health.";
      nextCheck = `Verify ${applianceLabel(type)} is actually being collected (log path, SSH, probe) and reproduce again.`;
    }

    return {
      appliance: dev?.name || applianceLabel(type),
      applianceType: type,
      role: applianceRole(type),
      firstRelevantEvent: firstRel ? {
        timestamp: firstRel.timestamp,
        eventType: firstRel.eventType,
        rawMessage: firstRel.rawMessage,
      } : null,
      eventCount: evs.length,
      classification,
      explanation,
      whatItProves,
      whatItDoesNotProve,
      nextCheck,
    };
  });

  /* ---- causeVsSymptom (compact table) ---- */
  const causeVsSymptom = applianceBreakdown.map((a) => {
    let timing = "—";
    if (a.firstRelevantEvent?.timestamp) timing = shortTime(a.firstRelevantEvent.timestamp);
    let cls = "unknown";
    if (a.classification === "likely_root_cause") cls = "cause";
    else if (a.classification === "downstream_symptom") cls = "symptom";
    else if (a.classification === "missing_evidence_needed") cls = "missing_evidence";
    else if (a.classification === "evidence_holder") cls = "cause"; // evidence holder = where the cause shows up
    return {
      appliance: a.appliance,
      applianceType: a.applianceType,
      timing,
      evidence: a.firstRelevantEvent ? `${eventTypeHumans(a.firstRelevantEvent.eventType)}` : "no evidence in window",
      classification: cls,
      explanation: a.explanation,
    };
  });

  /* ---- missingEvidence (deterministic, rule-driven) ---- */
  const missingEvidence = [];
  const seenTypes = new Set(timeline.map((e) => e.applianceType));
  if (diagnosis?.rootCause?.kind === "invalid_callpoint_burst") {
    if (!seenTypes.has("ipconnect")) missingEvidence.push("IPConnect / CCP object mapping was not captured — needed to confirm which callpoints are stale.");
    missingEvidence.push("Most recent CCP import diff was not captured — needed to see what changed.");
  }
  if (diagnosis?.rootCause?.kind === "controller_first_then_downstream") {
    if (!seenTypes.has("network-switch")) missingEvidence.push("Switch PoE/VLAN state for the controller port was not captured.");
    if (!seenTypes.has("ip-cct")) missingEvidence.push("Controller direct heartbeat trace was not captured.");
  }
  if (diagnosis?.rootCause?.kind === "rtls_workflow_failure" && !seenTypes.has("rtls-gateway")) {
    missingEvidence.push("RTLS room/badge mapping was not captured.");
  }
  if (diagnosis?.rootCause?.kind === "access_input_origin" && !seenTypes.has("access-input")) {
    missingEvidence.push("Access-control input state (IP-IN8) was not captured.");
  }
  for (const a of applianceBreakdown) {
    if (a.classification === "missing_evidence_needed") {
      missingEvidence.push(`No evidence captured from ${a.appliance} (${a.applianceType}).`);
    }
  }

  /* ---- conclusions (plain English, never invented) ---- */
  const conf = diagnosis?.confidence ?? 0;
  const root = diagnosis?.rootCause;

  let plainEnglishSummary;
  let whyThisMatters;
  let technicianConclusion;
  let developerConclusion;
  let customerSafeConclusion;

  if (!root || conf === 0) {
    plainEnglishSummary = "Insufficient evidence to deterministically diagnose this incident.";
    whyThisMatters = "Without a clear first failure point in the reproduction window, restarting services blindly is likely to make things worse.";
    technicianConclusion = "Re-run the capture with more appliances included and try to reproduce within the marked window.";
    developerConclusion = "No deterministic root cause selected — see evidence timeline for raw events.";
    customerSafeConclusion = "We were unable to identify a single root cause from the captured evidence; further targeted testing is required.";
  } else if (root.kind === "invalid_callpoint_burst") {
    plainEnglishSummary = "Invalid/stale callpoint mapping or CCP object mismatch is the most likely issue.";
    whyThisMatters = "The integration layer began rejecting callpoint IDs before any WebSocket/session symptoms appeared, so messaging and Pulse are reacting to an upstream config truth problem — not the cause.";
    technicianConclusion = "Open IPConnect/CCP and search the affected callpoint IDs first. Verify they exist in the active config and have signal profiles. Compare against the most recent CCP import. Do NOT restart Pulse first.";
    developerConclusion = "Integration Gateway raised INVALID_CALLPOINT_SIGNAL for multiple IDs inside the reproduction window. WebSocket and downstream Pulse events occurred AFTER the first invalid signal. Recommend tracing CCP → IPConnect object pipeline for the affected IDs.";
    customerSafeConclusion = "The system rejected several call point IDs that no longer match the active configuration. Investigation will start at the configuration source.";
  } else if (root.kind === "controller_first_then_downstream") {
    plainEnglishSummary = "Controller heartbeat was lost first — Pulse / display / mobile failures are downstream symptoms.";
    whyThisMatters = "Anything that depends on the controller will look broken when the controller is silent. Restarting downstream services will not bring the room back.";
    technicianConclusion = "Check PoE on the controller's switch port, then VLAN tagging, then bus voltage at the controller. Do NOT restart Pulse, replace the display, or reboot the VM.";
    developerConclusion = "ip-cct went silent first; all subsequent failing events belong to appliances dependent on ip-cct. Recommend verifying physical/network path before any service restart.";
    customerSafeConclusion = "A controller stopped responding, which caused the connected devices to appear faulty. Investigation will focus on the controller's network connection first.";
  } else if (root.kind === "access_input_origin") {
    plainEnglishSummary = "An access-control input is asserting — the call origin is the access side, not the nurse call hardware.";
    whyThisMatters = "Replacing nurse call hardware will not stop a call that is being raised by an external dry contact.";
    technicianConclusion = "Identify which IP-IN8 input is active and trace the dry contact back to the access-control device. Do NOT replace nurse call hardware.";
    developerConclusion = "ACCESS_INPUT_ACTIVE event(s) inside the reproduction window — origin is the IP-IN8 path.";
    customerSafeConclusion = "The call was raised by an external access-control input rather than a nurse call device.";
  } else if (root.kind === "eventBridge_broker_down") {
    plainEnglishSummary = "Multiple services are getting CONNECTION_REFUSED — the messaging broker (or its host port) is the upstream failure.";
    whyThisMatters = "Restarting individual consumers will not help if the broker itself is down.";
    technicianConclusion = "Check the broker service status and that its listener ports are up. Do NOT restart consumers one by one.";
    developerConclusion = "Multiple downstream consumers raised CONNECTION_REFUSED in the same window — pattern matches broker-down.";
    customerSafeConclusion = "The shared messaging service appears to be unavailable; investigation will start at that service.";
  } else if (root.kind === "pulse_mobile_firewall") {
    plainEnglishSummary = "Pulse Mobile push port path is blocked — this is a firewall/network path issue, not an app crash.";
    whyThisMatters = "Reinstalling the mobile app or restarting Pulse will not open a blocked egress port.";
    technicianConclusion = "From the affected device's network, test TCP reach to 5223/5228/5229/5230 and check firewall/VLAN egress. Do NOT reinstall the mobile app first.";
    developerConclusion = "Repeated PULSE_MOBILE_PORT_BLOCKED events — recommend network team verify egress for push-notification ports.";
    customerSafeConclusion = "The mobile push notification path is blocked at the network layer; investigation will start with network/firewall.";
  } else {
    plainEnglishSummary = root.summary || "A deterministic root cause was identified.";
    whyThisMatters = `The first failure occurred at ${applianceLabel(root.applianceType)}, before any other appliance reported a related issue.`;
    technicianConclusion = (diagnosis?.nextChecks || [])[0] || `Investigate ${applianceLabel(root.applianceType)} first.`;
    developerConclusion = `Root cause classified as ${root.kind}; first failure at ${applianceLabel(root.applianceType)}.`;
    customerSafeConclusion = `Initial investigation will focus on ${applianceLabel(root.applianceType)}.`;
  }

  return {
    plainEnglishSummary,
    whyThisMatters,
    incidentSequence,
    whatHappenedFirst,
    applianceBreakdown,
    causeVsSymptom,
    missingEvidence,
    technicianConclusion,
    developerConclusion,
    customerSafeConclusion,
  };
}
