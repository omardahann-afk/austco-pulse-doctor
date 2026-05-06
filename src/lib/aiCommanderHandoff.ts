/**
 * Cross-route handoff for AI Commander triggers.
 * A page (Root Cause / Trace / Autopilot / Execution / Deep Evidence) can
 * stash a sanitized context blob + preferred mode in sessionStorage, then
 * navigate to /ai-commander which picks it up.
 *
 * Stored blob is read-only and short-lived. Never store secrets here.
 */

import type { CommanderContext, CommanderMode } from "./agentClient";

const KEY = "tacera.aiCommander.handoff";

export type CommanderHandoff = {
  mode: CommanderMode;
  source: string; // "root-cause" | "trace" | "autopilot" | "execution" | "deep-evidence"
  context: CommanderContext;
  createdAt: string;
};

export function setHandoff(h: Omit<CommanderHandoff, "createdAt">): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...h, createdAt: new Date().toISOString() }));
  } catch { /* sessionStorage may be disabled */ }
}

export function readHandoff(): CommanderHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CommanderHandoff;
  } catch { return null; }
}

export function clearHandoff(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
}