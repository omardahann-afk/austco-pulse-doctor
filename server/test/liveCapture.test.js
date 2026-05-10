/**
 * M2 acceptance tests for the Tacera Incident Correlator.
 * Run with: node --test server/test/liveCapture.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { correlateIncident } from "../lib/taceraIncidentCorrelator.js";
import { buildSignalPath } from "../lib/signalPathEngine.js";
import { normalizeForensicEvents } from "../lib/taceraEventNormalizer.js";

function sessionFor(events, { reproStart, reproEnd } = {}) {
  return {
    sessionId: "test",
    status: "stopped",
    reproductionStartedAt: reproStart || "2026-05-10T10:00:00.000Z",
    reproductionEndedAt: reproEnd || "2026-05-10T10:05:00.000Z",
    normalizedEvents: events,
    rawEvidence: [],
  };
}

function normalize(kind, lines, fallbackTs) {
  return normalizeForensicEvents({
    device: { id: kind, name: kind, kind },
    lines,
    fallbackTimestamp: fallbackTs,
  }).events;
}

test("TEST 1: controller heartbeat lost → later Pulse WS errors are downstream symptoms", () => {
  const events = [
    ...normalize("ip-cct", ["2026-05-10T10:01:00Z controller offline heartbeat lost"], "2026-05-10T10:01:00Z"),
    ...normalize("pulse-gateway", ["2026-05-10T10:01:30Z websocket disconnect"], "2026-05-10T10:01:30Z"),
    ...normalize("ip-app1", ["2026-05-10T10:02:00Z websocket error"], "2026-05-10T10:02:00Z"),
  ];
  const r = correlateIncident({ session: sessionFor(events) });
  assert.equal(r.rootCause?.applianceType, "ip-cct", "controller must be root");
  assert.equal(r.rootCause?.kind, "controller_first_then_downstream");
  assert.ok(r.downstreamSymptoms.length >= 1, "Pulse/display events must be downstream");
  assert.ok(r.doNotDo.some((d) => /restart pulse gateway/i.test(d)), "must say do not restart Pulse first");
});

test("TEST 2: repeated invalid callpoint IDs → CCP/mapping diagnosis, not messaging", () => {
  const events = [
    ...normalize("ipconnect", [
      "2026-05-10T10:01:00Z Invalid call point ID 1.2.3.4 received",
      "2026-05-10T10:01:05Z Invalid call point signal attributes for 1.2.3.5",
      "2026-05-10T10:01:10Z Invalid call point ID 1.2.3.6",
    ], "2026-05-10T10:01:00Z"),
  ];
  const r = correlateIncident({ session: sessionFor(events) });
  assert.equal(r.rootCause?.kind, "invalid_callpoint_burst");
  assert.equal(r.rootCause?.applianceType, "ipconnect");
  assert.ok(r.ruledOut.some((s) => /MQTT/i.test(s)), "must rule out MQTT messaging");
  assert.ok(r.affectedCallpoints.length >= 2);
});

test("TEST 3: IP-IN8 access input active → access-control origin", () => {
  const events = normalize("ip-in8", [
    "2026-05-10T10:01:00Z IP-IN8 input 3 active",
    "2026-05-10T10:01:00Z IP-IN8 input 3 active",
  ], "2026-05-10T10:01:00Z");
  const r = correlateIncident({ session: sessionFor(events) });
  assert.equal(r.rootCause?.applianceType, "access-input");
  assert.ok(r.ruledOut.some((s) => /nurse call/i.test(s)));
});

test("TEST 4: recent boot + websocket errors → boot recovery suppression", () => {
  const events = [
    ...normalize("pulse-gateway", ["2026-05-10T10:01:00Z systemd[1]: Started pulse-gateway.service"], "2026-05-10T10:01:00Z"),
    ...normalize("pulse-gateway", ["2026-05-10T10:01:30Z websocket error"], "2026-05-10T10:01:30Z"),
  ];
  const r = correlateIncident({ session: sessionFor(events) });
  assert.ok(r.bootRecoveryWindows.length >= 1, "must detect boot recovery window");
  // Pulse Gateway is not a root-cause candidate, so without the boot suppression we'd still get null.
  // Either way the result must NOT name pulse-gateway as the root cause.
  if (r.rootCause) assert.notEqual(r.rootCause.applianceType, "pulse-gateway");
});

test("TEST 5: Pulse mobile push port blocked → firewall/network path issue", () => {
  const events = normalize("pulse-mobile", [
    "2026-05-10T10:01:00Z timeout connecting to 5228",
    "2026-05-10T10:01:30Z connection refused 5223",
  ], "2026-05-10T10:01:00Z");
  const r = correlateIncident({ session: sessionFor(events) });
  assert.equal(r.rootCause?.kind, "pulse_mobile_firewall");
  assert.ok(r.nextChecks.some((c) => /5223|5228/.test(c)));
});

test("Signal path engine identifies broken hop", () => {
  const events = [
    ...normalize("ip-cct", ["2026-05-10T10:01:00Z controller offline heartbeat lost"], "2026-05-10T10:01:00Z"),
    ...normalize("pulse-gateway", ["2026-05-10T10:01:30Z websocket error"], "2026-05-10T10:01:30Z"),
  ];
  const sp = buildSignalPath({ session: sessionFor(events) });
  assert.equal(sp.brokenHop, "ip-cct");
  assert.ok(sp.downstreamSymptoms.includes("pulse-gateway"));
});
