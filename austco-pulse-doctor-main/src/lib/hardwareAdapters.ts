/**
 * Austco hardware communication adapters.
 *
 * Every function returns a `source: "mock" | "real"` flag so the UI can
 * clearly mark whether a check came from real hardware or simulated data.
 * Replace the mock branches with real protocol calls (ICMP, SNMP, HTTP,
 * Pulse Manage API, IPConnect API, INGA API, etc.) when integrations are
 * wired in. The function signatures must remain stable.
 */

export type AdapterSource = "mock" | "real";

export type PingResult = {
  ip: string;
  alive: boolean;
  latencyMs: number | null;
  packetLossPct: number;
  source: AdapterSource;
};

export type PortResult = {
  ip: string;
  open: number[];
  closed: number[];
  source: AdapterSource;
};

export type DnsResult = {
  hostname: string;
  resolved: string | null;
  expectedIp?: string;
  matchesExpected: boolean;
  source: AdapterSource;
};

export type ModulePathResult = {
  source: string;
  target: string;
  reachable: boolean;
  hops?: string[];
  detail: string;
  origin: AdapterSource;
};

export type ControllerStatus = {
  ip: string;
  online: boolean;
  heartbeatAgeSec: number;
  firmware: string;
  ackOk: boolean;
  source: AdapterSource;
};

export type IPIN8State = {
  ip: string;
  online: boolean;
  inputs: { index: number; active: boolean; heldSinceSec?: number }[];
  source: AdapterSource;
};

export type IPAPP1Status = {
  ip: string;
  online: boolean;
  sessionFreshSec: number;
  stuckCalls: number;
  source: AdapterSource;
};

export type SignalLightStatus = {
  ip: string;
  online: boolean;
  outputCommanded: boolean;
  outputActive: boolean;
  source: AdapterSource;
};

export type PulseGatewayStatus = {
  ip: string;
  online: boolean;
  servicesUp: string[];
  servicesDown: string[];
  source: AdapterSource;
};

export type IPConnectConfig = {
  ip: string;
  online: boolean;
  configValid: boolean;
  rules: number;
  source: AdapterSource;
};

export type LicenseStatus = {
  ip: string;
  online: boolean;
  licensed: boolean;
  expires: string | null;
  source: AdapterSource;
};

export type INGAStatus = {
  ip: string;
  online: boolean;
  serviceUp: boolean;
  source: AdapterSource;
};

/* ===== Adapter implementations (mock — replace with real protocol calls) ===== */

const FAULTY_IPS = new Set(["10.20.4.22", "10.20.7.50"]); // Controller West, GSL East

export async function checkPing(ip: string): Promise<PingResult> {
  // Real Austco integration goes here (ICMP / `net-snmp` reachability).
  await delay(60);
  if (FAULTY_IPS.has(ip)) {
    return { ip, alive: true, latencyMs: 38, packetLossPct: 4.2, source: "mock" };
  }
  return { ip, alive: true, latencyMs: 1 + Math.random() * 4, packetLossPct: 0, source: "mock" };
}

export async function checkPorts(ip: string, ports: number[]): Promise<PortResult> {
  // Real Austco integration goes here (TCP probe on expected service ports).
  await delay(80);
  if (FAULTY_IPS.has(ip)) {
    return { ip, open: ports.slice(0, Math.max(0, ports.length - 1)), closed: ports.slice(-1), source: "mock" };
  }
  return { ip, open: ports, closed: [], source: "mock" };
}

export async function resolveDns(hostname: string, expectedIp?: string): Promise<DnsResult> {
  // Real Austco integration goes here (DNS lookup against site DNS server).
  await delay(40);
  const map: Record<string, string> = {
    "pulse.austco.local": "10.20.1.12",
    "ipconnect.austco.local": "10.20.1.20",
    "license.austco.local": "10.20.1.21",
    "inga.austco.local": "10.20.1.22",
    "manage.austco.local": "10.20.1.23",
  };
  const resolved = map[hostname] ?? null;
  return {
    hostname,
    resolved,
    expectedIp,
    matchesExpected: !expectedIp || resolved === expectedIp,
    source: "mock",
  };
}

