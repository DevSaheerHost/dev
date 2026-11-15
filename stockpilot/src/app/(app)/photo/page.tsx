import { PhotoAudit } from "@/components/photo/photo-audit";
import { PageHeader } from "@/components/ui/page";
import { requireContext } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";

export const metadata = { title: "Photo Audit" };

export default async function PhotoPage() {
  const ctx = await requireContext();
  const env = serverEnv();
  return (
    <>
      <PageHeader title="Photo audit" description="Photograph shelves, delivery slips, damage or expiry labels." />
      <PhotoAudit role={ctx.role} businessId={ctx.business.id} visionAvailable={env.AI_PROVIDER === "gemini" && !!env.GEMINI_API_KEY} />
    </>
  );
}
