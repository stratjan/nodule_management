// Loads the Active Rule-Set Release the running application evaluates against (ADR-0007:
// "the running application evaluates only against the Active Release; there is no UI for
// selecting historical releases in v1"). Reads the committed, version-controlled Active
// pointer and the matching immutable release artifact -- both static JSON, bundled at build
// time. This file is Vite/browser tooling, not part of src/engine (which stays framework-agnostic).
import type { RuleSetRelease } from "../engine/types";
import activePointer from "../../clinical/rule-sets/active-release.json";

const releaseModules = import.meta.glob("../../clinical/rule-sets/releases/*.json", {
  eager: true,
  import: "default",
}) as Record<string, RuleSetRelease>;

function findActiveRelease(): RuleSetRelease {
  const match = Object.entries(releaseModules).find(([path]) =>
    path.endsWith(`/${activePointer.activeReleaseId}.json`),
  );
  if (!match) {
    throw new Error(
      `Active Rule-Set pointer names release "${activePointer.activeReleaseId}", but no matching release artifact was found under clinical/rule-sets/releases/. Run "npm run release:build".`,
    );
  }
  return match[1];
}

export const activeRelease: RuleSetRelease = findActiveRelease();
