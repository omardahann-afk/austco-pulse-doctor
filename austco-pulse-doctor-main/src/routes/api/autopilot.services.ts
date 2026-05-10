import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_BACKEND = "http://127.0.0.1:3001";
function backend() {
  return (process.env.MONITOR_BACKEND_URL || process.env.BACKEND_URL || DEFAULT_BACKEND).replace(/\/$/, "");
}

async function proxy(request: Request, suffix = "") {
  const url = `${backend()}/api/autopilot/services${suffix}`;
  const init: RequestInit = { method: request.method, headers: { "Content-Type": "application/json" } };
  if (request.method !== "GET" && request.method !== "DELETE") {
    init.body = await request.text();
  }
  const r = await fetch(url, init);
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/autopilot/services")({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
    },
  },
});