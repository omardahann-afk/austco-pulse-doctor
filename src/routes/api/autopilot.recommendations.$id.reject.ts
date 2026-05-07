import { createFileRoute } from "@tanstack/react-router";

const BACKEND = (process.env.MONITOR_BACKEND_URL || process.env.BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

export const Route = createFileRoute("/api/autopilot/recommendations/$id/reject")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const body = await request.text();
          const upstream = await fetch(
            `${BACKEND}/api/autopilot/recommendations/${encodeURIComponent(params.id)}/reject`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: body || "{}" },
          );
          const text = await upstream.text();
          return new Response(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
        } catch (error) {
          return Response.json({ ok: false, reason: "proxy_error", message: error instanceof Error ? error.message : String(error) }, { status: 502 });
        }
      },
    },
  },
});