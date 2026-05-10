/**
 * Tacera Appliance Knowledge Model
 * --------------------------------
 * Pure deterministic. No AI. Encodes what each Tacera/Austco appliance is,
 * how it depends on others, where its truth lives, and how the correlation
 * engine should treat it (root-cause candidate vs downstream symptom).
 *
 * Used by:
 *   - taceraEventNormalizer.js   (resolve applianceType from device kind)
 *   - taceraIncidentCorrelator.js (M2 — dependency-order root-cause selection)
 *   - signalPathEngine.js         (M2 — layer-by-layer signal trace)
 *   - liveCaptureSessionStore.js  (M1 — attach profile snapshot to session)
 *
 * Profile schema (frozen contract):
 *   {
 *     applianceType,               // canonical machine id
 *     displayName,
 *     role,                        // short human role
 *     diagnosticPriority,          // 1=highest (controllers/switches), 5=lowest
 *     isRootCauseCandidate,        // true if usually a real first failure
 *     isUsuallyDownstreamSymptom,  // true if usually shows symptoms of upstream failure
 *     upstreamDependencies: [],    // applianceTypes this thing depends on
 *     downstreamDependencies: [],  // applianceTypes that depend on this thing
 *     defaultPorts: [],
 *     knownLogPaths: [],
 *     knownCommands: [],           // safe READ-ONLY ops snapshot commands
 *     healthChecks: [],            // human-readable deterministic health checks
 *     commonPatterns: [],          // event-type strings expected here
 *     dangerousActions: [],        // things the doctor must NEVER auto-do here
 *     safeNextChecks: [],          // safe deterministic checks for techs
 *     recoveryWindowSeconds,       // how long after restart to suppress alarms
 *   }
 */

function profile(p) { return Object.freeze(p); }

