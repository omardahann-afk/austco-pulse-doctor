/**
 * Tacera Incident Correlator (M2)
 * -------------------------------
 * Pure deterministic. No AI. No fabrication.
 *
 * Given normalized forensic events (from taceraEventNormalizer.js) plus the
 * appliance knowledge model (taceraApplianceProfiles.js) and the live capture
 * session, decide:
 *
 *   - the FIRST FAILURE POINT (not the largest visible symptom)
 *   - which later events are downstream symptoms of that first failure
 *   - contradictions in the evidence
 *   - confidence (with a breakdown of WHY)
 *   - safe next checks and explicit do-not-do steps
 *
 * Every field in the output traces back to evidence in `session.normalizedEvents`.
 */

import { getApplianceProfile, listApplianceProfiles } from "./taceraApplianceProfiles.js";
import { buildCorrelationStory } from "./correlationStoryBuilder.js";

const CLUSTER_WINDOW_MS = 15_000;

/* ---------------------------------------------------------------- helpers */

function tsMs(e) {
  if (!e?.timestamp) return null;
  const t = Date.parse(e.timestamp);
  return Number.isNaN(t) ? null : t;
}

function partitionByWindow(events, session) {
  const reproStart = session?.reproductionStartedAt ? Date.parse(session.reproductionStartedAt) : null;
  const reproEnd = session?.reproductionEndedAt ? Date.parse(session.reproductionEndedAt) : null;
  const pre = [], repro = [], post = [], unknown = [];
  for (const e of events) {
    const t = tsMs(e);
    if (t == null) { unknown.push(e); continue; }
    if (reproStart != null && reproEnd != null) {
      if (t < reproStart) pre.push(e);
      else if (t <= reproEnd) repro.push(e);
      else post.push(e);
    } else {
      // No reproduction window declared — treat the whole capture as repro for weighting.
      repro.push(e);
    }
  }
  return { pre, repro, post, unknown };
}

function clusterByTime(events) {
  const sorted = [...events].sort((a, b) => (tsMs(a) || 0) - (tsMs(b) || 0));
  const clusters = [];
  let cur = null;
  for (const e of sorted) {
    const t = tsMs(e);
    if (t == null) continue;
    if (!cur || t - cur.endTs > CLUSTER_WINDOW_MS) {
      cur = { startTs: t, endTs: t, events: [e] };
      clusters.push(cur);
    } else {
      cur.events.push(e);
      cur.endTs = t;
    }
  }
  return clusters;
}

/** True if `down` depends (transitively) on `up` in the appliance profile graph. */
function dependsOn(down, up, seen = new Set()) {
  if (!down || !up || down === up) return false;
  if (seen.has(down)) return false;
  seen.add(down);
  const p = getApplianceProfile(down);
  if (!p) return false;
  if (p.upstreamDependencies?.includes(up)) return true;
  return (p.upstreamDependencies || []).some((u) => dependsOn(u, up, seen));
}

function priorityOf(applianceType) {
  const p = getApplianceProfile(applianceType);
  return p ? p.diagnosticPriority : 99;
}

/* ----------------------------------------------------- special-case rules */

/** INVALID_CALLPOINT_SIGNAL bursts ⇒ CCP / mapping root cause, NEVER messaging. */
function detectInvalidCallpointPattern(reproEvents) {
  const invalids = reproEvents.filter((e) => e.eventType === "INVALID_CALLPOINT_SIGNAL");
  if (invalids.length < 2) return null;
  const callpoints = Array.from(new Set(invalids.map((e) => e.callpointId).filter(Boolean)));
  return {
    kind: "invalid_callpoint_burst",
    rootApplianceType: "ipconnect",
    summary: `Repeated INVALID_CALLPOINT_SIGNAL events (${invalids.length}) — callpoint mapping/CCP truth is wrong, NOT a messaging fault.`,
    evidenceEvents: invalids,
    affectedCallpoints: callpoints,
    nextChecks: [
      "Open IPConnect/CCP and search for the affected callpoint IDs",
      "Verify each callpoint exists in the active config and has a signal profile",
      "Compare against the most recently imported CCP — look for removed/replaced callpoints",
      "Check INGA replay window for stale signal traffic",
    ],
    doNotDo: [
      "Do NOT restart unrelated middleware first",
      "Do NOT restart Pulse Gateway first",
      "Do NOT replace the calling hardware before validating the CCP mapping",
    ],
    confidenceBoost: 0.25,
  };
}

