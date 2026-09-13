import { readFileSync } from "node:fs";

type LockedPackage = {
  version?: string;
};

type PackageLock = {
  packages?: Record<string, LockedPackage>;
};

type RootPackage = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type RemotePattern = {
  hostname?: string;
  pathname?: string;
  protocol?: string;
};

type ResolvedNextConfig = {
  images?: {
    minimumCacheTTL?: number;
    remotePatterns?: RemotePattern[];
  };
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`dependency-security self-check: ${message}`);
}

function versionParts(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function atLeast(version: string, minimum: string): boolean {
  const current = versionParts(version);
  const required = versionParts(minimum);

  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== required[index]) {
      return current[index] > required[index];
    }
  }
  return true;
}

function isPatchedNextVersion(version: string): boolean {
  const [major] = versionParts(version);
  if (major === 15) return atLeast(version, "15.5.24");
  if (major === 16) return atLeast(version, "16.3.3");
  return major > 16;
}

function lockedVersion(lock: PackageLock, packageName: string): string {
  const version = lock.packages?.[`node_modules/${packageName}`]?.version;
  assert(Boolean(version), `${packageName} must be present in package-lock.json`);
  return version!;
}

export async function dependencySecuritySelfCheck(): Promise<void> {
  assert(
    !isPatchedNextVersion("15.5.23") &&
      isPatchedNextVersion("15.5.24") &&
      !isPatchedNextVersion("16.3.2") &&
      isPatchedNextVersion("16.3.3"),
    "Next.js security-version comparison must preserve release ordering",
  );

  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  ) as PackageLock;
  const rootPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as RootPackage;

  assert(
    isPatchedNextVersion(lockedVersion(lock, "next")),
    "Next.js must include the August 2026 Image Optimizer security release",
  );
  assert(
    atLeast(lockedVersion(lock, "sharp"), "0.35.4"),
    "sharp must include the patched libheif release",
  );
  assert(
    Boolean(rootPackage.dependencies?.sharp) &&
      !rootPackage.devDependencies?.sharp,
    "sharp must remain a production dependency for publish image conversion",
  );
  assert(
    rootPackage.devDependencies?.tsx === lockedVersion(lock, "tsx"),
    "tsx must be a pinned dev dependency instead of an npx network install",
  );
  assert(
    Object.values(rootPackage.scripts ?? {}).every(
      (command) => !/\bnpx\s+tsx\b/.test(command),
    ),
    "npm scripts must invoke the pinned local tsx binary without npx fallback",
  );
  assert(
    atLeast(lockedVersion(lock, "postcss"), "8.5.23"),
    "the root PostCSS dependency must reject unsafe source maps",
  );

  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousBucket = process.env.SUPABASE_STORAGE_BUCKET;
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://audit-project.supabase.co";
  process.env.SUPABASE_STORAGE_BUCKET = "krakatoa";

  try {
    const { default: wrappedConfig } = await import("../next.config.mjs");
    assert(
      typeof wrappedConfig === "function",
      "workflow-wrapped Next config must remain resolvable",
    );

    const config = (await wrappedConfig("phase-production-build", {
      defaultConfig: {},
    })) as ResolvedNextConfig;
    const supabasePatterns = (config.images?.remotePatterns ?? []).filter(
      ({ hostname }) => hostname?.includes("supabase"),
    );

    assert(
      supabasePatterns.length === 1 &&
        supabasePatterns[0].protocol === "https" &&
        supabasePatterns[0].hostname === "audit-project.supabase.co" &&
        supabasePatterns[0].pathname ===
          "/storage/v1/object/sign/krakatoa/**",
      "Image Optimizer must allow only this deployment's private Supabase bucket",
    );
    assert(
      config.images?.minimumCacheTTL === 2_592_000,
      "Image Optimizer cache TTL must stay aligned with SIGN_TTL.ui",
    );
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
    if (previousBucket === undefined) {
      delete process.env.SUPABASE_STORAGE_BUCKET;
    } else {
      process.env.SUPABASE_STORAGE_BUCKET = previousBucket;
    }
  }
}

dependencySecuritySelfCheck()
  .then(() => console.log("dependency-security self-check passed"))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
