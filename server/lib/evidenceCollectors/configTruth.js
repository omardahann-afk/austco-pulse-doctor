/**
 * Config Truth collector — pure JS, no shell. Validates the supplied
 * site/CCP-like configuration for missing references, drift between expected
 * hostnames and DNS results, and CPs/devices observed in evidence but not
 * configured.
 *
 * Inputs:
 *   siteConfig: full SiteConfig object from the frontend store
 *   networkTruth: result of networkTruth collector (used for DNS comparison)
 *   observedCpIds: optional array of CP IDs/controllers seen in logs/MQTT
 */

function safeArr(a) { return Array.isArray(a) ? a : []; }

export function collectConfigTruth({ siteConfig = {}, networkTruth = null, observedCpIds = [] }) {
  const services = safeArr(siteConfig.services);
  const modules = safeArr(siteConfig.modules);
  const controllers = safeArr(siteConfig.controllers);
  const ipin8s = safeArr(siteConfig.ipin8s);
  const displays = safeArr(siteConfig.displays);

  const issues = [];
  const findings = [];

  // 1. Hostname/IP drift between site config and DNS resolution observed in networkTruth
  if (networkTruth?.targets) {
    for (const t of networkTruth.targets) {
      if (!t.dns?.performed) continue;
      const resolved = t.dns.resolved || [];
      // Only meaningful when both a hostname and a numeric IP are configured.
      if (t.hostname && /^[0-9.]+$/.test(t.host || "") && resolved.length && !resolved.includes(t.host)) {
        issues.push({
          kind: "dns_mismatch",
          target: t.name,
          detail: `${t.hostname} resolves to [${resolved.join(", ")}] but ${t.name} is configured with host ${t.host}`,
        });
      }
    }
  }

  // 2. Required services without host
  for (const s of services) {
    if (s.required && !s.host) {
      issues.push({ kind: "service_missing_host", target: s.name, detail: `Required service '${s.name}' has no host configured` });
    }
  }

  // 3. Modules / controllers without host
  for (const m of modules) {
    if (!m.ip && !m.hostname) issues.push({ kind: "module_missing_host", target: m.name, detail: `Module '${m.name}' has no IP/hostname` });
  }
  for (const c of controllers) {
    if (!c.ip) issues.push({ kind: "controller_missing_ip", target: c.name, detail: `Controller '${c.name}' has no IP` });
  }

  // 4. Observed CPs not in config (controllers + ipin8s known)
  const knownIds = new Set([
    ...controllers.map((c) => (c.controllerId || c.id || "").toString().toLowerCase()),
    ...controllers.map((c) => (c.name || "").toLowerCase()),
    ...ipin8s.map((d) => (d.name || d.id || "").toString().toLowerCase()),
    ...displays.map((d) => (d.name || d.id || "").toString().toLowerCase()),
  ].filter(Boolean));

  const unknownCpIds = [];
  for (const cp of observedCpIds) {
    const key = String(cp || "").toLowerCase();
    if (!key) continue;
    if (!knownIds.has(key)) unknownCpIds.push(cp);
  }
  if (unknownCpIds.length) {
    issues.push({
      kind: "cp_in_evidence_not_in_config",
      detail: `${unknownCpIds.length} CP/controller IDs appear in observed evidence but are not in site config`,
      ids: unknownCpIds.slice(0, 20),
    });
  }

  // 5. Coverage findings (informational)
  findings.push({ kind: "coverage", detail: `Configured: ${services.length} services, ${modules.length} modules, ${controllers.length} controllers, ${ipin8s.length} IP-IN8s, ${displays.length} displays` });

  return {
    collectedAt: new Date().toISOString(),
    counts: {
      services: services.length, modules: modules.length, controllers: controllers.length,
      ipin8s: ipin8s.length, displays: displays.length,
    },
    issues,
    findings,
    observedCpIds: observedCpIds || [],
    unknownCpIds,
  };
}