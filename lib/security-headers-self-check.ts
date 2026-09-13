type Header = {
  key: string;
  value: string;
};

type HeaderRule = {
  source: string;
  headers: Header[];
};

type ResolvedNextConfig = {
  poweredByHeader?: boolean;
  headers?: () => Promise<HeaderRule[]>;
};

function directiveSources(csp: string, directive: string): string[] {
  const entry = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === directive || part.startsWith(`${directive} `));
  return entry?.split(/\s+/).slice(1) ?? [];
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`security-headers self-check: ${message}`);
}

export async function securityHeadersSelfCheck(): Promise<void> {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  mutableEnv.NODE_ENV = "production";
  mutableEnv.NEXT_PUBLIC_SUPABASE_URL =
    "https://headers-audit.supabase.co";

  try {
    const { default: wrappedConfig } = await import("../next.config.mjs");
    assert(
      typeof wrappedConfig === "function",
      "workflow-wrapped Next config must remain resolvable",
    );
    const config = (await wrappedConfig("phase-production-build", {
      defaultConfig: {},
    })) as ResolvedNextConfig;
    const rules = (await config.headers?.()) ?? [];
    const siteRule = rules.find(({ source }) => source === "/:path*");
    assert(Boolean(siteRule), "a site-wide /:path* header rule must exist");

    const headers = new Map(
      siteRule!.headers.map(({ key, value }) => [key.toLowerCase(), value]),
    );
    assert(
      headers.get("strict-transport-security") === "max-age=63072000",
      "production responses must pin HTTPS without assuming subdomain policy",
    );
    assert(
      headers.get("x-content-type-options") === "nosniff",
      "responses must disable MIME sniffing",
    );
    assert(
      headers.get("referrer-policy") === "strict-origin-when-cross-origin",
      "cross-origin requests must receive only the source origin",
    );
    assert(
      headers.get("x-frame-options") === "DENY",
      "Kelolako pages must not be frameable",
    );
    assert(
      headers.get("permissions-policy") ===
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "unused powerful browser features must be disabled",
    );
    assert(
      config.poweredByHeader === false,
      "the framework fingerprint header must be disabled",
    );

    const csp = headers.get("content-security-policy") ?? "";
    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "script-src 'self' 'unsafe-inline'",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' https://headers-audit.supabase.co wss://headers-audit.supabase.co",
      "frame-src https://www.youtube.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ]) {
      assert(csp.includes(directive), `CSP must include ${directive}`);
    }
    assert(
      !csp.includes("'unsafe-eval'") &&
        !csp.includes("Content-Security-Policy-Report-Only"),
      "production CSP must be enforced without eval",
    );

    const scriptSources = directiveSources(csp, "script-src");
    assert(
      scriptSources.includes("https://va.vercel-scripts.com"),
      "Analytics must retain its reviewed script origin",
    );
    const imgSources = directiveSources(csp, "img-src");
    for (const source of [
      "https://headers-audit.supabase.co",
      "https://images.unsplash.com",
      "https://plus.unsplash.com",
      "https://lh3.googleusercontent.com",
      "https://images.higgs.ai",
      "https://cdn.kelolako.com",
      "https://d8j0ntlcm91z4.cloudfront.net",
    ]) {
      assert(imgSources.includes(source), `img-src must include ${source}`);
    }

    mutableEnv.NODE_ENV = "development";
    const developmentRules = (await config.headers?.()) ?? [];
    const developmentHeaders = new Map(
      developmentRules
        .find(({ source }) => source === "/:path*")!
        .headers.map(({ key, value }) => [key.toLowerCase(), value]),
    );
    const developmentCsp =
      developmentHeaders.get("content-security-policy") ?? "";
    assert(
      developmentCsp.includes("'unsafe-eval'") &&
        directiveSources(developmentCsp, "connect-src").includes("ws:") &&
        !developmentCsp.includes("upgrade-insecure-requests") &&
        !developmentHeaders.has("strict-transport-security"),
      "development CSP must support HMR without applying production transport policy",
    );

    mutableEnv.NODE_ENV = "production";
    mutableEnv.NEXT_PUBLIC_SUPABASE_URL = "http://insecure.supabase.local";
    let rejectedInsecureProductionUrl = false;
    try {
      await config.headers?.();
    } catch {
      rejectedInsecureProductionUrl = true;
    }
    assert(
      rejectedInsecureProductionUrl,
      "production headers must reject an insecure Supabase browser origin",
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = previousNodeEnv;
    }
    if (previousUrl === undefined) {
      delete mutableEnv.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      mutableEnv.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }
  }
}

securityHeadersSelfCheck()
  .then(() => console.log("security-headers self-check passed"))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
