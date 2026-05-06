/**
 * Global Site Configuration Store (Phase 7A)
 * ------------------------------------------
 * Single source of truth for site-level config across the whole app.
 *
 * - Hydrates on boot from backend (`GET /api/site-config`) → falls back to
 *   localStorage (Zustand persist) → falls back to defaults.
 * - Mutations are local-first; a 500ms debounced PUT syncs them to the
 *   backend JSON file (`server/data/site-config.json`).
 * - Existing legacy `src/lib/siteConfig.ts` keeps working unchanged. This
 *   store is purely additive — pages can opt in.
 *
 * IMPORTANT: This store does NOT replace the SQLite-backed monitored device
 * registry (`server/lib/healthDb.js`). The `monitoredDevices` field here is
 * a cached snapshot for offline reads / Autopilot consumption. The agent
 * remains the source of truth for live device state.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getBackendUrl } from "@/lib/siteConfig";

/* ---------- Types ---------- */

export type SiteSection = {
  siteId: string;
  siteName: string;
  customerName: string;
  environment: "production" | "staging" | "lab" | "unknown";
  timezone: string;
  notes: string;
};

export type NetworkSection = {
  vlans: Array<{ id: string; name: string; cidr: string }>;
  dnsTargets: string[];
  gateways: string[];
  switches: Array<{ id: string; name: string; ip: string }>;
  subnets: string[];
};

export type TopologyLink = {
  id: string;
  fromDeviceId: string;
  toDeviceId: string;
  kind: "mqtt" | "https" | "tcp" | "dependency" | "physical" | "logical";
  label?: string;
};

export type ParentChild = { parentId: string; childId: string };
export type ServiceDependency = { serviceId: string; dependsOn: string[] };

export type TopologySection = {
  links: TopologyLink[];
  parentChildRelationships: ParentChild[];
  serviceDependencies: ServiceDependency[];
};

export type DevicesSection = {
  /** Cached snapshot of the agent's SQLite device registry. */
  monitoredDevices: Array<Record<string, unknown>>;
};

export type ImportRecord = {
  id: string;
  filename: string;
  type: "ccp" | "cnfg" | "zip";
  importedAt: string;
  controllers: number;
  devices: number;
  warnings: number;
};

export type ImportsSection = {
  importedCcpFiles: string[];
  importedCnfgFiles: string[];
  importHistory: ImportRecord[];
};

export type MonitorSection = {
  pollingEnabled: boolean;
  pollInterval: number;        // default ms
  staleThreshold: number;      // ms before a device is considered stale
  mqttFreshnessThreshold: number; // ms — message must arrive at least this often
};

export type RuntimeSection = {
  lastPoll: string | null;
  activeAlerts: number;
  monitorStatus: "stopped" | "running" | "degraded" | "unknown";
};

export type SiteConfigState = {
  site: SiteSection;
  network: NetworkSection;
  topology: TopologySection;
  devices: DevicesSection;
  imports: ImportsSection;
  monitor: MonitorSection;
  runtime: RuntimeSection;
};

export const DEFAULT_SITE_CONFIG: SiteConfigState = {
  site: { siteId: "", siteName: "", customerName: "", environment: "unknown", timezone: "", notes: "" },
  network: { vlans: [], dnsTargets: [], gateways: [], switches: [], subnets: [] },
  topology: { links: [], parentChildRelationships: [], serviceDependencies: [] },
  devices: { monitoredDevices: [] },
  imports: { importedCcpFiles: [], importedCnfgFiles: [], importHistory: [] },
  monitor: { pollingEnabled: false, pollInterval: 30_000, staleThreshold: 90_000, mqttFreshnessThreshold: 60_000 },
  runtime: { lastPoll: null, activeAlerts: 0, monitorStatus: "unknown" },
};

type Actions = {
  patchSite: (p: Partial<SiteSection>) => void;
  patchNetwork: (p: Partial<NetworkSection>) => void;
  patchTopology: (p: Partial<TopologySection>) => void;
  patchDevices: (p: Partial<DevicesSection>) => void;
  patchImports: (p: Partial<ImportsSection>) => void;
  patchMonitor: (p: Partial<MonitorSection>) => void;
  patchRuntime: (p: Partial<RuntimeSection>) => void;
  addImportRecord: (r: ImportRecord) => void;
  reset: () => void;
  /** Replace state from a server payload without re-syncing back. */
  hydrateFromServer: (s: SiteConfigState) => void;
  /** Force a sync (bypasses debounce). */
  syncNow: () => Promise<void>;
};

