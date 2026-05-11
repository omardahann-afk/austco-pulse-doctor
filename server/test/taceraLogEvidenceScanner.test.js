import test from "node:test";
import assert from "node:assert/strict";
import { buildTaceraLogDiagnosis } from "../lib/taceraLogEvidenceScanner.js";

test("certificate findings beat generic machine health", () => {
  const d = buildTaceraLogDiagnosis({
    host: "192.168.10.201",
    profile: "license-service",
    logFindings: [
      {
        id: "CERT_EXPIRED",
        severity: "critical",
        layer: "certificate / trust",
        simpleIssue: "A secure websocket/HTTPS connection is failing because a certificate is expired.",
        why: "Java is rejecting the certificate because the certificate validity date has passed.",
        line: "CertificateExpiredException: NotAfter: Mon Jul 17 19:09:51 EDT 2023",
        sourceFile: "/home/xcare/runtime/xcare/log/xcare00.log",
        nextSteps: ["Renew certificate"],
        commands: ["openssl s_client -connect <host>:443 -showcerts"],
        doNotTouch: ["Do not reboot all VMs first."]
      }
    ]
  });

  assert.match(d.whatIsBroken, /certificate is expired/i);
  assert.equal(d.confidence, 95);
  assert.equal(d.primaryPattern, "CERT_EXPIRED");
});

test("invalid callpoint becomes CCP/IPConnect issue", () => {
  const d = buildTaceraLogDiagnosis({
    host: "192.168.10.196",
    profile: "ipconnect",
    logFindings: [
      {
        id: "INVALID_CALLPOINT",
        severity: "high",
        layer: "IPConnect / CCP configuration truth",
        simpleIssue: "The system is receiving a callpoint/signal object that does not match active IPConnect/CCP configuration.",
        why: "IPConnect or Integration Gateway is seeing callpoint IDs/signals that are missing or stale.",
        line: "Invalid call point ID or signal attributes for 4231.0.0.0",
        sourceFile: "/home/xcare/runtime/integration-gateway/logs/app.log",
        nextSteps: ["Search CCP"],
        commands: ["grep"],
        doNotTouch: ["Do not restart Pulse first."]
      }
    ]
  });

  assert.match(d.whatIsBroken, /callpoint/i);
  assert.ok(d.affectedCallpoints.includes("4231.0.0.0"));
});
