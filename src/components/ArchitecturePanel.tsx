import type { ArchitectureReport } from "@/lib/architectureValidator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, XCircle, ShieldAlert, Network, Server, Layers, Cpu, Box, ListChecks } from "lucide-react";

function Pill({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${ok ? "bg-success/15 text-success" : "bg-critical/15 text-critical"}`}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{ok ? "OK" : "Fail"}
    </span>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: typeof Server; title: string; children: React.ReactNode }) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-info" />{title}</CardTitle></CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

export function ArchitecturePanel({ report }: { report: ArchitectureReport }) {
  return (
    <div className="space-y-4">
      {/* Deployment summary */}
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Layers className="h-4 w-4 text-info" /> Deployment Type</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Stat label="Mode" value={report.deploymentType} />
          <Stat label="Authoritative PuGa" value={report.authoritativePugaIp} mono />
          <Stat label="Critical findings" value={String(report.findings.filter((f) => f.severity === "Critical").length)} tone={report.findings.some((f)=>f.severity==="Critical") ? "crit" : "ok"} />
        </CardContent>
      </Card>

      {/* Authoritative PuGa DNS map */}
      <SectionCard icon={ShieldAlert} title="Authoritative PuGa DNS Map">
        <Table>
          <TableHeader><TableRow><TableHead>Hostname</TableHead><TableHead>Expected IP</TableHead><TableHead>NIC</TableHead><TableHead>Scope VLAN</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.authoritativeDns.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">No authoritative DNS entries declared.</TableCell></TableRow>}
            {report.authoritativeDns.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.entry.hostname}</TableCell>
                <TableCell className="font-mono text-xs">{r.entry.expectedIp}</TableCell>
                <TableCell><span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase">{r.entry.expectedNic}</span></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.entry.scopeVlan}</TableCell>
                <TableCell><Pill ok={r.ok} text={r.ok ? "OK" : "Fail"} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Proxy PuGa DNS map */}
      <SectionCard icon={Network} title="Proxy PuGa DNS Map (Device VLANs)">
        <Table>
          <TableHeader><TableRow><TableHead>Hostname</TableHead><TableHead>Local Proxy IP</TableHead><TableHead>NIC</TableHead><TableHead>Device VLAN</TableHead><TableHead>Served By</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.proxyDns.length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-xs text-muted-foreground">No proxy DNS entries — devices on private VLANs may not reach PuGa.</TableCell></TableRow>}
            {report.proxyDns.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.entry.hostname}</TableCell>
                <TableCell className="font-mono text-xs">{r.entry.expectedIp}</TableCell>
                <TableCell><span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase">{r.entry.expectedNic}</span></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.entry.scopeVlan}</TableCell>
                <TableCell className="text-xs">{r.entry.servedBy}</TableCell>
                <TableCell><Pill ok={r.ok} text={r.ok ? "OK" : "Fail"} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Server NIC map */}
      <SectionCard icon={Server} title="Server NIC Map">
        <Table>
          <TableHeader><TableRow><TableHead>Server</TableHead><TableHead>NIC</TableHead><TableHead>IP</TableHead><TableHead>VLAN</TableHead><TableHead>Purpose</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.serverNicMap.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">No server interfaces declared.</TableCell></TableRow>}
            {report.serverNicMap.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs font-medium">{s.server}</TableCell>
                <TableCell><span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase">{s.nic}</span></TableCell>
                <TableCell className="font-mono text-xs">{s.ip}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{s.vlan}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.purpose}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Module Dependency Matrix */}
      <SectionCard icon={Cpu} title="Module Dependency Matrix">
        <Table>
          <TableHeader><TableRow><TableHead>Module Role</TableHead><TableHead>Host</TableHead><TableHead>Expected VM</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.moduleMatrix.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-xs text-muted-foreground">No installed modules declared.</TableCell></TableRow>}
            {report.moduleMatrix.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs font-medium">{r.module.role}</TableCell>
                <TableCell className="text-xs">{r.module.host}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.module.expectedVmType}</TableCell>
                <TableCell><Pill ok={r.ok} text={r.ok ? "OK" : "Fail"} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Pulse Device Dependency Check */}
      <SectionCard icon={Box} title="Pulse Device Dependency Check">
        <Table>
          <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>VLAN</TableHead><TableHead>DNS Target</TableHead><TableHead>Missing Deps</TableHead><TableHead>Status</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
          <TableBody>
            {report.deviceDependencies.length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-xs text-muted-foreground">No Pulse Devices declared.</TableCell></TableRow>}
            {report.deviceDependencies.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs font-medium">{r.device.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.device.vlan}</TableCell>
                <TableCell className="text-xs">{r.device.dnsTarget}</TableCell>
                <TableCell className="text-xs">{r.missingDeps.length ? r.missingDeps.join(", ") : "—"}</TableCell>
                <TableCell><Pill ok={r.ok} text={r.ok ? "OK" : "Fail"} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>

      {/* Install checklist */}
      {report.installChecklist.length > 0 && (
        <SectionCard icon={ListChecks} title="Install Checklist (Patch → Integrity → Time/NTP/DNS → Modules → License → SSL)">
          <div className="grid gap-1.5 p-3 md:grid-cols-2">
            {report.installChecklist.map((c) => (
              <div key={c.item} className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/10 px-2.5 py-1.5 text-xs">
                {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-critical" />}
                <span>{c.item}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Architecture findings */}
      {report.findings.length > 0 && (
        <Card className="border-critical/40 bg-critical/5">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base text-critical"><ShieldAlert className="h-4 w-4" /> Architecture Findings ({report.findings.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report.findings.map((f) => (
              <div key={f.id} className="rounded-md border border-border/50 bg-background/40 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${f.severity === "Critical" ? "bg-critical/20 text-critical" : f.severity === "Warning" ? "bg-warning/20 text-warning" : "bg-info/20 text-info"}`}>{f.severity}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.area}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{f.id}</span>
                </div>
                <div className="mt-1 text-sm font-semibold">{f.title}</div>
                <div className="mt-0.5 text-muted-foreground">{f.detail}</div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">{f.evidence.join(" · ")}</div>
                <ol className="mt-1 list-decimal pl-5">
                  {f.fix.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "crit" }) {
  const cls = tone === "crit" ? "border-critical/40 text-critical" : tone === "ok" ? "border-success/30 text-success" : "border-border/50";
  return (
    <div className={`rounded-md border bg-muted/10 p-3 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}