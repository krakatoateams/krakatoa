import { withWorkflow } from "workflow/next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["shaders"],
  // Former design-variant route; homepage is only `/` now.
  async redirects() {
    return [{ source: "/hello", destination: "/", permanent: true }];
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
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        // Private bucket reads. Letting the optimizer handle these is what keeps a
        // 5 MB source PNG from being shipped whole into a 200 px grid cell: Vercel
        // fetches the original from Supabase once, then serves resized WebP from its
        // own edge. Requires the signed URL to be stable (see lib/storage-signed-url).
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/sign/**",
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
