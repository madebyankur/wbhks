import { v4 as uuidv4 } from "uuid";
import {
  WebhookResponse,
  SignatureVerificationResult,
  StandardWebhookEvent,
} from "./types";
import { verifySignature } from "./verify-signature";
import { retryHandler, createRetryPolicy } from "./retry-handler";
import { checkIdempotency, markEventProcessed } from "./idempotency";
import {
  validateWebhookConfig,
  validateWebhookPayload,
  parseTimestamp,
  extractEventType,
  extractEventId,
  createErrorResponse,
  createValidationError,
  createSignatureError,
} from "./webhook-validation";

export const createWebhookEndpoint = (config: unknown) => {
  const validatedConfig = validateWebhookConfig(config);

  const defaultRetryPolicy = createRetryPolicy(3, "2s", "exponential");
  const retryPolicy = validatedConfig.retryPolicy || defaultRetryPolicy;
  const idempotencyKey = validatedConfig.idempotencyKey || "id";
  const signatureVerification =
    validatedConfig.signatureVerification || verifySignature;

  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const signatureResult = (await signatureVerification(
        req,
        validatedConfig.secret
      )) as SignatureVerificationResult;

      if (!signatureResult.valid) {
        return createErrorResponse(
          createSignatureError(
            signatureResult.error || "Invalid signature",
            signatureResult.metadata
          )
        );
      }

      const body = await req.json();
      const validation = validateWebhookPayload(body);

      if (!validation.valid) {
        return createErrorResponse(
          createValidationError("Invalid webhook payload", validation.errors)
        );
      }

      const webhookId = req.headers.get("webhook-id") || uuidv4();
      const webhookTimestamp = req.headers.get("webhook-timestamp");
      const webhookSignature = req.headers.get("webhook-signature");
      const webhookScheme = req.headers.get("webhook-scheme") || "v1";
      const webhookVersion = req.headers.get("webhook-version") || "1.0";

      const eventId = extractEventId(body, idempotencyKey);
      const eventType = extractEventType(body);

      if (await checkIdempotency(eventId)) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Event already processed",
            eventId,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      const event: StandardWebhookEvent = {
        id: eventId,
        type: eventType,
        data: body.data || body,
        timestamp: parseTimestamp(webhookTimestamp),
        metadata: {
          webhook_id: webhookId,
          webhook_timestamp: webhookTimestamp || undefined,
          webhook_signature: webhookSignature || undefined,
          webhook_scheme: webhookScheme,
          webhook_version: webhookVersion,
          receivedAt: new Date().toISOString(),
          userAgent: req.headers.get("user-agent") || undefined,
          ip:
            req.headers.get("x-forwarded-for") ||
            req.headers.get("x-real-ip") ||
            undefined,
        },
      };

      if (!validatedConfig.onEvent[eventType]) {
        return createErrorResponse(
          createValidationError(`Event type '${eventType}' not supported`, [])
        );
      }

      await retryHandler(async () => {
        await validatedConfig.onEvent[eventType](event);
      }, retryPolicy);

      await markEventProcessed(eventId);

      const response: WebhookResponse = {
        success: true,
        message: "Event processed successfully",
        eventId,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Webhook processing error:", error);
      return createErrorResponse(error as Error);
    }
  };
};
