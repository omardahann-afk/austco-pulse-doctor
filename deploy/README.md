# Tacera Doctor — Ubuntu VM Appliance

This document covers installing the Tacera Doctor diagnostic appliance on
an Ubuntu 22.04+ VM and exporting it as an OVA.

## 1. Architecture

| Service  | Port | What it does |
|----------|------|--------------|
| Frontend | 8080 | Static Vite build (Command Center, Diagnosis, Logs, Escalation) |
| Backend  | 3001 | Node agent that runs real `ping`, DNS, TCP, log parsing |

The frontend runs entirely in the technician's browser and talks to the
backend over HTTP. The backend URL is configurable in the UI footer
(default `http://localhost:3001`) and saved to the browser's localStorage.

## 2. Install on a fresh Ubuntu VM

```bash
# Prereqs
sudo apt-get update
sudo apt-get install -y nodejs npm iputils-ping dnsutils
# Optional but recommended diagnostic tools:
sudo apt-get install -y nmap snmp traceroute

# Create app user + folder
sudo useradd -r -s /bin/bash -m -d /opt/tacera-doctor tacera
sudo chown -R tacera:tacera /opt/tacera-doctor

# Drop the source in /opt/tacera-doctor (rsync, git clone, scp, …)
# Then build + install deps:
cd /opt/tacera-doctor
sudo -u tacera npm install
sudo -u tacera npm run build
sudo -u tacera npm run backend:install
```

## 3. Run it once to verify

```bash
# In the project root, as the tacera user:
sudo -u tacera npm run start:all
# Open http://<VM-IP>:8080 in a browser on the same network.
# Backend health check:
curl http://localhost:3001/api/health
```

## 4. Install as systemd services (production)

```bash
sudo cp deploy/tacera-doctor-backend.service /etc/systemd/system/
sudo cp deploy/tacera-doctor-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tacera-doctor-backend
sudo systemctl enable --now tacera-doctor-frontend
sudo systemctl status tacera-doctor-backend tacera-doctor-frontend
```

The backend unit grants `CAP_NET_RAW` so unprivileged `ping` works.

## 5. Verify

| Check | Command |
|-------|---------|
| Backend up | `curl http://localhost:3001/api/health` |
| Frontend up | `curl -I http://localhost:8080` |
| Real ping from agent | enter a known IP in Command Center → Run Diagnosis |

## 6. Export as OVA (VirtualBox / VMware)

1. Shut the VM down cleanly.
2. **VirtualBox**: `File → Export Appliance → OVF 2.0`.
3. **VMware**: `File → Export to OVF`.
4. Distribute the resulting `.ova`. On import the VM keeps the same fixed
   software but gets a fresh MAC/IP from the customer's DHCP.

## 7. Honest limitations

- `nmap`, `snmp`, `traceroute` are **optional**. If they are not installed,
  the diagnosis surfaces "tool not installed" rather than fabricating a
  result.
- The backend binds to `0.0.0.0` by default so the technician can reach it
  from a laptop. Set `BIND_HOST=127.0.0.1` in the systemd unit if you want
  localhost-only.
- No customer data leaves the VM. There is no cloud dependency.
