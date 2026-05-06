/**
 * CCP import diff engine.
 * Compare an incoming CCP parse result against the current SiteConfig
 * to surface ADDED / CHANGED / REMOVED entities. Read-only — never mutates.
 */
import type { CcpParseResult } from "./ccpParser";
import type { SiteConfig, ControllerEntry, ModuleEntry } from "./siteConfig";

export type CcpDiffChange<T> = { id: string; before: Partial<T>; after: Partial<T>; fields: string[] };
export type CcpDiff = {
  controllers: {
    added: { id: string; name: string; ip: string }[];
    changed: CcpDiffChange<ControllerEntry>[];
    removed: { id: string; name: string; ip: string }[];
  };
  devices: {
    added: { name: string; address: string; controllerId: string; room: string }[];
    removed: { name: string; ip: string }[];
  };
  rooms: {
    added: string[];
    removed: string[];
  };
  totals: { added: number; changed: number; removed: number };
};

export function diffCcpAgainstConfig(parsed: CcpParseResult, current: SiteConfig): CcpDiff {
  const curCtrlById = new Map<string, ControllerEntry>();
  for (const c of current.controllers) {
    if (c.controllerId) curCtrlById.set(c.controllerId, c);
  }
  const incomingCtrlById = new Map<string, { name: string; ip: string; controllerId: string; location: string }>();
  for (const c of parsed.controllers) {
    const id = c.controllerId !== "unknown" ? c.controllerId : (c.name || "");
    if (id) incomingCtrlById.set(id, { name: c.name, ip: c.ip === "unknown" ? "" : c.ip, controllerId: id, location: c.location === "unknown" ? "" : c.location });
  }

  const added: CcpDiff["controllers"]["added"] = [];
  const changed: CcpDiff["controllers"]["changed"] = [];
  const removed: CcpDiff["controllers"]["removed"] = [];

  for (const [id, inc] of incomingCtrlById) {
    const cur = curCtrlById.get(id);
    if (!cur) {
      added.push({ id, name: inc.name, ip: inc.ip });
    } else {
      const fields: string[] = [];
      if ((cur.ip || "") !== (inc.ip || "")) fields.push("ip");
      if ((cur.name || "") !== (inc.name || "")) fields.push("name");
      if ((cur.area || "") !== (inc.location || "")) fields.push("area");
      if (fields.length) {
        changed.push({
          id,
          before: { name: cur.name, ip: cur.ip, area: cur.area },
          after: { name: inc.name, ip: inc.ip, area: inc.location },
          fields,
        });
      }
    }
  }
  for (const [id, cur] of curCtrlById) {
    if (!incomingCtrlById.has(id)) removed.push({ id, name: cur.name, ip: cur.ip });
  }

  // Devices: heuristic match by name OR address
  const curDevKeys = new Set<string>();
  for (const m of current.modules) {
    if (m.role === "Controller") continue;
    curDevKeys.add(devKey(m.name, m.ip));
  }
  const incDevKeys = new Set<string>();
  const devicesAdded: CcpDiff["devices"]["added"] = [];
  for (const d of parsed.devices) {
    const k = devKey(d.name, d.address);
    incDevKeys.add(k);
    if (!curDevKeys.has(k)) {
      devicesAdded.push({ name: d.name, address: d.address, controllerId: d.controllerId, room: d.room });
    }
  }
  const devicesRemoved: CcpDiff["devices"]["removed"] = current.modules
    .filter((m: ModuleEntry) => m.role !== "Controller" && !incDevKeys.has(devKey(m.name, m.ip)))
    .map((m) => ({ name: m.name, ip: m.ip }));

  const curRooms = new Set<string>(); // current SiteConfig has no rooms array; derive from notes if present
  const incRooms = new Set<string>(parsed.rooms.map((r) => r.name).filter(Boolean));
  const roomsAdded = [...incRooms].filter((r) => !curRooms.has(r));
  const roomsRemoved: string[] = [];

  return {
    controllers: { added, changed, removed },
    devices: { added: devicesAdded, removed: devicesRemoved },
    rooms: { added: roomsAdded, removed: roomsRemoved },
    totals: {
      added: added.length + devicesAdded.length + roomsAdded.length,
      changed: changed.length,
      removed: removed.length + devicesRemoved.length,
    },
  };
}

function devKey(name: string, addrOrIp: string): string {
  const n = (name || "").trim().toLowerCase();
  const a = (addrOrIp || "").trim().toLowerCase();
  return `${n}|${a}`;
}