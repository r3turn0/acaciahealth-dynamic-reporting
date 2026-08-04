/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Ensure mssql (native Node modules) only runs server-side
  serverExternalPackages: ["mssql"],
  // Expose all database + auth env vars to the server-side runtime.
  // These are server-only (no NEXT_PUBLIC_ prefix) — never sent to the browser.
  env: {
    // Database — individual vars (recommended for on-prem SQL Server)
    DB_HOST:                process.env.DB_HOST,
    DB_PORT:                process.env.DB_PORT,
    DB_NAME:                process.env.DB_NAME,
    DB_USER:                process.env.DB_USER,
    DB_PASS:                process.env.DB_PASS,
    DB_ENCRYPT:             process.env.DB_ENCRYPT,
    DB_TRUST_CERT:          process.env.DB_TRUST_CERT,
    // Database — connection string alternative
    DATABASE_URL:           process.env.DATABASE_URL,
    SQL_CONNECTION_STRING:  process.env.SQL_CONNECTION_STRING,
    // AI
    AI_GATEWAY_API_KEY:     process.env.AI_GATEWAY_API_KEY,
    AZURE_OPENAI_API_KEY:   process.env.AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_ENDPOINT:  process.env.AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_DEPLOYMENT:process.env.AZURE_OPENAI_DEPLOYMENT,
    // Public feature switch only. NextAuth and Azure credentials remain
    // server-runtime variables and are never inlined into client bundles.
    NEXT_PUBLIC_AZURE_AUTH_ENABLED: process.env.AZURE_AD_CLIENT_ID ? "true" : "false",
  },
}

export default nextConfig
