# Live Monitor Intelligence Console — Phased Build Plan

This is a massive scope (12 phases, ~10 new backend modules, 2 new stores, 4+ new UI panels, AI integration, WebSocket log tailing, incident management). Trying to ship all 12 phases in one pass guarantees half-wired buttons and broken regressions — exactly what you said not to do.

I'm proposing to ship it in **4 incremental milestones**, each one fully working and tested before moving on. After each milestone you can verify in preview and tell me to continue.

---

## Milestone A — Foundation (Phases 1, 2, 3)
**Goal:** Solid device registry + safe log access + immutable snapshots.

- **Phase 1**: Verify/finish all 16 quick-add profiles in `liveMonitorProfiles.ts` (most exist already — audit log paths, SSH usernames, ports against your spec).
- **Phase 2**: Live log access
  - Backend: `GET /api/monitor/devices/:id/logs/recent`, `POST .../logs/tail/start`, `POST .../logs/tail/stop`
  - Safe SSH executor with allowlisted log paths (no arbitrary commands), 500-line cap, timeout
  - WebSocket tail streaming via existing `wsBus`
  - UI: Log panel on each device card — path dropdown, line selector, severity coloring, search/filter, View/Tail/Stop/Copy/Clear
- **Phase 3**: Evidence snapshots
  - Backend: `server/lib/evidenceSnapshotStore.js`, `server/data/evidence/snapshots.json`
  - Endpoints: `POST/GET /api/evidence/snapshots`, `GET /api/evidence/snapshots/:id`
  - Immutable bundles (probe + logs + alerts + timeline refs + deterministic findings)
  - UI: "Capture Evidence" button per device, Evidence Snapshots collapsible panel

**Acceptance:** Tests 1, 2, 3, 5 from your spec pass.

---

## Milestone B — Detection (Phases 4, 5, 6)
**Goal:** Deterministic intelligence — patterns, alerts, timeline.

- **Phase 4**: `server/lib/logCorrelationEngine.js` — pure regex/rule pattern matcher for MQTT / Pulse Gateway / INGA / IPConnect / HL7 / Webmin / Controller patterns. Returns structured `correlatedEvents[]`, `suspectedPatterns[]`. **No AI.**
- **Phase 5**: `server/lib/alertEngine.js` + `server/data/alerts/alerts.json`
  - Deterministic alert generation from probe failures + log patterns + stale MQTT
  - `GET /api/alerts`, `POST /api/alerts/:id/ack`, `POST /api/alerts/:id/resolve`
  - UI: Active Alerts / Critical / Recently Resolved sections at top of Live Monitor
- **Phase 6**: `server/lib/failureTimelineStore.js` + `server/data/timeline/events.json`
  - Unified event log from all sources (devices, probes, alerts, snapshots, AI calls, autopilot, trace)
  - `GET /api/timeline` with deviceId/alertId filters
  - UI: Failure Timeline collapsible panel with filters and clickable refs

**Acceptance:** Test 4 passes. Alerts surface from real probe failures.

---

## Milestone C — AI + Trace + Autopilot Integration (Phases 7, 8, 9)
**Goal:** AI explains; Trace and Autopilot consume deterministic evidence.

- **Phase 7**: `POST /api/ai/root-cause-assist` — sanitizes input (strips secrets, caps log lines), calls Lovable AI Gateway via existing `aiCommander`-style backend route. Structured response (rootCause / supports / contradicts / unknown / nextChecks / customer + internal summaries / escalation draft / disclaimer). Graceful degrade when AI unavailable.
- **Phase 8**: Wire Trace Signal Path to consume registry + latest probes + log patterns + alerts + snapshots. Add "Trace This Device" button on cards. Trace stays deterministic; AI explains after.
- **Phase 9**: Autopilot recommendation engine extension — map alert types to safe playbooks (Webmin restart, mosquitto restart, pulse-gateway docker restart, INGA "check broker first", controller "manual only"). Always require approval. HIGH risk blocked.

**Acceptance:** Tests 6, 7, 8 pass.

---

## Milestone D — Incidents + Final UI Polish (Phases 10, 11)
**Goal:** Black-box recorder for postmortems.

- **Phase 10**: `server/lib/incidentStore.js` + `server/data/incidents/incidents.json`. Auto-create on critical-alert threshold or manual. Attach alerts/snapshots/notes/AI summaries. Incident History UI tab.
- **Phase 11**: Final Live Monitor layout pass — all sections collapsible, device cards with full button set (Test / Logs / Tail / Evidence / Trace / Ask AI / Create Incident / Edit / Delete). Avoid overwhelming layout.

**Acceptance:** Test 9 passes. Full UI matches Phase 11 spec.

---

## Cross-cutting safety guarantees (every milestone)

- **Never** call AI for truth — only for explanation of deterministic evidence.
- **Never** allow arbitrary shell commands — log endpoints accept only saved-device log paths from a server-side allowlist.
- **Never** auto-execute Autopilot actions — approval required, HIGH risk blocked.
- **Never** break existing: Command Center, Autopilot service registry, Deep Evidence, AI Commander, current Live Monitor quick-add cards.
- All new backend endpoints are same-origin TanStack `src/routes/api/*` proxied to `server/index.js`.

---

## Technical conventions used

- Backend stores: JSON files under `server/data/` matching the existing `autopilotServicesStore.js` pattern.
- Server functions in `server/lib/*.js`, registered in `server/index.js`.
- Frontend API clients in `src/lib/*Client.ts` with `window` event bus for cross-component refresh (matching `autopilotServicesClient.ts`).
- Same-origin proxy routes in `src/routes/api/*.ts` using `createFileRoute`.
- WebSocket log tailing reuses existing `wsBus` infrastructure.
- AI calls use Lovable AI Gateway through a backend route (no client-side AI calls, no secrets in browser).

---

## What I need from you

**Approve this plan and pick a starting milestone.** I strongly recommend starting with **Milestone A** and verifying each one in preview before continuing. If you say "go", I'll start Milestone A.

If you want a different ordering (e.g. AI first because it's the most visible), tell me — but the dependencies are: Logs → Patterns → Alerts → Snapshots → AI/Trace/Autopilot → Incidents.