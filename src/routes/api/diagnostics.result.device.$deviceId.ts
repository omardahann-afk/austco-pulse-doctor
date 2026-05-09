import { createFileRoute } from "@tanstack/react-router";

const BACKEND = (process.env.MONITOR_BACKEND_URL || process.env.BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

export const Route = createFileRoute("/api/diagnostics/result/device/$deviceId")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        try {
          const upstream = await fetch(`${BACKEND}/api/diagnostics/result/device/${encodeURIComponent(params.deviceId)}`, { method: "POST" });
          const text = await upstream.text();
          return new Response(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
        } catch (error) {
          return Response.json({ ok: false, reason: "proxy_error", message: error instanceof Error ? error.message : String(error) }, { status: 502 });
        }
      },
    },
  },
});
