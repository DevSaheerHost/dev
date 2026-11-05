/**
 * Drawing a statement onto a page.
 *
 * Nothing here decides a figure — `statement.ts` has already done that. This
 * module only places text, which is why the numbers can be trusted: there is
 * no second calculation to drift from the first.
 *
 * jsPDF is imported dynamically so the ~400 KB library and the embedded font
 * are fetched only when someone actually asks for a PDF, and never slow the
 * dashboard down.
 *
 * Tables are drawn by hand rather than with `jspdf-autotable`: one fewer
 * dependency, and full control over how a long description wraps.
 */

import type { jsPDF } from 'jspdf';

import { formatPaise, paise, type Paise } from '@/lib/money';

import { NOTO_SANS_BOLD_BASE64, NOTO_SANS_REGULAR_BASE64 } from './notoSansSubset';
import { statementTotals, type StatementDocument } from './statement';

function paiseSum(values: readonly Paise[]): Paise {
  return paise(values.reduce((total, value) => total + value, 0));
}

const FONT = 'NotoSans';
const MARGIN = 48;
const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE = 14;

/** Column positions for the itemised table, measured from the left margin. */
const COL_DATE = MARGIN;
const COL_DESC = MARGIN + 70;
const COL_AMOUNT = PAGE_WIDTH - MARGIN - 150;
const COL_BALANCE = PAGE_WIDTH - MARGIN;

/**
 * Registers the subsetted Noto Sans.
 *
 * jsPDF's built-in Helvetica has no U+20B9, so without this every amount would
 * print with a blank box where the rupee sign should be.
 */
