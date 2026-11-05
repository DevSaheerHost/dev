/**
 * Security rules tests.
 *
 * These run against the Firestore emulator rather than the real project, so
 * they exercise the rules exactly as deployed without touching live data.
 *
 *   # terminal 1, from my-work-ledger/
 *   npx firebase emulators:start --only firestore --project demo-ledger
 *
 *   # terminal 2, from my-work-ledger/app/
 *   npm run test:rules
 *
 * They are kept out of `npm test` on purpose: the unit tests must stay runnable
 * with no emulator, no Java and no network, and a suite that is sometimes
 * skipped teaches people to ignore failures.
 *
 * The cases below are the ones that matter if the rules are wrong: can one
 * account reach another's ledger, can a field be forged, can a sealed statement
 * be rewritten, can anything be deleted.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { strict as assert } from 'node:assert';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const here = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(here, '..', '..', 'firebase', 'firestore.rules'), 'utf8');

const ALICE = 'alice_uid';
const BOB = 'bob_uid';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-ledger',
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});

const alice = testEnv.authenticatedContext(ALICE).firestore();
const bob = testEnv.authenticatedContext(BOB).firestore();
const anon = testEnv.unauthenticatedContext().firestore();

/** A valid shop payload. Each test overrides one field to prove it is checked. */
function shopDoc(overrides = {}) {
  return {
    name: 'Blue Mart',
    description: 'Evening shift',
    phone: '+919876543210',
    joiningDate: '2025-01-01',
    salaryPayDay: 5,
    settlementMode: 'accrual',
    openingBalance: 450000,
    openingBalanceAsOf: '2025-01-01',
    sealedThroughDate: null,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function txnDoc(overrides = {}) {
  return {
    uid: ALICE,
    shopId: 'shop_one',
    kind: 'expense_paid',
    amount: 25000,
    direction: 'credit',
    category: 'stock',
    description: 'Bought packing tape',
    transactionDate: '2025-11-04',
    recognitionDate: '2025-11-04',
    periodKey: '2025-11',
    sortKey: '2025-11-04#1762200000000#txn_a',
    clientCreatedAtMs: 1762200000000,
    reimbursable: true,
    fundedFrom: 'own',
    accrualKey: null,
    settlesExpenseIds: null,
    recoversTransactionId: null,
    pairId: null,
    settlementId: null,
    isPriorPeriodAdjustment: false,
    adjustsSettlementId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

const aliceShop = (db = alice) => doc(db, 'users', ALICE, 'shops', 'shop_one');
const aliceTxn = (id, db = alice) =>
  doc(db, 'users', ALICE, 'shops', 'shop_one', 'transactions', id);

/** Asserts the write is refused, naming the case when it is wrongly allowed. */
async function mustReject(label, operation) {
  try {
    await assertFails(operation);
  } catch (error) {
    throw new Error(`${label} should have been rejected but was allowed: ${error.message}`);
  }
}

test.before(async () => {
  await testEnv.clearFirestore();
  // Seeded with rules disabled, so the fixtures themselves are not under test.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', ALICE), {
      schemaVersion: 1,
      displayName: 'Alice',
      currency: 'INR',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await setDoc(doc(db, 'users', ALICE, 'shops', 'shop_seeded'), {
      ...shopDoc({ name: 'Seeded Shop' }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // A shop stored before the phone field existed. Its updates must still be
    // accepted, which is why the rule checks the key is present before reading
    // it: reading a missing key is an evaluation error, not null.
    const legacy = { ...shopDoc({ name: 'Legacy Shop' }), createdAt: new Date(), updatedAt: new Date() };
    delete legacy.phone;
    await setDoc(doc(db, 'users', ALICE, 'shops', 'shop_legacy'), legacy);
    await setDoc(doc(db, 'users', ALICE, 'shops', 'shop_one', 'settlements', 'set_sealed'), {
      shopId: 'shop_one',
      periodStart: '2025-10-01',
      periodEnd: '2025-10-31',
      settlementDate: '2025-11-01',
      openingBalance: 0,
      closingBalance: 120000,
      totals: {},
      transactionCount: 3,
      statementNo: 1,
      sealState: 'sealed',
      status: 'sealed',
      notes: '',
      sealedAt: new Date(),
      createdAt: new Date(),
    });
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

/* ------------------------------------------------------------------ isolation */

test('an unauthenticated client can read nothing', async () => {
  await assertFails(getDoc(doc(anon, 'users', ALICE)));
  await assertFails(getDocs(collection(anon, 'users', ALICE, 'shops')));
});

test("one account cannot read another account's profile or shops", async () => {
  await assertFails(getDoc(doc(bob, 'users', ALICE)));
  await assertFails(getDocs(collection(bob, 'users', ALICE, 'shops')));
  await assertFails(getDoc(doc(bob, 'users', ALICE, 'shops', 'shop_seeded')));
});

test("one account cannot write into another account's ledger", async () => {
  await assertFails(setDoc(aliceShop(bob), shopDoc()));
  await assertFails(
    updateDoc(doc(bob, 'users', ALICE, 'shops', 'shop_seeded'), { name: 'Hijacked' }),
  );
  await assertFails(setDoc(aliceTxn('txn_bob', bob), txnDoc()));
});

test('the owner can read their own ledger', async () => {
  await assertSucceeds(getDoc(doc(alice, 'users', ALICE)));
  await assertSucceeds(getDocs(collection(alice, 'users', ALICE, 'shops')));
});

/* -------------------------------------------------------------------- profile */

test('a new account can create its own profile', async () => {
  // This path was previously only ever exercised with the rules disabled, so a
  // malformed profile write would have failed silently on every sign-up.
  const carol = testEnv.authenticatedContext('carol_uid').firestore();
  await assertSucceeds(
    setDoc(doc(carol, 'users', 'carol_uid'), {
      schemaVersion: 1,
      displayName: 'Carol',
      currency: 'INR',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test('profile fields are validated', async () => {
  const dave = testEnv.authenticatedContext('dave_uid').firestore();
  const profile = (overrides) => ({
    schemaVersion: 1,
    displayName: 'Dave',
    currency: 'INR',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });
  const cases = [
    ['empty name', profile({ displayName: '' })],
    ['unsupported currency', profile({ currency: 'USD' })],
    ['schemaVersion as a float', profile({ schemaVersion: 1.5 })],
    ['unknown extra field', { ...profile({}), isAdmin: true }],
    ['client-chosen createdAt', profile({ createdAt: new Date(0) })],
  ];
  for (const [label, payload] of cases) {
    await mustReject(label, setDoc(doc(dave, 'users', 'dave_uid'), payload));
  }
});

test('a profile can be renamed but not re-dated', async () => {
  const carol = testEnv.authenticatedContext('carol_uid').firestore();
  await assertSucceeds(
    updateDoc(doc(carol, 'users', 'carol_uid'), {
      displayName: 'Carol B',
      updatedAt: serverTimestamp(),
    }),
  );
  await mustReject(
    'changing createdAt',
    updateDoc(doc(carol, 'users', 'carol_uid'), { createdAt: serverTimestamp() }),
  );
  await mustReject('deleting a profile', deleteDoc(doc(carol, 'users', 'carol_uid')));
});

/* ---------------------------------------------------------------------- shops */

test('a valid shop is accepted and nothing is deletable', async () => {
  await assertSucceeds(setDoc(aliceShop(), shopDoc()));
  await assertFails(deleteDoc(aliceShop()));
});

test('shop fields are validated, not merely stored', async () => {
  const cases = [
    ['empty name', shopDoc({ name: '' })],
    ['over-long name', shopDoc({ name: 'x'.repeat(61) })],
    ['float amount', shopDoc({ openingBalance: 1200.5 })],
    ['amount beyond the cap', shopDoc({ openingBalance: 99999999999999 })],
    ['amount as a string', shopDoc({ openingBalance: '450000' })],
    ['pay day 0', shopDoc({ salaryPayDay: 0 })],
    ['pay day 32', shopDoc({ salaryPayDay: 32 })],
    ['timestamp in a date field', shopDoc({ joiningDate: new Date() })],
    ['malformed date', shopDoc({ joiningDate: '01-01-2025' })],
    ['unknown settlement mode', shopDoc({ settlementMode: 'whatever' })],
    ['balance starting before joining', shopDoc({ openingBalanceAsOf: '2024-12-31' })],
    ['created as archived', shopDoc({ status: 'archived' })],
    ['unknown extra field', { ...shopDoc(), isAdmin: true }],
    ['client-chosen createdAt', shopDoc({ createdAt: new Date(0) })],
    // The phone number ends up inside a `tel:`/`sms:` link, so anything that
    // is not a bare number is a URL injection and has to be refused here
    // rather than relied on to be refused in the client.
    ['phone with a scheme', shopDoc({ phone: 'tel:9876543210' })],
    ['phone carrying an extra URL parameter', shopDoc({ phone: '9876543210?body=pay&to=1' })],
    ['phone with spaces', shopDoc({ phone: '+91 98765 43210' })],
    ['phone too short to dial', shopDoc({ phone: '12345' })],
    ['phone longer than E.164 allows', shopDoc({ phone: '1'.repeat(16) })],
    ['phone as a number rather than a string', shopDoc({ phone: 9876543210 })],
    ['phone with letters', shopDoc({ phone: '98765abcde' })],
  ];
  for (const [label, payload] of cases) {
    await mustReject(label, setDoc(doc(alice, 'users', ALICE, 'shops', 'shop_reject'), payload));
  }
});

test('the phone number is optional, and a shop stored without one still updates', async () => {
  // Absent, null and a plain number are all acceptable.
  await assertSucceeds(
    setDoc(doc(alice, 'users', ALICE, 'shops', 'shop_nophone'), shopDoc({ phone: null })),
  );
  await assertSucceeds(
    setDoc(doc(alice, 'users', ALICE, 'shops', 'shop_localphone'), shopDoc({ phone: '9876543210' })),
  );
  // A shop created before this field existed has no `phone` key at all. An
  // unrelated update to it must still be allowed.
  await assertSucceeds(
    updateDoc(doc(alice, 'users', ALICE, 'shops', 'shop_legacy'), {
      status: 'archived',
      updatedAt: serverTimestamp(),
    }),
  );
  // And a number can be added to it afterwards, but still only a valid one.
  await assertSucceeds(
    updateDoc(doc(alice, 'users', ALICE, 'shops', 'shop_legacy'), {
      phone: '+919876543210',
      updatedAt: serverTimestamp(),
    }),
  );
  await mustReject(
    'adding a malformed phone number to an older shop',
    updateDoc(doc(alice, 'users', ALICE, 'shops', 'shop_legacy'), {
      phone: 'sms:1?body=x',
      updatedAt: serverTimestamp(),
    }),
  );
});

test('a shop can be archived but its seal date cannot be rolled back', async () => {
  await assertSucceeds(
    updateDoc(aliceShop(), { status: 'archived', updatedAt: serverTimestamp() }),
  );
  await assertSucceeds(
    updateDoc(aliceShop(), { sealedThroughDate: '2025-10-31', updatedAt: serverTimestamp() }),
  );
  // Retreating would reopen a sealed period, so it must be refused.
  await mustReject(
    'rolling the seal date back',
    updateDoc(aliceShop(), { sealedThroughDate: '2025-09-30', updatedAt: serverTimestamp() }),
  );
  await mustReject(
    'clearing the seal date',
    updateDoc(aliceShop(), { sealedThroughDate: null, updatedAt: serverTimestamp() }),
  );
});

/* --------------------------------------------------------------- transactions */

test('a valid transaction is accepted', async () => {
  await assertSucceeds(setDoc(aliceTxn('txn_ok'), txnDoc()));
});

test('a forged owner field is rejected', async () => {
  // The denormalised uid is what the cross-shop query trusts, so it has to
  // match both the path and the caller.
  await mustReject("another account's uid", setDoc(aliceTxn('txn_forged'), txnDoc({ uid: BOB })));
  await mustReject(
    'a shopId disagreeing with the path',
    setDoc(aliceTxn('txn_forged2'), txnDoc({ shopId: 'some_other_shop' })),
  );
});

test('transaction fields are validated', async () => {
  const cases = [
    ['unknown kind', txnDoc({ kind: 'mystery_income' })],
    ['negative amount on a non-adjustment', txnDoc({ amount: -25000 })],
    ['float amount', txnDoc({ amount: 250.5 })],
    ['malformed date', txnDoc({ transactionDate: '2025/11/04' })],
    ['recognition before the event', txnDoc({ recognitionDate: '2025-11-03' })],
    ['period key disagreeing with recognition', txnDoc({ periodKey: '2025-10' })],
    ['unknown funding source', txnDoc({ fundedFrom: 'someone_else' })],
    ['settlement id set at creation', txnDoc({ settlementId: 'set_sealed' })],
    ['pre-voided', txnDoc({ voidedAt: serverTimestamp() })],
    ['unknown extra field', { ...txnDoc(), secretFlag: 1 }],
  ];
  for (const [label, payload] of cases) {
    await mustReject(label, setDoc(aliceTxn('txn_reject'), payload));
  }
});

test('a signed adjustment may be negative', async () => {
  await assertSucceeds(
    setDoc(aliceTxn('txn_adj'), txnDoc({ kind: 'adjustment', amount: -50000, direction: 'debit' })),
  );
});

test('money and dates are immutable once written; a mistake is voided instead', async () => {
  await mustReject(
    'editing an amount',
    updateDoc(aliceTxn('txn_ok'), { amount: 1, updatedAt: serverTimestamp() }),
  );
  await mustReject(
    'editing a kind',
    updateDoc(aliceTxn('txn_ok'), { kind: 'salary_earned', updatedAt: serverTimestamp() }),
  );
  await mustReject(
    'editing a date',
    updateDoc(aliceTxn('txn_ok'), { transactionDate: '2025-11-05', updatedAt: serverTimestamp() }),
  );
  await assertSucceeds(
    updateDoc(aliceTxn('txn_ok'), {
      voidedAt: serverTimestamp(),
      voidReason: 'Entered twice',
      updatedAt: serverTimestamp(),
    }),
  );
  await mustReject('deleting an entry', deleteDoc(aliceTxn('txn_ok')));
});

test('an entry claimed by a settlement freezes except for the stamp itself', async () => {
  await assertSucceeds(setDoc(aliceTxn('txn_claim'), txnDoc()));
  await assertSucceeds(
    updateDoc(aliceTxn('txn_claim'), { settlementId: 'set_sealed', updatedAt: serverTimestamp() }),
  );
  await mustReject(
    'editing a settled entry',
    updateDoc(aliceTxn('txn_claim'), {
      description: 'Rewriting history',
      updatedAt: serverTimestamp(),
    }),
  );
});

/* -------------------------------------------------------------- accruals */

function accrualDoc(overrides = {}) {
  return txnDoc({
    kind: 'salary_earned',
    direction: 'credit',
    amount: 1800000,
    category: 'accrual',
    description: 'Monthly salary',
    transactionDate: '2025-11-30',
    recognitionDate: '2025-11-30',
    periodKey: '2025-11',
    sortKey: '2025-11-30#001763000000000#acc',
    reimbursable: null,
    fundedFrom: null,
    accrualKey: 'inc_salary:2025-11',
    ...overrides,
  });
}

test('an accrual writes under its deterministic id', async () => {
  const id = 'acc_inc_salary_202511';
  await assertSucceeds(setDoc(aliceTxn(id), accrualDoc()));
});

test('re-posting the same month cannot create a second salary', async () => {
  // Two devices confirming November, or a double tap, both address the SAME
  // document because the id is derived from the config and the period. The
  // second write is then refused outright: it would have to change `createdAt`,
  // and a posted entry's timestamps are immutable.
  //
  // So a duplicate is impossible in two independent ways — the id collides, and
  // the collision is rejected rather than overwriting what is already there.
  // That is stronger than a silent no-op, which would hide a genuine conflict.
  const id = 'acc_inc_salary_202512';
  await assertSucceeds(setDoc(aliceTxn(id), accrualDoc({ periodKey: '2025-12', transactionDate: '2025-12-31', recognitionDate: '2025-12-31', accrualKey: 'inc_salary:2025-12' })));
  await mustReject(
    're-posting an accrual',
    setDoc(aliceTxn(id), accrualDoc({ periodKey: '2025-12', transactionDate: '2025-12-31', recognitionDate: '2025-12-31', accrualKey: 'inc_salary:2025-12', amount: 9900000 })),
  );

  // And the original is untouched by the attempt.
  const stored = await getDoc(aliceTxn(id));
  assert.equal(stored.data().amount, 1800000);
});

/* ----------------------------------------------------------- income configs */

function configDoc(overrides = {}) {
  return {
    kind: 'salary',
    label: 'Monthly salary',
    amount: 1800000,
    frequency: 'monthly',
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const aliceConfig = (id, db = alice) =>
  doc(db, 'users', ALICE, 'shops', 'shop_one', 'incomeConfigs', id);

test('a valid income config is accepted and is not deletable', async () => {
  await assertSucceeds(setDoc(aliceConfig('inc_salary'), configDoc()));
  await mustReject('deleting an income config', deleteDoc(aliceConfig('inc_salary')));
});

test('income config fields are validated', async () => {
  const cases = [
    ['unknown kind', configDoc({ kind: 'mystery' })],
    ['unknown frequency', configDoc({ frequency: 'fortnightly' })],
    ['empty label', configDoc({ label: '' })],
    ['negative amount', configDoc({ amount: -100 })],
    ['float amount', configDoc({ amount: 1800000.5 })],
    ['malformed effective date', configDoc({ effectiveFrom: '2025/01/01' })],
    ['end before start', configDoc({ effectiveFrom: '2025-06-01', effectiveTo: '2025-05-01' })],
    ['unknown extra field', { ...configDoc(), payGrade: 'A' }],
  ];
  for (const [label, payload] of cases) {
    await mustReject(label, setDoc(aliceConfig('inc_reject'), payload));
  }
});

test('an income config can be closed off and deactivated', async () => {
  // This is how a mid-month raise works: the old rate ends, a new one begins.
  await assertSucceeds(
    updateDoc(aliceConfig('inc_salary'), {
      effectiveTo: '2025-11-10',
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(
    updateDoc(aliceConfig('inc_salary'), { active: false, updatedAt: serverTimestamp() }),
  );
});

test("one account cannot touch another's income configs", async () => {
  await mustReject('cross-account config read', getDoc(aliceConfig('inc_salary', bob)));
  await mustReject('cross-account config write', setDoc(aliceConfig('inc_evil', bob), configDoc()));
});

/* ------------------------------------------------------------------ days */

function dayDocBody(overrides = {}) {
  return {
    date: '2025-11-04',
    off: false,
    allowancesReceived: ['inc_food'],
    note: '',
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const aliceDay = (id, db = alice) => doc(db, 'users', ALICE, 'shops', 'shop_one', 'days', id);

test('a day record is accepted and can be written again', async () => {
  // The id IS the date, so a second tap is an upsert on the same document
  // rather than a duplicate. Unlike an accrual this must keep working, which
  // is why a day record carries no immutable createdAt.
  await assertSucceeds(setDoc(aliceDay('2025-11-04'), dayDocBody()));
  await assertSucceeds(setDoc(aliceDay('2025-11-04'), dayDocBody({ off: true })));
  await assertSucceeds(
    setDoc(aliceDay('2025-11-04'), dayDocBody({ allowancesReceived: [] })),
  );
});

test('a day record cannot be deleted', async () => {
  await mustReject('deleting a day', deleteDoc(aliceDay('2025-11-04')));
});

test('day records are validated', async () => {
  const cases = [
    ['malformed id', ['2025-11-4', dayDocBody({ date: '2025-11-4' })]],
    ['non-date id', ['november', dayDocBody({ date: 'november' })]],
    ['date disagreeing with the id', ['2025-11-05', dayDocBody({ date: '2025-11-04' })]],
    ['off as a string', ['2025-11-06', dayDocBody({ date: '2025-11-06', off: 'yes' })]],
    [
      'allowances not a list',
      ['2025-11-07', dayDocBody({ date: '2025-11-07', allowancesReceived: 'inc_food' })],
    ],
    [
      'too many allowances',
      [
        '2025-11-08',
        dayDocBody({
          date: '2025-11-08',
          allowancesReceived: Array.from({ length: 21 }, (_, i) => `inc_${i}`),
        }),
      ],
    ],
    [
      'over-long note',
      ['2025-11-09', dayDocBody({ date: '2025-11-09', note: 'x'.repeat(201) })],
    ],
    [
      'unknown extra field',
      ['2025-11-10', { ...dayDocBody({ date: '2025-11-10' }), bonusDay: true }],
    ],
    [
      'client-chosen timestamp',
      ['2025-11-11', dayDocBody({ date: '2025-11-11', updatedAt: new Date(0) })],
    ],
  ];
  for (const [label, [id, payload]] of cases) {
    await mustReject(label, setDoc(aliceDay(id), payload));
  }
});

test("one account cannot touch another's attendance", async () => {
  await mustReject('cross-account day read', getDoc(aliceDay('2025-11-04', bob)));
  await mustReject('cross-account day write', setDoc(aliceDay('2025-11-12', bob), dayDocBody({ date: '2025-11-12' })));
});

/* ---------------------------------------------------------------- settlements */

test('the full seal sequence is permitted, in order', async () => {
  // create as `stamping` -> claim the entries -> flip to `sealed`. The rules
  // have to allow exactly this and nothing looser, because a statement that
  // called itself final before claiming its entries would be a lie.
  const id = 'set_sequence';
  const ref = doc(alice, 'users', ALICE, 'shops', 'shop_one', 'settlements', id);

  await assertSucceeds(
    setDoc(ref, {
      shopId: 'shop_one',
      periodStart: '2025-11-01',
      periodEnd: '2025-11-30',
      settlementDate: '2025-12-01',
      openingBalance: 0,
      closingBalance: 1800000,
      totals: { salary_earned: 1800000 },
      transactionCount: 1,
      statementNo: 2,
      sealState: 'stamping',
      status: 'sealed',
      notes: '',
      sealedAt: null,
      createdAt: serverTimestamp(),
    }),
  );

  const entryId = 'txn_to_stamp';
  await assertSucceeds(
    setDoc(aliceTxn(entryId), txnDoc({ transactionDate: '2025-11-04', recognitionDate: '2025-11-04' })),
  );
  await assertSucceeds(
    updateDoc(aliceTxn(entryId), { settlementId: id, updatedAt: serverTimestamp() }),
  );

  await assertSucceeds(updateDoc(ref, { sealState: 'sealed', sealedAt: serverTimestamp() }));

  // A stamped entry is frozen: it cannot be voided or edited any more.
  await mustReject(
    'voiding a settled entry',
    updateDoc(aliceTxn(entryId), {
      voidedAt: serverTimestamp(),
      voidReason: 'nope',
      updatedAt: serverTimestamp(),
    }),
  );
  await mustReject(
    'editing a settled entry',
    updateDoc(aliceTxn(entryId), { description: 'rewritten', updatedAt: serverTimestamp() }),
  );
});

test('a seal cannot be undone', async () => {
  const ref = doc(alice, 'users', ALICE, 'shops', 'shop_one', 'settlements', 'set_sequence');
  await mustReject('reopening a sealed statement', updateDoc(ref, { sealState: 'stamping' }));
  await mustReject(
    'sealing without a server timestamp',
    updateDoc(ref, { sealState: 'sealed', sealedAt: new Date(0) }),
  );
});

test('a settlement cannot be created already sealed', async () => {
  // Skipping `stamping` would mean a final statement whose entries were never
  // claimed, so nothing stops them being edited afterwards.
  await mustReject(
    'creating a settlement as sealed',
    setDoc(doc(alice, 'users', ALICE, 'shops', 'shop_one', 'settlements', 'set_cheat'), {
      shopId: 'shop_one',
      periodStart: '2025-11-01',
      periodEnd: '2025-11-30',
      settlementDate: '2025-12-01',
      openingBalance: 0,
      closingBalance: 0,
      totals: {},
      transactionCount: 0,
      statementNo: 9,
      sealState: 'sealed',
      status: 'sealed',
      notes: '',
      sealedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  );
});

test('a sealed settlement cannot be rewritten', async () => {
  const sealed = doc(alice, 'users', ALICE, 'shops', 'shop_one', 'settlements', 'set_sealed');
  await mustReject('editing a closing balance', updateDoc(sealed, { closingBalance: 0 }));
  await mustReject('editing notes', updateDoc(sealed, { notes: 'adjusted after the fact' }));
  await mustReject('editing a period', updateDoc(sealed, { periodEnd: '2025-11-30' }));
  await mustReject('deleting a statement', deleteDoc(sealed));
  // The one permitted change: a backdated entry marks the statement as needing
  // attention without altering a single figure on it.
  await assertSucceeds(updateDoc(sealed, { status: 'needs_reconciliation' }));
});

/* ------------------------------------------------------------------ reminders */

function reminderDoc(overrides = {}) {
  return {
    kind: 'custom',
    shopId: null,
    type: 'monthly',
    title: 'Pay the room rent',
    body: '',
    weekday: null,
    dayOfMonth: 5,
    onDate: null,
    time: '20:00',
    enabled: true,
    lastFiredAt: null,
    ...overrides,
  };
}

const aliceReminder = (id, db = alice) => doc(db, 'users', ALICE, 'reminders', id);

test('a reminder can be created, edited and removed', async () => {
  // The only collection in this app whose documents may be deleted: a reminder
  // holds no financial record, so losing one explains nothing away.
  await assertSucceeds(setDoc(aliceReminder('rem_rent'), reminderDoc()));
  await assertSucceeds(updateDoc(aliceReminder('rem_rent'), { enabled: false }));
  await assertSucceeds(deleteDoc(aliceReminder('rem_rent')));
});

test('an automatic reminder uses a fixed id, so it cannot be duplicated', async () => {
  await assertSucceeds(
    setDoc(
      aliceReminder('auto_month_ended'),
      reminderDoc({ kind: 'monthEnded', type: 'daily', dayOfMonth: null, title: 'The month is over' }),
    ),
  );
  // Writing it again is the same document — switching it on from a second
  // device must not leave two of them firing.
  await assertSucceeds(
    setDoc(
      aliceReminder('auto_month_ended'),
      reminderDoc({
        kind: 'monthEnded',
        type: 'daily',
        dayOfMonth: null,
        title: 'The month is over',
        time: '09:00',
      }),
    ),
  );
});

test('reminder fields are validated', async () => {
  const cases = [
    ['unknown type', reminderDoc({ type: 'hourly' })],
    ['unknown kind', reminderDoc({ kind: 'whenever' })],
    ['empty title', reminderDoc({ title: '' })],
    ['over-long title', reminderDoc({ title: 'x'.repeat(81) })],
    ['12-hour time', reminderDoc({ time: '8:00 pm' })],
    ['impossible time', reminderDoc({ time: '25:00' })],
    ['weekday out of range', reminderDoc({ type: 'weekly', weekday: 7, dayOfMonth: null })],
    ['day of month 0', reminderDoc({ dayOfMonth: 0 })],
    ['day of month 32', reminderDoc({ dayOfMonth: 32 })],
    ['malformed onDate', reminderDoc({ type: 'oneTime', onDate: '5-11-2025', dayOfMonth: null })],
    ['unknown extra field', { ...reminderDoc(), loud: true }],
    ['missing a required field', (() => { const { time: _drop, ...rest } = reminderDoc(); return rest; })()],
  ];
  for (const [label, payload] of cases) {
    await mustReject(label, setDoc(aliceReminder('rem_reject'), payload));
  }
});

test("one account cannot touch another's reminders", async () => {
  await assertSucceeds(setDoc(aliceReminder('rem_mine'), reminderDoc()));
  await mustReject('cross-account reminder read', getDoc(aliceReminder('rem_mine', bob)));
  await mustReject('cross-account reminder write', setDoc(aliceReminder('rem_theirs', bob), reminderDoc()));
  await mustReject('cross-account reminder delete', deleteDoc(aliceReminder('rem_mine', bob)));
});

/* ----------------------------------------------------------------- audit logs */

test('audit entries are append-only', async () => {
  const log = doc(alice, 'users', ALICE, 'auditLogs', 'log_one');
  await assertSucceeds(
    setDoc(log, {
      action: 'create',
      entity: 'shop',
      entityId: 'shop_one',
      summary: 'Created shop Blue Mart',
      at: serverTimestamp(),
    }),
  );
  await mustReject('editing a log entry', updateDoc(log, { summary: 'Something else entirely' }));
  await mustReject('deleting a log entry', deleteDoc(log));
  await mustReject(
    'an unknown audit action',
    setDoc(doc(alice, 'users', ALICE, 'auditLogs', 'log_bad'), {
      action: 'tamper',
      entity: 'shop',
      entityId: 'shop_one',
      summary: '',
      at: serverTimestamp(),
    }),
  );
});

/* ------------------------------------------------------ collection group query */

test('a cross-shop query must filter on the caller uid', async () => {
  await assertSucceeds(
    getDocs(query(collectionGroup(alice, 'transactions'), where('uid', '==', ALICE))),
  );
  await mustReject(
    'an unfiltered cross-shop query',
    getDocs(query(collectionGroup(alice, 'transactions'))),
  );
  await mustReject(
    "a cross-shop query for another account's uid",
    getDocs(query(collectionGroup(bob, 'transactions'), where('uid', '==', ALICE))),
  );
});

/* ----------------------------------------------------------- unknown surfaces */

test('a collection with no rules is unreachable', async () => {
  await mustReject(
    'writing to an undeclared subcollection',
    setDoc(doc(alice, 'users', ALICE, 'secrets', 'x'), { a: 1 }),
  );
  await mustReject('reading an undeclared root collection', getDoc(doc(alice, 'anythingElse', 'x')));
});
