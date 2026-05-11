import test from "node:test";
import assert from "node:assert/strict";
import { buildTechnicianReadableDiagnosis } from "../lib/technicianReadableDiagnosis.js";

test("expired certificate is translated into plain English fix steps", () => {
  const d = buildTechnicianReadableDiagnosis({
    problem: "IPConnect keeps failing",
    appliance: "IPConnect",
    lines: [
      "SSLHandshakeException: General SSLEngine problem",
      "PKIX path validation failed",
      "CertificateExpiredException: NotAfter: Mon Jul 17 19:09:51 EDT 2023",
      "WsClient is not ready. Monitoring is not active."
    ]
  });

  assert.match(d.simpleIssue, /certificate is expired/i);
  assert.match(d.simpleCause, /Java rejected/i);
  assert.ok(d.confidence >= 90);
  assert.ok(d.fixSteps.some(x => /date\/time|date/i.test(x)));
  assert.ok(d.exactCommands.some(x => x.includes("openssl")));
});

test("invalid callpoint maps to CCP/IPConnect mapping issue", () => {
  const d = buildTechnicianReadableDiagnosis({
    lines: [
      "WARN AlarmService: Invalid call point ID or signal attributes for 4231.0.0.0"
    ]
  });

  assert.match(d.simpleIssue, /callpoint mapping/i);
  assert.ok(d.fixSteps.some(x => /IPConnect\/CCP/i.test(x)));
  assert.ok(d.doNotDo.some(x => /Pulse/i.test(x)));
});

test("known Tacera noise is suppressed", () => {
  const d = buildTechnicianReadableDiagnosis({
    lines: [
      "WARNING: JMX entry exists already, we replace it with new one",
      "WARNING: jacorb.home unset! Will use '.'"
    ]
  });

  assert.equal(d.confidence, 0);
  assert.ok(d.ignoredNoise.length >= 2);
});
