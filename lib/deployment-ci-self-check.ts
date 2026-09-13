import { existsSync, readFileSync } from "node:fs";

type RootPackage = {
  engines?: { node?: string };
  scripts?: Record<string, string>;
};

type PackageLock = {
  packages?: {
    ""?: { engines?: { node?: string } };
  };
};

type VercelConfig = {
  git?: {
    deploymentEnabled?: Record<string, boolean>;
  };
};

const rootUrl = new URL("../", import.meta.url);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`deployment-ci self-check: ${message}`);
}

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, rootUrl), "utf8");
}

export function deploymentCiSelfCheck(): void {
  const rootPackage = JSON.parse(read("package.json")) as RootPackage;
  const lock = JSON.parse(read("package-lock.json")) as PackageLock;
  const vercel = JSON.parse(read("vercel.json")) as VercelConfig;
  const ciWorkflowUrl = new URL(".github/workflows/ci.yml", rootUrl);

  assert(
    rootPackage.engines?.node === ">=24.0.0" &&
      rootPackage.engines.node === lock.packages?.[""]?.engines?.node,
    "package.json and package-lock.json must require the deployment Node runtime",
  );
  assert(
    rootPackage.scripts?.["ci:checks"] ===
      "npm run test:deployment-ci && npm run test:dependency-security && npm run test:security-headers && npm run test:public-auth-flow && npm run test:cron-auth && npm audit --audit-level=high && npm run lint && npm run build",
    "ci:checks must preserve the secretless deployment quality gates",
  );
  assert(
    vercel.git?.deploymentEnabled?.["**"] === false &&
      vercel.git.deploymentEnabled.main === true,
    "Vercel must deploy main only while GitHub CI validates pull requests",
  );
  assert(
    read("CLAUDE.md").split(/\r?\n/).length < 200,
    "CLAUDE.md must remain under 200 lines",
  );
  assert(existsSync(ciWorkflowUrl), "the pull-request CI workflow must exist");

  const ciWorkflow = read(".github/workflows/ci.yml");
  assert(
    ciWorkflow.includes("pull_request:") &&
      ciWorkflow.includes("push:") &&
      ciWorkflow.includes("- main"),
    "CI must run for pull requests and pushes to main",
  );
  assert(
    ciWorkflow.includes("permissions:\n  contents: read"),
    "CI must grant only read access to repository contents",
  );
  assert(
    ciWorkflow.includes(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ) &&
      ciWorkflow.includes(
        "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      ),
    "third-party workflow actions must stay pinned to reviewed commits",
  );
  assert(
    ciWorkflow.includes("fetch-depth: 0") &&
      ciWorkflow.includes("persist-credentials: false") &&
      ciWorkflow.includes('node-version: "24"') &&
      ciWorkflow.includes("cache: npm"),
    "CI must fetch comparison history without stored credentials and use the deployment Node runtime",
  );
  assert(
    ciWorkflow.includes(
      "NEXT_PUBLIC_SUPABASE_URL: https://ci.supabase.invalid",
    ) &&
      ciWorkflow.includes(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-anon-placeholder",
      ) &&
      ciWorkflow.includes(
        "SUPABASE_SERVICE_ROLE_KEY: eyJci-service-role-placeholder",
      ) &&
      !ciWorkflow.includes("${{ secrets.") &&
      !ciWorkflow.includes("${{ vars."),
    "quality CI must use reserved placeholders without repository secrets or variables",
  );
  assert(
    ciWorkflow.includes("run: npm ci") &&
      ciWorkflow.includes("run: npm run ci:checks"),
    "CI must install from the lockfile before running the shared quality command",
  );
  assert(
    ciWorkflow.includes("git diff --check") &&
      ciWorkflow.includes(
        '${{ github.event.pull_request.base.sha }}...${{ github.sha }}',
      ) &&
      ciWorkflow.includes('${{ github.event.before }}..${{ github.sha }}'),
    "CI must run diff --check over the event's committed patch",
  );

  const publishWorkflow = read(".github/workflows/publish-cron.yml");
  assert(
    publishWorkflow.includes("permissions: {}"),
    "the production publisher workflow must not receive a repository token",
  );
}

deploymentCiSelfCheck();
console.log("deployment-ci self-check passed");
