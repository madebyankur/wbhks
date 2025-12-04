import { createWebhookEndpoint } from "wbhks";

// Event handlers
const onEvent = {
  "user.created": async (event: any) => {
    console.log("🎉 New user created:", event.data);
    // Add your user creation logic here
    // e.g., send welcome email, create user profile, etc.
  },

  "payment.succeeded": async (event: any) => {
    console.log("💳 Payment succeeded:", event.data);
    // Add your payment success logic here
    // e.g., update order status, send confirmation email, etc.
  },

  "payment.failed": async (event: any) => {
    console.log("❌ Payment failed:", event.data);
    // Add your payment failure logic here
    // e.g., send failure notification, retry payment, etc.
  },

  "order.completed": async (event: any) => {
    console.log("🛒 Order completed:", event.data);
    // Add your order completion logic here
    // e.g., trigger fulfillment, send tracking info, etc.
  },
};

// Create webhook handler
const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent,
  retryPolicy: {
    maxAttempts: 3,
    delay: "2s",
    backoff: "exponential",
  },
  idempotencyKey: "event_id",
});

// Export the handler for Next.js App Router
export const POST = webhookHandler;
