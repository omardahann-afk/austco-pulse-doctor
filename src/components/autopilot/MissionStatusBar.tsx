import { cn } from "@/lib/utils";
import { Activity, Bot, Cloud, Clock, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";

type Tone = "success" | "warning" | "destructive" | "muted" | "primary";

const TONE: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
  primary: "text-primary",
};

const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
  primary: "bg-primary",
};

function Cell({
  icon, label, value, tone = "muted",
}: { icon: React.ReactNode; label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      <span className={cn("relative flex h-2 w-2 shrink-0 rounded-full", DOT[tone])}>
        <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", DOT[tone])} />
      </span>
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("truncate text-sm font-semibold", TONE[tone])}>{value}</div>
      </div>
    </div>
  );
}

export function MissionStatusBar(props: {
  loopRunning: boolean;
  aiAvailable: "available" | "unavailable" | "unknown";
  backendConnected: boolean;
  monitored: number;
  activeIssues: number;
  lastScanAt: string | null;
  lastFixResult: "success" | "failed" | "verified" | "none";
  lastFixAt: string | null;
}) {
  const { loopRunning, aiAvailable, backendConnected, monitored, activeIssues, lastScanAt, lastFixResult, lastFixAt } = props;

  const fixTone: Tone =
    lastFixResult === "verified" ? "success" :
    lastFixResult === "success" ? "success" :
    lastFixResult === "failed" ? "destructive" : "muted";
  const fixLabel =
    lastFixResult === "verified" ? "Verified" :
    lastFixResult === "success" ? "Success" :
    lastFixResult === "failed" ? "Failed" : "—";

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-gradient-to-r from-card to-muted/30 shadow-sm">
      <div className="grid grid-cols-2 divide-x divide-y divide-border/50 sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
        <Cell
          icon={<Activity className="h-4 w-4" />}
          label="Autopilot"
          value={loopRunning ? "Running" : "Stopped"}
          tone={loopRunning ? "success" : "muted"}
        />
        <Cell
          icon={<Bot className="h-4 w-4" />}
          label="AI Copilot"
          value={aiAvailable === "available" ? "Available" : aiAvailable === "unavailable" ? "Unavailable" : "Unknown"}
          tone={aiAvailable === "available" ? "primary" : aiAvailable === "unavailable" ? "muted" : "muted"}
        />
        <Cell
          icon={<Cloud className="h-4 w-4" />}
          label="Backend"
          value={backendConnected ? "Connected" : "Unreachable"}
          tone={backendConnected ? "success" : "destructive"}
        />
        <Cell
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Monitored"
          value={String(monitored)}
          tone="muted"
        />
        <Cell
          icon={activeIssues > 0 ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          label="Active issues"
          value={String(activeIssues)}
          tone={activeIssues > 0 ? "warning" : "success"}
        />
        <Cell
          icon={<Clock className="h-4 w-4" />}
          label="Last scan"
          value={lastScanAt ? new Date(lastScanAt).toLocaleTimeString() : "—"}
          tone="muted"
        />
        <Cell
          icon={lastFixResult === "failed" ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          label="Last fix"
          value={lastFixAt ? `${fixLabel} · ${new Date(lastFixAt).toLocaleTimeString()}` : fixLabel}
          tone={fixTone}
        />
      </div>
    </div>
  );
}