/** ACCESS_INPUT_ACTIVE inside the window ⇒ access-control origin, NOT nurse call. */
function detectAccessInputOrigin(reproEvents) {
  const inputs = reproEvents.filter((e) => e.eventType === "ACCESS_INPUT_ACTIVE");
  if (!inputs.length) return null;
  return {
    kind: "access_input_origin",
    rootApplianceType: "access-input",
    summary: `IP-IN8 access-control input is asserting (${inputs.length} event(s)) — call origin is the access-control side, not the nurse-call hardware.`,
    evidenceEvents: inputs,
    affectedCallpoints: [],
    nextChecks: [
      "Identify which IP-IN8 input is active",
      "Trace the dry contact back to the access control device",
      "Verify the signal profile attached to that input is the intended one",
    ],
    doNotDo: [
      "Do NOT replace nurse call hardware",
      "Do NOT clear the call from Pulse — fix the source contact",
    ],
    confidenceBoost: 0.2,
  };
}

/** RTLS mapping/cancel limitations ⇒ RTLS root, not Pulse. */
function detectRtlsWorkflow(reproEvents) {
  const rtls = reproEvents.filter((e) => e.eventType === "RTLS_ROOM_MAPPING_FAILURE" || e.eventType === "RTLS_BADGE_CANCEL_LIMITATION");
  if (!rtls.length) return null;
  return {
    kind: "rtls_workflow_failure",
    rootApplianceType: "rtls-gateway",
    summary: `RTLS workflow failure (${rtls.length} event(s)) — badge/room mapping or cancel-by-presence path is broken.`,
    evidenceEvents: rtls,
    affectedCallpoints: [],
    nextChecks: [
      "Verify badge → room mapping for the affected room",
      "Confirm RTLS module path supports the reported call type",
    ],
    doNotDo: ["Do NOT restart Pulse Gateway first", "Do NOT blame the staff workflow before checking RTLS"],
    confidenceBoost: 0.2,
  };
}

function detectPstDiskRisk(reproEvents) {
  const trace = reproEvents.find((e) => e.eventType === "PST_TRACE_ENABLED");
  const disk = reproEvents.find((e) => e.eventType === "PST_DISK_RISK");
  if (!trace && !disk) return null;
  return {
    kind: "pst_disk_risk",
    rootApplianceType: "ip-pst",
    summary: trace ? "PST logging is set to LOG_TRACE — disk will fill and PST will fail." : "PST host disk is at risk of filling.",
    evidenceEvents: [trace, disk].filter(Boolean),
    affectedCallpoints: [],
    nextChecks: [
      "Restore LOG_INFO in /home/pst/log/log_level",
      "Check disk usage on /home/pst",
    ],
    doNotDo: ["Do NOT leave LOG_TRACE enabled", "Do NOT delete logs without saving a copy first"],
    confidenceBoost: 0.15,
  };
}

function detectPulseMobileFirewall(reproEvents) {
  const blocked = reproEvents.filter((e) => e.eventType === "PULSE_MOBILE_PORT_BLOCKED");
  if (!blocked.length) return null;
  return {
    kind: "pulse_mobile_firewall",
    rootApplianceType: "pulse-mobile",
    summary: `Pulse Mobile push port path blocked (${blocked.length} event(s)) — firewall/network path issue, not an app crash.`,
    evidenceEvents: blocked,
    affectedCallpoints: [],
    nextChecks: [
      "From the affected device's network, test TCP reach to 5223, 5228, 5229, 5230",
      "Check firewall/VLAN egress rules for those ports",
    ],
    doNotDo: ["Do NOT reinstall the mobile app first", "Do NOT restart Pulse Gateway first"],
    confidenceBoost: 0.2,
  };
}

