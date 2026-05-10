import { createFileRoute } from "@tanstack/react-router";

const BACKEND = (process.env.MONITOR_BACKEND_URL || process.env.BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

export const Route = createFileRoute("/api/evidence/snapshots")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const upstream = await fetch(`${BACKEND}/api/evidence/snapshots${url.search}`);
          const text = await upstream.text();
          return new Response(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
        } catch (error) {
          return Response.json({ ok: false, reason: "proxy_error", message: error instanceof Error ? error.message : String(error) }, { status: 502 });
        }
      },
      POST: async ({ request }) => {
        try {
          const body = await request.text();
          const upstream = await fetch(`${BACKEND}/api/evidence/snapshots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          const text = await upstream.text();
          return new Response(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
        } catch (error) {
          return Response.json({ ok: false, reason: "proxy_error", message: error instanceof Error ? error.message : String(error) }, { status: 502 });
        }
      },
    },
  },
});