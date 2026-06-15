type EnvMap = NodeJS.ProcessEnv;

export function normalizeRuntimeEnv(env: EnvMap = process.env): void {
  aliasEnv(env, "DATABASE_URL", ["NEON_CONNECTION_STRING"]);
  aliasEnv(env, "BL_WORKSPACE", ["SPECIALIST_SANDBOX_WORKSPACE", "BLAXEL_TIER_1_WORKSPACE"]);
  aliasEnv(env, "BL_API_KEY", ["SPECIALIST_SANDBOX_API_KEY", "BLAXEL_TIER_1_API_KEY"]);
  aliasEnv(env, "MAESTRO_PUBLIC_URL", ["RENDER_EXTERNAL_URL", "RENDER_URL"]);
  aliasEnv(env, "RAILWAY_API_TOKEN", ["GENERATED_SITE_HOST_RAILWAY_API_TOKEN", "GENERATED_SITE_HOST_API_TOKEN"]);
  aliasEnv(env, "RAILWAY_TOKEN", ["GENERATED_SITE_HOST_RAILWAY_TOKEN", "GENERATED_SITE_HOST_TOKEN"]);
  aliasEnv(env, "RAILWAY_PROJECT_ID", ["GENERATED_SITE_HOST_PROJECT_ID"]);
  aliasEnv(env, "RAILWAY_SERVICE_ID", ["GENERATED_SITE_HOST_SERVICE_ID"]);
  aliasEnv(env, "RAILWAY_ENVIRONMENT_ID", ["GENERATED_SITE_HOST_ENVIRONMENT_ID"]);
}

function aliasEnv(env: EnvMap, target: string, aliases: string[]): void {
  if (env[target]) return;
  const value = aliases.map((name) => env[name]).find(Boolean);
  if (value) env[target] = value;
}
