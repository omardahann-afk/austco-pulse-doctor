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

/* ============ SIM-046: Room Controller / IPnet Router ============ */

export type IpnetDeviceType =
  | "Callpoint"
  | "Smart Callpoint"
  | "Pendant"
  | "Over Door Light"
  | "Zone Tone Sounder"
  | "Relay"
  | "Input Bridge"
  | "Presence Device"
  | "Unknown IPnet Device";

export type IpnetDeviceStatus = "Online" | "Offline" | "Fault" | "Not verified";

export type IpnetDevice = {
  name: string;
  type: IpnetDeviceType;
  address: string;            // IPnet address e.g. "1.04"
  serialNumber?: string;
  zone?: string;
  callTypes?: string[];
  portRun?: "A" | "B";        // which IPnet connector run
  status?: IpnetDeviceStatus;
};

export type RcZone        = { name: string; type: "Room" | "Group Signal" };
export type RcGroupSignal = { name: string; zones: string[]; targetOdlOrZts: string; followMeLighting?: boolean };
export type RcCallType    = { name: string; priority: number; tone: string; lightBehavior: string };
export type RcLink        = { from: string; to: string };

export type RcDeviceModel =
  | "IP-CCT" | "IP-CCT/H" | "IP-CCT-SC" | "IP-PST2" | "Other";

export type RcAuthStatus =
  | "untested"
  | "authenticated_default"     // default admin/admin worked
  | "authenticated_custom" // tech-supplied credentials worked
  | "auth_failed"
  | "auth_failed_custom"
  | "unreachable";

export type RcCredentials = {
  username: string;       // default "admin"
  password: string;       // default "admin"
  isDefault: boolean;     // true while username=admin && password=admin
  rememberForSession?: boolean; // if false, do not persist outside this run
};

export type RoomController = {
  name: string;
  ip: string;
  mac?: string;
  controllerId: string;       // must be unique site-wide
  location?: string;
  vlan: string;
  parentIpConnect?: string;
  webInterfaceUrl?: string;
  hasWebAccess?: boolean;
  model?: RcDeviceModel;
  credentials?: RcCredentials;
  authStatus?: RcAuthStatus;
  authMessage?: string;       // details from last auth attempt
  zones?: RcZone[];
  groupSignals?: RcGroupSignal[];
  callTypes?: RcCallType[];
  ipnetDevices?: IpnetDevice[];
  links?: RcLink[];
  cancelLinks?: RcLink[];
  remoteRelays?: RcLink[];
  serversConfigured?: boolean;        // Network → Servers populated
  ipnetDeviceListPopulated?: boolean;
  eventViewerText?: string;           // technician-pasted Event Viewer log
};

/** SIM-046 default credentials applied to IP-CCT / IP-PST2 family. */
export const DEFAULT_RC_CREDENTIALS: RcCredentials = {
  username: "admin",
  password: "admin",
  isDefault: true,
  rememberForSession: true,
};

export const RC_DEFAULT_CRED_MODELS: RcDeviceModel[] = [
  "IP-CCT", "IP-CCT/H", "IP-CCT-SC", "IP-PST2",
];

export function shouldAutoApplyDefaultCreds(model?: RcDeviceModel): boolean {
  return !!model && RC_DEFAULT_CRED_MODELS.includes(model);
}