function registerFont(doc: jsPDF): void {
  doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_BASE64);
  doc.addFont('NotoSans-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_BASE64);
  doc.addFont('NotoSans-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
}

interface Cursor {
  y: number;
  page: number;
}

function money(amount: Paise): string {
  return formatPaise(amount, { paise: true });
}

function newPageIfNeeded(doc: jsPDF, cursor: Cursor, needed: number): void {
  if (cursor.y + needed < PAGE_HEIGHT - MARGIN) return;
  doc.addPage();
  cursor.page += 1;
  cursor.y = MARGIN;
}

function rule(doc: jsPDF, cursor: Cursor, weight = 0.5): void {
  doc.setLineWidth(weight);
  doc.setDrawColor(190);
  doc.line(MARGIN, cursor.y, PAGE_WIDTH - MARGIN, cursor.y);
  cursor.y += 10;
}

function heading(doc: jsPDF, cursor: Cursor, text: string): void {
  newPageIfNeeded(doc, cursor, 40);
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(text.toUpperCase(), MARGIN, cursor.y);
  doc.setTextColor(20);
  cursor.y += LINE;
}

function summaryLine(
  doc: jsPDF,
  cursor: Cursor,
  label: string,
  amount: Paise,
  strong = false,
): void {
  newPageIfNeeded(doc, cursor, 24);
  doc.setFont(FONT, strong ? 'bold' : 'normal');
  doc.setFontSize(strong ? 11 : 10);
  doc.text(label, MARGIN, cursor.y);
  doc.text(money(amount), COL_BALANCE, cursor.y, { align: 'right' });
  cursor.y += strong ? LINE + 3 : LINE;
}

/** Draws one statement. Returns the cursor so a combined report can continue. */
function drawStatement(doc: jsPDF, statement: StatementDocument, cursor: Cursor): void {
  const totals = statementTotals(statement);

  // Header
  doc.setFont(FONT, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(statement.shopName, MARGIN, cursor.y);
  cursor.y += 20;

  doc.setFont(FONT, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  const subtitle =
    statement.statementNo > 0
      ? `Statement ${statement.statementNo} for ${statement.personName}`
      : `Draft statement for ${statement.personName} — not yet agreed`;
  doc.text(subtitle, MARGIN, cursor.y);
  cursor.y += LINE;
  doc.text(statement.periodLabel, MARGIN, cursor.y);
  cursor.y += LINE;
  doc.text(`Issued ${statement.settlementDateLabel}`, MARGIN, cursor.y);
  cursor.y += 18;
  doc.setTextColor(20);
  rule(doc, cursor, 1);

  // Summary
  summaryLine(doc, cursor, 'Balance brought forward', statement.openingBalance);
  cursor.y += 6;

  if (statement.earnings.length > 0) {
    heading(doc, cursor, 'Earned and spent for the shop');
    for (const line of statement.earnings) summaryLine(doc, cursor, line.label, line.amount);
    summaryLine(doc, cursor, 'Total added', totals.earned, true);
    cursor.y += 4;
  }

  if (statement.reductions.length > 0) {
    heading(doc, cursor, 'Received and deducted');
    for (const line of statement.reductions) summaryLine(doc, cursor, line.label, line.amount);
    summaryLine(doc, cursor, 'Total reduced', totals.reduced, true);
    cursor.y += 4;
  }

  rule(doc, cursor);
  summaryLine(doc, cursor, 'Balance outstanding', statement.closingBalance, true);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  newPageIfNeeded(doc, cursor, 24);
  doc.text(statement.closingSentence, MARGIN, cursor.y);
  doc.setTextColor(20);
  cursor.y += 20;

  if (statement.disturbedNote) {
    newPageIfNeeded(doc, cursor, 40);
    doc.setFontSize(9);
    doc.setTextColor(150, 80, 10);
    for (const line of doc.splitTextToSize(statement.disturbedNote, CONTENT_WIDTH) as string[]) {
      doc.text(line, MARGIN, cursor.y);
      cursor.y += 12;
    }
    doc.setTextColor(20);
    cursor.y += 8;
  }

  if (statement.notes) {
    newPageIfNeeded(doc, cursor, 40);
    doc.setFontSize(9);
    doc.setTextColor(90);
    for (const line of doc.splitTextToSize(statement.notes, CONTENT_WIDTH) as string[]) {
      doc.text(line, MARGIN, cursor.y);
      cursor.y += 12;
    }
    doc.setTextColor(20);
    cursor.y += 8;
  }

  // Itemised entries
  if (statement.rows.length > 0) {
    heading(doc, cursor, `Every entry (${statement.rows.length})`);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text('Date', COL_DATE, cursor.y);
    doc.text('What', COL_DESC, cursor.y);
    doc.text('Amount', COL_AMOUNT, cursor.y, { align: 'right' });
    doc.text('Balance', COL_BALANCE, cursor.y, { align: 'right' });
    doc.setTextColor(20);
    cursor.y += 6;
    rule(doc, cursor);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    for (const row of statement.rows) {
      const wrapped = doc.splitTextToSize(
        row.description,
        COL_AMOUNT - COL_DESC - 12,
      ) as string[];
      newPageIfNeeded(doc, cursor, wrapped.length * 12 + 8);

      doc.text(row.date, COL_DATE, cursor.y);
      doc.text(wrapped[0] ?? '', COL_DESC, cursor.y);
      doc.text(formatPaise(row.amount, { paise: true, signed: true }), COL_AMOUNT, cursor.y, {
        align: 'right',
      });
      doc.text(money(row.balance), COL_BALANCE, cursor.y, { align: 'right' });
      cursor.y += 12;

      for (const extra of wrapped.slice(1)) {
        doc.text(extra, COL_DESC, cursor.y);
        cursor.y += 12;
      }
    }
    cursor.y += 6;
    rule(doc, cursor);
  }

  // Footer note
  newPageIfNeeded(doc, cursor, 40);
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(
    'This is a statement of account, not a receipt. Money handed over is recorded separately.',
    MARGIN,
    cursor.y,
  );
  doc.setTextColor(20);
  cursor.y += 16;
}

async function createDoc(): Promise<jsPDF> {
  const { jsPDF: Constructor } = await import('jspdf');
  const doc = new Constructor({ unit: 'pt', format: 'a4', compress: true });
  registerFont(doc);
  return doc;
}

function stampPageNumbers(doc: jsPDF): void {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${page} of ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 24, {
      align: 'right',
    });
  }
}

/** A filename safe on every platform, derived from the shop and period. */
export function statementFilename(statement: StatementDocument): string {
  const shop = statement.shopName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const suffix = statement.statementNo > 0 ? `statement-${statement.statementNo}` : 'draft';
  return `${shop || 'shop'}-${suffix}.pdf`;
}

/** Renders one statement and hands it to the browser as a download. */
export async function downloadStatementPdf(statement: StatementDocument): Promise<void> {
  const doc = await createDoc();
  drawStatement(doc, statement, { y: MARGIN + 10, page: 1 });
  stampPageNumbers(doc);
  doc.save(statementFilename(statement));
}

/**
 * Renders every shop into one document, each starting on its own page, with a
 * combined total at the end.
 */
export async function downloadCombinedPdf(args: {
  readonly statements: readonly StatementDocument[];
  readonly personName: string;
  readonly dateLabel: string;
  /** Earned this month but not yet confirmed into entries, across all shops. */
  readonly unconfirmed: Paise;
}): Promise<void> {
  const { statements, personName, dateLabel, unconfirmed } = args;

  // Summed from the pages themselves rather than passed in. The screen's
  // headline figure includes salary earned so far this month, which is not yet
  // an entry and so cannot appear in any itemised list — printing it as the
  // total would leave a document that does not add up. It is stated separately
  // below instead.
  const net = paiseSum(statements.map((statement) => statement.closingBalance));
  const doc = await createDoc();
  const cursor: Cursor = { y: MARGIN + 10, page: 1 };

  doc.setFont(FONT, 'bold');
  doc.setFontSize(18);
  doc.text('Statement of accounts', MARGIN, cursor.y);
  cursor.y += 22;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`${personName} — ${dateLabel}`, MARGIN, cursor.y);
  cursor.y += 18;
  doc.setTextColor(20);
  rule(doc, cursor, 1);

  for (const [index, statement] of statements.entries()) {
    if (index > 0) {
      doc.addPage();
      cursor.page += 1;
      cursor.y = MARGIN + 10;
    }
    drawStatement(doc, statement, cursor);
  }

  doc.addPage();
  cursor.page += 1;
  cursor.y = MARGIN + 10;

  doc.setFont(FONT, 'bold');
  doc.setFontSize(14);
  doc.text('Across every shop', MARGIN, cursor.y);
  cursor.y += 22;
  rule(doc, cursor, 1);

  for (const statement of statements) {
    summaryLine(doc, cursor, statement.shopName, statement.closingBalance);
  }
  rule(doc, cursor);
  summaryLine(doc, cursor, 'Net outstanding', net, true);

  if (unconfirmed !== 0) {
    cursor.y += 6;
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    for (const line of doc.splitTextToSize(
      `A further ${formatPaise(unconfirmed, { paise: true })} has been earned this month but ` +
        'is not yet confirmed into entries, so it is not included above.',
      CONTENT_WIDTH,
    ) as string[]) {
      doc.text(line, MARGIN, cursor.y);
      cursor.y += 12;
    }
    doc.setTextColor(20);
  }

  stampPageNumbers(doc);
  doc.save(`statement-of-accounts-${dateLabel.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
}
