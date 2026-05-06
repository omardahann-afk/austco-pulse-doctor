// Minimal placeholder store — full implementation pending Phase 7 Slice 1 redo.
// Exposes a no-op hydration function so the app boots without errors.

export async function hydrateSiteConfigFromBackend(): Promise<void> {
  try {
    await fetch("/api/site-config").catch(() => undefined);
  } catch {
    // silent: backend may not be running locally
  }
}

export const __siteConfigStorePlaceholder = true;