import type { ServiceTarget, ServiceLogResult } from "./logEngine";
export type { ServiceTarget, ServiceLogResult };

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
  // SIM-046 Room Controller / IPnet Router doctors
  roomControllers?: RoomController[];
  // Real log collection (SSH targets handled by local site-doctor.js bridge)
  services?: ServiceTarget[];
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
  // Optional — present when the local bridge has SSH log collection enabled
  logAnalysis?: ServiceLogResult[];
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
  deploymentType: "Multi-PuGa",
  authoritativePulseGatewayIp: "192.168.1.211",
  proxyPulseGateways: [
    { name: "PuGa-Proxy-WestVLAN", role: "Proxy", ip: "10.1.3.250", nic: "eth1", vlan: "10.1.3.0/24" },
    { name: "PuGa-Authoritative",  role: "Authoritative", ip: "192.168.1.211", nic: "eth0", vlan: "192.168.1.0/24" },
  ],
  dnsMap: [
    { hostname: "pulse.austco.local", expectedIp: "10.1.3.250",   expectedNic: "eth1", servedBy: "PuGa-Proxy-WestVLAN", scopeVlan: "10.1.3.0/24" },
    { hostname: "pulse.austco.local", expectedIp: "192.168.1.211", expectedNic: "eth0", servedBy: "PuGa-Authoritative",  scopeVlan: "192.168.1.0/24" },
    { hostname: "ipconnect.austco.local", expectedIp: "10.20.1.20", expectedNic: "eth0", servedBy: "PuGa-Authoritative", scopeVlan: "10.20.1.0/24" },
    { hostname: "license.austco.local",   expectedIp: "10.20.1.21", expectedNic: "eth0", servedBy: "PuGa-Authoritative", scopeVlan: "10.20.1.0/24" },
    { hostname: "inga.austco.local",      expectedIp: "10.20.1.22", expectedNic: "eth0", servedBy: "PuGa-Authoritative", scopeVlan: "10.20.1.0/24" },
    { hostname: "manage.austco.local",    expectedIp: "10.20.1.23", expectedNic: "eth0", servedBy: "PuGa-Authoritative", scopeVlan: "10.20.1.0/24" },
  ],
  serverInterfaces: [
    { server: "PuGa-Authoritative",   nic: "eth0", ip: "192.168.1.211", vlan: "192.168.1.0/24", purpose: "Integration LAN" },
    { server: "PuGa-Proxy-WestVLAN",  nic: "eth0", ip: "192.168.1.212", vlan: "192.168.1.0/24", purpose: "Integration LAN" },
    { server: "PuGa-Proxy-WestVLAN",  nic: "eth1", ip: "10.1.3.250",    vlan: "10.1.3.0/24",    purpose: "Austco Private / Device VLAN" },
    { server: "IPConnect",            nic: "eth0", ip: "10.20.1.20",    vlan: "10.20.1.0/24",   purpose: "Integration LAN" },
    { server: "INGA",                 nic: "eth0", ip: "10.20.1.22",    vlan: "10.20.1.0/24",   purpose: "Integration LAN" },
    { server: "License Server",       nic: "eth0", ip: "10.20.1.21",    vlan: "10.20.1.0/24",   purpose: "Integration LAN" },
    { server: "Pulse Manage",         nic: "eth0", ip: "10.20.1.23",    vlan: "10.20.1.0/24",   purpose: "Integration LAN" },
  ],
  installedModules: [
    { role: "Authoritative Pulse Gateway", host: "PuGa-Authoritative",  expectedVmType: "Integration Server Big" },
    { role: "Proxy Pulse Gateway",         host: "PuGa-Proxy-WestVLAN", expectedVmType: "Standalone" },
    { role: "IPConnect",                   host: "IPConnect",           expectedVmType: "Integration Server Big" },
    { role: "INGA",                        host: "INGA",                expectedVmType: "Integration Server Big" },
    { role: "License Server",              host: "License Server",      expectedVmType: "Integration Server Big" },
    { role: "Pulse Manage",                host: "Pulse Manage",        expectedVmType: "Integration Server Big" },
    { role: "Pulse Device Services",       host: "PuGa-Authoritative",  expectedVmType: "Integration Server Big" },
  ],
  installChecklist: {
    patched: true,
    fileIntegrityScan: true,
    timeNtpDns: true,
    modulesInstalled: true,
    licensed: true,
    sslCertUpdated: false,
    ingaAppPropertiesHasIpcEth0: true,
    ipconnectCcpReachable: true,
  },
  pulseDevices: [
    {
      name: "Touchpoint-West-230", ip: "10.1.3.41", vlan: "10.1.3.0/24",
      dnsTarget: "PuGa-Proxy-WestVLAN",
      dependsOn: ["Pulse Manage", "Authoritative Pulse Gateway", "Pulse Device Services", "License Server"],
    },
    {
      name: "IP-APP1-East-Station", ip: "10.20.6.30", vlan: "10.20.6.0/24",
      dnsTarget: "PuGa-Authoritative",
      dependsOn: ["Pulse Manage", "Authoritative Pulse Gateway", "Pulse Device Services", "License Server"],
    },
  ],
  controllers: [
    { name: "Controller-East", ip: "10.20.4.21", vlan: "10.20.4.0/24" },
    { name: "Controller-West", ip: "10.1.3.22",  vlan: "10.1.3.0/24"  },
  ],
  callPoints: [
    {
      name: "Room 230 Call Point", controller: "Controller-West", inputIndex: 3,
      expectedOutputGroup: "West Wing Signal Lights",
      expectedSignalLight: "10.1.3.50", expectedDisplay: "10.20.6.30",
    },
  ],
  roomControllers: [
    {
      name: "Controller-West",
      ip: "10.1.3.22",
      mac: "00:1B:44:11:3A:B7",
      controllerId: "RC-WEST-01",
      location: "West Wing — Floor 2",
      vlan: "10.1.3.0/24",
      parentIpConnect: "IPConnect",
      webInterfaceUrl: "http://10.1.3.22/",
      hasWebAccess: true,
      model: "IP-CCT",
      credentials: { username: "admin", password: "admin", isDefault: true, rememberForSession: true },
      authStatus: "untested",
      serversConfigured: true,
      ipnetDeviceListPopulated: true,
      zones: [
        { name: "Room 230", type: "Room" },
        { name: "West Wing", type: "Group Signal" },
      ],
      groupSignals: [
        { name: "West Wing Signal Lights", zones: ["West Wing"], targetOdlOrZts: "ODL-Corridor-W", followMeLighting: false },
      ],
      callTypes: [
        { name: "Patient Call", priority: 1, tone: "Standard", lightBehavior: "Solid Green" },
        { name: "Emergency",    priority: 5, tone: "Urgent",   lightBehavior: "Flashing Red" },
      ],
      ipnetDevices: [
        { name: "Room 230 Callpoint", type: "Callpoint",        address: "1.03", zone: "Room 230", callTypes: ["Patient Call"], portRun: "A", status: "Online" },
        { name: "Room 230 Pendant",   type: "Pendant",          address: "1.04", zone: "Room 230", callTypes: ["Patient Call"], portRun: "A", status: "Online" },
        { name: "Room 230 ODL",       type: "Over Door Light",  address: "1.05", zone: "Room 230", portRun: "A", status: "Online" },
        { name: "Corridor ZTS West",  type: "Zone Tone Sounder",address: "2.01", zone: "West Wing", portRun: "B", status: "Online" },
        { name: "Relay Output 1",     type: "Relay",            address: "2.02", portRun: "B", status: "Online" },
      ],
      links: [
        { from: "Room 230 Callpoint", to: "West Wing Signal Lights" },
      ],
      cancelLinks: [
        { from: "Room 230 Callpoint", to: "Room 230" },
      ],
      remoteRelays: [],
      eventViewerText: "",
    },
  ],
};