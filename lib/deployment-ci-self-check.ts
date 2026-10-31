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
      "npm run test:deployment-ci && npm run test:dependency-security && npm run test:client-secret-boundary && npm run test:ai-provider-guard && npm run test:model-catalog-guard && npm run test:admin-metrics && npm run test:internal-routes && npm run test:security-headers && npm run test:media-storage && npm run test:public-auth-flow && npm run test:public-marketing && npm run test:cron-auth && npm audit --omit=dev --audit-level=high && npm run lint && npm run typecheck && npm run build",
    "ci:checks must preserve the secretless deployment quality gates",
  );
  assert(
    vercel.git?.deploymentEnabled?.["**"] === true &&
      vercel.git.deploymentEnabled.main === true,
    "Vercel must deploy main and provide preview deployments for other branches",
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
  // Public repo: workflow logs show the HTTP status and counts only, never the raw reply (ids, error text).
  assert(
    !/echo\s+"?\$\{?body\b/.test(publishWorkflow) &&
      publishWorkflow.includes("jq -c 'with_entries(select(.value | type == \"number\"))'"),
    "the publisher workflow must log counts only, never the raw reply",
  );

  const reconcileWorkflow = read(".github/workflows/generation-reconcile.yml");
  assert(
    reconcileWorkflow.includes("permissions: {}") &&
      !reconcileWorkflow.includes("pull_request") &&
      reconcileWorkflow.includes('cron: "*/10 * * * *"') &&
      reconcileWorkflow.includes("workflow_dispatch") &&
      reconcileWorkflow.includes("cancel-in-progress: false") &&
      reconcileWorkflow.includes("default_branch"),
    "the reconcile workflow must be schedule/manual only, token-less, non-overlapping and default-branch only",
  );
  assert(
    reconcileWorkflow.includes("--fail-with-body") &&
      reconcileWorkflow.includes("--retry 0") &&
      reconcileWorkflow.includes("-H @-") &&
      !/echo[^\n]*\$\{?CRON_SECRET/.test(reconcileWorkflow) &&
      reconcileWorkflow.includes("${{ secrets.CRON_SECRET }}") &&
      reconcileWorkflow.includes("${{ secrets.CRON_TARGET_URL }}") &&
      reconcileWorkflow.includes("exit 0"),
    "the reconcile workflow must fail on HTTP errors, never echo or pass the secret on argv, and skip when unset",
  );
  assert(
    reconcileWorkflow.includes('-o "$RUNNER_TEMP/reply.json"') &&
      reconcileWorkflow.includes("with_entries(select(.value | type == \"number\"))") &&
      !/cat\s+"?\$RUNNER_TEMP\/reply\.json/.test(reconcileWorkflow) &&
      !/echo\s+"?\$\{?(body|response)\b/.test(reconcileWorkflow),
    "the reconcile workflow must keep the reply out of the public log and print counts only",
  );
  const maxTime = Number(/--max-time (\d+)/.exec(reconcileWorkflow)?.[1]);
  const routeSource = read("app/api/cron/generation-reconcile/route.ts");
  const maxDuration = Number(/maxDuration = (\d+)/.exec(routeSource)?.[1]);
  assert(
    maxTime > 0 && maxTime < maxDuration,
    "the reconcile workflow curl max-time must stay below the route maxDuration",
  );
  // Docs stay honest: GitHub schedules are best-effort, cron-job.org is the 10-minute trigger.
  for (const doc of ["CLAUDE.md", "AGENTS.md", "docs/generation/fal-provider-runbook.md"]) {
    const text = read(doc);
    assert(
      text.includes("cron-job.org") && !/(~|every )10 min[^\n]*via GitHub/.test(text),
      `${doc} must name cron-job.org as the reconcile trigger, not GitHub Actions`,
    );
  }
  assert(
    read("vercel.json").includes('"/api/cron/generation-reconcile"'),
    "the daily Vercel reconcile cron stays as backup",
  );
}

deploymentCiSelfCheck();
console.log("deployment-ci self-check passed");
