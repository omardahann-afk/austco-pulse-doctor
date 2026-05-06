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
  defaults: Partial<AutopilotService>;
}> = [
  { type: "ipc-webmin",    label: "IPC Webmin",       defaults: { role: "IPC Webmin",       sshUsername: "tech",  sshPort: 22, serviceManager: "webmin", webminPort: 10000 } },
  { type: "pulse-gateway", label: "Pulse Gateway",    defaults: { role: "Pulse Gateway",    sshUsername: "admin", sshPort: 22, serviceManager: "docker", dockerContainer: "pulse-gateway" } },
  { type: "pulse-manage",  label: "Pulse Manage",     defaults: { role: "Pulse Manage",     sshUsername: "admin", sshPort: 22, serviceManager: "docker", dockerContainer: "pulse-manage" } },
  { type: "inga",          label: "INGA",             defaults: { role: "Integration Gateway", sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "inga" } },
  { type: "mqtt-broker",   label: "MQTT Broker",      defaults: { role: "MQTT Broker",      sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "mosquitto" } },
  { type: "hl7",           label: "HL7",              defaults: { role: "HL7",              sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "hl7" } },
  { type: "ipconnect",     label: "IPConnect",        defaults: { role: "IPConnect",        sshUsername: "admin", sshPort: 22, serviceManager: "systemd", systemdUnit: "ipconnect" } },
  { type: "docker",        label: "Docker Container", defaults: { role: "Docker Service",   sshUsername: "admin", sshPort: 22, serviceManager: "docker" } },
  { type: "systemd",       label: "Systemd Service",  defaults: { role: "Systemd Service",  sshUsername: "admin", sshPort: 22, serviceManager: "systemd" } },
  { type: "custom",        label: "Custom Service",   defaults: { role: "Custom Service",   sshUsername: "admin", sshPort: 22, serviceManager: "custom" } },
];