// Retry logic with exponential backoff

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  onRetry: () => {},
};

const RATE_LIMIT_BASE_DELAY = 5000;
const RATE_LIMIT_MAX_DELAY = 60000;
const RATE_LIMIT_MAX_RETRIES = 4;

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: Error = new Error('Unknown error');

  const maxAttempts = opts.maxRetries;
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on certain errors
      if (isNonRetryableError(lastError)) {
        throw lastError;
      }

      const isRateLimit = isRateLimitError(lastError);
      const effectiveMaxRetries = isRateLimit ? Math.max(opts.maxRetries, RATE_LIMIT_MAX_RETRIES) : opts.maxRetries;

      if (attempt < effectiveMaxRetries) {
        const base = isRateLimit ? RATE_LIMIT_BASE_DELAY : opts.baseDelay;
        const cap = isRateLimit ? RATE_LIMIT_MAX_DELAY : opts.maxDelay;
        const delay = Math.min(base * Math.pow(2, attempt), cap);
        
        opts.onRetry(attempt + 1, lastError);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isNonRetryableError(error: Error): boolean {
  // Always retry rate limit errors
  if (isRateLimitError(error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  
  // Don't retry auth errors
  if (message.includes('api key') || message.includes('unauthorized') || message.includes('401')) {
    return true;
  }
  
  // Don't retry validation errors
  if (message.includes('invalid') || message.includes('400')) {
    return true;
  }

  return false;
}

export function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return message.includes('429') || message.includes('rate limit') || message.includes('too many requests') || message.includes('resource_exhausted');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
