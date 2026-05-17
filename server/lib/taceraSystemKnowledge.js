/**
 * TACERA SYSTEM KNOWLEDGE BASE — v4.38
 * Compiled from: module TAR analysis, platform patch install scripts (4.0.28–4.1.4),
 * architecture DNS diagram, Foundations Build Cheat Sheet, Webmin recording.
 *
 * This is the single source of truth the app uses to understand the system.
 * Nothing is inferred. Everything here came from actual Austco source files.
 */

// ─── Physical / Hypervisor topology ─────────────────────────────────────────

export const HYPERVISOR_TYPES = {
  proxmox: {
    id: 'proxmox',
    label: 'Proxmox VE',
    webPort: 8006,
    apiBase: (host) => `https://${host}:8006/api2/json`,
    checkEndpoint: '/nodes',
    defaultUser: 'root@pam',
  },
  esxi: {
    id: 'esxi',
    label: 'VMware ESXi',
    webPort: 443,
    apiBase: (host) => `https://${host}/sdk`,
    checkEndpoint: '/rest/vcenter/vm',
    defaultUser: 'root',
  },
};

// ─── Server role types and what lives on each ────────────────────────────────

export const SERVER_ROLES = {
  integration_server: {
    label: 'Integration Server (Big)',
    possibleModules: [
      'UT0008', // INGA
      'UT0032', // Pulse Gateway (authoritative OR proxy)
      'UT0040', // License Service
      'UT0023', // Pulse Manage
      'UT0027', // Annunciator server
      'UT0028', // Nurse Station server
      'UT0029', // App Station server
      'UT0035', // Display Driver server
      'UT0039', // Touchpoint server
      'UT0031', // Pulse Fileserver
      'UT0041', // Pulse Insights Reporting API
      'UT0042', // PostgreSQL DB Container
      'UT0021', // Software Services (Fault Monitor + EDX)
      'UT0034', // Pulse HL7
      'UT0009', // RTLS Gateway
      'UT0013', // Gluu Auth
      'UT0014', // Mobile Gateway
      'UT0037', // MQTT Broker
      'UT0043', // WebSocket-MQTT Adapter
      'UT0044', // Pulse Chat Service
    ],
    webminLabel: 'Integration Server Management',
  },
  floor_controller: {
    label: 'Floor Controller',
    possibleModules: [
      'UT0001', // IP-Connect + ADX
      'UT0032', // Pulse Gateway (proxy — if Pulse Devices on Austco LAN)
    ],
    webminLabel: 'Floor Controller Management',
    hasAsterisk: true,
    hasIPConnect: true,
  },
};

// ─── Module registry: every module and its runtime fingerprint ───────────────

