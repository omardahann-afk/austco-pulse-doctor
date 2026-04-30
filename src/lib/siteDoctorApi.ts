export type VlanInput = { name: string; cidr: string };
export type NicInput = { ip: string; purpose: string };
export type KnownDeviceInput = { name: string; ip: string; type: string };

export type DiagnosisRequest = {
  name: string;
  vlans: VlanInput[];
  serverNics: { primary: NicInput[]; secondary: NicInput[] };
  virtualIp: string | null;
  knownDevices: KnownDeviceInput[];
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