import { createFileRoute } from "@tanstack/react-router";

import { getMonitorState } from "@/server/monitor-registry.server";

export const Route = createFileRoute("/api/monitor/state")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = await getMonitorState();
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