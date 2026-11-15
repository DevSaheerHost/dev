/** Errors safe to show to users. Anything else is logged and reported generically. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const forbidden = (message = "You don't have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (what = "Record") => new AppError(404, "not_found", `${what} not found.`);
export const invalid = (message: string) => new AppError(400, "invalid_input", message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

const STATUS: Record<string, number> = {
  approval_required: 403, forbidden: 403, insufficient_stock: 409, insufficient_batch_stock: 409, stale_observation: 409,
  idempotency_conflict: 409, product_archived: 409, invalid_quantity: 400, invalid_location: 400, batch_not_found: 404,
};

/** Convert a stock-engine plan error into an AppError. */
export function planError(code: string, message: string): AppError {
  const friendly: Record<string, string> = {
    stale_observation: "Stock changed after this count was taken, so it wasn't applied. Count again to be safe.",
    insufficient_stock: "Not enough stock recorded to remove that many. Do a stock count instead.",
  };
  return new AppError(STATUS[code] ?? 400, code, friendly[code] ?? message);
}