export const MODULE_REGISTRY = {
  // Key: module ID. Values: how to detect it, its log paths, process name, etc.

  ipconnect: {
    id: 'ipconnect',
    name: 'IP-Connect (XmlBlaster)',
    moduleId: 'UT0001',
    serverRole: 'floor_controller',
    integratedModules: ['adx'],
    runtime: 'daemontools',
    processPattern: 'XCareServer',           // NOTE: not org.xmlBlaster.Main — see ACS-1771
    processPattern2: 'org.xmlBlaster.Main',  // fallback
    startScript: '/opt/xcare/xcaresrv',
    daemontoolsPath: null,                   // managed by xcaresrv, not a direct svscan link
    webminKey: 'acs-ipconnect',
    logPaths: [
      '/var/opt/xcare/log/xcare00.log',      // current log (00 = current)
      '/var/opt/xcare/log/xcare01.log',      // previous rotation
    ],
    logFormat: 'xmlblaster_java',
    jmxPort: 8999,
    bootstrapPort: 7607,                     // XmlBlaster bootstrap
    db: { name: 'eventlog', host: '127.0.0.2', port: 5432 },
    configFile: '/etc/opt/xcare/logging.properties',
    loggingConfig: '/etc/opt/xcare/logging.properties',  // confirmed from Webmin recording frame 18
    // IPC-SMA license feature MUST be valid for this to start (v4.34+)
    requiresLicenseFeature: 'IPC-SMA',
    // Silent failure: won't start without valid license, logs "pluginFailed" not "license error"
    silentFailureModes: [
      'license_violation_no_explicit_log',   // shows pluginFailed, not license expired
      'ccp_object_mismatch_no_warning',      // "Could not interpret new update" only
    ],
    dependsOn: ['lmx_server'],
    // From platform patch: IP-Connect must NOT be running during platform upgrades
    // pgrep -f "XCareServer" used (not org.xmlBlaster.Main — see ACS-1771)
    webminToolboxCommands: [
      'Manage IP-Connect environment',
      'IP-Connect server start/stop/force stop/restart/status',
      'IP-Connect server log',
      'IP-Connect server log properties',
      'IP-Connect server version',
      'IP-Connect server running log',
      'Restore default IP-Connect server configuration',
      'Activate a Call Point',
      'Current Active Call Points',
      'Cancel a Call Point',
      'Trigger a Notification',
    ],
  },

  adx: {
    id: 'adx',
    name: 'Alarm Data Transfer (ADX)',
    moduleId: 'UT0001',  // bundled with IP-Connect
    serverRole: 'floor_controller',
    runtime: 'docker',
    containerName: 'alarm-data-xfer',
    hostPort: 51091,
    containerPort: 8080,
    network: 'austco_bridge',
    logPaths: ['/home/xcare/runtime/adx/log/app.log'],
    db: { name: 'eventlog', tables: ['adx', 'adx_forward_transfer', 'adx_backward_transfer'] },
    dependsOn: ['ipconnect', 'austco_bridge'],
    webminToolboxCommands: [
      'Alarm Data Transfer (ADX) environment management',
      'Alarm Data Transfer (ADX) full log',
      'Alarm Data Transfer (ADX) log properties',
      'Alarm Data Transfer (ADX) version',
    ],
  },

  integration_gateway: {
    id: 'integration_gateway',
    name: 'Integration Gateway (INGA)',
    moduleId: 'UT0008',
    serverRole: 'integration_server',
    runtime: 'daemontools',
    processPattern: 'integration-gateway.war',
    daemontoolsLink: '/service/integration-gateway',
    daemontoolsDir: '/home/xcare/runtime/djbdns/integration-gateway',
    manageScript: '/home/xcare/runtime/integration-gateway/bin/manage-app.sh',
    webminKey: 'acs-integration-gateway',
    logPaths: ['/home/xcare/runtime/integration-gateway/logs/app.log'],
    logFormat: 'logback_warn',
    httpsPort: 9443,
    httpPort: 8080,
    jmxPort: 9093,
    jdwpPort: 9602,
    keystorePath: '/home/xcare/runtime/certs/etc/keystore.jks',
    truststorePath: '/home/xcare/runtime/certs/etc/truststore.jks',
    xmblasterConnectUser: 'AustcoStubClass',
    xmblasterConnectPass: 'secret',
    configApiKey: 'Integration Gateway',
    // CRITICAL: app.properties must list eth0 IP of EACH IPC server
    appPropertiesPath: '/home/xcare/runtime/integration-gateway/etc/app.properties',
    appPropertiesKey: 'acs.ipaddresses',
    warningCodes: {
      10119: 'Invalid inputset — callpoint ID or signal attributes mismatch',
      10201: 'ActiveInput error',
      10202: 'ActiveInput error (variant)',
      10236: 'Cancel of non-existing alarm',
      10330: 'Event Logger inactive',
      20301: 'Cannot connect to XmlBlaster',
      20303: 'Publish problem',
    },
    silentFailureModes: [
      'inga_acs_ipaddresses_missing',      // no error shown if app.properties has wrong/missing IPC IPs
      'inga_websocket_session_silent_drop', // WebSocket sessions can drop without ERROR level log entry
    ],
    dependsOn: ['ipconnect', 'pulse_manage_config_api', 'certs'],
    webminToolboxCommands: [
      'Integration Gateway environment management',
      'Integration Gateway - Security protocol management',
      'Integration Gateway log properties',
      'Integration Gateway full log',
      'Integration Gateway application properties',
      'Integration Gateway version',
    ],
  },

  pulse_gateway: {
    id: 'pulse_gateway',
    name: 'Pulse Gateway (Nginx)',
    moduleId: 'UT0032',
    serverRole: 'integration_server',  // can also be on floor controller as proxy
    runtime: 'docker',
    containerName: 'pulse-gateway',
    image: 'pulse-gateway:latest',
    network: 'austco_bridge',
    ports: { 80: 8080, 443: 8443, 1883: 1883, 8883: 8883 },
    logPaths: ['/home/xcare/runtime/pulse-gateway/log/error.log'],
    manageScript: '/home/xcare/runtime/pulse-gateway/bin/manage-app.sh',
    statusCommand: '/home/xcare/runtime/pulse-gateway/bin/manage-app.sh status',
    // Status output format (confirmed from Webmin recording frames 28-31):
    // "Checking status of Pulse Gateway..."
    // "Pulse Gateway is enabled."
    // CONTAINER ID  IMAGE                  COMMAND              CREATED       STATUS    PORTS
    // f96901e3952e  pulse-gateway:latest   "/docker-entrypo..."  4 weeks ago  Up 3 days  0.0.0.0:1883->...
    // "PASSED: pulse.austco.local is reachable"
    // "PASSED: annunciator.austco.local is reachable"
    // ... (all 20 austco.local hostnames)
    // "FAILED: <name>.austco.local is not reachable"   ← key diagnostic output
    statusParsing: {
      containerRunning: /pulse-gateway:latest.*Up/,
      hostPassed: /PASSED: (\S+) is reachable/g,
      hostFailed: /FAILED: (\S+) is not reachable/g,
    },
    certPaths: {
      crt: '/home/xcare/runtime/certs/etc/AustcoLocal.crt',
      key: '/home/xcare/runtime/certs/etc/AustcoLocal.key',
    },
    nginxConfig: '/home/xcare/runtime/pulse-gateway/etc/nginx.conf',
    // All 20 austco.local hostnames checked by status command
    healthCheckHosts: [
      'pulse', 'annunciator', 'appstation', 'audio', 'auth',
      'config', 'displaydriver', 'fileserver', 'hl7', 'licensing',
      'messaging', 'mobilegateway', 'mqtt', 'nursestation', 'reports',
      'rtls', 'rules', 'touchpoint', 'vayyar', 'ws',
    ],
    dependsOn: ['austco_bridge', 'certs'],
    silentFailureModes: [
      'nginx_upstream_silent_fail',   // nginx returns 502 but logs nothing at error level
      'austco_bridge_takesdown_all',  // if bridge fails, ALL services appear down simultaneously
    ],
    webminToolboxCommands: [
      'Pulse Gateway environment management',
      'Pulse Gateway error log',
      'Pulse Gateway - Pulse Device Remote Management - Annunciator',
      'Pulse Gateway - Pulse Device Remote Management - App Station',
      'Pulse Gateway - Pulse Device Remote Management - Nurse Station',
      'Pulse Gateway - Pulse Device Remote Management - Display Driver',
      'Pulse Gateway - Pulse Device Remote Management - Touchpoint',
      'Pulse Gateway version',
    ],
  },

  license_service: {
    id: 'license_service',
    name: 'License Service',
    moduleId: 'UT0040',
    serverRole: 'integration_server',
    runtime: 'dual',   // TWO processes: daemontools (lmx-serv) + docker (API)
    // Process 1: LMX native binary
    lmx: {
      processPattern: '/home/xcare/runtime/lmx/lmx-serv',
      daemontoolsLink: '/service/lmxserv',
      daemontoolsDir: '/home/xcare/runtime/djbdns/lmxserv',
      port: 6200,
      logPaths: ['/home/xcare/runtime/lmx/logs/lmx-serv.log'],
      licenseDir: '/home/xcare/runtime/license-service/etc/lic/',
      configFile: '/home/xcare/runtime/lmx/lmx-serv.cfg',
    },
    // Process 2: Docker API
    api: {
      containerName: 'license-service',
      network: 'austco_bridge',
      hostPort: 51087,
      jdwpPort: 10023,
      jmxPort: 10024,
      logPaths: ['/home/xcare/runtime/license-service/log/app.log'],
    },
    db: {
      name: 'licensing',
      host: '127.0.0.2',
      table: 'status',
      // Non-null violation_start_timestamp_utc = HARD license violation
      // Non-null deferred_start_timestamp_utc = grace period
    },
    hostIdCommand: 'dmidecode -s system-uuid',
    webminToolboxCommands: [
      'License Service environment management',
      'License Service full log',
      'License Service log properties',
      'License Service - Probe host ID and List licenses',
      'License Service - Add a license',
      'License Service - Remove a license',
      'License Service - LM-X log',
      'License Service version',
    ],
    // Webmin monitoring checks (seen in recording frame 1/8):
    webminMonitors: ['License Validity', 'License Service'],
    silentFailureModes: [
      'lmx_up_api_down',              // lmx-serv running but Docker API down — Pulse Manage can't validate
      'license_valid_but_inga_cache_stale', // license re-validated too slowly after fix
    ],
    dependsOn: ['austco_bridge', 'certs'],
  },

  pulse_manage: {
    id: 'pulse_manage',
    name: 'Pulse Manage (Config API + UI)',
    moduleId: 'UT0023',
    serverRole: 'integration_server',
    runtime: 'docker',
    containers: {
      api: { name: 'config-api', hostname: 'config.austco.local', hostPort: 51080, httpsPort: 51443, jdwpPort: 10013, jmxPort: 10014 },
      ui:  { name: 'config-ui',  hostPort: 53080, httpsPort: 53443 },
    },
    network: 'austco_bridge',
    logPaths: [
      '/home/xcare/runtime/configuration/log/app.log',
      '/home/xcare/runtime/configuration/log/error.log',
    ],
    db: { name: 'config', host: '127.0.0.2', port: 5432 },
    // If config-api is down, ALL modules that call GET /api/Applications?name=X will crash-loop every 30s
    // Affected: RTLS Gateway, Mobile Gateway, INGA, and any other module using configApiKey
    crashLoopVictims: ['rtls_gateway', 'mobile_gateway', 'integration_gateway'],
    webminToolboxCommands: [
      'Pulse Manage environment management',
      'Pulse Manage data management',
      'Pulse Manage API full log',
      'Pulse Manage API log properties',
      'Pulse Manage UI error log',
      'Pulse Manage version',
      'Pulse Device Service - Nurse Station environment management',
      'Pulse Device Service - Nurse Station error log',
      'Pulse Device Service - Annunciator environment management',
      'Pulse Device Service - Annunciator error log',
    ],
    // Webmin monitoring: 'Full Production Running Mode' — confirms system is in production mode, not maintenance
    webminMonitor: 'pulsemanage.serv',
    silentFailureModes: [
      'config_api_down_no_obvious_log', // modules just crash-loop, no single obvious error
      'config_db_migration_partial',    // upgrade migration only partially applied (REPORTS-755)
    ],
    dependsOn: ['austco_bridge', 'certs', 'postgresql'],
  },

  rtls_gateway: {
    id: 'rtls_gateway',
    name: 'RTLS Gateway',
    moduleId: 'UT0009',
    serverRole: 'integration_server',
    runtime: 'daemontools',
    processPattern: 'rtls-gateway.war',
    daemontoolsLink: '/service/rtls-gateway',
    httpsPort: 9901,
    logPaths: ['/home/xcare/runtime/rtls-gateway/logs/app.log'],
    configApiKey: 'RTLS Gateway',
    db: { name: 'rtls', table: 'last_known' },
    // v3.9+ behaviour change: empty staffPresenceCancelCallTypesAllowed = NONE (was ALL in v3.4.x)
    behaviourChangedInVersion: '3.9.0',
    staffPresenceBehaviourInverted: true,
    dependsOn: ['pulse_manage', 'postgresql'],
    silentFailureModes: [
      'rtls_config_inversion_post_upgrade',  // silent: alarms just don't cancel, no error in logs
      'rtls_badge_expired_no_alert',          // last_known.location_expired=true with no alert raised
    ],
    webminToolboxCommands: [],
  },

  mobile_gateway: {
    id: 'mobile_gateway',
    name: 'Mobile Gateway (MoGa)',
    moduleId: 'UT0014',
    serverRole: 'integration_server',
    runtime: 'daemontools',
    processPattern: 'mobilegateway.war',
    daemontoolsLink: '/service/mobilegateway',
    httpsPort: 9443,
    logPaths: [
      '/home/xcare/runtime/mobilegateway/logs/moga.log',
      '/home/xcare/runtime/mobilegateway/logs/moga/moga-audit.log',
    ],
    configApiKey: 'Mobile Gateway',
    db: { name: 'moga', table: 'userdata' },
    firebase: {
      credentialsPath: '/home/xcare/runtime/mobilegateway/etc/tacera-mobile-299f6-firebase-adminsdk-hxo31-bc52d2d9bd.json',
      project: 'tacera-mobile-299f6',
    },
    silentFailureModes: [
      'push_token_null_silent_fail',   // moga.userdata.pushtoken IS NULL = push silently fails
      'firebase_creds_missing',        // GOOGLE_APPLICATION_CREDENTIALS missing = all pushes fail silently
    ],
    dependsOn: ['pulse_manage', 'asterisk'],
    webminToolboxCommands: [],
  },

  lmx_server: {
    id: 'lmx_server',
    name: 'LM-X License Server',
    moduleId: 'UT0040',
    serverRole: 'integration_server',
    runtime: 'daemontools',
    processPattern: '/home/xcare/runtime/lmx/lmx-serv',
    daemontoolsLink: '/service/lmxserv',
    port: 6200,
    logPaths: ['/home/xcare/runtime/lmx/logs/lmx-serv.log'],
    dependsOn: [],
  },

  mirth: {
    id: 'mirth',
    name: 'Tacera HL7 (Mirth Connect)',
    moduleId: 'UT0017',
    serverRole: 'integration_server',
    runtime: 'daemontools',
    processPattern: 'mcservice',
    daemontoolsLink: '/service/mirth',
    logPaths: ['/home/xcare/runtime/hl7/mirthclient.log'],
    db: { name: 'mirthdb', host: 'localhost', port: 5432, user: 'mirth' },
    configFiles: [
      '/home/xcare/runtime/hl7/configuration.json',
      '/home/xcare/runtime/hl7/format.json',
    ],
    dependsOn: ['postgresql'],
    webminToolboxCommands: [],
  },

  annunciator_server: {
    id: 'annunciator_server',
    name: 'Pulse Device Service - Annunciator',
    moduleId: 'UT0027',
    serverRole: 'integration_server',
    runtime: 'docker',
    containerName: 'annunciator',
    hostPort: 12280,
    network: 'austco_bridge',
    logPaths: [
      '/home/xcare/runtime/annunciator/log/error.log',
      '/home/xcare/runtime/annunciator/log/access.log',
    ],
    webminToolboxCommands: [
      'Pulse Device Service - Annunciator environment management',
      'Pulse Device Service - Annunciator error log',
      'Pulse Device Service - Annunciator version',
    ],
    dependsOn: ['austco_bridge'],
  },

  nursestation_server: {
    id: 'nursestation_server',
    name: 'Pulse Device Service - Nurse Station',
    moduleId: 'UT0028',
    serverRole: 'integration_server',
    runtime: 'docker',
    containerName: 'nursestation',
    // CRITICAL: status check uses trailing $ anchor: grep "nursestation$"
    statusGrepPattern: 'nursestation$',
    hostPort: 12180,
    network: 'austco_bridge',
    logPaths: ['/home/xcare/runtime/nursestation/log/error.log'],
    webminToolboxCommands: [
      'Pulse Device Service - Nurse Station environment management',
      'Pulse Device Service - Nurse Station error log',
      'Pulse Device Service - Nurse Station version',
    ],
    dependsOn: ['austco_bridge'],
  },

  postgresql: {
    id: 'postgresql',
    name: 'PostgreSQL Database Server',
    runtime: 'system',
    processPattern: 'postgres',
    port: 5432,
    bindAddress: '127.0.0.2',  // NOT 127.0.0.1 — Tacera binds to 127.0.0.2
    databases: ['eventlog', 'licensing', 'audit_db', 'config', 'moga', 'rtls', 'mirthdb', 'siteconfig'],
    initScript: '/etc/init.d/postgresql',
    dataDir: '/home/xcare/db/data',
    configFile: '/home/xcare/db/data/postgresql.conf',
    // Confirmed in recording frame 7: PostgreSQL 9.2.24
    version: '9.2.24',
    // From platform patch ACS-1899: PostgreSQL timezone must be 'localtime'
    // If it's set to anything else after a DB purge, restore with:
    // sed -i "s/^(timezone\s=).*/\1 'localtime'/" /home/xcare/db/data/postgresql.conf
    requiredTimezone: 'localtime',
    // Webmin monitoring: 'PostgreSQL Database Server' — confirmed in recording
    webminMonitor: 'PostgreSQL Database Server',
    silentFailureModes: [
      'pg_timezone_wrong_after_purge',  // ACS-1899: timezone wrongly set after DB purge, causes restart fail
      'pg_restart_fail_after_purge',    // ACS-1935: postgres fails to restart after purge (notes table index)
    ],
  },

  // ─── audit_db schema (confirmed from Webmin recording frame 6) ────────────
  audit_db_schema: {
    database: 'audit_db',
    tables: [
      'active_faults',
      'edx',
      'edx_fault_backward_transfer',
      'edx_fault_forward_transfer',
      'edx_lbe_backward_transfer',
      'edx_lbe_forward_transfer',
      'fault',
      'location_event',
      'location_event_group',
      'staff_response',
      'tag_event',
    ],
    // This is the Software Services (UT0021 - Fault Monitor + EDX) database
    owner: 'software_services',
  },

  asterisk: {
    id: 'asterisk',
    name: 'Asterisk PBX',
    runtime: 'system',
    serverRole: 'floor_controller',
    processPattern: 'asterisk',
    // AsteriskAMI port
    amiPort: 5038,
    amiUser: 'xcare',
    amiPass: 'asterisk',
    logDir: '/var/log/asterisk/',
    // Confirmed from recording frame 15 (Floor Controller Toolbox)
    webminToolboxCommands: [
      'Asterisk SIP show peers',
      'Asterisk Dialplan',
      'Asterisk SIP extensions',
      'Asterisk restart',
      'Asterisk logs',
      'Asterisk call data',
      'SIP audio troubleshooting',
    ],
    // ACS-1918: Asterisk logs can fill disk — rotate at 1MB
    logRotateSize: '1MB',
    // ACS-1894: syslog/daemon.log can be filled by Asterisk, halting ACS
    syslogRisk: true,
  },
};

