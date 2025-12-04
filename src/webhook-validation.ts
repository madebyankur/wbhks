import { z } from "zod";
import { WebhookError, ValidationResult, WebhookPayload } from "./types";

const WebhookPayloadSchema = z.object({
  type: z.string().min(1, "Event type is required"),
  data: z.unknown(),
  id: z.string().optional(),
  timestamp: z.number().optional(),
});

const WebhookConfigSchema = z.object({
  secret: z.string().min(16, "Webhook secret must be at least 16 characters"),
  onEvent: z.record(z.string(), z.function()),
  retryPolicy: z
    .object({
      maxAttempts: z.number().min(1).max(10),
      delay: z.union([z.number(), z.string()]),
      backoff: z.enum(["linear", "exponential"]).optional(),
    })
    .optional(),
  idempotencyKey: z.string().optional(),
  signatureVerification: z.function().optional(),
  timeout: z.number().min(1000).max(30000).optional(),
});

export const createWebhookError = (
  message: string,
  code: string,
  statusCode: number = 500,
  metadata?: Record<string, any>
): WebhookError => {
  const error = new Error(message) as WebhookError;
  error.code = code;
  error.statusCode = statusCode;
  error.metadata = metadata;
  return error;
};

export const createValidationError = (
  message: string,
  validationErrors: any[]
) => createWebhookError(message, "VALIDATION_ERROR", 400, { validationErrors });

export const createSignatureError = (
  message: string,
  metadata?: Record<string, any>
) => createWebhookError(message, "SIGNATURE_ERROR", 401, metadata);

export const createProcessingError = (message: string, originalError: Error) =>
  createWebhookError(message, "PROCESSING_ERROR", 500, {
    originalMessage: originalError.message,
    stack: originalError.stack,
  });

export const createErrorResponse = (error: WebhookError | Error): Response => {
  const webhookError =
    "code" in error
      ? (error as WebhookError)
      : createProcessingError(error.message, error);

  return new Response(
    JSON.stringify({
      success: false,
      message: webhookError.message,
      code: webhookError.code,
      metadata: webhookError.metadata,
    }),
    {
      status: webhookError.statusCode,
      headers: { "Content-Type": "application/json" },
    }
  );
};

export const validateWebhookPayload = (body: unknown): ValidationResult => {
  const result = WebhookPayloadSchema.safeParse(body);
  return {
    valid: result.success,
    data: result.success ? result.data : null,
    errors: result.success
      ? []
      : result.error.issues.map((issue: any) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
  };
};

export const validateWebhookConfig = (config: unknown) => {
  const result = WebhookConfigSchema.safeParse(config);
  if (!result.success) {
    throw createValidationError(
      "Invalid webhook configuration",
      result.error.issues
    );
  }
  return result.data;
};

export const parseTimestamp = (timestampStr: string | null): number => {
  if (!timestampStr) return Date.now();

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    throw createValidationError(`Invalid timestamp: ${timestampStr}`, []);
  }
  return timestamp * 1000;
};

export const extractEventType = (body: Record<string, any>): string => {
  const eventType = body.type || body.event_type;
  if (!eventType || typeof eventType !== "string" || eventType.trim() === "") {
    throw createValidationError("Missing or invalid event type", []);
  }
  return eventType.trim();
};

export const extractEventId = (
  body: Record<string, any>,
  idempotencyKey: string
): string => {
  const eventId = body[idempotencyKey] || body.id;
  if (!eventId || typeof eventId !== "string" || eventId.trim() === "") {
    throw createValidationError(
      `Missing or invalid event ID (key: ${idempotencyKey})`,
      []
    );
  }
  return eventId.trim();
};
