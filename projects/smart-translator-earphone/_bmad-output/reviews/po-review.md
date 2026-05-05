---
workflowType: 'review'
project_name: 'Smart Translator Earphone'
phase: 'pre-implementation'
agent: 'Sarah (Product Owner)'
date: '2026-05-05'
inputDocuments:
  - epics-and-stories.md
  - prd.md
  - architecture.md
  - project-context.md
---

# PO Review — Backlog Readiness

## 1. Method

The PO is the gatekeeper of "ready-for-development." Before pulling Epic 2 stories into a sprint, every story must satisfy the **INVEST** test (Independent, Negotiable, Valuable, Estimable, Small, Testable) and pass a **Definition of Ready** checklist:

- [ ] Has a user-or-system actor and a clear business outcome.
- [ ] Acceptance criteria are written in Given/When/Then form (already enforced in the doc).
- [ ] Has a size estimate (S/M/L/XL).
- [ ] Identifies its FR/NFR (already enforced).
- [ ] Identifies blocking dependencies.
- [ ] Has no unresolved open questions.

This review walks every story in `epics-and-stories.md`, marks status, and produces a backlog-ready ordering for Epic 2.

## 2. Story-by-story status

### Epic 1 — Audio Pipeline Foundation (7 stories)

| # | Title | INVEST | DoR | Status |
|---|-------|--------|-----|--------|
| 1.1 | AudioCaptureProvider interface | ✓ | ✓ | **shipped** in PR #1 |
| 1.2 | Frame buffer + chunker | ✓ | ✓ | **shipped** in PR #1 (with the utterance-boundary fix in PR #2) |
| 1.3 | VAD | ✓ | ✓ | **shipped** in PR #1 |
| 1.4 | Noise reduction | ✓ | ✓ | **shipped** in PR #1 (4-stage 100 Hz cascade; deviation from the original "1st-order Butterworth at 80 Hz" criterion is documented in `noise-reduction.ts` class docstring and meets the ≥18 dB-at-60-Hz acceptance bound) |
| 1.5 | Playback queue | ✓ | ✓ | **shipped** in PR #1 |
| 1.6 | Native iOS audio session | ✓ | ✓ | **skeleton** in PR #1; full implementation requires Xcode + a real iOS device. Deferred to a native-modules epic; not blocking pure-TS work. |
| 1.7 | Native Android audio session | ✓ | ✓ | **skeleton** in PR #1; deferred for the same reason. |

### Epic 2 — STT (5 stories)

