import { withWorkflow } from "workflow/next";
import { securityHeaders } from "./lib/security-headers.mjs";

function supabaseStorageImagePattern() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is required to configure image optimization",
    );
  }

  const storageUrl = new URL(rawUrl);
  const protocol = storageUrl.protocol.slice(0, -1);
  if (
    (protocol !== "http" && protocol !== "https") ||
    (process.env.NODE_ENV === "production" && protocol !== "https")
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production");
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket)) {
    throw new Error("SUPABASE_STORAGE_BUCKET is not a valid path segment");
  }

  return {
    protocol,
    hostname: storageUrl.hostname,
    port: storageUrl.port,
    pathname: `/storage/v1/object/sign/${bucket}/**`,
  };
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["shaders", "@xyflow/react"],
  poweredByHeader: false,
  // Former design-variant route; homepage is only `/` now.
  async redirects() {
    return [{ source: "/hello", destination: "/", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          isProduction: process.env.NODE_ENV === "production",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "plus.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        // Private bucket reads. Letting the optimizer handle these is what keeps a
        // 5 MB source PNG from being shipped whole into a 200 px grid cell: Vercel
        // fetches the original from Supabase once, then serves resized WebP from its
        // own edge. Requires the signed URL to be stable (see lib/storage-signed-url).
        ...supabaseStorageImagePattern(),
      },
      {
        protocol: "https",
        hostname: "images.higgs.ai",
      },
    ],
    // Default is 60s, which would send the optimizer back to Supabase for the source
    // image every minute and undo the saving. Matches SIGN_TTL.ui.
    minimumCacheTTL: 2592000,
  },
};

export default withWorkflow(nextConfig);
