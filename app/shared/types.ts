export type AgentName = "nic" | "max";
export type JobStatus = "queued" | "dispatched" | "running" | "succeeded" | "failed" | "timed_out";
export type StageId = "build" | "report" | "system";

export type TerminalLogKind = "cmd" | "ok" | "arr" | "dim" | "";

export type FlowEvent =
  | { event: "activate"; step: StageId }
  | { event: "log"; step: StageId; kind: TerminalLogKind; text: string }
  | { event: "data"; step: StageId; patch: Record<string, unknown> }
  | { event: "progress"; step: StageId; n: number }
  | { event: "complete"; step: StageId }
  | { event: "ack"; step: StageId; text: string }
  | { event: "error"; step: StageId; text: string };

export interface JobRequest<TBrief extends Record<string, unknown> = Record<string, unknown>> {
  job_id: string;
  run_id: string;
  agent: AgentName;
  task: string;
  brief: TBrief;
  callback_url: string;
  issued_at: string;
}

export interface ToolResult<TData = unknown> {
  ok: boolean;
  tool: AgentName;
  command: string;
  data: TData | null;
  error: string | null;
  meta: Record<string, unknown>;
}

export interface IngestEnvelope {
  job_id: string;
  event?: FlowEvent;
  result?: ToolResult;
}

export interface JobRecord {
  id: string;
  run_id: string;
  agent: AgentName;
  task: string;
  status: JobStatus;
  hmac_secret: string;
  input: JobRequest;
  output: ToolResult | null;
  error: string | null;
  sandbox_name: string | null;
  created_at: Date;
  updated_at: Date;
}
