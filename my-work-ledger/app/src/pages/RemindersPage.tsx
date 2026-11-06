/**
 * Reminders: what needs doing, and when to be told about it.
 *
 * The page is honest about its own limits. A web page can only show a
 * notification while it is open, so the diagnostics block says that rather
 * than letting the user assume an alarm will reach them with the app closed.
 */

import { useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  CalendarClock,
  Check,
  ChevronRight,
  Info,
  Plus,
  Trash2,
} from 'lucide-react';

import {
  Badge,
  Banner,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Modal,
  SectionHeading,
  Select,
  TextInput,
  Toggle,
} from '@/components/ui';
import {
  createReminder,
  deleteReminder,
  setAutoReminder,
  updateReminder,
  type ReminderInput,
} from '@/data/reminders';
import { today as todayFn } from '@/lib/clock';
import { isCalendarDate, type CalendarDate } from '@/lib/dates';
import { useAuth } from '@/features/auth/AuthProvider';
import { useReminders } from '@/features/ledger/LedgerProvider';
import type { DerivedKind, DerivedReminder } from '@/features/reminders/derived';
import { describeDelivery } from '@/features/reminders/notifier';
import { useReminderRuntime } from '@/features/reminders/ReminderRuntime';
import { PLAN_HORIZON_DAYS } from '@/features/reminders/plan';
import {
  DEFAULT_REMINDER_TIME,
  describeSchedule,
  formatTime,
} from '@/features/reminders/schedule';
import { AUTO_REMINDER_IDS, type Reminder, type ReminderType } from '@/types/models';

const AUTO_DESCRIPTIONS: Readonly<Record<DerivedKind, { title: string; body: string }>> = {
  monthEnded: {
    title: 'The month is over',
    body: 'On the 1st, while a finished month still needs confirming — your cue to ask the shop for the money.',
  },
  settleReady: {
    title: 'Ready to settle',
    body: 'While a period can be closed into a statement you can hand over.',
  },
  salaryDueSoon: {
    title: 'Salary coming up',
    body: 'A week before each shop’s salary day.',
  },
  dailyTick: {
    title: 'Food money and days off',
    body: 'Each evening a day has not been ticked. Without this the calendar only gets filled in when you remember, and the balance drifts.',
  },
};

const AUTO_ORDER: readonly DerivedKind[] = [
  'monthEnded',
  'settleReady',
  'salaryDueSoon',
  'dailyTick',
];

const TIME_OPTIONS = ['07:00', '09:00', '13:00', '18:00', '20:00', '21:00'] as const;

