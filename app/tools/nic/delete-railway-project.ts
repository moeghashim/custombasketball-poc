import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const project = process.argv[2];
  if (!project) throw new Error("usage: tsx tools/nic/delete-railway-project.ts <railway-project-id-or-name>");
  const railwayEnv = {
    ...process.env,
    CI: "true",
    RAILWAY_API_TOKEN: optionalEnv(["RAILWAY_API_TOKEN", "GENERATED_SITE_HOST_RAILWAY_API_TOKEN", "GENERATED_SITE_HOST_API_TOKEN"]),
    RAILWAY_TOKEN: optionalEnv(["RAILWAY_TOKEN", "GENERATED_SITE_HOST_RAILWAY_TOKEN", "GENERATED_SITE_HOST_TOKEN"]),
  };
  if (!railwayEnv.RAILWAY_API_TOKEN && !railwayEnv.RAILWAY_TOKEN) {
    throw new Error("RAILWAY_API_TOKEN or RAILWAY_TOKEN is required");
  }

  await execFileAsync("railway", ["project", "delete", "--project", project, "--yes", "--json"], {
    env: railwayEnv,
    maxBuffer: 1024 * 1024 * 5,
  });
  console.log(`scheduled Railway project deletion for ${project}`);
}

function optionalEnv(names: string[]): string | undefined {
  return names.map((name) => process.env[name]).find(Boolean);
}
