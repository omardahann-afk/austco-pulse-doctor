import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ShieldCheck, AlertTriangle, Wrench, CheckCircle2, HandMetal } from "lucide-react";

type Kpi = { label: string; value: number; tone: "success" | "warning" | "primary" | "destructive" | "muted"; icon: React.ReactNode; hint: string };

const TONE: Record<Kpi["tone"], string> = {
  success: "from-success/15 to-success/5 text-success border-success/30",
  warning: "from-warning/15 to-warning/5 text-warning border-warning/30",
  primary: "from-primary/15 to-primary/5 text-primary border-primary/30",
  destructive: "from-destructive/15 to-destructive/5 text-destructive border-destructive/30",
  muted: "from-muted/40 to-background text-foreground border-border",
};

export function MissionKpiCards(props: {
  healthy: number;
  needsAttention: number;
  fixReady: number;
  fixExecuted: number;
  manualRequired: number;
}) {
  const cards: Kpi[] = [
    { label: "Healthy", value: props.healthy, tone: "success", icon: <ShieldCheck className="h-5 w-5" />, hint: "Services passing all checks" },
    { label: "Needs Attention", value: props.needsAttention, tone: "warning", icon: <AlertTriangle className="h-5 w-5" />, hint: "Detected issues from last scan" },
    { label: "Fix Ready", value: props.fixReady, tone: "primary", icon: <Wrench className="h-5 w-5" />, hint: "Plans prepared, awaiting approval" },
    { label: "Fix Executed", value: props.fixExecuted, tone: "success", icon: <CheckCircle2 className="h-5 w-5" />, hint: "Successful executions on record" },
    { label: "Manual Required", value: props.manualRequired, tone: "destructive", icon: <HandMetal className="h-5 w-5" />, hint: "High-risk — engine refuses to act" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className={cn("border bg-gradient-to-br", TONE[c.tone])}>
          <CardContent className="space-y-1 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{c.label}</div>
              {c.icon}
            </div>
            <div className="text-3xl font-bold leading-none tracking-tight">{c.value}</div>
            <div className="text-[11px] opacity-80">{c.hint}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}