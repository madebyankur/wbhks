import {
  WebhookConfig,
  WebhookContext,
  SecurityConfig,
  ValidationConfig,
  WebhookMiddleware,
} from "./types";
import { createWebhookError, createErrorResponse } from "./webhook-validation";
import { verifySignature } from "./verify-signature";
import { validateWebhookPayload, parseTimestamp } from "./webhook-validation";

export const composeMiddleware =
  (...middlewares: WebhookMiddleware[]) =>
  async (context: WebhookContext, finalHandler: () => Promise<void>) => {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++];
        await middleware.execute(context, next);
      } else {
        await finalHandler();
      }
    };

    await next();
  };

const getClientIP = (request: Request): string => {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
};

/**
 * Enhanced validation middleware
 */
export function createValidationMiddleware(
  validationConfig: ValidationConfig = {}
): WebhookMiddleware {
  return {
    name: "validation",
    execute: async (context, next) => {
      const { request } = context;

      if (request.method !== "POST") {
        throw createWebhookError(
          "Method not allowed",
          "METHOD_NOT_ALLOWED",
          405
        );
      }

      if (validationConfig.maxPayloadSize) {
        const contentLength = parseInt(
          request.headers.get("content-length") || "0"
        );
        if (contentLength > validationConfig.maxPayloadSize) {
          throw createWebhookError(
            `Payload size ${contentLength} exceeds maximum ${validationConfig.maxPayloadSize}`,
            "PAYLOAD_TOO_LARGE",
            413
          );
        }
      }

      if (validationConfig.requireSignature) {
        const signatureResult = await verifySignature(
          request,
          context.config.secret
        );
        if (!signatureResult.valid) {
          throw createWebhookError(
            signatureResult.error || "Invalid signature",
            "INVALID_SIGNATURE",
            401,
            signatureResult.metadata
          );
        }
      }

      if (validationConfig.requireTimestamp) {
        const timestamp = request.headers.get("webhook-timestamp");
        if (!timestamp) {
          throw createWebhookError(
            "Timestamp required",
            "TIMESTAMP_REQUIRED",
            400
          );
        }

        try {
          parseTimestamp(timestamp);
        } catch (error) {
          throw createWebhookError(
            "Invalid timestamp format",
            "INVALID_TIMESTAMP",
            400
          );
        }
      }

      const body = await request.json();
      const validation = validateWebhookPayload(body);

      if (!validation.valid) {
        throw createWebhookError(
          "Invalid webhook payload",
          "INVALID_PAYLOAD",
          400,
          { validationErrors: validation.errors }
        );
      }

      if (validationConfig.allowedEventTypes?.length) {
        const eventType = body.type || body.event_type;
        if (
          !eventType ||
          !validationConfig.allowedEventTypes.includes(eventType)
        ) {
          throw createWebhookError(
            `Event type '${eventType}' not allowed`,
            "EVENT_TYPE_NOT_ALLOWED",
            400
          );
        }
      }

      context.metadata.validatedPayload = validation.data;

      await next();
    },
  };
}

/**
 * Enhanced logging middleware
 */
export function createLoggingMiddleware(
  logger: (message: string, data?: any) => void
): WebhookMiddleware {
  return {
    name: "logging",
    execute: async (context, next) => {
      const start = Date.now();
      logger("Webhook received", {
        url: context.request.url,
        method: context.request.method,
      });

      try {
        await next();
        const duration = Date.now() - start;
        logger("Webhook processed successfully", {
          eventType: context.event?.type,
          duration,
        });
      } catch (error) {
        logger("Webhook processing failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          eventType: context.event?.type,
        });
        throw error;
      }
    },
  };
}

/**
 * Security middleware
 */
export function createSecurityMiddleware(
  config: SecurityConfig
): WebhookMiddleware {
  return {
    name: "security",
    execute: async (context, next) => {
      const { request } = context;

      if (config.allowedIPs?.length) {
        const clientIP = getClientIP(request);
        if (!config.allowedIPs.includes(clientIP)) {
          throw createWebhookError(
            `IP ${clientIP} not allowed`,
            "IP_NOT_ALLOWED",
            403
          );
        }
      }

      if (config.allowedUserAgents?.length) {
        const userAgent = request.headers.get("user-agent");
        if (!userAgent) {
          throw createWebhookError(
            "User agent required",
            "USER_AGENT_REQUIRED",
            400
          );
        }

        const isAllowed = config.allowedUserAgents.some((pattern) =>
          pattern.test(userAgent)
        );
        if (!isAllowed) {
          throw createWebhookError(
            "User agent not allowed",
            "USER_AGENT_NOT_ALLOWED",
            403
          );
        }
      }

      if (config.maxPayloadSize) {
        const contentLength = parseInt(
          request.headers.get("content-length") || "0"
        );
        if (contentLength > config.maxPayloadSize) {
          throw createWebhookError(
            `Payload size ${contentLength} exceeds maximum ${config.maxPayloadSize}`,
            "PAYLOAD_TOO_LARGE",
            413
          );
        }
      }

      if (config.requireHttps) {
        if (!request.url.startsWith("https:")) {
          throw createWebhookError("HTTPS required", "HTTPS_REQUIRED", 400);
        }
      }

      if (config.timestampTolerance) {
        const timestamp = request.headers.get("webhook-timestamp");
        if (timestamp) {
          try {
            const webhookTime = parseTimestamp(timestamp);
            const now = Date.now();
            const diffSeconds = Math.abs(now - webhookTime) / 1000;

            if (diffSeconds > config.timestampTolerance) {
              throw createWebhookError(
                `Request timestamp ${diffSeconds}s old, max allowed ${config.timestampTolerance}s`,
                "TIMESTAMP_TOO_OLD",
                400
              );
            }
          } catch (error) {
            throw createWebhookError(
              "Invalid timestamp format",
              "INVALID_TIMESTAMP",
              400
            );
          }
        }
      }

      await next();
    },
  };
}

