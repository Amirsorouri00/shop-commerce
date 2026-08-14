/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: no Node runtime for the app itself. The bundle is served from a CDN and
  // link previews are handled by the separate `og` service — see the deviation note in
  // CLAUDE.md for why we gave up SSR and what we did to recover the preview.
  output: 'export',

  // Workspace packages are consumed as TypeScript source, so Next must transpile them.
  transpilePackages: ['@xb/contracts', '@xb/core', '@xb/validation'],

  // Static export cannot run the image optimiser, which needs a server.
  images: { unoptimized: true },

  // Directory-style URLs so a static host serves /orders/index.html for /orders.
  trailingSlash: true,

  reactStrictMode: true,

  // Several lockfiles exist above this directory; pin the trace root so Next does not
  // guess a parent of the monorepo.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
