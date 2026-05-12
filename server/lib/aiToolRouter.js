import { collectEvidence } from "./sshEvidenceCollector.js";

const ALLOWED_HOSTS = [
  "192.168.10.166",
  "192.168.10.195",
  "192.168.10.196",
  "192.168.10.201",
  "192.168.10.202",
  "192.168.10.203",
  "192.168.10.204",
  "192.168.10.205",
];

export async function executeInvestigationPlan(plan = {}) {
  const hosts = (plan.hosts || []).filter(h => ALLOWED_HOSTS.includes(h));

  const results = [];

  for (const host of hosts) {
    const evidence = await collectEvidence(host);

    results.push({
      host,
      evidence,
    });
  }

  return {
    ok: true,
    hosts,
    results,
  };
}
