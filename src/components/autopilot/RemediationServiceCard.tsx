import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AUTOPILOT_SERVICE_PROFILES, type AutopilotService } from "@/lib/autopilotServicesClient";

const RISK_STYLES: Record<string, string> = {
  LOW:    "border-success/40 bg-success/10 text-success",
  MEDIUM: "border-warning/40 bg-warning/10 text-warning",
  HIGH:   "border-critical/40 bg-critical/10 text-critical",
};

function managerCapability(mgr: string) {
  switch (mgr) {
    case "systemd": return { restart: "systemctl restart", blocked: ["host reboot", "package upgrade"] };
    case "docker":  return { restart: "docker restart", blocked: ["image pull", "container delete"] };
    case "webmin":  return { restart: "miniserv restart", blocked: ["package install", "user delete"] };
    default:        return { restart: "manual only", blocked: ["all auto-execute actions"] };
  }
}

export function RemediationServiceCard({
  service, onEdit, onDelete,
}: { service: AutopilotService; onEdit: () => void; onDelete: () => void }) {
  const profile = AUTOPILOT_SERVICE_PROFILES.find((p) => p.type === service.type);
  const Icon = profile
    ? (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[profile.icon] ?? Icons.Cog
    : Icons.Cog;
  const risk = (service.riskLevel || profile?.riskClass || "MEDIUM").toUpperCase();
  const cap = managerCapability(service.serviceManager);
  const targetUnit = service.systemdUnit || service.dockerContainer || (service.webminPort ? `webmin:${service.webminPort}` : "—");

  return (
    <div className="rounded-lg border-2 border-border/60 bg-card/70 shadow-[var(--shadow-panel)]">
      <div className="flex items-start justify-between gap-3 border-b border-border/40 p-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-primary">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{service.name}</div>
            <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              {profile?.shortName ?? service.type} · {service.serviceManager}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cn("inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest", RISK_STYLES[risk] ?? RISK_STYLES.MEDIUM)}>
            RISK · {risk}
          </span>
          {!service.enabled && (
            <span className="inline-flex items-center rounded-sm border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">DISABLED</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border/40 bg-border/40 text-[11px]">
        {[
          { label: "Host", value: `${service.sshUsername}@${service.host}:${service.sshPort}`, mono: true },
          { label: "Target unit", value: targetUnit, mono: true },
          { label: "Restart capability", value: cap.restart, mono: true },
          { label: "Approval", value: risk === "LOW" ? "1-click" : risk === "HIGH" ? "manual only" : "explicit ack", mono: false },
        ].map((m) => (
          <div key={m.label} className="bg-card/60 px-2.5 py-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
            <div className={cn("mt-0.5 truncate", m.mono && "font-mono text-[11px]")}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2 p-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Blocked actions</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {cap.blocked.map((b) => (
              <span key={b} className="inline-flex items-center rounded-sm border border-critical/30 bg-critical/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-critical/90">
                ⊘ {b}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-critical hover:text-critical" onClick={onDelete}>Remove</Button>
        </div>
      </div>
    </div>
  );
}