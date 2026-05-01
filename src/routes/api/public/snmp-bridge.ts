/**
 * /api/public/snmp-bridge
 * -----------------------
 * Stub SNMP relay. Cloudflare Workers cannot speak SNMP/UDP themselves, so
 * this endpoint either:
 *   - forwards the request to an external Node bridge specified by the
 *     `SNMP_BRIDGE_URL` env var (which must be reachable from the Worker
 *     and authenticated via `SNMP_BRIDGE_TOKEN`), OR
 *   - returns 501 with `{ ok: false, reason: "bridge_not_configured" }`
 *     so the UI surfaces "SNMP unavailable" instead of fabricating data.
 *
 * Input is validated with Zod. No SNMP polling happens here.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const SwitchInputSchema = z.object({
  name: z.string().min(1).max(120),
  ip: z.string().min(1).max(45),
  vendor: z.string().min(1).max(64).optional(),
  snmpEnabled: z.boolean(),
  snmpVersion: z.enum(["v1", "v2c"]).optional(),
  snmpCommunity: z.string().min(1).max(120).optional(),
  managementVlan: z.string().min(1).max(64).optional(),
  ports: z.array(z.any()).max(512).optional(),
});

const RequestSchema = z.object({
  switches: z.array(SwitchInputSchema).min(1).max(64),
  arpHints: z.array(z.string().min(1).max(45)).max(2048).optional(),
});

export const Route = createFileRoute("/api/public/snmp-bridge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, reason: "invalid_json" }, { status: 400 });
        }
        const parsed = RequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { ok: false, reason: "invalid_request", details: parsed.error.issues.slice(0, 5) },
            { status: 400 },
          );
        }

        const bridgeUrl = process.env.SNMP_BRIDGE_URL;
        const bridgeToken = process.env.SNMP_BRIDGE_TOKEN;
        if (!bridgeUrl) {
          return Response.json(
            {
              ok: false,
              reason: "bridge_not_configured",
              message:
                "Set SNMP_BRIDGE_URL (and optional SNMP_BRIDGE_TOKEN) to forward to a local Node SNMP bridge. " +
                "Until then, network analysis uses manual entries only.",
              switches: [],
              arp: [],
            },
            { status: 501 },
          );
        }

        try {
          const upstream = await fetch(bridgeUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}),
            },
            body: JSON.stringify(parsed.data),
          });
          const contentType = upstream.headers.get("content-type") ?? "application/json";
          const text = await upstream.text();
          return new Response(text, {
            status: upstream.status,
            headers: { "Content-Type": contentType },
          });
        } catch (err) {
          return Response.json(
            {
              ok: false,
              reason: "bridge_unreachable",
              message: err instanceof Error ? err.message : String(err),
              switches: [],
              arp: [],
            },
            { status: 502 },
          );
        }
      },
    },
  },
});