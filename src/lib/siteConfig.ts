/**
 * Site-config-driven diagnosis types + localStorage store.
 * No defaults. No hardcoded IPs. Empty config = empty diagnosis.
 */

export type ModuleRole =
  | "Pulse Gateway"
  | "IPConnect"
  | "INGA / Integration Gateway"
  | "License Server"
  | "Pulse Manage"
  | "Display / IP-APP"
  | "Controller"
  | "Display"
  | "Switch"
  | "Other";

export type ModuleEntry = {
  id: string;
  role: ModuleRole;
  name: string;
  ip: string;
  hostname: string;
  vlan: string;
  expectedPorts: number[];
  notes: string;
};

export type ControllerEntry = {
  id: string;
  name: string;
  ip: string;
  controllerId: string;
  area: string;
  expectedPorts: number[];
  notes: string;
};

export type IpIn8Entry = {
  id: string;
  name: string;
  ip: string;
  vlan: string;
  expectedPorts: number[];
  notes: string;
};

export type DisplayEntry = {
  id: string;
  name: string;
  ip: string;
  vlan: string;
  expectedPorts: number[];
  notes: string;
};

export type SwitchEntry = {
  id: string;
  name: string;
  ip: string;
  vendor: string;
  snmpEnabled: boolean;
  community: string;
  expectedPorts: number[];
  notes: string;
};

export type VlanEntry = { id: string; name: string; cidr: string };

/* ===== Austco Services (SSH/SFTP-driven) ===== */

export type ServiceRole =
  | "Integration Gateway"
  | "Pulse Gateway"
  | "Pulse Manage"
  | "License Service"
  | "MQTT Broker"
  | "WebSocket MQTT Adapter"
  | "IPConnect"
  | "RTLS Gateway"
  | "HL7"
  | "File Server"
  | "Mobile Gateway";

export type ServiceEntry = {
  id: string;
  role: ServiceRole;
  name: string;
  host: string;       // IP or hostname for SSH
  hostname: string;   // optional DNS name (informational)
  port: number;       // SSH/SFTP port (default 22)
  username: string;   // default "tech"
  password: string;   // never persisted unless saveCredentials=true
  saveCredentials: boolean;
  enabled: boolean;
  required: boolean;  // optional services default to disabled
  logPaths: string[];
  notes: string;
};

export const REQUIRED_SERVICE_ROLES: ServiceRole[] = [
  "Integration Gateway", "Pulse Gateway", "Pulse Manage",
  "License Service", "MQTT Broker", "WebSocket MQTT Adapter", "IPConnect",
];

export const OPTIONAL_SERVICE_ROLES: ServiceRole[] = [
  "RTLS Gateway", "HL7", "File Server", "Mobile Gateway",
];

export const DEFAULT_LOG_PATHS: Record<ServiceRole, string[]> = {
  "Integration Gateway": ["/home/xcare/runtime/integration-gateway/logs/"],
  "Pulse Gateway": ["/home/xcare/runtime/pulse-gateway/log/"],
  "Pulse Manage": ["/home/xcare/runtime/configuration/log/"],
  "License Service": [],
  "MQTT Broker": [],
  "WebSocket MQTT Adapter": [],
  "IPConnect": ["/home/xcare/runtime/xcare/log/"],
  "RTLS Gateway": ["/home/xcare/runtime/rtls-gateway/logs/"],
  "HL7": [],
  "File Server": [],
  "Mobile Gateway": ["/home/xcare/runtime/mobilegateway/logs/"],
};

export type SiteConfig = {
  siteName: string;
  technician: string;
  siteNotes: string;
  vlans: VlanEntry[];
  modules: ModuleEntry[];
  controllers: ControllerEntry[];
  ipin8s: IpIn8Entry[];
  displays: DisplayEntry[];
  switches: SwitchEntry[];
  services: ServiceEntry[];
};

export const EMPTY_SITE_CONFIG: SiteConfig = {
  siteName: "", technician: "", siteNotes: "",
  vlans: [], modules: [], controllers: [], ipin8s: [], displays: [], switches: [], services: [],
};

