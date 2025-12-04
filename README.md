# Wbhks

Webhook integration kit for Next.js Edge Runtime. Handles signature verification, event routing, retries, and idempotency. Compliant with the [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).

## Installation

```bash
npm install wbhks
```

## Quick Start

### Next.js App Router

```typescript
// app/api/webhook/route.ts
import { createWebhookEndpoint } from "wbhks";

const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    "user.created": async (event) => {
      console.log("New user:", event.data);
    },
    "payment.succeeded": async (event) => {
      console.log("Payment succeeded:", event.data);
    },
  },
  retryPolicy: {
    maxAttempts: 3,
    delay: "2s",
    backoff: "exponential",
  },
  idempotencyKey: "event_id",
});

export const POST = webhookHandler;
```

### Next.js Pages Router

```typescript
// pages/api/webhook.ts
import { createWebhookEndpoint } from "wbhks";

const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    "user.created": async (event) => {
      console.log("New user:", event.data);
    },
  },
});

export default webhookHandler;
```

## Features

- Signature verification (HMAC SHA256, supports generic and Standard Webhooks format)
- Event routing to type-specific handlers
- Retry logic with configurable backoff strategies
- Idempotency to prevent duplicate processing
- Edge Runtime optimized
- TypeScript support
- Composable middleware system
- Webhook client for sending webhooks
- Testing utilities and playground

## Bundle Size

The library is tree-shakeable with multiple entry points:

- `wbhks` - Full library (~40KB minified, ~12KB gzipped)
- `wbhks/core` - Core functionality only (~9KB minified, ~3KB gzipped)
- `wbhks/middleware` - Middleware system (~9KB minified, ~3KB gzipped)
- `wbhks/client` - Webhook client (~5KB minified, ~2KB gzipped)
- `wbhks/frameworks` - Framework integrations (~13KB minified, ~4KB gzipped)

```typescript
// Full library
import { createWebhookEndpoint } from "wbhks";

// Core only
import { createWebhookEndpoint, verifySignature } from "wbhks/core";

// Middleware only
import {
  createValidationMiddleware,
  composeMiddleware,
} from "wbhks/middleware";

// Client only
import { createFunctionalWebhookClient } from "wbhks/client";

// Framework integrations
import { createNextWebhookEndpoint } from "wbhks/frameworks";
```

## API Reference

### `createWebhookEndpoint(config)`

Creates a webhook handler function compatible with Next.js API routes.

```typescript
interface WebhookConfig {
  secret: string;
  onEvent: Record<string, (event: WebhookEvent) => Promise<void>>;
  retryPolicy?: RetryPolicy;
  retryOptions?: {
    maxSyncAttempts?: number;
    queue?: RetryQueue;
    taskId?: string;
  };
  idempotencyKey?: string;
  signatureVerification?: (req: Request, secret: string) => Promise<boolean>;
}

interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, any>;
  timestamp: number;
  metadata?: Record<string, any>;
}

interface RetryPolicy {
  maxAttempts: number;
  delay: number | string; // ms or "1s", "2m"
  backoff?: "linear" | "exponential";
}
```

## Signature Verification

Supports both generic and Standard Webhooks signature formats.

### Generic Format

```typescript
{
  "Content-Type": "application/json",
  "x-signature": "sha256=abc123..."
}
```

### Standard Webhooks Format

```typescript
{
  "Content-Type": "application/json",
  "webhook-id": "evt_123",
  "webhook-timestamp": "1234567890",
  "webhook-signature": "v1,abc123...",
  "webhook-scheme": "v1",
  "webhook-version": "1.0"
}
```

## Idempotency

Prevent duplicate event processing by configuring an idempotency key:

```typescript
const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    /* ... */
  },
  idempotencyKey: "event_id",
});
```

## Retry Logic

Configure retry behavior for failed event processing:

```typescript
const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    /* ... */
  },
  retryPolicy: {
    maxAttempts: 3,
    delay: "2s",
    backoff: "exponential", // or "linear"
  },
  retryOptions: {
    maxSyncAttempts: 2, // Max attempts before queue fallback
  },
});
```

## Production Setup

### Edge Runtime

Fully compatible with Next.js Edge Runtime. Uses Web Crypto API on Edge, falls back to Node.js crypto when available.

### Environment Variables

```bash
WEBHOOK_SECRET=your-webhook-secret

# Optional: for production idempotency
UPSTASH_REDIS_REST_URL=your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
```

### Production Idempotency

For production, use persistent storage for idempotency:

```typescript
import { setupUpstashIdempotency } from "wbhks";

setupUpstashIdempotency({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    /* ... */
  },
  idempotencyKey: "event_id",
});
```