export type SiteConfigStore = SiteConfigState & Actions;

/* ---------- Backend sync (debounced) ---------- */

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let suppressSync = false;

function scheduleSync(get: () => SiteConfigStore) {
  if (typeof window === "undefined") return;
  if (suppressSync) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const snap = stripActions(get());
      await fetch(getBackendUrl().replace(/\/$/, "") + "/api/site-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      });
    } catch {
      // Backend may be offline. Local state still persists via Zustand.
    }
  }, 500);
}

function stripActions(s: SiteConfigStore): SiteConfigState {
  const { patchSite, patchNetwork, patchTopology, patchDevices, patchImports,
    patchMonitor, patchRuntime, addImportRecord, reset, hydrateFromServer, syncNow,
    ...rest } = s;
  void patchSite; void patchNetwork; void patchTopology; void patchDevices;
  void patchImports; void patchMonitor; void patchRuntime; void addImportRecord;
  void reset; void hydrateFromServer; void syncNow;
  return rest as SiteConfigState;
}

/* ---------- Store ---------- */

export const useSiteConfigStore = create<SiteConfigStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SITE_CONFIG,
      patchSite: (p) => { set((s) => ({ site: { ...s.site, ...p } })); scheduleSync(get); },
      patchNetwork: (p) => { set((s) => ({ network: { ...s.network, ...p } })); scheduleSync(get); },
      patchTopology: (p) => { set((s) => ({ topology: { ...s.topology, ...p } })); scheduleSync(get); },
      patchDevices: (p) => { set((s) => ({ devices: { ...s.devices, ...p } })); scheduleSync(get); },
      patchImports: (p) => { set((s) => ({ imports: { ...s.imports, ...p } })); scheduleSync(get); },
      patchMonitor: (p) => { set((s) => ({ monitor: { ...s.monitor, ...p } })); scheduleSync(get); },
      patchRuntime: (p) => { set((s) => ({ runtime: { ...s.runtime, ...p } })); scheduleSync(get); },
      addImportRecord: (r) => {
        set((s) => ({
          imports: {
            ...s.imports,
            importHistory: [r, ...s.imports.importHistory].slice(0, 50),
            importedCcpFiles: r.type === "ccp" || r.type === "zip"
              ? Array.from(new Set([r.filename, ...s.imports.importedCcpFiles])).slice(0, 50)
              : s.imports.importedCcpFiles,
            importedCnfgFiles: r.type === "cnfg"
              ? Array.from(new Set([r.filename, ...s.imports.importedCnfgFiles])).slice(0, 50)
              : s.imports.importedCnfgFiles,
          },
        }));
        scheduleSync(get);
      },
      reset: () => { set({ ...DEFAULT_SITE_CONFIG }); scheduleSync(get); },
      hydrateFromServer: (incoming) => {
        suppressSync = true;
        try { set({ ...DEFAULT_SITE_CONFIG, ...incoming }); }
        finally { suppressSync = false; }
      },
      syncNow: async () => {
        if (typeof window === "undefined") return;
        try {
          await fetch(getBackendUrl().replace(/\/$/, "") + "/api/site-config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stripActions(get())),
          });
        } catch { /* offline */ }
      },
    }),
    {
      name: "tacera.siteConfig.v4",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => stripActions(s),
      version: 1,
    },
  ),
);

/** Boot-time hydration: pull from backend; if it returns data, use it. */
export async function hydrateSiteConfigFromBackend(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const r = await fetch(getBackendUrl().replace(/\/$/, "") + "/api/site-config");
    if (!r.ok) return;
    const json = await r.json();
    if (json?.ok && json.config && typeof json.config === "object") {
      useSiteConfigStore.getState().hydrateFromServer(json.config as SiteConfigState);
    }
  } catch {
    // Backend offline — keep local state.
  }
}