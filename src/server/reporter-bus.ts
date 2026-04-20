import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Reporter, PhaseId } from '../orchestrator/reporter.js';
import type { ReporterEvent, JobDto } from '../schema/dto.js';

const MAX_BUFFER = 1000;
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface Job {
  jobId: string;
  deploymentName: string;
  kind: 'up' | 'update' | 'destroy' | 'adopt' | 'upgrade';
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  events: ReporterEvent[];
  subscribers: Set<WebSocket>;
}

export class ReporterBus {
  private jobs = new Map<string, Job>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  createJob(
    deploymentName: string,
    kind: Job['kind'],
  ): { jobId: string; reporter: Reporter } {
    const jobId = randomBytes(8).toString('hex');
    const job: Job = {
      jobId,
      deploymentName,
      kind,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
      subscribers: new Set(),
    };
    this.jobs.set(jobId, job);

    const push = (event: ReporterEvent) => {
      if (job.events.length >= MAX_BUFFER) {
        job.events.shift();
      }
      job.events.push(event);
      const msg = JSON.stringify(event);
      for (const ws of job.subscribers) {
        try { ws.send(msg); } catch { /* client gone */ }
      }
    };

    const reporter: Reporter = {
      phaseStart(id: PhaseId, label: string) {
        push({ type: 'phase-start', id, label });
      },
      phaseDone(id: PhaseId) {
        push({ type: 'phase-done', id });
      },
      phaseFail(id: PhaseId, error: string) {
        push({ type: 'phase-fail', id, error });
      },
      log(line: string) {
        push({ type: 'log', line });
      },
      success(summary: string) {
        push({ type: 'success', summary });
      },
    };

    return { jobId, reporter };
  }

  finish(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    this.scheduleCleanup(jobId);
  }

  fail(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    const event: ReporterEvent = { type: 'error', message: error };
    job.events.push(event);
    const msg = JSON.stringify(event);
    for (const ws of job.subscribers) {
      try { ws.send(msg); } catch { /* */ }
    }
    this.scheduleCleanup(jobId);
  }

  subscribe(jobId: string, ws: WebSocket): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Replay buffered events
    for (const event of job.events) {
      try { ws.send(JSON.stringify(event)); } catch { /* */ }
    }
    job.subscribers.add(ws);
    ws.on('close', () => job.subscribers.delete(ws));
    return true;
  }

  getJob(jobId: string): JobDto | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return {
      jobId: job.jobId,
      deploymentName: job.deploymentName,
      kind: job.kind,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      events: [...job.events],
    };
  }

  private scheduleCleanup(jobId: string): void {
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(jobId);
      const job = this.jobs.get(jobId);
      if (job && job.status !== 'running') {
        for (const ws of job.subscribers) {
          try { ws.close(); } catch { /* */ }
        }
        this.jobs.delete(jobId);
      }
    }, JOB_TTL_MS);
    timer.unref();
    this.cleanupTimers.set(jobId, timer);
  }
}
