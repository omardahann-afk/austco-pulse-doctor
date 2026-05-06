import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type MonitorDevice } from "@/lib/monitorClient";
import { AddDeviceDialog } from "@/components/monitor/AddDeviceDialog";
import { useSiteConfigStore } from "@/stores/siteConfigStore";

export const Route = createFileRoute("/monitor/devices")({
  head: () => ({ meta: [
    { title: "Monitored Devices — Tacera Doctor" },
    { name: "description", content: "Register controllers, gateways, brokers and services for live polling." },
  ]}),
  component: DevicesPage,
});

function DevicesPage() {
  const devices = useSiteConfigStore((state) => state.monitoredDevices);
  const hydrating = useSiteConfigStore((state) => state.hydrating);
  const deleteMonitoredDevice = useSiteConfigStore((state) => state.deleteMonitoredDevice);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<MonitorDevice | null>(null);

  async function remove(id: string) {
    if (!confirm(`Delete device "${id}"? Probe history is also removed.`)) return;
    try {
      await deleteMonitoredDevice(id);
      toast.success("Deleted");
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Devices"
        title="Monitored Devices"
        description="Register controllers, gateways, brokers, switches and services. The agent will poll each on its own interval and stream results to /monitor."
        actions={
          <>
            <Link to="/monitor"><Button size="sm" variant="outline" className="h-8"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Live Monitor</Button></Link>
            <Button size="sm" className="h-8" onClick={() => { setEditingDevice(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add device
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Registered devices</CardTitle></CardHeader>
        <CardContent className="p-0">
          {hydrating ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : devices.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">No devices registered yet. Add your first one on the right.</div>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID / Name</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Interval</TableHead>
                    <TableHead className="w-[140px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="font-medium">{d.name || d.id}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{d.id} · {d.kind}</div>
                      </TableCell>
                      <TableCell><span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono uppercase">{d.protocol}</span></TableCell>
                      <TableCell className="font-mono text-xs">{d.url || (d.host ? `${d.host}${d.port ? ":" + d.port : ""}` : "—")}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{Math.round(d.intervalMs / 1000)}s</TableCell>
                      <TableCell className="text-right">
                         <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditingDevice(d); setDialogOpen(true); }}>Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400 hover:text-red-300" onClick={() => remove(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          )}
        </CardContent>
      </Card>

      <AddDeviceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDevice={editingDevice}
        onSaved={() => setEditingDevice(null)}
      />
    </div>
  );
}