function detectControllerHeartbeatBeforePulse(reproEvents) {
  const hb = reproEvents.filter((e) => e.eventType === "CONTROLLER_HEARTBEAT_LOST" || e.eventType === "LOW_BUS_VOLTAGE");
  if (!hb.length) return null;
  const firstHb = hb.sort((a, b) => (tsMs(a) || 0) - (tsMs(b) || 0))[0];
  const firstHbT = tsMs(firstHb);
  // Anything downstream of ip-cct that fires AFTER the heartbeat loss is a symptom.
  const symptoms = reproEvents.filter((e) => {
    if (e === firstHb) return false;
    const t = tsMs(e);
    if (firstHbT != null && t != null && t < firstHbT) return false;
    return e.applianceType && dependsOn(e.applianceType, "ip-cct");
  });
  return {
    kind: "controller_first_then_downstream",
    rootApplianceType: firstHb.applianceType || "ip-cct",
    summary: "Controller heartbeat / bus voltage failed first — later Pulse / display / mobile failures are downstream symptoms.",
    evidenceEvents: hb,
    downstreamEvents: symptoms,
    affectedCallpoints: Array.from(new Set(reproEvents.map((e) => e.callpointId).filter(Boolean))),
    nextChecks: [
      "Check PoE on the controller's switch port",
      "Check VLAN tagging on that port",
      "Inspect bus voltage at the controller",
    ],
    doNotDo: [
      "Do NOT restart Pulse Gateway",
      "Do NOT replace any display",
      "Do NOT reboot the VM",
    ],
    confidenceBoost: 0.3,
  };
}

function detectLicenseFailure(reproEvents) {
  const lic = reproEvents.filter((e) => e.eventType === "LICENSE_FAILURE");
  if (!lic.length) return null;
  return {
    kind: "license_failure",
    rootApplianceType: "license-service",
    summary: "License service failure detected — downstream Pulse/INGA failures will follow.",
    evidenceEvents: lic,
    nextChecks: ["Confirm license expiry date", "Check license server reachability"],
    doNotDo: ["Do NOT restart Pulse Gateway first"],
    confidenceBoost: 0.2,
  };
}

function detectMqttBrokerDown(reproEvents) {
  const refused = reproEvents.filter((e) => e.eventType === "CONNECTION_REFUSED");
  if (refused.length < 2) return null;
  // Only consider this a broker-down pattern if multiple downstream consumers see the refusal.
  const downstreamConsumers = new Set(refused.map((e) => e.applianceType).filter((t) => t && t !== "eventBridge-broker"));
  if (downstreamConsumers.size < 2) return null;
  return {
    kind: "eventBridge_broker_down",
    rootApplianceType: "eventBridge-broker",
    summary: `Multiple services (${downstreamConsumers.size}) report CONNECTION_REFUSED — event broker (or its host port) is the upstream failure.`,
    evidenceEvents: refused,
    nextChecks: ["systemctl status mosquitto", "Check 1883/8883 listeners", "Inspect broker logs in window"],
    doNotDo: ["Do NOT restart each consumer one by one — fix the broker"],
    confidenceBoost: 0.25,
  };
}

/* -------------------------------------------------- generic fallback chain */

/**
 * If no special case matches, pick the FIRST event whose appliance has the
 * lowest diagnosticPriority number (= highest priority). Tie-break by
 * timestamp (earlier wins). Anything depending on that appliance and firing
 * later is a downstream symptom.
 */