// Bumped to v3 to force stale browser caches (legacy demo data, hardcoded
// 10.20.x.x IPs, "Extendicare", "Backend: Mock") to be discarded.
const CFG_KEY = "tacera.siteConfig.v3";
const RESULT_KEY = "tacera.diagnosisResult.v3";
const LOGS_KEY = "tacera.logResult.v3";
const BACKEND_KEY = "tacera.backendUrl.v1";
const SERVICES_RESULT_KEY = "tacera.servicesResult.v2";

// Purge any old keys from prior versions on first load.
if (typeof window !== "undefined") {
  try {
    [
      "tacera.siteConfig", "tacera.siteConfig.v1", "tacera.siteConfig.v2",
      "tacera.diagnosisResult", "tacera.diagnosisResult.v1", "tacera.diagnosisResult.v2",
      "tacera.logResult", "tacera.logResult.v1", "tacera.logResult.v2",
      "tacera.servicesResult.v1",
      "siteConfig", "diagnosisResult", "siteDoctorState", "diagnosticStore",
      "diagnosisRunStore",
    ].forEach((k) => localStorage.removeItem(k));
  } catch {}
}

export const DEFAULT_BACKEND_URL = "http://localhost:3001";

export function getBackendUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BACKEND_URL;
  return localStorage.getItem(BACKEND_KEY) || DEFAULT_BACKEND_URL;
}
export function setBackendUrl(u: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BACKEND_KEY, u);
}

export function loadSiteConfig(): SiteConfig {
  if (typeof window === "undefined") return structuredClone(EMPTY_SITE_CONFIG);
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return structuredClone(EMPTY_SITE_CONFIG);
    const parsed = JSON.parse(raw) as Partial<SiteConfig>;
    return { ...EMPTY_SITE_CONFIG, ...parsed,
      vlans: parsed.vlans ?? [], modules: parsed.modules ?? [],
      controllers: parsed.controllers ?? [], ipin8s: parsed.ipin8s ?? [],
      displays: parsed.displays ?? [], switches: parsed.switches ?? [],
      services: (parsed.services ?? []).map((s) => ({ ...s, password: s.saveCredentials ? (s.password || "") : "" })),
    };
  } catch { return structuredClone(EMPTY_SITE_CONFIG); }
}
export function saveSiteConfig(cfg: SiteConfig) {
  if (typeof window === "undefined") return;
  // Strip passwords for services that have not opted into saveCredentials.
  const safe: SiteConfig = {
    ...cfg,
    services: cfg.services.map((s) => ({ ...s, password: s.saveCredentials ? s.password : "" })),
  };
  localStorage.setItem(CFG_KEY, JSON.stringify(safe));
}

export function makeService(role: ServiceRole, opts: Partial<ServiceEntry> = {}): ServiceEntry {
  const required = REQUIRED_SERVICE_ROLES.includes(role);
  return {
    id: newId(),
    role,
    name: role,
    host: "",
    hostname: "",
    port: 22,
    username: "tech",
    password: "tech",
    saveCredentials: false,
    enabled: required,
    required,
    logPaths: [...(DEFAULT_LOG_PATHS[role] || [])],
    notes: "",
    ...opts,
  };
}

/** Seed default Austco services if config has none yet. */
export function seedDefaultServices(): ServiceEntry[] {
  return [
    ...REQUIRED_SERVICE_ROLES.map((r) => makeService(r)),
    ...OPTIONAL_SERVICE_ROLES.map((r) => makeService(r)),
  ];
}
export function clearSiteConfig() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CFG_KEY);
}

export function newId(): string { return Math.random().toString(36).slice(2, 10); }

export function countTestableDevices(cfg: SiteConfig): number {
  const has = (ip = "", hn = "") => Boolean((ip || "").trim() || (hn || "").trim());
  return (
    cfg.modules.filter((m) => has(m.ip, m.hostname)).length +
    cfg.controllers.filter((c) => has(c.ip)).length +
    cfg.ipin8s.filter((d) => has(d.ip)).length +
    cfg.displays.filter((d) => has(d.ip)).length +
    cfg.switches.filter((s) => has(s.ip)).length
  );
}

/* ===== Result types (mirror server response) ===== */