export const TACERA_APPLIANCE_PROFILES = Object.freeze({
  // ---------------- Routing / Configuration truth ----------------
  ipconnect: profile({
    applianceType: "ipconnect",
    displayName: "IPConnect (Webmin)",
    role: "Routing & object truth — Tacera signal routing master",
    diagnosticPriority: 2,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["switch", "linux-vm"],
    downstreamDependencies: ["pulse-gateway", "inga", "rtls-gateway"],
    defaultPorts: [10000, 1883],
    knownLogPaths: [
      "/var/log/webmin/miniserv.log",
      "/var/log/webmin/miniserv.error",
      "/var/log/syslog",
      "/var/log/messages",
    ],
    knownCommands: ["systemctl status webmin", "ss -ltnp"],
    healthChecks: [
      "Webmin reachable on TCP 10000 (TLS)",
      "Callpoint object IDs present in active config",
      "Signal profiles assigned to callpoints",
    ],
    commonPatterns: ["INVALID_CALLPOINT_SIGNAL", "CONNECTION_REFUSED", "WEBSOCKET_ERROR"],
    dangerousActions: ["restart Webmin during active call traffic", "edit miniserv.conf without backup"],
    safeNextChecks: [
      "Search affected callpoint IDs in IPConnect/CCP",
      "Verify callpoints exist in active config",
      "Verify assigned signal profiles",
      "Compare against last imported CCP",
    ],
    recoveryWindowSeconds: 60,
  }),

  // ---------------- Pulse Gateway (usually downstream) ----------------
  "pulse-gateway": profile({
    applianceType: "pulse-gateway",
    displayName: "Pulse Gateway",
    role: "Message router/translator between IPConnect, MQTT, displays, mobile",
    diagnosticPriority: 3,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["ipconnect", "mqtt-broker", "ip-cct", "switch"],
    downstreamDependencies: ["display", "pulse-mobile", "pulse-manage"],
    defaultPorts: [443, 8443, 1883],
    knownLogPaths: [
      "/var/log/pulse-gateway/pulse-gateway.log",
      "/var/lib/docker/containers/*/*-json.log",
    ],
    knownCommands: ["docker ps", "docker logs --tail=500 pulse-gateway"],
    healthChecks: [
      "Pulse Gateway container running",
      "MQTT subscription healthy",
      "WebSocket clients connected",
    ],
    commonPatterns: ["WEBSOCKET_ERROR", "CONNECTION_REFUSED", "INVALID_CALLPOINT_SIGNAL", "SERVICE_RESTARTED"],
    dangerousActions: [
      "restart Pulse Gateway as a first action",
      "blame Pulse Gateway when controllers/IPConnect are silent upstream",
    ],
    safeNextChecks: [
      "Confirm IPConnect & controllers healthy first",
      "Check MQTT broker reachability",
      "Inspect Pulse Gateway WS error stream for the reproduction window",
    ],
    recoveryWindowSeconds: 120,
  }),

  "pulse-manage": profile({
    applianceType: "pulse-manage",
    displayName: "Pulse Manage",
    role: "Management / configuration UI surface",
    diagnosticPriority: 4,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["ipconnect", "pulse-gateway", "linux-vm"],
    downstreamDependencies: [],
    defaultPorts: [443, 8443],
    knownLogPaths: ["/var/log/pulse-manage/pulse-manage.log"],
    knownCommands: ["systemctl status pulse-manage"],
    healthChecks: ["HTTPS UI reachable", "Auth backend reachable"],
    commonPatterns: ["WEBSOCKET_ERROR", "CONNECTION_REFUSED"],
    dangerousActions: ["restart Pulse Manage during active configuration push"],
    safeNextChecks: ["Reload UI", "Check upstream Pulse Gateway"],
    recoveryWindowSeconds: 60,
  }),

  // ---------------- Integration Gateway (INGA) ----------------
  inga: profile({
    applianceType: "inga",
    displayName: "Integration Gateway (INGA)",
    role: "External integration translator (HL7, RTLS, third-party)",
    diagnosticPriority: 3,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["mqtt-broker", "ipconnect"],
    downstreamDependencies: ["hl7", "rtls-gateway"],
    defaultPorts: [8883, 1883, 2575],
    knownLogPaths: ["/var/log/inga/inga.log", "/opt/inga/logs/inga.log"],
    knownCommands: ["systemctl status inga"],
    healthChecks: ["MQTT subscribed", "HL7 listener up", "RTLS subscriber up"],
    commonPatterns: ["CONNECTION_REFUSED", "HL7_ACK_TIMEOUT", "RTLS_ROOM_MAPPING_FAILURE", "INVALID_CALLPOINT_SIGNAL"],
    dangerousActions: [
      "restart INGA before confirming MQTT broker is up",
      "blame INGA for stale callpoint replays without checking source",
    ],
    safeNextChecks: ["Check MQTT broker first", "Inspect INGA event replay window"],
    recoveryWindowSeconds: 90,
  }),

  "license-service": profile({
    applianceType: "license-service",
    displayName: "License Service",
    role: "Feature/seat licensing for Pulse stack",
    diagnosticPriority: 4,
    isRootCauseCandidate: true, // license outage is a real cause
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["linux-vm"],
    downstreamDependencies: ["pulse-gateway", "pulse-manage", "inga"],
    defaultPorts: [8443],
    knownLogPaths: ["/var/log/license/license.log"],
    knownCommands: ["systemctl status license"],
    healthChecks: ["License daemon up", "License valid (not expired)"],
    commonPatterns: ["LICENSE_FAILURE", "SERVICE_RESTARTED"],
    dangerousActions: ["delete license cache without backup"],
    safeNextChecks: ["Confirm license expiry date", "Check license server reachability"],
    recoveryWindowSeconds: 60,
  }),

  hl7: profile({
    applianceType: "hl7",
    displayName: "HL7 / MLLP Endpoint",
    role: "Hospital integration message channel",
    diagnosticPriority: 4,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["inga"],
    downstreamDependencies: [],
    defaultPorts: [2575],
    knownLogPaths: ["/var/log/inga/hl7.log"],
    knownCommands: [],
    healthChecks: ["MLLP TCP reachable", "ACKs returning within timeout"],
    commonPatterns: ["HL7_ACK_TIMEOUT", "CONNECTION_REFUSED"],
    dangerousActions: ["replay HL7 messages without dedup window"],
    safeNextChecks: ["Check MLLP listener on hospital side", "Check INGA HL7 worker"],
    recoveryWindowSeconds: 60,
  }),

  "rtls-gateway": profile({
    applianceType: "rtls-gateway",
    displayName: "RTLS Gateway",
    role: "Real-time location service event source (badges/presence)",
    diagnosticPriority: 3,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["network"],
    downstreamDependencies: ["inga", "ipconnect"],
    defaultPorts: [443, 8883],
    knownLogPaths: ["/var/log/rtls/rtls.log"],
    knownCommands: [],
    healthChecks: ["Badge event stream live", "Room mapping table loaded"],
    commonPatterns: ["RTLS_ROOM_MAPPING_FAILURE", "RTLS_BADGE_CANCEL_LIMITATION"],
    dangerousActions: ["assume staff-presence cancel without RTLS confirmation"],
    safeNextChecks: [
      "Verify badge → room map for affected room",
      "Check RTLS module path for the reported call type",
    ],
    recoveryWindowSeconds: 60,
  }),

  // ---------------- Endpoint hardware ----------------
  "ip-cct": profile({
    applianceType: "ip-cct",
    displayName: "IP-CCT Controller",
    role: "Tacera bus controller — primary nurse call hardware",
    diagnosticPriority: 1,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["switch", "ipconnect"],
    downstreamDependencies: ["pulse-gateway", "inga", "ipconnect"],
    defaultPorts: [80, 443, 1883],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["Heartbeat current", "Bus voltage nominal", "Callpoints reporting"],
    commonPatterns: ["CONTROLLER_HEARTBEAT_LOST", "LOW_BUS_VOLTAGE", "INVALID_CALLPOINT_SIGNAL"],
    dangerousActions: ["never reboot controller from doctor — manual only"],
    safeNextChecks: [
      "Check PoE on controller switch port",
      "Check VLAN tagging on switch port",
      "Inspect bus voltage on controller LEDs",
    ],
    recoveryWindowSeconds: 180,
  }),

  "ip-pst": profile({
    applianceType: "ip-pst",
    displayName: "IP-PST / PST2 Pendant Server",
    role: "Pendant transmitter server (wireless pendants)",
    diagnosticPriority: 2,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["network", "linux-vm"],
    downstreamDependencies: ["ipconnect"],
    defaultPorts: [22, 443],
    knownLogPaths: ["/home/pst/log/ip_pst_app.log", "/home/pst/log/log_level"],
    knownCommands: ["cat /home/pst/log/log_level", "df -h /home/pst"],
    healthChecks: [
      "Logging level is LOG_INFO (not LOG_TRACE/LOG_DEBUG)",
      "Pendant heartbeats present",
      "Disk free on /home/pst > 20%",
    ],
    commonPatterns: ["PST_TRACE_ENABLED", "PST_LOG_LEVEL_CHANGED", "PST_DISK_RISK", "SERVICE_RESTARTED"],
    dangerousActions: ["leave LOG_TRACE enabled — fills disk and crashes PST"],
    safeNextChecks: [
      "Restore LOG_INFO in /home/pst/log/log_level",
      "Check disk usage on /home/pst",
      "Verify pendant base stations online",
    ],
    recoveryWindowSeconds: 120,
  }),

  "ip-app1": profile({
    applianceType: "ip-app1",
    displayName: "IP-APP1 Wall Display",
    role: "Wall-mounted call display / annunciator",
    diagnosticPriority: 5,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["pulse-gateway", "ipconnect"],
    downstreamDependencies: [],
    defaultPorts: [],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["WS connection to Pulse Gateway up", "Tone/colour map loaded"],
    commonPatterns: ["WEBSOCKET_ERROR", "SERVICE_RESTARTED", "BOOT_RECOVERY"],
    dangerousActions: ["replace display before confirming upstream call routes correctly"],
    safeNextChecks: ["Confirm call routes upstream", "Reload tone/colour profile"],
    recoveryWindowSeconds: 60,
  }),

  "an-pd2": profile({
    applianceType: "an-pd2",
    displayName: "AN-PD2 Patient Display",
    role: "In-room patient display / call indicator",
    diagnosticPriority: 5,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["ip-cct", "ipconnect"],
    downstreamDependencies: [],
    defaultPorts: [],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["Bus link present", "Latest call rendered"],
    commonPatterns: ["LOW_BUS_VOLTAGE", "BOOT_RECOVERY"],
    dangerousActions: ["swap unit before checking bus voltage"],
    safeNextChecks: ["Check bus voltage at controller", "Check upstream IP-CCT health"],
    recoveryWindowSeconds: 60,
  }),

  odl: profile({
    applianceType: "odl",
    displayName: "ODL Over-Door Light",
    role: "Visual call indicator outside patient room",
    diagnosticPriority: 5,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["ip-cct"],
    downstreamDependencies: [],
    defaultPorts: [],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["Bus link present"],
    commonPatterns: ["LOW_BUS_VOLTAGE", "BOOT_RECOVERY"],
    dangerousActions: ["replace ODL before confirming upstream"],
    safeNextChecks: ["Check bus voltage", "Check controller link"],
    recoveryWindowSeconds: 60,
  }),

  "access-input": profile({
    applianceType: "access-input",
    displayName: "Access Control Input (IP-IN8)",
    role: "Dry-contact input from access control / external systems",
    diagnosticPriority: 2,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["ip-cct", "switch"],
    downstreamDependencies: ["ipconnect", "pulse-gateway"],
    defaultPorts: [],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["Input state matches expected", "Signal profile attached"],
    commonPatterns: ["ACCESS_INPUT_ACTIVE"],
    dangerousActions: [
      "blame nurse call when an IP-IN8 input is held active by access control",
    ],
    safeNextChecks: [
      "Identify which IP-IN8 input is active",
      "Trace the dry contact back to the access control device",
      "Verify signal profile is the intended one",
    ],
    recoveryWindowSeconds: 30,
  }),

  connexall: profile({
    applianceType: "connexall",
    displayName: "Connexall Middleware",
    role: "Third-party clinical middleware integration",
    diagnosticPriority: 4,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["inga", "mqtt-broker"],
    downstreamDependencies: [],
    defaultPorts: [443, 2575],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["Subscriber up", "Acks returning"],
    commonPatterns: ["CONNECTION_REFUSED", "HL7_ACK_TIMEOUT"],
    dangerousActions: ["restart Connexall side without coordinating with vendor"],
    safeNextChecks: ["Check upstream INGA + MQTT first"],
    recoveryWindowSeconds: 60,
  }),

  // ---------------- Network ----------------
  switch: profile({
    applianceType: "switch",
    displayName: "Network Switch",
    role: "PoE / VLAN / link layer for controllers and appliances",
    diagnosticPriority: 1,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: [],
    downstreamDependencies: ["ip-cct", "ipconnect", "pulse-gateway", "inga", "rtls-gateway", "linux-vm"],
    defaultPorts: [22, 80, 443, 161],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["PoE budget healthy", "Port up/up", "VLAN tagging correct"],
    commonPatterns: ["CONTROLLER_HEARTBEAT_LOST", "CONNECTION_REFUSED"],
    dangerousActions: ["change VLAN on a port carrying live calls"],
    safeNextChecks: [
      "Check PoE on the switch port for the affected controller",
      "Check VLAN tagging on the affected port",
      "Check link counters / errors",
    ],
    recoveryWindowSeconds: 30,
  }),

  "mqtt-broker": profile({
    applianceType: "mqtt-broker",
    displayName: "MQTT Broker (Mosquitto)",
    role: "Message bus between IPConnect, INGA, Pulse Gateway",
    diagnosticPriority: 2,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["linux-vm", "switch"],
    downstreamDependencies: ["pulse-gateway", "inga", "ipconnect"],
    defaultPorts: [1883, 8883],
    knownLogPaths: ["/var/log/mosquitto/mosquitto.log"],
    knownCommands: ["systemctl status mosquitto"],
    healthChecks: ["Broker process up", "Ports open", "Subscribers connected"],
    commonPatterns: ["MQTT_CONNECTION_REFUSED", "CONNECTION_REFUSED", "SERVICE_RESTARTED"],
    dangerousActions: ["restart broker during active call traffic without warning"],
    safeNextChecks: ["systemctl status mosquitto", "Check 1883/8883 listeners", "Inspect broker logs in window"],
    recoveryWindowSeconds: 30,
  }),

  "pulse-mobile": profile({
    applianceType: "pulse-mobile",
    displayName: "Pulse Mobile",
    role: "Push notification path to mobile staff devices",
    diagnosticPriority: 4,
    isRootCauseCandidate: false,
    isUsuallyDownstreamSymptom: true,
    upstreamDependencies: ["pulse-gateway", "network"],
    downstreamDependencies: [],
    // Known Pulse Mobile / push ports:
    defaultPorts: [5223, 5228, 5229, 5230],
    knownLogPaths: [],
    knownCommands: [],
    healthChecks: ["TCP reachability to push ports 5223/5228/5229/5230"],
    commonPatterns: ["PULSE_MOBILE_PORT_BLOCKED", "CONNECTION_REFUSED"],
    dangerousActions: ["blame app crash before checking firewall to push ports"],
    safeNextChecks: [
      "From the affected device's network, test TCP reach to 5223, 5228, 5229, 5230",
      "Check firewall/VLAN egress rules for those ports",
    ],
    recoveryWindowSeconds: 30,
  }),

  "linux-vm": profile({
    applianceType: "linux-vm",
    displayName: "Generic Linux VM",
    role: "Host OS for Tacera/Pulse services",
    diagnosticPriority: 3,
    isRootCauseCandidate: true,
    isUsuallyDownstreamSymptom: false,
    upstreamDependencies: ["switch"],
    downstreamDependencies: ["pulse-gateway", "inga", "ipconnect", "license-service", "mqtt-broker"],
    defaultPorts: [22],
    knownLogPaths: ["/var/log/syslog", "/var/log/messages"],
    knownCommands: ["date", "uptime", "df -h", "free -m", "top -b -n1 | head -30"],
    healthChecks: ["Clock not drifted", "Disk not full", "Memory not exhausted", "No recent unplanned reboot"],
    commonPatterns: ["CLOCK_DRIFT", "BOOT_RECOVERY", "SERVICE_RESTARTED"],
    dangerousActions: ["reboot VM without confirming services elsewhere"],
    safeNextChecks: [
      "date / uptime",
      "df -h",
      "free -m",
      "top snapshot",
    ],
    recoveryWindowSeconds: 180,
  }),
});

