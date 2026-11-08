// One-click demo samples. Fixture IDs match the PRD's testing tables.
import dockerOomLog from "../tests/fixtures/docker-oom.log?raw";
import nginxErrorLog from "../tests/fixtures/nginx-error.log?raw";
import systemdCleanLog from "../tests/fixtures/systemd-clean.log?raw";
import explainSamples from "../tests/fixtures/explain-samples.json";

export interface DigestSample {
  id: string;
  label: string;
  fileName: string;
  input: string;
}

export const DIGEST_SAMPLES: DigestSample[] = [
  { id: "D1", label: "Nginx: upstream errors", fileName: "nginx-error.log", input: nginxErrorLog },
  { id: "D2", label: "Docker: container OOM", fileName: "docker-oom.log", input: dockerOomLog },
  { id: "D3", label: "systemd: healthy", fileName: "systemd-clean.log", input: systemdCleanLog },
];

export interface ExplainSample {
  id: string;
  label: string;
  input: string;
  environment: string;
  context?: string;
  /** Shown as a button on the page. */
  featured: boolean;
  /** What a good answer looks like (PRD testing table). */
  expected: string;
}

// Shared with scripts/smoke.mts so the demo and the tests use the same inputs.
export const EXPLAIN_SAMPLES: ExplainSample[] = explainSamples;
