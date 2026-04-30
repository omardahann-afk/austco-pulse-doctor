import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { EventTimeline } from "@/components/EventTimeline";
import { mockEvents } from "@/data/mockSite";
export const Route = createFileRoute("/events")({ head: () => ({ meta: [{ title: "Event Timeline — Austco Site Doctor" }] }), component: () => (
  <div className="space-y-6">
    <PageHeader eyebrow="Active · Cancel · Output · Ack · Heartbeat" title="Event Timeline" description="Every event observed during the current diagnostic window." />
    <EventTimeline events={mockEvents} />
  </div>
)});
