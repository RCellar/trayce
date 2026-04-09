import { timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return crypto.randomUUID();
}

export function validateToken(provided: unknown, expected: unknown): boolean {
  const providedIsValid = typeof provided === "string" && provided.length > 0;
  const expectedIsValid = typeof expected === "string" && expected.length > 0;

  if (!expectedIsValid) {
    return false;
  }

  const expectedBuf = Buffer.from(expected as string, "utf8");

  if (!providedIsValid) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  const providedBuf = Buffer.from(provided as string, "utf8");

  if (providedBuf.length !== expectedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