## Advanced Usage

### Custom Signature Verification

```typescript
const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    /* ... */
  },
  signatureVerification: async (req, secret) => {
    const signature = req.headers.get("x-custom-signature");
    return verifyCustomSignature(req.body, signature, secret);
  },
});
```

### Queue-Based Retries

For long-running retries that exceed Edge Runtime limits:

```typescript
import { VercelKVQueue } from "wbhks";

const queue = new VercelKVQueue(kvInstance);

const webhookHandler = createWebhookEndpoint({
  secret: process.env.WEBHOOK_SECRET!,
  onEvent: {
    /* ... */
  },
  retryOptions: {
    maxSyncAttempts: 2,
    queue,
    taskId: "webhook-retry",
  },
});
```

### Validation

The library uses Zod for runtime validation:

```typescript
import { validateWebhookPayload } from "wbhks";

const validation = validateWebhookPayload(payload);
if (!validation.valid) {
  console.log("Validation errors:", validation.errors);
}
```

### Middleware System

Compose webhook processing logic with middleware:

```typescript
import {
  createWebhookHandlerWithMiddleware,
  createValidationMiddleware,
  createLoggingMiddleware,
  createSecurityMiddleware,
  createRateLimitMiddleware,
  composeMiddleware,
} from "wbhks";

const customMiddleware = {
  name: "custom",
  execute: async (context, next) => {
    console.log("Custom middleware");
    await next();
  },
};

const webhookHandler = createWebhookHandlerWithMiddleware(config, [
  createLoggingMiddleware(console.log),
  createSecurityMiddleware({
    allowedIPs: ["192.168.1.0/24"],
    requireHttps: true,
    maxPayloadSize: 1024 * 1024,
  }),
  createRateLimitMiddleware({
    maxRequests: 100,
    windowMs: 60000,
  }),
  createValidationMiddleware({
    requireSignature: true,
    requireTimestamp: true,
    allowedEventTypes: ["user.created", "payment.succeeded"],
  }),
  customMiddleware,
]);
```

### Retry System

```typescript
import {
  createRetryHandler,
  createExponentialRetry,
  createLinearRetry,
  retryOnNetworkError,
  commonRetryConfigs,
} from "wbhks";

const retryHandler = createRetryHandler({
  maxAttempts: 5,
  backoffStrategy: "exponential",
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
  retryCondition: retryOnNetworkError,
  onRetry: async (attempt, error) => {
    console.log(`Retry attempt ${attempt}: ${error.message}`);
  },
});

const webhookRetry = commonRetryConfigs.webhookDelivery;
const databaseRetry = commonRetryConfigs.database;

await retryHandler(async () => {
  await processWebhook(event);
});
```

### Webhook Client

Send webhooks with delivery tracking:

```typescript
import { createFunctionalWebhookClient, sendWebhookFunctional } from "wbhks";

const client = createFunctionalWebhookClient({
  secret: "your-webhook-secret",
  baseUrl: "https://api.example.com",
  timeout: 10000,
  retryConfig: {
    maxAttempts: 3,
    backoffStrategy: "exponential",
    baseDelay: 1000,
    jitter: true,
  },
});

// Send a single webhook
const delivery = await client.send("/webhook", {
  type: "user.created",
  data: { id: "123", email: "user@example.com" },
});

// Send to multiple endpoints
const deliveries = await client.sendBatch(
  ["/webhook1", "/webhook2", "/webhook3"],
  { type: "payment.succeeded", data: { amount: 100 } }
);

// Convenience function
const result = await sendWebhookFunctional(
  "/webhook",
  { type: "order.completed", data: { orderId: "123" } },
  { secret: "secret", baseUrl: "https://api.example.com" }
);
```

### Testing Utilities

```typescript
import {
  createTestEvent,
  createTestRequest,
  simulateWebhook,
  createWebhookTestSuite,
  createStripeTestEvent,
  testDataGenerators,
} from "wbhks";

const userEvent = createTestEvent("user.created", testDataGenerators.user());
const paymentEvent = createStripeTestEvent("payment.succeeded", {
  id: "pay_123",
  amount: 2999,
});

const request = await createTestRequest(userEvent, "your-secret");
const result = await simulateWebhook(webhookHandler, userEvent, "your-secret");

const testSuite = createWebhookTestSuite(webhookHandler, "your-secret");
await testSuite.test("user.created", testDataGenerators.user(), 200);
await testSuite.testError("invalid.event", { invalid: true }, 400);
```

### Playground

Local testing environment:

