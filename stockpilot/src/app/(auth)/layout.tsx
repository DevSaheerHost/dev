import { Camera, CheckCircle2, Mic, ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">SP</span>
            <div>
              <p className="font-semibold leading-tight">StockPilot AI</p>
              <p className="text-xs text-muted">Your Inventory. Just a Conversation Away.</p>
            </div>
          </div>
          {children}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgb(255_255_255/0.14),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-center px-14 text-primary-foreground">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">Walk the aisles. Say what you see. Done.</h2>
          <p className="mt-3 max-w-md text-primary-foreground/80">Count stock, log deliveries and catch expired products by speaking or snapping a photo. Every change is checked by a person before it counts.</p>
          <ul className="mt-10 space-y-4 text-sm">
            {[
              [Mic, "“Three boxes of cough syrup left, four cases of AA batteries arrived.”"],
              [Camera, "Photograph shelves, packing slips and expiry labels."],
              [CheckCircle2, "Review AI suggestions with confidence scores before applying."],
              [ShieldCheck, "Every adjustment is logged, attributed and reversible by a correction."],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Mic;
              return (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15"><I className="size-4" /></span>
                  <span className="pt-1.5 text-primary-foreground/90">{text as string}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