// ─── Platform-level bugs and checks (from platform patch changelog) ──────────
// These are bugs that DO NOT show in application logs — only detectable by
// probing system state directly.

export const SILENT_PLATFORM_BUGS = [
  {
    id: 'DHCP_SERVER_NOT_NEEDED',
    title: 'DHCP Server running unnecessarily',
    description: 'DHCP server often enabled on ACS VMs where it should be disabled. Causes IP conflicts on the network. Shows as red dot in Webmin Monitoring but no application log entry.',
    // Confirmed in recording: DHCP Server = FAILED (red) in Webmin Monitoring on 192.168.10.201
    detection: {
      webminMonitor: 'DHCP Server',
      command: 'systemctl is-active isc-dhcp-server',
      expectedState: 'inactive',  // should be disabled unless specifically needed
    },
    fix: 'systemctl stop isc-dhcp-server && systemctl disable isc-dhcp-server',
    risk: 'LOW',
  },
  {
    id: 'ACS_1806_VAR_FILESYSTEM',
    title: '/var filesystem not separated (pre-4.0.43)',
    description: 'On systems not yet patched to 4.0.43+, /var is not a separate filesystem. Logging can fill the root filesystem (/), halting the entire ACS silently. No warning in application logs until disk is already full.',
    detection: {
      command: "df -h | grep ' /var'",
      missingMeansVulnerable: true,  // if no separate /var mount, system is at risk
    },
    affectedVersions: 'platform < 4.0.43',
    risk: 'HIGH',
    silentUntil: 'disk full',
  },
  {
    id: 'ACS_1899_PG_TIMEZONE',
    title: 'PostgreSQL timezone incorrect after DB purge',
    description: "After a database purge on pre-4.1.1 systems, PostgreSQL timezone may be set incorrectly causing postgres to fail to restart. No application-level error — DB simply won't start.",
    detection: {
      command: "grep '^timezone' /home/xcare/db/data/postgresql.conf",
      expectedValue: "timezone = 'localtime'",
    },
    fix: "sed -i \"s/^(timezone\\s=).*/\\1 'localtime'/\" /home/xcare/db/data/postgresql.conf",
    risk: 'HIGH',
    silentUntil: 'postgres restart attempt fails',
  },
  {
    id: 'ACS_1894_SYSLOG_FILL',
    title: 'Application logs filling syslog/daemon.log (pre-4.1.1)',
    description: 'Tomcat/Asterisk stdout can fill /var/log/daemon.log and /var/log/syslog silently until disk full. No application warning. On pre-4.1.1 systems without log redirect fix.',
    detection: {
      command: 'du -sh /var/log/daemon.log /var/log/syslog 2>/dev/null',
      warningThresholdMB: 100,
    },
    affectedVersions: 'platform < 4.1.1',
    risk: 'HIGH',
  },
  {
    id: 'ACS_1918_ASTERISK_LOGS',
    title: 'Asterisk logs growing without bound',
    description: 'On some pre-4.1.1 systems, Asterisk log rotation is not configured. Logs grow until disk is full. Silent — no application warning until disk full.',
    detection: {
      command: 'du -sh /var/log/asterisk/',
      warningThresholdMB: 500,
    },
    affectedVersions: 'platform < 4.1.1',
    risk: 'HIGH',
  },
  {
    id: 'ACSSOFT_9082_IPC_AUTO_RESTART',
    title: 'IP-Connect restarts after license violation (pre-4.0.37)',
    description: 'On pre-4.0.37 systems, IP-Connect will automatically restart itself after a licensing violation instead of staying stopped. This can cause a restart loop. Fixed in 4.0.37 with ACSSOFT-9082 — check platform version.',
    detection: {
      platformVersionCheck: '< 4.0.37',
    },
    affectedVersions: 'platform < 4.0.37',
    risk: 'MEDIUM',
  },
  {
    id: 'ACS_1811_HOSTS_INTERFACES_SYNC',
    title: '/etc/hosts and /etc/network/interfaces not synchronized',
    description: 'Pre-4.0.43 systems: changing IP in Webmin network config does not update /etc/hosts. IP-Connect may become unreachable because it resolves its own hostname from /etc/hosts, finding the old IP. No error in logs — just silent connectivity failure.',
    detection: {
      command: "diff <(grep -v '^#' /etc/hosts | sort) <(ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)",
    },
    affectedVersions: 'platform < 4.0.43',
    risk: 'MEDIUM',
    silentUntil: 'IPC connection attempt fails with wrong IP',
  },
  {
    id: 'ACS_1867_DISK_100_PERCENT',
    title: 'Disk showing 100% despite space available',
    description: 'Pre-4.1.1 systems: the disk space check in Webmin monitoring shows 100% usage on sda1 even when there is actual space available. This is a monitoring false positive, but causes confusion and masks real disk issues.',
    detection: {
      webminMonitor: 'Disk Space - SSD system (/)',
      verifyCommand: 'df -h /dev/sda1',
    },
    affectedVersions: 'platform < 4.1.1',
    risk: 'LOW',
    falsePositive: true,
  },
  {
    id: 'AUSTCO_BRIDGE_VPN_BUG',
    title: 'austco_bridge Docker network fails after VPN connection',
    description: 'Known bug in v4.35 release notes: when VPN is activated on an ACS VM, the austco_bridge Docker network can enter a failed state. ALL Docker-based services (Pulse Gateway, config-api, license-service, annunciator, nursestation, etc.) go down simultaneously. No error in any application log — Docker network layer failure.',
    detection: {
      command: 'docker network inspect austco_bridge',
      failureIndicator: 'null or missing bridge network',
    },
    silentUntil: 'all Docker services simultaneously unreachable',
    risk: 'HIGH',
    simultaneousFailureCount: 8,  // 8+ services fail at once when this hits
  },
  {
    id: 'CERT_EXPIRY_ANNUAL',
    title: 'AustcoLocal.crt expires annually',
    description: 'Standard SSL certificates must be updated annually. When they expire, Pulse Gateway, INGA, Pulse Manage, and License Service all refuse to start. No advance warning in any log — cert just expires.',
    detection: {
      command: 'openssl x509 -enddate -noout -in /home/xcare/runtime/certs/etc/AustcoLocal.crt',
      warningDaysBefore: 30,
    },
    risk: 'HIGH',
    silentUntil: 'services refuse to start on cert expiry date',
  },
  {
    id: 'RTLS_PRESENCE_INVERSION',
    title: 'RTLS staff presence cancellation inverted after v3.9 upgrade',
    description: 'Empty staffPresenceCancelCallTypesAllowed in RTLS Gateway config meant ALL alarms cancelled (v3.4.x). In v3.9+, empty means NONE. Systems upgraded from pre-4.35 without reconfiguring this silently stop cancelling alarms. Zero log entries — just alarms not being cancelled.',
    detection: {
      command: "wget -qO- 'http://127.0.0.1:51080/api/Applications?name=RTLS+Gateway'",
      checkField: 'staffPresenceCancelCallTypesAllowed',
      emptyMeansNoCancel: true,
    },
    affectedVersions: 'RTLS Gateway v3.9+ after upgrade from v3.4.x without reconfiguration',
    risk: 'HIGH',
    silentUntil: 'staff notices alarms not being cancelled',
  },
  {
    id: 'INGA_APP_PROPERTIES_MISSING_IPC',
    title: 'Integration Gateway missing IPC server IPs',
    description: "INGA's acs.ipaddresses in app.properties must list the eth0 IP of EACH IPC server. If an IPC server is added without updating INGA's app.properties, that floor controller's alarms are silently ignored. No error — INGA simply doesn't subscribe to that XmlBlaster node.",
    detection: {
      command: "grep acs.ipaddresses /home/xcare/runtime/integration-gateway/etc/app.properties",
      crossCheck: 'compare against known floor controller IPs',
    },
    risk: 'HIGH',
    silentUntil: 'alarms from that floor controller never appear',
  },
  {
    id: 'DNS_SECOND_ENTRY_MISSING',
    title: 'ACS VM missing second DNS entry',
    description: 'Build cheat sheet requires each ACS VM to have 127.0.0.1 PLUS the eth0 of the PuGa host as second DNS. Many installs only have 127.0.0.1. Without the second entry, austco.local names may not resolve correctly after a local DNS cache flush. Silent until DNS lookup fails at runtime.',
    // Confirmed in recording frame 3: DNS server = 127.0.0.1 only (second entry blank)
    detection: {
      command: "cat /etc/resolv.conf | grep nameserver",
      expectedCount: 2,
      expectedFirst: '127.0.0.1',
    },
    risk: 'MEDIUM',
    silentUntil: 'austco.local resolution fails intermittently',
  },
  {
    id: 'TIME_SYNC_DRIFT',
    title: 'System time drift causing certificate and authentication failures',
    description: 'NTP must be configured correctly on ALL ACS VMs. Time drift of even a few seconds causes TLS certificate validation failures and JWT authentication errors. These appear as cryptic PKIX/SSL errors in logs rather than "time wrong" messages. Build cheat sheet says to CHECK THE TIME three times.',
    detection: {
      command: 'ntpq -p; timedatectl',
      warningOffsetMs: 5000,  // 5 second offset is already dangerous for TLS
    },
    risk: 'HIGH',
    silentUntil: 'appears as certificate or JWT error in logs',
  },
  {
    id: 'HARDWARE_ID_CASE_MISMATCH',
    title: 'Device hardware_id case mismatch in Pulse Manage DB',
    description: 'Pulse Manage normalises device.hardware_id to UPPERCASE since v1.05.03. Pre-upgrade records may have mixed case, causing "Invalid call point ID" in INGA. The mismatch is in the database, not in any log.',
    detection: {
      dbQuery: "SELECT id, name, hardware_id FROM devices WHERE hardware_id ~ '[a-z]' AND type != 'DEFAULT' LIMIT 20",
      database: 'config',
      host: '127.0.0.2',
    },
    risk: 'HIGH',
    silentUntil: '"Invalid call point ID" appears in INGA log',
  },
  {
    id: 'PUSH_TOKEN_NULL',
    title: 'Mobile user registered without push token',
    description: 'Mobile users who registered but whose device never sent an FCM token will have pushtoken=NULL in moga.userdata. All push notifications to them silently fail — no error logged anywhere. They just never receive alarms on their phone.',
    detection: {
      dbQuery: "SELECT username, devicetype, lastclientactivity FROM userdata WHERE pushtoken IS NULL OR pushtoken = ''",
      database: 'moga',
      host: '127.0.0.2',
    },
    risk: 'MEDIUM',
    silentUntil: 'mobile user reports not receiving alarms',
  },
  {
    id: 'RTLS_BADGES_ALL_EXPIRED',
    title: 'RTLS showing all badges as location_expired',
    description: 'If the third-party RTLS feed stops sending updates, all badge records in rtls.last_known will have location_expired=true. Staff presence cancellation stops working. No alarm raised anywhere — just silent stale data.',
    detection: {
      dbQuery: "SELECT COUNT(*) as total, SUM(CASE WHEN location_expired THEN 1 ELSE 0 END) as expired FROM last_known",
      database: 'rtls',
      host: '127.0.0.2',
      alertIfAllExpired: true,
    },
    risk: 'HIGH',
    silentUntil: 'someone notices alarms not being cancelled by staff',
  },
];

