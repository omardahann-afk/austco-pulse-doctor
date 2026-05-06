/**
 * CCP ZIP Parser — runs on the local agent.
 *
 * Real Austco/IPConnect .ccp files are ZIP archives containing site.xml,
 * jobs.xml, plugins/*.xml, ipAddress.dat, and friends. This parser unzips
 * the buffer in memory, walks every entry, and extracts plugins, endpoints
 * (host/ip/port/protocol), and any controllers/devices/rooms/zones we can
 * confidently identify in site.xml / jobs.xml. Unknown nodes are returned
 * verbatim under `unknown` so the UI can show them.
 *
 * Output shape matches the contract in the user prompt.
 */
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

const PARSER_VERSION = "ccp-zip-parser/1.0.0";

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  trimValues: true,
});

/** ZIP magic bytes: 'PK' (0x50 0x4B). */
export function isZipBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x50 && buf[1] === 0x4b;
}

function ext(p) {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i + 1).toLowerCase();
}

function classifyType(path) {
  const e = ext(path);
  if (e === "xml") return "xml";
  if (e === "dat") return "dat";
  if (e === "txt" || e === "properties" || e === "log" || e === "cfg" || e === "ini") return "text";
  if (e === "json") return "json";
  return "binary";
}

/** Walk a parsed XML object recursively and yield every leaf attribute value. */
function* walkAttrs(node, path = []) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) yield* walkAttrs(node[i], [...path, String(i)]);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@_")) {
      yield { attr: k.slice(2), value: typeof v === "string" ? v : String(v ?? ""), path };
    } else if (typeof v === "object" && v !== null) {
      yield* walkAttrs(v, [...path, k]);
    } else if (typeof v === "string" && v.length > 0) {
      yield { attr: k, value: v, path };
    }
  }
}

const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}\b/g;
const PORT_RE = /\b(\d{2,5})\b/;
const HOST_KEYS = /^(host|hostname|server|address|ip|ipaddress|broker|target|targethost|destination|peer|remote|connect|connectto|url|uri|endpoint)$/i;
const PORT_KEYS = /^(port|tcpport|udpport|listenport|brokerport|targetport|destinationport|remoteport)$/i;
const PROTO_KEYS = /^(protocol|scheme|transport)$/i;

function looksLikeHost(v) {
  if (!v) return false;
  if (IPV4_RE.test(v)) { IPV4_RE.lastIndex = 0; return true; }
  if (/^[a-z0-9][a-z0-9._-]{1,253}$/i.test(v) && /[.\-]/.test(v) && !v.endsWith(".xml")) return true;
  return false;
}

function tryParseUrl(v) {
  try {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return null;
    const u = new URL(v);
    return {
      host: u.hostname || null,
      ip: IPV4_RE.test(u.hostname || "") ? u.hostname : null,
      port: u.port ? Number(u.port) : null,
      protocol: (u.protocol || "").replace(/:$/, "").toLowerCase() || null,
    };
  } catch { return null; }
  finally { IPV4_RE.lastIndex = 0; }
}

