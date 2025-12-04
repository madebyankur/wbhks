import {
  createWebhookEndpoint,
  generateSignature,
  generateStandardWebhookHeaders,
} from "../src";
import { createRetryPolicy } from "../src/retry-handler";

// Configuration
const secret = process.env.WEBHOOK_SECRET || "your-webhook-secret";
const port = parseInt(process.env.PORT || "3000");

// Event handlers
const onEvent = {
  "user.created": async (event: any) => {
    console.log("🎉 New user created:", event.data);
    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("✅ User creation processed successfully");
  },

  "payment.failed": async (event: any) => {
    console.log("❌ Payment failed:", event.data);
    // Simulate error handling
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log("📧 Payment failure notification sent");
  },

  "order.completed": async (event: any) => {
    console.log("🛒 Order completed:", event.data);
    // Simulate order processing
    await new Promise((resolve) => setTimeout(resolve, 150));
    console.log("📦 Order fulfillment initiated");
  },
};

// Retry policy
const retryPolicy = createRetryPolicy(3, "1s", "exponential");

// Create webhook endpoint
const webhookHandler = createWebhookEndpoint({
  secret,
  onEvent,
  retryPolicy,
  idempotencyKey: "event_id",
});

// Simple HTTP server for testing
const server = Bun.serve({
  port,
  fetch: async (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/webhook" && req.method === "POST") {
      return await webhookHandler(req);
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Test endpoint
    if (url.pathname === "/test") {
      const testEvents = [
        {
          type: "user.created",
          data: { userId: "123", email: "test@example.com", name: "Test User" },
          event_id: "test-user-123",
        },
        {
          type: "payment.failed",
          data: {
            paymentId: "pay_456",
            amount: 99.99,
            reason: "Insufficient funds",
          },
          event_id: "test-payment-456",
        },
        {
          type: "order.completed",
          data: {
            orderId: "ord_789",
            total: 149.99,
            items: ["Product A", "Product B"],
          },
          event_id: "test-order-789",
        },
      ];

      const eventType = url.searchParams.get("type") || "user.created";
      const testEvent =
        testEvents.find((e) => e.type === eventType) || testEvents[0];
      const useStandardHeaders = url.searchParams.get("standard") === "true";

      const body = JSON.stringify(testEvent);

      let headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (useStandardHeaders) {
        // Use Standard Webhooks headers
        const standardHeaders = await generateStandardWebhookHeaders(
          testEvent.event_id,
          body,
          secret,
          "v1",
          "1.0"
        );
        Object.assign(headers, standardHeaders);
      } else {
        // Use generic headers
        const signature = await generateSignature(body, secret);
        headers["x-signature"] = signature;
      }

      // Create a new request for testing
      const testRequest = new Request(`http://localhost:${port}/webhook`, {
        method: "POST",
        headers,
        body,
      });

      const response = await webhookHandler(testRequest);
      const result = await response.json();

      return new Response(
        JSON.stringify(
          {
            request: testEvent,
            headers: useStandardHeaders ? "Standard Webhooks" : "Generic",
            response: result,
            status: response.status,
          },
          null,
          2
        ),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Webhook playground running on http://localhost:${port}`);
console.log(`Available endpoints:`);
console.log(`   GET  /health - Health check`);
console.log(`   POST /webhook - Webhook endpoint`);
console.log(
  `   GET  /test?type=user.created - Test user.created event (generic)`
);
console.log(
  `   GET  /test?type=user.created&standard=true - Test user.created event (standard)`
);
console.log(
  `   GET  /test?type=payment.failed - Test payment.failed event (generic)`
);
console.log(
  `   GET  /test?type=payment.failed&standard=true - Test payment.failed event (standard)`
);
console.log(
  `   GET  /test?type=order.completed - Test order.completed event (generic)`
);
console.log(
  `   GET  /test?type=order.completed&standard=true - Test order.completed event (standard)`
);
console.log(``);
console.log(`Webhook secret: ${secret}`);
console.log(`Example curl commands:`);
console.log(`# Generic format:`);
const genericPayload =
  '{"type":"user.created","data":{"userId":"123"},"event_id":"test-123"}';
console.log(`curl -X POST http://localhost:${port}/webhook \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(
  `  -H "x-signature: $(echo -n '${genericPayload}' | openssl dgst -sha256 -hmac "${secret}" | cut -d' ' -f2)" \\`
);
console.log(`  -d '${genericPayload}'`);
console.log(``);
console.log(`# Standard Webhooks format:`);
const standardPayload =
  '{"type":"user.created","data":{"userId":"123"},"event_id":"test-123"}';
console.log(`curl -X POST http://localhost:${port}/webhook \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -H "webhook-id: test-123" \\`);
console.log(`  -H "webhook-timestamp: $(date +%s)" \\`);
console.log(
  `  -H "webhook-signature: $(echo -n '${standardPayload}' | openssl dgst -sha256 -hmac "${secret}" | cut -d' ' -f2)" \\`
);
console.log(`  -H "webhook-scheme: v1" \\`);
console.log(`  -H "webhook-version: 1.0" \\`);
console.log(`  -d '${standardPayload}'`);
