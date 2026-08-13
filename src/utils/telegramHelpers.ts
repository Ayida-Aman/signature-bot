/**
 * Wraps Telegram API calls in an automatic retry loop to smoothly handle HTTP 429 (Too Many Requests) rate limits.
 */
export async function withAutoRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const errStr = error instanceof Error ? error.message : String(error);
      const is429 = errStr.includes("429") || error?.response?.body?.error_code === 429;

      if (is429 && attempt < maxRetries) {
        const retryAfter = error?.response?.body?.parameters?.retry_after || 1;
        console.warn(`⚠️ Telegram 429 Rate Limit (attempt ${attempt}/${maxRetries}). Waiting ${retryAfter + 0.5}s before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, (retryAfter + 0.5) * 1000));
        continue;
      }
      throw error;
    }
  }
  return await operation();
}
