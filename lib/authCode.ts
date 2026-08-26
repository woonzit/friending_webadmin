export const VERIFICATION_CODE_DIGITS = 6;

export function normalizeVerificationCode(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, VERIFICATION_CODE_DIGITS);
}

export function isVerificationCodeComplete(value: string): boolean {
  return new RegExp(`^[0-9]{${VERIFICATION_CODE_DIGITS}}$`).test(value);
}
