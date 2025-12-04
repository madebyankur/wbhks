import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebhookEndpoint, generateSignature } from "../src";

import { clearProcessedEvents } from "../src/idempotency";

describe("Wbhks", () => {
  const secret = "test-secret";

  beforeEach(async () => {
    await clearProcessedEvents();
  });

  afterEach(async () => {
    await clearProcessedEvents();
  });

  describe("createWebhookEndpoint", () => {
    it("should process valid webhook events", async () => {
      const processedEvents: any[] = [];

      const webhookHandler = createWebhookEndpoint({
        secret,
        onEvent: {
          "user.created": async (event) => {
            processedEvents.push(event);
          },
        },
      });

      const eventData = {
        type: "user.created",
        data: { userId: "123", email: "test@example.com" },
        event_id: "test-123",
      };

      const body = JSON.stringify(eventData);
      const signature = await generateSignature(body, secret);

      const request = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body,
      });

      const response = await webhookHandler(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(processedEvents).toHaveLength(1);
      expect(processedEvents[0].data).toEqual(eventData.data);
    });

    it("should reject invalid signatures", async () => {
      const webhookHandler = createWebhookEndpoint({
        secret,
        onEvent: {
          "user.created": async () => {},
        },
      });

      const eventData = {
        type: "user.created",
        data: { userId: "123" },
      };

      const body = JSON.stringify(eventData);
      const invalidSignature = "invalid-signature";

      const request = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": invalidSignature,
        },
        body,
      });

      const response = await webhookHandler(request);
      const result = await response.json();

      expect(response.status).toBe(401);
      expect(result.success).toBe(false);
      expect(result.message).toBe("Invalid signature");
    });

    it("should handle idempotency", async () => {
      let processCount = 0;

      const webhookHandler = createWebhookEndpoint({
        secret,
        onEvent: {
          "user.created": async () => {
            processCount++;
          },
        },
        idempotencyKey: "event_id",
      });

      const eventData = {
        type: "user.created",
        data: { userId: "123" },
        event_id: "duplicate-123",
      };

      const body = JSON.stringify(eventData);
      const signature = await generateSignature(body, secret);

      // First request
      const request1 = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body,
      });

      const response1 = await webhookHandler(request1);
      const result1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(result1.success).toBe(true);
      expect(processCount).toBe(1);

      // Second request with same event_id
      const request2 = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body,
      });

      const response2 = await webhookHandler(request2);
      const result2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(result2.success).toBe(true);
      expect(result2.message).toBe("Event already processed");
      expect(processCount).toBe(1); // Should not process again
    });

    it("should reject unsupported event types", async () => {
      const webhookHandler = createWebhookEndpoint({
        secret,
        onEvent: {
          "user.created": async () => {},
        },
      });

      const eventData = {
        type: "unsupported.event",
        data: { userId: "123" },
      };

      const body = JSON.stringify(eventData);
      const signature = await generateSignature(body, secret);

      const request = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body,
      });

      const response = await webhookHandler(request);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toBe(
        "Event type 'unsupported.event' not supported"
      );
    });

    it("should reject non-POST requests", async () => {
      const webhookHandler = createWebhookEndpoint({
        secret,
        onEvent: {
          "user.created": async () => {},
        },
      });

      const request = new Request("http://localhost/webhook", {
        method: "GET",
      });

      const response = await webhookHandler(request);

      expect(response.status).toBe(405);
    });
  });

  describe("Retry Policy", () => {
    it("should retry failed operations", async () => {
      let attemptCount = 0;

      const webhookHandler = createWebhookEndpoint({
        secret,
        onEvent: {
          "user.created": async () => {
            attemptCount++;
            if (attemptCount < 3) {
              throw new Error("Simulated failure");
            }
          },
        },
        retryPolicy: {
          maxAttempts: 3,
          delay: 10, // Short delay for testing
          backoff: "exponential",
        },
        // Allow more sync attempts in test environment
        retryOptions: {
          maxSyncAttempts: 3,
        },
      });

      const eventData = {
        type: "user.created",
        data: { userId: "123" },
      };

      const body = JSON.stringify(eventData);
      const signature = await generateSignature(body, secret);

      const request = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": signature,
        },
        body,
      });

      const response = await webhookHandler(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(attemptCount).toBe(3);
    });
  });

  describe("Signature Generation", () => {
    it("should generate valid signatures", async () => {
      const body = '{"type":"test","data":{"id":"123"}}';
      const signature = await generateSignature(body, secret);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");
      expect(signature.length).toBeGreaterThan(0);
    });

    it("should generate consistent signatures for same input", async () => {
      const body = '{"type":"test","data":{"id":"123"}}';
      const signature1 = await generateSignature(body, secret);
      const signature2 = await generateSignature(body, secret);

      expect(signature1).toBe(signature2);
    });
  });
});
