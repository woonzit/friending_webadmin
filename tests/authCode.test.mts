import test from "node:test";
import assert from "node:assert/strict";
import {
  isVerificationCodeComplete,
  normalizeVerificationCode,
  VERIFICATION_CODE_DIGITS,
} from "../lib/authCode.ts";

test("admin verification codes use six ASCII digits", () => {
  assert.equal(VERIFICATION_CODE_DIGITS, 6);
  assert.equal(isVerificationCodeComplete("012345"), true);
  assert.equal(isVerificationCodeComplete("1234"), false);
  assert.equal(isVerificationCodeComplete("1234567"), false);
  assert.equal(isVerificationCodeComplete("１２３４５６"), false);
});

test("admin verification-code input removes non-digits and caps at six", () => {
  assert.equal(normalizeVerificationCode("12a 34-5678"), "123456");
  assert.equal(normalizeVerificationCode("１２3456"), "3456");
});
