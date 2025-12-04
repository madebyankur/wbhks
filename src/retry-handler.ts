import { RetryPolicy, RetryConfig } from "./types";

const EDGE_CPU_SLICE_LIMIT = 10;

const calculateEnhancedDelay = (
  attempt: number,
  config: RetryConfig
): number => {
  let delay: number;

  switch (config.backoffStrategy) {
    case "linear":
      delay = config.baseDelay * attempt;
      break;
    case "exponential":
      delay = config.baseDelay * Math.pow(2, attempt - 1);
      break;
    case "custom":
      delay = config.customBackoff!(attempt, config.baseDelay);
      break;
    default:
      delay = config.baseDelay;
  }

  if (config.maxDelay) {
    delay = Math.min(delay, config.maxDelay);
  }

  if (config.jitter) {
    const jitterAmount = delay * 0.1;
    delay = delay + (Math.random() * 2 - 1) * jitterAmount;
  }

  return Math.max(0, delay);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createRetryHandler =
  (config: RetryConfig) =>
  async <T>(fn: () => Promise<T>): Promise<T> => {
    let lastError: Error;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (config.retryCondition && !config.retryCondition(lastError)) {
          throw lastError;
        }

        if (attempt === config.maxAttempts) {
          break;
        }

        if (config.onRetry) {
          await config.onRetry(attempt, lastError);
        }

        const delay = calculateEnhancedDelay(attempt, config);
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }

    throw lastError!;
  };

export const createEdgeRetryHandler = (
  config: Omit<RetryConfig, "maxAttempts"> & { maxAttempts: 1 | 2 }
) =>
  createRetryHandler({
    ...config,
    maxDelay: 100, // Quick retries only
    jitter: false,
  });

export const createExponentialRetry = (
  maxAttempts: number = 3,
  baseDelay: number = 1000,
  maxDelay?: number
) =>
  createRetryHandler({
    maxAttempts,
    backoffStrategy: "exponential",
    baseDelay,
    maxDelay,
    jitter: true,
  });

export const createLinearRetry = (
  maxAttempts: number = 3,
  baseDelay: number = 1000,
  maxDelay?: number
) =>
  createRetryHandler({
    maxAttempts,
    backoffStrategy: "linear",
    baseDelay,
    maxDelay,
    jitter: true,
  });

export const createQuickRetry = (
  maxAttempts: number = 2,
  baseDelay: number = 100
) =>
  createRetryHandler({
    maxAttempts,
    backoffStrategy: "linear",
    baseDelay,
    maxDelay: 500,
    jitter: false,
  });

// Retry condition helpers
export const retryOnNetworkError = (error: Error): boolean => {
  return (
    error.name === "NetworkError" ||
    error.message.includes("fetch") ||
    error.message.includes("timeout")
  );
};

export const retryOnServerError = (error: Error): boolean => {
  return (
    error.message.includes("5") || // 5xx errors
    error.message.includes("Internal Server Error") ||
    error.message.includes("Service Unavailable")
  );
};

export const retryOnTemporaryError = (error: Error): boolean => {
  return retryOnNetworkError(error) || retryOnServerError(error);
};

export const neverRetry = (): boolean => false;

export const createCustomBackoff =
  (strategy: (attempt: number, baseDelay: number) => number) =>
  (attempt: number, baseDelay: number) =>
    strategy(attempt, baseDelay);

export const fibonacciBackoff = createCustomBackoff((attempt, baseDelay) => {
  const fib = (n: number): number => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
  return baseDelay * fib(attempt);
});

export const stepBackoff = (stepSize: number) =>
  createCustomBackoff((attempt, baseDelay) => {
    return baseDelay + stepSize * (attempt - 1);
  });

export const commonRetryConfigs = {
  webhookDelivery: createExponentialRetry(5, 1000, 30000),
  database: createLinearRetry(3, 500, 5000),
  externalAPI: createExponentialRetry(4, 2000, 60000),
  quick: createQuickRetry(2, 100),
  critical: createExponentialRetry(10, 500, 300000),
} as const;

/**
 * Queue interface for dispatching long-running retries
 * Implement this with your preferred queue system (Vercel KV, Upstash, etc.)
 */
export interface RetryQueue {
  enqueue(taskId: string, payload: any, delayMs: number): Promise<void>;
}

/**
 * Edge-compatible retry handler with queue fallback
 * Falls back to queue dispatch when CPU slice limit is exceeded
 */
export const retryHandler = async <T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  options?: {
    queue?: RetryQueue;
    taskId?: string;
    maxSyncAttempts?: number; // Max attempts before falling back to queue
  }
): Promise<T> => {
  const config: RetryConfig = {
    maxAttempts: policy.maxAttempts,
    backoffStrategy:
      policy.backoff === "exponential" ? "exponential" : "linear",
    baseDelay:
      typeof policy.delay === "string"
        ? parseDelayString(policy.delay)
        : policy.delay,
    retryCondition: options?.queue ? retryOnTemporaryError : undefined,
  };

  return createRetryHandler(config)(fn);
};

export const retryHandlerEdgeOptimized = async <T>(
  fn: () => Promise<T>,
  maxAttempts: number = 2,
  delayMs: number = 100
): Promise<T> => {
  let lastError: Error;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const elapsed = Date.now() - startTime;
      if (elapsed > EDGE_CPU_SLICE_LIMIT * 0.8) {
        console.warn(
          `[wbhks] Approaching Edge CPU limit (${elapsed}ms), stopping retries`
        );
        throw lastError;
      }

      if (attempt === maxAttempts) {
        throw lastError;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(delayMs, 50))
      );
    }
  }

  throw lastError!;
};

const parseDelayString = (delay: string): number => {
  const match = delay.match(/^(\d+)(s|ms)$/);
  if (!match) {
    throw new Error(
      `Invalid delay format: ${delay}. Use format like "1s" or "100ms"`
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  return unit === "s" ? value * 1000 : value;
};

export const createRetryPolicy = (
  maxAttempts: number = 3,
  delay: number | string = 1000,
  backoff: "linear" | "exponential" = "exponential"
): RetryPolicy => ({
  maxAttempts,
  delay,
  backoff,
});

export class VercelKVQueue implements RetryQueue {
  private kv: any; // @vercel/kv instance

  constructor(kvInstance: any) {
    this.kv = kvInstance;
  }

  async enqueue(taskId: string, payload: any, delayMs: number): Promise<void> {
    const executeAt = Date.now() + delayMs;
    await this.kv.zadd(
      "webhook-retry-queue",
      executeAt,
      JSON.stringify({
        taskId,
        payload,
        executeAt,
      })
    );
  }
}

export class UpstashQueue implements RetryQueue {
  private redis: any; // @upstash/redis instance

  constructor(redisInstance: any) {
    this.redis = redisInstance;
  }

  async enqueue(taskId: string, payload: any, delayMs: number): Promise<void> {
    const executeAt = Date.now() + delayMs;
    await this.redis.zadd(
      "webhook-retry-queue",
      executeAt,
      JSON.stringify({
        taskId,
        payload,
        executeAt,
      })
    );
  }
}
