/**
 * Interface primitives.
 *
 * Small, unopinionated building blocks so screens stay about the ledger rather
 * than about markup. Two rules hold throughout:
 *
 *  - No arithmetic in a component. Amounts arrive already computed as `Paise`
 *    and are only formatted here.
 *  - Every interactive element is at least 44px tall, because this is used
 *    one-handed on a phone while standing in a shop.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { formatPaise, type Paise } from '@/lib/money';

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'li' | 'article';
}) {
  return (
    <Tag
      className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  title,
  action,
  description,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-wide text-ink-3 uppercase">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-ink-2">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonTone = 'primary' | 'neutral' | 'ghost' | 'danger';

const BUTTON_TONES: Record<ButtonTone, string> = {
  primary:
    'bg-accent text-accent-contrast hover:bg-accent-ink active:bg-accent-ink disabled:bg-line-strong disabled:text-ink-3',
  neutral:
    'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-bg-soft disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-surface-2 active:bg-bg-soft disabled:text-ink-3',
  danger: 'border border-danger/40 bg-danger-soft text-danger hover:bg-danger/15',
};

export function Button({
  children,
  tone = 'neutral',
  type = 'button',
  onClick,
  disabled = false,
  className = '',
  fullWidth = false,
  ariaLabel,
  form,
}: {
  children: ReactNode;
  tone?: ButtonTone;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
  ariaLabel?: string;
  /** Submits a form that lives elsewhere in the tree, e.g. a modal footer. */
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
        BUTTON_TONES[tone]
      } ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

const CONTROL_CLASS =
  'min-h-11 w-full rounded-xl border bg-surface px-3 text-base text-ink placeholder:text-ink-3 transition-colors';

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  label,
  autoComplete,
  inputMode,
  maxLength,
  required = false,
  disabled = false,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'date' | 'tel';
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
  label: string;
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'numeric' | 'decimal' | 'tel';
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        className={`${CONTROL_CLASS} ${
          error ? 'border-danger' : 'border-line-strong focus:border-accent'
        } ${className}`}
      />
    </Field>
  );
}

/**
 * A money input. Kept as text with a decimal keypad rather than
 * `<input type="number">`: a number input silently discards what it cannot
 * parse, and an amount that vanishes as you type is worse than an error.
 */
export function MoneyInput({
  value,
  onChange,
  label,
  error,
  hint,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-ink-3"
        >
          &#8377;
        </span>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className={`wl-money-input ${CONTROL_CLASS} pl-8 ${
            error ? 'border-danger' : 'border-line-strong focus:border-accent'
          }`}
        />
      </div>
    </Field>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  error,
  hint,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { readonly value: T; readonly label: string }[];
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={`${CONTROL_CLASS} appearance-none pr-9 ${
          error ? 'border-danger' : 'border-line-strong focus:border-accent'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * A row of choices, one selected.
 *
 * Used instead of a `<select>` wherever the options are few and the choice
 * matters: picking "Advance" rather than "Salary" changes what the statement
 * says, and a chip that is visibly selected is harder to get wrong in a hurry
 * than a collapsed dropdown.
 */
export function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { readonly value: T; readonly label: string }[];
  hint?: string | undefined;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink-2">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-11 rounded-xl border px-3.5 text-sm font-semibold transition-colors ${
                selected
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-line-strong text-ink-2 hover:bg-surface-2'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {hint ? <p className="mt-1.5 text-sm text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** An on/off setting with its explanation, sized for a thumb. */
export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line-strong px-3.5 py-3 text-left hover:bg-surface-2"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-ink-3">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line-strong'
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Money display                                                               */
/* -------------------------------------------------------------------------- */

/**
 * An amount with its semantic colour.
 *
 * `tone="balance"` reads the sign: a positive balance is a credit (the shop
 * owes you) and a negative one a debit. A bare `-₹450` inside a card headed
 * "owed to you" is ambiguous, so callers pair this with wording rather than
 * relying on the minus sign alone.
 */
export function Amount({
  value,
  tone = 'plain',
  size = 'md',
  showPaise,
  signed = false,
}: {
  value: Paise;
  tone?: 'plain' | 'balance' | 'credit' | 'debit' | 'muted';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showPaise?: boolean;
  signed?: boolean;
}) {
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl font-semibold',
    xl: 'text-[2rem] leading-tight font-bold',
  } as const;

  const resolved =
    tone === 'balance' ? (value < 0 ? 'debit' : value > 0 ? 'credit' : 'muted') : tone;

  const colours = {
    plain: 'text-ink',
    credit: 'text-credit',
    debit: 'text-debit',
    muted: 'text-ink-3',
  } as const;

  // In "balance" phrasing the direction is carried by words, so the magnitude
  // is shown without a minus that would read as a negative debt.
  const display =
    tone === 'balance' && value < 0
      ? formatPaise(Math.abs(value) as Paise, { paise: showPaise ?? false })
      : formatPaise(value, { paise: showPaise ?? false, signed });

  return (
    <span className={`wl-amount ${sizes[size]} ${colours[resolved]}`}>
      {display}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'credit' | 'debit' | 'accent' | 'danger';
}) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2 border-line',
    credit: 'bg-credit-soft text-credit-strong border-credit/30',
    debit: 'bg-debit-soft text-debit-strong border-debit/30',
    accent: 'bg-accent-soft text-accent-ink border-accent/25',
    danger: 'bg-danger-soft text-danger border-danger/30',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Up to two initials for a name, or "?" for a name with no letters in it. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return '?';
  const first = [...(words[0] ?? '')][0] ?? '';
  const second = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : '';
  return (first + second).toUpperCase();
}

const AVATAR_TONES = [
  'bg-accent-soft text-accent-ink',
  'bg-credit-soft text-credit-strong',
  'bg-debit-soft text-debit-strong',
  'bg-surface-2 text-ink-2',
] as const;

/**
 * A name as a coloured disc, so a list of shops can be scanned by shape.
 *
 * The colour is a deterministic function of the name, never random: a shop that
 * changed colour between renders would be worse than no colour at all.
 */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100003;
  }
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0];
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-bold ${tone} ${
        size === 'sm' ? 'size-9 text-xs' : 'size-11 text-sm'
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function Banner({
  tone = 'neutral',
  title,
  children,
  action,
}: {
  tone?: 'neutral' | 'accent' | 'debit' | 'danger';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    neutral: 'border-line bg-surface-2 text-ink-2',
    accent: 'border-accent/25 bg-accent-soft text-accent-ink',
    debit: 'border-debit/30 bg-debit-soft text-debit-strong',
    danger: 'border-danger/30 bg-danger-soft text-danger',
  } as const;
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="status">
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-0.5' : ''}>{children}</div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children ? <p className="max-w-sm text-sm text-ink-2">{children}</p> : null}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-3">
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent"
      />
      {label}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A sheet on mobile, a dialog on desktop. Escape closes it, focus moves inside
 * on open, and the page behind it stops scrolling — the three things that make
 * the difference between a dialog and a div that happens to float.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-float sm:max-w-lg sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 grid size-10 place-items-center rounded-lg text-ink-3 hover:bg-surface-2"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex gap-2 border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
