import PQueue from "p-queue";
import { getEnv } from "@/lib/env";

declare global {
  var __glmOcrRunQueue: PQueue | undefined;
}

export function getRunQueue(): PQueue {
  if (globalThis.__glmOcrRunQueue) {
    return globalThis.__glmOcrRunQueue;
  }

  const env = getEnv();
  globalThis.__glmOcrRunQueue = new PQueue({
    concurrency: env.PROCESS_QUEUE_CONCURRENCY,
  });

  return globalThis.__glmOcrRunQueue;
}

export function enqueueRun(task: () => Promise<void>): Promise<void> {
  const queue = getRunQueue();
  return queue.add(task);
}
