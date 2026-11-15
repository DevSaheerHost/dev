/**
 * Environment configuration, validated once and typed.
 * Public values may reach the browser; everything in `serverEnv` must not.
 */
import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined,
  });
}

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
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
  cached ??= serverSchema.parse({
    ...process.env,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return cached;
}