const TYPE_OPTIONS: readonly { value: ReminderType; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'oneTime', label: 'Once' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function RemindersPage({ onOpenShop }: { onOpenShop: (shopId: string) => void }) {
  const { uid } = useAuth();
  const [editing, setEditing] = useState<Reminder | null | undefined>(undefined);

  const stored = useReminders();

  /** The stored schedule for each automatic kind, for the switches below. */
  const prefs = useMemo(() => {
    const map = new Map<DerivedKind, { enabled: boolean; time: string }>();
    for (const reminder of stored) {
      if (reminder.kind === 'custom') continue;
      map.set(reminder.kind as DerivedKind, {
        enabled: reminder.enabled,
        time: reminder.time,
      });
    }
    return map;
  }, [stored]);

  // Derived once, above the screens, so this page and the dashboard cannot
  // disagree about what needs doing.
  const runtime = useReminderRuntime();
  const derived = runtime.derived;
  const custom = stored.filter((reminder) => reminder.kind === 'custom');

  function setAuto(kind: DerivedKind, enabled: boolean, time: string) {
    if (!uid) return;
    setAutoReminder(uid, kind, { enabled, time });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold text-ink">Reminders</h1>
        <p className="mt-0.5 text-sm text-ink-2">
          What needs doing, and when to be nudged about it.
        </p>
      </header>

      <section>
        <SectionHeading title="Needs you now" />
        {derived.length === 0 ? (
          <Card>
            <EmptyState icon={<Check size={26} />} title="Nothing waiting">
              Everything is up to date across your shops.
            </EmptyState>
          </Card>
        ) : (
          <DueList reminders={derived} onOpenShop={onOpenShop} />
        )}
      </section>

      <section>
        <SectionHeading
          title="Notifications"
          action={
            runtime.permission === 'granted' ? (
              <Badge tone="credit">
                <BellRing size={11} />
                on
              </Badge>
            ) : (
              <Badge>
                <BellOff size={11} />
                off
              </Badge>
            )
          }
        />
        <Card className="p-4">
          <p className="text-sm text-ink-2">
            {describeDelivery(runtime.permission, runtime.native)}
          </p>
          {runtime.permission === 'default' ? (
            <Button
              tone="primary"
              onClick={() => void runtime.requestPermission()}
              className="mt-3"
            >
              <Bell size={15} />
              Turn notifications on
            </Button>
          ) : null}

          {runtime.native && runtime.permission === 'granted' ? (
            <div className="mt-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
              <p className="font-semibold text-ink">
                {runtime.sync?.scheduled ?? 0} reminder
                {(runtime.sync?.scheduled ?? 0) === 1 ? '' : 's'} set on this phone
              </p>
              <p className="mt-0.5 text-ink-2">
                Covering the next {PLAN_HORIZON_DAYS} days. The list is rebuilt every time you
                open the app, so a reminder for something you have already dealt with is taken
                back before it can go off.
              </p>
              {runtime.sync?.error ? (
                <p className="mt-2 text-danger">{runtime.sync.error}</p>
              ) : null}
            </div>
          ) : null}

          {!runtime.native && runtime.permission === 'granted' ? (
            <Banner tone="neutral" title="While the app is open">
              <p className="flex gap-2">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span>
                  A web page cannot wake itself once you close it, so these are a prompt for
                  when you look rather than an alarm. The Android build sets them with the
                  phone instead, and they arrive with the app closed.
                </span>
              </p>
            </Banner>
          ) : null}

          {runtime.native && runtime.permission === 'granted' ? (
            <Banner tone="neutral" title="What a set reminder can say">
              <p className="flex gap-2">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span>
                  A reminder's wording is fixed when it is set, so the ones Android holds ask a
                  question rather than quote a figure. The amounts are always here, in the app,
                  worked out fresh.
                </span>
              </p>
            </Banner>
          ) : null}
        </Card>
      </section>

      <section>
        <SectionHeading
          title="Automatic"
          description="Worked out from your shops. Each one stops on its own once you have dealt with it."
        />
        <Card className="divide-y divide-line">
          {AUTO_ORDER.map((kind) => {
            const setting = prefs.get(kind);
            const enabled = setting?.enabled ?? true;
            const time = setting?.time ?? DEFAULT_REMINDER_TIME;
            const copy = AUTO_DESCRIPTIONS[kind];
            return (
              <div key={kind} className="p-4">
                <Toggle
                  label={copy.title}
                  description={copy.body}
                  checked={enabled}
                  onChange={(next) => setAuto(kind, next, time)}
                />
                {enabled ? (
                  <div className="mt-3 flex items-center gap-2">
                    <CalendarClock size={14} className="shrink-0 text-ink-3" />
                    <Select
                      label="Time of day"
                      value={time}
                      onChange={(next) => setAuto(kind, true, next)}
                      options={TIME_OPTIONS.map((value) => ({
                        value,
                        label: formatTime(value),
                      }))}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>
      </section>

      <section>
        <SectionHeading
          title="Your own"
          action={
            <Button onClick={() => setEditing(null)}>
              <Plus size={15} />
              Add
            </Button>
          }
        />
        {custom.length === 0 ? (
          <Card>
            <EmptyState title="No reminders of your own">
              Add one for anything the app cannot work out — a rent day, a weekly stock count.
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <ul>
              {custom.map((reminder) => (
                <li key={reminder.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setEditing(reminder)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span
                        className={`block truncate text-sm font-semibold ${
                          reminder.enabled ? 'text-ink' : 'text-ink-3 line-through'
                        }`}
                      >
                        {reminder.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-3">
                        {describeSchedule(reminder)}
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {editing !== undefined ? (
        <ReminderForm
          key={editing?.id ?? 'new'}
          reminder={editing}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}

function DueList({
  reminders,
  onOpenShop,
}: {
  reminders: readonly DerivedReminder[];
  onOpenShop: (shopId: string) => void;
}) {
  return (
    <Card>
      <ul>
        {reminders.map((reminder) => (
          <li key={reminder.id} className="border-b border-line last:border-b-0">
            <button
              type="button"
              onClick={() => onOpenShop(reminder.shopId)}
              className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-surface-2"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{reminder.title}</span>
                <span className="mt-0.5 block text-sm text-ink-2">{reminder.body}</span>
              </span>
              <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-3" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReminderForm({
  reminder,
  onClose,
}: {
  reminder: Reminder | null;
  onClose: () => void;
}) {
  const { uid } = useAuth();
  const today = todayFn();

  const [title, setTitle] = useState(reminder?.title ?? '');
  const [body, setBody] = useState(reminder?.body ?? '');
  const [type, setType] = useState<ReminderType>(reminder?.type ?? 'monthly');
  const [weekday, setWeekday] = useState(String(reminder?.weekday ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(reminder?.dayOfMonth ?? 1));
  const [onDate, setOnDate] = useState<string>(reminder?.onDate ?? today);
  const [time, setTime] = useState(reminder?.time ?? DEFAULT_REMINDER_TIME);
  const [enabled, setEnabled] = useState(reminder?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!uid) return;
    const input: ReminderInput = {
      kind: 'custom',
      shopId: null,
      type,
      title,
      body,
      weekday: Number(weekday),
      dayOfMonth: Number(dayOfMonth),
      onDate: (isCalendarDate(onDate) ? onDate : null) as CalendarDate | null,
      time,
      enabled,
    };
    try {
      if (reminder) updateReminder(uid, reminder.id, input);
      else createReminder(uid, input);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save that.');
    }
  }

  function remove() {
    if (!uid || !reminder) return;
    deleteReminder(uid, reminder.id);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={reminder ? 'Edit reminder' : 'New reminder'}
      footer={
        <>
          {reminder ? (
            <Button tone="danger" onClick={remove}>
              <Trash2 size={15} />
            </Button>
          ) : (
            <Button tone="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button tone="primary" onClick={save} className="flex-1">
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextInput
          label="What to remind you"
          value={title}
          onChange={setTitle}
          maxLength={80}
          placeholder="Pay the room rent"
        />
        <TextInput
          label="Note (optional)"
          value={body}
          onChange={setBody}
          maxLength={300}
        />

        <ChipGroup label="How often" value={type} onChange={setType} options={TYPE_OPTIONS} />

        {type === 'weekly' ? (
          <Select
            label="Day of the week"
            value={weekday}
            onChange={setWeekday}
            options={WEEKDAYS.map((label, index) => ({ value: String(index), label }))}
          />
        ) : null}

        {type === 'monthly' ? (
          <Select
            label="Day of the month"
            value={dayOfMonth}
            onChange={setDayOfMonth}
            options={Array.from({ length: 31 }, (_, index) => ({
              value: String(index + 1),
              label:
                index + 1 > 28
                  ? `${index + 1} (or the last day of a shorter month)`
                  : String(index + 1),
            }))}
          />
        ) : null}

        {type === 'oneTime' ? (
          <TextInput label="Date" type="date" value={onDate} onChange={setOnDate} />
        ) : null}

        <Select
          label="Time"
          value={time}
          onChange={setTime}
          options={TIME_OPTIONS.map((value) => ({ value, label: formatTime(value) }))}
        />

        <Toggle label="Switched on" checked={enabled} onChange={setEnabled} />

        {error ? <Banner tone="danger">{error}</Banner> : null}

        {reminder && AUTO_REMINDER_IDS[reminder.kind] ? (
          <Banner tone="neutral">This is one of the automatic reminders.</Banner>
        ) : null}
      </div>
    </Modal>
  );
}
