type EnvMap = NodeJS.ProcessEnv;

export function normalizeRuntimeEnv(env: EnvMap = process.env): void {
  aliasEnv(env, "DATABASE_URL", ["NEON_CONNECTION_STRING"]);
  aliasEnv(env, "BL_WORKSPACE", ["SPECIALIST_SANDBOX_WORKSPACE", "BLAXEL_TIER_1_WORKSPACE"]);
  aliasEnv(env, "BL_API_KEY", ["SPECIALIST_SANDBOX_API_KEY", "BLAXEL_TIER_1_API_KEY"]);
  aliasEnv(env, "MAESTRO_PUBLIC_URL", ["RENDER_EXTERNAL_URL", "RENDER_URL"]);
}

function aliasEnv(env: EnvMap, target: string, aliases: string[]): void {
  if (env[target]) return;
  const value = aliases.map((name) => env[name]).find(Boolean);
  if (value) env[target] = value;
}