function detectGenericFirstFailure(reproEvents) {
  if (!reproEvents.length) return null;
  const candidates = reproEvents
    .filter((e) => e.applianceType && (e.severity === "critical" || e.severity === "warning"))
    .map((e) => ({ e, p: priorityOf(e.applianceType), t: tsMs(e) ?? Number.MAX_SAFE_INTEGER }))
    .filter((c) => {
      const prof = getApplianceProfile(c.e.applianceType);
      return prof && prof.isRootCauseCandidate;
    });
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.p - b.p) || (a.t - b.t));
  const first = candidates[0].e;
  const firstT = tsMs(first);
  const downstream = reproEvents.filter((e) => {
    if (e === first) return false;
    const t = tsMs(e);
    if (firstT != null && t != null && t < firstT) return false;
    return e.applianceType && dependsOn(e.applianceType, first.applianceType);
  });
  return {
    kind: "generic_first_failure",
    rootApplianceType: first.applianceType,
    summary: `Earliest high-priority failure occurred at ${first.applianceType} — later dependent events are downstream.`,
    evidenceEvents: [first],
    downstreamEvents: downstream,
    nextChecks: getApplianceProfile(first.applianceType)?.safeNextChecks || [],
    doNotDo: (getApplianceProfile(first.applianceType)?.dangerousActions || []).map((d) => `Do NOT ${d}`),
    confidenceBoost: 0.1,
  };
}

/* ----------------------------------------------------- boot & contradictions */

function detectBootRecoverySuppression(allEvents, session) {
  const boots = allEvents.filter((e) => e.eventType === "BOOT_RECOVERY" || e.eventType === "SERVICE_RESTARTED");
  if (!boots.length) return { suppressed: [], windows: [] };
  const windows = boots.map((b) => {
    const t = tsMs(b);
    const prof = getApplianceProfile(b.applianceType);
    const recoverySec = prof?.recoveryWindowSeconds ?? 60;
    return { from: t, to: t == null ? null : t + recoverySec * 1000, applianceType: b.applianceType };
  }).filter((w) => w.from != null);
  const suppressed = allEvents.filter((e) => {
    const t = tsMs(e);
    if (t == null) return false;
    return windows.some((w) => t >= w.from && t <= w.to && (
      // suppress noisy downstream symptoms inside recovery windows
      e.severity !== "critical" || e.applianceType === w.applianceType
    ) && e.eventType !== "BOOT_RECOVERY" && e.eventType !== "SERVICE_RESTARTED");
  });
  return { suppressed, windows };
}

function detectContradictions(reproEvents) {
  const out = [];
  // "Pulse says controller offline BUT controller heartbeat still alive in window"
  const pulseSaysOffline = reproEvents.find((e) =>
    e.applianceType === "pulse-gateway" && /controller.*(?:offline|unreachable)/i.test(e.rawMessage || ""));
  const controllerAliveHb = reproEvents.find((e) =>
    e.applianceType === "ip-cct" && e.eventType === "SERVICE_RESTARTED");
  if (pulseSaysOffline && controllerAliveHb) {
    out.push({
      kind: "pulse_says_offline_but_controller_active",
      detail: "Pulse Gateway reports controller offline, but controller produced a service event in the same window.",
      events: [pulseSaysOffline, controllerAliveHb],
    });
  }
  // Clock drift presence
  if (reproEvents.some((e) => e.eventType === "CLOCK_DRIFT")) {
    out.push({ kind: "clock_drift_in_window", detail: "Clock drift in the reproduction window — timestamps are unreliable.", events: reproEvents.filter((e) => e.eventType === "CLOCK_DRIFT") });
  }
  return out;
}

/* ----------------------------------------------------- confidence scoring */

