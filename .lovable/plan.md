# Phase 7 — Tacera-Aware Monitoring Platform

## Reality check first

Before scoping new work, here's what's already true in the current codebase (verified by reading `server/index.js`, `server/lib/healthDb.js`, `src/routes/monitor.devices.tsx`):

- **Add Device is not actually broken.** The `/monitor` button is a `<Link>` to `/monitor/devices`. The devices page has an inline form (not a modal) wired to `monitorApi.upsertDevice` → `POST /api/monitor/devices` → SQLite. Save, edit, delete, test-now all work today.
- **Devices DO persist.** `better-sqlite3` writes to `/tmp/tacera-doctor-health.db` (configurable via `TACERA_DB_PATH`). They survive backend restart and page refresh.
- **A real polling engine already exists** (`pollingScheduler.js`) with ICMP/TCP/HTTPS/MQTT-connect probes, exponential backoff, stale sweeps, WebSocket bus.
- **What is missing**: a global site-config store, Tacera-aware device profiles, MQTT *freshness* (vs connect), topology graph, CCP→registry auto-discovery, and wiring monitor evidence into Autopilot / AI Commander.

So Phase 7 is mostly **net-new capability layered on a working foundation**, not a rebuild. The "broken buttons / lost config" symptoms are about the *Command Center site config* (which today only lives in `localStorage` via `siteConfig.ts`), not the monitored-devices registry.

## Why one mega-turn won't work

The spec lists 15 sub-phases (7A–7O) touching ~30 files: a new Zustand store with backend sync, a new monitor engine, 8 new device profiles, 2 new probe types (MQTT freshness, Webmin), a topology component package, CCP auto-discovery rewrite, 2 integration surfaces (Autopilot, Commander), plus UI upgrades on 3 pages. Done in one turn this lands as broken half-features. I want to slice it into 3 shippable rounds, each landing real working capability.

## Slice 1 (this turn) — Foundation: persistent site config + Tacera profiles + MQTT freshness

This is the load-bearing piece everything else needs. Without it slices 2 and 3 have nothing to attach to.

### 7A — Global site config store with backend persistence
- New file `src/stores/siteConfigStore.ts` using Zustand + persist middleware. Holds the full shape from the spec (`site`, `network`, `topology`, `devices`, `imports`, `monitor`, `runtime`).
- Debounced (500ms) sync to backend via new endpoints.
- Backend: `server/data/site-config.json` + `GET/PUT /api/site-config` with atomic write.
- On app boot, hydrate from backend → fall back to localStorage → fall back to defaults.
- Migrate existing `src/lib/siteConfig.ts` callers to read from the store (keep the old API as a thin shim so nothing breaks).

### 7C — Tacera device profiles
- New `src/lib/taceraDeviceProfiles.ts` exporting profiles for: IPC Primary/Secondary, Pulse Gateway, Pulse Manage, INGA, MQTT Broker, IP-CCT, IP-RoomController, IP-APP1, AN-PD2, IPNet Router, Display Driver, Linux/Windows VM, Webmin, Switch, Router, DNS, Hypervisor.
- Each profile defines: expected ports, expected protocols, default poll interval, stale threshold, MQTT topics to watch, dependency hints (e.g. Controller → IPC → Pulse Gateway → MQTT Broker).
- Devices page gets a "Tacera profile" dropdown that prefills the form (replaces the generic Quick-add row, keeping the same UX).

### 7D (partial) — MQTT freshness probe + Webmin probe
- New `server/lib/probes/mqttFreshnessProbe.js`: subscribes to a topic for N seconds, records last-message-age. Returns `ok: false` with `reason: "stale"` if no message within threshold. Different from existing `mqttConnectProbe` which only validates connect.
- New `server/lib/probes/webminProbe.js`: HTTPS GET to `/session_login.cgi`, asserts Webmin response markers.
- Wired into `pollingScheduler.PROBES` map under new protocol keys `mqtt-fresh` and `webmin`.

### Cross-cutting
- Extend SQLite `devices` table with new columns via additive migration: `device_type`, `critical`, `parent_device_id`, `mqtt_topics` (JSON), `expected_services` (JSON), `site_zone`, `dependencies` (JSON). All nullable so existing rows keep working.
- Update `MonitorDevice` type and `monitorClient.ts` to surface the new fields.

### Out of scope this slice (deferred to slice 2/3)
- Topology graph component (slice 2)
- CCP → registry auto-discovery (slice 2)
- Live Monitor page upgrades — grouping/filter/search beyond what exists today (slice 2)
- Autopilot / AI Commander integration (slice 3)
- Tacera-aware inference engine ("Pulse Gateway degraded — broker stale while UI reachable") (slice 3)

## Slice 2 (next turn) — Topology + auto-discovery + monitor UX
- `src/components/topology/` graph (use `reactflow`, already in stack family).
- CCP/CNFG import auto-creates devices using the Tacera profiles + relationships.
- Live Monitor: grouping by device_type, dependency badges, stale link rendering.
- New endpoint `GET /api/monitor/topology` returning nodes+links from the registry.

## Slice 3 (turn after) — Inference + Autopilot + Commander
- `server/lib/taceraInference.js`: deterministic rules over current device_state + dependencies that produce human-readable inferences (Pulse degraded vs IPC isolated vs controller isolated).
- Autopilot scan consumes inferences as evidence.
- AI Commander handoff includes monitor snapshot + topology + inferences.

## Technical specifics for slice 1

- **State library**: Zustand (already in repo). Persist middleware for localStorage; manual debounced fetch for backend sync.
- **Backend write safety**: write to `site-config.json.tmp` then `fs.rename` for atomic swap.
- **Schema migration**: idempotent `ALTER TABLE devices ADD COLUMN IF NOT EXISTS` won't work in SQLite — instead, check `PRAGMA table_info(devices)` and conditionally `ALTER TABLE ADD COLUMN`. Wrapped in try/catch per column for safety.
- **MQTT freshness probe**: uses existing `mqtt` package, subscribes with QoS 0, `clean: true`, 8s window, returns `latencyMs = ageOfLastMessage` and `ok = ageMs < staleThreshold`.
- **Backwards compatibility**: existing `siteConfig.ts` `getBackendUrl()` and friends keep working — store wraps them, doesn't replace them.

## Validation before finishing slice 1
- `tsc` passes.
- Backend boots: `node server/index.js` starts without error.
- Existing `/monitor` and `/monitor/devices` pages render unchanged behavior.
- New endpoints respond: `curl http://localhost:3001/api/site-config` returns JSON.
- New probes load (smoke test in `server/test/monitoring.test.js`).
- AI Commander, Autopilot, CCP import, Trace Signal Path, Evidence Playback all still work (no breaking imports).

## What I will explicitly NOT do this turn
- Won't replace the inline device form with a modal (the inline form works; the spec's "broken modal" premise doesn't match the code).
- Won't touch Autopilot or AI Commander code (slice 3).
- Won't add `reactflow` or build the topology component (slice 2).
- Won't fabricate any demo devices or seed data.

Approve this slicing and I'll execute slice 1.