// ─── Startup dependency chain (ordered) ─────────────────────────────────────
// Must check in this order. A failure at any level explains failures below.

export const STARTUP_CHAIN = [
  // Level 0: Physical/Hypervisor
  { level: 0, id: 'hypervisor', label: 'Hypervisor (Proxmox/ESXi)', check: 'hypervisor_reachable' },
  // Level 1: OS and infrastructure
  { level: 1, id: 'os', label: 'ACS VM (OS)', check: 'ssh_reachable' },
  { level: 1, id: 'time', label: 'System Time / NTP', check: 'time_sync', silentFailure: true },
  { level: 1, id: 'disk', label: 'Disk Space', check: 'disk_threshold_20pct', silentFailure: true },
  // Level 2: Core platform services
  { level: 2, id: 'postgresql', label: 'PostgreSQL', check: 'pg_reachable_127_0_0_2' },
  { level: 2, id: 'daemontools', label: 'Daemontools (svscan)', check: 'svscan_running' },
  { level: 2, id: 'docker', label: 'Docker daemon', check: 'docker_ps' },
  { level: 2, id: 'austco_bridge', label: 'austco_bridge network', check: 'docker_network_inspect' },
  // Level 3: Core Tacera services
  { level: 3, id: 'lmx_server', label: 'LM-X License Server', check: 'pgrep_lmx' },
  { level: 3, id: 'ipconnect', label: 'IP-Connect (XmlBlaster)', check: 'pgrep_xcareserver' },
  // Level 4: Dependent services (need lmx + ipconnect + austco_bridge)
  { level: 4, id: 'license_service_api', label: 'License Service API', check: 'docker_license_service' },
  { level: 4, id: 'pulse_gateway', label: 'Pulse Gateway', check: 'docker_pulse_gateway' },
  { level: 4, id: 'integration_gateway', label: 'Integration Gateway', check: 'pgrep_inga' },
  { level: 4, id: 'pulse_manage', label: 'Pulse Manage (config-api)', check: 'docker_config_api' },
  // Level 5: Modules that pull config from Pulse Manage at startup
  { level: 5, id: 'rtls_gateway', label: 'RTLS Gateway', check: 'pgrep_rtls' },
  { level: 5, id: 'mobile_gateway', label: 'Mobile Gateway', check: 'pgrep_moga' },
  { level: 5, id: 'mirth', label: 'Mirth Connect (HL7)', check: 'pgrep_mirth' },
  // Level 6: Pulse Device services (need austco_bridge + Pulse Manage)
  { level: 6, id: 'annunciator_server', label: 'Annunciator Server', check: 'docker_annunciator' },
  { level: 6, id: 'nursestation_server', label: 'Nurse Station Server', check: 'docker_nursestation' },
];

