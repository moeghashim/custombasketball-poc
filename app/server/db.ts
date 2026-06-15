import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { normalizeRuntimeEnv } from "./runtime-env.js";
import type { AgentName, JobRecord, JobRequest, JobStatus, ToolResult } from "../shared/types.js";

const { Pool } = pg;

normalizeRuntimeEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("DATABASE_URL or NEON_CONNECTION_STRING is not set; Maestro will fail until Neon credentials are pulled.");
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function migrate(): Promise<void> {
  await pool.query(`
    create table if not exists jobs (
      id text primary key,
      run_id text not null,
      agent text not null check (agent in ('nic', 'max')),
      task text not null,
      status text not null check (status in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'timed_out')),
      hmac_secret text not null,
      input jsonb not null,
      output jsonb,
      error text,
      sandbox_name text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      dispatched_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz
    )
  `);

  await pool.query(`
    create table if not exists results (
      id bigserial primary key,
      job_id text not null references jobs(id) on delete cascade,
      kind text not null check (kind in ('event', 'result')),
      payload jsonb not null,
      created_at timestamptz not null default now()
    )
  `);

  await pool.query(`create index if not exists jobs_run_id_idx on jobs(run_id, created_at)`);
  await pool.query(`create index if not exists results_job_id_idx on results(job_id, created_at)`);
}

function mapJob(row: pg.QueryResultRow): JobRecord {
  return {
    id: row.id,
    run_id: row.run_id,
    agent: row.agent,
    task: row.task,
    status: row.status,
    hmac_secret: row.hmac_secret,
    input: row.input,
    output: row.output,
    error: row.error,
    sandbox_name: row.sandbox_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createJob(params: {
  runId: string;
  agent: AgentName;
  task: string;
  brief: Record<string, unknown>;
  callbackUrl: string;
}): Promise<JobRecord> {
  const id = randomUUID();
  const hmacSecret = randomBytes(32).toString("hex");
  const input: JobRequest = {
    job_id: id,
    run_id: params.runId,
    agent: params.agent,
    task: params.task,
    brief: params.brief,
    callback_url: params.callbackUrl,
    issued_at: new Date().toISOString(),
  };

  const result = await pool.query(
    `insert into jobs (id, run_id, agent, task, status, hmac_secret, input)
     values ($1, $2, $3, $4, 'queued', $5, $6)
     returning *`,
    [id, params.runId, params.agent, params.task, hmacSecret, input],
  );
  return mapJob(result.rows[0]);
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const result = await pool.query(`select * from jobs where id = $1`, [id]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function updateJobStatus(
  id: string,
  status: JobStatus,
  patch: { sandboxName?: string; output?: ToolResult; error?: string | null } = {},
): Promise<JobRecord> {
  const result = await pool.query(
    `update jobs
     set status = $2,
         sandbox_name = coalesce($3, sandbox_name),
         output = coalesce($4, output),
         error = $5,
         dispatched_at = case when $2 = 'dispatched' then now() else dispatched_at end,
         started_at = case when $2 = 'running' then now() else started_at end,
         completed_at = case when $2 in ('succeeded', 'failed', 'timed_out') then now() else completed_at end,
         updated_at = now()
     where id = $1
     returning *`,
    [id, status, patch.sandboxName ?? null, patch.output ?? null, patch.error ?? null],
  );
  return mapJob(result.rows[0]);
}

export async function insertResult(jobId: string, kind: "event" | "result", payload: unknown): Promise<void> {
  await pool.query(`insert into results (job_id, kind, payload) values ($1, $2, $3)`, [jobId, kind, payload]);
}

export async function waitForTerminalJob(jobId: string, timeoutMs = 10 * 60 * 1000): Promise<JobRecord> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`job ${jobId} disappeared`);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "timed_out") return job;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return updateJobStatus(jobId, "timed_out", { error: "Timed out waiting for signed result" });
}
