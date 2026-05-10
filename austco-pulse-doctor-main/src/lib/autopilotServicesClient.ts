import { getBackendUrl } from "./siteConfig";

export type AutopilotServiceManager = "systemd" | "docker" | "webmin" | "custom";

export type AutopilotService = {
  id: string;
  name: string;
  type: string;
  role: string;
  host: string;
  sshUsername: string;
  sshPort: number;
  serviceManager: AutopilotServiceManager | string;
  systemdUnit: string;
  dockerContainer: string;
  webminPort: number | null;
  enabled: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

function base(): string {
  const backendUrl = getBackendUrl().trim();
  if (!backendUrl) return "";
  if (typeof window !== "undefined") {
    const sameOrigin = window.location.origin.replace(/\/$/, "");
    if (backendUrl.replace(/\/$/, "") === sameOrigin) return "";
  }
  return backendUrl.replace(/\/$/, "");
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, init);
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error((json as { message?: string }).message || `HTTP ${res.status}`);
  return json;
}

export const AUTOPILOT_SERVICES_UPDATED_EVENT = "autopilot-services:updated";

function notifyUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTOPILOT_SERVICES_UPDATED_EVENT));
}

export const autopilotServicesApi = {
  list: () => call<{ ok: boolean; services: AutopilotService[] }>("/api/autopilot/services"),
  save: async (svc: Partial<AutopilotService>) => {
    const r = await call<{ ok: boolean; service: AutopilotService }>("/api/autopilot/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(svc),
    });
    notifyUpdated();
    return r;
  },
  remove: async (id: string) => {
    const r = await call<{ ok: boolean; removed: number }>(`/api/autopilot/services/${encodeURIComponent(id)}`, { method: "DELETE" });
    notifyUpdated();
    return r;
  },
};

export type AutopilotServiceTypeKey =
  | "ipc-webmin" | "pulse-gateway" | "pulse-manage" | "inga"
  | "mqtt-broker" | "hl7" | "ipconnect" | "docker" | "systemd" | "custom";

export const AUTOPILOT_SERVICE_PROFILES: Array<{
  type: AutopilotServiceTypeKey;
  label: string;
  shortName: string;
  icon: string;
  description: string;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  group: "webmin" | "pulse" | "messaging" | "systemd" | "docker" | "custom";
  defaults: Partial<AutopilotService>;
}> = [
  { type: "ipc-webmin",    label: "IPC Webmin",       shortName: "WEBMIN SERVICES",  icon: "ServerCog", riskClass: "MEDIUM", group: "webmin",
    description: "Safe management of Webmin-managed IPC infrastructure with TLS-verified probes.",
    defaults: { role: "IPC Webmin", sshUsername: "tech", sshPort: 22, serviceManager: "webmin", webminPort: 10000 } },
  { type: "pulse-gateway", label: "Pulse Gateway",    shortName: "PULSE GATEWAY",    icon: "Radio",     riskClass: "MEDIUM", group: "pulse",
    description: "Container/runtime monitoring and safe restart for the Pulse Gateway service.",
    defaults: { role: "Pulse Gateway", sshUsername: "admin", sshPort: 22, serviceManager: "docker", dockerContainer: "pulse-gateway" } },
  { type: "pulse-manage",  label: "Pulse Manage",     shortName: "PULSE MANAGE",     icon: "Sliders",   riskClass: "MEDIUM", group: "pulse",
    description: "Container monitoring and orchestration recovery for the Pulse Manage admin service.",
    defaults: { role: "Pulse Manage", sshUsername: "admin", sshPort: 22, serviceManager: "docker", dockerContainer: "pulse-manage" } },
  { type: "inga",          label: "INGA",             shortName: "INGA",             icon: "Workflow",  riskClass: "MEDIUM", group: "systemd",
    description: "Systemd-supervised Integration Gateway with deterministic restart playbooks.",
    defaults: { role: "Integration Gateway", sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "inga" } },
  { type: "mqtt-broker",   label: "MQTT Broker",      shortName: "MQTT BROKER",      icon: "Cable",     riskClass: "HIGH",   group: "messaging",
    description: "Broker supervision and event-flow validation. High-impact restarts require approval.",
    defaults: { role: "MQTT Broker", sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "mosquitto" } },
  { type: "hl7",           label: "HL7",              shortName: "HL7 SERVICES",     icon: "HeartPulse", riskClass: "HIGH",  group: "messaging",
    description: "HL7 interface supervision. Patient-data path — restarts require manual approval.",
    defaults: { role: "HL7", sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "hl7" } },
  { type: "ipconnect",     label: "IPConnect",        shortName: "IPCONNECT",        icon: "Cloud",     riskClass: "MEDIUM", group: "systemd",
    description: "IPConnect VM supervision via systemd with safe restart playbooks.",
    defaults: { role: "IPConnect", sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "ipconnect" } },
  { type: "docker",        label: "Docker Container", shortName: "DOCKER SERVICES",  icon: "Container", riskClass: "MEDIUM", group: "docker",
    description: "Generic Docker container supervision with safe restart and log inspection.",
    defaults: { role: "Docker Service", sshUsername: "admin", sshPort: 22, serviceManager: "docker" } },
  { type: "systemd",       label: "Systemd Service",  shortName: "SYSTEMD SERVICES", icon: "Cog",       riskClass: "MEDIUM", group: "systemd",
    description: "Generic systemd unit supervision and approval-gated restarts.",
    defaults: { role: "Systemd Service", sshUsername: "admin", sshPort: 22, serviceManager: "systemd" } },
  { type: "custom",        label: "Custom Service",   shortName: "CUSTOM",           icon: "Wrench",    riskClass: "MANUAL" as never as "HIGH", group: "custom",
    description: "Hand-rolled service. Autopilot will not auto-execute — manual review only.",
    defaults: { role: "Custom Service", sshUsername: "admin", sshPort: 22, serviceManager: "custom" } },
];