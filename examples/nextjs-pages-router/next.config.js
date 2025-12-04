/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Note: bodyParser configuration is handled per-route in Pages Router
  // See pages/api/webhook.ts for the required export config
}

module.exports = nextConfig