export async function checkModulePath(source: string, target: string): Promise<ModulePathResult> {
  // Real Austco integration goes here (probe module-to-module connectivity).
  await delay(70);
  // Simulate the known break: Pulse Gateway → Controller West Wing
  const broken = source === "Pulse Gateway" && target === "Controller West Wing";
  return {
    source,
    target,
    reachable: !broken,
    hops: [source, "Core Switch", "East Wing Switch", target],
    detail: broken
      ? "Module path established at L3, but application handshake never completed."
      : "Module path verified end-to-end.",
    origin: "mock",
  };
}

export async function readControllerStatus(controllerIp: string): Promise<ControllerStatus> {
  // Real Austco integration goes here (controller heartbeat / ack telemetry).
  await delay(60);
  if (controllerIp === "10.20.4.22") {
    return { ip: controllerIp, online: true, heartbeatAgeSec: 42, firmware: "4.37", ackOk: false, source: "mock" };
  }
  return { ip: controllerIp, online: true, heartbeatAgeSec: 3, firmware: "4.37", ackOk: true, source: "mock" };
}

export async function readIPIN8State(ipin8Ip: string): Promise<IPIN8State> {
  // Real Austco integration goes here (IP-IN8 input snapshot).
  await delay(50);
  if (ipin8Ip === "10.20.5.40") {
    return {
      ip: ipin8Ip, online: true, source: "mock",
      inputs: [
        { index: 1, active: false }, { index: 2, active: false },
        { index: 3, active: true, heldSinceSec: 2040 },
        { index: 4, active: false },
      ],
    };
  }
  return { ip: ipin8Ip, online: true, source: "mock", inputs: [{ index: 1, active: false }] };
}

export async function readIPAPP1Status(ipapp1Ip: string): Promise<IPAPP1Status> {
  // Real Austco integration goes here (IP-APP1 session / stuck-call query).
  await delay(50);
  if (ipapp1Ip === "10.20.6.30") {
    return { ip: ipapp1Ip, online: true, sessionFreshSec: 184, stuckCalls: 2, source: "mock" };
  }
  return { ip: ipapp1Ip, online: true, sessionFreshSec: 2, stuckCalls: 0, source: "mock" };
}

export async function readSignalLightStatus(signalLightIp: string): Promise<SignalLightStatus> {
  // Real Austco integration goes here (signal-light output state probe).
  await delay(50);
  if (signalLightIp === "10.20.7.50") {
    return { ip: signalLightIp, online: true, outputCommanded: true, outputActive: false, source: "mock" };
  }
  return { ip: signalLightIp, online: true, outputCommanded: false, outputActive: false, source: "mock" };
}

export async function readPulseGatewayStatus(gatewayIp: string): Promise<PulseGatewayStatus> {
  // Real Austco integration goes here (Pulse Gateway services snapshot).
  await delay(70);
  return {
    ip: gatewayIp, online: true,
    servicesUp: ["Core", "Event Processing", "Device Comm", "App Comm", "Database", "Queue Processor"],
    servicesDown: [],
    source: "mock",
  };
}

export async function readIPConnectConfig(ipconnectIp: string): Promise<IPConnectConfig> {
  // Real Austco integration goes here (IPConnect REST/admin endpoint).
  await delay(60);
  return { ip: ipconnectIp, online: true, configValid: true, rules: 47, source: "mock" };
}

export async function readLicenseStatus(licenseIp: string): Promise<LicenseStatus> {
  // Real Austco integration goes here (license server query).
  await delay(50);
  return { ip: licenseIp, online: true, licensed: true, expires: "2027-01-31", source: "mock" };
}

export async function readINGAStatus(ingaIp: string): Promise<INGAStatus> {
  // Real Austco integration goes here (INGA service status).
  await delay(50);
  return { ip: ingaIp, online: true, serviceUp: true, source: "mock" };
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }