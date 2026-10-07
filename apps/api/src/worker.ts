import { loadEnv } from "./env.js";
import { buildServices } from "./services.js";
import { startQueueWorker } from "./jobs.js";
import { buildJobHandler } from "./job-handlers.js";

const env = loadEnv();
const svc = buildServices(env);

if (!env.REDIS_URL) {
  console.error("REDIS_URL is not set. In dev, jobs run inside the API process; this worker is only needed with Redis.");
  process.exit(1);
}

const worker = startQueueWorker(svc, buildJobHandler(svc));
worker.on("completed", (job) => console.log(`[worker] ${job.name} ${job.data.bookingId} done`));
worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed`, err));
console.log("[worker] listening for booking jobs");