/**
 * Enhanced rate limiting middleware
 */
export function createRateLimitMiddleware(options: {
  maxRequests?: number;
  windowMs?: number;
  keyGenerator?: (request: Request) => string;
}): WebhookMiddleware {
  const maxRequests = options.maxRequests || 100;
  const windowMs = options.windowMs || 60000; // 1 minute
  const keyGenerator = options.keyGenerator || ((req) => getClientIP(req));

  const requests = new Map<string, { count: number; resetTime: number }>();

  return {
    name: "rateLimit",
    execute: async (context, next) => {
      const key = keyGenerator(context.request);
      const now = Date.now();
      const window = requests.get(key);

      if (!window || now > window.resetTime) {
        requests.set(key, { count: 1, resetTime: now + windowMs });
      } else if (window.count >= maxRequests) {
        throw createWebhookError(
          "Rate limit exceeded",
          "RATE_LIMIT_EXCEEDED",
          429
        );
      } else {
        window.count++;
      }

      await next();
    },
  };
}

/**
 * Enhanced CORS middleware
 */
export function createCorsMiddleware(options: {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
}): WebhookMiddleware {
  const origin = options.origin || "*";
  const methods = options.methods || ["POST"];
  const headers = options.headers || ["Content-Type", "Authorization"];

  return {
    name: "cors",
    execute: async (context, next) => {
      const { request } = context;

      // Handle preflight requests
      if (request.method === "OPTIONS") {
        context.metadata.corsResponse = new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": Array.isArray(origin)
              ? origin.join(", ")
              : origin,
            "Access-Control-Allow-Methods": methods.join(", "),
            "Access-Control-Allow-Headers": headers.join(", "),
          },
        });
        return;
      }

      await next();

      // Add CORS headers to response
      if (context.metadata.response) {
        const newHeaders = new Headers(context.metadata.response.headers);
        newHeaders.set(
          "Access-Control-Allow-Origin",
          Array.isArray(origin) ? origin.join(", ") : origin
        );
        newHeaders.set("Access-Control-Allow-Methods", methods.join(", "));
        newHeaders.set("Access-Control-Allow-Headers", headers.join(", "));

        context.metadata.response = new Response(
          context.metadata.response.body,
          {
            status: context.metadata.response.status,
            statusText: context.metadata.response.statusText,
            headers: newHeaders,
          }
        );
      }
    },
  };
}

/**
 * Enhanced webhook handler with middleware
 */
export function createWebhookHandlerWithMiddleware(
  config: WebhookConfig,
  middlewares: WebhookMiddleware[] = []
) {
  const composedMiddleware = composeMiddleware(...middlewares);

  return async (req: Request): Promise<Response> => {
    const context: WebhookContext = {
      request: req,
      config,
      metadata: {},
    };

    try {
      await composedMiddleware(context, async () => {
        await processCoreWebhook(context);
      });

      return createSuccessResponse(context);
    } catch (error) {
      return createErrorResponse(error as Error);
    }
  };
}

async function processCoreWebhook(context: WebhookContext): Promise<void> {
  const { request, config, metadata } = context;

  const body = metadata.validatedPayload || (await request.json());

  const eventId = body.id || body.event_id || `webhook-${Date.now()}`;
  const eventType = body.type || body.event_type;

  if (!eventType) {
    throw createWebhookError(
      "Event type is required",
      "EVENT_TYPE_REQUIRED",
      400
    );
  }

  if (!config.onEvent[eventType]) {
    throw createWebhookError(
      `Event type '${eventType}' not supported`,
      "EVENT_TYPE_NOT_SUPPORTED",
      400
    );
  }

  const event = {
    id: eventId,
    type: eventType,
    data: body.data || body,
    timestamp: body.timestamp || Date.now(),
    metadata: {
      receivedAt: new Date().toISOString(),
      userAgent: request.headers.get("user-agent") || undefined,
      ip: getClientIP(request),
    },
  };

  context.event = event;

  await config.onEvent[eventType](event);
}

function createSuccessResponse(context: WebhookContext): Response {
  const response = new Response(
    JSON.stringify({
      success: true,
      message: "Event processed successfully",
      eventId: context.event?.id,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );

  // Store response in context for middleware access
  context.metadata.response = response;

  return response;
}
