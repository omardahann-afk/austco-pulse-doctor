import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { DeviceTable } from "@/components/DeviceTable";
import { DiagnosticCard } from "@/components/DiagnosticCard";
import { mockDevices } from "@/data/mockSite";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { useEffect, useState } from "react";
import type { DiagnosticIssue } from "@/lib/types";

export const Route = createFileRoute("/ip-in8")({
  head: () => ({ meta: [{ title: "IP-IN8 Input Doctor — Austco Site Doctor" }] }),
  component: Page,
});

function Page() {
  const [issues, setIssues] = useState<DiagnosticIssue[]>([]);
  useEffect(() => { runFullAustcoDiagnosis(siteConfig, undefined, 0).then(r => setIssues(r.issues.filter(i => "IP-IN8" === "" || i.id === "IP-IN8" || i.module.toLowerCase().includes("IP-IN8".toLowerCase())))); }, []);
  const devices = mockDevices.filter(d => d.type === "IP-IN8");
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Inputs · access control · fire interface" title="IP-IN8 Input Doctor" description="Stuck active inputs, bounce detection, and external contact correlation." />
      <DeviceTable devices={devices} />
      <div className="grid gap-4 xl:grid-cols-2">
        {issues.map((iss, i) => <DiagnosticCard key={iss.id} issue={iss} rank={i + 1} />)}
      </div>
    </div>
  );
}
