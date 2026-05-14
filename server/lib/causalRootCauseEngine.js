function allText(evidence = []) {
  return evidence.map(x => JSON.stringify(x)).join("\n");
}

function extractEvents(text) {
  const events = [];

  const lines = text.split(/\\n|\\\\n/).join(" ").split(/(?=\\d{4}-\\d{2}-\\d{2}|\\w{3}\\s+\\w{3}\\s+\\d+)/);

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    let type = null;
    let layer = "unknown";
    let weight = 1;

    if (/Invalid call point ID or signal attributes/i.test(l)) {
      type = "INVALID_SIGNAL_MAPPING";
      layer = "configuration";
      weight = 95;
    } else if (/Closing WebSocket after a fatal error|Unknown websocket session/i.test(l)) {
      type = "WEBSOCKET_SESSION_FAILURE";
      layer = "application_session";
      weight = 65;
    } else if (/connect\\(\\) failed|connection refused|TCP socket connection is unsuccessful/i.test(l)) {
      type = "CONNECTION_REFUSED";
      layer = "transport";
      weight = 70;
    } else if (/mqtt|broker/i.test(l)) {
      type = "MQTT_REFERENCE";
      layer = "dependency";
      weight = 20;
    } else if (/PKIX|SSLHandshake|CertificateExpired/i.test(l)) {
      type = "CERTIFICATE_FAILURE";
      layer = "security";
      weight = 90;
    } else if (/BAD|bad message/i.test(l)) {
      type = "BAD_MESSAGE";
      layer = "controller_message";
      weight = 75;
    }

    if (type) {
      const ts = (l.match(/\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?/) || [null])[0];
      const cp = (l.match(/\\b\\d{4}\\.\\d+\\.\\d+\\.\\d+\\b|TSNS:[A-Z0-9-]+/i) || [null])[0];

      events.push({
        timestamp: ts,
        type,
        layer,
        weight,
        callpoint: cp,
        line: l.slice(0, 500)
      });
    }
  }

  return events;
}

export function buildCausalRootCause(evidence = []) {
  const text = allText(evidence);
  const events = extractEvents(text);

  const invalidSignals = events.filter(e => e.type === "INVALID_SIGNAL_MAPPING");
  const websockets = events.filter(e => e.type === "WEBSOCKET_SESSION_FAILURE");
  const refused = events.filter(e => e.type === "CONNECTION_REFUSED");
  const mqtt = events.filter(e => e.type === "MQTT_REFERENCE");
  const certs = events.filter(e => e.type === "CERTIFICATE_FAILURE");
  const bad = events.filter(e => e.type === "BAD_MESSAGE");

  let primary = {
    status: "UNKNOWN",
    exactRootCause: "No exact root cause detected yet.",
    where: "Unknown",
    whatFailedFirst: "Unknown",
    dependedOnIt: [],
    cascadedAfterward: [],
    symptomsNotRootCause: [],
    proof: [],
    exactNextStep: "Collect evidence during the failure window.",
    confidence: 35
  };

  if (invalidSignals.length >= 5) {
    const cps = [...new Set(invalidSignals.map(e => e.callpoint).filter(Boolean))];

    primary = {
      status: "CRITICAL",
      exactRootCause:
        "Integration Gateway is receiving callpoint/signal events that do not match its loaded configuration.",
      where:
        "Integration Gateway / AlarmService mapping layer",
      whatFailedFirst:
        "Invalid callpoint or signal-attribute mapping appeared first.",
      dependedOnIt: [
        "Integration Gateway event translation",
        "Pulse Gateway downstream routing",
        "TSNS / display event presentation",
        "Any integration relying on valid callpoint identity"
      ],
      cascadedAfterward: [
        websockets.length ? "WebSocket sessions destabilized after invalid signal storm." : null,
        refused.length ? "Connection refused/upstream failures appeared later as symptoms." : null,
        mqtt.length ? "MQTT/broker references are secondary unless direct broker failure is proven." : null
      ].filter(Boolean),
      symptomsNotRootCause: [
        "Generic dependency-layer instability",
        "MQTT unavailable unless broker logs prove it",
        "Port 8080 assumptions unless that exact service is confirmed expected",
        "WebSocket closing if it occurs after invalid signals"
      ],
      proof: [
        `${invalidSignals.length} invalid signal/callpoint events detected.`,
        cps.length ? `Affected IDs include: ${cps.slice(0, 20).join(", ")}` : "Invalid callpoint pattern detected.",
        invalidSignals[0]?.line
      ],
      exactNextStep:
        "Compare Integration Gateway loaded configuration against current CCP/IPConnect callpoint database. Verify those callpoint IDs exist and have valid signal attributes.",
      confidence: 94
    };
  } else if (certs.length) {
    primary = {
      status: "CRITICAL",
      exactRootCause: "Certificate / Java trust validation is failing.",
      where: "Certificate trust / Java TLS layer",
      whatFailedFirst: "SSL/PKIX/certificate validation failure.",
      dependedOnIt: ["Secure service-to-service communication"],
      cascadedAfterward: ["Service disconnects/timeouts may follow TLS rejection."],
      symptomsNotRootCause: ["Generic network outage"],
      proof: certs.slice(0, 5).map(e => e.line),
      exactNextStep: "Check VM time, certificate expiry, and Java truststore.",
      confidence: 92
    };
  } else if (refused.length) {
    primary = {
      status: "WARNING",
      exactRootCause: "A service endpoint is refusing connections.",
      where: "Application service / listening port",
      whatFailedFirst: "Connection refused event.",
      dependedOnIt: ["Upstream proxy or client connection"],
      cascadedAfterward: ["Retries, timeouts, and UI/report failures may follow."],
      symptomsNotRootCause: ["Do not assume MQTT unless direct broker evidence exists."],
      proof: refused.slice(0, 5).map(e => e.line),
      exactNextStep: "Confirm the expected service and port, then inspect service status on that host.",
      confidence: 75
    };
  }

  return {
    ok: true,
    mode: "causal_root_cause",
    summary: primary,
    timeline: events.slice(0, 80),
    counts: {
      invalidSignals: invalidSignals.length,
      websocketFailures: websockets.length,
      connectionRefused: refused.length,
      mqttReferences: mqtt.length,
      certificateFailures: certs.length,
      badMessages: bad.length
    }
  };
}
