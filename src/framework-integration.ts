import { createWebhookEndpoint } from "./wbhks";
import { type WebhookConfig } from "./types";

interface NextApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  on: (event: string, callback: (data?: any) => void) => void;
}

interface NextApiResponse {
  status: (code: number) => NextApiResponse;
  json: (data: any) => void;
}

interface ExpressRequest {
  method: string;
  protocol: string;
  get: (header: string) => string | undefined;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

interface ExpressResponse {
  status: (code: number) => ExpressResponse;
  json: (data: any) => void;
}

interface HonoContext {
  req: {
    raw: Request;
  };
  json: (data: any, status?: number) => Response;
}

/**
 * Next.js specific webhook utilities
 */
export const createNextWebhookEndpoint = (config: WebhookConfig) => {
  const handler = createWebhookEndpoint(config);

  return {
    POST: handler,

    pagesHandler: async (req: NextApiRequest, res: NextApiResponse) => {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      try {
        const rawBody = await getRawBody(req);
        const request = new Request(`${getBaseUrl(req)}${req.url}`, {
          method: req.method,
          headers: req.headers as any,
          body: rawBody,
        });

        const response = await handler(request);
        const data = await response.json();
        return res.status(response.status).json(data);
      } catch (error) {
        console.error("Next.js webhook handler error:", error);
        return res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    edge: createEdgeOptimizedHandler(handler),
  };
};

/**
 * Express.js webhook utilities
 */
export const createExpressWebhookHandler = (config: WebhookConfig) => {
  const handler = createWebhookEndpoint(config);

  return async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const request = new Request(
        `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        {
          method: req.method,
          headers: req.headers as any,
          body: req.body ? JSON.stringify(req.body) : undefined,
        }
      );

      const response = await handler(request);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      console.error("Express webhook handler error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
};

/**
 * Express.js middleware for webhook endpoints
 */
export const createExpressWebhookMiddleware = (config: WebhookConfig) => {
  const handler = createExpressWebhookHandler(config);

  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    if (req.method === "POST") {
      return handler(req, res);
    }
    next();
  };
};

/**
 * Hono webhook utilities
 */
export const createHonoWebhookHandler = (config: WebhookConfig) => {
  const handler = createWebhookEndpoint(config);

  return async (c: HonoContext) => {
    try {
      const response = await handler(c.req.raw);
      const data = await response.json();
      return c.json(data, response.status);
    } catch (error) {
      console.error("Hono webhook handler error:", error);
      return c.json(
        {
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  };
};

/**
 * Fastify webhook utilities
 */
export const createFastifyWebhookHandler = (config: WebhookConfig) => {
  const handler = createWebhookEndpoint(config);

  return async (request: any, reply: any) => {
    try {
      const req = new Request(
        `${request.protocol}://${request.headers.host}${request.url}`,
        {
          method: request.method,
          headers: request.headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
        }
      );

      const response = await handler(req);
      const data = await response.json();
      reply.status(response.status).send(data);
    } catch (error) {
      console.error("Fastify webhook handler error:", error);
      reply.status(500).send({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
};

/**
 * SvelteKit webhook utilities
 */
export const createSvelteKitWebhookHandler = (config: WebhookConfig) => {
  const handler = createWebhookEndpoint(config);

  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error("SvelteKit webhook handler error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };
};

/**
 * Remix webhook utilities
 */
export const createRemixWebhookAction = (config: WebhookConfig) => {
  const handler = createWebhookEndpoint(config);

  return async ({ request }: { request: Request }) => {
    try {
      return await handler(request);
    } catch (error) {
      console.error("Remix webhook action error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };
};

/**
 * Edge Runtime optimized handler
 */
const createEdgeOptimizedHandler =
  (handler: (req: Request) => Promise<Response>) =>
  async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (error) {
      console.error("Edge webhook handler error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  };

/**
 * Helper functions
 */
const getRawBody = async (req: NextApiRequest): Promise<string> => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
};

const getBaseUrl = (req: NextApiRequest): string => {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host;
  return `${protocol}://${host}`;
};

/**
 * Framework-specific configuration helpers
 */
export const createNextWebhookConfig = (config: WebhookConfig) => ({
  ...config,
  // Next.js specific optimizations
  retryPolicy: config.retryPolicy || {
    maxAttempts: 2, // Reduced for Edge Runtime
    delay: 1000,
    backoff: "exponential" as const,
  },
});

export const createExpressWebhookConfig = (config: WebhookConfig) => ({
  ...config,
  retryPolicy: config.retryPolicy || {
    maxAttempts: 3,
    delay: 2000,
    backoff: "exponential" as const,
  },
});

export const createEdgeWebhookConfig = (config: WebhookConfig) => ({
  ...config,
  retryPolicy: config.retryPolicy || {
    maxAttempts: 1, // No retries in Edge Runtime
    delay: 0,
    backoff: "linear" as const,
  },
});

/**
 * Framework detection utilities
 */
export const detectFramework = ():
  | "nextjs"
  | "express"
  | "hono"
  | "fastify"
  | "sveltekit"
  | "remix"
  | "unknown" => {
  if (typeof process !== "undefined") {
    if (typeof (global as any).NextRequest !== "undefined") return "nextjs";
    if (typeof (global as any).express !== "undefined") return "express";
    if (typeof (global as any).hono !== "undefined") return "hono";
    if (typeof (global as any).fastify !== "undefined") return "fastify";
    if (typeof (global as any).sveltekit !== "undefined") return "sveltekit";
    if (typeof (global as any).remix !== "undefined") return "remix";
  }
  return "unknown";
};

/**
 * Auto-configure webhook handler based on detected framework
 */
export const createAutoWebhookHandler = (config: WebhookConfig) => {
  const framework = detectFramework();

  switch (framework) {
    case "nextjs":
      return createNextWebhookEndpoint(createNextWebhookConfig(config));
    case "express":
      return createExpressWebhookHandler(createExpressWebhookConfig(config));
    case "hono":
      return createHonoWebhookHandler(config);
    case "fastify":
      return createFastifyWebhookHandler(config);
    case "sveltekit":
      return createSvelteKitWebhookHandler(createEdgeWebhookConfig(config));
    case "remix":
      return createRemixWebhookAction(createEdgeWebhookConfig(config));
    default:
      return createWebhookEndpoint(config);
  }
};

export type {
  NextApiRequest,
  NextApiResponse,
  ExpressRequest,
  ExpressResponse,
  HonoContext,
};
