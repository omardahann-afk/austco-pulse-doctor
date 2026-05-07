import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMonitorBus } from "@/hooks/useMonitorBus";
import { ConnectionPill } from "@/components/monitor/ConnectionPill";
import { monitorApi, relativeTime, type DeviceState } from "@/lib/monitorClient";
import { Play, Square, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useSiteConfigStore } from "@/stores/siteConfigStore";
import { LIVE_MONITOR_PROFILES, LIVE_MONITOR_GROUPS, type LiveMonitorProfileKey } from "@/lib/liveMonitorProfiles";
import { DeviceConfigCard, makeDraft, type DraftDevice } from "@/components/monitor/DeviceConfigCard";
import { InfrastructureTile } from "@/components/monitor/InfrastructureTile";
import { RuntimeNodeCard, RuntimeNodeCardEmpty } from "@/components/monitor/RuntimeNodeCard";
import { StateBadge } from "@/components/monitor/StateBadge";
import { EvidenceSnapshotsPanel } from "@/components/monitor/EvidenceSnapshotsPanel";
import { AlertsPanel } from "@/components/monitor/AlertsPanel";
import { TimelinePanel } from "@/components/monitor/TimelinePanel";

const MONITOR_REGISTRY_UPDATED_EVENT = "monitor-registry:updated";

export const Route = createFileRoute("/monitor")({
  head: () => ({ meta: [
    { title: "Live Monitor — Tacera Doctor" },
    { name: "description", content: "Real-time controller and device health, streamed from the local agent." },
  ]}),
  component: MonitorPage,
});