function computeConfidence({ rootCause, reproEvents, contradictions, bootRecovery, special }) {
  let score = 0.4; // floor when we have any data
  const breakdown = [];
  if (special) {
    score += special.confidenceBoost ?? 0;
    breakdown.push({ reason: `special-case: ${special.kind}`, delta: special.confidenceBoost ?? 0 });
  }
  if (rootCause?.evidenceEvents?.length >= 2) {
    score += 0.1; breakdown.push({ reason: "multiple corroborating evidence events", delta: 0.1 });
  }
  const distinctAppliances = new Set(reproEvents.map((e) => e.applianceType).filter(Boolean));
  if (distinctAppliances.size >= 2) {
    score += 0.1; breakdown.push({ reason: `multiple appliances reporting (${distinctAppliances.size})`, delta: 0.1 });
  }
  if (reproEvents.some((e) => tsMs(e) != null)) {
    score += 0.05; breakdown.push({ reason: "timestamps present and align with reproduction window", delta: 0.05 });
  }
  for (const c of contradictions || []) {
    score -= 0.15; breakdown.push({ reason: `contradiction: ${c.kind}`, delta: -0.15 });
  }
  if (bootRecovery?.windows?.length) {
    score -= 0.05; breakdown.push({ reason: "boot recovery window present — some events suppressed", delta: -0.05 });
  }
  if (!rootCause) {
    score -= 0.2; breakdown.push({ reason: "no deterministic root cause identified", delta: -0.2 });
  }
  score = Math.max(0, Math.min(1, score));
  return { confidence: score, confidenceBreakdown: breakdown };
}

/* ---------------------------------------------------------------- entry */

