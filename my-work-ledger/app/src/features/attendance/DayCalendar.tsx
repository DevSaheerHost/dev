/**
 * The month calendar: which days were worked, and which days the food money
 * actually arrived.
 *
 * Two things are recorded per day and they are deliberately different gestures.
 * Tapping a day opens it; inside, "I did not work" and a tick per daily
 * allowance. A day off and a day the food money came are opposite facts, so
 * conflating them into one tap would guarantee mistakes.
 *
 * Future days are not editable. You cannot have taken a day off tomorrow, and
 * allowing it would let the balance be built on days that have not happened.
 */

import { useState } from 'react';
import { Check, CircleSlash, Utensils } from 'lucide-react';

import { Badge, Button, Modal, Toggle } from '@/components/ui';
import { setDayOff, toggleAllowanceReceived } from '@/data/days';
import {
  compareDates,
  daysInMonth,
  formatDateLong,
  periodStart,
  weekdayOf,
  makeDate,
  type CalendarDate,
  type PeriodKey,
} from '@/lib/dates';
import { isDailySettled, type DayMap } from '@/features/ledger/attendance';
import type { DayRecord, IncomeConfig, Shop } from '@/types/models';

import { useAuth } from '../auth/AuthProvider';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

type DayState = 'future' | 'outside' | 'off' | 'worked' | 'settled';

function stateFor(
  date: CalendarDate,
  record: DayRecord | undefined,
  dailyConfigIds: readonly string[],
  earliest: CalendarDate,
  today: CalendarDate,
): DayState {
  if (compareDates(date, today) > 0) return 'future';
  if (compareDates(date, earliest) < 0) return 'outside';
  if (record?.off) return 'off';
  if (
    dailyConfigIds.length > 0 &&
    dailyConfigIds.every((id) => record?.allowancesReceived.includes(id))
  ) {
    return 'settled';
  }
  return 'worked';
}

const CELL_STYLE: Record<DayState, string> = {
  future: 'text-ink-3/50 border-transparent cursor-default',
  outside: 'text-ink-3/40 border-transparent cursor-default',
  off: 'border-debit/40 bg-debit-soft text-debit-strong font-semibold',
  worked: 'border-line text-ink hover:bg-surface-2',
  settled: 'border-credit/40 bg-credit-soft text-credit-strong font-semibold',
};

export function DayCalendar({
  shop,
  period,
  days,
  configs,
  today,
}: {
  shop: Shop;
  period: PeriodKey;
  days: DayMap;
  configs: readonly IncomeConfig[];
  today: CalendarDate;
}) {
  const { uid } = useAuth();
  const [openDate, setOpenDate] = useState<CalendarDate | null>(null);

  const dailyConfigs = configs.filter(isDailySettled);
  const dailyConfigIds = dailyConfigs.map((config) => config.id);

  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const total = daysInMonth(year, month);
  const leading = weekdayOf(periodStart(period));
  const earliest = shop.joiningDate > shop.openingBalanceAsOf
    ? shop.joiningDate
    : shop.openingBalanceAsOf;

  const cells: (CalendarDate | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, index) => makeDate(year, month, index + 1)),
  ];

  const openRecord = openDate ? days.get(openDate) : undefined;
  const openState = openDate
    ? stateFor(openDate, openRecord, dailyConfigIds, earliest, today)
    : null;

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((letter, index) => (
          <span key={index} className="text-xs font-semibold text-ink-3">
            {letter}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, index) => {
          if (!date) return <span key={`pad-${index}`} />;
          const record = days.get(date);
          const state = stateFor(date, record, dailyConfigIds, earliest, today);
          const editable = state !== 'future' && state !== 'outside';
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              disabled={!editable}
              onClick={() => setOpenDate(date)}
              aria-label={`${formatDateLong(date)}${state === 'off' ? ', day off' : ''}`}
              className={`relative flex aspect-square min-h-11 items-center justify-center rounded-lg border text-sm transition-colors ${CELL_STYLE[state]} ${
                isToday ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''
              }`}
            >
              {Number(date.slice(8))}
              {state === 'off' ? (
                <CircleSlash size={10} className="absolute right-1 bottom-1" />
              ) : null}
              {state === 'settled' ? (
                <Check size={10} className="absolute right-1 bottom-1" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge tone="credit">
          <Utensils size={11} />
          Food money received
        </Badge>
        <Badge tone="debit">
          <CircleSlash size={11} />
          Day off
        </Badge>
      </div>

      {openDate && openState ? (
        <Modal
          open
          onClose={() => setOpenDate(null)}
          title={formatDateLong(openDate)}
          footer={
            <Button tone="primary" onClick={() => setOpenDate(null)} fullWidth>
              Done
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <Toggle
              label="I did not work this day"
              description={
                openState === 'off'
                  ? 'This day is not counted, so the month comes to less than the full salary.'
                  : 'Marking a day off removes it from the salary for this month.'
              }
              checked={openState === 'off'}
              onChange={(off) => {
                if (!uid) return;
                setDayOff(uid, shop.id, openDate, off, openRecord);
              }}
            />

            {dailyConfigs.length === 0 ? (
              <p className="text-sm text-ink-3">
                No daily allowance is set up for this shop, so there is nothing to tick off.
              </p>
            ) : openState === 'off' ? (
              <p className="text-sm text-ink-3">
                A day you did not work earns no daily allowance, so there is nothing to record.
              </p>
            ) : (
              dailyConfigs.map((config) => (
                <Toggle
                  key={config.id}
                  label={`${config.label} received`}
                  description={
                    openRecord?.allowancesReceived.includes(config.id)
                      ? 'Settled for this day.'
                      : 'Still owed to you for this day.'
                  }
                  checked={openRecord?.allowancesReceived.includes(config.id) ?? false}
                  onChange={() => {
                    if (!uid) return;
                    toggleAllowanceReceived(uid, shop.id, openDate, config.id, openRecord);
                  }}
                />
              ))
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
