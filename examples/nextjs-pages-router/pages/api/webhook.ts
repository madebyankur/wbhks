import { NextApiRequest, NextApiResponse } from "next";
import { createWebhookEndpoint } from "wbhks";

// CRITICAL: Disable bodyParser for webhook endpoints in Pages Router
// This allows access to the raw request body needed for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

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

// Next.js API handler
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read raw body for signature verification
    // This is required because bodyParser is disabled
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // Convert Next.js request to standard Request object
    const request = new Request(`http://localhost:3000${req.url}`, {
      method: req.method,
      headers: req.headers as any,
      body: rawBody,
    });

    const response = await webhookHandler(request);
    const responseData = await response.json();

    return res.status(response.status).json(responseData);
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
