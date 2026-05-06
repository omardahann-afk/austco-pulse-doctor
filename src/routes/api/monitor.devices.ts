import { createFileRoute } from "@tanstack/react-router";

import { getMonitorRegistry, saveMonitorDevice } from "@/server/monitor-registry.server";

export const Route = createFileRoute("/api/monitor/devices")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = await getMonitorRegistry();
          return Response.json(payload);
        } catch (error) {
          return Response.json(
            { ok: false, message: error instanceof Error ? error.message : String(error) },
            { status: 502 },
          );
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const payload = await saveMonitorDevice(body);
          return Response.json(payload);
        } catch (error) {
          return Response.json(
            { ok: false, message: error instanceof Error ? error.message : String(error) },
            { status: 502 },
          );
        }
      },
    },
  },
});