// ─── Webmin monitoring items and what they mean ──────────────────────────────
// Confirmed from recording frames 1 and 8 on 192.168.10.201

export const WEBMIN_MONITORS = {
  'Disk Space - SSD system (/)': {
    check: 'df /dev/sda1',
    redBelow: 20,  // disk_threshold=20% — from platform patch canApplyPlatformPatch()
    note: 'May show 100% incorrectly on pre-4.1.1 systems (ACS-1867 false positive)',
  },
  'Full Production Running Mode': {
    check: 'maintenanceMode()',
    note: 'Red = maintenance mode ON (svscan stopped). Should always be green in production.',
  },
  'License Service': {
    check: 'docker container list | grep license-service',
    note: 'Green = Docker container running',
  },
  'PostgreSQL Database Server': {
    check: 'pg_isready -h 127.0.0.2',
    note: 'Confirmed PostgreSQL 9.2.24 in recording',
  },
  'DHCP Server': {
    check: 'systemctl is-active isc-dhcp-server',
    note: 'CONFIRMED RED on 192.168.10.201 in recording. Often not needed — disable if not providing DHCP.',
  },
  'SMA Validity': {
    check: 'webservices-cli-client SMA check',
    note: 'SMA = Software Maintenance Agreement. Red = SMA expired or LMX cannot be reached.',
  },
  'License Validity': {
    check: 'webservices-cli-client license check',
    note: 'CONFIRMED RED on 192.168.10.201 in recording. Separate from License Service container.',
  },
  'Network interfaces up-to-date': {
    check: '/etc/hosts vs /etc/network/interfaces consistency',
    note: 'Had false positive bug pre-4.0.29 (ACS-1626). If red on patched system, check for real mismatch.',
  },
  'Fault Monitor': {
    check: 'Software Services (UT0021) fault monitor process',
    note: 'Green = fault monitor running',
  },
  'SSL Certificate Expiry': {
    check: 'openssl x509 -checkend on AustcoLocal.crt',
    note: 'Red = cert expires within warning threshold OR already expired',
  },
  'Disk Space - SSD data (/home)': {
    check: 'df /dev/drbd0 or /home partition',
    note: 'Application filesystem. Red below 20%.',
  },
};

