# Reconciliation decision — Phase R review meets PR #18

**Date:** 2026-05-05
**Author:** Multi-role BMAD synthesis (BA / PM / PO / SM)
**Trigger:** PR #18 (`2f70dcee`) — *"build working app with STT, translation, TTS, and UI (Epics 2-5)"* — merged into `main` from a parallel Devin session while the Phase R-driven implementation stack (PRs #4–#17) was open. This document records the reconciliation decision applied to the open PR stack.

## 1. Situation

Two implementations of the Smart Translator Earphone product were authored in parallel:

| | Stack A — Phase R driven (this session) | Stack B — PR #18 (parallel session) |
|---|---|---|
| **Style** | Pure-TS provider abstraction layer; no UI shell | Full Expo + UI + runtime engines |
| **PR shape** | 16 stacked PRs (#2–#17), 56→448 tests | 1 squash-merged PR (#18), 77 tests |
| **Epic 1 (audio)** | `core/audio/` — utterance-boundary fix in PR #2 | Imports unchanged Epic 1; adds `expo-audio-capture`, `web-audio-capture`, `expo-audio-playback`, `platform-audio-factory` |
| **Epic 2 (STT)** | `Deepgram` (WS), `Google` (REST), `LanguageDetectionPolicy`, `EmbeddedFallbackPolicy`, `CircuitBreaker`, typed `SttEvent` discriminated union | `WhisperCloud`, `Google`, `MockStt`, vote-locked language detector, recoverable-error fallback router |
| **Epic 3 (MT)** | `DeepL`, `Google`, `OpenAI` (streaming), `TranslationOrchestrator` with mid-stream pre-emption | `DeepL`, `OpenAI`, `Google`, `Mock`, LRU cache, `AsyncIterable` streaming variant |
| **Epic 4 (TTS)** | `ElevenLabs`, `Azure`, `NativeTtsProvider` bridge, `VoiceCatalog`, `PlaybackOrchestrator` callback API | `Azure` (SSML), `Google`, `MockTts` (sine-wave tone burst); voice settings (gender / speed / pitch) |
| **Epic 5 (conversation)** | `ConversationController` orchestrator with state machine + per-stage rolling latency tracking | `SessionStore` (event emitter) + `useSessionStore` hook; in-screen state |
| **Epic 6 (lecture)** | `LectureViewModel` + `exportLecture(turns, 'txt' \| 'md')` | `LectureScreen.tsx` (transcript display only — no export) |
| **Epic 7 (store / history / settings)** | `LocalStore` interface + `InMemoryStore` (FTS5-shaped search), `HistoryViewModel`, typed `AppSettings` tree, `SettingsManager` | `SettingsScreen.tsx` (UI only, no persistence layer); `HistoryScreen.tsx` (UI only) |
| **Epic 8 (offline)** | `ConnectivityTracker` + `PackManager` (single-flight DL state machine) | (none) |
| **Epic 9 (group)** | Invite-token generator + join-URL parser + `GroupViewModel` | (none) |
| **Epic 10 (telemetry / crash / resilience / privacy / onboarding)** | `BufferedTelemetrySink`, `NullCrashReporter`, `withRetry` + `CircuitBreaker`, `OnboardingManager`, no-audio static check | (none) |
| **Epic 11 (server plane)** | `GroupRelayChannel` (DO state machine), `SessionStore` (KV), `validateBatch` ingest validator | (none) |
| **Bootstrap (RN/Expo)** | (deferred) | Done — `app.json`, `babel.config.js`, `metro.config.js`, `index.js`, `App.tsx`, `react-native-web` |

## 2. Four-role review

### BA — value (Mary)

- Stack B ship được **runnable user-facing product**: `npx expo start --web` chạy ngay, demo mode hoạt động không cần API key. Đây là outcome cao giá trị nhất cho người dùng cuối ở thời điểm này.
- Stack A ship **architecture rigor**: provider abstraction để lock-in tránh vendor coupling, embedded fallback policy có chính sách tách biệt khỏi router, telemetry validator backstop để bảo vệ privacy guarantee, server plane (Epic 11) cho group session.
- Cả hai đều có giá trị, nhưng **value-per-merge-cost** thấp ở overlap (Epic 2-5: kiến trúc khác nhưng cùng functionality), cao ở phần unique (Epic 6-11: Stack B không cover).
- **Khuyến nghị:** Giữ lại unique value (Epic 6-11) từ Stack A; chấp nhận Stack B làm runtime cho Epic 2-5.

### PM — PRD coverage (John)

| FR / NFR | Stack B (merged) | Stack A — unique gap-fill |
|---|---|---|
| FR-1 dual-direction translate | ✅ | (overlap) |
| FR-2 conversation/lecture mode | partial (UI + basic flow) | conversation: latency tracking; lecture: export |
| FR-3 group mode | ❌ | ✅ (Epic 9 + Epic 11.3 server) |
| FR-4 lecture export | ❌ | ✅ (Epic 6.4) |
| FR-5 offline pack management | ❌ | ✅ (Epic 8.1 + 8.4) |
| NFR-Privacy (telemetry no-audio) | ❌ | ✅ (Story 10.2) |
| NFR-Resilience (retry / circuit-breaker) | ❌ | ✅ (Story 10.4) |
| NFR-Server (relay / ingest validator) | ❌ | ✅ (Epic 11) |
| Onboarding / settings tree | partial (UI screens only) | ✅ (Story 10.5 + 7.3 — full state + persistence) |

PR #18 cover ~50% PRD; phần còn lại (FR-3, FR-4, FR-5, NFR-Privacy, NFR-Resilience, server plane, onboarding state machine, settings tree, history persistence) đúng là phần **Stack A unique value**. Đóng Stack A toàn bộ sẽ thiếu hơn nửa PRD.

### PO — Definition of Ready (Sarah)

- Stack A's PR #4-#10 (Epic 2-5) duplicate functionality với PR #18: cùng provider list, cùng router orchestration, khác abstraction shape. Conflict resolution = re-architecting PR #18's runtime layer = high cost / low value.
- Stack A's PR #11-#17 (Epic 6-11): module path không trùng (`core/lecture/`, `core/store/`, `core/connectivity/`, `core/group/`, `core/telemetry/`, `core/crash/`, `core/onboarding/`, `core/privacy/`, `server/`). Không conflict trực tiếp — chỉ cần extract một vài data types (`TurnPair`, `TurnSide`, `EngineTransparency`) ra module riêng.
- DoR unaffected for PR #11-#17 — story acceptance criteria + test coverage không phụ thuộc Stack A's STT/MT/TTS provider implementations.

### SM — sequencing (Bob)

- Conflict resolution effort estimate:
  - PR #4-#10 onto current main: **HIGH** (3-5 days). Same files, different shapes. Net effect ~= rewriting PR #18.
  - PR #11-#17 onto current main: **MEDIUM** (1-2 days). Module paths disjoint. Need: extract shared types, drop transitive imports, validate quality on each rebased branch.
- Time-to-completion + delivered PRD coverage best maximized by:
  - **Closing** PR #4-#10 (overlap; PR #18 owns Epic 2-5 runtime)
  - **Rebasing** PR #11-#17 onto main as standalone PRs (each adds its own minimal types)

## 3. Decision

**Option C-prime — accept PR #18 as Epic 2-5 source of truth; rebase PR #11-#17 onto main as gap-fill PRs.**

| PR | Decision | Rationale |
|----|----------|-----------|
| #2 (audio utterance-boundary fix) | **Merge** | No conflict; value to both stacks; bug fix on Epic 1 (which both stacks share). |
| #3 (Phase R review + roadmap) | **Merge** | Meta-doc; no conflict; documents the FR-3/FR-4/FR-5/NFR/Server gaps that justify keeping PR #11-#17. This file is added to PR #3 as the reconciliation record. |
| #4 (Epic 2 STT — Deepgram + Google) | **Close** | Functionality covered by PR #18's `WhisperCloud + Google + Mock + STT engine router`. Architecture rigor of Stack A's `SttProvider` interface, `LanguageDetectionPolicy`, `EmbeddedFallbackPolicy`, `CircuitBreaker` is documented in `roadmap.md` §6 + this file §1; can be reintroduced as a refactor PR if/when team prioritises. |
| #5 (Epic 2 engine router + lang-detect) | **Close** | Same — PR #18 has its own router. |
| #6 (Epic 3 MT — DeepL + Google) | **Close** | PR #18 has DeepL + OpenAI + Google + Mock. |
| #7 (Epic 3 GPT + pre-emption) | **Close** | PR #18 has OpenAI streaming with `AsyncIterable`. Pre-emption (mid-stream abort on new audio) is a Stack A unique behaviour; if needed, split as a separate refactor against PR #18's `TranslationRouter`. |
| #8 (Epic 4 TTS — ElevenLabs + Azure) | **Close** | PR #18 has Azure + Google + Mock. ElevenLabs is a *Premium-tier* provider per `roadmap.md` §8 — owner can add it back as a follow-up against PR #18's `tts-engine-router`. |
| #9 (Epic 4 native bridge + voice catalog + playback orchestrator) | **Close** | PR #18 has voice settings + Mock playback. NativeTtsProvider bridge belongs to the native sprint (deferred per roadmap §4). |
| #10 (Epic 5 ConversationController) | **Close** | PR #18 has `SessionStore` event emitter that drives the conversation flow end-to-end. Stack A's `ConversationController` adds rolling-latency tracking + state-machine — can be reintroduced as `core/session/transparency.ts` add-on against PR #18. |
| #11 (Epic 6 lecture view-model + export) | **Rebase onto main** | Unique gap (FR-4). Module path `core/lecture/` does not overlap PR #18. Extract `TurnPair` types into `core/lecture/lecture-types.ts` so it doesn't depend on closed PR #10. |
| #12 (Epic 7 LocalStore + history + settings tree + account) | **Rebase onto main** | Unique gap (FR-2 history persistence + NFR-Settings + account contracts). Module path `core/store/`, `core/history/`, `core/settings/`, `core/account/` does not overlap PR #18. |
| #13 (Epic 8 connectivity + pack manager) | **Rebase onto main** | Unique gap (FR-5 offline). |
| #14 (Epic 9 group session primitives) | **Rebase onto main** | Unique gap (FR-3). Will need `TurnPair` types from PR #11's extraction. |
| #15 (Epic 10 telemetry + crash + resilience + onboarding) | **Rebase onto main** | Unique gaps (NFR-Telemetry + NFR-Resilience + onboarding state). |
| #16 (Story 10.2 privacy / no-audio static check) | **Rebase onto main** | Unique gap (NFR-Privacy). Static check scans codebase regardless of which Stack 2-5 was chosen; will skip PR #18's audio modules per its skip-list logic. |
| #17 (Epic 11 server plane) | **Rebase onto main** | Unique gap (entire server plane missing). Depends on PR #14's group types. |

## 4. Carry-forward register

Issues from Stack A that PR #18 does not yet implement and which should be re-prioritised against the merged main:

| Item | Source | Recommendation |
|---|---|---|
| Translation pre-emption (abort mid-stream when new audio arrives) | Story 3.5 / PR #7 | Add as `TranslationRouter` extension PR against main (post-merge). |
| Stable `SttErrorCode` taxonomy + vendor-error mapping | Story 2.1 / PR #4 | Re-introduce against PR #18's `stt-types.ts` as a follow-up; helps observability. |
| `PlaybackOrchestrator` callback API (decoupling synthesis from queueing) | Story 4.5 / PR #9 | Re-introduce against PR #18's `tts-engine-router` if/when native shells need explicit playback queue control. |
| `EmbeddedFallbackPolicy` (cloud → cloud, online → offline) | Story 2.5 / PR #5 | Re-introduce as a separate policy module that wraps PR #18's `STT/Translation/TTS` engine routers; do not fold into router itself (separation of concerns). |
| `CircuitBreaker` for vendor failures | Story 10.4 / PR #15 | Already landing as part of PR #15 rebase — wrap PR #18's engine routers post-merge. |
| `NativeTtsProvider` bridge (Story 4.3a) | Story 4.3a / PR #9 | Land in native sprint (deferred); PR #18's `Mock` + Azure + Google adequate until then. |
| ElevenLabs as Premium-tier TTS | Story 4.1 / PR #8 | Add as a 3-line provider plug-in against PR #18's `tts-engine-router` when paid tier is enabled. |

## 5. Sign-off

- **BA (Mary):** Approves. Value retained > value forfeited.
- **PM (John):** Approves. PRD coverage maximised within available reconciliation budget.
- **PO (Sarah):** Approves. DoR unaffected for retained PRs.
- **SM (Bob):** Approves. Sequencing favours independent (non-stacked) PRs against current main; CI / quality scope unchanged.

This decision is the source of truth for the action being taken on PR #4-#17.
