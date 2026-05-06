import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import {
  EMPTY_SITE_CONFIG,
  getBackendUrl,
  loadSiteConfig,
  saveSiteConfig,
  type SiteConfig,
} from "@/lib/siteConfig";
import { monitorApi, type MonitorDevice, type ProbeProtocol } from "@/lib/monitorClient";

type SiteConfigState = {
  hydrated: boolean;
  hydrating: boolean;
  syncStatus: "idle" | "syncing" | "error";
  syncError: string | null;
  legacyConfig: SiteConfig;
  monitoredDevices: MonitorDevice[];
  hydrateFromBackend: () => Promise<void>;
  setLegacyConfig: (
    next: SiteConfig | ((current: SiteConfig) => SiteConfig),
    options?: { skipBackendSync?: boolean },
  ) => void;
  saveMonitoredDevice: (device: Partial<MonitorDevice> & { id: string; protocol: ProbeProtocol; kind: string }) => Promise<MonitorDevice>;
  deleteMonitoredDevice: (id: string) => Promise<void>;
};

const SHARED_STORE_KEY = "tacera.shared-registry.v1";

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function cloneEmptySiteConfig() {
  return structuredClone(EMPTY_SITE_CONFIG);
}

function backendBase() {
  return getBackendUrl().replace(/\/$/, "");
}

function sortDevices(devices: MonitorDevice[]) {
  return [...devices].sort((a, b) => {
    const left = (a.name || a.id).toLowerCase();
    const right = (b.name || b.id).toLowerCase();
    return left.localeCompare(right);
  });
}

function normalizeServices(services: unknown) {
  if (!Array.isArray(services)) return [];
  return services.map((service) => {
    if (!service || typeof service !== "object") return service;
    const candidate = service as { password?: string; saveCredentials?: boolean } & Record<string, unknown>;
    return {
      ...candidate,
      password: candidate.saveCredentials ? String(candidate.password || "") : "",
    };
  });
}

function coerceSiteConfig(candidate: unknown, fallback?: SiteConfig): SiteConfig {
  const base = fallback ? structuredClone(fallback) : cloneEmptySiteConfig();
  if (!candidate || typeof candidate !== "object") return base;

  const source = candidate as Record<string, unknown>;
  const raw = (source.legacyConfig && typeof source.legacyConfig === "object"
    ? source.legacyConfig
    : source) as Partial<SiteConfig>;

  return {
    ...cloneEmptySiteConfig(),
    ...raw,
    vlans: Array.isArray(raw.vlans) ? raw.vlans : [],
    modules: Array.isArray(raw.modules) ? raw.modules : [],
    controllers: Array.isArray(raw.controllers) ? raw.controllers : [],
    ipin8s: Array.isArray(raw.ipin8s) ? raw.ipin8s : [],
    displays: Array.isArray(raw.displays) ? raw.displays : [],
    switches: Array.isArray(raw.switches) ? raw.switches : [],
    services: normalizeServices(raw.services),
  };
}

function hasConfiguredSite(config: SiteConfig, monitoredDevices: MonitorDevice[]) {
  return Boolean(
    config.siteName.trim() ||
    config.modules.length ||
    config.controllers.length ||
    config.displays.length ||
    config.switches.length ||
    config.ipin8s.length ||
    config.services.some((service) => Boolean((service.host || "").trim() || (service.hostname || "").trim())) ||
    monitoredDevices.length,
  );
}

export function selectHasConfiguredSite(state: Pick<SiteConfigState, "legacyConfig" | "monitoredDevices">) {
  return hasConfiguredSite(state.legacyConfig, state.monitoredDevices);
}

export function selectSiteLabel(state: Pick<SiteConfigState, "legacyConfig" | "monitoredDevices">) {
  const siteName = state.legacyConfig.siteName.trim();
  if (siteName) return siteName;
  if (state.monitoredDevices.length > 0) {
    return `${state.monitoredDevices.length} monitored device${state.monitoredDevices.length === 1 ? "" : "s"}`;
  }
  return "No site configured";
}

async function fetchSiteConfigSnapshot() {
  const response = await fetch(`${backendBase()}/api/site-config`);
  const json = (await response.json()) as { ok?: boolean; config?: unknown; message?: string };
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || `HTTP ${response.status}`);
  }
  return json.config ?? null;
}

