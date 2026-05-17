/**
 * applianceState.js
 *
 * Maintains live health state for every known appliance.
 * Computes overall state, blast radius, and dependency graph.
 *
 * State: in-memory. Rebuilt from agent reports as they arrive.
 */

import { buildCausalTimeline } from './causalEngine.js';

// ─── Known appliances ─────────────────────────────────────────────────────────

const KNOWN_APPLIANCES = {
  '192.168.10.201': { label: 'Integration Server 1', role: 'integration_server', tier: 1 },
  '192.168.10.202': { label: 'Integration Server 2', role: 'integration_server', tier: 1 },
  '192.168.10.203': { label: 'Integration Server 3', role: 'integration_server', tier: 1 },
  '192.168.10.204': { label: 'Integration Server 4', role: 'integration_server', tier: 1 },
  '192.168.10.165': { label: 'IP-PST2',              role: 'pst2',              tier: 2 },
  '192.168.10.171': { label: 'Doctor VM',            role: 'doctor_vm',         tier: 0 },
};

// ─── Dependency map — which appliances depend on which ───────────────────────
// If A fails, B is affected.

const DEPENDENCIES = {
  '192.168.10.201': [], // Integration Server 1 depends on nothing above it
  '192.168.10.202': ['192.168.10.201'], // depends on primary IS
  '192.168.10.203': ['192.168.10.201'],
  '192.168.10.204': ['192.168.10.201', '192.168.10.203'],
  '192.168.10.165': ['192.168.10.201', '192.168.10.202'], // PST depends on floor controllers
};

// ─── State store ─────────────────────────────────────────────────────────────

class ApplianceStateStore {
  constructor() {
    this.states = new Map();       // ip -> ApplianceState
    this.eventBuffer = new Map();  // ip -> NormalizedEvent[]
    this.lastSeen = new Map();     // ip -> timestamp
    this.STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min = stale
    this.DEAD_THRESHOLD_MS  = 15 * 60 * 1000; // 15 min = dead
  }

  /**
   * Ingest normalized events from an agent report.
   * Rebuilds state for that appliance.
   */
  ingest(ip, role, normalizedEvents, receivedAt = new Date().toISOString()) {
    this.lastSeen.set(ip, Date.now());

    // Accumulate events (keep last 200 per host)
    const existing = this.eventBuffer.get(ip) || [];
    const merged = [...existing, ...normalizedEvents].slice(-200);
    this.eventBuffer.set(ip, merged);

    // Rebuild state
    this.rebuildState(ip, role);

    // Check if this appliance's failure cascades to others
    this.propagateCascade(ip);
  }

  rebuildState(ip, role) {
    const events = this.eventBuffer.get(ip) || [];
    const known = KNOWN_APPLIANCES[ip] || { label: ip, role, tier: 2 };

    if (!events.length) {
      this.states.set(ip, {
        ip, role: known.role, label: known.label,
        health: 'UNKNOWN', color: 'gray',
        rootCause: null, cascade: [], nextStep: null,
        events: [], lastSeen: this.lastSeen.get(ip),
      });
      return;
    }

    // Run causal engine
    const causal = buildCausalTimeline(events);

    // Determine overall health color
    const criticalCount = events.filter(e => e.severity === 'CRITICAL').length;
    const highCount = events.filter(e => e.severity === 'HIGH').length;

    let health, color;
    if (criticalCount > 0) { health = 'CRITICAL'; color = 'red'; }
    else if (highCount > 0) { health = 'DEGRADED'; color = 'yellow'; }
    else { health = 'OK';       color = 'green'; }

    this.states.set(ip, {
      ip,
      role: known.role,
      label: known.label,
      health,
      color,
      confidence: causal.confidence,
      rootCauseType: causal.rootCauseType,
      rootCauseLabel: causal.rootCauseLabel,
      humanExplanation: causal.humanExplanation,
      cascade: causal.cascade || [],
      symptoms: causal.symptoms || [],
      nextStep: causal.nextStep,
      verification: causal.verification,
      topEvents: events.slice(0, 10),
      eventCounts: {
        critical: criticalCount,
        high: highCount,
        medium: events.filter(e => e.severity === 'MEDIUM').length,
      },
      lastSeen: this.lastSeen.get(ip),
      updatedAt: new Date().toISOString(),
    });
  }

