import { createWebhookEndpoint } from "wbhks";

// Event handlers for different webhook events
const onEvent = {
  "user.created": async (event: any) => {
    console.log("🎉 New user created:", event.data);
    // Add your user creation logic here
    // e.g., send welcome email, create user profile, etc.
    await sendWelcomeEmail(event.data.email);
    await createUserProfile(event.data.userId);
  },

  "payment.succeeded": async (event: any) => {
    console.log("💳 Payment succeeded:", event.data);
    // Add your payment success logic here
    // e.g., update order status, send confirmation email, etc.
    await updateOrderStatus(event.data.orderId, "paid");
    await sendPaymentConfirmation(event.data.email);
  },

  "payment.failed": async (event: any) => {
    console.log("❌ Payment failed:", event.data);
    // Add your payment failure logic here
    // e.g., send failure notification, retry payment, etc.
    await sendPaymentFailureNotification(event.data.email);
    await updateOrderStatus(event.data.orderId, "payment_failed");
  },

  "order.completed": async (event: any) => {
    console.log("🛒 Order completed:", event.data);
    // Add your order completion logic here
    // e.g., trigger fulfillment, send tracking info, etc.
    await triggerFulfillment(event.data.orderId);
    await sendTrackingInfo(event.data.email, event.data.orderId);
  },
};

// Mock functions for demonstration
async function sendWelcomeEmail(email: string) {
  console.log(`📧 Sending welcome email to ${email}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function createUserProfile(userId: string) {
  console.log(`👤 Creating user profile for ${userId}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function updateOrderStatus(orderId: string, status: string) {
  console.log(`📦 Updating order ${orderId} status to ${status}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function sendPaymentConfirmation(email: string) {
  console.log(`✅ Sending payment confirmation to ${email}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function sendPaymentFailureNotification(email: string) {
  console.log(`❌ Sending payment failure notification to ${email}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function triggerFulfillment(orderId: string) {
  console.log(`🚚 Triggering fulfillment for order ${orderId}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
}

async function sendTrackingInfo(email: string, orderId: string) {
  console.log(`📮 Sending tracking info to ${email} for order ${orderId}`);
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// Create webhook handler with configuration
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