```typescript
import { createDefaultPlayground, createPlayground } from "wbhks";

const playground = createDefaultPlayground({
  port: 3000,
  ui: { title: "My Webhook Playground", theme: "dark" },
});

playground.addWebhookEndpoint("/custom-webhook", async (req) => {
  const body = await req.json();
  console.log("Received webhook:", body);
  return new Response(JSON.stringify({ success: true }));
});

playground.addTestEvent("custom.event", () => ({
  type: "custom.event",
  data: { custom: "data" },
  id: "test-123",
  timestamp: Date.now(),
}));

const stopPlayground = await playground.start();
// Runs at http://localhost:3000
await stopPlayground();
```

Run the playground:

```bash
npm run playground
```

## Framework Integration

### Next.js

**App Router**

```typescript
import { createNextWebhookEndpoint } from "wbhks";

const webhook = createNextWebhookEndpoint({
  secret: "your-webhook-secret",
  onEvent: {
    "user.created": async (event) => {
      console.log("User created:", event.data);
    },
  },
});

export { webhook as POST };
```

**Pages Router**

```typescript
import { createNextWebhookEndpoint } from "wbhks";

const webhook = createNextWebhookEndpoint({
  secret: "your-webhook-secret",
  onEvent: {
    "user.created": async (event) => {
      console.log("User created:", event.data);
    },
  },
});

export default webhook.pagesHandler;
```

**Edge Runtime**

```typescript
import { createNextWebhookEndpoint } from "wbhks";

const webhook = createNextWebhookEndpoint({
  secret: "your-webhook-secret",
  onEvent: {
    "user.created": async (event) => {
      console.log("User created:", event.data);
    },
  },
});

export const config = {
  runtime: "edge",
};

export default webhook.edge;
```

### Express.js

```typescript
import express from "express";
import {
  createExpressWebhookHandler,
  createExpressWebhookMiddleware,
} from "wbhks";

const app = express();

// As a route handler
app.post(
  "/webhook",
  createExpressWebhookHandler({
    secret: "your-webhook-secret",
    onEvent: {
      "user.created": async (event) => {
        console.log("User created:", event.data);
      },
    },
  })
);

// As middleware
app.use(
  "/webhook",
  createExpressWebhookMiddleware({
    secret: "your-webhook-secret",
    onEvent: {
      "user.created": async (event) => {
        console.log("User created:", event.data);
      },
    },
  })
);
```

### Hono

```typescript
import { Hono } from "hono";
import { createHonoWebhookHandler } from "wbhks";

const app = new Hono();

app.post(
  "/webhook",
  createHonoWebhookHandler({
    secret: "your-webhook-secret",
    onEvent: {
      "user.created": async (event) => {
        console.log("User created:", event.data);
      },
    },
  })
);
```

### SvelteKit

```typescript
// src/routes/api/webhook/+server.ts
import { createSvelteKitWebhookHandler } from "wbhks";

const webhookHandler = createSvelteKitWebhookHandler({
  secret: "your-webhook-secret",
  onEvent: {
    "user.created": async (event) => {
      console.log("User created:", event.data);
    },
  },
});

export const POST = webhookHandler;
```

### Remix

```typescript
// app/routes/api.webhook.tsx
import { createRemixWebhookAction } from "wbhks";

const webhookAction = createRemixWebhookAction({
  secret: "your-webhook-secret",
  onEvent: {
    "user.created": async (event) => {
      console.log("User created:", event.data);
    },
  },
});

export const action = webhookAction;
```

### Auto-Detection

Automatically detects your framework:

```typescript
import { createAutoWebhookHandler } from "wbhks";

const webhookHandler = createAutoWebhookHandler({
  secret: "your-webhook-secret",
  onEvent: {
    "user.created": async (event) => {
      console.log("User created:", event.data);
    },
  },
});
```

## Testing

Run the test suite:

```bash
bun test
```

Test specific event types locally:

```bash
# Test user.created event (generic format)
curl -X GET http://localhost:3000/test?type=user.created

# Test with Standard Webhooks format
curl -X GET http://localhost:3000/test?type=user.created&standard=true
```

## Examples

See the `examples/` directory:

- `examples/nextjs-app-router/` - Next.js 13+ App Router
- `examples/nextjs-pages-router/` - Next.js Pages Router
- `examples/production-setup/` - Production configuration

## Dependencies

- **Zod** - Runtime validation
- **UUID** - Unique identifiers for events and deliveries

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT

## Support

- [Documentation](https://github.com/madebyankur/wbhks#readme)
- [Report Issues](https://github.com/madebyankur/wbhks/issues)
- [Discussions](https://github.com/madebyankur/wbhks/discussions)
