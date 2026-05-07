import type { ProbeProtocol } from "./monitorClient";

export type LiveMonitorProfileKey =
  | "integration-gateway"
  | "pulse-gateway"
  | "pulse-manage"
  | "license-service"
  | "mqtt-broker"
  | "ws-mqtt-adapter"
  | "ipconnect"
  | "rtls-gateway"
  | "hl7"
  | "file-server"
  | "mobile-gateway"
  | "ipc-webmin"
  | "controller-ping"
  | "switch-ping"
  | "custom-tcp"
  | "custom-https";

export type LiveMonitorProfileGroup =
  | "integration"
  | "messaging"
  | "infrastructure"
  | "network"
  | "custom";

export type LiveMonitorProfile = {
  key: LiveMonitorProfileKey;
  label: string;
  kind: string;
  protocol: ProbeProtocol;
  port: number | null;
  tls?: boolean;
  ssh?: { username: string; port: number };
  logPaths?: string[];
  mqttTopics?: string[];
  critical?: boolean;
  intervalSec?: number;
  /** Operational tile metadata (NOC UX). */
  group: LiveMonitorProfileGroup;
  icon: string; // lucide icon name
  shortName: string; // ALL CAPS short label for tile
  description: string; // operational one-liner
};

export const LIVE_MONITOR_PROFILES: LiveMonitorProfile[] = [
  { key: "integration-gateway", label: "Integration Gateway", shortName: "INTEGRATION GATEWAY", group: "integration", icon: "Workflow",
    description: "Monitor INGA host reachability, SSH access, and integration runtime logs.",
    kind: "gateway", protocol: "tcp", port: 22, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/inga/logs/"], critical: true },
  { key: "pulse-gateway", label: "Pulse Gateway", shortName: "PULSE GATEWAY", group: "integration", icon: "Radio",
    description: "Monitor Pulse Gateway HTTPS, MQTT publishing, container health, and runtime logs.",
    kind: "gateway", protocol: "https", port: 443, tls: true, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/pulse-gateway/logs/"], critical: true },
  { key: "pulse-manage", label: "Pulse Manage", shortName: "PULSE MANAGE", group: "integration", icon: "Sliders",
    description: "Monitor Pulse Manage admin runtime, HTTPS health, and orchestration logs.",
    kind: "service", protocol: "https", port: 443, tls: true, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/pulse-manage/logs/"] },
  { key: "mobile-gateway", label: "Mobile Gateway", shortName: "MOBILE GATEWAY", group: "integration", icon: "Smartphone",
    description: "Monitor Mobile Gateway VM, SSH access, and mobile runtime logs.",
    kind: "gateway", protocol: "tcp", port: 22, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/mobilegateway/logs/"] },
  { key: "rtls-gateway", label: "RTLS Gateway", shortName: "RTLS", group: "integration", icon: "Locate",
    description: "Monitor RTLS gateway reachability, SSH, and tag-flow runtime logs.",
    kind: "gateway", protocol: "tcp", port: 22, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/rtls/logs/"] },

  { key: "mqtt-broker", label: "MQTT Broker", shortName: "MQTT BROKER", group: "messaging", icon: "Cable",
    description: "Monitor mosquitto reachability, MQTT freshness, subscriptions, and event flow.",
    kind: "broker", protocol: "mqtt-fresh", port: 1883, mqttTopics: ["xcare/#"], ssh: { username: "admin", port: 22 }, logPaths: ["/var/log/mosquitto/"], critical: true },
  { key: "ws-mqtt-adapter", label: "WebSocket MQTT Adapter", shortName: "WS-MQTT", group: "messaging", icon: "PlugZap",
    description: "Monitor MQTT-over-WebSocket bridge port, SSH, and adapter runtime logs.",
    kind: "service", protocol: "tcp", port: 9001, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/mqtt-websocket/logs/"] },
  { key: "hl7", label: "HL7", shortName: "HL7", group: "messaging", icon: "HeartPulse",
    description: "Monitor HL7 interface host, SSH, and message-flow logs.",
    kind: "service", protocol: "tcp", port: 22, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/hl7/logs/"] },

  { key: "ipc-webmin", label: "IPC Webmin", shortName: "IPC WEBMIN", group: "infrastructure", icon: "ServerCog",
    description: "Monitor Webmin availability, miniserv status, TLS health, and SSH access.",
    kind: "service", protocol: "webmin", port: 10000, tls: true, ssh: { username: "tech", port: 22 }, logPaths: ["/var/webmin/miniserv.log"] },
  { key: "ipconnect", label: "IPConnect", shortName: "IPCONNECT", group: "infrastructure", icon: "Cloud",
    description: "Monitor IPConnect VM HTTPS health, SSH, and integration logs.",
    kind: "vm", protocol: "https", port: 443, tls: true, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/ipconnect/logs/"] },
  { key: "license-service", label: "License Service", shortName: "LICENSE", group: "infrastructure", icon: "KeyRound",
    description: "Monitor licensing endpoint reachability, SSH, and runtime logs.",
    kind: "service", protocol: "tcp", port: 443, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/license/logs/"] },
  { key: "file-server", label: "File Server", shortName: "FILE SERVER", group: "infrastructure", icon: "HardDrive",
    description: "Monitor file server host, SSH access, and storage runtime logs.",
    kind: "service", protocol: "tcp", port: 22, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/fileserver/logs/"] },

  { key: "controller-ping", label: "Controller Ping", shortName: "CONTROLLER", group: "network", icon: "Cpu",
    description: "ICMP reachability for Tacera controllers and call-point hubs.",
    kind: "controller", protocol: "icmp", port: null },
  { key: "switch-ping", label: "Switch Ping", shortName: "SWITCH", group: "network", icon: "Network",
    description: "ICMP reachability for network switches feeding the call system.",
    kind: "switch", protocol: "icmp", port: null },

  { key: "custom-tcp", label: "Custom TCP", shortName: "CUSTOM TCP", group: "custom", icon: "Plug",
    description: "Probe an arbitrary TCP port on any host.",
    kind: "generic", protocol: "tcp", port: null },
  { key: "custom-https", label: "Custom HTTPS", shortName: "CUSTOM HTTPS", group: "custom", icon: "Globe",
    description: "Probe an arbitrary HTTPS endpoint with TLS validation.",
    kind: "generic", protocol: "https", port: 443, tls: true },
];

export const LIVE_MONITOR_GROUPS: { key: LiveMonitorProfileGroup; label: string }[] = [
  { key: "integration",    label: "INTEGRATION & GATEWAYS" },
  { key: "messaging",      label: "MESSAGING & EVENT FLOW" },
  { key: "infrastructure", label: "CORE INFRASTRUCTURE" },
  { key: "network",        label: "NETWORK FABRIC" },
  { key: "custom",         label: "CUSTOM PROBES" },
];

export function findLiveMonitorProfile(key: LiveMonitorProfileKey | string | null | undefined) {
  if (!key) return undefined;
  return LIVE_MONITOR_PROFILES.find((p) => p.key === key);
}

export function slugifyHost(host: string) {
  return host.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function buildDeviceId(profileKey: string, host: string) {
  const h = slugifyHost(host) || "device";
  return `${profileKey}-${h}`;
}