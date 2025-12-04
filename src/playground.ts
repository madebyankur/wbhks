import { WebhookEvent, PlaygroundConfig } from "./types";
import { createTestEvent, testDataGenerators } from "./testing-utilities";

export type { PlaygroundConfig } from "./types";

/**
 * Create a functional webhook playground
 */
export const createPlayground = (config: PlaygroundConfig = {}) => {
  const port = config.port || 3000;
  const endpoints = config.webhookEndpoints || {};
  const testEvents = config.testEvents || {};

  const addWebhookEndpoint = (
    path: string,
    handler: (req: Request) => Promise<Response>
  ) => {
    endpoints[path] = handler;
  };

  const addTestEvent = (name: string, eventFactory: () => WebhookEvent) => {
    testEvents[name] = eventFactory;
  };

  const start = async (): Promise<() => Promise<void>> => {
    // @ts-ignore - Bun is available at runtime
    if (typeof Bun !== "undefined") {
      return startBunServer();
    }

    console.log(`Webhook Playground would run at http://localhost:${port}`);
    console.log("Note: Full playground functionality requires Bun runtime");

    return async () => {
      console.log("Playground stopped");
    };
  };

  const startBunServer = async (): Promise<() => Promise<void>> => {
    // @ts-ignore - Bun is available at runtime
    const server = Bun.serve({
      port,
      async fetch(req: Request) {
        const url = new URL(req.url);

        if (endpoints[url.pathname] && req.method === "POST") {
          return endpoints[url.pathname](req);
        }

        if (url.pathname === "/api/test" && req.method === "GET") {
          return handleTestRequest(url, testEvents);
        }

        if (url.pathname === "/" && req.method === "GET") {
          return new Response(generatePlaygroundHTML(config.ui), {
            headers: { "Content-Type": "text/html" },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    console.log(`Webhook Playground running at http://localhost:${port}`);

    return async () => {
      // @ts-ignore - Bun is available at runtime
      server.stop();
    };
  };

  return {
    addWebhookEndpoint,
    addTestEvent,
    start,
  };
};

const handleTestRequest = async (
  url: URL,
  testEvents: Record<string, () => WebhookEvent>
): Promise<Response> => {
  const eventName = url.searchParams.get("event");
  if (!eventName || !testEvents[eventName]) {
    return new Response(JSON.stringify({ error: "Unknown event type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = testEvents[eventName]();
  return new Response(JSON.stringify(event), {
    headers: { "Content-Type": "application/json" },
  });
};

const generatePlaygroundHTML = (ui?: PlaygroundConfig["ui"]): string => {
  const title = ui?.title || "Webhook Playground";
  const theme = ui?.theme || "light";

  return `
    <!DOCTYPE html>
    <html data-theme="${theme}">
    <head>
      <title>${title}</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        :root {
          --primary: #3b82f6;
          --primary-dark: #2563eb;
          --background: ${theme === "dark" ? "#1f2937" : "#ffffff"};
          --background-secondary: ${theme === "dark" ? "#374151" : "#f9fafb"};
          --text: ${theme === "dark" ? "#f9fafb" : "#111827"};
          --text-secondary: ${theme === "dark" ? "#d1d5db" : "#6b7280"};
          --border: ${theme === "dark" ? "#4b5563" : "#e5e7eb"};
          --success: #10b981;
          --error: #ef4444;
          --warning: #f59e0b;
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: var(--background);
          color: var(--text);
          line-height: 1.6;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        header {
          text-align: center;
          margin-bottom: 3rem;
        }

        h1 {
          font-size: 2.5rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }

        .subtitle {
          color: var(--text-secondary);
          font-size: 1.1rem;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .card {
          background: var(--background-secondary);
          border: 1px solid var(--border);
          border-radius: 0.75rem;
          padding: 1.5rem;
        }

        .card h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-bottom: 1rem;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        label {
          display: block;
          font-weight: 500;
          margin-bottom: 0.5rem;
          color: var(--text);
        }

        input, select, textarea {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--background);
          color: var(--text);
          font-size: 0.875rem;
        }

        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        button {
          background: var(--primary);
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 0.5rem;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        button:hover {
          background: var(--primary-dark);
        }

        button:disabled {
          background: var(--text-secondary);
          cursor: not-allowed;
        }

        .btn-secondary {
          background: var(--background-secondary);
          color: var(--text);
          border: 1px solid var(--border);
        }

        .btn-secondary:hover {
          background: var(--border);
        }

        .response {
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          padding: 1rem;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 0.875rem;
          white-space: pre-wrap;
          max-height: 300px;
          overflow-y: auto;
        }

        .status {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
        }

        .status.success {
          background: rgba(16, 185, 129, 0.1);
          color: var(--success);
        }

        .status.error {
          background: rgba(239, 68, 68, 0.1);
          color: var(--error);
        }

        .status.pending {
          background: rgba(245, 158, 11, 0.1);
          color: var(--warning);
        }

        .endpoint-list {
          list-style: none;
        }

        .endpoint-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .endpoint-path {
          font-family: 'Monaco', 'Menlo', monospace;
          font-weight: 500;
        }

        .endpoint-status {
          font-size: 0.75rem;
          color: var(--text-secondary);
        }

        @media (max-width: 768px) {
          .grid {
            grid-template-columns: 1fr;
          }

          .container {
            padding: 1rem;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>${title}</h1>
          <p class="subtitle">Test and debug your webhooks with ease</p>
        </header>

        <div class="grid">
          <div class="card">
            <h2>Send Test Webhook</h2>
            <form id="webhook-form">
              <div class="form-group">
                <label for="endpoint">Endpoint</label>
                <input type="text" id="endpoint" placeholder="/webhook" required>
              </div>

              <div class="form-group">
                <label for="event-type">Event Type</label>
                <select id="event-type" required>
                  <option value="">Select an event type</option>
                  <option value="user.created">User Created</option>
                  <option value="payment.succeeded">Payment Succeeded</option>
                  <option value="order.completed">Order Completed</option>
                  <option value="custom">Custom Event</option>
                </select>
              </div>

              <div class="form-group">
                <label for="payload">Payload (JSON)</label>
                <textarea id="payload" rows="6" placeholder='{"data": {"id": "123", "email": "test@example.com"}}'></textarea>
              </div>

              <button type="submit">Send Webhook</button>
            </form>
          </div>

          <div class="card">
            <h2>Response</h2>
            <div id="response-container">
              <p class="text-secondary">Send a webhook to see the response here</p>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Available Endpoints</h2>
          <ul class="endpoint-list" id="endpoint-list">
            <li class="endpoint-item">
              <span class="endpoint-path">/webhook</span>
              <span class="endpoint-status">Ready</span>
            </li>
          </ul>
        </div>
      </div>

      <script>
        const form = document.getElementById('webhook-form');
        const responseContainer = document.getElementById('response-container');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          const endpoint = document.getElementById('endpoint').value;
          const eventType = document.getElementById('event-type').value;
          const payloadText = document.getElementById('payload').value;

          try {
            const payload = payloadText ? JSON.parse(payloadText) : {};
            const webhookData = {
              type: eventType,
              data: payload,
              timestamp: Date.now(),
              id: crypto.randomUUID()
            };

            responseContainer.innerHTML = '<p>Sending webhook...</p>';

            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(webhookData)
            });

            const responseData = await response.json();
            const statusClass = response.ok ? 'success' : 'error';

            responseContainer.innerHTML = \`
              <div class="status \${statusClass}">
                \${response.ok ? 'Success' : 'Error'} (\${response.status})
              </div>
              <div class="response">\${JSON.stringify(responseData, null, 2)}</div>
            \`;
          } catch (error) {
            responseContainer.innerHTML = \`
              <div class="status error">Error</div>
              <div class="response">\${error.message}</div>
            \`;
          }
        });

        // Auto-populate payload based on event type
        document.getElementById('event-type').addEventListener('change', (e) => {
          const eventType = e.target.value;
          const payloadTextarea = document.getElementById('payload');

          const samplePayloads = {
            'user.created': {
              data: {
                id: '123',
                email: 'test@example.com',
                name: 'Test User',
                createdAt: new Date().toISOString()
              }
            },
            'payment.succeeded': {
              data: {
                id: 'pay_123',
                amount: 2999,
                currency: 'USD',
                status: 'succeeded',
                createdAt: new Date().toISOString()
              }
            },
            'order.completed': {
              data: {
                id: 'order_123',
                total: 99.99,
                status: 'completed',
                items: [
                  { id: 'item_1', name: 'Test Product', quantity: 1, price: 99.99 }
                ],
                createdAt: new Date().toISOString()
              }
            }
          };

          if (samplePayloads[eventType]) {
            payloadTextarea.value = JSON.stringify(samplePayloads[eventType], null, 2);
          } else {
            payloadTextarea.value = '';
          }
        });
      </script>
    </body>
    </html>
  `;
};

export const createDefaultPlayground = (
  config: Partial<PlaygroundConfig> = {}
) => {
  const playground = createPlayground({
    port: 3000,
    ui: {
      title: "Webhook Playground",
      theme: "light",
    },
    ...config,
  });

  playground.addTestEvent("user.created", () =>
    createTestEvent("user.created", testDataGenerators.user())
  );

  playground.addTestEvent("payment.succeeded", () =>
    createTestEvent("payment.succeeded", testDataGenerators.payment())
  );

  playground.addTestEvent("order.completed", () =>
    createTestEvent("order.completed", testDataGenerators.order())
  );

  playground.addTestEvent("repository.created", () =>
    createTestEvent("repository.created", testDataGenerators.repository())
  );

  return playground;
};
