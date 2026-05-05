/**
 * Stories 7.4 / 7.5 — Auth and subscription contracts.
 *
 * The actual sign-in flow (Apple, Google, magic-link email) and the
 * IAP / RevenueCat plumbing live in the React Native shell. This file
 * declares the JS-side contracts so the rest of the app (UI, engine
 * router context-aware gate, settings tree) can plumb them without
 * being coupled to the platform implementation.
 */

export type AuthProvider = 'apple' | 'google' | 'email-magic-link' | 'anonymous';

export interface AuthIdentity {
  provider: AuthProvider;
  /** Provider-issued user id; stable across sessions. */
  userId: string;
  email?: string;
  displayName?: string;
}

export interface AuthClient {
  /** Best-effort restore from cache (token in OS keychain). */
  restoreSession(): Promise<AuthIdentity | undefined>;
  /** Trigger a sign-in flow with the given provider. */
  signIn(provider: AuthProvider): Promise<AuthIdentity>;
  /** Drop credentials and forget the user. */
  signOut(): Promise<void>;
  /** Listen for auth state changes (token refresh, sign-out from other device). */
  onChanged(listener: (identity: AuthIdentity | undefined) => void): () => void;
}

export type SubscriptionTier = 'free' | 'pro';

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  /** Apple/Google product id, when subscribed. */
  productId?: string;
  /** Renewal cutoff (ms epoch); undefined for free tier. */
  expiresAt?: number;
  /** True if the trial period is active. */
  trial?: boolean;
  /** True if the user is in a grace period after billing failure. */
  grace?: boolean;
}

export interface SubscriptionClient {
  /** Re-fetch entitlements from the store. */
  refresh(): Promise<SubscriptionStatus>;
  /** Trigger the IAP purchase flow for a product id. */
  purchase(productId: string): Promise<SubscriptionStatus>;
  /** Restore prior purchases (App Store / Play Store). */
  restore(): Promise<SubscriptionStatus>;
  /** Subscribe to entitlement changes. */
  onChanged(listener: (status: SubscriptionStatus) => void): () => void;
  /** Current cached status; undefined before first refresh. */
  current(): SubscriptionStatus | undefined;
}
