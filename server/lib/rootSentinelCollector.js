import { NodeSSH } from "node-ssh";

const rootHosts = String(process.env.ROOT_HOSTS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

function isAllowedRootHost(host) {
  return rootHosts.includes(host);
}

async function runRoot(host, command) {
  if (!isAllowedRootHost(host)) {
    throw new Error(\`Root collection blocked: \${host} is not in ROOT_HOSTS\`);
  }

  const ssh = new NodeSSH();

  await ssh.connect({
    host,
    username: process.env.ROOT_USER || "root",
    password: process.env.ROOT_PASS || "",
    readyTimeout: 20000,
    tryKeyboard: true,
  });

  const result = await ssh.execCommand(command, { cwd: "/tmp" });

  ssh.dispose();

  return {
    host,
    command,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    code: result.code,
  };
}

export async function collectRootSentinel(host) {
  const commands = {
    identity: "hostname; date; uptime; whoami",
    network: "hostname -I; ip addr; ip route; cat /etc/hosts; cat /etc/resolv.conf",
    resources: "df -h; free -m; top -b -n1 | head -60",
    ports: "ss -tulpn",
    servicesRunning: "systemctl --type=service --state=running --no-pager",
    servicesFailed: "systemctl --failed --no-pager",
    journalCritical: "journalctl -p warning..alert --since '2 hours ago' --no-pager | tail -300",
    docker: "docker ps; docker ps -a",
    dockerLogs: "for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do echo ==== $c ====; docker logs --tail=120 $c 2>&1; done",
    webmin: "systemctl status webmin --no-pager; tail -120 /var/webmin/miniserv.error 2>/dev/null; tail -80 /var/webmin/miniserv.log 2>/dev/null",
    taceraProcesses: "ps aux | grep -Ei 'java|xcare|pulse|gateway|integration|license|hl7|rtls|ipconnect|tomcat|annunciator|appstation' | grep -v grep",
    taceraErrors: "grep -R -iE 'error|severe|fatal|exception|failed|refused|expired|pkix|sslhandshake|invalid call point|not ready|disconnect|timeout|BAD|watchdog|reset' /home/xcare /var/opt/xcare 2>/dev/null | tail -500",
    certificates: "find /home/xcare /var/opt/xcare /etc -type f \\( -name '*.crt' -o -name '*.pem' -o -name '*.jks' -o -name '*.p12' \\) 2>/dev/null | head -300",
  };

  const evidence = {};

  for (const [name, command] of Object.entries(commands)) {
    try {
      evidence[name] = await runRoot(host, command);
    } catch (err) {
      evidence[name] = {
        host,
        command,
        error: err.message,
      };
    }
  }

  return {
    host,
    collectedAt: new Date().toISOString(),
    access: "root",
    evidence,
  };
}

export async function collectAllRootSentinels() {
  const results = [];

  for (const host of rootHosts) {
    results.push(await collectRootSentinel(host));
  }

  return {
    ok: true,
    collectedAt: new Date().toISOString(),
    hosts: rootHosts,
    results,
  };
}
