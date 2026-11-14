import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import process from "node:process";

function isMatchingApiKey(provided, expected) {
  if (
    typeof provided !== "string" ||
    typeof expected !== "string" ||
    !expected
  ) {
    return false;
  }
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Protect backend API routes with the configured shared API key.
 * @param {Function} getApiKey Retrieves the current key without retaining a stale environment value.
 * @returns {Function} Express middleware accepting x-api-key or Bearer credentials.
 */
export function createApiKeyMiddleware(getApiKey = () => process.env.API_KEY) {
  return (req, res, next) => {
    const provided =
      req.header("x-api-key") ||
      req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const expected = getApiKey();
    if (!isMatchingApiKey(provided, expected)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };
}
