export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, any>;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface RetryPolicy {
  maxAttempts: number;
  delay: number | string;
  backoff?: "linear" | "exponential";
}

export interface WebhookConfig {
  secret: string;
  onEvent: Record<string, (event: WebhookEvent) => Promise<void>>;
  retryPolicy?: RetryPolicy;
  retryOptions?: {
    maxSyncAttempts?: number;
    queue?: any;
    taskId?: string;
  };
  idempotencyKey?: string;
  signatureVerification?: (req: Request, secret: string) => Promise<boolean>;
}

export interface WebhookResponse {
  success: boolean;
  message: string;
  eventId?: string;
  error?: string;
}

export interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
  metadata?: {
    signatureHeader?: string;
    algorithm?: string;
    error?: boolean;
  };
}

// Standard Webhooks Headers
export interface StandardWebhookHeaders {
  "webhook-id": string;
  "webhook-timestamp": string;
  "webhook-signature": string;
  "webhook-scheme"?: string;
  "webhook-version"?: string;
}

// Standard Webhooks Event Structure
export interface StandardWebhookEvent {
  id: string;
  type: string;
  data: Record<string, any>;
  timestamp: number;
  metadata?: {
    webhook_id?: string;
    webhook_timestamp?: string;
    webhook_signature?: string;
    webhook_scheme?: string;
    webhook_version?: string;
    [key: string]: any;
  };
}

// Error handling types
export interface WebhookError extends Error {
  code: string;
  statusCode: number;
  metadata?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  data: any | null;
  errors: Array<{
    path: string;
    message: string;
    code: string;
  }>;
}

export interface WebhookPayload {
  type: string;
  data: unknown;
  id?: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

// Enhanced middleware system types
export interface WebhookMiddleware {
  readonly name: string;
  readonly execute: (
    context: WebhookContext,
    next: () => Promise<void>
  ) => Promise<void>;
}

export interface WebhookContext {
  readonly request: Request;
  readonly config: WebhookConfig;
  event?: WebhookEvent; // Populated during processing
  metadata: Record<string, any>;
}

// Enhanced retry system types
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly backoffStrategy: "linear" | "exponential" | "custom";
  readonly baseDelay: number;
  readonly maxDelay?: number;
  readonly jitter?: boolean;
  readonly retryCondition?: (error: Error) => boolean;
  readonly onRetry?: (attempt: number, error: Error) => Promise<void>;
  readonly customBackoff?: (attempt: number, baseDelay: number) => number;
}

// Security configuration types
export interface SecurityConfig {
  readonly allowedIPs?: readonly string[];
  readonly allowedUserAgents?: readonly RegExp[];
  readonly maxPayloadSize?: number;
  readonly requireHttps?: boolean;
  readonly timestampTolerance?: number; // seconds
  readonly preventReplay?: boolean;
}

// Validation configuration types
export interface ValidationConfig {
  readonly requireSignature?: boolean;
  readonly requireTimestamp?: boolean;
  readonly maxPayloadSize?: number;
  readonly allowedEventTypes?: readonly string[];
}

// Webhook client types
export interface WebhookClientConfig {
  readonly secret: string;
  readonly baseUrl: string;
  readonly timeout?: number;
  readonly retryConfig?: RetryConfig;
  readonly userAgent?: string;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly status: "pending" | "delivered" | "failed";
  readonly attempts: number;
  readonly createdAt: Date;
  readonly deliveredAt?: Date;
  readonly error?: string;
  readonly response?: {
    readonly status: number;
    readonly headers: Record<string, string>;
    readonly body: string;
  };
}

// Testing utilities types
export interface TestWebhookEvent<T = any> extends WebhookEvent {
  readonly _testMetadata?: {
    readonly createdAt: Date;
    readonly source: "test";
  };
}

// Playground types
export interface PlaygroundConfig {
  readonly port?: number;
  readonly webhookEndpoints?: Record<
    string,
    (req: Request) => Promise<Response>
  >;
  readonly testEvents?: Record<string, () => WebhookEvent>;
  readonly ui?: {
    readonly title?: string;
    readonly theme?: "light" | "dark";
  };
}

// Webhook client response types
export interface WebhookClientResponse {
  success: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
}

// Middleware context and result types
export interface WebhookMiddlewareContext {
  request: Request;
  config: WebhookConfig;
  event?: WebhookEvent;
  validation?: any;
}

export interface WebhookMiddlewareResult {
  success: boolean;
  response?: Response;
  error?: string;
}

// Generic middleware type for backward compatibility
export type GenericWebhookMiddleware = (
  context: WebhookMiddlewareContext,
  next: () => Promise<WebhookMiddlewareResult>
) => Promise<WebhookMiddlewareResult>;
