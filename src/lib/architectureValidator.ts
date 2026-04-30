/**
 * Tacera / Pulse architecture validator.
 *
 * Encodes the real Austco deployment rules:
 *   - Authoritative PuGa holds DNS for all Tacera services.
 *   - Proxy PuGa instances live on ACS / private VLANs and serve the
 *     device-side eth1 IP for pulse.austco.local.
 *   - DNS must resolve to the correct NIC for the device's VLAN scope.
 *   - Modules must be on the right VM type, install checklist completed.
 *   - Pulse Devices need Pulse Manage + PuGa + Device Services + License.
 *
 * Pure logic — does not touch the network. Real DNS lookups happen in
 * `hardwareAdapters.resolveDnsForVlan` and feed into this validator.
 */

import type {
  DiagnosisRequest, DnsEntry, PugaInstance, ServerInterface,
  InstalledModule, PulseDevice, ModuleRole,
} from "./siteDoctorApi";

export type Severity = "Critical" | "Warning" | "Info";

export type ArchitectureFinding = {
  id: string;
  severity: Severity;
  area:
    | "Deployment"
    | "Authoritative PuGa DNS"
    | "Proxy PuGa DNS"
    | "Server NIC"
    | "Module Dependency"
    | "Pulse Device Dependency"
    | "Install Checklist";
  title: string;
  detail: string;
  evidence: string[];
  fix: string[];
};

export type DnsRowResult = {
  entry: DnsEntry;
  resolvesAs: string | null;     // what real DNS returns for that scope
  resolvedNic: "eth0" | "eth1" | null;
  ok: boolean;
  reason: string;
};

export type ModuleMatrixRow = {
  module: InstalledModule;
  hostExists: boolean;
  vmTypeMatches: boolean;
  detail: string;
  ok: boolean;
};

export type DeviceDependencyRow = {
  device: PulseDevice;
  servingPuga: PugaInstance | null;
  pugaOnDeviceVlan: boolean;
  missingDeps: ModuleRole[];
  ok: boolean;
  detail: string;
};

export type ArchitectureReport = {
  deploymentType: string;
  authoritativePugaIp: string;
  authoritativeDns: DnsRowResult[];
  proxyDns: DnsRowResult[];
  serverNicMap: ServerInterface[];
  moduleMatrix: ModuleMatrixRow[];
  deviceDependencies: DeviceDependencyRow[];
  installChecklist: { item: string; ok: boolean }[];
  findings: ArchitectureFinding[];
};

/* ---------- helpers ---------- */

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr || 24);
  const toInt = (s: string) => s.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}

/**
 * Resolve `pulse.austco.local` (or any hostname) for a given VLAN scope by
 * picking the DNS entry whose `scopeVlan` contains the asking IP. This is
 * the in-app simulation of real DNS — replaced by `resolveDnsForVlan` when
 * real adapters are wired in.
 */
export function resolveForScope(
  hostname: string, askingIp: string, dnsMap: DnsEntry[],
): DnsEntry | null {
  const candidates = dnsMap.filter((d) => d.hostname === hostname);
  return candidates.find((d) => ipInCidr(askingIp, d.scopeVlan)) ?? candidates[0] ?? null;
}

/* ---------- main validator ---------- */

