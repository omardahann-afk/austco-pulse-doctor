import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { DeviceTable } from "@/components/DeviceTable";
import { DiagnosticCard } from "@/components/DiagnosticCard";
import { mockDevices } from "@/data/mockSite";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { useEffect, useState } from "react";
import type { DiagnosticIssue } from "@/lib/types";

export const Route = createFileRoute("/signal-lights")({
  head: () => ({ meta: [{ title: "Signal / Zone Light Doctor — Austco Site Doctor" }] }),
  component: Page,
});

function Page() {
  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  useEffect(() => { runFullAustcoDiagnosis(siteConfig, undefined, 0).then(r => setIssues(r.issues.filter(i => i.id === "Signal" || i.module.toLowerCase().includes("Signal".toLowerCase())))); }, []);
  const devices = mockDevices.filter(d => ["Signal Light","Zone Light"].includes(d.type));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Group + zone outputs" title="Signal / Zone Light Doctor" description="Output event vs physical activation — where exactly the signal stopped." />
      <DeviceTable devices={devices} />
      <div className="grid gap-4 xl:grid-cols-2">
        {issues.map((iss, i) => <DiagnosticCard key={iss.id} issue={iss} rank={i + 1} />)}
      </div>
    </div>
  );
}
