import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { DeviceTable } from "@/components/DeviceTable";
import { DiagnosticCard } from "@/components/DiagnosticCard";
import { mockDevices } from "@/data/mockSite";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { useEffect, useState } from "react";
import type { DiagnosticIssue } from "@/lib/types";

export const Route = createFileRoute("/redundancy")({
  head: () => ({ meta: [{ title: "Redundancy Doctor — Austco Site Doctor" }] }),
  component: Page,
});

function Page() {
  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  useEffect(() => { runFullAustcoDiagnosis(siteConfig, undefined, 0).then(r => setIssues(r.issues.filter(i => i.id === "Redundancy" || i.module.toLowerCase().includes("Redundancy".toLowerCase())))); }, []);
  const devices = mockDevices.filter(d => ["Primary Server","Secondary Server","Virtual IP"].includes(d.type));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Primary / Secondary / VIP" title="Redundancy Doctor" description="Primary, secondary, VIP, replication, and split-brain detection." />
      <DeviceTable devices={devices} />
      <div className="grid gap-4 xl:grid-cols-2">
        {issues.map((iss, i) => <DiagnosticCard key={iss.id} issue={iss} rank={i + 1} />)}
      </div>
    </div>
  );
}
