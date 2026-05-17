/**
 * repairEngine.js
 *
 * Generates exact, executable repair plans for each root cause type.
 * Every repair step is: label, command (if safe), risk, verify command.
 *
 * HIGH/CRITICAL risk steps are shown as instructions only — never auto-executed.
 */

export const REPAIR_PLANS = {

  PST_TCP_FAILURE: {
    title: 'Fix PST TCP transport socket failure',
    steps: [
      { label: 'Check PST process is running', cmd: 'pgrep -f ip_pst_app && echo running || echo stopped', risk: 'LOW' },
      { label: 'Check PST log for socket error', cmd: 'tail -50 /home/pst/log/ip_pst_app.log 2>/dev/null', risk: 'LOW' },
      { label: 'Ping IP-Connect server from PST', cmd: 'ping -c 3 <IPC_IP>', risk: 'LOW' },
      { label: 'Check IPC port open from PST', cmd: 'bash -lc "exec 3<>/dev/tcp/<IPC_IP>/7607 && echo open || echo closed"', risk: 'LOW' },
      { label: 'Verify IPC IP in PST config', risk: 'MANUAL', instruction: 'Check PST device configuration — Server IP must match eth0 of the floor controller running IP-Connect. Default config path on device: /home/pst/config/ip_pst_app.cfg' },
      { label: 'Restart PST app', cmd: 'pkill -f ip_pst_app && sleep 2 && /home/pst/bin/ip_pst_app &', risk: 'MEDIUM' },
    ],
    verifyCmd: 'tail -20 /home/pst/log/ip_pst_app.log 2>/dev/null | grep -v "TCP socket connection is unsuccessful"',
    verifyExpect: 'No TCP socket failure lines',
  },

  XMLBLASTER_DISCONNECT: {
    title: 'Restore XmlBlaster / IP-Connect connectivity',
    steps: [
      { label: 'Check IP-Connect process', cmd: 'pgrep -f XCareServer && echo running || echo NOT_RUNNING', risk: 'LOW' },
      { label: 'Check IP-Connect log', cmd: 'tail -50 /var/opt/xcare/log/xcare00.log 2>/dev/null', risk: 'LOW' },
      { label: 'Check license status', cmd: 'pgrep -f lmx-serv && echo lmx_running || echo lmx_NOT_RUNNING', risk: 'LOW' },
      { label: 'Check daemontools svscan', cmd: 'systemctl is-active svscan.service', risk: 'LOW' },
      { label: 'Restart IP-Connect', cmd: '/opt/xcare/xcaresrv restart', risk: 'MEDIUM', requiresApproval: true },
    ],
    verifyCmd: 'pgrep -f XCareServer && echo running',
    verifyExpect: 'running',
  },

  LICENSE_PLUGIN_FAILURE: {
    title: 'Resolve license plugin failure',
    steps: [
      { label: 'Check LMX process', cmd: 'pgrep -f lmx-serv && echo running || echo stopped', risk: 'LOW' },
      { label: 'Check LMX log', cmd: 'tail -30 /home/xcare/runtime/lmx/logs/lmx-serv.log 2>/dev/null', risk: 'LOW' },
      { label: 'List license files', cmd: 'ls -la /home/xcare/runtime/license-service/etc/lic/ 2>/dev/null', risk: 'LOW' },
      { label: 'Check host ID (must match .lic file)', cmd: 'dmidecode -s system-uuid', risk: 'LOW' },
      { label: 'Check licensing DB for violation timestamp', cmd: 'psql postgres -h 127.0.0.2 -d licensing -c "SELECT * FROM status WHERE id=1;" 2>/dev/null', risk: 'LOW' },
      { label: 'Restart License Service', risk: 'MANUAL', instruction: 'Run manage-app.sh enable for license-service. This starts LMX first then the Docker API. Do not restart IP-Connect until license is confirmed valid.' },
    ],
    verifyCmd: 'docker container list | grep license-service',
    verifyExpect: 'license-service.*Up',
  },

  CERT_FAILURE: {
    title: 'Resolve certificate / TLS failure',
    steps: [
      { label: 'Check cert expiry date', cmd: 'openssl x509 -enddate -noout -in /home/xcare/runtime/certs/etc/AustcoLocal.crt 2>/dev/null', risk: 'LOW' },
      { label: 'Check system time (wrong clock = false expiry)', cmd: 'date && timedatectl 2>/dev/null | head -5', risk: 'LOW' },
      { label: 'Check NTP sync', cmd: 'ntpq -p 2>/dev/null | head -10', risk: 'LOW' },
      { label: 'Run SSL Certificate Updater', risk: 'MANUAL', instruction: 'In Webmin Toolbox → SSL Certificates Environment → Run certificate updater. Or from shell: /home/xcare/scripts/update-ssl-certs.sh. Restart all services after.' },
    ],
    verifyCmd: 'openssl x509 -checkend 86400 -noout -in /home/xcare/runtime/certs/etc/AustcoLocal.crt && echo valid',
    verifyExpect: 'valid',
  },

  INVALID_CALLPOINT: {
    title: 'Fix invalid callpoint / signal mapping',
    steps: [
      { label: 'Find affected callpoint IDs in INGA log', cmd: 'grep -h "Invalid call point ID" /home/xcare/runtime/integration-gateway/logs/app.log 2>/dev/null | tail -20', risk: 'LOW' },
      { label: 'Check INGA app.properties IPC IPs', cmd: 'grep acs.ipaddresses /home/xcare/runtime/integration-gateway/etc/app.properties 2>/dev/null', risk: 'LOW' },
      { label: 'Check Pulse Manage devices for case mismatch', cmd: 'psql postgres -h 127.0.0.2 -d config -c "SELECT id, name, hardware_id FROM devices WHERE hardware_id IS NOT NULL AND hardware_id ~ \'[a-z]\' LIMIT 10;" 2>/dev/null', risk: 'LOW' },
      { label: 'Fix lowercase hardware_ids', risk: 'MANUAL', instruction: 'Run: psql postgres -h 127.0.0.2 -d config -c "UPDATE devices SET hardware_id = UPPER(hardware_id) WHERE hardware_id IS NOT NULL AND NOT(type = \'DEFAULT\');" Then restart INGA.' },
      { label: 'Compare CCP against active callpoints', risk: 'MANUAL', instruction: 'Use Webmin Toolbox → Current Active Call Points to list active IDs on IPC. Compare against CCP loaded in INGA. Re-upload CCP if mismatch.' },
    ],
    verifyCmd: 'grep -c "Invalid call point ID" /home/xcare/runtime/integration-gateway/logs/app.log 2>/dev/null',
    verifyExpect: '0',
  },

  DOCKER_BRIDGE_FAILURE: {
    title: 'Restore austco_bridge Docker network',
    steps: [
      { label: 'Inspect bridge network', cmd: 'docker network inspect austco_bridge 2>/dev/null | head -20', risk: 'LOW' },
      { label: 'List all Docker networks', cmd: 'docker network ls', risk: 'LOW' },
      { label: 'Recreate austco_bridge', cmd: 'docker network create --driver bridge austco_bridge', risk: 'MEDIUM', requiresApproval: true },
      { label: 'Restart Pulse Gateway', cmd: 'docker restart pulse-gateway', risk: 'MEDIUM', requiresApproval: true },
      { label: 'Restart config-api', cmd: 'docker restart config-api', risk: 'MEDIUM', requiresApproval: true },
      { label: 'Check all containers', cmd: "docker ps --format '{{.Names}}\\t{{.Status}}'", risk: 'LOW' },
    ],
    verifyCmd: '/home/xcare/runtime/pulse-gateway/bin/manage-app.sh status 2>/dev/null | grep -c PASSED',
    verifyExpect: '20',
  },

  DOCKER_CONTAINER_DOWN: {
    title: 'Restart stopped Docker container',
    steps: [
      { label: 'Check all containers', cmd: "docker ps -a --format '{{.Names}}\\t{{.Status}}'", risk: 'LOW' },
      { label: 'Check bridge network', cmd: 'docker network inspect austco_bridge 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d[0][\'Containers\']), \'containers on bridge\')"', risk: 'LOW' },
      { label: 'Restart affected container', risk: 'MANUAL', instruction: 'docker restart <container-name>. Restart order if multiple down: 1. pulse-gateway 2. config-api 3. license-service 4. annunciator/nursestation' },
    ],
    verifyCmd: "docker ps --format '{{.Names}}\\t{{.Status}}' | grep -c 'Up'",
    verifyExpect: '>0',
  },

  DB_FAILURE: {
    title: 'Restore PostgreSQL database',
    steps: [
      { label: 'Check PostgreSQL process', cmd: 'pgrep -f postgres && echo running || echo stopped', risk: 'LOW' },
      { label: 'Check DB reachability', cmd: 'psql postgres -h 127.0.0.2 -c "\\l" 2>&1 | head -5', risk: 'LOW' },
      { label: 'Check timezone setting', cmd: "grep '^timezone' /home/xcare/db/data/postgresql.conf 2>/dev/null", risk: 'LOW' },
      { label: 'Fix timezone if wrong', cmd: "sed -i \"s/^timezone.*/timezone = 'localtime'/\" /home/xcare/db/data/postgresql.conf", risk: 'MEDIUM', requiresApproval: true },
      { label: 'Start PostgreSQL', cmd: 'sudo service postgresql start', risk: 'MEDIUM', requiresApproval: true },
    ],
    verifyCmd: 'psql postgres -h 127.0.0.2 -c "\\l" 2>/dev/null | grep -c postgres',
    verifyExpect: '>0',
  },

  DISK_FULL: {
    title: 'Free disk space',
    steps: [
      { label: 'Check all disk usage', cmd: 'df -h', risk: 'LOW' },
      { label: 'Find largest files in runtime', cmd: 'du --separate-dirs -h /home/xcare/runtime/ 2>/dev/null | sort -h -r | head -10', risk: 'LOW' },
      { label: 'Find largest log files', cmd: 'find /var/log /home/xcare/runtime -name "*.log*" -size +50M -exec ls -lh {} \\; 2>/dev/null | head -10', risk: 'LOW' },
      { label: 'Truncate large active log files', risk: 'MANUAL', instruction: 'Do NOT delete active .log files. TRUNCATE them: > /path/to/file.log (the > operator truncates without removing). For rotated files (.log.1, .log.2) it is safe to delete.' },
    ],
    verifyCmd: "df -h / | awk 'NR==2{print $5}' | tr -d '%'",
    verifyExpect: '<80',
  },

  WATCHDOG_FAILURE: {
    title: 'Resolve IP-Connect watchdog failure',
    steps: [
      { label: 'Read IP-Connect log around watchdog event', cmd: 'grep -B5 -A5 -i watchdog /var/opt/xcare/log/xcare00.log 2>/dev/null | tail -30', risk: 'LOW' },
      { label: 'Check current IP-Connect state', cmd: 'pgrep -f XCareServer && echo running || echo stopped', risk: 'LOW' },
      { label: 'Restart IP-Connect', cmd: '/opt/xcare/xcaresrv restart', risk: 'MEDIUM', requiresApproval: true },
    ],
    verifyCmd: 'pgrep -f XCareServer && echo running',
    verifyExpect: 'running',
  },
};

/**
 * Get repair plan for a root cause type.
 * @param {string} rootCauseType
 * @param {object} context - { ip, role, sshCreds }
 */
export function getRepairPlan(rootCauseType, context = {}) {
  const plan = REPAIR_PLANS[rootCauseType];
  if (!plan) {
    return {
      title: 'No specific repair plan available',
      steps: [
        { label: 'Check system logs', cmd: 'journalctl -xe --no-pager -n 50', risk: 'LOW' },
        { label: 'Check all services', cmd: 'systemctl list-units --failed', risk: 'LOW' },
      ],
      verifyCmd: null,
    };
  }
  return { ...plan, rootCauseType, context };
}