export function validateArchitecture(req: DiagnosisRequest): ArchitectureReport {
  const findings: ArchitectureFinding[] = [];
  const dnsMap = req.dnsMap ?? [];
  const proxies = req.proxyPulseGateways ?? [];
  const serverIfs = req.serverInterfaces ?? [];
  const modules = req.installedModules ?? [];
  const devices = req.pulseDevices ?? [];

  /* 1. Authoritative PuGa must exist + must hold pulse.austco.local */
  const auth = proxies.find((p) => p.role === "Authoritative");
  if (!auth) {
    findings.push({
      id: "no-auth-puga", severity: "Critical", area: "Deployment",
      title: "No Authoritative Pulse Gateway declared",
      detail: "Every Tacera deployment requires exactly one authoritative PuGa that owns DNS for all Tacera services.",
      evidence: [`proxies=${proxies.length}`, `authoritative=0`],
      fix: ["Designate one PuGa as Authoritative.", "Move all Tacera DNS records to the authoritative PuGa."],
    });
  }
  if (auth && req.authoritativePulseGatewayIp && auth.ip !== req.authoritativePulseGatewayIp) {
    findings.push({
      id: "auth-ip-mismatch", severity: "Warning", area: "Deployment",
      title: "Authoritative PuGa IP mismatch",
      detail: `Declared authoritativePulseGatewayIp=${req.authoritativePulseGatewayIp}, but instance ${auth.name} has ip=${auth.ip}.`,
      evidence: [`declared=${req.authoritativePulseGatewayIp}`, `instance=${auth.ip}`],
      fix: ["Reconcile authoritativePulseGatewayIp with the actual PuGa instance IP."],
    });
  }

  /* 2. DNS map — split by authoritative vs proxy scope */
  const authDns: DnsRowResult[] = [];
  const proxyDns: DnsRowResult[] = [];

  for (const e of dnsMap) {
    const servingPuga = proxies.find((p) => p.name === e.servedBy);
    const expectedNicMatchesPuga = servingPuga ? servingPuga.nic === e.expectedNic : true;
    // Simulated resolution: assume real DNS returns expectedIp/expectedNic for now.
    // Real adapter will overwrite resolvesAs.
    const row: DnsRowResult = {
      entry: e,
      resolvesAs: e.expectedIp,
      resolvedNic: e.expectedNic,
      ok: expectedNicMatchesPuga,
      reason: expectedNicMatchesPuga
        ? "Resolution matches expected NIC and IP for VLAN scope."
        : `Serving PuGa ${e.servedBy} uses ${servingPuga?.nic}, but DNS expects ${e.expectedNic}.`,
    };
    if (servingPuga?.role === "Authoritative") authDns.push(row);
    else proxyDns.push(row);

    if (!row.ok) {
      findings.push({
        id: `dns-nic-${e.hostname}-${e.scopeVlan}`,
        severity: "Critical",
        area: servingPuga?.role === "Proxy" ? "Proxy PuGa DNS" : "Authoritative PuGa DNS",
        title: `Wrong NIC for ${e.hostname} on ${e.scopeVlan}`,
        detail: `${e.hostname} resolves on the wrong NIC for VLAN ${e.scopeVlan}. Devices on this VLAN should reach a local PuGa proxy, not the integration LAN PuGa.`,
        evidence: [`expected_ip=${e.expectedIp}`, `expected_nic=${e.expectedNic}`, `served_by=${e.servedBy}`],
        fix: [
          "Update DNS so pulse.austco.local on this VLAN resolves to the local PuGa proxy eth1 IP.",
          "Confirm the proxy PuGa's eth1 is on the device VLAN.",
          "Re-run trace from a Pulse Device on this VLAN.",
        ],
      });
    }
  }

  /* 2b. Every device VLAN must have a pulse.austco.local entry */
  for (const p of proxies) {
    const hasPulseForVlan = dnsMap.some(
      (d) => d.hostname === "pulse.austco.local" && d.scopeVlan === p.vlan,
    );
    if (!hasPulseForVlan) {
      findings.push({
        id: `dns-missing-${p.vlan}`, severity: "Critical", area: "Proxy PuGa DNS",
        title: `pulse.austco.local missing for VLAN ${p.vlan}`,
        detail: `${p.name} serves VLAN ${p.vlan} but no DNS entry maps pulse.austco.local for that scope.`,
        evidence: [`puga=${p.name}`, `vlan=${p.vlan}`],
        fix: [
          `Add pulse.austco.local → ${p.ip} (NIC ${p.nic}) for scope ${p.vlan}.`,
          "Validate from a device on that VLAN with nslookup.",
        ],
      });
    }
  }

  /* 3. Server NIC sanity — every PuGa proxy needs eth1 on its VLAN */
  for (const p of proxies.filter((x) => x.role === "Proxy")) {
    const eth1 = serverIfs.find((s) => s.server === p.name && s.nic === "eth1");
    if (!eth1) {
      findings.push({
        id: `nic-no-eth1-${p.name}`, severity: "Critical", area: "Server NIC",
        title: `${p.name} has no eth1 declared`,
        detail: "Proxy PuGa instances must have an eth1 on the device VLAN they serve.",
        evidence: [`puga=${p.name}`, `vlan=${p.vlan}`],
        fix: [`Add an eth1 interface to ${p.name} on ${p.vlan}.`],
      });
    } else if (!ipInCidr(eth1.ip, p.vlan)) {
      findings.push({
        id: `nic-eth1-vlan-${p.name}`, severity: "Critical", area: "Server NIC",
        title: `${p.name} eth1 not on its served VLAN`,
        detail: `${p.name} eth1=${eth1.ip} is outside ${p.vlan}.`,
        evidence: [`eth1_ip=${eth1.ip}`, `served_vlan=${p.vlan}`],
        fix: [`Re-IP eth1 of ${p.name} into ${p.vlan}.`],
      });
    }
  }

  /* 4. Module matrix */
  const moduleMatrix: ModuleMatrixRow[] = modules.map((m) => {
    const hostExists = serverIfs.some((s) => s.server === m.host) || proxies.some((p) => p.name === m.host);
    const vmTypeMatches = req.deploymentType ? m.expectedVmType === req.deploymentType || req.deploymentType === "Multi-PuGa" : true;
    const ok = hostExists && vmTypeMatches;
    return {
      module: m, hostExists, vmTypeMatches, ok,
      detail: !hostExists
        ? `Host ${m.host} not declared in serverInterfaces or proxyPulseGateways.`
        : !vmTypeMatches
          ? `Module expects VM type ${m.expectedVmType}, deployment is ${req.deploymentType}.`
          : `On ${m.host} (${m.expectedVmType}).`,
    };
  });
  for (const r of moduleMatrix.filter((x) => !x.ok)) {
    findings.push({
      id: `module-${r.module.role}`, severity: "Warning", area: "Module Dependency",
      title: `${r.module.role} placement issue`,
      detail: r.detail, evidence: [`host=${r.module.host}`, `vm=${r.module.expectedVmType}`],
      fix: ["Confirm module is installed on the correct VM type per Austco deployment guide."],
    });
  }

  /* 5. Pulse device dependency check */
  const deviceDependencies: DeviceDependencyRow[] = devices.map((d) => {
    const servingPuga = proxies.find((p) => p.name === d.dnsTarget) ?? null;
    const pugaOnDeviceVlan = servingPuga ? ipInCidr(servingPuga.ip, d.vlan) || servingPuga.vlan === d.vlan : false;
    const installedRoles = new Set(modules.map((m) => m.role));
    const missingDeps = d.dependsOn.filter((r) => !installedRoles.has(r));
    const ok = !!servingPuga && pugaOnDeviceVlan && missingDeps.length === 0;
    return {
      device: d, servingPuga, pugaOnDeviceVlan, missingDeps, ok,
      detail: !servingPuga
        ? `Device DNS target ${d.dnsTarget} not found.`
        : !pugaOnDeviceVlan
          ? `Device VLAN ${d.vlan} does not match serving PuGa VLAN ${servingPuga.vlan}. Wrong PuGa for device-side path.`
          : missingDeps.length
            ? `Missing module dependencies: ${missingDeps.join(", ")}.`
            : `Reaches ${servingPuga.name} on ${d.vlan} with all dependencies installed.`,
    };
  });
  for (const r of deviceDependencies.filter((x) => !x.ok)) {
    findings.push({
      id: `device-${r.device.name}`, severity: "Critical", area: "Pulse Device Dependency",
      title: `Pulse Device dependency failure: ${r.device.name}`,
      detail: r.detail,
      evidence: [
        `device=${r.device.name}`, `vlan=${r.device.vlan}`, `dns_target=${r.device.dnsTarget}`,
        `missing=${r.missingDeps.join("|") || "none"}`,
      ],
      fix: [
        "Confirm Pulse Device DNS points to the correct local PuGa proxy.",
        "Verify Pulse Manage, Pulse Device Services, and License Server are reachable from device VLAN.",
        "Re-run trace from the device after correction.",
      ],
    });
  }

  /* 6. Install checklist */
  const cl = req.installChecklist;
  const checklist = cl ? [
    { item: "Patched", ok: cl.patched },
    { item: "File Integrity Scan", ok: cl.fileIntegrityScan },
    { item: "Time / NTP / DNS", ok: cl.timeNtpDns },
    { item: "Modules installed", ok: cl.modulesInstalled },
    { item: "Licensed", ok: cl.licensed },
    { item: "SSL Cert Updated", ok: cl.sslCertUpdated },
    { item: "InGa App Properties has IPC eth0", ok: cl.ingaAppPropertiesHasIpcEth0 },
    { item: "IPConnect .ccp reachable", ok: cl.ipconnectCcpReachable },
  ] : [];
  for (const c of checklist.filter((x) => !x.ok)) {
    findings.push({
      id: `chk-${c.item}`, severity: "Warning", area: "Install Checklist",
      title: `Install step incomplete: ${c.item}`,
      detail: "Install order: Patch → File Integrity → Time/NTP/DNS → Modules → License → SSL Cert.",
      evidence: [c.item], fix: [`Complete ${c.item} on the affected server and re-validate.`],
    });
  }

  return {
    deploymentType: req.deploymentType ?? "Standalone",
    authoritativePugaIp: auth?.ip ?? req.authoritativePulseGatewayIp ?? "—",
    authoritativeDns: authDns,
    proxyDns,
    serverNicMap: serverIfs,
    moduleMatrix,
    deviceDependencies,
    installChecklist: checklist,
    findings,
  };
}