import { NodeSSH } from "node-ssh";

const ssh = new NodeSSH();

function creds() {
  return {
    username: process.env.TECH_USER || "tech",
    password: process.env.TECH_PASS || "",
  };
}

async function connect(host) {
  await ssh.connect({
    host,
    ...creds(),
    tryKeyboard: true,
    readyTimeout: 20000,
  });
}

async function run(host, command) {
  await connect(host);

  const r = await ssh.execCommand(command, {
    cwd: "/tmp"
  });

  ssh.dispose();

  return {
    host,
    command,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    code: r.code,
  };
}

export async function collectEvidence(host) {
  const cmds = {
    uptime: "uptime",
    date: "date",
    memory: "free -m",
    disk: "df -h",
    ports: "ss -tulpn",
    processes: "ps aux | grep -Ei 'java|xcare|pulse|gateway|integration|license|hl7|rtls|ipconnect|pst|cct' | grep -v grep",
    docker: "docker ps 2>/dev/null",
    webmin: "curl -k -I https://localhost:10000 2>/dev/null",
    pstLogs: "tail -120 /home/pst/log/ip_pst_app.log 2>/dev/null",
    xcareLogs: "grep -R -iE 'error|exception|failed|ssl|pkix|expired|invalid call point|not ready|BAD|disconnect|timeout|reset|watchdog' /home/xcare/runtime /var/opt/xcare/log 2>/dev/null | tail -200",
    network: "ip addr && ip route",
  };

  const out = {};

  for (const [k,v] of Object.entries(cmds)) {
    try {
      out[k] = await run(host, v);
    } catch (err) {
      out[k] = {
        host,
        command: v,
        error: err.message,
      };
    }
  }

  return {
    host,
    collectedAt: new Date().toISOString(),
    evidence: out,
  };
}
