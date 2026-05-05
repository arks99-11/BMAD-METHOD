/**
 * Public surface of the core/resilience module (Story 10.4).
 */

export { withRetry, type RetryOptions } from './retry';
export {
  CircuitBreaker,
  type BreakerState,
  type CircuitBreakerOptions,
} from './circuit-breaker';