function MonitorPage() {
  const { conn, scheduler, devices, lastEventAt, requestSnapshot } = useMonitorBus();
  const hydrateFromBackend = useSiteConfigStore((state) => state.hydrateFromBackend);
  const monitoredDevices = useSiteConfigStore((state) => state.monitoredDevices);
  const [drafts, setDrafts] = useState<DraftDevice[]>([]);

  function addDraft(key: LiveMonitorProfileKey) {
    setDrafts((prev) => [...prev, makeDraft(key)]);
  }
  function updateDraft(draftId: string, next: DraftDevice) {
    setDrafts((prev) => prev.map((d) => (d.draftId === draftId ? next : d)));
  }
  function removeDraft(draftId: string) {
    setDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleRegistryUpdated = () => {
      void hydrateFromBackend();
      requestSnapshot();
    };
    window.addEventListener(MONITOR_REGISTRY_UPDATED_EVENT, handleRegistryUpdated);
    return () => window.removeEventListener(MONITOR_REGISTRY_UPDATED_EVENT, handleRegistryUpdated);
  }, [hydrateFromBackend, requestSnapshot]);

  const sortedDevices = useMemo(() => {
    const order: Record<DeviceState, number> = { down: 0, degraded: 1, stale: 2, unknown: 3, up: 4 };
    return [...devices].sort((a, b) => order[(a.state ?? "unknown") as DeviceState] - order[(b.state ?? "unknown") as DeviceState]);
  }, [devices]);

  const counts = useMemo(() => {
    const c: Record<DeviceState, number> = { up: 0, degraded: 0, down: 0, stale: 0, unknown: 0 };
    for (const d of devices) c[(d.state ?? "unknown") as DeviceState]++;
    return c;
  }, [devices]);

  const monitoredCountByProfile = useMemo(() => {
    const m = new Map<string, number>();
    for (const md of monitoredDevices) {
      const key = ((md.meta as Record<string, unknown> | undefined)?.profileKey as string | undefined) ?? "";
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [monitoredDevices]);

  async function handleDeviceSaved() {
    await hydrateFromBackend();
    requestSnapshot();
  }

  async function toggleScheduler() {
    try {
      if (scheduler?.running) {
        await monitorApi.stop();
        toast.success("Polling stopped");
      } else {
        const r = await monitorApi.start();
        toast.success(r.alreadyRunning ? "Already running" : `Polling started (${r.devices ?? 0} devices)`);
      }
      requestSnapshot();
    } catch (err) {
      toast.error("Could not reach agent: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="LIVE OPERATIONS"
        title="Tacera / Pulse Operations Console"
        description="Real-time ICMP, TCP, HTTPS, MQTT and Webmin probe telemetry streamed from the on-site agent."
        actions={
          <div className="flex items-center gap-2">
            <ConnectionPill conn={conn} lastEventAt={lastEventAt} />
            <Button size="sm" variant="outline" onClick={requestSnapshot} className="h-8">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={toggleScheduler} className="h-8">
              {scheduler?.running ? (<><Square className="mr-1.5 h-3.5 w-3.5" /> Stop polling</>) : (<><Play className="mr-1.5 h-3.5 w-3.5" /> Start polling</>)}
            </Button>
          </div>
        }
      />

      {/* TACTICAL OPERATIONS QUICK DEPLOY */}
      <section className="rounded-xl border-2 border-border/60 bg-gradient-to-b from-card/80 to-card/40 p-4 shadow-[var(--shadow-panel)]">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">// TACTICAL OPERATIONS</div>
            <h2 className="mt-0.5 text-base font-bold uppercase tracking-wide">Quick Deploy Infrastructure</h2>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">Click any tile to register a new monitored target. Each tile deploys a deterministic probe profile.</p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {monitoredDevices.length} active node{monitoredDevices.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="space-y-4">
          {LIVE_MONITOR_GROUPS.map((g) => {
            const profiles = LIVE_MONITOR_PROFILES.filter((p) => p.group === g.key);
            if (!profiles.length) return null;
            return (
              <div key={g.key}>
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/40" />
                  <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{g.label}</span>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {profiles.map((p) => (
                    <InfrastructureTile
                      key={p.key}
                      icon={p.icon}
                      shortName={p.shortName}
                      description={p.description}
                      critical={p.critical}
                      monitoredCount={monitoredCountByProfile.get(p.key) ?? 0}
                      onClick={() => addDraft(p.key)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {drafts.length > 0 && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">// DEPLOY NEW MONITORED INFRASTRUCTURE TARGET</div>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{drafts.length} pending</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {drafts.map((draft) => (
                <DeviceConfigCard
                  key={draft.draftId}
                  draft={draft}
                  onChange={(next) => updateDraft(draft.draftId, next)}
                  onRemove={() => removeDraft(draft.draftId)}
                  onSaved={() => { removeDraft(draft.draftId); void handleDeviceSaved(); }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* RUNTIME STATE STRIP */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {(["up", "degraded", "down", "stale", "unknown"] as DeviceState[]).map((s) => (
          <div key={s} className="rounded-lg border border-border/50 bg-card/60 p-3 shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">{s}</span>
              <StateBadge state={s} />
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{counts[s]}</div>
          </div>
        ))}
      </div>

      {/* MONITORED INFRASTRUCTURE — runtime cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">// MONITORED INFRASTRUCTURE</div>
            <h2 className="mt-0.5 text-base font-bold uppercase tracking-wide">Active Runtime Nodes</h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            sorted by severity · live
          </span>
        </div>
        {sortedDevices.length === 0 ? (
          <RuntimeNodeCardEmpty onAdd={() => addDraft("ipc-webmin")} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {sortedDevices.map((d) => {
              const full = monitoredDevices.find((m) => m.id === d.id);
              if (!full) return null;
              return <RuntimeNodeCard key={d.id} device={full} state={d} />;
            })}
          </div>
        )}
      </section>

      <EvidenceSnapshotsPanel />
      <AlertsPanel />
      <TimelinePanel />

      {/* Scheduler footer */}
      <Card className="border-border/40">
        <CardContent className="flex flex-wrap items-center gap-3 py-3 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">scheduler</Badge>
          {scheduler?.running ? (
            <>
              <span>running since {relativeTime(scheduler.startedAt)}</span>
              <span>· {scheduler.scheduledDevices} scheduled</span>
              <span>· {scheduler.inFlight} in flight</span>
            </>
          ) : (
            <span>stopped — start polling to begin collecting evidence</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}