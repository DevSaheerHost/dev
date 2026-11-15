/**
 * Environment configuration, validated once and typed.
 * Public values may reach the browser; everything in `serverEnv` must not.
 */
import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(10),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(3),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(3),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || undefined,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
  });
}

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const serverSchema = z.object({
  AI_PROVIDER: z.enum(["gemini", "local"]).default("local"),
  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  INTEGRATION_ENCRYPTION_KEY: optional,
  CRON_SECRET: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: optional,
  SQUARE_APPLICATION_ID: optional,
  SQUARE_APPLICATION_SECRET: optional,
  SQUARE_WEBHOOK_SIGNATURE_KEY: optional,
  SQUARE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  SHOPIFY_API_KEY: optional,
  SHOPIFY_API_SECRET: optional,
  CLOVER_APP_ID: optional,
  CLOVER_APP_SECRET: optional,
  CLOVER_WEBHOOK_AUTH_CODE: optional,
  CLOVER_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
});

export type ServerEnv = z.infer<typeof serverSchema>;
let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") throw new Error("serverEnv() must not be called in the browser.");
  cached ??= serverSchema.parse(process.env);
  return cached;
}
