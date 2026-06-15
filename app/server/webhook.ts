import type { Express, Request, Response } from "express";
import { getJob, insertResult, updateJobStatus } from "./db.js";
import { broadcastFlow } from "./sse.js";
import { SIGNATURE_HEADER, verifySignature } from "../shared/signing.js";
import type { IngestEnvelope } from "../shared/types.js";

type RawRequest = Request & { rawBody?: Buffer };

export function installWebhook(app: Express): void {
  app.post("/api/jobs/:id/ingest", async (req: RawRequest, res: Response) => {
    const rawJobId = req.params.id;
    const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
    if (!jobId) return res.status(400).json({ error: "missing job id" });
    const job = await getJob(jobId);
    if (!job) return res.status(404).json({ error: "job not found" });

    const raw = req.rawBody;
    const signatureHeader = req.headers[SIGNATURE_HEADER];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!raw || !verifySignature(raw, signature, job.hmac_secret)) {
      return res.status(401).json({ error: "invalid signature" });
    }

    const envelope = req.body as IngestEnvelope;
    if (envelope.job_id !== jobId) {
      return res.status(400).json({ error: "job_id mismatch" });
    }

    if (envelope.event) {
      await insertResult(jobId, "event", envelope.event);
      if (envelope.event.event === "activate") {
        await updateJobStatus(jobId, "running");
      }
      broadcastFlow({ ...envelope.event, run_id: job.run_id, job_id: jobId });
    }

    if (envelope.result) {
      await insertResult(jobId, "result", envelope.result);
      await updateJobStatus(jobId, envelope.result.ok ? "succeeded" : "failed", {
        output: envelope.result,
        error: envelope.result.error,
      });
    }

    return res.json({ ok: true, action: "recorded" });
  });
}
