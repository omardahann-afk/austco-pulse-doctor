import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { DeviceTable } from "@/components/DeviceTable";
import { DiagnosticCard } from "@/components/DiagnosticCard";
import { mockDevices } from "@/data/mockSite";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { useEffect, useState } from "react";
import type { DiagnosticIssue } from "@/lib/types";

export const Route = createFileRoute("/network")({
  head: () => ({ meta: [{ title: "Switch / Network Doctor — Austco Site Doctor" }] }),
  component: Page,
});

function Page() {
  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  useEffect(() => { runFullAustcoDiagnosis(siteConfig, undefined, 0).then(r => setIssues(r.issues.filter(i => i.id === "Switch" || i.module.toLowerCase().includes("Switch".toLowerCase())))); }, []);
  const devices = mockDevices.filter(d => d.type === "Switch");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Layer 1–2 evidence" title="Switch / Network Doctor" description="Switch reachability, port errors, packet loss, and LLDP/MAC mapping." />
      <DeviceTable devices={devices} />
      <div className="grid gap-4 xl:grid-cols-2">
        {issues.map((iss, i) => <DiagnosticCard key={iss.id} issue={iss} rank={i + 1} />)}
      </div>
    </div>
  );
}
