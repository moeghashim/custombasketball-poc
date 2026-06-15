type EnvMap = NodeJS.ProcessEnv;

export function normalizeRuntimeEnv(env: EnvMap = process.env): void {
  aliasEnv(env, "DATABASE_URL", ["NEON_CONNECTION_STRING"]);
  aliasEnv(env, "BL_WORKSPACE", ["SPECIALIST_SANDBOX_WORKSPACE", "BLAXEL_TIER_1_WORKSPACE"]);
  aliasEnv(env, "BL_API_KEY", ["SPECIALIST_SANDBOX_API_KEY", "BLAXEL_TIER_1_API_KEY"]);
  aliasEnv(env, "DAYTONA_API_KEY", ["DAYTONA_PREVIEW_SANDBOX_API_KEY", "DAYTONA_TOP_UP_25_API_KEY"]);
  aliasEnv(env, "DAYTONA_API_URL", ["DAYTONA_PREVIEW_SANDBOX_API_URL", "DAYTONA_TOP_UP_25_API_URL"]);
  if (isInternalDaytonaApiUrl(env.DAYTONA_API_URL)) delete env.DAYTONA_API_URL;
  aliasEnv(env, "MAESTRO_PUBLIC_URL", ["RENDER_EXTERNAL_URL", "RENDER_URL"]);
}

function aliasEnv(env: EnvMap, target: string, aliases: string[]): void {
  if (env[target]) return;
  const value = aliases.map((name) => env[name]).find(Boolean);
  if (value) env[target] = value;
}

function isInternalDaytonaApiUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname === "daytona-api";
  } catch {
    return false;
  }
}
