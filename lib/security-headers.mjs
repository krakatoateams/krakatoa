function supabaseBrowserOrigins(rawUrl, isProduction) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS");
  }
  if (isProduction && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production");
  }
  const socketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  return {
    http: url.origin,
    socket: `${socketProtocol}//${url.host}`,
  };
}

function contentSecurityPolicy({ isProduction, supabaseUrl }) {
  const supabase = supabaseBrowserOrigins(supabaseUrl, isProduction);
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "https://va.vercel-scripts.com",
  ];
  const connectSources = ["'self'", supabase.http, supabase.socket];

  if (!isProduction) {
    scriptSources.push("'unsafe-eval'");
    connectSources.push("http:", "https:", "ws:", "wss:");
  }

  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ["script-src", ...scriptSources],
    ["script-src-attr", "'none'"],
    [
      "style-src",
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
    ],
    ["font-src", "'self'", "data:", "https://fonts.gstatic.com"],
    [
      "img-src",
      "'self'",
      "data:",
      "blob:",
      supabase.http,
      "https://images.unsplash.com",
      "https://plus.unsplash.com",
      "https://lh3.googleusercontent.com",
      "https://images.higgs.ai",
      "https://cdn.kelolako.com",
      "https://d8j0ntlcm91z4.cloudfront.net",
    ],
    ["media-src", "'self'", "data:", "blob:", "https:"],
    ["connect-src", ...connectSources],
    ["frame-src", "https://www.youtube.com"],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
  ];

  if (isProduction) directives.push(["upgrade-insecure-requests"]);

  return directives
    .map(([directive, ...sources]) =>
      sources.length > 0 ? `${directive} ${sources.join(" ")}` : directive,
    )
    .join("; ");
}

export function securityHeaders({ isProduction, supabaseUrl }) {
  const headers = [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy({ isProduction, supabaseUrl }),
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  ];

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000",
    });
  }

  return headers;
}
