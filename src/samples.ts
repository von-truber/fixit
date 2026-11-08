// One-click demo samples. Fixture IDs match the PRD's testing tables.
import dockerOomLog from "../tests/fixtures/docker-oom.log?raw";
import nginxErrorLog from "../tests/fixtures/nginx-error.log?raw";
import systemdCleanLog from "../tests/fixtures/systemd-clean.log?raw";

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
}

export const EXPLAIN_SAMPLES: ExplainSample[] = [
  {
    id: "E1",
    label: "Python: missing module",
    input: `Traceback (most recent call last):
  File "main.py", line 1, in <module>
    import requests
ModuleNotFoundError: No module named 'requests'`,
    environment: "python",
    context: "Running my script after cloning a repo",
    featured: true,
  },
  {
    id: "E2",
    label: "npm: permission denied",
    input: `npm ERR! code EACCES
npm ERR! syscall mkdir
npm ERR! path /usr/local/lib/node_modules
npm ERR! errno -13
npm ERR! Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'`,
    environment: "node",
    context: "npm install -g typescript",
    featured: true,
  },
  {
    id: "E5",
    label: "Docker: port in use",
    input: `docker: Error response from daemon: driver failed programming external connectivity on endpoint web (3f2a): Bind for 0.0.0.0:8080 failed: port is already allocated.`,
    environment: "docker",
    featured: true,
  },
  {
    id: "S1",
    label: "Error with secrets",
    input: `psycopg2.OperationalError: connection to server failed: FATAL: password authentication failed for user "jane@company.com"
DATABASE_URL=postgres://jane:hunter2@db.internal:5432/app
ANTHROPIC_API_KEY=sk-ant-test123abcdef456
password=abc`,
    environment: "python",
    featured: true,
  },
  {
    id: "E3",
    label: "Git: unrelated histories",
    input: "fatal: refusing to merge unrelated histories",
    environment: "git",
    featured: false,
  },
  {
    id: "E4",
    label: "WordPress: database connection",
    input: "Error establishing a database connection",
    environment: "wordpress",
    featured: false,
  },
  {
    id: "E6",
    label: "Not an error",
    input: "Hello, how are you?",
    environment: "auto",
    featured: false,
  },
];
