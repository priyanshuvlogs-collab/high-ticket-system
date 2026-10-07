import { Queue, Worker, type Job } from "bullmq";
import type { Services } from "./services.js";

/**
 * Scheduled jobs: booking reminders and no-show re-engagement.
 * With REDIS_URL -> BullMQ (durable). Without -> in-process timers (dev/demo only, lost on restart).
 */
export type JobName = "reminder_24h" | "reminder_1h" | "no_show_check";
export interface JobData {
  bookingId: string;
}

const QUEUE_NAME = "bookedai-bookings";
let queue: Queue<JobData, void, JobName> | undefined;
const inProcess = new Map<string, NodeJS.Timeout>();

export type JobHandler = (name: JobName, data: JobData) => Promise<void>;
let localHandler: JobHandler | undefined;

/** Called by the worker (or the API in dev) to receive in-process jobs. */
export function setLocalJobHandler(h: JobHandler): void {
  localHandler = h;
}

function getQueue(svc: Services): Queue<JobData, void, JobName> | null {
  if (!svc.env.REDIS_URL) return null;
  queue ??= new Queue<JobData, void, JobName>(QUEUE_NAME, { connection: { url: svc.env.REDIS_URL } });
  return queue;
}

async function schedule(svc: Services, name: JobName, data: JobData, runAt: Date): Promise<void> {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  const q = getQueue(svc);
  const jobId = `${name}:${data.bookingId}`;
  if (q) {
    await q.add(name, data, { delay, jobId, removeOnComplete: true, removeOnFail: 100 });
    return;
  }
  // Dev fallback
  const existing = inProcess.get(jobId);
  if (existing) clearTimeout(existing);
  if (delay > 2_147_000_000) return; // beyond setTimeout range; fine for dev
  inProcess.set(
    jobId,
    setTimeout(() => {
      inProcess.delete(jobId);
      localHandler?.(name, data).catch((err) => console.error(`[jobs] ${name} failed`, err));
    }, delay),
  );
}

export async function scheduleBookingJobs(svc: Services, bookingId: string, startsAt: Date): Promise<void> {
  const h = 3_600_000;
  // In dev without Redis, compress the schedule so you can watch it happen.
  const devFast = !svc.env.REDIS_URL && svc.env.NODE_ENV !== "production";
  const t24 = devFast ? new Date(Date.now() + 20_000) : new Date(startsAt.getTime() - 24 * h);
  const t1 = devFast ? new Date(Date.now() + 40_000) : new Date(startsAt.getTime() - 1 * h);
  const tNoShow = devFast ? new Date(Date.now() + 60_000) : new Date(startsAt.getTime() + 30 * 60_000);
  await schedule(svc, "reminder_24h", { bookingId }, t24);
  await schedule(svc, "reminder_1h", { bookingId }, t1);
  await schedule(svc, "no_show_check", { bookingId }, tNoShow);
}

export async function cancelBookingJobs(svc: Services, bookingId: string): Promise<void> {
  const q = getQueue(svc);
  for (const name of ["reminder_24h", "reminder_1h", "no_show_check"] as JobName[]) {
    const id = `${name}:${bookingId}`;
    if (q) {
      const job = await q.getJob(id);
      await job?.remove().catch(() => undefined);
    } else {
      const t = inProcess.get(id);
      if (t) clearTimeout(t);
      inProcess.delete(id);
    }
  }
}

/** Start a BullMQ worker (requires REDIS_URL). */
export function startQueueWorker(svc: Services, handler: JobHandler): Worker<JobData, void, JobName> {
  if (!svc.env.REDIS_URL) throw new Error("REDIS_URL required for the queue worker");
  return new Worker<JobData, void, JobName>(
    QUEUE_NAME,
    async (job: Job<JobData, void, JobName>) => handler(job.name, job.data),
    { connection: { url: svc.env.REDIS_URL } },
  );
}
