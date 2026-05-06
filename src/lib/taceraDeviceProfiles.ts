/**
 * Tacera Device Profiles (Phase 7C)
 * ----------------------------------
 * Catalog of well-known Tacera/Pulse/IPConnect/INGA device types and the
 * default health-check shape for each. Used by the Monitored Devices UI to
 * prefill an "Add device" form, and by future CCP auto-discovery to choose
 * a profile for a discovered device.
 *
 * Each profile maps to a poll-time payload that the backend already
 * understands (see /api/monitor/devices). New protocols `mqtt-fresh` and
 * `webmin` are added in this slice.
 */

export type TaceraProtocol = "icmp" | "tcp" | "https" | "http" | "mqtt" | "mqtt-fresh" | "webmin";

export type TaceraDeviceType =
  | "ipc-primary"
  | "ipc-secondary"
  | "pulse-gateway"
  | "pulse-manage"
  | "inga"
  | "hl7"
  | "mqtt-broker"
  | "ip-cct"
  | "ip-room-controller"
  | "ip-app1"
  | "an-pd2"
  | "ipnet-router"
  | "zone-light"
  | "display-driver"
  | "linux-vm"
  | "windows-vm"
  | "webmin"
  | "switch"
  | "router"
  | "dns"
  | "hypervisor";

export type TaceraDeviceProfile = {
  type: TaceraDeviceType;
  category: "tacera" | "infrastructure";
  label: string;
  description: string;
  /** Default kind value for SQLite devices.kind column. */
  kind: string;
  /** Default protocol used for primary health check. */
  protocol: TaceraProtocol;
  /** Optional extra ports the technician may want to monitor separately. */
  expectedPorts: number[];
  /** Default poll interval (ms). */
  pollIntervalMs: number;
  /** Stale threshold (ms) — ageOfLastOk above this = stale. */
  staleThresholdMs: number;
  /** Default port for the primary protocol. null = N/A (icmp). */
  defaultPort: number | null;
  /** MQTT topics commonly used (for `mqtt-fresh` probes). */
  mqttTopics: string[];
  /** Critical infra devices show in fault summaries first. */
  critical: boolean;
  /** Hint at typical parent device type — used for topology auto-link. */
  parentType: TaceraDeviceType | null;
  /** Free-form notes shown in the UI. */
  notes: string;
};

