/**
 * The first thing a new user sees, and the only chance to say what this is.
 *
 * Before this, signing up landed straight on "Add a shop to begin" and a form
 * of ten questions, several of them in accounting language. Nothing had said
 * what the app does or why any of it was being asked, so the first impression
 * was a tax form.
 *
 * So: one sentence of what it is for, three of how it works, one button. No
 * carousel, no tour, nothing to dismiss. The person reading it is standing in
 * a shop.
 */

import { ArrowRight, CalendarCheck, HandCoins, TrendingUp } from 'lucide-react';

import { Button, Card } from '@/components/ui';

const STEPS: readonly { icon: typeof TrendingUp; title: string; body: string }[] = [
  {
    icon: CalendarCheck,
    title: 'Tell it where you work, once',
    body: 'The name of the shop, what they pay you for a full month, and the day you started.',
  },
  {
    icon: TrendingUp,
    title: 'It counts up on its own',
    body: 'Every day you work, the amount they owe you goes up. You never type your salary in again.',
  },
  {
    icon: HandCoins,
    title: 'Record what they hand you',
    body: 'An advance, a part payment, money you spent for the shop. What is still due is always on screen.',
  },
];

export function FirstRun({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <header className="pt-2">
        <h1 className="text-2xl font-bold text-balance text-ink">
          Know what you are owed, without doing the sums
        </h1>
        <p className="mt-2 text-base text-ink-2">
          A record of your pay at every shop you work at — what has built up, what you have been
          given, and what is still outstanding.
        </p>
      </header>

      <Card className="divide-y divide-line">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
              <step.icon size={17} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                <span className="text-ink-3">{index + 1}. </span>
                {step.title}
              </p>
              <p className="mt-0.5 text-sm text-ink-2">{step.body}</p>
            </div>
          </div>
        ))}
      </Card>

      <Button tone="primary" onClick={onStart} fullWidth className="min-h-14 text-base">
        Set up my first shop
        <ArrowRight size={17} />
      </Button>

      <p className="text-center text-sm text-ink-3">
        Takes a minute. Everything is saved on this device first, so it works without a signal.
      </p>
    </div>
  );
}
