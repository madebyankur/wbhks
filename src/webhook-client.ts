import { v4 as uuidv4 } from "uuid";
import {
  generateStandardWebhookHeaders,
  generateSignature,
} from "./verify-signature";
import { createRetryHandler } from "./retry-handler";
import {
  WebhookClientConfig,
  WebhookDelivery,
  WebhookPayload,
  WebhookClientResponse,
} from "./types";

export interface GenericWebhookClientConfig {
  secret: string;
  baseUrl?: string;
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number;
}

export interface GenericWebhookPayload {
  id?: string;
  type: string;
  data: Record<string, any>;
  timestamp?: number;
  metadata?: Record<string, any>;
}

export type {
  WebhookClientConfig,
  WebhookDelivery,
  WebhookPayload,
  WebhookClientResponse,
} from "./types";

export class WebhookClient {
  private config: GenericWebhookClientConfig;

  constructor(config: GenericWebhookClientConfig) {
    this.config = {
      retryAttempts: 3,
      retryDelay: 1000,
      timeout: 10000,
      ...config,
    };
  }

  /**
   * Send a webhook using Standard Webhooks format
   */
  async sendStandardWebhook(
    endpoint: string,
    payload: WebhookPayload
  ): Promise<WebhookClientResponse> {
    const webhookId = payload.id || crypto.randomUUID();
    const timestamp = payload.timestamp || Date.now();
    const body = JSON.stringify(payload);

    const headers = await generateStandardWebhookHeaders(
      webhookId,
      body,
      this.config.secret,
      "v1",
      "1.0"
    );

    return this.sendWebhook(endpoint, body, {
      "Content-Type": "application/json",
      ...headers,
    });
  }

  /**
   * Send a webhook using generic format
   */
  async sendGenericWebhook(
    endpoint: string,
    payload: GenericWebhookPayload
  ): Promise<WebhookClientResponse> {
    const body = JSON.stringify(payload);
    const signature = await generateSignature(body, this.config.secret);

    return this.sendWebhook(endpoint, body, {
      "Content-Type": "application/json",
      "x-signature": signature,
    });
  }

  /**
   * Send a webhook with custom headers
   */
  async sendWebhook(
    endpoint: string,
    body: string,
    headers: Record<string, string> = {}
  ): Promise<WebhookClientResponse> {
    const url = this.config.baseUrl
      ? `${this.config.baseUrl}${endpoint}`
      : endpoint;

    for (let attempt = 1; attempt <= this.config.retryAttempts!; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeout
        );

        const response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseBody = await response.text();

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          success: response.ok,
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
        };
      } catch (error) {
        if (attempt === this.config.retryAttempts!) {
          throw new Error(
            `Webhook delivery failed after ${
              this.config.retryAttempts
            } attempts: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }

        const delay = this.config.retryDelay! * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error("Webhook delivery failed");
  }

  /**
   * Send multiple webhooks in parallel
   */
  async sendWebhooks(
    endpoints: string[],
    payload: WebhookPayload,
    useStandardFormat: boolean = true
  ): Promise<WebhookClientResponse[]> {
    const promises = endpoints.map((endpoint) =>
      useStandardFormat
        ? this.sendStandardWebhook(endpoint, payload)
        : this.sendGenericWebhook(endpoint, payload as GenericWebhookPayload)
    );

    return Promise.allSettled(promises).then((results) =>
      results.map((result) =>
        result.status === "fulfilled"
          ? result.value
          : { success: false, status: 0, headers: {}, body: result.reason }
      )
    );
  }
}

/**
 * Create a webhook client instance
 */
export function createWebhookClient(
  config: GenericWebhookClientConfig
): WebhookClient {
  return new WebhookClient(config);
}

/**
 * Send a single webhook (convenience function)
 */
export async function sendWebhook(
  endpoint: string,
  payload: GenericWebhookPayload,
  config: GenericWebhookClientConfig,
  useStandardFormat: boolean = true
): Promise<WebhookClientResponse> {
  const client = createWebhookClient(config);
  return useStandardFormat
    ? client.sendStandardWebhook(endpoint, payload)
    : client.sendGenericWebhook(endpoint, payload);
}

// Enhanced functional webhook client
export const createFunctionalWebhookClient = (config: WebhookClientConfig) => {
  const retryHandler = config.retryConfig
    ? createRetryHandler(config.retryConfig)
    : createRetryHandler({
        maxAttempts: 1,
        backoffStrategy: "linear",
        baseDelay: 0,
      });

  const sendWebhook = async <T = any>(
    endpoint: string,
    payload: WebhookPayload
  ): Promise<WebhookDelivery> => {
    let delivery: WebhookDelivery = {
      id: uuidv4(),
      status: "pending",
      attempts: 0,
      createdAt: new Date(),
    };

    try {
      await retryHandler(async () => {
        delivery = {
          ...delivery,
          attempts: delivery.attempts + 1,
        };
        const response = await executeWebhookRequest(config, endpoint, payload);
        delivery = {
          ...delivery,
          status: "delivered",
          deliveredAt: new Date(),
          response: response,
        };
      });
    } catch (error) {
      delivery = {
        ...delivery,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    return delivery;
  };

  const sendBatch = async <T = any>(
    endpoints: string[],
    payload: WebhookPayload
  ): Promise<WebhookDelivery[]> => {
    return Promise.all(
      endpoints.map((endpoint) => sendWebhook(endpoint, payload))
    );
  };

  return {
    send: sendWebhook,
    sendBatch,
    generateSignature: (body: string) => generateSignature(body, config.secret),
    generateHeaders: (webhookId: string, body: string) =>
      generateStandardWebhookHeaders(webhookId, body, config.secret),
  };
};

const executeWebhookRequest = async (
  config: WebhookClientConfig,
  endpoint: string,
  payload: WebhookPayload
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> => {
  const body = JSON.stringify(payload);
  const standardHeaders = await generateStandardWebhookHeaders(
    uuidv4(),
    body,
    config.secret
  );

  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": config.userAgent || "wbhks-client/1.0",
      ...standardHeaders,
    },
    body,
    signal: config.timeout ? AbortSignal.timeout(config.timeout) : undefined,
  });

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    headers: responseHeaders,
    body: await response.text(),
  };
};

export const sendWebhookFunctional = async <T = any>(
  endpoint: string,
  payload: WebhookPayload,
  config: WebhookClientConfig
): Promise<WebhookDelivery> => {
  const client = createFunctionalWebhookClient(config);
  return client.send(endpoint, payload);
};
