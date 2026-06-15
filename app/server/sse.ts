import type { Response } from "express";
import type { FlowEvent } from "../shared/types.js";

interface Client {
  id: number;
  res: Response;
}

let nextClientId = 1;
const clients = new Map<number, Client>();

export function addSseClient(res: Response): () => void {
  const id = nextClientId++;
  clients.set(id, { id, res });

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`event: ready\ndata: {"ok":true}\n\n`);

  return () => {
    clients.delete(id);
  };
}

export function broadcastFlow(event: FlowEvent & { run_id?: string; job_id?: string }): void {
  const payload = JSON.stringify(event);
  for (const client of clients.values()) {
    client.res.write(`event: flow\ndata: ${payload}\n\n`);
  }
}

setInterval(() => {
  for (const client of clients.values()) {
    client.res.write(`: heartbeat\n\n`);
  }
}, 25_000).unref();
