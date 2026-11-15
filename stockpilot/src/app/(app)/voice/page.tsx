import { VoiceAudit } from "@/components/voice/voice-audit";
import { PageHeader } from "@/components/ui/page";
import { requireContext } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";

export const metadata = { title: "Voice Audit" };

export default async function VoicePage() {
  const ctx = await requireContext();
  const env = serverEnv();
  const serverTranscription = env.AI_PROVIDER === "gemini" && !!env.GEMINI_API_KEY;
  return (
    <>
      <PageHeader title="Voice audit" description="Say what you see. Nothing changes until you confirm." />
      <VoiceAudit role={ctx.role} businessId={ctx.business.id} serverTranscription={serverTranscription} aiProvider={env.AI_PROVIDER} />
    </>
  );
}
