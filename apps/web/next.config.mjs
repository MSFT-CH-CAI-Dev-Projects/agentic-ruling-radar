/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: { typedRoutes: false },
  // The web BFF (apps/web/app/api/rulings/route.ts) talks directly to two
  // Foundry hosted agents (agent-triage + agent-summary) via the invocations
  // protocol. Endpoint base + agent names are read from FOUNDRY_*
  // environment variables at request time.
};

export default nextConfig;
