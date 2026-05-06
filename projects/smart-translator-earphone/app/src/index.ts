/**
 * Top-level barrel export of the platform-agnostic core.
 *
 * The Expo app shell (App.tsx + screens) imports from here. Native iOS /
 * Android modules and any future web-only shell can also import from here.
 */

export * from './core/audio';
export * from './core/stt';
export * from './core/translation';
export * from './core/tts';
export {
  EngineRouter,
  type EngineEvent,
  type EngineEventListener,
  type EngineRouterOptions,
  type SessionStatus,
} from './core/engine-router';
export { createEngineRouter, type EngineFactoryOptions } from './core/engine-factory';
export { DEFAULT_CONFIG, type AppConfig } from './config';
export * from './core/session';
export * from './core/lecture';
export * from './core/store';
export * from './core/history';
export * from './core/settings';
export * from './core/account';
export * from './core/connectivity';
export * from './core/packs';
export * from './core/group';
export * from './core/telemetry';
export * from './core/crash';
export * from './core/resilience';
export * from './core/onboarding';
