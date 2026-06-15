import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const project = process.argv[2];
  if (!project) throw new Error("usage: tsx tools/nic/delete-pages-project.ts <pages-project>");

  await execFileAsync("wrangler", ["pages", "project", "delete", project, "--yes"], {
    env: {
      ...process.env,
      CI: "true",
      CLOUDFLARE_API_TOKEN: requiredEnv("CLOUDFLARE_API_TOKEN"),
      CLOUDFLARE_ACCOUNT_ID: requiredEnv("CLOUDFLARE_ACCOUNT_ID"),
    },
    maxBuffer: 1024 * 1024 * 5,
  });
  console.log(`deleted Cloudflare Pages project ${project}`);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
