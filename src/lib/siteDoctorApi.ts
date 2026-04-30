export type VlanInput = { name: string; cidr: string };
export type NicInput = { ip: string; purpose: string };
export type KnownDeviceInput = { name: string; ip: string; type: string };

export type DeploymentType = "Standalone" | "Redundant Pair" | "Floor Controller" | "Integration Server Big" | "Multi-PuGa";

export type PugaInstance = {
  name: string;
  role: "Authoritative" | "Proxy";
  ip: string;             // device-side IP (eth1) for proxies, integration LAN IP for authoritative
  nic: "eth0" | "eth1";   // which NIC pulse.austco.local should resolve to here
  vlan: string;           // VLAN/subnet this PuGa serves
};

export type DnsEntry = {
  hostname: string;       // e.g. pulse.austco.local
  expectedIp: string;     // e.g. 10.1.3.250 (proxy) or 192.168.1.211 (authoritative)
  expectedNic: "eth0" | "eth1";
  servedBy: string;       // PuGa instance name responsible
  scopeVlan: string;      // VLAN/subnet this DNS answer applies to
};

export type ServerInterface = {
  server: string;         // e.g. "Pulse Gateway VM"
  nic: "eth0" | "eth1";
  ip: string;
  vlan: string;
  purpose: "Integration LAN" | "Austco Private / Device VLAN" | "Management" | "ACS";
};

export type ModuleRole =
  | "Authoritative Pulse Gateway"
  | "Proxy Pulse Gateway"
  | "IPConnect"
  | "INGA"
  | "License Server"
  | "Pulse Manage"
  | "Pulse Device Services"
  | "Pulse Insights / PostgreSQL"
  | "Auth / Mobile Gateway"
  | "HL7 / RTLS"
  | "Controller"
  | "IP-APP1"
  | "IP-APP2"
  | "Touchpoint"
  | "Nurse Station"
  | "Display Driver"
  | "Call Point";

export type InstalledModule = {
  role: ModuleRole;
  host: string;             // VM/host name
  expectedVmType: DeploymentType;
};

export type InstallChecklist = {
  patched: boolean;
  fileIntegrityScan: boolean;
  timeNtpDns: boolean;
  modulesInstalled: boolean;
  licensed: boolean;
  sslCertUpdated: boolean;
  ingaAppPropertiesHasIpcEth0: boolean;
  ipconnectCcpReachable: boolean;
};

export type PulseDevice = {
  name: string;
  ip: string;
  vlan: string;
  dnsTarget: string;        // PuGa instance name device's DNS points to
  dependsOn: ModuleRole[];  // e.g. ["Pulse Manage","Authoritative Pulse Gateway","Pulse Device Services","License Server"]
};

export type ControllerEntry = {
  name: string;
  ip: string;
  vlan: string;
};

export type CallPointEntry = {
  name: string;            // e.g. "Room 230 Call Point"
  controller: string;      // controller name
  inputIndex: number;
  expectedOutputGroup: string;
  expectedSignalLight: string; // signal light/zone IP
  expectedDisplay: string;     // IP-APP1 IP
};

export type DiagnosisRequest = {
  name: string;
  vlans: VlanInput[];
  serverNics: { primary: NicInput[]; secondary: NicInput[] };
  virtualIp: string | null;
  knownDevices: KnownDeviceInput[];
  // Architecture fields (Tacera/Pulse rules)
  deploymentType?: DeploymentType;
  authoritativePulseGatewayIp?: string;
  proxyPulseGateways?: PugaInstance[];
  dnsMap?: DnsEntry[];
  serverInterfaces?: ServerInterface[];
  installedModules?: InstalledModule[];
  installChecklist?: InstallChecklist;
  pulseDevices?: PulseDevice[];
  controllers?: ControllerEntry[];
  callPoints?: CallPointEntry[];
};

export type ScannedDevice = {
  ip: string;
  alive?: boolean;
  latency?: number | null;
  ports?: number[];
  vlan?: string;
  name?: string;
  type?: string;
  role?: string;
};

export type TruthChainStep = { step: string; ok: boolean };
export type Issue = { title: string; severity: string };

export type DiagnosisResponse = {
  site: string;
  devices: ScannedDevice[];
  truth: { chain: TruthChainStep[]; conclusion: string };
  issues: Issue[];
  conclusion: string;
};

const STORAGE_KEY = "austco.backendUrl";
export const DEFAULT_BACKEND_URL = "http://localhost:5050/api/diagnosis";

export function getBackendUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BACKEND_URL;
  return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_BACKEND_URL;
}

export function setBackendUrl(url: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, url);
}

export async function runDiagnosis(
  payload: DiagnosisRequest,
  url: string = getBackendUrl(),
): Promise<DiagnosisResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Backend returned ${res.status} ${res.statusText}`);
  return (await res.json()) as DiagnosisResponse;
}

export const DEFAULT_PAYLOAD: DiagnosisRequest = {
  name: "Site Name",
  vlans: [
    { name: "Server VLAN", cidr: "10.20.1.0/24" },
    { name: "Controller VLAN", cidr: "10.20.4.0/24" },
    { name: "Display VLAN", cidr: "10.20.6.0/24" },
  ],
  serverNics: {
    primary: [
      { ip: "10.20.1.10", purpose: "LAN" },
      { ip: "10.20.4.10", purpose: "Austco Network" },
    ],
    secondary: [
      { ip: "10.20.1.11", purpose: "LAN" },
      { ip: "10.20.4.11", purpose: "Austco Network" },
    ],
  },
  virtualIp: "10.20.1.12",
  knownDevices: [
    { name: "Controller-East", ip: "10.20.4.50", type: "Controller" },
    { name: "IP-APP1-East", ip: "10.20.6.30", type: "IP-APP1" },
    { name: "IP-IN8 Access Control", ip: "10.20.5.40", type: "IP-IN8" },
  ],
};