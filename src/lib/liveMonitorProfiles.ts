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
};

export const LIVE_MONITOR_PROFILES: LiveMonitorProfile[] = [
  { key: "integration-gateway", label: "Integration Gateway", kind: "gateway", protocol: "tcp", port: 22, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/inga/logs/"], critical: true },
  { key: "pulse-gateway", label: "Pulse Gateway", kind: "gateway", protocol: "https", port: 443, tls: true, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/pulse-gateway/logs/"], critical: true },
  { key: "pulse-manage", label: "Pulse Manage", kind: "service", protocol: "https", port: 443, tls: true, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/pulse-manage/logs/"] },
  { key: "license-service", label: "License Service", kind: "service", protocol: "tcp", port: 443, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/license/logs/"] },
  { key: "mqtt-broker", label: "MQTT Broker", kind: "broker", protocol: "mqtt-fresh", port: 1883, mqttTopics: ["xcare/#"], ssh: { username: "admin", port: 22 }, logPaths: ["/var/log/mosquitto/"], critical: true },
  { key: "ws-mqtt-adapter", label: "WebSocket MQTT Adapter", kind: "service", protocol: "tcp", port: 9001, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/mqtt-websocket/logs/"] },
  { key: "ipconnect", label: "IPConnect", kind: "vm", protocol: "https", port: 443, tls: true, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/ipconnect/logs/"] },
  { key: "rtls-gateway", label: "RTLS Gateway", kind: "gateway", protocol: "tcp", port: 22, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/rtls/logs/"] },
  { key: "hl7", label: "HL7", kind: "service", protocol: "tcp", port: 22, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/hl7/logs/"] },
  { key: "file-server", label: "File Server", kind: "service", protocol: "tcp", port: 22, ssh: { username: "admin", port: 22 }, logPaths: ["/home/xcare/runtime/fileserver/logs/"] },
  { key: "mobile-gateway", label: "Mobile Gateway", kind: "gateway", protocol: "tcp", port: 22, ssh: { username: "tech", port: 22 }, logPaths: ["/home/xcare/runtime/mobilegateway/logs/"] },
  { key: "ipc-webmin", label: "IPC Webmin", kind: "service", protocol: "webmin", port: 10000, tls: true, ssh: { username: "tech", port: 22 }, logPaths: ["/var/webmin/miniserv.log"] },
  { key: "controller-ping", label: "Controller Ping", kind: "controller", protocol: "icmp", port: null },
  { key: "switch-ping", label: "Switch Ping", kind: "switch", protocol: "icmp", port: null },
  { key: "custom-tcp", label: "Custom TCP", kind: "generic", protocol: "tcp", port: null },
  { key: "custom-https", label: "Custom HTTPS", kind: "generic", protocol: "https", port: 443, tls: true },
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