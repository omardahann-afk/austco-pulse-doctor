import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Lock, KeyRound, BotOff, FileCode2, UserCheck, Ban } from "lucide-react";

const ITEMS: { icon: React.ReactNode; label: string }[] = [
  { icon: <FileCode2 className="h-4 w-4" />, label: "No free-form commands" },
  { icon: <Lock className="h-4 w-4" />, label: "Backend command templates only" },
  { icon: <ShieldCheck className="h-4 w-4" />, label: "Allowlisted services only" },
  { icon: <Ban className="h-4 w-4" />, label: "High-risk actions blocked" },
  { icon: <UserCheck className="h-4 w-4" />, label: "Human approval required" },
  { icon: <KeyRound className="h-4 w-4" />, label: "Credentials never sent to AI" },
  { icon: <BotOff className="h-4 w-4" />, label: "AI cannot execute" },
];

export function SecurityProofCard() {
  return (
    <Card className="border-success/30 bg-gradient-to-br from-success/10 via-card to-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-success" />
          <div>
            <div className="text-sm font-semibold">Protected by Tacera Safety Engine</div>
            <div className="text-[11px] text-muted-foreground">Every fix passes through deterministic guardrails before any change is made.</div>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ITEMS.map((it) => (
            <li key={it.label} className="flex items-center gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5 text-xs">
              <span className="text-success">{it.icon}</span>
              <span>{it.label}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}