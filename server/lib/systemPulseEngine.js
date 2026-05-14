export function buildSystemPulse(evidence = []) {
  const appliances = evidence.map(item => {
    const raw = JSON.stringify(item).toLowerCase();

    const issues = [];
    const proof = [];
    const rootCauses = [];
    const nextSteps = [];

    if (raw.includes("tcp socket connection is unsuccessful")) {
      issues.push("PST cannot establish TCP connection.");
      proof.push("PST log repeatedly shows: TCP socket connection is unsuccessful.");
      rootCauses.push("PST is likely failing to connect to its configured upstream server/IPConnect endpoint.");
      nextSteps.push("Check PST Network Properties: target IPC/server IP, gateway, subnet, and connected state.");
      nextSteps.push("From PST, confirm route/connectivity to IPConnect.");
    }

    if (raw.includes("2000-01-")) {
      issues.push("Device clock appears wrong.");
      proof.push("Logs are timestamped year 2000.");
      rootCauses.push("Wrong device time can break sequencing, correlation, certificates, and timeout interpretation.");
      nextSteps.push("Correct PST/appliance time source/NTP before trusting event timing.");
    }

    if (raw.includes("sslhandshake") || raw.includes("pkix") || raw.includes("certificateexpired")) {
      issues.push("Certificate/Java trust failure.");
      proof.push("Logs contain SSL/PKIX/certificate errors.");
      rootCauses.push("Secure service communication is failing due to certificate/trust validation.");
      nextSteps.push("Check VM time, certificate expiry, and Java truststore.");
    }

    if (raw.includes("invalid call point")) {
      issues.push("Invalid callpoint/config mapping.");
      proof.push("Logs contain invalid callpoint ID errors.");
      rootCauses.push("CCP/IPConnect object mapping may be stale or incorrect.");
      nextSteps.push("Review CCP assignment and affected callpoint IDs.");
    }

    if (raw.includes("bad message")) {
      issues.push("BAD messages detected.");
      proof.push("Controller/PST logs contain BAD message patterns.");
      rootCauses.push("Controller or PST message stream may be malformed, overloaded, or firmware/config related.");
      nextSteps.push("Correlate BAD message timestamps with alarm trigger and CCT activation.");
    }

    if (raw.includes("failed") && raw.includes("systemctl")) {
      issues.push("Failed Linux service detected.");
      proof.push("systemctl failed output contains failed unit information.");
      rootCauses.push("A required service may be down or unhealthy.");
      nextSteps.push("Open developer proof and inspect exact failed service before restart.");
    }

    const status =
      issues.length >= 2 ? "CRITICAL" :
      issues.length === 1 ? "WARNING" :
      "OK";

    return {
      host: item.host,
      ip: item.ip || "",
      role: item.role || "Unknown",
      lastSeen: item.receivedAt || item.timestamp,
      status,
      whatIsBroken: issues[0] || "No confirmed issue detected.",
      whyItMatters: issues.length
        ? "This may affect alarm delivery, integration routing, display activation, or event timing."
        : "Latest heartbeat does not show a major fault.",
      rootCauses,
      exactNextStep: nextSteps[0] || "Keep monitoring and capture during the failure window.",
      allNextSteps: nextSteps,
      proof,
      developerEvidence: item
    };
  });

  const critical = appliances.filter(a => a.status === "CRITICAL");
  const warning = appliances.filter(a => a.status === "WARNING");

  return {
    overall:
      critical.length ? "CRITICAL" :
      warning.length ? "WARNING" :
      "OK",

    headline:
      critical[0]?.whatIsBroken ||
      warning[0]?.whatIsBroken ||
      "System currently looks healthy.",

    brokenAppliances: [...critical, ...warning],

    plainEnglish:
      critical[0]
        ? `${critical[0].role} ${critical[0].host} is showing critical evidence: ${critical[0].whatIsBroken}`
        : warning[0]
          ? `${warning[0].role} ${warning[0].host} needs review: ${warning[0].whatIsBroken}`
          : "No major issue is currently confirmed from agent heartbeats.",

    exactNextStep:
      critical[0]?.exactNextStep ||
      warning[0]?.exactNextStep ||
      "Continue monitoring.",

    appliances
  };
}
