import { createFileRoute } from "@tanstack/react-router";

import { getMonitorStatus } from "@/server/monitor-registry.server";

export const Route = createFileRoute("/api/monitor/status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = await getMonitorStatus();
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