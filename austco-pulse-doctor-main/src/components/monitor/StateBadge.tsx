import { type DeviceState, stateColor, stateLabel } from "@/lib/monitorClient";

export function StateBadge({ state, className = "" }: { state: DeviceState | null | undefined; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${stateColor(state)} ${state === "up" ? "animate-pulse" : ""}`} />
      {stateLabel(state)}
    </span>
  );
}