  propagateCascade(failedIp) {
    const failedState = this.states.get(failedIp);
    if (!failedState || failedState.health === 'OK') return;

    // Find appliances that depend on the failed one
    for (const [ip, deps] of Object.entries(DEPENDENCIES)) {
      if (!deps.includes(failedIp)) continue;
      const state = this.states.get(ip);
      if (!state) continue;

      // Add a cascaded-from note to the dependent appliance
      const existing = state.cascadeFrom || [];
      if (!existing.includes(failedIp)) {
        this.states.set(ip, {
          ...state,
          cascadeFrom: [...existing, failedIp],
          cascadeNote: `May be affected by failure on ${KNOWN_APPLIANCES[failedIp]?.label || failedIp}`,
        });
      }
    }
  }

  /**
   * Mark an appliance as offline (no recent report).
   */
  checkStaleness() {
    const now = Date.now();
    for (const [ip, lastTs] of this.lastSeen.entries()) {
      const age = now - lastTs;
      const state = this.states.get(ip);
      if (!state) continue;

      if (age > this.DEAD_THRESHOLD_MS) {
        this.states.set(ip, {
          ...state,
          health: 'OFFLINE',
          color: 'gray',
          rootCauseLabel: 'Appliance offline — no reports received',
          nextStep: 'Check if agent is running. SSH to verify system is up.',
        });
      } else if (age > this.STALE_THRESHOLD_MS && state.health !== 'OFFLINE') {
        this.states.set(ip, {
          ...state,
          stale: true,
          staleNote: `Last report ${Math.round(age / 60000)}m ago`,
        });
      }
    }
  }

  /**
   * Get all appliance states for the dashboard.
   */
  getAllStates() {
    this.checkStaleness();

    // Add known appliances that have never reported
    const result = [];
    const allIps = new Set([...Object.keys(KNOWN_APPLIANCES), ...this.states.keys()]);

    for (const ip of allIps) {
      const state = this.states.get(ip);
      const known = KNOWN_APPLIANCES[ip];

      if (state) {
        result.push(state);
      } else {
        // Never reported
        result.push({
          ip,
          label: known?.label || ip,
          role: known?.role || 'unknown',
          health: 'UNKNOWN',
          color: 'gray',
          rootCauseLabel: 'No agent report received',
          nextStep: 'Deploy agent or check network connectivity.',
          lastSeen: null,
          topEvents: [],
          eventCounts: { critical: 0, high: 0, medium: 0 },
        });
      }
    }

    // Sort: CRITICAL first, then DEGRADED, then OK, then UNKNOWN
    const order = { CRITICAL: 0, DEGRADED: 1, OFFLINE: 2, UNKNOWN: 3, OK: 4 };
    result.sort((a, b) => (order[a.health] ?? 5) - (order[b.health] ?? 5));

    return result;
  }

  /**
   * Get detailed state for a single appliance.
   */
  getState(ip) {
    return this.states.get(ip) || null;
  }

  /**
   * Compute system-wide blast radius.
   * Returns: which appliances are affected by the current worst failure.
   */
  getBlastRadius() {
    const criticalHosts = [...this.states.entries()]
      .filter(([, s]) => s.health === 'CRITICAL')
      .map(([ip]) => ip);

    if (!criticalHosts.length) return { epicenter: null, affected: [] };

    const epicenter = criticalHosts[0];
    const affected = [];

    for (const [ip, deps] of Object.entries(DEPENDENCIES)) {
      if (deps.some(d => criticalHosts.includes(d))) {
        affected.push({ ip, label: KNOWN_APPLIANCES[ip]?.label || ip });
      }
    }

    return {
      epicenter: { ip: epicenter, label: KNOWN_APPLIANCES[epicenter]?.label || epicenter },
      affected,
    };
  }

  /**
   * Clear events for an appliance (after a fix is verified).
   */
  clearAppliance(ip) {
    this.eventBuffer.set(ip, []);
    this.states.delete(ip);
  }
}

// Singleton
export const applianceStore = new ApplianceStateStore();
