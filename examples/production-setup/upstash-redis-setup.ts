// Production setup example with Upstash Redis for Edge Runtime
// This configuration works on Vercel Edge Functions and other Edge environments

import { Redis } from '@upstash/redis';
import { 
  createWebhookEndpoint, 
  setupUpstashIdempotency,
  retryHandlerEdgeOptimized,
  retryHandler,
  UpstashQueue
} from 'wbhks';

// Initialize Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Setup production idempotency (call once at startup)
setupUpstashIdempotency(redis);

// Optional: Setup queue for long-running operations
const retryQueue = new UpstashQueue(redis);

// Production webhook handler with Edge Runtime optimizations
const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    'user.created': async (event) => {
      // Use Edge-optimized retry for quick operations
      await retryHandlerEdgeOptimized(
        async () => {
          console.log('🎉 New user created:', event.data);
          
          // Quick operations that complete within Edge CPU limits
          await sendWelcomeEmail(event.data.email);
          await updateUserAnalytics(event.data.userId);
        },
        2, // Max 2 sync attempts
        100 // 100ms delay
      );
    },

    'payment.succeeded': async (event) => {
      // For longer operations, use queue-based retries
      await retryHandler(
        async () => {
          console.log('💳 Payment succeeded:', event.data);
          
          // These operations might take longer
          await processPaymentWebhooks(event.data);
          await updateOrderStatus(event.data.orderId);
          await sendPaymentConfirmation(event.data.email);
        },
        {
          maxAttempts: 5,
          delay: '2s',
          backoff: 'exponential'
        },
        {
          queue: retryQueue,
          taskId: `payment-${event.id}`,
          maxSyncAttempts: 2 // Only 2 sync attempts before queuing
        }
      );
    },

    'order.completed': async (event) => {
      const startTime = Date.now();
      
      try {
        console.log('🛒 Order completed:', event.data);
        
        // Monitor execution time for Edge Runtime
        await processOrderCompletion(event.data);
        
        const duration = Date.now() - startTime;
        if (duration > 8) {
          console.warn(`[wbhks] Order processing took ${duration}ms (approaching Edge limit)`);
        }
        
      } catch (error) {
        console.error('Order completion failed:', error);
        
        // Send to monitoring service
        if (process.env.SENTRY_DSN) {
          // Sentry.captureException(error);
        }
        
        throw error; // Re-throw to trigger retry
      }
    }
  },
  
  // Use default retry policy for most operations
  retryPolicy: {
    maxAttempts: 3,
    delay: '1s',
    backoff: 'exponential',
  },
  
  idempotencyKey: 'id', // Standard Webhooks use 'id' field
});

// Mock functions for demonstration
async function sendWelcomeEmail(email: string) {
  console.log(`📧 Sending welcome email to ${email}`);
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function updateUserAnalytics(userId: string) {
  console.log(`📊 Updating analytics for user ${userId}`);
  await new Promise(resolve => setTimeout(resolve, 30));
}

async function processPaymentWebhooks(paymentData: any) {
  console.log('🔄 Processing payment webhooks');
  // This might involve multiple API calls
  await new Promise(resolve => setTimeout(resolve, 200));
}

async function updateOrderStatus(orderId: string) {
  console.log(`📦 Updating order ${orderId} status`);
  await new Promise(resolve => setTimeout(resolve, 150));
}

async function sendPaymentConfirmation(email: string) {
  console.log(`✅ Sending payment confirmation to ${email}`);
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function processOrderCompletion(orderData: any) {
  console.log('🚚 Processing order completion');
  // Complex order processing logic
  await new Promise(resolve => setTimeout(resolve, 300));
}

export { webhookHandler };

// Environment variables required:
/*
WEBHOOK_SECRET=your-webhook-secret-here
UPSTASH_REDIS_REST_URL=https://your-redis-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token
SENTRY_DSN=your-sentry-dsn (optional)
*/