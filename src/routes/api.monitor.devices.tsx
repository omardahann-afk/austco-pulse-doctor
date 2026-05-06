import { createFileRoute } from "@tanstack/react-router";

import { deleteMonitorDevice, getMonitorRegistry, saveMonitorDevice } from "@/server/monitor-registry.server";

const jsonHeaders = { "Content-Type": "application/json" };

export const Route = createFileRoute("/api/monitor/devices")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await getMonitorRegistry(), { headers: jsonHeaders });
        } catch (error) {
          return Response.json(
            { ok: false, reason: "agent_error", message: error instanceof Error ? error.message : String(error) },
            { status: 500, headers: jsonHeaders },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          return Response.json(await saveMonitorDevice(await request.json()), { headers: jsonHeaders });
        } catch (error) {
          return Response.json(
            { ok: false, reason: "agent_error", message: error instanceof Error ? error.message : String(error) },
            { status: 500, headers: jsonHeaders },
          );
        }
      },
      DELETE: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const id = url.searchParams.get("id")?.trim();
          if (!id) {
            return Response.json({ ok: false, reason: "invalid_request", message: "id required" }, { status: 400, headers: jsonHeaders });
          }
          return Response.json(await deleteMonitorDevice(id), { headers: jsonHeaders });
        } catch (error) {
          return Response.json(
            { ok: false, reason: "agent_error", message: error instanceof Error ? error.message : String(error) },
            { status: 500, headers: jsonHeaders },
          );
        }
      },
    },
  },
});