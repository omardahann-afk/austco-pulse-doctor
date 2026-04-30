import type { AustcoDevice } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Laptop, Network, Server, Layers3, Cpu, Radio, MonitorSmartphone, Lightbulb, ChevronDown } from "lucide-react";

function statusRing(status: AustcoDevice["status"]) {
  switch (status) {
    case "Critical": return "border-critical/60 bg-critical/10 text-critical shadow-[0_0_24px_-6px_var(--critical)]";
    case "Warning": return "border-warning/60 bg-warning/10 text-warning";
    case "Healthy": return "border-success/50 bg-success/10 text-success";
    case "Offline": return "border-muted bg-muted/40 text-muted-foreground";
    case "Scanning": return "border-info/60 bg-info/10 text-info animate-pulse";
  }
}
function Node({ Icon, title, ip, status, issue, wide }: { Icon: typeof Laptop; title: string; ip?: string; status: AustcoDevice["status"]; issue?: string; wide?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", statusRing(status), wide ? "min-w-[260px]" : "min-w-[180px]")}>
      <div className="flex items-center gap-2"><Icon className="h-4 w-4" /><div className="text-sm font-semibold leading-tight">{title}</div></div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="font-mono opacity-80">{ip ?? ""}</span>
        <span className="uppercase tracking-wide opacity-90">{status}</span>
      </div>
      {issue && <div className="mt-1 text-[11px] leading-snug opacity-90">⚠ {issue}</div>}
    </div>
  );
}
const Down = () => <ChevronDown className="my-1 h-4 w-4 text-muted-foreground" />;

export function SystemMap({ devices }: { devices: AustcoDevice[] }) {
  const find = (id: string) => devices.find((d) => d.id === id)!;
  const primary = find("srv-primary"), secondary = find("srv-secondary"), vip = find("srv-vip");
  const ctrlE = find("ctrl-east"), ctrlW = find("ctrl-west");
  const in8 = find("in8-basement"), app1 = find("app1-east"), gsl = find("gsl-east");
  const swCore = find("sw-core"), swEast = find("sw-east");
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-6 shadow-[var(--shadow-panel)]">
      <Node Icon={Laptop} title="Technician Laptop" ip="10.20.0.99" status="Healthy" /><Down />
      <Node Icon={Network} title="Core Switch" ip={swCore.ip} status={swCore.status} /><Down />
      <div className="flex flex-wrap items-start justify-center gap-3">
        <Node Icon={Network} title="East Wing Switch" ip={swEast.ip} status={swEast.status} issue={swEast.issue} />
        <Node Icon={Network} title="West Wing Switch" ip="10.20.0.4" status="Healthy" />
      </div><Down />
      <Node Icon={Server} title="Virtual IP (VIP)" ip={vip.ip} status={vip.status} wide /><Down />
      <div className="flex flex-wrap items-start justify-center gap-3">
        <Node Icon={Server} title={`${primary.name} (Active)`} ip={primary.ip} status={primary.status} />
        <Node Icon={Server} title={`${secondary.name} (Passive)`} ip={secondary.ip} status={secondary.status} issue={secondary.issue} />
      </div><Down />
      <Node Icon={Layers3} title="Pulse Services + Event Queue" status="Warning" issue="Queue backlog 28" wide /><Down />
      <Node Icon={Layers3} title="CCT Logic" status="Healthy" issue="Verified — not the failure point" wide /><Down />
      <div className="flex flex-wrap items-start justify-center gap-3">
        <Node Icon={Cpu} title={ctrlE.name} ip={ctrlE.ip} status={ctrlE.status} />
        <Node Icon={Cpu} title={ctrlW.name} ip={ctrlW.ip} status={ctrlW.status} issue={ctrlW.issue} />
      </div><Down />
      <div className="flex flex-wrap items-start justify-center gap-3">
        <Node Icon={Radio} title={in8.name} ip={in8.ip} status={in8.status} issue={in8.issue} />
        <Node Icon={MonitorSmartphone} title={app1.name} ip={app1.ip} status={app1.status} issue={app1.issue} />
        <Node Icon={Lightbulb} title={gsl.name} ip={gsl.ip} status={gsl.status} issue={gsl.issue} />
      </div>
    </div>
  );
}
