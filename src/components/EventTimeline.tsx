import type { AustcoEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Clock, Activity, RotateCcw, ArrowRightCircle, Heart } from "lucide-react";

const TYPE_ICON = { Active: Activity, Cancel: RotateCcw, Output: ArrowRightCircle, Ack: CheckCircle2, Heartbeat: Heart } as const;
const STATUS_STYLES = {
  Success: { dot: "bg-success", text: "text-success", Icon: CheckCircle2 },
  Failed: { dot: "bg-critical", text: "text-critical", Icon: XCircle },
  Pending: { dot: "bg-warning", text: "text-warning", Icon: Clock },
} as const;

export function EventTimeline({ events }: { events: AustcoEvent[] }) {
  const sorted = [...events].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  return (
    <ol className="relative space-y-3 border-l border-border/60 pl-5">
      {sorted.map((e) => {
        const TypeIcon = TYPE_ICON[e.eventType];
        const s = STATUS_STYLES[e.status];
        return (
          <li key={e.id} className="relative">
            <span className={cn("absolute -left-[27px] top-1.5 h-3.5 w-3.5 rounded-full border border-background", s.dot)} />
            <div className="rounded-md border border-border/60 bg-card/60 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <TypeIcon className="h-3.5 w-3.5 text-info" />
                <span className="font-semibold uppercase tracking-wide">{e.eventType}</span>
                <span className={cn("inline-flex items-center gap-1", s.text)}><s.Icon className="h-3 w-3" />{e.status}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="mt-1.5 text-sm">
                <span className="font-medium">{e.room}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="text-muted-foreground">{e.sourceDevice}</span>
                {e.targetDevice && <><span className="mx-1 text-muted-foreground">→</span><span className="text-muted-foreground">{e.targetDevice}</span></>}
              </div>
              <p className="mt-1 text-xs text-foreground/80">{e.details}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
