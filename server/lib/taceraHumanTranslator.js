export function translateTaceraFinding(findings = []) {
  const text = findings.join("\n");

  if (/CertificateExpiredException|PKIX|SSLHandshakeException|NotAfter/i.test(text)) {
    return {
      whatIsBroken:
        "Secure websocket/HTTPS trust is failing due to certificate/trust issue.",

      why:
        "Java rejected the certificate or trust chain.",

      whatIsProven: [
        "Certificate-related exceptions exist in runtime logs."
      ],

      whatIsNotProven: [
        "Webmin reachability does not prove app health.",
        "SSH reachability does not prove app health."
      ],

      nextSteps: [
        "Check VM date/time.",
        "Inspect certificate NotAfter date.",
        "Verify Java truststore.",
        "Replace or import correct certificate.",
        "Restart only affected services."
      ],

      doNotTouch: [
        "Do not reboot all VMs first.",
        "Do not blame controllers first."
      ]
    };
  }

  if (/Invalid call point|Could not interpret|Input is not defined/i.test(text)) {
    return {
      whatIsBroken:
        "Incoming callpoint/signal does not match active IPConnect/CCP configuration.",

      why:
        "IPConnect or Integration Gateway is receiving stale or invalid signal objects.",

      nextSteps: [
        "Extract affected callpoint IDs.",
        "Search callpoint IDs in CCP/IPConnect.",
        "Verify signal profile.",
        "Verify devices were not replaced/removed.",
        "Compare against latest CCP import."
      ],

      doNotTouch: [
        "Do not restart Pulse first.",
        "Do not reboot all VMs first."
      ]
    };
  }

  return {
    whatIsBroken:
      "No deterministic Tacera root cause found yet.",

    why:
      "More Tacera runtime evidence is required.",

    nextSteps: [
      "Read xcare runtime logs.",
      "Read wscli logs.",
      "Read pulse-gateway logs.",
      "Read integration-gateway logs."
    ]
  };
}
