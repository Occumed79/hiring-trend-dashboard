/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['pg', '@neondatabase/serverless']
  }
}
module.exports = nextConfig