/** Extract endpoint candidates from one parsed XML doc. */
function extractEndpointsFromXml(parsed, sourceFile, warnings) {
  const endpoints = [];
  // Bag attributes per immediate parent path so we can pair host+port siblings.
  const buckets = new Map();
  for (const item of walkAttrs(parsed)) {
    const key = item.path.join(".");
    let b = buckets.get(key);
    if (!b) { b = { host: null, ip: null, port: null, protocol: null, urls: [], rawAttrs: [] }; buckets.set(key, b); }
    b.rawAttrs.push({ attr: item.attr, value: item.value });

    // URL-style values
    const u = tryParseUrl(item.value);
    if (u && (u.host || u.port)) {
      endpoints.push({
        host: u.host, ip: u.ip, port: u.port, protocol: u.protocol,
        sourceFile, sourceAttribute: `${key}:${item.attr}`,
      });
    }
    if (HOST_KEYS.test(item.attr) && looksLikeHost(item.value) && !b.host) {
      const isIp = IPV4_RE.test(item.value); IPV4_RE.lastIndex = 0;
      b.host = item.value;
      if (isIp) b.ip = item.value;
      b._hostAttr = item.attr;
    }
    if (PORT_KEYS.test(item.attr)) {
      const m = item.value.match(PORT_RE);
      const n = m ? Number(m[1]) : NaN;
      if (Number.isFinite(n) && n > 0 && n < 65536 && !b.port) { b.port = n; b._portAttr = item.attr; }
    }
    if (PROTO_KEYS.test(item.attr) && !b.protocol) b.protocol = item.value.toLowerCase();
  }
  for (const [key, b] of buckets) {
    if (!b.host && !b.ip && !b.port) continue;
    endpoints.push({
      host: b.host, ip: b.ip, port: b.port, protocol: b.protocol,
      sourceFile, sourceAttribute: key || "(root)",
    });
  }
  // Free-text IPs in tag bodies (rare)
  return dedupeEndpoints(endpoints);

  function dedupeEndpoints(arr) {
    const seen = new Set();
    return arr.filter((e) => {
      const k = `${e.host || ""}|${e.ip || ""}|${e.port || ""}|${e.protocol || ""}|${e.sourceFile}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }
}

/** Extract a plugin manifest from a plugins/*.xml file. */
function extractPlugin(parsed, sourceFile) {
  // Common shapes: <plugin id=".." className=".." create="true">...</plugin>
  // or <Plugin .../> as root, or nested. We pull the top-level node.
  const root = parsed && typeof parsed === "object" ? parsed : {};
  const topKey = Object.keys(root).find((k) => !k.startsWith("@_") && k.toLowerCase().includes("plugin")) || Object.keys(root)[0];
  const node = topKey ? root[topKey] : root;
  if (!node || typeof node !== "object") return null;
  const attrs = {};
  const actions = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@_")) attrs[k.slice(2)] = v;
    else if (typeof v !== "object") attrs[k] = String(v);
    else if (k.toLowerCase() === "action" || k.toLowerCase() === "actions") actions[k] = v;
    else attrs[k] = "[object]"; // keep flat preview safe
  }
  const id = attrs.id || attrs.Id || attrs.ID || attrs.name || attrs.Name
          || sourceFile.split("/").pop().replace(/\.xml$/i, "");
  const className = attrs.className || attrs.classname || attrs["class-name"] || attrs.class || null;
  const createRaw = attrs.create ?? attrs.Create ?? null;
  const create = createRaw == null ? null : /^true|1|yes$/i.test(String(createRaw));
  return { id, className, create, sourceFile, attributes: attrs, actions };
}

/** Best-effort extraction of controllers/devices/rooms/zones from a parsed site.xml/jobs.xml.
 *  We do NOT invent values — only emit entities whose key fields are present. */
function extractEntitiesFromSite(parsed, sourceFile) {
  const out = { controllers: [], devices: [], rooms: [], zones: [] };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [k, v] of Object.entries(node)) {
      const lk = k.toLowerCase();
      if (Array.isArray(v) || (v && typeof v === "object")) {
        const arr = Array.isArray(v) ? v : [v];
        if (lk === "controller" || lk === "controllers") {
          for (const c of arr) {
            const a = flatAttrs(c);
            const id = a.id || a.controllerid || a.name;
            const ip = a.ip || a.address || a.host;
            if (id || ip) out.controllers.push({
              controllerId: id || "unknown",
              name: a.name || id || "unknown",
              ip: ip || "unknown",
              location: a.location || a.site || "unknown",
              sourceFile,
              confidence: id && ip ? "high" : "medium",
            });
          }
        } else if (lk === "room" || lk === "rooms" || lk === "location" || lk === "locations") {
          for (const r of arr) {
            const a = flatAttrs(r);
            const name = a.name || a.id;
            if (name) out.rooms.push({ name, path: a.path || a.location || "unknown", assignedDevices: [], sourceFile, confidence: "medium" });
          }
        } else if (lk === "device" || lk === "devices" || lk === "callpoint" || lk === "pendant") {
          for (const d of arr) {
            const a = flatAttrs(d);
            const name = a.name || a.id;
            const addr = a.address || a.ip || a.ipnetaddress;
            if (name || addr) out.devices.push({
              name: name || "unknown",
              type: a.type || lk,
              address: addr || "unknown",
              controllerId: a.controllerid || a.controller || "unknown",
              room: a.room || a.location || "unknown",
              callTypes: [],
              sourceFile,
              confidence: name && addr ? "high" : "medium",
            });
          }
        } else if (lk === "zone" || lk === "zones") {
          for (const z of arr) {
            const a = flatAttrs(z);
            const name = a.name || a.id;
            if (name) out.zones.push({ name, type: a.type || "Room", controllerId: a.controllerid || a.controller || "unknown", sourceFile, confidence: "medium" });
          }
        }
        visit(v);
      }
    }
  };
  visit(parsed);
  return out;
}

function flatAttrs(node) {
  const out = {};
  if (!node || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("@_")) out[k.slice(2).toLowerCase()] = typeof v === "string" ? v : String(v ?? "");
    else if (typeof v !== "object") out[k.toLowerCase()] = String(v);
  }
  return out;
}

/** Parse ipAddress.dat — usually a newline-delimited list of IPs and/or `name=ip`. */
function parseIpAddressDat(text, sourceFile) {
  const endpoints = [];
  if (!text) return endpoints;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith(";")) continue;
    const ips = s.match(IPV4_RE) || [];
    IPV4_RE.lastIndex = 0;
    for (const ip of ips) {
      endpoints.push({ host: ip, ip, port: null, protocol: null, sourceFile, sourceAttribute: "ipAddress.dat" });
    }
  }
  return endpoints;
}

export function parseCcpZipBuffer(buffer, { filename = "upload.ccp" } = {}) {
  const t0 = Date.now();
  const result = {
    parserStatus: "parse_failed",
    parserVersion: PARSER_VERSION,
    fileType: "ccp",
    archive: { isZip: false, internalFileCount: 0, xmlFileCount: 0, files: [] },
    plugins: [],
    endpoints: [],
    controllers: [],
    devices: [],
    rooms: [],
    zones: [],
    warnings: [],
    unknown: [],
    durationMs: 0,
    filename,
  };

  if (!isZipBuffer(buffer)) {
    result.warnings.push("Buffer is not a ZIP archive (no PK magic bytes).");
    result.durationMs = Date.now() - t0;
    return result;
  }

  let zip;
  try { zip = new AdmZip(buffer); }
  catch (err) {
    result.warnings.push(`ZIP open failed: ${err?.message || err}`);
    result.durationMs = Date.now() - t0;
    return result;
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  result.archive.isZip = true;
  result.archive.internalFileCount = entries.length;

  for (const entry of entries) {
    const path = entry.entryName;
    const type = classifyType(path);
    const fileRec = { path, size: entry.header?.size || 0, type, parsed: false, error: null };

    try {
      if (type === "xml") {
        result.archive.xmlFileCount++;
        const text = entry.getData().toString("utf8");
        let parsed;
        try { parsed = xml.parse(text); }
        catch (err) {
          fileRec.error = `XML parse: ${err?.message || err}`;
          result.warnings.push(`XML parse failed for ${path}: ${err?.message || err}`);
          result.archive.files.push(fileRec);
          continue;
        }
        fileRec.parsed = true;

        // Plugins live under plugins/*.xml
        if (/(^|\/)plugins\//i.test(path)) {
          const p = extractPlugin(parsed, path);
          if (p) result.plugins.push(p);
        }

        // site.xml / jobs.xml — try to lift entities
        if (/(^|\/)(site|jobs)\.xml$/i.test(path)) {
          const ents = extractEntitiesFromSite(parsed, path);
          result.controllers.push(...ents.controllers);
          result.devices.push(...ents.devices);
          result.rooms.push(...ents.rooms);
          result.zones.push(...ents.zones);
        }

        // Endpoints from any XML
        result.endpoints.push(...extractEndpointsFromXml(parsed, path, result.warnings));
      } else if (/ipAddress\.dat$/i.test(path)) {
        const text = entry.getData().toString("utf8");
        result.endpoints.push(...parseIpAddressDat(text, path));
        fileRec.parsed = true;
      } else if (type === "text" || type === "json") {
        // Read but don't deeply parse — surface as known/parsed=false
        fileRec.parsed = false;
      } else {
        fileRec.parsed = false;
        result.unknown.push({ path, reason: "binary or unrecognized" });
      }
    } catch (err) {
      fileRec.error = err?.message || String(err);
      result.warnings.push(`Read failed for ${path}: ${fileRec.error}`);
    }
    result.archive.files.push(fileRec);
  }

  // Dedupe endpoints across files
  const seen = new Set();
  result.endpoints = result.endpoints.filter((e) => {
    const k = `${e.host || ""}|${e.ip || ""}|${e.port || ""}|${e.protocol || ""}|${e.sourceFile}|${e.sourceAttribute}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  // Sanity: did we recognize anything CCP-shaped?
  const recognised = result.archive.xmlFileCount > 0
    || result.endpoints.length > 0
    || result.plugins.length > 0;

  result.parserStatus = recognised ? "ccp_zip_detected" : "partial";
  if (!recognised) result.warnings.push("ZIP opened but no XML/plugin/endpoint structure was found.");

  result.durationMs = Date.now() - t0;
  return result;
}