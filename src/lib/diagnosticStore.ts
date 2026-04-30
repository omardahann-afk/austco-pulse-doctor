import { useSyncExternalStore } from "react";
import type { DiagnosticModule, DiagnosticResult } from "./types";
import { runFullAustcoDiagnosis } from "./diagnosticEngine";
import { siteConfig } from "@/data/mockSite";

type State = {
  isScanning: boolean;
  modules: DiagnosticModule[];
  result: DiagnosticResult | null;
  lastScanAt: string | null;
};

let state: State = {
  isScanning: false,
  modules: [],
  result: null,
  lastScanAt: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startFullDiagnosis() {
  if (state.isScanning) return;
  state = { ...state, isScanning: true, modules: [] };
  emit();
  runFullAustcoDiagnosis(siteConfig, (modules) => {
    state = { ...state, modules };
    emit();
  })
    .then((result) => {
      state = {
        ...state,
        isScanning: false,
        result,
        modules: result.modules,
        lastScanAt: result.scanTime,
      };
      emit();
    })
    .catch(() => {
      state = { ...state, isScanning: false };
      emit();
    });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getSnapshot = () => state;

export function useDiagnostic() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}