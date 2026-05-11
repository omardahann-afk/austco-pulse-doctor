import { TACERA_COMPONENTS } from "./taceraKnowledgeModel.js";

export function detectTaceraRoles(text = "") {
  const lower = String(text).toLowerCase();
  const found = [];

  for (const [key, value] of Object.entries(TACERA_COMPONENTS)) {
    if (lower.includes(key.toLowerCase())) {
      found.push({
        component: key,
        role: value.role,
        layer: value.layer
      });
    }
  }

  return found;
}