async function fetchMonitorDevicesSnapshot() {
  const response = await monitorApi.devices();
  if (!response.ok) {
    throw new Error("Could not load monitored devices");
  }
  return sortDevices(response.devices);
}

async function pushSiteConfigSnapshot(config: SiteConfig) {
  const response = await fetch(`${backendBase()}/api/site-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      legacyConfig: config,
      siteName: config.siteName.trim() || null,
      updatedAt: new Date().toISOString(),
    }),
  });

  const json = (await response.json()) as { ok?: boolean; message?: string };
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || `HTTP ${response.status}`);
  }
}

let syncTimer: number | null = null;
let pendingHydration: Promise<void> | null = null;

export const useSiteConfigStore = create<SiteConfigState>()(
  persist(
    (set, get) => {
      const queueSiteConfigSync = (config: SiteConfig) => {
        if (typeof window === "undefined") return;
        if (syncTimer) window.clearTimeout(syncTimer);

        syncTimer = window.setTimeout(async () => {
          set({ syncStatus: "syncing", syncError: null });
          try {
            await pushSiteConfigSnapshot(config);
            set({ syncStatus: "idle", syncError: null });
          } catch (error) {
            set({
              syncStatus: "error",
              syncError: error instanceof Error ? error.message : String(error),
            });
          }
        }, 350);
      };

      return {
        hydrated: false,
        hydrating: false,
        syncStatus: "idle",
        syncError: null,
        legacyConfig: coerceSiteConfig(loadSiteConfig()),
        monitoredDevices: [],

        hydrateFromBackend: async () => {
          if (pendingHydration) return pendingHydration;

          pendingHydration = (async () => {
            set({ hydrating: true, syncError: null });
            const current = get();

            const [siteResult, devicesResult] = await Promise.allSettled([
              fetchSiteConfigSnapshot(),
              monitorApi.devices(),
            ]);

            const nextLegacyConfig = siteResult.status === "fulfilled" && siteResult.value
              ? coerceSiteConfig(siteResult.value, current.legacyConfig)
              : current.legacyConfig;

            const nextMonitoredDevices = devicesResult.status === "fulfilled" && devicesResult.value.ok
              ? sortDevices(devicesResult.value.devices)
              : current.monitoredDevices;

            saveSiteConfig(nextLegacyConfig);

            set({
              legacyConfig: nextLegacyConfig,
              monitoredDevices: nextMonitoredDevices,
              hydrated: true,
              hydrating: false,
              syncStatus: current.syncStatus === "syncing" ? "syncing" : "idle",
            });
          })().finally(() => {
            pendingHydration = null;
          });

          return pendingHydration;
        },

        setLegacyConfig: (next, options) => {
          const resolved = typeof next === "function"
            ? next(get().legacyConfig)
            : next;
          const normalized = coerceSiteConfig(resolved, get().legacyConfig);

          saveSiteConfig(normalized);
          set({ legacyConfig: normalized });

          if (!options?.skipBackendSync) {
            queueSiteConfigSync(normalized);
          }
        },

        saveMonitoredDevice: async (device) => {
          const response = await monitorApi.upsertDevice(device);
          if (!response.ok || !response.device) {
            throw new Error(response.errors?.join("; ") || response.reason || "Could not save device");
          }

          const monitoredDevices = await fetchMonitorDevicesSnapshot();
          set({ monitoredDevices });

          return monitoredDevices.find((entry) => entry.id === response.device?.id) ?? response.device;
        },

        deleteMonitoredDevice: async (id) => {
          const response = await monitorApi.deleteDevice(id);
          if (!response.ok) {
            throw new Error("Could not delete device");
          }

          const monitoredDevices = await fetchMonitorDevicesSnapshot();
          set({ monitoredDevices });
        },
      };
    },
    {
      name: SHARED_STORE_KEY,
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : window.localStorage)),
      partialize: (state) => ({
        legacyConfig: state.legacyConfig,
        monitoredDevices: state.monitoredDevices,
      }),
    },
  ),
);

export async function hydrateSiteConfigFromBackend(): Promise<void> {
  await useSiteConfigStore.getState().hydrateFromBackend();
}