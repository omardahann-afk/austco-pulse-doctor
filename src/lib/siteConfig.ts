/**
 * Site-config-driven diagnosis types + localStorage store.
 *
 * No defaults. No hardcoded IPs. Empty config = empty diagnosis.
 */

export type ModuleRole =
  | "Pulse Gateway"
  | "IPConnect"
  | "INGA / Integration Gateway"
  | "License Server"
  | "Pulse Manage"
  | "Display / IP-APP";

export type ModuleEntry = {
  id: string;
  role: ModuleRole;
  name: string;
  ip: string;
  hostname: string;
  vlan: string;
  notes: string;
};

export type ControllerEntry = {
  id: string;
  name: string;
  ip: string;
  controllerId: string;
  area: string;
  notes: string;
};

export type IpIn8Entry = {
  id: string;
  name: string;
  ip: string;
  vlan: string;
  notes: string;
};

export type SwitchEntry = {
  id: string;
  name: string;
  ip: string;
  vendor: string;
  snmpEnabled: boolean;
  community: string;
  notes: string;
};

export type VlanEntry = {
  id: string;
  name: string;
  cidr: string;
};

export type SiteConfig = {
  siteName: string;
  vlans: VlanEntry[];
  modules: ModuleEntry[];
  controllers: ControllerEntry[];
  ipin8s: IpIn8Entry[];
  switches: SwitchEntry[];
  displaysEnabled: boolean;
};

export const EMPTY_SITE_CONFIG: SiteConfig = {
  siteName: "",
  vlans: [],
  modules: [],
  controllers: [],
  ipin8s: [],
  switches: [],
  displaysEnabled: false,
};

const STORAGE_KEY = "tacera.siteConfig.v1";
const RESULT_KEY = "tacera.diagnosisResult.v1";

export function loadSiteConfig(): SiteConfig {
  if (typeof window === "undefined") return structuredClone(EMPTY_SITE_CONFIG);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(EMPTY_SITE_CONFIG);
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return { ...EMPTY_SITE_CONFIG, ...parsed };
  } catch {
    return structuredClone(EMPTY_SITE_CONFIG);
  }
}

export function saveSiteConfig(cfg: SiteConfig) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearSiteConfig() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function isConfigEmpty(cfg: SiteConfig): boolean {
  return (
    cfg.modules.length === 0 &&
    cfg.controllers.length === 0 &&
    cfg.ipin8s.length === 0 &&
    cfg.switches.length === 0
  );
}

/** Total number of devices that have at least an IP or hostname to test. */
export function countTestableDevices(cfg: SiteConfig): number {
  const has = (ip: string, hn = "") => Boolean(ip.trim() || hn.trim());
  return (
    cfg.modules.filter((m) => has(m.ip, m.hostname)).length +
    cfg.controllers.filter((c) => has(c.ip)).length +
    cfg.ipin8s.filter((d) => has(d.ip)).length +
    cfg.switches.filter((s) => has(s.ip)).length
  );
}

/* ===== Diagnosis result (response from /api/diagnosis) ===== */

export type TestStatus = "PASS" | "FAIL" | "WARN" | "UNKNOWN";

export type DeviceTestResult = {
  deviceId: string;
  name: string;
  role: string;
  ip: string;
  hostname: string;
  ping: { performed: boolean; alive: boolean; latencyMs: number | null; error?: string };
  dns: { performed: boolean; resolved: string | null; error?: string };
  ports: { port: number; open: boolean; service?: string; error?: string }[];
  status: TestStatus;
  message: string;
  timestamp: string;
  source: "REAL TEST";
};

export type DiagnosisResponse = {
  ok: true;
  siteName: string;
  startedAt: string;
  finishedAt: string;
  results: DeviceTestResult[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    unknown: number;
  };
};

export type DiagnosisError = { ok: false; reason: string; message: string };

export function loadLastDiagnosis(): DiagnosisResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DiagnosisResponse;
  } catch {
    return null;
  }
}

export function saveLastDiagnosis(res: DiagnosisResponse) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RESULT_KEY, JSON.stringify(res));
}

export function clearLastDiagnosis() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RESULT_KEY);
}

/* ===== Opt-in example (NOT loaded by default) ===== */
export const EXAMPLE_SITE_CONFIG: SiteConfig = {
  siteName: "Example Site (demo)",
  vlans: [
    { id: newId(), name: "Servers", cidr: "10.20.1.0/24" },
    { id: newId(), name: "Devices", cidr: "10.20.4.0/24" },
  ],
  modules: [
    { id: newId(), role: "Pulse Gateway", name: "Pulse Primary", ip: "10.20.1.10", hostname: "pulse.local", vlan: "Servers", notes: "" },
    { id: newId(), role: "IPConnect", name: "IPConnect", ip: "10.20.1.20", hostname: "", vlan: "Servers", notes: "" },
    { id: newId(), role: "INGA / Integration Gateway", name: "INGA", ip: "10.20.1.22", hostname: "", vlan: "Servers", notes: "" },
    { id: newId(), role: "License Server", name: "License", ip: "10.20.1.21", hostname: "", vlan: "Servers", notes: "" },
    { id: newId(), role: "Pulse Manage", name: "Manage", ip: "10.20.1.23", hostname: "", vlan: "Servers", notes: "" },
  ],
  controllers: [
    { id: newId(), name: "Controller East", ip: "10.20.4.21", controllerId: "C-01", area: "East Wing", notes: "" },
    { id: newId(), name: "Controller West", ip: "10.20.4.22", controllerId: "C-02", area: "West Wing", notes: "" },
  ],
  ipin8s: [
    { id: newId(), name: "IP-IN8 Basement", ip: "10.20.5.40", vlan: "Devices", notes: "" },
  ],
  switches: [
    { id: newId(), name: "Core Switch", ip: "10.20.0.2", vendor: "Cisco", snmpEnabled: false, community: "", notes: "" },
  ],
  displaysEnabled: false,
};
