import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dashboard cards were loading real full-res slide PNGs (400-600KB each, per the actual
  // generation logs) just to display a ~220px-wide thumbnail -- next/image needs this remote
  // pattern allowlisted before it can resize/optimize Supabase Storage URLs at all.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }],
  },
};

export default nextConfig;
