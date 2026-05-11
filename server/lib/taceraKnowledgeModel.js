export const TACERA_COMPONENTS = {
  xcare: {
    role: "IPConnect / xCare Runtime",
    layer: "core-runtime",
    logPaths: [
      "/home/xcare/runtime/xcare/log",
      "/var/opt/xcare/log"
    ],
    symptoms: [
      "WsClient is not ready",
      "Connection refused",
      "SSLHandshakeException"
    ],
    falsePositives: [
      "generic Linux failed services",
      "docker permission denied"
    ],
    provesFailure: [
      "repeating runtime exceptions",
      "certificate trust failure",
      "confirmed upstream refusal"
    ],
    doesNotProveFailure: [
      "Webmin reachable",
      "SSH reachable"
    ]
  },

  "pulse-gateway": {
    role: "Pulse Gateway",
    layer: "pulse",
    logPaths: [
      "/home/xcare/runtime/pulse-gateway/log"
    ]
  },

  "integration-gateway": {
    role: "Integration Gateway / INGA",
    layer: "integration",
    logPaths: [
      "/home/xcare/runtime/integration-gateway/logs"
    ]
  },

  "license-service": {
    role: "License Service",
    layer: "licensing",
    logPaths: [
      "/home/xcare/runtime/license-service/log"
    ]
  },

  configuration: {
    role: "Pulse Manage / Configuration",
    layer: "frontend",
    logPaths: [
      "/home/xcare/runtime/configuration/log"
    ]
  },

  appstation: {
    role: "AppStation Server",
    layer: "frontend",
    logPaths: [
      "/home/xcare/runtime/appstation/log"
    ]
  },

  nursestation: {
    role: "Nurse Station Server",
    layer: "frontend",
    logPaths: [
      "/home/xcare/runtime/nursestation/log"
    ]
  },

  annunciator: {
    role: "Annunciator Server",
    layer: "frontend",
    logPaths: [
      "/home/xcare/runtime/annunciator/log"
    ]
  },

  displaydriver: {
    role: "Display Driver",
    layer: "frontend",
    logPaths: [
      "/home/xcare/runtime/displaydriver/log"
    ]
  },

  "audio-service": {
    role: "Audio Service",
    layer: "frontend",
    logPaths: [
      "/home/xcare/runtime/audio-service/log"
    ]
  },

  wscli: {
    role: "WebSocket Client Layer",
    layer: "runtime",
    logPaths: [
      "/home/xcare/runtime/wscli/log"
    ]
  },

  certs: {
    role: "Certificate Runtime",
    layer: "security",
    logPaths: [
      "/home/xcare/runtime/certs/logs"
    ]
  },

  heartbeat: {
    role: "HA / Heartbeat",
    layer: "ha"
  },

  drbd: {
    role: "DRBD HA",
    layer: "ha"
  }
};