/** Tolerant mapping from a registered device kind / profileKey → applianceType. */
export function applianceTypeFor(kind) {
  const k = String(kind || "").toLowerCase();
  if (!k) return "unknown";
  if (/ipc-?webmin|ipconnect|miniserv/.test(k)) return "ipconnect";
  if (/pulse-?gateway/.test(k)) return "pulse-gateway";
  if (/pulse-?manage/.test(k)) return "pulse-manage";
  if (/pulse-?mobile/.test(k)) return "pulse-mobile";
  if (/inga|integration-?gateway/.test(k)) return "inga";
  if (/license/.test(k)) return "license-service";
  if (/hl7|mllp/.test(k)) return "hl7";
  if (/rtls/.test(k)) return "rtls-gateway";
  if (/ip-?cct|controller/.test(k)) return "ip-cct";
  if (/ip-?pst|pst2|pendant/.test(k)) return "ip-pst";
  if (/ip-?app1|wall-?display/.test(k)) return "ip-app1";
  if (/an-?pd2|patient-?display/.test(k)) return "an-pd2";
  if (/odl|over-?door/.test(k)) return "odl";
  if (/ip-?in8|access-?input|access-?control/.test(k)) return "access-input";
  if (/connexall/.test(k)) return "connexall";
  if (/mqtt|broker|mosquitto/.test(k)) return "mqtt-broker";
  if (/switch|poe/.test(k)) return "switch";
  if (/linux|vm|ubuntu|debian/.test(k)) return "linux-vm";
  return "unknown";
}

export function getApplianceProfile(applianceType) {
  return TACERA_APPLIANCE_PROFILES[applianceType] || null;
}

export function listApplianceProfiles() {
  return Object.values(TACERA_APPLIANCE_PROFILES);
}
