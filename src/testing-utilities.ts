import { v4 as uuidv4 } from "uuid";
import { WebhookEvent, TestWebhookEvent } from "./types";
import { generateSignature } from "./verify-signature";

export type { TestWebhookEvent } from "./types";

/**
 * Create a test webhook event with metadata
 */
export const createTestEvent = <T = any>(
  type: string,
  data: T,
  overrides?: Partial<WebhookEvent>
): TestWebhookEvent<T> => ({
  id: uuidv4(),
  type,
  data: data as any,
  timestamp: Date.now(),
  metadata: {},
  ...overrides,
  _testMetadata: {
    createdAt: new Date(),
    source: "test",
  },
});

/**
 * Create a test request with proper headers
 */
export const createTestRequest = async (
  event: WebhookEvent,
  secret: string,
  options?: {
    headers?: Record<string, string>;
    url?: string;
  }
): Promise<Request> => {
  const body = JSON.stringify(event);
  const signature = await generateSignature(body, secret);
  const webhookId = uuidv4();

  return new Request(options?.url || "http://localhost:3000/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": Math.floor(Date.now() / 1000).toString(),
      "webhook-signature": signature,
      "webhook-scheme": "v1",
      "webhook-version": "1.0",
      ...options?.headers,
    },
    body,
  });
};

/**
 * Simulate a webhook request and return detailed results
 */
export const simulateWebhook = async (
  handler: (req: Request) => Promise<Response>,
  event: WebhookEvent,
  secret: string
): Promise<{
  response: Response;
  duration: number;
  success: boolean;
  data: any;
}> => {
  const request = await createTestRequest(event, secret);
  const start = Date.now();

  const response = await handler(request);
  const duration = Date.now() - start;
  const data = await response.json();

  return {
    response,
    duration,
    success: response.ok,
    data,
  };
};

/**
 * Create a test suite for webhook handlers
 */
export const createWebhookTestSuite = (
  handler: (req: Request) => Promise<Response>,
  secret: string
) => {
  const test = async (
    eventType: string,
    data: any,
    expectedStatus: number = 200
  ) => {
    const event = createTestEvent(eventType, data);
    const result = await simulateWebhook(handler, event, secret);

    if (result.response.status !== expectedStatus) {
      throw new Error(
        `Expected status ${expectedStatus}, got ${
          result.response.status
        }. Response: ${JSON.stringify(result.data)}`
      );
    }

    return result;
  };

  const testError = async (
    eventType: string,
    data: any,
    expectedStatus: number = 400
  ) => {
    return test(eventType, data, expectedStatus);
  };

  return {
    test,
    testError,
    createEvent: createTestEvent,
    createRequest: async (
      event: WebhookEvent,
      options?: { headers?: Record<string, string>; url?: string }
    ) => await createTestRequest(event, secret, options),
  };
};

export const createStripeTestEvent = (
  eventType: string,
  data: any
): TestWebhookEvent => createTestEvent(eventType, { object: data });

export const createGitHubTestEvent = (
  action: string,
  repository: any
): TestWebhookEvent => createTestEvent(`repository.${action}`, { repository });

export const createShopifyTestEvent = (
  topic: string,
  data: any
): TestWebhookEvent => createTestEvent(topic, data);

export const createVercelTestEvent = (
  eventType: string,
  data: any
): TestWebhookEvent => createTestEvent(eventType, data);

export const createSupabaseTestEvent = (
  eventType: string,
  data: any
): TestWebhookEvent => createTestEvent(eventType, data);

export const createMockWebhookServer = (port: number = 3001) => {
  const receivedWebhooks: Array<{
    timestamp: Date;
    headers: Record<string, string>;
    body: any;
    url: string;
  }> = [];

  const server = {
    receivedWebhooks,

    async start(): Promise<() => void> {
      console.log(`Mock webhook server started on port ${port}`);
      return () => console.log("Mock webhook server stopped");
    },

    getReceivedWebhooks() {
      return receivedWebhooks;
    },

    clearReceivedWebhooks() {
      receivedWebhooks.length = 0;
    },

    simulateWebhookReceived(
      headers: Record<string, string>,
      body: any,
      url: string
    ) {
      receivedWebhooks.push({
        timestamp: new Date(),
        headers,
        body,
        url,
      });
    },
  };

  return server;
};

export const testDataGenerators = {
  user: () => ({
    id: uuidv4(),
    email: `test-${Date.now()}@example.com`,
    name: "Test User",
    createdAt: new Date().toISOString(),
  }),

  payment: () => ({
    id: uuidv4(),
    amount: Math.floor(Math.random() * 10000) + 100,
    currency: "USD",
    status: "succeeded",
    createdAt: new Date().toISOString(),
  }),

  order: () => ({
    id: uuidv4(),
    total: Math.floor(Math.random() * 1000) + 50,
    status: "completed",
    items: [{ id: uuidv4(), name: "Test Product", quantity: 1, price: 25.99 }],
    createdAt: new Date().toISOString(),
  }),

  repository: () => ({
    id: Math.floor(Math.random() * 1000000),
    name: `test-repo-${Date.now()}`,
    full_name: `testuser/test-repo-${Date.now()}`,
    private: false,
    created_at: new Date().toISOString(),
  }),
};