// ─── austco.local DNS hostname → service mapping ─────────────────────────────

export const DNS_SERVICE_MAP = {
  'pulse.austco.local':         { service: 'pulse_gateway',         port: 443 },
  'ws.austco.local':            { service: 'integration_gateway',   port: 9443 },
  'config.austco.local':        { service: 'pulse_manage',          port: 51443 },
  'licensing.austco.local':     { service: 'license_service_api',   port: 51087 },
  'rtls.austco.local':          { service: 'rtls_gateway',          port: 9901 },
  'mobilegateway.austco.local': { service: 'mobile_gateway',        port: 9443 },
  'fileserver.austco.local':    { service: 'pulse_fileserver',      port: 12080 },
  'nursestation.austco.local':  { service: 'nursestation_server',   port: 12180 },
  'annunciator.austco.local':   { service: 'annunciator_server',    port: 12280 },
  'appstation.austco.local':    { service: 'appstation_server',     port: 12380 },
  'audio.austco.local':         { service: 'audio_service',         port: 12480 },
  'displaydriver.austco.local': { service: 'displaydriver_server',  port: 12580 },
  'touchpoint.austco.local':    { service: 'touchpoint_server',     port: 12780 },
  'hl7.austco.local':           { service: 'mirth',                 port: 12880 },
  'messaging.austco.local':     { service: 'messaging_service',     port: 51095 },
  'reports.austco.local':       { service: 'pulse_insights_api',    port: 51089 },
  'rules.austco.local':         { service: 'rules_engine',          port: 51081 },
  'vayyar.austco.local':        { service: 'vayyar_adapter',        port: 51085 },
  'mqtt.austco.local':          { service: 'mqtt_broker',           port: 51083 },
  'auth.austco.local':          { service: 'gluu_auth',             port: 443 },
};
