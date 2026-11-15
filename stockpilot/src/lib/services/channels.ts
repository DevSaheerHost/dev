import "server-only";
import { serverEnv } from "@/lib/env";

export type SendResult = { sent: true; id?: string } | { sent: false; reason: string };

/** Transactional email via Resend's HTTP API. */
export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { sent: false, reason: "Email isn't configured (RESEND_API_KEY / EMAIL_FROM)." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { sent: false, reason: `Email provider returned ${res.status}.` };
    const body = (await res.json()) as { id?: string };
    return { sent: true, id: body.id };
  } catch {
    return { sent: false, reason: "Couldn't reach the email provider." };
  }
}

/**
 * WhatsApp Business Cloud API text message. Note: Meta only delivers free-form
 * text inside an open 24-hour conversation; outside it, an approved template is
 * required. Callers fall back to a wa.me link the user sends themselves.
 */
export async function sendWhatsApp(to: string, text: string): Promise<SendResult> {
  const env = serverEnv();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return { sent: false, reason: "WhatsApp API isn't configured." };
  const digits = to.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return { sent: false, reason: "Invalid WhatsApp number." };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: digits, type: "text", text: { preview_url: false, body: text.slice(0, 4096) } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { sent: false, reason: `WhatsApp API returned ${res.status}. Business-initiated messages may need an approved template.` };
    const body = (await res.json()) as { messages?: { id: string }[] };
    return { sent: true, id: body.messages?.[0]?.id };
  } catch {
    return { sent: false, reason: "Couldn't reach the WhatsApp API." };
  }
}