export const TACERA_DEVICE_PROFILES: TaceraDeviceProfile[] = [
  {
    type: "ipc-primary", category: "tacera", label: "IPC Primary",
    description: "Primary IPConnect VM. Webmin + MQTT bridge to Pulse Gateway.",
    kind: "ipc", protocol: "webmin", expectedPorts: [22, 443, 1883, 10000],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: 10000,
    mqttTopics: ["xcare/heartbeat/#"], critical: true, parentType: "pulse-gateway",
    notes: "Webmin reachable on :10000. SSH on :22.",
  },
  {
    type: "ipc-secondary", category: "tacera", label: "IPC Secondary",
    description: "Failover IPConnect VM.",
    kind: "ipc", protocol: "webmin", expectedPorts: [22, 443, 1883, 10000],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: 10000,
    mqttTopics: ["xcare/heartbeat/#"], critical: true, parentType: "pulse-gateway",
    notes: "Cold/warm standby paired with IPC Primary.",
  },
  {
    type: "pulse-gateway", category: "tacera", label: "Pulse Gateway",
    description: "MQTT broker + HTTPS management UI. Core message bus.",
    kind: "gateway", protocol: "mqtt-fresh", expectedPorts: [443, 1883, 8883],
    pollIntervalMs: 20_000, staleThresholdMs: 60_000, defaultPort: 1883,
    mqttTopics: ["xcare/#"], critical: true, parentType: null,
    notes: "Primary message broker. Stale MQTT here = whole site dark.",
  },
  {
    type: "pulse-manage", category: "tacera", label: "Pulse Manage",
    description: "Pulse configuration / management portal.",
    kind: "service", protocol: "https", expectedPorts: [443],
    pollIntervalMs: 60_000, staleThresholdMs: 180_000, defaultPort: 443,
    mqttTopics: [], critical: false, parentType: "pulse-gateway",
    notes: "Web UI only — outage here does not stop calls.",
  },
  {
    type: "inga", category: "tacera", label: "INGA Integration Gateway",
    description: "Tacera Integration Gateway. HL7 + 3rd-party translation.",
    kind: "gateway", protocol: "mqtt-fresh", expectedPorts: [443, 1883, 2575],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: 1883,
    mqttTopics: ["xcare/inga/#"], critical: true, parentType: "pulse-gateway",
    notes: "Watch HL7 :2575 if HL7 integration enabled.",
  },
  {
    type: "hl7", category: "tacera", label: "HL7 Listener",
    description: "HL7 v2 listener (MLLP).",
    kind: "service", protocol: "tcp", expectedPorts: [2575],
    pollIntervalMs: 60_000, staleThresholdMs: 300_000, defaultPort: 2575,
    mqttTopics: [], critical: false, parentType: "inga",
    notes: "MLLP handshake check. Optional service.",
  },
  {
    type: "mqtt-broker", category: "tacera", label: "MQTT Broker",
    description: "Standalone MQTT broker (Mosquitto / equivalent).",
    kind: "broker", protocol: "mqtt-fresh", expectedPorts: [1883, 8883],
    pollIntervalMs: 20_000, staleThresholdMs: 60_000, defaultPort: 1883,
    mqttTopics: ["#"], critical: true, parentType: null,
    notes: "Wildcard freshness — verifies bus is alive.",
  },
  {
    type: "ip-cct", category: "tacera", label: "IP-CCT Call Controller",
    description: "Tacera IP call controller hardware.",
    kind: "controller", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 20_000, staleThresholdMs: 90_000, defaultPort: null,
    mqttTopics: ["xcare/controller/+/heartbeat"], critical: true, parentType: "ipc-primary",
    notes: "Field hardware — ICMP + MQTT heartbeat.",
  },
  {
    type: "ip-room-controller", category: "tacera", label: "IP Room Controller",
    description: "Per-room controller hardware.",
    kind: "controller", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: null,
    mqttTopics: ["xcare/room/+/heartbeat"], critical: false, parentType: "ipc-primary",
    notes: "Per-room controller. Often deployed in dozens.",
  },
  {
    type: "ip-app1", category: "tacera", label: "IP-APP1 Annunciator",
    description: "IP application annunciator panel.",
    kind: "annunciator", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: null,
    mqttTopics: [], critical: false, parentType: "ipc-primary",
    notes: "Annunciator display panel.",
  },
  {
    type: "an-pd2", category: "tacera", label: "AN-PD2 Display",
    description: "Patient display panel AN-PD2.",
    kind: "display", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: null,
    mqttTopics: [], critical: false, parentType: "ipc-primary",
    notes: "Field display device.",
  },
  {
    type: "ipnet-router", category: "tacera", label: "IPNet Router",
    description: "Tacera-supplied edge router.",
    kind: "router", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: null,
    mqttTopics: [], critical: true, parentType: null,
    notes: "Site edge — lose this and the whole VLAN goes dark.",
  },
  {
    type: "zone-light", category: "tacera", label: "Zone Light",
    description: "Corridor zone light device.",
    kind: "display", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 60_000, staleThresholdMs: 300_000, defaultPort: null,
    mqttTopics: [], critical: false, parentType: "ipc-primary",
    notes: "Corridor signaling lamp.",
  },
  {
    type: "display-driver", category: "tacera", label: "Display Driver",
    description: "Display driver process / service.",
    kind: "service", protocol: "tcp", expectedPorts: [],
    pollIntervalMs: 60_000, staleThresholdMs: 240_000, defaultPort: null,
    mqttTopics: [], critical: false, parentType: "ipc-primary",
    notes: "Drives display panels.",
  },
  {
    type: "linux-vm", category: "infrastructure", label: "Linux VM",
    description: "Generic Linux host (SSH).",
    kind: "vm", protocol: "tcp", expectedPorts: [22],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: 22,
    mqttTopics: [], critical: false, parentType: "hypervisor",
    notes: "Plain SSH reachability check.",
  },
  {
    type: "windows-vm", category: "infrastructure", label: "Windows VM",
    description: "Generic Windows host (RDP).",
    kind: "vm", protocol: "tcp", expectedPorts: [3389],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: 3389,
    mqttTopics: [], critical: false, parentType: "hypervisor",
    notes: "RDP port reachability.",
  },
  {
    type: "webmin", category: "infrastructure", label: "Webmin",
    description: "Webmin admin UI on a Linux host.",
    kind: "service", protocol: "webmin", expectedPorts: [10000],
    pollIntervalMs: 60_000, staleThresholdMs: 240_000, defaultPort: 10000,
    mqttTopics: [], critical: false, parentType: "linux-vm",
    notes: "Validates Webmin login page response.",
  },
  {
    type: "switch", category: "infrastructure", label: "Network Switch",
    description: "Managed switch (ICMP only here).",
    kind: "switch", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 60_000, staleThresholdMs: 300_000, defaultPort: null,
    mqttTopics: [], critical: true, parentType: null,
    notes: "SNMP not yet polled — ICMP reachability only.",
  },
  {
    type: "router", category: "infrastructure", label: "Router",
    description: "Edge / core router.",
    kind: "router", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 30_000, staleThresholdMs: 120_000, defaultPort: null,
    mqttTopics: [], critical: true, parentType: null,
    notes: "Edge reachability.",
  },
  {
    type: "dns", category: "infrastructure", label: "DNS Server",
    description: "DNS resolver host.",
    kind: "service", protocol: "tcp", expectedPorts: [53],
    pollIntervalMs: 60_000, staleThresholdMs: 300_000, defaultPort: 53,
    mqttTopics: [], critical: false, parentType: null,
    notes: "TCP/53 reachability (proxy for resolution).",
  },
  {
    type: "hypervisor", category: "infrastructure", label: "Hypervisor Host",
    description: "VMware/Proxmox/KVM host.",
    kind: "vm", protocol: "icmp", expectedPorts: [],
    pollIntervalMs: 60_000, staleThresholdMs: 300_000, defaultPort: null,
    mqttTopics: [], critical: true, parentType: null,
    notes: "Lose this and every guest VM goes with it.",
  },
];

export function findProfile(type: TaceraDeviceType): TaceraDeviceProfile | undefined {
  return TACERA_DEVICE_PROFILES.find((p) => p.type === type);
}

/** Build a partial device payload from a profile + host. Caller fills id/name. */
export function deviceFromProfile(
  profile: TaceraDeviceProfile,
  host: string,
): {
  kind: string;
  protocol: TaceraProtocol;
  host: string | null;
  port: number | null;
  intervalMs: number;
  meta: { taceraType: TaceraDeviceType; mqttTopics: string[]; critical: boolean; staleThresholdMs: number; expectedPorts: number[] };
} {
  return {
    kind: profile.kind,
    protocol: profile.protocol,
    host: host || null,
    port: profile.defaultPort,
    intervalMs: profile.pollIntervalMs,
    meta: {
      taceraType: profile.type,
      mqttTopics: profile.mqttTopics,
      critical: profile.critical,
      staleThresholdMs: profile.staleThresholdMs,
      expectedPorts: profile.expectedPorts,
    },
  };
}