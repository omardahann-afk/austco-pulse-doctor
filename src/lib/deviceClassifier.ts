import type { AustcoDevice, DeviceType, HealthStatus } from "./types";

/**
 * Classify a device into an Austco DeviceType using IP/MAC/firmware hints.
 * Real Austco integration goes here.
 */
export function classifyDevice(partial: Partial<AustcoDevice> & { ip: string }): DeviceType {
  const ip = partial.ip;
  if (/^10\.20\.1\.10$/.test(ip)) return "Primary Server";
  if (/^10\.20\.1\.11$/.test(ip)) return "Secondary Server";
  if (/^10\.20\.1\.12$/.test(ip)) return "Virtual IP";
  if (/^10\.20\.4\./.test(ip)) return "Controller";
  if (/^10\.20\.5\./.test(ip)) return "IP-IN8";
  if (/^10\.20\.6\.[0-9]+$/.test(ip)) return "IP-APP1";
  if (/^10\.20\.7\./.test(ip)) return "Signal Light";
  if (/^10\.20\.0\./.test(ip)) return "Switch";
  return "Unknown";
}

export const STATUS_BG: Record<HealthStatus, string> = {
  Healthy: "bg-success/15 text-success border-success/30",
  Warning: "bg-warning/15 text-warning border-warning/30",
  Critical: "bg-critical/15 text-critical border-critical/30",
  Offline: "bg-muted/40 text-muted-foreground border-border",
  Scanning: "bg-info/15 text-info border-info/30",
};