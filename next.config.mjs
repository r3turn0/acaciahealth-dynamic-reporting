/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  // Ensure mssql (native Node modules) only runs server-side
  serverExternalPackages: ["mssql"],
  // Expose env vars to server-side runtime
  env: {
    SQL_CONNECTION_STRING: process.env.SQL_CONNECTION_STRING,
  },
}

export default nextConfig
