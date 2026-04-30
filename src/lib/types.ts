export type DeviceType =
  | "Pulse Server"
  | "Primary Server"
  | "Secondary Server"
  | "Virtual IP"
  | "Controller"
  | "IP-IN8"
  | "IP-APP1"
  | "Signal Light"
  | "Zone Light"
  | "Switch"
  | "Display"
  | "Unknown";

export type HealthStatus = "Healthy" | "Warning" | "Critical" | "Offline" | "Scanning";
export type Severity = "Critical" | "Warning" | "Info";
export type Confidence = "High" | "Medium" | "Low";

export type AustcoDevice = {
  id: string;
  name: string;
  type: DeviceType;
  ip: string;
  mac?: string;
  firmware?: string;
  location?: string;
  status: HealthStatus;
  latencyMs?: number;
  packetLoss?: number;
  lastHeartbeat?: string;
  switchPort?: string;
  role?: "Active" | "Passive" | "Standalone";
  issue?: string;
};

export type AustcoEventType = "Active" | "Cancel" | "Output" | "Ack" | "Heartbeat";

export type AustcoEvent = {
  id: string;
  room: string;
  eventType: AustcoEventType;
  timestamp: string;
  sourceDevice: string;
  targetDevice?: string;
  status: "Success" | "Failed" | "Pending";
  details: string;
};

export type DiagnosticIssue = {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  affectedDevice?: string;
  affectedIp?: string;
  module: string;
  whatIsHappening: string;
  evidence: string[];
  likelyRootCause: string;
  recommendedSteps: string[];
  escalationRecommendation: string;
};

export type ModuleStatus = "Pending" | "Scanning" | "Passed" | "Warning" | "Failed";

export type DiagnosticModule = {
  id: string;
  name: string;
  description: string;
  status: ModuleStatus;
  durationMs?: number;
  findings: string[];
};

export type DiagnosticResult = {
  siteName: string;
  scanTime: string;
  summary: {
    healthy: number;
    warnings: number;
    critical: number;
    offline: number;
  };
  devices: AustcoDevice[];
  events: AustcoEvent[];
  issues: DiagnosticIssue[];
  rootCauseRanking: DiagnosticIssue[];
  modules: DiagnosticModule[];
};

export type SiteConfig = {
  siteName: string;
  technician: string;
  laptopIp: string;
  gateway: string;
  dns: string;
  serverSubnet: string;
  controllerSubnet: string;
  deviceSubnet: string;
};

export type KnowledgeArticle = {
  id: string;
  title: string;
  symptom: string;
  fix: string;
  tags: string[];
};

export type TraceStep = {
  id: string;
  label: string;
  detail: string;
  status: "Pending" | "Running" | "Passed" | "Failed";
  timestamp?: string;
};