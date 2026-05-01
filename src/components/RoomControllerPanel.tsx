import type {
  RcReport, RcTraceStep, RcTraceBreak,
  ConfigEvidence, RcFinding,
} from "@/lib/roomControllerDoctor";
import { summarizeEvidence } from "@/lib/roomControllerDoctor";
import type { CallPointEntry, RoomController, RcCredentials, RcAuthStatus } from "@/lib/siteDoctorApi";
import { DEFAULT_RC_CREDENTIALS, shouldAutoApplyDefaultCreds } from "@/lib/siteDoctorApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Cpu, Globe, Hash, MapPin, Network, AlertOctagon, AlertTriangle,
  CheckCircle2, XCircle, Loader2, Circle, MinusCircle, ChevronRight,
  Wrench, ListTree, FileText, KeyRound, ShieldAlert, ShieldCheck, Eye, EyeOff,
  ChevronDown, Copy, Check, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/* ---------- Doctor cards ---------- */

export function RoomControllerDoctorPanel({ reports }: { reports: RcReport[] }) {
  return <RoomControllerDoctorPanelEditable reports={reports} />;
}

/**
 * Editable variant — accepts onUpdate to mutate a controller (credentials, etc).
 * The non-editable export above renders read-only by passing no handler.
 */
export function RoomControllerDoctorPanelEditable({
  reports, onUpdateController, onRetryAuth,
}: {
  reports: RcReport[];
  onUpdateController?: (name: string, patch: Partial<RoomController>) => void;
  onRetryAuth?: (name: string) => void;
}) {
  if (reports.length === 0) {
    return (
      <Card className="bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-info" /> Room Controller Doctor
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          No Room Controllers declared in payload. Add controllers under <span className="font-mono">roomControllers</span> to enable SIM-046 diagnostics.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-info" /> Room Controller Doctor
          <span className="ml-auto text-[11px] font-normal text-muted-foreground">{reports.length} controller{reports.length === 1 ? "" : "s"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports.map((r) => (
          <RcCard
            key={r.controller.name}
            report={r}
            onUpdateController={onUpdateController}
            onRetryAuth={onRetryAuth}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function RcCard({
  report, onUpdateController, onRetryAuth,
}: {
  report: RcReport;
  onUpdateController?: (name: string, patch: Partial<RoomController>) => void;
  onRetryAuth?: (name: string) => void;
}) {
  const c = report.controller;
  const crit = report.findings.filter((f) => f.severity === "Critical").length;
  const warn = report.findings.filter((f) => f.severity === "Warning").length;
  const tone = crit ? "border-critical/50" : warn ? "border-warning/50" : "border-success/40";
  return (
    <div className={`rounded-lg border ${tone} bg-background/40 p-3`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-info" /><span className="font-semibold text-sm">{c.name}</span></div>
        <Pair icon={Network} label="IP" value={c.ip} mono />
        <Pair icon={Hash}    label="ID" value={c.controllerId} mono />
        {c.mac && <Pair icon={Hash} label="MAC" value={c.mac} mono />}
        {c.location && <Pair icon={MapPin} label="Loc" value={c.location} />}
        <Pair icon={Globe} label="Web" value={c.hasWebAccess ? "OK" : "Unreachable"} ok={c.hasWebAccess} bad={!c.hasWebAccess} />
        <AuthBadge status={c.authStatus} isDefault={c.credentials?.isDefault} />
        {c.model && <Badge variant="outline" className="text-[9px] uppercase tracking-wider">{c.model}</Badge>}
      </div>

      {/* SIM-046 — Credentials editor */}
      {(shouldAutoApplyDefaultCreds(c.model) || c.credentials) && (
        <CredentialsEditor
          controller={c}
          onChange={(patch) => onUpdateController?.(c.name, patch)}
          onRetryAuth={onRetryAuth ? () => onRetryAuth(c.name) : undefined}
        />
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="IPnet devices" value={String(report.ipnetSummary.total)} />
        <Stat label="Zones" value={String((c.zones ?? []).length)} />
        <Stat label="Group signals" value={String((c.groupSignals ?? []).length)} />
        <Stat label="Call types" value={String((c.callTypes ?? []).length)} />
        <Stat label="Port A / B" value={`${report.ipnetSummary.portA} / ${report.ipnetSummary.portB}`} />
        <Stat label="Offline / Fault" value={String(report.ipnetSummary.offline)} />
        <Stat label="Not verified" value={String(report.ipnetSummary.notVerified)} />
        <Stat label="Event Viewer" value={report.events.length ? `${report.events.length} events` : "Empty"} />
      </div>

      {report.findings.length === 0 ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> No findings — controller passes SIM-046 checks.
        </div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {report.findings.map((f, i) => (
            <li key={i} className="rounded-md border border-border/50 bg-card/60 p-2 text-xs">
              <div className="flex items-center gap-1.5">
                {f.severity === "Critical"
                  ? <AlertOctagon className="h-3.5 w-3.5 text-critical" />
                  : f.severity === "Warning"
                    ? <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    : <CheckCircle2 className="h-3.5 w-3.5 text-info" />}
                <span className="font-medium">{f.title}</span>
                <Badge variant="outline" className="ml-auto text-[9px] uppercase tracking-wider">{f.area}</Badge>
              </div>
              <div className="mt-1 text-muted-foreground">{f.detail}</div>
              {f.evidence.length > 0 && (
                <ul className="mt-1 space-y-0.5 rounded bg-background/40 p-1.5 font-mono text-[10px]">
                  {f.evidence.map((e, j) => <li key={j}>• {e}</li>)}
                </ul>
              )}
              <div className="mt-1 flex items-start gap-1.5 text-[11px]">
                <Wrench className="mt-0.5 h-3 w-3 text-muted-foreground" />
                <span>{f.fix.join(" → ")}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pair({ icon: Icon, label, value, mono, ok, bad }: { icon: typeof Cpu; label: string; value: string; mono?: boolean; ok?: boolean; bad?: boolean }) {
  const cls = ok ? "text-success" : bad ? "text-critical" : "";
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <Icon className="h-3 w-3" /> <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono", cls)}>{value}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 bg-muted/10 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

/* ---------- IPnet Device Tree ---------- */

export function IpnetDeviceTreePanel({ reports }: { reports: RcReport[] }) {
  if (reports.length === 0) return null;
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTree className="h-4 w-4 text-info" /> IPnet Device Tree
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports.map((r) => {
          const devs = r.controller.ipnetDevices ?? [];
          return (
            <div key={r.controller.name} className="rounded-md border border-border/50 bg-background/30 p-2 font-mono text-xs">
              <div className="font-semibold text-foreground">{r.controller.name}</div>
              {devs.length === 0 ? (
                <div className="mt-1 pl-4 text-muted-foreground">└─ (no IPnet devices — Not verified)</div>
              ) : (
                <ul className="mt-1 pl-4">
                  {devs.map((d, i) => {
                    const last = i === devs.length - 1;
                    const stTone =
                      d.status === "Online" ? "text-success"
                      : d.status === "Offline" || d.status === "Fault" ? "text-critical"
                      : "text-muted-foreground";
                    return (
                      <li key={i} className="leading-relaxed">
                        <span className="text-muted-foreground">{last ? "└─ " : "├─ "}</span>
                        <span className="text-foreground">{d.name}</span>
                        <span className="text-muted-foreground"> · {d.type} · @{d.address}</span>
                        {d.portRun && <span className="text-muted-foreground"> · port {d.portRun}</span>}
                        <span className={cn("ml-2", stTone)}>[{d.status ?? "Not verified"}]</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ---------- Breakpoint Map (SIM-046) ---------- */

export function RoomControllerBreakpointMap({
  callPoint, steps, breakpoint, conclusion,
}: {
  callPoint: CallPointEntry;
  steps: RcTraceStep[];
  breakpoint: RcTraceBreak | null;
  conclusion: string;
}) {
  return (
    <div className="space-y-3">
      <Card className="bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Network className="h-4 w-4 text-info" /> Room Controller Breakpoint Map · {callPoint.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{callPoint.controller} · in {callPoint.inputIndex} → {callPoint.expectedOutputGroup}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-stretch gap-1.5 p-1">
              {steps.map((s, i) => {
                const tone =
                  s.status === "Passed" ? "border-success/50 bg-success/10 text-success" :
                  s.status === "Failed" ? "border-critical/60 bg-critical/15 text-critical shadow-[0_0_24px_-6px_var(--critical)]" :
                  s.status === "Running" ? "border-info/60 bg-info/10 text-info" :
                  s.status === "Skipped" ? "border-border bg-muted/20 text-muted-foreground opacity-60" :
                  "border-border bg-muted/20 text-muted-foreground";
                const Icon =
                  s.status === "Passed" ? CheckCircle2 :
                  s.status === "Failed" ? XCircle :
                  s.status === "Running" ? Loader2 :
                  s.status === "Skipped" ? MinusCircle : Circle;
                return (
                  <div key={s.id} className="flex items-center gap-1">
                    <div className={cn("min-w-[170px] max-w-[210px] rounded-lg border p-2", tone)}>
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5", s.status === "Running" && "animate-spin")} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide">{s.layer}</span>
                      </div>
                      <div className="mt-1 text-xs font-medium leading-snug">{s.label}</div>
                      <div className="mt-0.5 text-[11px] leading-snug opacity-80">{s.detail}</div>
                    </div>
                    {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {breakpoint ? (
        <Card className="border-critical/50 bg-gradient-to-br from-critical/15 to-critical/5">
          <CardHeader className="pb-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-critical">SIM-046 Rule {breakpoint.rule} · Root Cause</div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertOctagon className="h-5 w-5 text-critical" /> Break found at: {breakpoint.breakPoint}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <Box label="Previous step passed" value={breakpoint.previousStepPassed} ok />
              <Box label="Failed step" value={breakpoint.failedStep} bad />
            </div>
            {breakpoint.evidence.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence</div>
                <ul className="space-y-0.5 rounded-md border border-border/50 bg-background/40 p-2 font-mono text-[11px]">
                  {breakpoint.evidence.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              </div>
            )}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Likely cause</div>
              <p>{breakpoint.likelyCause}</p>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Wrench className="h-3 w-3" /> Technician fix</div>
              <ol className="list-decimal space-y-0.5 pl-5">
                {breakpoint.fix.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <CheckCircle2 className="h-5 w-5 text-success" /><span className="font-medium">{conclusion}</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Box({ label, value, ok, bad }: { label: string; value: string; ok?: boolean; bad?: boolean }) {
  const cls = ok ? "border-success/40 bg-success/5" : bad ? "border-critical/40 bg-critical/5" : "border-border/50 bg-background/30";
  return (
    <div className={`rounded-md border p-2 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs">{value}</div>
    </div>
  );
}

/* ---------- Event Viewer paste box ---------- */

export function EventViewerPaste({
  controllerName, value, onChange,
}: { controllerName: string; value: string; onChange: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-info" /> Event Viewer · {controllerName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          placeholder={"Paste Room Controller Event Viewer / data log text here…\nExample:\n14:01:23 Input ACTIVE device:Callpoint-1.03 zone:Room-230\n14:01:24 Cancel device:Callpoint-1.03"}
          className="font-mono text-xs"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { setDraft(""); onChange(""); }}>Clear</Button>
          <Button type="button" size="sm" onClick={() => onChange(draft)}>Apply</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Auth status badge ---------- */

function AuthBadge({ status, isDefault }: { status?: RcAuthStatus; isDefault?: boolean }) {
  const s = status ?? "untested";
  const map: Record<RcAuthStatus, { label: string; cls: string; Icon: typeof KeyRound }> = {
    untested:               { label: "Auth: untested",                cls: "bg-muted/30 text-muted-foreground", Icon: KeyRound },
    authenticated_default:  { label: "Auth: success (admin/admin)",    cls: "bg-warning/15 text-warning",         Icon: ShieldAlert },
    authenticated_custom:   { label: "Auth: success (custom)",         cls: "bg-success/15 text-success",         Icon: ShieldCheck },
    auth_failed:            { label: "Auth: failed (admin/admin)",     cls: "bg-critical/15 text-critical",       Icon: XCircle },
    auth_failed_custom:     { label: "Auth: failed (custom)",          cls: "bg-critical/15 text-critical",       Icon: XCircle },
    unreachable:            { label: "Auth: unreachable",              cls: "bg-critical/15 text-critical",       Icon: XCircle },
  };
  const v = map[s];
  // If a "default" success is reported but creds are no longer the defaults,
  // present it as a custom success.
  const label = s === "authenticated_default" && isDefault === false
    ? "Auth: success (custom)"
    : v.label;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", v.cls)}>
      <v.Icon className="h-3 w-3" /> {label}
    </span>
  );
}

/* ---------- Credentials editor (default admin/admin + override) ---------- */

function CredentialsEditor({
  controller, onChange, onRetryAuth,
}: {
  controller: RoomController;
  onChange: (patch: Partial<RoomController>) => void;
  onRetryAuth?: () => void;
}) {
  const creds: RcCredentials = controller.credentials ?? { ...DEFAULT_RC_CREDENTIALS };
  const [show, setShow] = useState(false);
  const usingDefaults = creds.username === DEFAULT_RC_CREDENTIALS.username
    && creds.password === DEFAULT_RC_CREDENTIALS.password;

  const apply = (next: Partial<RcCredentials>) => {
    const merged: RcCredentials = { ...creds, ...next };
    merged.isDefault = merged.username === DEFAULT_RC_CREDENTIALS.username
      && merged.password === DEFAULT_RC_CREDENTIALS.password;
    onChange({ credentials: merged });
  };

  return (
    <div className="mt-2 rounded-md border border-border/50 bg-background/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-info" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Default credentials (SIM-046)</span>
        {usingDefaults
          ? <Badge variant="outline" className="text-[9px] uppercase tracking-wider text-warning">admin / admin</Badge>
          : <Badge variant="outline" className="text-[9px] uppercase tracking-wider text-success">custom</Badge>}
        {controller.authStatus === "auth_failed" && (
          <span className="ml-auto text-[11px] text-critical">Default credentials rejected. Device may have custom credentials.</span>
        )}
        {controller.authStatus === "auth_failed_custom" && (
          <span className="ml-auto text-[11px] text-critical">Custom credentials rejected by device.</span>
        )}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Username</Label>
          <Input
            value={creds.username}
            onChange={(e) => apply({ username: e.target.value.slice(0, 64) })}
            placeholder="admin"
            autoComplete="off"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Password</Label>
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              value={creds.password}
              onChange={(e) => apply({ password: e.target.value.slice(0, 128) })}
              placeholder="admin"
              autoComplete="off"
              className="h-8 pr-8 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => apply({ ...DEFAULT_RC_CREDENTIALS })}
          >
            Reset to defaults
          </Button>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            size="sm"
            className="h-8 bg-info text-info-foreground hover:bg-info/90"
            onClick={() => onRetryAuth?.()}
            disabled={!onRetryAuth}
          >
            Retry auth
          </Button>
        </div>
      </div>

      <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={!!creds.rememberForSession}
          onChange={(e) => apply({ rememberForSession: e.target.checked })}
          className="h-3 w-3"
        />
        Remember for this session only (never persisted to disk)
      </label>

      {usingDefaults && (controller.authStatus === "authenticated_default" || controller.authStatus === "untested") && (
        <div className="mt-2 flex items-start gap-1.5 rounded border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Device is using default credentials (admin/admin). This is not recommended for production environments.
          </span>
        </div>
      )}
      {controller.authMessage && (
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">{controller.authMessage}</div>
      )}
    </div>
  );
}
