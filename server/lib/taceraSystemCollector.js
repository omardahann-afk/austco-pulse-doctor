/**
 * taceraSystemCollector.js
 *
 * Performs a REAL sweep of an ACS VM via SSH, checking everything the logs
 * won't tell you. Returns structured evidence for each check.
 *
 * Architecture: Backend only. SSH creds never leave the server.
 * All commands go through execOverSsh with hardcoded command strings.
 * No free-form shell from frontend.
 */

import { execOverSsh } from './sshExecutor.js';
import { SILENT_PLATFORM_BUGS, MODULE_REGISTRY, WEBMIN_MONITORS, DNS_SERVICE_MAP, STARTUP_CHAIN } from './taceraSystemKnowledge.js';

const SSH_TIMEOUT = 10000;

function nowIso() { return new Date().toISOString(); }

/** Run a command and return { ok, stdout, stderr, durationMs } */
async function run(creds, cmd) {
  try {
    return await execOverSsh(creds, cmd, SSH_TIMEOUT);
  } catch (e) {
    return { ok: false, stdout: '', stderr: e.message, durationMs: 0 };
  }
}

/** Parse the Pulse Gateway manage-app.sh status output into structured data */
function parsePulseGatewayStatus(stdout) {
  const lines = stdout.split('\n');
  const passed = [];
  const failed = [];
  let containerRunning = false;
  let containerUptime = null;

  for (const line of lines) {
    if (/pulse-gateway:latest.*Up/i.test(line)) {
      containerRunning = true;
      const uptimeMatch = line.match(/Up\s+(.+?)\s+(?:Port|$)/i);
      if (uptimeMatch) containerUptime = uptimeMatch[1].trim();
    }
    const passMatch = line.match(/PASSED:\s+(\S+)\s+is reachable/);
    if (passMatch) passed.push(passMatch[1]);
    const failMatch = line.match(/FAILED:\s+(\S+)\s+is not reachable/);
    if (failMatch) failed.push(failMatch[1]);
  }

  return { containerRunning, containerUptime, passed, failed };
}

/** Parse df output for a specific mount point */
function parseDfPercent(stdout, mount = '/') {
  const lines = stdout.split('\n');
  for (const line of lines) {
    const match = line.match(/(\d+)%\s+(.+)/);
    if (match) {
      const pct = parseInt(match[1]);
      const mnt = match[2].trim();
      if (mnt === mount || mount === 'any') return pct;
    }
  }
  return null;
}

/** Parse cert expiry from openssl output */
function parseCertExpiry(stdout) {
  const match = stdout.match(/notAfter=(.+)/);
  if (!match) return null;
  try {
    return new Date(match[1].trim());
  } catch { return null; }
}

/** Parse ntpq offset */
function parseNtpOffset(stdout) {
  // Look for lines with * (synced peer) or system peer offset
  const lines = stdout.split('\n');
  for (const line of lines) {
    if (line.startsWith('*') || line.startsWith('+')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 9) {
        const offset = parseFloat(parts[8]);
        if (!isNaN(offset)) return offset; // ms
      }
    }
  }
  return null;
}

/**
 * Main sweep function. Returns a structured health report.
 * @param {object} creds - { host, port, username, password }
 * @param {object} serverConfig - { role, modules, hypervisor? }
 */