export function correlateIncident({ session }) {
  const events = Array.isArray(session?.normalizedEvents) ? session.normalizedEvents : [];
  const partitioned = partitionByWindow(events, session);
  const reproEvents = partitioned.repro;

  const bootRecovery = detectBootRecoverySuppression(events, session);
  const suppressedIds = new Set(bootRecovery.suppressed.map((e) => e.id));
  const reproAfterSuppression = reproEvents.filter((e) => !suppressedIds.has(e.id));

  // Special-case rules — order matters: most specific first.
  const specials = [
    detectAccessInputOrigin(reproAfterSuppression),
    detectInvalidCallpointPattern(reproAfterSuppression),
    detectControllerHeartbeatBeforePulse(reproAfterSuppression),
    detectMqttBrokerDown(reproAfterSuppression),
    detectLicenseFailure(reproAfterSuppression),
    detectRtlsWorkflow(reproAfterSuppression),
    detectPulseMobileFirewall(reproAfterSuppression),
    detectPstDiskRisk(reproAfterSuppression),
  ].filter(Boolean);

  const special = specials[0] || null;
  const generic = !special ? detectGenericFirstFailure(reproAfterSuppression) : null;
  const chosen = special || generic;

  const contradictions = detectContradictions(reproAfterSuppression);

  // Build incident chains by clustering all repro events.
  const clusters = clusterByTime(reproAfterSuppression);
  const incidentChains = clusters.map((c, i) => ({
    chainId: `chain_${i + 1}`,
    startedAt: new Date(c.startTs).toISOString(),
    endedAt: new Date(c.endTs).toISOString(),
    eventCount: c.events.length,
    appliances: Array.from(new Set(c.events.map((e) => e.applianceType).filter(Boolean))),
    eventTypes: Array.from(new Set(c.events.map((e) => e.eventType).filter(Boolean))),
    eventIds: c.events.map((e) => e.id),
  }));

  // First failure point.
  let firstFailurePoint = null;
  if (chosen) {
    const earliest = (chosen.evidenceEvents || []).slice().sort((a, b) => (tsMs(a) || 0) - (tsMs(b) || 0))[0];
    firstFailurePoint = earliest ? {
      applianceType: earliest.applianceType,
      eventType: earliest.eventType,
      timestamp: earliest.timestamp,
      rawMessage: earliest.rawMessage,
      eventId: earliest.id,
    } : { applianceType: chosen.rootApplianceType, eventType: null, timestamp: null, rawMessage: null, eventId: null };
  }

  // Downstream symptoms = events depending on root appliance that fired after first failure.
  let downstreamSymptoms = [];
  if (chosen) {
    if (chosen.downstreamEvents) {
      downstreamSymptoms = chosen.downstreamEvents;
    } else if (chosen.rootApplianceType) {
      const ft = firstFailurePoint?.timestamp ? Date.parse(firstFailurePoint.timestamp) : null;
      downstreamSymptoms = reproAfterSuppression.filter((e) => {
        if ((chosen.evidenceEvents || []).includes(e)) return false;
        const t = tsMs(e);
        if (ft != null && t != null && t < ft) return false;
        return e.applianceType && dependsOn(e.applianceType, chosen.rootApplianceType);
      });
    }
  }

  const { confidence, confidenceBreakdown } = computeConfidence({
    rootCause: chosen, reproEvents: reproAfterSuppression, contradictions, bootRecovery, special,
  });

  // Evidence timeline (chronological, repro-first).
  const evidenceTimeline = [...reproAfterSuppression]
    .sort((a, b) => (tsMs(a) || 0) - (tsMs(b) || 0))
    .map((e) => ({
      timestamp: e.timestamp, applianceType: e.applianceType, eventType: e.eventType,
      severity: e.severity, callpointId: e.callpointId || null, rawMessage: e.rawMessage,
      eventId: e.id,
    }));

  const affectedCallpoints = Array.from(new Set(reproAfterSuppression.map((e) => e.callpointId).filter(Boolean)));
  const affectedControllers = Array.from(new Set(reproAfterSuppression.map((e) => e.controllerId).filter(Boolean)));
  const affectedRooms = Array.from(new Set(reproAfterSuppression.map((e) => e.room).filter(Boolean)));

  const rootCause = chosen ? {
    applianceType: chosen.rootApplianceType,
    kind: chosen.kind,
    summary: chosen.summary,
    evidenceEventIds: (chosen.evidenceEvents || []).map((e) => e.id),
  } : null;

  // Always emit ruled-out causes deterministically based on profiles.
  const ruledOut = [];
  if (chosen?.kind === "invalid_callpoint_burst") {
    ruledOut.push("event bridge messaging instability", "Pulse Gateway internal fault", "Display hardware fault");
  }
  if (chosen?.kind === "controller_first_then_downstream") {
    ruledOut.push("Pulse Gateway internal fault", "Display hardware fault", "Mobile app crash");
  }
  if (chosen?.kind === "access_input_origin") {
    ruledOut.push("Nurse call hardware fault");
  }
  if (chosen?.kind === "pulse_mobile_firewall") {
    ruledOut.push("Mobile app crash", "Pulse Gateway internal fault");
  }

  const partialDiagnosis = {
    incidentChains,
    firstFailurePoint,
    rootCause,
    downstreamSymptoms: downstreamSymptoms.map((e) => ({
      eventId: e.id, applianceType: e.applianceType, eventType: e.eventType,
      timestamp: e.timestamp, rawMessage: e.rawMessage,
    })),
    contradictions,
    confidence,
    confidenceBreakdown,
    nextChecks: chosen?.nextChecks || [],
    doNotDo: chosen?.doNotDo || [],
    ruledOut,
    bootRecoveryWindows: bootRecovery.windows.map((w) => ({
      applianceType: w.applianceType,
      from: w.from ? new Date(w.from).toISOString() : null,
      to: w.to ? new Date(w.to).toISOString() : null,
    })),
    evidenceTimeline,
    affectedCallpoints,
    affectedControllers,
    affectedRooms,
    partitions: {
      preWindowCount: partitioned.pre.length,
      reproductionWindowCount: partitioned.repro.length,
      postWindowCount: partitioned.post.length,
      noTimestampCount: partitioned.unknown.length,
    },
  };
  partialDiagnosis.correlationStory = buildCorrelationStory({ session, diagnosis: partialDiagnosis });
  return partialDiagnosis;
}

/** Exposed helper for tests. */
export const __test = { dependsOn, partitionByWindow, clusterByTime };
