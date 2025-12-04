/**
 * Get crypto implementation based on runtime environment
 * Edge Runtime: uses globalThis.crypto.subtle
 * Node.js: uses crypto module
 */
const getCrypto = () => {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    globalThis.crypto.subtle
  ) {
    return globalThis.crypto;
  }

  try {
    // @ts-ignore - Dynamic require for Node.js compatibility
    const crypto = require("crypto");
    return crypto;
  } catch (error) {
    throw new Error(
      "Crypto API not available. Ensure you are running in a compatible environment (Edge Runtime or Node.js)."
    );
  }
};

/**
 * Create HMAC signature using Web Crypto API or Node.js crypto
 */
const createHmacSignature = async (
  message: string,
  secret: string
): Promise<string> => {
  const crypto = getCrypto();

  if (crypto.subtle) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const hmac = crypto.createHmac("sha256", secret);
  return hmac.update(message).digest("hex");
};

/**
 * Timing-safe comparison using Web Crypto API or Node.js crypto
 */
const timingSafeEqual = async (a: string, b: string): Promise<boolean> => {
  if (a.length !== b.length) {
    return false;
  }

  const crypto = getCrypto();

  if (crypto.subtle) {
    const encoder = new TextEncoder();
    const aBuffer = encoder.encode(a);
    const bBuffer = encoder.encode(b);

    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < aBuffer.length; i++) {
      result |= aBuffer[i] ^ bBuffer[i];
    }
    return result === 0;
  }

  try {
    // @ts-ignore - Dynamic require for Node.js compatibility
    const { Buffer } = require("buffer");
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch (error) {
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
};

import { SignatureVerificationResult } from "./types";

export const verifySignature = async (
  req: Request,
  secret: string
): Promise<SignatureVerificationResult> => {
  try {
    const clonedReq = req.clone();
    const body = await clonedReq.text();

    const webhookSignature = req.headers.get("webhook-signature");
    const webhookScheme = req.headers.get("webhook-scheme") || "v1";

    const genericSignature =
      req.headers.get("x-signature") || req.headers.get("x-hub-signature-256");

    if (!webhookSignature && !genericSignature) {
      return {
        valid: false,
        error: "No signature provided",
        metadata: {
          signatureHeader: "missing",
          algorithm: "sha256",
        },
      };
    }

    const signature = webhookSignature || genericSignature;
    const scheme = webhookSignature ? webhookScheme : "generic";

    const expectedSignature = signature!.startsWith("sha256=")
      ? signature!.substring(7)
      : signature!;

    const generatedSignature = await createHmacSignature(body, secret);

    const isValid = await timingSafeEqual(
      expectedSignature,
      generatedSignature
    );

    return {
      valid: isValid,
      error: isValid ? undefined : "Invalid signature",
      metadata: {
        signatureHeader: signature ? "present" : "missing",
        algorithm: "sha256",
      },
    };
  } catch (error) {
    return {
      valid: false,
      error:
        error instanceof Error
          ? error.message
          : "Signature verification failed",
      metadata: { error: true },
    };
  }
};

export const generateSignature = async (
  body: string,
  secret: string
): Promise<string> => {
  return await createHmacSignature(body, secret);
};

export const generateStandardWebhookHeaders = async (
  webhookId: string,
  body: string,
  secret: string,
  scheme: string = "v1",
  version: string = "1.0"
) => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature(body, secret);

  return {
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": signature,
    "webhook-scheme": scheme,
    "webhook-version": version,
  };
};
