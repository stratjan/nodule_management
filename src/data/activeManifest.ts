// Loads the Release Manifest for the Active Rule-Set Release -- used only for static UI copy
// (e.g. explaining BTS's absence), never for per-evaluation logic (ADR-0007/CONTEXT.md).
import type { ReleaseManifest } from "../engine/types";
import activePointer from "../../clinical/rule-sets/active-release.json";

const manifestModules = import.meta.glob("../../clinical/rule-sets/manifests/*.json", {
  eager: true,
  import: "default",
}) as Record<string, ReleaseManifest>;

function findActiveManifest(): ReleaseManifest {
  const match = Object.entries(manifestModules).find(([path]) =>
    path.endsWith(`/${activePointer.activeReleaseId}.json`),
  );
  if (!match) {
    throw new Error(
      `No Release Manifest found for active release "${activePointer.activeReleaseId}".`,
    );
  }
  return match[1];
}

export const activeManifest: ReleaseManifest = findActiveManifest();
