import Link from "next/link";
import { Mic, Sparkles } from "lucide-react";
import { ProposalList } from "@/components/review/proposal-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page";
import { hasRole, requireContext } from "@/lib/auth/session";
import { loadOpenReviewItems } from "@/lib/services/review-queue";

export const metadata = { title: "AI Review" };

export default async function ReviewPage() {
  const ctx = await requireContext();
  const entries = await loadOpenReviewItems(ctx);
  const manager = hasRole(ctx.role, "manager");

  const paths = [...new Set(entries.map((e) => e.imagePath).filter((p): p is string => !!p))];
  const signed = paths.length ? (await ctx.supabase.storage.from("inventory-media").createSignedUrls(paths, 900)).data ?? [] : [];
  const urlByPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const imageUrls = Object.fromEntries(entries.map((e) => [e.item.id, e.imagePath ? urlByPath.get(e.imagePath) ?? null : null]));

  return (
    <>
      <PageHeader
        title="AI review"
        description={manager ? "Suggestions from voice and photo audits across your team. Nothing is applied until someone confirms it." : "Your voice and photo suggestions that still need confirming."}
      />
      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="All caught up"
            description="New suggestions from voice and photo audits appear here until they are applied or dismissed."
            action={<Button asChild><Link href="/voice"><Mic /> Start a voice audit</Link></Button>}
          />
        </Card>
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {manager && entries.some((e) => e.item.requiresRole !== "employee") && (
            <Alert tone="warning" title="Approvals waiting">Some large changes were flagged for a manager. Check the quantity against the shelf before approving.</Alert>
          )}
          <ProposalList initialItems={entries.map((e) => e.item)} role={ctx.role} businessId={ctx.business.id} imageUrls={imageUrls} observedAtById={Object.fromEntries(entries.map((e) => [e.item.id, e.createdAt]))} />
        </div>
      )}
    </>
  );
}
