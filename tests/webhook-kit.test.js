"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bun_test_1 = require("bun:test");
const src_1 = require("../src");
const idempotency_1 = require("../src/idempotency");
(0, bun_test_1.describe)("Wbhks", () => {
    const secret = "test-secret";
    (0, bun_test_1.beforeEach)(async () => {
        await (0, idempotency_1.clearProcessedEvents)();
    });
    (0, bun_test_1.afterEach)(async () => {
        await (0, idempotency_1.clearProcessedEvents)();
    });
    (0, bun_test_1.describe)("createWebhookEndpoint", () => {
        (0, bun_test_1.it)("should process valid webhook events", async () => {
            const processedEvents = [];
            const webhookHandler = (0, src_1.createWebhookEndpoint)({
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
            const signature = await (0, src_1.generateSignature)(body, secret);
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
            (0, bun_test_1.expect)(response.status).toBe(200);
            (0, bun_test_1.expect)(result.success).toBe(true);
            (0, bun_test_1.expect)(processedEvents).toHaveLength(1);
            (0, bun_test_1.expect)(processedEvents[0].data).toEqual(eventData.data);
        });
        (0, bun_test_1.it)("should reject invalid signatures", async () => {
            const webhookHandler = (0, src_1.createWebhookEndpoint)({
                secret,
                onEvent: {
                    "user.created": async () => { },
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
            (0, bun_test_1.expect)(response.status).toBe(401);
            (0, bun_test_1.expect)(result.success).toBe(false);
            (0, bun_test_1.expect)(result.message).toBe("Invalid signature");
        });
        (0, bun_test_1.it)("should handle idempotency", async () => {
            let processCount = 0;
            const webhookHandler = (0, src_1.createWebhookEndpoint)({
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
            const signature = await (0, src_1.generateSignature)(body, secret);
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
            (0, bun_test_1.expect)(response1.status).toBe(200);
            (0, bun_test_1.expect)(result1.success).toBe(true);
            (0, bun_test_1.expect)(processCount).toBe(1);
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
            (0, bun_test_1.expect)(response2.status).toBe(200);
            (0, bun_test_1.expect)(result2.success).toBe(true);
            (0, bun_test_1.expect)(result2.message).toBe("Event already processed");
            (0, bun_test_1.expect)(processCount).toBe(1); // Should not process again
        });
        (0, bun_test_1.it)("should reject unsupported event types", async () => {
            const webhookHandler = (0, src_1.createWebhookEndpoint)({
                secret,
                onEvent: {
                    "user.created": async () => { },
                },
            });
            const eventData = {
                type: "unsupported.event",
                data: { userId: "123" },
            };
            const body = JSON.stringify(eventData);
            const signature = await (0, src_1.generateSignature)(body, secret);
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
            (0, bun_test_1.expect)(response.status).toBe(400);
            (0, bun_test_1.expect)(result.success).toBe(false);
            (0, bun_test_1.expect)(result.message).toBe("Event type 'unsupported.event' not supported");
        });
        (0, bun_test_1.it)("should reject non-POST requests", async () => {
            const webhookHandler = (0, src_1.createWebhookEndpoint)({
                secret,
                onEvent: {
                    "user.created": async () => { },
                },
            });
            const request = new Request("http://localhost/webhook", {
                method: "GET",
            });
            const response = await webhookHandler(request);
            (0, bun_test_1.expect)(response.status).toBe(405);
        });
    });
    (0, bun_test_1.describe)("Retry Policy", () => {
        (0, bun_test_1.it)("should retry failed operations", async () => {
            let attemptCount = 0;
            const webhookHandler = (0, src_1.createWebhookEndpoint)({
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
            const signature = await (0, src_1.generateSignature)(body, secret);
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
            (0, bun_test_1.expect)(response.status).toBe(200);
            (0, bun_test_1.expect)(result.success).toBe(true);
            (0, bun_test_1.expect)(attemptCount).toBe(3);
        });
    });
    (0, bun_test_1.describe)("Signature Generation", () => {
        (0, bun_test_1.it)("should generate valid signatures", async () => {
            const body = '{"type":"test","data":{"id":"123"}}';
            const signature = await (0, src_1.generateSignature)(body, secret);
            (0, bun_test_1.expect)(signature).toBeDefined();
            (0, bun_test_1.expect)(typeof signature).toBe("string");
            (0, bun_test_1.expect)(signature.length).toBeGreaterThan(0);
        });
        (0, bun_test_1.it)("should generate consistent signatures for same input", async () => {
            const body = '{"type":"test","data":{"id":"123"}}';
            const signature1 = await (0, src_1.generateSignature)(body, secret);
            const signature2 = await (0, src_1.generateSignature)(body, secret);
            (0, bun_test_1.expect)(signature1).toBe(signature2);
        });
    });
});
//# sourceMappingURL=webhook-kit.test.js.map