import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { SystemMap } from "@/components/SystemMap";
import { mockDevices } from "@/data/mockSite";
export const Route = createFileRoute("/site-map")({ head: () => ({ meta: [{ title: "Live Site Map — Austco Site Doctor" }] }), component: () => (
  <div className="space-y-6">
    <PageHeader eyebrow="Topology" title="Live Site Map" description="The full Austco signal chain from technician laptop to signal light. Failed paths glow red." />
    <SystemMap devices={mockDevices} />
  </div>
)});
