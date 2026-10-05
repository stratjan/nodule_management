// PR #38 merge-gate remediation (P1-1): the real release-build file boundary. Runs
// writeReleaseArtifacts -- the exact function `npm run release:build` calls, with the real
// governed inputs -- against a temporary copy of clinical/, never the repository itself, and
// proves that a content-addressed Release/Manifest can never be silently rewritten under the
// same releaseId: an identical rebuild reproduces the committed bytes regardless of wall clock,
// and any inconsistent existing artifact fails closed with nothing written.
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleaseArtifactConflictError, writeReleaseArtifacts } from "../../scripts/releaseArtifacts";
import { RELEASE_NOTES, RULE_FILES, SOURCE_QUALITY_FINDINGS } from "../../scripts/releaseInputs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const CANDIDATE_B_RELEASE_ID = "rel-1d516b878ab19653";
const CANDIDATE_B_CREATED_AT = "2026-09-30T19:00:00.000Z";
const inputs = { ruleFiles: RULE_FILES, sourceQualityFindings: SOURCE_QUALITY_FINDINGS, notes: RELEASE_NOTES };

// final spec 5917726111 case 52: the 22 pre-Candidate-B artifacts, pinned to their committed
// (LF) blob content on main 97826b01 -- any byte change to a historical artifact fails here.
const HISTORICAL_ARTIFACT_SHA256: Record<string, string> = {
  "releases/rel-254d3d698cda65c1.json": "6de39fc27f7d076e53aedf83a00d2fbe63802224ba140ac371a02efb0244cbbc",
  "releases/rel-2564f51cfca6012a.json": "23221cacff50160fd64a0f5ce52a2266f172bc211f8ba5a5acc98ccd65947c5f",
  "releases/rel-2ca4e7ca7b4c1c4b.json": "b05694c42d17c6bac562c80b6d3e4ae13bacf2fcc616b9e4dd3bb89ca91c152f",
  "releases/rel-2d7b92ff0cb7e06e.json": "597bb3f466545e7b30c4086250080e6ef4d2fb251b652003aa35d6c1b3b9c62d",
  "releases/rel-36e978b3efb56429.json": "5a6c7aa529ac19d2521405a8a4f0f3822765a22cbcb838232ee358615857ed22",
  "releases/rel-40d241d835b69cae.json": "4eb1716b40384f2e33ee918700f9ef1eee61ba56450270b0eafdd7218ee40aa0",
  "releases/rel-5ecb4eeaf38eed85.json": "4439e42cf9f23f48eb428d13723351f471423481c5bb505fbf0faa4ad3b94704",
  "releases/rel-738021fc80b35115.json": "a94c3e2c7c4013b23d726ae85b3e5a003e08c6da281d2b2f33a71a732883b8e6",
  "releases/rel-9b67d666172fb17d.json": "f781e42b091b5e141714da17ba21a2714c9556028778a9c4ecff0765bd84f7d3",
  "releases/rel-e4af8bbb47916989.json": "9882e6814958579d048312a64331b2feaa82cbd3c426ec9fdd603dfe56848490",
  "releases/rel-fb4eb398cb3ae65d.json": "bc9c5cccda907374b012f8d746199488e72eb91fbf4a06d888b39e39c8b5b24f",
  "manifests/rel-254d3d698cda65c1.json": "1a4069106c21f5ca20619f5a9b75d2ac271b3d3c025fc92ea07f7c40b4fcc1e1",
  "manifests/rel-2564f51cfca6012a.json": "8d0a9233d019901a81d6c2ffe3e922dbc8e989bf03ea1dc2257e26b506fc7a16",
  "manifests/rel-2ca4e7ca7b4c1c4b.json": "05e3f0d1ad67a03925eeaf78b229a8cb59bcbddfa3144f378518361d1b7e89aa",
  "manifests/rel-2d7b92ff0cb7e06e.json": "c9211d28e581a300061a142d144d5b694484a7fd912dbdfb4d82d69e04dc0631",
  "manifests/rel-36e978b3efb56429.json": "be7c722468ece6b28437061d8a8aa185405c8641d0c07dba25bd1e7d00caa963",
  "manifests/rel-40d241d835b69cae.json": "b084c7e8fb57a9027f6c3af5a37e88b1f3fc1b6ac0d66e1bf3ced07cb77b35ea",
  "manifests/rel-5ecb4eeaf38eed85.json": "00125003913539a76fb51b853c820159428d8d7c416f0a664616543c8e7dc39d",
  "manifests/rel-738021fc80b35115.json": "ad287a515586a11e4570fc2ce599179f81432c58cd09ee1a4f4239c0662783ab",
  "manifests/rel-9b67d666172fb17d.json": "3ba42fd3c827d31473f96a430ba612803f40f15675f7c9887d0c7617ac39cfe4",
  "manifests/rel-e4af8bbb47916989.json": "686a46f7631ace5b4d2b55e7dfbefa54681ea20f7a5be2732184a9b169b8f244",
  "manifests/rel-fb4eb398cb3ae65d.json": "c1f394dbf9de91d5b5175d76b73356eddcd49a32fb81d6507cc3d332cb23bfb7",
};

// Committed artifacts are LF; a Windows core.autocrlf checkout materializes them as CRLF.
const readLf = (path: string) => readFileSync(path, "utf-8").replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

let artifactRoot: string;
const ruleSets = () => join(artifactRoot, "clinical/rule-sets");
const releasePath = () => join(ruleSets(), `releases/${CANDIDATE_B_RELEASE_ID}.json`);
const manifestPath = () => join(ruleSets(), `manifests/${CANDIDATE_B_RELEASE_ID}.json`);
const pointerPath = () => join(ruleSets(), "active-release.json");

function snapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of ["releases", "manifests"]) {
    for (const name of readdirSync(join(ruleSets(), dir))) files[`${dir}/${name}`] = readLf(join(ruleSets(), dir, name));
  }
  files["active-release.json"] = readLf(pointerPath());
  return files;
}

function build(now: () => string = () => "2099-01-01T00:00:00.000Z") {
  return writeReleaseArtifacts({ inputRoot: repoRoot, artifactRoot, inputs, now });
}

beforeEach(() => {
  artifactRoot = mkdtempSync(join(tmpdir(), "release-artifacts-"));
  cpSync(join(repoRoot, "clinical/rule-sets"), ruleSets(), { recursive: true });
});

afterEach(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
});

describe("release build: content-addressed artifacts are immutable (PR #38 P1-1)", () => {
  it("rebuilding the governed inputs twice, under a different wall clock, rewrites no Release or Manifest byte", () => {
    const before = snapshot();
    for (let run = 0; run < 2; run++) {
      const result = build();
      expect(result).toEqual({
        releaseId: CANDIDATE_B_RELEASE_ID,
        revisionCount: 21,
        releaseWritten: false,
        manifestWritten: false,
      });
    }
    expect(snapshot()).toEqual(before);
    expect(JSON.parse(readLf(pointerPath()))).toEqual({ activeReleaseId: CANDIDATE_B_RELEASE_ID });
    const release = JSON.parse(readLf(releasePath()));
    expect(release.createdAt).toBe(CANDIDATE_B_CREATED_AT);
    expect(release.revisions).toHaveLength(21);
  });

  it("from scratch, the generator reproduces the committed Candidate-B Release and Manifest byte-for-byte", () => {
    const committedRelease = readLf(releasePath());
    const committedManifest = readLf(manifestPath());
    rmSync(releasePath());
    rmSync(manifestPath());

    const result = build(() => CANDIDATE_B_CREATED_AT);

    expect(result.releaseWritten).toBe(true);
    expect(result.manifestWritten).toBe(true);
    expect(readLf(releasePath())).toBe(committedRelease);
    expect(readLf(manifestPath())).toBe(committedManifest);
  });

  it("refuses, writing nothing, when the existing Release under the same id carries different revision content", () => {
    const tampered = JSON.parse(readLf(releasePath()));
    tampered.revisions.find((r: { ruleId: string }) => r.ruleId === "ACR-FLEISCHNER-MULTIPLE-SOLID-LT6MM-HIGH-RISK")
      .recommendation.considerAction.timing.intervals = ["6 months"];
    writeFileSync(releasePath(), JSON.stringify(tampered, null, 2) + "\n");
    writeFileSync(pointerPath(), JSON.stringify({ activeReleaseId: "rel-254d3d698cda65c1" }, null, 2) + "\n");
    const before = snapshot();

    expect(() => build()).toThrow(ReleaseArtifactConflictError);
    expect(snapshot()).toEqual(before);
  });

  it("refuses, writing nothing, when the existing Manifest under the same id differs", () => {
    const tampered = JSON.parse(readLf(manifestPath()));
    tampered.notes = tampered.notes.slice(0, -1);
    writeFileSync(manifestPath(), JSON.stringify(tampered, null, 2) + "\n");
    writeFileSync(pointerPath(), JSON.stringify({ activeReleaseId: "rel-254d3d698cda65c1" }, null, 2) + "\n");
    const before = snapshot();

    expect(() => build()).toThrow(ReleaseArtifactConflictError);
    expect(snapshot()).toEqual(before);
  });

  it("refuses an existing Release whose createdAt was re-stamped (Release and Manifest no longer agree)", () => {
    const restamped = JSON.parse(readLf(releasePath()));
    restamped.createdAt = "2099-01-01T00:00:00.000Z";
    writeFileSync(releasePath(), JSON.stringify(restamped, null, 2) + "\n");
    const before = snapshot();

    expect(() => build()).toThrow(ReleaseArtifactConflictError);
    expect(snapshot()).toEqual(before);
  });

  it("refuses an existing Release with semantically equal content but non-canonical serialization", () => {
    const reordered = JSON.parse(readLf(releasePath()));
    const { revisions, ...rest } = reordered;
    writeFileSync(releasePath(), JSON.stringify({ revisions, ...rest }, null, 2) + "\n");
    const before = snapshot();

    expect(() => build()).toThrow(ReleaseArtifactConflictError);
    expect(snapshot()).toEqual(before);
  });
});

describe("historical Release/Manifest artifacts are byte-pinned (final spec case 52)", () => {
  it("exactly the 22 pre-Candidate-B artifacts plus the Candidate-B pair exist, and every historical one matches its pinned hash", () => {
    const committed = join(repoRoot, "clinical/rule-sets");
    const present = ["releases", "manifests"].flatMap((dir) =>
      readdirSync(join(committed, dir)).map((name) => `${dir}/${name}`),
    );
    expect(present.sort()).toEqual(
      [
        ...Object.keys(HISTORICAL_ARTIFACT_SHA256),
        `releases/${CANDIDATE_B_RELEASE_ID}.json`,
        `manifests/${CANDIDATE_B_RELEASE_ID}.json`,
      ].sort(),
    );
    for (const [path, hash] of Object.entries(HISTORICAL_ARTIFACT_SHA256)) {
      expect(sha256(readLf(join(committed, path))), path).toBe(hash);
    }
  });
});