export async function sweepAcsServer(creds, serverConfig = {}) {
  const startedAt = nowIso();
  const findings = [];
  const evidence = {};

  function addFinding(id, severity, title, detail, fix = null, silent = false) {
    findings.push({ id, severity, title, detail, fix, silent, at: nowIso() });
  }

  // ─── 1. SSH reachability ─────────────────────────────────────────────────
  const sshTest = await run(creds, 'echo ssh_ok && hostname && uptime');
  if (!sshTest.ok) {
    return {
      ok: false,
      host: creds.host,
      error: 'SSH unreachable',
      findings: [{ id: 'SSH_UNREACHABLE', severity: 'CRITICAL', title: 'Server unreachable via SSH', detail: sshTest.stderr }],
      evidence: {},
      startedAt,
      finishedAt: nowIso(),
    };
  }
  evidence.hostname = sshTest.stdout.split('\n')[1]?.trim();
  evidence.uptime = sshTest.stdout.split('\n')[2]?.trim();

  // ─── 2. Platform version ─────────────────────────────────────────────────
  const pfVer = await run(creds, 'cat /usr/share/webmin/version 2>/dev/null; cat /etc/os-release 2>/dev/null | grep ACS_PLATFORM');
  evidence.platformVersion = pfVer.stdout.trim();

  // ─── 3. System time / NTP ────────────────────────────────────────────────
  const [timeResult, ntpResult] = await Promise.all([
    run(creds, 'date +%s && timedatectl 2>/dev/null | head -10'),
    run(creds, 'ntpq -p 2>/dev/null | head -20 || chronyc tracking 2>/dev/null | head -10'),
  ]);
  evidence.systemTime = timeResult.stdout;
  evidence.ntpStatus = ntpResult.stdout;

  const ntpOffset = parseNtpOffset(ntpResult.stdout);
  if (ntpOffset !== null && Math.abs(ntpOffset) > 5000) {
    addFinding('TIME_DRIFT', 'HIGH',
      `System time drift: ${ntpOffset.toFixed(0)}ms`,
      'Time drift >5s causes TLS cert validation failures and JWT auth errors. Will appear as cryptic PKIX/SSL errors, not as "wrong time".',
      'Sync NTP: ntpdate -u <ntp_server> or check /etc/ntp.conf',
      true  // silent failure mode
    );
  }
  if (!ntpResult.stdout.includes('*') && !ntpResult.stdout.includes('Reference')) {
    addFinding('NTP_NOT_SYNCED', 'MEDIUM',
      'NTP not synchronized',
      'No active NTP peer found. Time may drift causing authentication failures.',
      'Configure NTP in /etc/ntp.conf and restart ntp service',
      true
    );
  }

  // ─── 4. Disk space ───────────────────────────────────────────────────────
  const dfResult = await run(creds, 'df -h --output=source,pcent,target 2>/dev/null');
  evidence.diskUsage = dfResult.stdout;

  const rootPct = parseDfPercent(dfResult.stdout, '/');
  const homePct = parseDfPercent(dfResult.stdout, '/home');
  const varPct  = parseDfPercent(dfResult.stdout, '/var');

  if (rootPct !== null && rootPct > 80) {
    addFinding('DISK_ROOT_HIGH', rootPct > 90 ? 'CRITICAL' : 'HIGH',
      `Root filesystem ${rootPct}% full`,
      `Platform patch blocks at >80% (threshold 20% free). At ${rootPct}%, upgrades impossible and services may start failing.`,
      'Check /var/log/ — use: du --separate-dirs -h /var/log/ | sort -h -r | head -5',
    );
  }
  if (homePct !== null && homePct > 80) {
    addFinding('DISK_HOME_HIGH', homePct > 90 ? 'CRITICAL' : 'HIGH',
      `Application filesystem (/home) ${homePct}% full`,
      'Tacera logs, runtime files, and Docker images live here. At >80%, services can crash.',
      'Check: du --separate-dirs -h /home/xcare/runtime/ | sort -h -r | head -10',
    );
  }

  // Check for /var as separate mount (should exist on patched 4.0.43+ systems)
  const varMounted = dfResult.stdout.includes('/var') && !dfResult.stdout.match(/\d+%\s+\/$/m);
  if (!varMounted) {
    addFinding('VAR_NOT_SEPARATE', 'MEDIUM',
      '/var not a separate filesystem',
      'Pre-4.0.43 systems: logging can fill root filesystem silently. ACS-1806 fix separates /var. Risk of full-system halt from excessive logs.',
      'Apply platform patch 4.0.43 or later',
      true  // silent failure mode
    );
  }

  // Check for large log files
  const largeLogResult = await run(creds,
    'find /var/log /home/xcare/runtime -name "*.log*" -size +100M -exec ls -lh {} \\; 2>/dev/null | head -10'
  );
  if (largeLogResult.stdout.trim()) {
    addFinding('LARGE_LOG_FILES', 'MEDIUM',
      'Large log files detected (>100MB)',
      largeLogResult.stdout.trim(),
      'Review and rotate logs. Do not delete active .log files — truncate: > /path/to/file.log',
      true
    );
  }

  // ─── 5. Daemontools (svscan) ─────────────────────────────────────────────
  const svscanResult = await run(creds, 'systemctl is-active svscan.service 2>/dev/null || svstat /service/ 2>/dev/null | head -20');
  evidence.svscanStatus = svscanResult.stdout.trim();
  if (svscanResult.stdout.includes('inactive') || svscanResult.stdout.includes('failed')) {
    addFinding('SVSCAN_STOPPED', 'CRITICAL',
      'Daemontools (svscan) is not running',
      'svscan manages IP-Connect, INGA, RTLS Gateway, MoGa, LMX, Mirth. All daemontools-managed services are down.',
      'systemctl start svscan.service',
    );
  }

  // ─── 6. PostgreSQL ───────────────────────────────────────────────────────
  const pgResult = await run(creds,
    "psql postgres -h 127.0.0.2 -c '\\l' 2>&1 | head -20"
  );
  evidence.postgresql = pgResult.stdout;

  if (!pgResult.ok || pgResult.stdout.includes('could not connect')) {
    addFinding('PG_DOWN', 'CRITICAL',
      'PostgreSQL unreachable at 127.0.0.2',
      'All Tacera databases (eventlog, config, licensing, moga, rtls, audit_db) are inaccessible. All services will fail.',
      'sudo service postgresql start',
    );
  } else {
    // Check timezone
    const tzResult = await run(creds,
      "grep '^timezone' /home/xcare/db/data/postgresql.conf 2>/dev/null"
    );
    if (tzResult.stdout && !tzResult.stdout.includes("'localtime'")) {
      addFinding('PG_TIMEZONE_WRONG', 'HIGH',
        `PostgreSQL timezone incorrectly set: ${tzResult.stdout.trim()}`,
        "Should be timezone = 'localtime'. Wrong value causes postgres to fail to restart after DB purge (ACS-1899). Silent until restart is attempted.",
        "sed -i \"s/^(timezone\\s=).*/\\1 'localtime'/\" /home/xcare/db/data/postgresql.conf && service postgresql restart",
        true  // silent failure mode
      );
    }

    // Check licensing DB for violations
    const licViolation = await run(creds,
      "psql postgres -h 127.0.0.2 -d licensing -c \"SELECT deferred_start_timestamp_utc, violation_start_timestamp_utc FROM status WHERE id=1;\" 2>/dev/null"
    );
    evidence.licenseDbStatus = licViolation.stdout;
    if (licViolation.stdout && !licViolation.stdout.includes('null') && licViolation.stdout.match(/\d{4}-\d{2}-\d{2}/)) {
      const isViolation = licViolation.stdout.split('\n').some(l => l.includes('violation') && l.match(/\d{4}/));
      if (isViolation) {
        addFinding('LICENSE_VIOLATION_DB', 'CRITICAL',
          'License violation recorded in licensing database',
          `violation_start_timestamp_utc is non-null. IP-Connect may have been force-stopped by licensing. Detail: ${licViolation.stdout.trim()}`,
          'Check license file contents and LMX status. Resolve license issue then restart IP-Connect.',
        );
      }
    }

    // Check RTLS for expired badges
    const rtlsExpired = await run(creds,
      "psql postgres -h 127.0.0.2 -d rtls -c \"SELECT COUNT(*) as total, SUM(CASE WHEN location_expired THEN 1 ELSE 0 END) as expired FROM last_known;\" 2>/dev/null"
    );
    evidence.rtlsBadgeStatus = rtlsExpired.stdout;
    const expiredMatch = rtlsExpired.stdout.match(/(\d+)\s+\|\s+(\d+)/);
    if (expiredMatch) {
      const total = parseInt(expiredMatch[1]);
      const expired = parseInt(expiredMatch[2]);
      if (total > 0 && expired === total) {
        addFinding('RTLS_ALL_BADGES_EXPIRED', 'HIGH',
          `All ${total} RTLS badges show location_expired=true`,
          'RTLS third-party feed has stopped sending updates. Staff presence cancellation is silently not working. No error logged anywhere.',
          'Check the third-party RTLS system feed / integration to RTLS Gateway.',
          true  // silent failure mode
        );
      } else if (total > 0 && expired > total * 0.8) {
        addFinding('RTLS_MOST_BADGES_EXPIRED', 'MEDIUM',
          `${expired}/${total} RTLS badges expired`,
          'Most badges are showing stale location data. RTLS feed may be degraded.',
          'Investigate RTLS Gateway logs and third-party feed.',
          true
        );
      }
    }

    // Check Pulse Manage config for RTLS staff presence config
    const rtlsConfig = await run(creds,
      "wget -qO- 'http://127.0.0.1:51080/api/Applications?name=RTLS+Gateway' 2>/dev/null | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get('default_config',''))\" 2>/dev/null"
    );
    if (rtlsConfig.stdout.includes('staffPresenceCancelCallTypesAllowed') &&
        rtlsConfig.stdout.includes('[]')) {
      addFinding('RTLS_PRESENCE_EMPTY_LIST', 'HIGH',
        'RTLS staffPresenceCancelCallTypesAllowed is empty',
        'In RTLS Gateway v3.9+ (Tacera 4.35+), empty list means NO alarms cancelled by staff presence. If upgraded from pre-4.35, this was previously "all types". Alarms are silently not being cancelled.',
        'In Pulse Manage → RTLS Gateway → staffPresenceCancelCallTypesAllowed: add alarm types that should be cancelled.',
        true  // silent failure mode
      );
    }

    // Check moga push tokens
    const nullPushTokens = await run(creds,
      "psql postgres -h 127.0.0.2 -d moga -c \"SELECT COUNT(*) FROM userdata WHERE pushtoken IS NULL OR pushtoken = '';\" 2>/dev/null"
    );
    evidence.nullPushTokens = nullPushTokens.stdout;
    const nullCount = parseInt((nullPushTokens.stdout.match(/\s(\d+)\s/) || [])[1]);
    if (nullCount > 0) {
      addFinding('MOBILE_PUSH_TOKEN_NULL', 'MEDIUM',
        `${nullCount} mobile user(s) have no push token`,
        'These users will silently not receive alarm push notifications. They registered in MoGa but their device never sent an FCM token.',
        'Ask affected users to log out and back in to Pulse Mobile, or re-register the device.',
        true  // silent failure mode
      );
    }

    // Check hardware_id case mismatch
    const hwIdCase = await run(creds,
      "psql postgres -h 127.0.0.2 -d config -c \"SELECT COUNT(*) FROM devices WHERE hardware_id IS NOT NULL AND hardware_id ~ '[a-z]' AND NOT(type = 'DEFAULT');\" 2>/dev/null"
    );
    const hwCaseCount = parseInt((hwIdCase.stdout.match(/\s(\d+)\s/) || [])[1]);
    if (hwCaseCount > 0) {
      addFinding('HARDWARE_ID_CASE_MISMATCH', 'HIGH',
        `${hwCaseCount} device(s) have lowercase hardware_id in Pulse Manage DB`,
        'These will cause "Invalid call point ID" errors in INGA. Pulse Manage normalises to UPPERCASE since v1.05.03, but pre-upgrade records may still have mixed case.',
        "psql postgres -h 127.0.0.2 -d config -c \"UPDATE devices SET hardware_id = UPPER(hardware_id) WHERE hardware_id IS NOT NULL AND NOT(type = 'DEFAULT');\"",
        true  // silent failure mode
      );
    }
  }

  // ─── 7. Docker ───────────────────────────────────────────────────────────
  const dockerResult = await run(creds, "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Image}}' 2>/dev/null");
  evidence.dockerContainers = dockerResult.stdout;

  const runningContainers = dockerResult.stdout.split('\n')
    .filter(l => l.trim())
    .map(l => { const [name, status, image] = l.split('\t'); return { name, status, image }; });

  // Check austco_bridge network
  const bridgeResult = await run(creds, 'docker network inspect austco_bridge 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0][\'Driver\'], len(d[0].get(\'Containers\',{})), \'containers\')" 2>/dev/null');
  evidence.dockerBridge = bridgeResult.stdout;
  if (!bridgeResult.ok || bridgeResult.stdout.includes('Error')) {
    addFinding('AUSTCO_BRIDGE_MISSING', 'CRITICAL',
      'austco_bridge Docker network missing or failed',
      'This single failure takes down ALL Docker services simultaneously: Pulse Gateway, config-api, license-service, annunciator, nursestation, ADX. Known to occur after VPN activation.',
      'docker network create --driver bridge austco_bridge',
    );
  }

  // Check essential containers
  const expectedContainers = [
    { name: 'pulse-gateway',   severity: 'CRITICAL' },
    { name: 'config-api',      severity: 'CRITICAL' },
    { name: 'license-service', severity: 'HIGH' },
    { name: 'annunciator',     severity: 'MEDIUM' },
    { name: 'nursestation',    severity: 'MEDIUM' },
  ];
  for (const { name, severity } of expectedContainers) {
    const running = runningContainers.find(c => c.name === name && c.status?.startsWith('Up'));
    if (!running) {
      const exists = runningContainers.find(c => c.name === name);
      addFinding(`CONTAINER_DOWN_${name.toUpperCase().replace(/-/g,'_')}`, severity,
        `Docker container '${name}' is ${exists ? 'not running (exited)' : 'missing'}`,
        exists ? `Container exists but status: ${exists.status}` : 'Container not found at all.',
        `docker restart ${name}`,
      );
    }
  }

  // ─── 8. Process checks (daemontools services) ─────────────────────────────
  const processChecks = [
    { id: 'IPCONNECT',          pattern: 'XCareServer',              name: 'IP-Connect',           severity: 'CRITICAL' },
    { id: 'INGA',               pattern: 'integration-gateway.war',   name: 'Integration Gateway',  severity: 'CRITICAL' },
    { id: 'LMX',                pattern: '/home/xcare/runtime/lmx/lmx-serv', name: 'LM-X License Server', severity: 'CRITICAL' },
    { id: 'RTLS',               pattern: 'rtls-gateway.war',          name: 'RTLS Gateway',         severity: 'HIGH' },
    { id: 'MOGA',               pattern: 'mobilegateway.war',         name: 'Mobile Gateway',       severity: 'HIGH' },
    { id: 'MIRTH',              pattern: 'mcservice',                 name: 'Mirth Connect (HL7)',  severity: 'MEDIUM' },
  ];

  const pgrepResults = await Promise.all(
    processChecks.map(p => run(creds, `pgrep -f "${p.pattern}" > /dev/null 2>&1 && echo running || echo not-running`))
  );

  for (let i = 0; i < processChecks.length; i++) {
    const p = processChecks[i];
    const r = pgrepResults[i];
    if (r.stdout.trim() === 'not-running') {
      addFinding(`PROCESS_DOWN_${p.id}`, p.severity,
        `${p.name} process not running`,
        `pgrep -f "${p.pattern}" returned nothing`,
        p.id === 'IPCONNECT' ? '/opt/xcare/xcaresrv restart' : `manage-app.sh enable`,
      );
    }
    evidence[`process_${p.id.toLowerCase()}`] = r.stdout.trim();
  }

  // ─── 9. Daemontools service link checks ──────────────────────────────────
  const dtLinks = await run(creds,
    'for s in integration-gateway rtls-gateway mobilegateway lmxserv mirth dataextraction; do [ -h /service/$s ] && echo "LINKED: $s" || echo "MISSING: $s"; done'
  );
  evidence.daemontoolsLinks = dtLinks.stdout;
  for (const line of dtLinks.stdout.split('\n')) {
    if (line.startsWith('MISSING:')) {
      const svc = line.replace('MISSING: ', '').trim();
      addFinding(`DT_LINK_MISSING_${svc.toUpperCase().replace(/-/g,'_')}`, 'HIGH',
        `Daemontools service link missing: /service/${svc}`,
        `Service '${svc}' is disabled (symlink removed). It will not auto-restart.`,
        `manage-app.sh enable  # for this service`,
      );
    }
  }

  // ─── 10. Certificate check ────────────────────────────────────────────────
  const certResult = await run(creds,
    'openssl x509 -enddate -noout -in /home/xcare/runtime/certs/etc/AustcoLocal.crt 2>/dev/null && openssl x509 -checkend 2592000 -noout -in /home/xcare/runtime/certs/etc/AustcoLocal.crt 2>/dev/null && echo "CERT_VALID_30DAYS" || echo "CERT_EXPIRING_SOON"'
  );
  evidence.certStatus = certResult.stdout;

  const expiry = parseCertExpiry(certResult.stdout);
  if (expiry) {
    const daysLeft = Math.floor((expiry - Date.now()) / 86400000);
    if (daysLeft < 0) {
      addFinding('CERT_EXPIRED', 'CRITICAL',
        `AustcoLocal.crt EXPIRED ${Math.abs(daysLeft)} days ago`,
        `Expired: ${expiry.toISOString()}. Pulse Gateway, INGA, Pulse Manage, License Service all refuse to start with an expired cert.`,
        'Replace cert: cp new-AustcoLocal.crt /home/xcare/runtime/certs/etc/ && restart all services',
      );
    } else if (daysLeft < 30) {
      addFinding('CERT_EXPIRING_SOON', 'HIGH',
        `AustcoLocal.crt expires in ${daysLeft} days`,
        `Expires: ${expiry.toISOString()}. SSL certs must be updated annually. Plan renewal now.`,
        'Run the SSL Certificate Updater tool from Webmin Toolbox.',
      );
    }
  } else if (certResult.stderr?.includes('No such file')) {
    addFinding('CERT_FILE_MISSING', 'CRITICAL',
      'AustcoLocal.crt not found at expected path',
      '/home/xcare/runtime/certs/etc/AustcoLocal.crt is missing. Pulse Gateway will not start.',
      'Run SSL Certificate Updater tool or restore cert from backup.',
    );
  }

  // ─── 11. DNS configuration check ─────────────────────────────────────────
  const dnsResult = await run(creds, 'cat /etc/resolv.conf 2>/dev/null');
  evidence.dnsConfig = dnsResult.stdout;
  const nameservers = (dnsResult.stdout.match(/^nameserver\s+(\S+)/gm) || []).map(l => l.split(/\s+/)[1]);
  if (nameservers.length < 2) {
    addFinding('DNS_SINGLE_ENTRY', 'MEDIUM',
      'Only one DNS server configured',
      `Found: ${nameservers.join(', ')}. Build cheat sheet requires 127.0.0.1 PLUS eth0 of PuGa host. Without second entry, austco.local may fail intermittently.`,
      'Add PuGa host eth0 IP as second nameserver in /etc/resolv.conf or Webmin LAN Configuration.',
      true  // silent failure mode
    );
  }

  // ─── 12. DHCP server check ────────────────────────────────────────────────
  const dhcpResult = await run(creds, 'systemctl is-active isc-dhcp-server 2>/dev/null');
  evidence.dhcpStatus = dhcpResult.stdout.trim();
  if (dhcpResult.stdout.trim() === 'active') {
    addFinding('DHCP_RUNNING', 'MEDIUM',
      'DHCP server is running',
      'Confirmed active in Webmin Monitoring on this server type. DHCP should only run on ACS VMs intentionally providing DHCP. If not needed, it causes IP conflicts.',
      'systemctl stop isc-dhcp-server && systemctl disable isc-dhcp-server',
    );
  }

  // ─── 13. INGA app.properties IPC IP check ────────────────────────────────
  const ingaProps = await run(creds,
    "grep 'acs.ipaddresses' /home/xcare/runtime/integration-gateway/etc/app.properties 2>/dev/null"
  );
  evidence.ingaIpcAddresses = ingaProps.stdout.trim();
  if (ingaProps.ok && !ingaProps.stdout.trim()) {
    addFinding('INGA_NO_IPC_IPS', 'HIGH',
      'Integration Gateway has no IPC server IPs configured',
      'acs.ipaddresses is empty or missing in app.properties. INGA will not subscribe to any IP-Connect XmlBlaster nodes. No alarms will flow. No error in any log.',
      'In Webmin Toolbox → Integration Gateway application properties: add eth0 IP of each floor controller.',
      true  // silent failure mode
    );
  }

  // ─── 14. Pulse Gateway status (full health check) ─────────────────────────
  const pgStatus = await run(creds,
    '/home/xcare/runtime/pulse-gateway/bin/manage-app.sh status 2>/dev/null'
  );
  evidence.pulseGatewayStatus = pgStatus.stdout;
  if (pgStatus.ok) {
    const pgParsed = parsePulseGatewayStatus(pgStatus.stdout);
    evidence.pulseGatewayParsed = pgParsed;
    if (pgParsed.failed.length > 0) {
      const services = pgParsed.failed.map(h => `${h}.austco.local`);
      addFinding('PUGA_DNS_FAILURES', 'HIGH',
        `Pulse Gateway: ${pgParsed.failed.length} service(s) unreachable`,
        `Failed: ${services.join(', ')}. These services are not resolving from the Pulse Gateway's DNS or are not running.`,
        'Check if the failed containers are running and that DNS entries exist for them.',
      );
    }
  }

  // ─── 15. Asterisk (floor controllers only) ────────────────────────────────
  if (serverConfig.role === 'floor_controller') {
    const asteriskResult = await run(creds, 'pgrep -f asterisk > /dev/null && echo running || echo not-running');
    evidence.asteriskStatus = asteriskResult.stdout.trim();
    if (asteriskResult.stdout.trim() === 'not-running') {
      addFinding('ASTERISK_DOWN', 'HIGH',
        'Asterisk PBX not running',
        'SIP/VoIP calls from Pulse Devices and Pulse Mobile will fail. WebDevices (Cisco/Spectralink) auto-dial will not work.',
        'service asterisk start',
      );
    }

    // Check Asterisk log size (ACS-1918 — can fill disk silently)
    const asteriskLogSize = await run(creds, 'du -sh /var/log/asterisk/ 2>/dev/null');
    evidence.asteriskLogSize = asteriskLogSize.stdout.trim();
    const sizeMb = parseFloat((asteriskLogSize.stdout.match(/^([\d.]+)M/) || [])[1]);
    if (sizeMb > 500) {
      addFinding('ASTERISK_LOG_LARGE', 'MEDIUM',
        `Asterisk logs: ${asteriskLogSize.stdout.trim()}`,
        'Asterisk logs can grow without bound on pre-4.1.1 systems. Risk of filling disk silently.',
        'Rotate logs: logrotate -f /etc/logrotate.d/asterisk',
        true
      );
    }
  }

  // ─── 16. License file check ───────────────────────────────────────────────
  const licFiles = await run(creds, 'ls -la /home/xcare/runtime/license-service/etc/lic/ 2>/dev/null');
  evidence.licenseFiles = licFiles.stdout;
  if (!licFiles.stdout.match(/\.lic/)) {
    addFinding('NO_LICENSE_FILES', 'CRITICAL',
      'No .lic license files found',
      '/home/xcare/runtime/license-service/etc/lic/ contains no .lic files. IP-Connect will not start.',
      'Add license file via Webmin Toolbox → License Service - Add a license.',
    );
  }

  // ─── 17. Syslog/daemon.log size check (ACS-1894) ─────────────────────────
  const syslogSize = await run(creds, 'du -sh /var/log/syslog /var/log/daemon.log 2>/dev/null');
  evidence.syslogSize = syslogSize.stdout;
  for (const line of syslogSize.stdout.split('\n')) {
    const match = line.match(/^([\d.]+)([MG])\s+(.+)/);
    if (match) {
      const size = parseFloat(match[1]);
      const unit = match[2];
      const file = match[3];
      if (unit === 'G' || (unit === 'M' && size > 200)) {
        addFinding('SYSLOG_LARGE', 'HIGH',
          `${file} is ${size}${unit} — risk of filling root filesystem`,
          'Pre-4.1.1: Tomcat/Asterisk stdout can fill syslog silently. ACS-1894.',
          `truncate -s 0 ${file}  # truncate, not delete — do not remove active log files`,
          true
        );
      }
    }
  }

  // ─── Classify and summarise ───────────────────────────────────────────────
  const criticals = findings.filter(f => f.severity === 'CRITICAL').length;
  const highs = findings.filter(f => f.severity === 'HIGH').length;
  const silentFindings = findings.filter(f => f.silent);

  return {
    ok: true,
    host: creds.host,
    hostname: evidence.hostname,
    finishedAt: nowIso(),
    startedAt,
    summary: {
      totalFindings: findings.length,
      criticals,
      highs,
      mediums: findings.filter(f => f.severity === 'MEDIUM').length,
      silentIssuesFound: silentFindings.length,
      overallState: criticals > 0 ? 'CRITICAL' : highs > 0 ? 'DEGRADED' : 'OK',
    },
    findings,
    evidence,
  };
}

/**
 * Sweep the Pulse Gateway status command specifically and return the
 * parsed DNS/service health map. Used for the real-time service map view.
 */
export async function sweepPulseGatewayStatus(creds) {
  const result = await run(creds, '/home/xcare/runtime/pulse-gateway/bin/manage-app.sh status 2>/dev/null');
  if (!result.ok) return { ok: false, error: result.stderr };
  return {
    ok: true,
    raw: result.stdout,
    parsed: parsePulseGatewayStatus(result.stdout),
    at: nowIso(),
  };
}

/**
 * Run the "Show Austco device peers" PCDLP discovery command.
 * Returns all ACS VMs visible on the network.
 */
export async function discoverAcsPeers(creds) {
  // This runs the Webmin custom command that uses PCDLP UDP 28724
  const result = await run(creds,
    '/home/xcare/scripts/show-peers.sh 2>/dev/null || ' +
    'timeout 5 perl -e \'use IO::Socket::INET; my $s=IO::Socket::INET->new(Proto=>"udp",LocalPort=>28724); while(1){$s->recv($d,1024); print "$d\n"; last;}\' 2>/dev/null'
  );
  return { ok: result.ok, raw: result.stdout, at: nowIso() };
}