| # | Title | INVEST | DoR | Notes / dependencies |
|---|-------|--------|-----|----------------------|
| 2.1 | STTProvider + Deepgram adapter | ✓ | ✓ | Depends on E1 audio types. **Ready.** Needs Deepgram credential at integration-test time only — pure-TS WS adapter can be unit-tested with a mock server. |
| 2.2 | Google Cloud STT adapter | ✓ | ✓ | gRPC → easier to start with REST/`@google-cloud/speech` lib. **Ready.** |
| 2.3 | On-device Whisper adapter | ✓ — but **size is wrong** | partial | Marked L (4–7 days). Real `whisper.cpp` integration on iOS+Android is closer to **XL** (>1 week) per the architecture's risk register. **Recommendation:** split into 2.3a (typed interface + mock adapter, S) and 2.3b (real native runtime + iOS/Android JNI bridges, XL — re-pointed to Stories 8.2 + 8.3). |
| 2.4 | Auto language detection | ✓ | ✓ | Depends on 2.1 or 2.2. **Ready** — gated on Whisper or Google (Deepgram doesn't support language ID per V-05). |
| 2.5 | Engine router policy + remote config | ✓ | ✓ | Depends on the *embedded* fallback table, **not** on the server side existing. Server-side KV is in Epic 11. **Ready** for client-only work. |

### Epic 3 — Translation (5 stories)

| # | Title | INVEST | DoR | Notes |
|---|-------|--------|-----|-------|
| 3.1 | MTProvider + DeepL adapter | ✓ | ✓ | **Ready.** |
| 3.2 | Google Cloud Translation adapter | ✓ | ✓ | **Ready.** |
| 3.3 | OpenAI GPT-4o-mini + rolling context | ✓ | ✓ | **Ready;** Pro feature. Needs explicit "context-window-eviction" rule in acceptance — currently the story says "rolling context window of the last 30 s" but doesn't say what happens when the user changes language pair mid-session. **Add to story:** "When the language pair changes, the context window is reset." |
| 3.4 | On-device NLLB-200 adapter | ✓ — but **size is wrong** | partial | Same shape as 2.3: typed interface (S) + native runtime (XL) split. |
| 3.5 | Translation pre-emption on partials | ✓ | ✓ | Depends on 2.1 (partial events) and 3.1 (one MT adapter). **Ready** after 2.1 + 3.1 land. |

### Epic 4 — TTS (4 stories)

| # | Title | INVEST | DoR | Notes |
|---|-------|--------|-----|-------|
| 4.1 | TTSProvider + ElevenLabs streaming | ✓ | ✓ | **Ready.** Cost flag from BA-04 — surface this as a feature flag. |
| 4.2 | Azure Neural TTS | ✓ | ✓ | **Ready.** |
| 4.3 | Apple AVSpeechSynthesizer + Android TextToSpeech | ✓ — partial | partial | These are **native-only** APIs; the TS adapter is just a typed shim. The native modules implementing them belong with Epic 1's native bridges. **Recommendation:** ship a TS shim with a "platform-default" placeholder and complete the native call in the iOS/Android native-modules epic. |
| 4.4 | TTS voice selection UI | ✓ | partial | Depends on the RN/Expo Bare shell which is not yet bootstrapped. **Blocked by Bootstrap-1.** |

### Epic 5 — Conversation Mode UI (5 stories)

All 5 are **blocked by Bootstrap-1** (RN/Expo Bare shell). They are otherwise INVEST-clean.

### Epic 6 — Lecture Mode UI (4 stories)

Same situation: **blocked by Bootstrap-1.**

### Epic 7 — User Mgmt & Settings (6 stories)

| # | Title | DoR | Notes |
|---|-------|-----|-------|
| 7.1 | SQLite + FTS5 store | ✓ | **Ready** — can ship as pure-TS module against `expo-sqlite` even before the RN shell exists, with a mock SQLite backend in tests. |
| 7.2 | History list + detail screens | partial | Blocked by Bootstrap-1. |
| 7.3 | Settings tree | partial | Blocked by Bootstrap-1. |
| 7.4 | Sign-in (Apple, Google, magic-link) | partial | Needs Epic 11 server endpoints and Apple/Google OAuth client IDs. **Blocked.** |
| 7.5 | Subscription mgmt | partial | Needs Apple StoreKit + Google Play Billing config that requires real developer accounts. **Blocked.** |
| 7.6 | Quick-launch widgets + Siri/Assistant | partial | Native-only; requires Bootstrap-1 + iOS/Android native-modules epic. |

### Epic 8 — Offline Mode (4 stories)

Already covered above; 8.2 + 8.3 are the **real** native-runtime stories that 2.3 + 3.4 hand off to.

### Epic 9 — Group Mode (4 stories)

| # | Title | Notes |
|---|-------|-------|
| 9.1 | Group session token + QR | TS-side QR generation is straightforward. **Server token endpoint is in Epic 11.** |
| 9.2 | QR scanner | Needs `expo-camera` → blocked by Bootstrap-1. |
| 9.3 | Cloudflare Durable Object relay | **Belongs to Epic 11.** |
| 9.4 | Group session paired UI | Blocked by Bootstrap-1. |

### Epic 10 — Performance, Privacy & Polish (8 stories)

10.1, 10.3, 10.5 are largely TS / CI work and can ship without the RN shell. 10.2 (battery), 10.4 (Sentry), 10.6 (onboarding polish), 10.7 (store assets), 10.8 (beta) all need the full app to exist.

## 3. Backlog-readiness verdict per epic

| Epic | Verdict |
|------|---------|
| E1 | DONE (1.1–1.5) + DEFERRED native (1.6, 1.7). |
| E2 | **READY for implementation** with the 2.3 split (interface now, runtime later). |
| E3 | **READY** with the 3.4 split. Add the context-window-reset clause to 3.3. |
| E4 | **READY** for 4.1, 4.2; 4.3 needs a native shim path; 4.4 blocked by Bootstrap-1. |
| E5 | BLOCKED by Bootstrap-1. |
| E6 | BLOCKED by Bootstrap-1. |
| E7 | 7.1 READY; the rest blocked by Bootstrap-1, Epic 11, or external accounts. |
| E8 | Native runtimes BLOCKED until iOS/Android native-modules epic is open; 8.4 blocked by Bootstrap-1. |
| E9 | 9.1 partially ready (client-side QR rendering); rest blocked by Epic 11 / Bootstrap-1. |
| E10 | 10.1 / 10.3 / 10.5 READY (instrumentation + CI lint + reconnect logic). |
| **E11 (NEW)** | Server-plane epic introduced by the PM review. Backlog-defined; not yet broken into stories. **Action: PO + PM to draft Epic 11 stories before its first sprint.** |

## 4. Recommended sprint sequence

A backlog-readiness ordering, optimized to keep one stream of pure-TS work moving while the RN/Expo Bare bootstrap unblocks the UI stream:

**Sprint A (TS-only):** 2.1 + 2.2 + 2.5 (mock+embedded fallback) + 7.1 (SQLite shim) + 10.3 (CI lint).

**Sprint B (TS-only):** 3.1 + 3.2 + 3.5 + 4.1 + 4.2 + 2.4 (after 2.2).

**Sprint C — Bootstrap-1:** create the React Native + Expo Bare shell into `app/`, wire `@core/audio/*` paths, restore Jest configuration, validate `npm run quality` still passes inside the shell.

**Sprint D (UI + native shim):** 5.1 → 5.5; 6.1 → 6.4; 7.2, 7.3.

**Sprint E (Server + offline runtime):** Epic 11 stories; 2.3b/8.2 native Whisper; 3.4b/8.3 native NLLB.

**Sprint F (Polish + beta):** 10.1, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8 + 9.* + 7.4, 7.5, 7.6.

## 5. Findings summary

- **Block-level:** 0 (the "Blocked" stories are blocked by orderable dependencies, not by missing requirements).
- **Warnings:** 4 — the size of 2.3 / 3.4 (split into a/b), the missing context-reset clause in 3.3, the missing server epic (now Epic 11), and the Bootstrap-1 prerequisite.
- **Info:** the rest.

## 6. Sign-off

- **Product Owner (Sarah):** approved the backlog with the Epic 11 + Bootstrap-1 + 2.3a/b + 3.4a/b refinements. 2026-05-05.