export type DeviceResult = {
  deviceId: string; name: string; role: string; ip: string; hostname: string;
  ping: { performed: boolean; reachable: boolean; packetLossPct: number | null; avgLatencyMs: number | null; raw: string; error?: string | null };
  dns: { performed: boolean; resolved: string[]; error: string | null };
  ports: { port: number; open: boolean; service?: string; latencyMs: number | null; error: string | null }[];
  status: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
  message: string;
  timestamp: string;
  source: "REAL TEST";
};

export type DiagnosisMode = "REAL TEST" | "MANUAL DATA" | "LOG ANALYSIS" | "INSUFFICIENT DATA" | "DEMO";

export type DiagnosisResult = {
  ok: true;
  mode: DiagnosisMode;
  siteName: string;
  technician: string;
  siteNotes?: string;
  vm: { hostname: string; addrs: string[]; platform: string };
  startedAt: string;
  finishedAt: string;
  summary: { total: number; pass: number; warn: number; fail: number };
  breakFoundAt: { name: string; role: string; ip: string; hostname: string } | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string[];
  devices: DeviceResult[];
  traceSteps: { id: string; label: string; status: string; detail: string }[];
  fixActions: string[];
  warnings: string[];
};

export type DiagnosisError = { ok: false; reason: string; message: string };

export function loadLastDiagnosis(): DiagnosisResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DiagnosisResult;
    // Reject any stored result that looks like legacy demo / hardcoded data.
    if (isDemoOrFake(parsed)) {
      localStorage.removeItem(RESULT_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function isDemoOrFake(r: DiagnosisResult | null): boolean {
  if (!r || typeof r !== "object") return true;
  if (!Array.isArray((r as DiagnosisResult).devices)) return true;
  const name = ((r as DiagnosisResult).siteName || "").toLowerCase();
  if (name.includes("demo") || name.includes("example") || name.includes("extendicare")) return true;
  const mode = (r as DiagnosisResult).mode;
  if (mode === "DEMO") return true;
  // Strip stored results that contain legacy hardcoded 10.20.x.x IPs.
  const hasLegacyIp = (r as DiagnosisResult).devices.some((d) => /^10\.20\./.test(d.ip || ""));
  if (hasLegacyIp) return true;
  return false;
}
export function saveLastDiagnosis(r: DiagnosisResult) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RESULT_KEY, JSON.stringify(r));
}

/* ===== Log analysis result ===== */

export type LogFileResult = {
  file: string;
  detectedType: string;
  userType: string | null;
  sizeBytes: number;
  lineCount: number;
  ips: string[];
  hosts: string[];
  timestamps: string[];
  errors: { line: number; text: string }[];
  warnings: { line: number; text: string }[];
  events: { line: number; tag: string; text: string }[];
  eventCounts: Record<string, number>;
  controllerIds: string[];
  callpointIds: string[];
};

export type LogResult = {
  ok: true;
  mode: "LOG ANALYSIS";
  vm: { hostname: string; addrs: string[]; platform: string };
  startedAt: string;
  finishedAt: string;
  summary: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string[];
  files: LogFileResult[];
  aggregate: {
    totalErrors: number;
    totalWarnings: number;
    eventCounts: Record<string, number>;
    uniqueIps: string[];
    uniqueHosts: string[];
    uniqueControllerIds: string[];
    uniqueCallpointIds: string[];
  };
};

export function loadLastLogResult(): LogResult | null {
  if (typeof window === "undefined") return null;
  try { const raw = localStorage.getItem(LOGS_KEY); return raw ? JSON.parse(raw) as LogResult : null; }
  catch { return null; }
}
export function saveLastLogResult(r: LogResult) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOGS_KEY, JSON.stringify(r));
}

/* ===== Services diagnosis result store (typed loosely; consumer uses ServicesDiagnosis) ===== */
export function saveServicesDiagnosis<T>(r: T) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(SERVICES_RESULT_KEY, JSON.stringify(r)); } catch {}
}
export function loadServicesDiagnosis<T>(): T | null {
  if (typeof window === "undefined") return null;
  try { const raw = localStorage.getItem(SERVICES_RESULT_KEY); return raw ? JSON.parse(raw) as T : null; }
  catch { return null; }
}

/* No example/demo site config exists. The technician must enter real data
 * or import a real site JSON. Hardcoded fake IPs are forbidden. */
