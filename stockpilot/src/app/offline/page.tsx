export const metadata = { title: "Offline" };

/** Served by the service worker when a page isn't cached and there's no connection. */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground">SP</span>
      <h1 className="text-xl font-semibold">You&apos;re offline</h1>
      <p className="text-sm text-muted">This page hasn&apos;t been saved for offline use. Voice and photo audits you already opened keep working and save your changes on this device until you reconnect.</p>
    </div>
  );
}
