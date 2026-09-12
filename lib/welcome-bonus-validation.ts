export const MAX_WELCOME_BONUS_CREDITS = 1_000_000;

export type WelcomeBonusAmountResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function parseWelcomeBonusCreditAmount(
  raw: unknown
): WelcomeBonusAmountResult {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_WELCOME_BONUS_CREDITS
  ) {
    return {
      ok: false,
      error: `creditAmount must be an integer between 0 and ${MAX_WELCOME_BONUS_CREDITS}.`,
    };
  }
  return { ok: true, value };
}

/** Fail closed for malformed or out-of-policy values read from the database. */
export function normalizeWelcomeBonusCreditAmount(raw: unknown): number {
  const result = parseWelcomeBonusCreditAmount(raw);
  return result.ok ? result.value : 0;
}
