import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { DeviceTable } from "@/components/DeviceTable";
import { DiagnosticCard } from "@/components/DiagnosticCard";
import { mockDevices } from "@/data/mockSite";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { useEffect, useState } from "react";
import type { DiagnosticIssue } from "@/lib/types";

export const Route = createFileRoute("/ip-app1")({
  head: () => ({ meta: [{ title: "IP-APP1 Doctor — Austco Site Doctor" }] }),
  component: Page,
});

function Page() {
  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  useEffect(() => { runFullAustcoDiagnosis(siteConfig, undefined, 0).then(r => setIssues(r.issues.filter(i => "IP-APP1" === "" || i.id === "IP-APP1" || i.module.toLowerCase().includes("IP-APP1".toLowerCase())))); }, []);
  const devices = mockDevices.filter(d => d.type === "IP-APP1");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Nursing station displays" title="IP-APP1 Doctor" description="Heartbeat freshness, session liveness, and stuck call detection on every IP-APP1." />
      <DeviceTable devices={devices} />
      <div className="grid gap-4 xl:grid-cols-2">
        {issues.map((iss, i) => <DiagnosticCard key={iss.id} issue={iss} rank={i + 1} />)}
      </div>
    </div>
  );
}
