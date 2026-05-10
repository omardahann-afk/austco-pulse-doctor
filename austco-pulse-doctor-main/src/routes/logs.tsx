import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Upload, Loader2, X, FileText, ArrowLeft } from "lucide-react";
import { analyzeLogs, type LogUpload } from "@/lib/agentClient";
import { saveLastLogResult, loadLastLogResult, type LogResult } from "@/lib/siteConfig";

export const Route = createFileRoute("/logs")({
  head: () => ({ meta: [{ title: "Logs — Tacera Doctor" }] }),
  component: LogsPage,
});

const TYPE_OPTIONS = [
  "auto", "pulse_log", "ipconnect_log", "inga_log", "license_log", "controller_log", "event_log", "ccp_or_xml", "json", "csv", "generic_log",
];

function LogsPage() {
  const [files, setFiles] = useState<LogUpload[]>([]);
  const [pasteName, setPasteName] = useState("pasted.log");
  const [pasteType, setPasteType] = useState("auto");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LogResult | null>(null);

  useEffect(() => { setResult(loadLastLogResult()); }, []);

  async function onUpload(list: FileList | null) {
    if (!list) return;
    const arr: LogUpload[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 5 * 1024 * 1024) { setError(`${f.name} too large (>5MB)`); continue; }
      arr.push({ name: f.name, type: "auto", content: await f.text() });
    }
    setFiles((p) => [...p, ...arr]);
  }
  function addPasted() {
    if (!pasteText.trim()) return;
    setFiles((p) => [...p, { name: pasteName || "pasted.log", type: pasteType, content: pasteText }]);
    setPasteText("");
  }
  function rm(i: number) { setFiles((p) => p.filter((_, j) => j !== i)); }
  function setType(i: number, t: string) { setFiles((p) => { const n = [...p]; n[i] = { ...n[i], type: t }; return n; }); }

  async function analyze() {
    setError(null); setBusy(true);
    try {
      const res = await analyzeLogs(files);
      if (!("ok" in res) || !res.ok) {
        setError(("message" in res && res.message) || "Backend error.");
      } else {
        saveLastLogResult(res); setResult(res);
      }
    } catch (err) {
      setError(`Backend unreachable — this build needs the on-site agent running. (${err instanceof Error ? err.message : String(err)})`);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Log Analysis"
        title="Upload & Analyze Logs"
        description="Upload Pulse / IPConnect / INGA / License / Controller logs or paste raw text. The on-site agent parses pattern-based evidence — no fake events."
      />

      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-sm">1 · Add files</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-border/60 bg-background/60 px-3 py-1.5 text-xs hover:bg-background">
            <Upload className="h-3.5 w-3.5" /> Upload files
            <input type="file" multiple className="hidden" accept=".log,.txt,.csv,.json,.xml,.ccp" onChange={(e) => { void onUpload(e.target.files); e.currentTarget.value = ""; }} />
          </label>

          <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
            <Input value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="filename for paste" />
            <select value={pasteType} onChange={(e) => setPasteType(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button type="button" variant="outline" onClick={addPasted} disabled={!pasteText.trim()}>Add paste</Button>
          </div>
          <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste log/config text here…" className="min-h-[120px] font-mono text-xs" />

          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 text-info" />
                  <span className="font-mono truncate flex-1">{f.name}</span>
                  <span className="text-muted-foreground">{(f.content.length / 1024).toFixed(1)} KB</span>
                  <select value={f.type} onChange={(e) => setType(i, e.target.value)} className="h-7 rounded border border-input bg-background px-2 text-[11px]">
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-critical" onClick={() => rm(i)}><X className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="text-xs text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"} ready</div>
          <Button onClick={analyze} disabled={busy || files.length === 0} className="ml-auto bg-info text-info-foreground hover:bg-info/90">
            {busy ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Analyzing…</> : "Analyze Uploaded Logs"}
          </Button>
        </CardContent>
        {error && <div className="mx-4 mb-4 rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}
      </Card>

      {result && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="rounded bg-info/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-info">{result.mode}</span>
              Result · confidence {result.confidence}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="text-sm">{result.summary}</p>
            <div className="grid gap-2 md:grid-cols-4">
              <Stat label="Errors" value={result.aggregate.totalErrors} />
              <Stat label="Warnings" value={result.aggregate.totalWarnings} />
              <Stat label="Unique IPs" value={result.aggregate.uniqueIps.length} />
              <Stat label="Controller IDs" value={result.aggregate.uniqueControllerIds.length} />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Event counts</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.aggregate.eventCounts).length === 0 && <span className="text-muted-foreground">none</span>}
                {Object.entries(result.aggregate.eventCounts).map(([k, v]) => (
                  <span key={k} className="rounded border border-border/50 bg-muted/20 px-1.5 py-0.5 font-mono">{k}: {v}</span>
                ))}
              </div>
            </div>
            {result.evidence.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Evidence</div>
                <ul className="space-y-1 font-mono">{result.evidence.slice(0, 30).map((e, i) => <li key={i}>· {e}</li>)}</ul>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">Tested from VM: {result.vm.hostname} ({result.vm.addrs.join(", ") || "no IPv4"}) · {new Date(result.finishedAt).toLocaleString()}</div>
          </CardContent>
        </Card>
      )}

      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Command Center
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border/50 bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );
}
