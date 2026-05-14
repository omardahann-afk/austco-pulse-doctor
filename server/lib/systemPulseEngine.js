export function buildSystemPulse(evidence = []) {
  const appliances = evidence.map(item => {
    const raw = JSON.stringify(item).toLowerCase();

    const rootCauses = [];
    const proof = [];
    const nextSteps = [];
    const symptoms = [];

    if (raw.includes("tcp socket connection is unsuccessful")) {
      symptoms.push("Repeated TCP connection failure");
      rootCauses.push("PST cannot reach or connect to its configured upstream target.");
      proof.push("PST log repeatedly shows: TCP socket connection is unsuccessful.");
      nextSteps.push("Check PST configured server/IPConnect target, gateway, subnet, and upstream service availability.");
    }

    if (raw.includes("2000-01-")) {
      symptoms.push("Invalid appliance clock");
      rootCauses.push("Appliance clock is wrong, which can break event sequencing, certificates, timeout logic, and diagnosis timelines.");
      proof.push("Agent evidence contains timestamps from year 2000.");
      nextSteps.push("Correct appliance date/time/NTP before trusting event timing.");
    }

    if (raw.includes("license violation") || raw.includes("pluginfailed")) {
      symptoms.push("License/plugin failure");
      rootCauses.push("A required xmlBlaster/plugin component may be failing due to license/configuration problems.");
      proof.push("Tacera evidence contains License violation / pluginFailed forced shutdown messages.");
      nextSteps.push("Check license service state, xmlBlaster plugin config, and recent license/config changes.");
    }

    if (raw.includes("backupetc.service loaded failed")) {
      symptoms.push("backupEtc service failed");
      rootCauses.push("The VM cannot complete its /etc backup task.");
      proof.push("systemctl failed shows backupEtc.service failed.");
      nextSteps.push("Inspect backupEtc.service logs and confirm /home filesystem/write permissions.");
    }

    if (raw.includes("smartd.service") && raw.includes("failed")) {
      symptoms.push("SMART disk monitor failed");
      rootCauses.push("Disk health monitoring service is failed or unsupported on this VM.");
      proof.push("systemctl failed shows smartd.service failed.");
      nextSteps.push("Check whether SMART is supported by the VM disk. If unsupported, downgrade to warning; if supported, inspect disk health.");
    }

    if (raw.includes("webmin.service") && raw.includes("inactive")) {
      symptoms.push("Webmin service inactive");
      rootCauses.push("Webmin is not running even though port/status may appear inconsistently from logs.");
      proof.push("Webmin status shows inactive/dead.");
      nextSteps.push("Confirm whether Webmin is expected to run on this VM, then start/restart only if approved.");
    }

    if (raw.includes("perl execution failed")) {
      symptoms.push("Webmin custom command failure");
      rootCauses.push("A Webmin custom script/run.cgi failed.");
      proof.push("Webmin logs show Perl execution failed for custom/run.cgi.");
      nextSteps.push("Inspect Webmin custom command line 17 and confirm script path/permissions.");
    }

    if (raw.includes("sslhandshake") || raw.includes("pkix") || raw.includes("certificateexpired")) {
      symptoms.push("Certificate trust failure");
      rootCauses.push("Java/certificate trust validation is failing.");
      proof.push("Logs contain SSL/PKIX/certificate expiry errors.");
      nextSteps.push("Check time, cert expiry, and Java truststore.");
    }

    const status =
      rootCauses.length >= 2 ? "CRITICAL" :
      rootCauses.length === 1 ? "WARNING" :
      "OK";

    return {
      agentKey: item.agentKey,
      host: item.host,
      ip: item.ip,
      role: item.role,
      lastSeen: item.receivedAt || item.timestamp,
      status,
      whatIsBroken: symptoms[0] || "No confirmed fault detected.",
      whyItMatters: rootCauses.length
        ? "This can affect alarm delivery, event routing, monitoring, or service reliability."
        : "Latest heartbeat does not show a major issue.",
      rootCauses,
      exactNextStep: nextSteps[0] || "Continue monitoring and capture during an active failure.",
      allNextSteps: nextSteps,
      proof,
      developerEvidence: item
    };
  });

  const broken = appliances.filter(a => a.status !== "OK");

  const allRootCauses = broken.flatMap(a =>
    a.rootCauses.map(cause => ({
      appliance: `${a.role} ${a.ip || a.host}`,
      cause,
      proof: a.proof
    }))
  );

  return {
    overall:
      broken.some(a => a.status === "CRITICAL") ? "CRITICAL" :
      broken.some(a => a.status === "WARNING") ? "WARNING" :
      "OK",

    headline:
      broken[0]?.whatIsBroken || "System currently looks healthy.",

    plainEnglish:
      broken.length
        ? `${broken.length} appliance(s) are reporting actionable issues. The top issue is: ${broken[0].whatIsBroken}.`
        : "No major fault is currently confirmed from agent heartbeats.",

    allDetectedRootCauses: allRootCauses,

    exactNextStep:
      broken[0]?.exactNextStep || "Continue monitoring.",

    appliances
  };
}
