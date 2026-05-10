/**
 * Developer Escalation Builder (M2)
 * ---------------------------------
 * Pure deterministic. Builds the package an onsite tech can hand to Austco
 * dev/support/escalation. Contains ONLY data already in the session +
 * correlator output — never invented.
 */

export function buildDeveloperPackage({ session, diagnosis, signalPath }) {
  const profile = {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    reproductionStartedAt: session.reproductionStartedAt,
    reproductionEndedAt: session.reproductionEndedAt,
    stoppedAt: session.stoppedAt,
    problemStatement: session.problemStatement,
    expectedBehavior: session.expectedBehavior,
    actualBehavior: session.actualBehavior,
    room: session.room,
    callpoint: session.callpoint,
    technicianNotes: session.technicianNotes,
    devicesIncluded: session.devicesIncluded,
  };

  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    capture: profile,
    rootCause: diagnosis?.rootCause || null,
    firstFailurePoint: diagnosis?.firstFailurePoint || null,
    confidence: diagnosis?.confidence ?? null,
    confidenceBreakdown: diagnosis?.confidenceBreakdown || [],
    contradictions: diagnosis?.contradictions || [],
    ruledOut: diagnosis?.ruledOut || [],
    nextChecks: diagnosis?.nextChecks || [],
    doNotDo: diagnosis?.doNotDo || [],
    bootRecoveryWindows: diagnosis?.bootRecoveryWindows || [],
    affected: {
      callpoints: diagnosis?.affectedCallpoints || [],
      controllers: diagnosis?.affectedControllers || [],
      rooms: diagnosis?.affectedRooms || [],
    },
    signalPath: signalPath?.signalPath || [],
    propagation: {
      brokenHop: signalPath?.brokenHop || null,
      firstMissingAck: signalPath?.firstMissingAck || null,
      propagationStop: signalPath?.propagationStop || null,
      downstreamSymptomLayers: signalPath?.downstreamSymptoms || [],
    },
    incidentChains: diagnosis?.incidentChains || [],
    evidenceTimeline: diagnosis?.evidenceTimeline || [],
    downstreamSymptoms: diagnosis?.downstreamSymptoms || [],
    rawEvidenceCount: (session.rawEvidence || []).length,
    normalizedEventCount: (session.normalizedEvents || []).length,
    correlationStory: diagnosis?.correlationStory || null,
    deterministicReasoning: buildReasoningTrace(diagnosis, signalPath),
  };
}

function buildReasoningTrace(diagnosis, signalPath) {
  const lines = [];
  if (diagnosis?.partitions) {
    const p = diagnosis.partitions;
    lines.push(`Partitioned events: pre=${p.preWindowCount}, repro=${p.reproductionWindowCount}, post=${p.postWindowCount}, no-ts=${p.noTimestampCount}.`);
  }
  if (diagnosis?.rootCause) {
    lines.push(`Root cause selected by rule: ${diagnosis.rootCause.kind} → ${diagnosis.rootCause.applianceType}.`);
    lines.push(`Reason: ${diagnosis.rootCause.summary}`);
  } else {
    lines.push("No deterministic root cause selected — insufficient evidence.");
  }
  if (signalPath?.brokenHop) {
    lines.push(`Signal propagation broken at layer: ${signalPath.brokenHop}.`);
  } else if (signalPath?.firstMissingAck) {
    lines.push(`Signal stopped propagating at layer: ${signalPath.firstMissingAck} (no evidence beyond this layer).`);
  }
  for (const c of diagnosis?.contradictions || []) {
    lines.push(`Contradiction: ${c.kind} — ${c.detail}`);
  }
  return lines;
}
