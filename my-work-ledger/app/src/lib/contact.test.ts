import { describe, expect, it } from 'vitest';

import {
  buildBalanceMessage,
  formatPhone,
  isValidPhone,
  normalisePhone,
  smsHref,
  telHref,
} from './contact';
import { paise, type Paise } from './money';

const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));

describe('normalisePhone', () => {
  it('keeps a plain number as it is', () => {
    expect(normalisePhone('9876543210')).toBe('9876543210');
  });

  it('drops the spaces, brackets and dashes people actually type', () => {
    expect(normalisePhone('+91 (98765) 43-210')).toBe('+919876543210');
  });

  it('keeps a leading plus and nothing else that is not a digit', () => {
    expect(normalisePhone('  +91-98765 43210  ')).toBe('+919876543210');
    expect(normalisePhone('tel:9876543210')).toBe('9876543210');
  });

  it('refuses to carry an injected scheme or parameter through', () => {
    // Everything but the digits is dropped, so there is nothing left to inject.
    expect(normalisePhone('9876543210?body=pay me&to=+1999')).toBe('98765432101999');
    expect(normalisePhone('javascript:alert(1)')).toBe('1');
  });

  it('is empty for a value with no digits at all', () => {
    expect(normalisePhone('')).toBe('');
    expect(normalisePhone('   ')).toBe('');
    expect(normalisePhone('not a number')).toBe('');
  });

  it('never keeps more digits than E.164 allows', () => {
    expect(normalisePhone('1'.repeat(40))).toBe('1'.repeat(15));
  });
});

describe('isValidPhone', () => {
  it('accepts a plausible number with or without a country code', () => {
    expect(isValidPhone('9876543210')).toBe(true);
    expect(isValidPhone('+919876543210')).toBe(true);
  });

  it('rejects anything too short or too long to dial', () => {
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone(`+${'1'.repeat(16)}`)).toBe(false);
  });

  it('rejects anything that is not a bare number', () => {
    expect(isValidPhone('98765 43210')).toBe(false);
    expect(isValidPhone('+91+9876543210')).toBe(false);
    expect(isValidPhone('98765abcde')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('groups an Indian ten-digit number', () => {
    expect(formatPhone('9876543210')).toBe('98765 43210');
  });

  it('keeps a country code separate', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
  });

  it('leaves something it cannot read untouched rather than mangling it', () => {
    expect(formatPhone('not a number')).toBe('not a number');
  });
});

describe('telHref and smsHref', () => {
  it('build links from the normalised number', () => {
    expect(telHref('+91 98765 43210')).toBe('tel:+919876543210');
    expect(smsHref('98765 43210', 'hi')).toBe('sms:9876543210?&body=hi');
  });

  it('return null rather than a broken link when there is no usable number', () => {
    expect(telHref('')).toBeNull();
    expect(telHref('12345')).toBeNull();
    expect(smsHref('nonsense', 'hi')).toBeNull();
  });

  it('encodes the message so it cannot add its own URL parameters', () => {
    const href = smsHref('9876543210', 'pay me&to=+1999 #now');
    expect(href).toBe('sms:9876543210?&body=pay%20me%26to%3D%2B1999%20%23now');
    // One body parameter and no second recipient.
    expect(href?.split('&').length).toBe(2);
  });

  it('encodes a newline in the message', () => {
    expect(smsHref('9876543210', 'a\nb')).toBe('sms:9876543210?&body=a%0Ab');
  });
});

describe('buildBalanceMessage', () => {
  const base = {
    shopName: 'Blue Mart',
    personName: 'Saheer',
    asOf: '5 November 2025',
  };

  it('asks for the money when the shop owes you', () => {
    const message = buildBalanceMessage({ ...base, balance: rs(12_500) });
    expect(message).toContain('Blue Mart');
    expect(message).toContain('₹12,500');
    expect(message).toContain('5 November 2025');
    expect(message).toContain('Saheer');
  });

  it('mentions the part that is only earned so far, when there is one', () => {
    const message = buildBalanceMessage({
      ...base,
      balance: rs(12_500),
      unconfirmed: rs(2_500),
    });
    expect(message).toContain('₹2,500');
    expect(message).toContain('not settled yet');
  });

  it('says the unsettled part "counts", never "includes"', () => {
    // Payments already received are netted off the balance, so the unsettled
    // part can be larger than the figure due. Saying it is "included" would be
    // arithmetic that visibly does not add up — which the browser run showed.
    const message = buildBalanceMessage({
      ...base,
      balance: rs(22_183),
      unconfirmed: rs(26_933),
    });
    expect(message).toContain('It counts ₹26,933');
    expect(message).not.toContain('includes');
  });

  it('says nothing about an unsettled part when there is none to mention', () => {
    expect(buildBalanceMessage({ ...base, balance: rs(500), unconfirmed: paise(0) })).not.toContain(
      'not settled yet',
    );
    // A negative figure here would mean more has been received than earned; it
    // is not something to put in a message asking for money.
    expect(
      buildBalanceMessage({ ...base, balance: rs(500), unconfirmed: rs(-200) }),
    ).not.toContain('not settled yet');
  });

  it('says the opposite thing when you are the one who owes', () => {
    const message = buildBalanceMessage({ ...base, balance: rs(-800) });
    expect(message).toContain('I owe you ₹800');
    expect(message).not.toContain('Could you let me know');
  });

  it('never shows a minus sign, since the direction is in the words', () => {
    expect(buildBalanceMessage({ ...base, balance: rs(-800) })).not.toContain('-₹');
  });

  it('says you are square when the balance is nil', () => {
    expect(buildBalanceMessage({ ...base, balance: paise(0) })).toContain('square');
  });

  it('leaves off the signature when there is no name to sign with', () => {
    const message = buildBalanceMessage({ ...base, personName: '  ', balance: rs(100) });
    expect(message).not.toContain('—');
  });
});
