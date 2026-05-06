---
workflowType: 'roadmap'
project_name: 'Smart Translator Earphone'
phase: 'pre-implementation'
date: '2026-05-05'
inputDocuments:
  - reviews/ba-review.md
  - reviews/pm-review.md
  - reviews/po-review.md
  - reviews/sm-review.md
  - epics-and-stories.md
  - prd.md
  - architecture.md
---

# Implementation Roadmap

This roadmap is the **executable summary** of the four BMAD review docs. The reviews surface findings; this document turns them into ordered work, PRs, and acceptance gates.

## 1. State of Play

- **PR #1** — `feat(projects): add smart-translator-earphone BMAD project (Phase 1-4)` — merged. 41 files. All Phase 1–3 artifacts plus Epic 1 stories 1.1–1.5 (TS) and 1.6/1.7 (native skeletons).
- **PR #18** — `build working app with STT, translation, TTS, and UI (Epics 2-5)` — merged in parallel with the original Phase R stack. Provides a runnable Expo shell with cloud STT/MT/TTS providers + Conversation/Lecture/History/Settings screens (different architecture from Phase R; see [`reviews/reconciliation-decision.md`](reviews/reconciliation-decision.md)).
- **Phase R consolidated PR** (this roadmap branch) — single PR replacing the original 16-PR stack. Bundles Epic 6 (lecture), Epic 7 (store/history/settings/account), Epic 8 (connectivity/packs), Epic 9 (group), Epic 10 (telemetry/crash/resilience/onboarding/privacy), Epic 11 (server plane), plus the audio-pipeline fix and the BMAD review docs. 252 Jest tests pass locally.
- **GitHub Actions on the fork** is currently disabled. CI does not run on PRs until the user enables Actions at `https://github.com/arks99-11/BMAD-METHOD/settings/actions`. Local `npm run quality` is the source of truth in the meantime.

## 2. Plan At A Glance

```
Stream A — Engines       │ Stream B — Persistence  │ Stream C — Server
(TS, no shell)           │ (TS, no shell)          │ (Cloudflare Workers)
─────────────            │ ────────────            │ ──────────────
S1: 2.1 Deepgram         │ S1: 7.1 SQLite shim     │ S2: skeleton (`server/`)
S1: 2.2 Google STT       │ S1: 10.3 CI lint        │ S3: 11.1 WS gateway
S1: 2.5 router (embed)   │                         │ S3: 11.2 KV policy
S2: 3.1 DeepL                                      │ S6: 11.3 group relay
S2: 3.2 Google MT                                  │ S8: 11.4 PostHog ingest
S2: 3.5 pre-emption
S2: 4.1 ElevenLabs (flagged)
S2: 4.2 Azure
S2: 2.4 auto-detect

Stream D — RN shell + UI │ Stream E — Native modules
─────────────            │ ─────────────
S3: Bootstrap-1          │ S6: 1.6 iOS native AVAudioSession
S3: 5.1 home             │ S6: 1.7 Android native AudioSession
S4: 5.2/5.3/5.4/5.5      │ S7: 4.3 native TTS
S4: 4.4 voice picker     │ S7: 8.2 whisper.cpp on-device
S5: 6.1–6.4 lecture      │ S7: 8.3 NLLB-200 on-device
S5: 7.2 history list     │ S7: 8.1 language pack downloader
S5: 7.3 settings tree    │ S7: 8.4 offline UI
S5: 10.6 onboarding      │
S8: 9.1–9.4 group        │
S8: 7.4 sign-in          │
S9: 7.5 subscriptions    │
S9: 7.6 quick launch     │
S9: 10.4 Sentry          │
S9: 10.5 net resilience  │
S9: 10.2 battery         │
S10: 10.7 store assets   │
S10: 10.8 beta release   │
```

Calendar estimate: **9–10 sprints of ~2 weeks** with two engineers. The brief's "~3 month MVP" is achievable only by descoping E6 (lecture) **or** E9 (group) to a fast-follow.

## 3. Open Items From the Review Pass

| ID | Source | Item | Decision | Tracked in |
|----|--------|------|----------|-----------|
| BA-04 | BA review | Pro-tier blended cost is closer to USD 0.10–0.20/min than 0.05–0.15/min when ElevenLabs is the default. | **Decision:** Pro defaults to Azure Neural TTS. ElevenLabs becomes a "Premium voice" upgrade gated by an additional flag. | Story 4.1 acceptance updated. |
| BA-06 | BA review | `300M TWS units/year` is not the addressable installed base after the iOS 15+ / Android 10+ / 3 GB RAM constraints are applied. | Roadmap note only; no code change. | §Risk-Market |
| BA-09 | BA review | Anthropic Claude is in the technical-research comparison but is not routed by ADR-004. | One-line note added to technical-research §3.1 in a future doc pass. | §Doc-debt |
| BA-11 | BA review | Product brief Risks table is not cross-referenced from the validation doc. | Doc pass; no code change. | §Doc-debt |
| PM-warn-1 | PM review | PRD §10 lists FR-3 as `E5, E9` but FR-3 group-mode UI is owned entirely by E9.4. | Roadmap is the single source of truth for the corrected mapping. The PRD may be amended in a future doc pass; not a blocker. | §FR-mapping |
| PM-warn-2 | PM review | FR-8 cross-epic hand-off (2.3 ↔ 8.2, 3.4 ↔ 8.3) is not obvious from the doc. | Roadmap explicitly orders these. Stories will be split a/b in the implementation PRs. | §Story-splits |
| PM-warn-3/4/5 | PM review | Server plane (Cloudflare Workers, KV, PostHog) is named in stories but has no epic. | **Epic 11 — Server Plane** is added. Stories drafted below. | §Epic 11 |
| PO-warn-1 | PO review | Stories 2.3 and 3.4 are sized L; real native runtime is closer to XL each. | Split each into `a` (interface, S) and `b` (native runtime, XL). The `a` halves run in Stream A; the `b` halves run in Stream E. | §Story-splits |
| PO-warn-2 | PO review | Story 3.3 (GPT-4o-mini) lacks a context-window-reset rule when language pair changes mid-session. | Added to story acceptance: "When the active language pair changes, the rolling context window is reset." | Story 3.3 acceptance updated. |
| PO-warn-3 | PO review | RN/Expo Bare shell does not yet exist — blocks every UI epic. | **Bootstrap-1** is the next major piece of work after Stream A's first sprint. | §Bootstrap-1 |
| SM-1 | SM review | RN/Expo Bare bootstrap may conflict with existing strict-TS audio module config. | Run Bootstrap-1 in a throwaway branch first; deliberate merge of `tsconfig.json` / `package.json` / `babel.config.js`. | §Bootstrap-1 |

## 4. Story Splits (`a` / `b`)

| Original | Split | Stream | Estimate | Acceptance handoff |
|----------|-------|--------|----------|---------------------|
| 2.3 On-device Whisper adapter | **2.3a** Typed `STTProvider` shim + mock adapter | A | S | Provides a deterministic, in-memory STT used by tests for E5/E6 UI. |
|  | **2.3b** Real `whisper.cpp` native runtime + iOS/Android JNI bridges + memory profile on Pixel 6a | E | XL | Folds into Story 8.2's acceptance gate (≤200 MB peak). |
| 3.4 On-device NLLB-200 | **3.4a** Typed `MTProvider` shim + mock adapter | A | S | Similar — deterministic adapter for tests. |
|  | **3.4b** Real native NLLB-200 600M int8 runtime + lazy loading + 5-min idle freeing | E | XL | Folds into Story 8.3's acceptance. |
| 4.3 Apple/Android TTS | **4.3a** Typed `TTSProvider` shim that delegates to `Platform.OS`-resolved native | A | S | Stub returns silence in tests; native path returns real audio. |
|  | **4.3b** Native `AVSpeechSynthesizer` / `TextToSpeech` modules | E | M | Folds into iOS/Android native-module sprint. |

## 5. Bootstrap-1 — Spec

**Goal.** Add the React Native + Expo Bare shell to `app/` without breaking the existing pure-TS `core/audio/*` module.

**Steps.**

1. In a scratch branch, run `npx create-expo-app -t expo-template-bare-typescript bootstrap-tmp/`.
2. Copy `bootstrap-tmp/`'s `babel.config.js`, `metro.config.js`, `app.json`, `eas.json` (skeleton), `index.js`, `App.tsx` into `app/`. **Do not** copy its `tsconfig.json`, `package.json`, or `src/`.
3. **Merge** `bootstrap-tmp/package.json`'s `dependencies` and `devDependencies` into `app/package.json` (the bare template adds `expo`, `react`, `react-native`, `expo-status-bar`, etc.). Keep our existing scripts (`typecheck`, `lint`, `test`, `quality`).
4. **Merge** `bootstrap-tmp/tsconfig.json` into `app/tsconfig.json` — preserve `strict: true`, our `paths` config (`@core/*`), and our existing `compilerOptions`. The Expo template extends `expo/tsconfig.base`; that's compatible.
5. Generate `app/ios/` and `app/android/` directories via `npx expo prebuild` once the JS package is reconciled.
6. Modify `App.tsx` to import the audio core and render a placeholder UI:

   ```tsx
   import { AudioPipeline, MockAudioCaptureProvider } from '@core/audio';
   ```

7. Run `npm install`, `npm run typecheck`, `npm run lint`, `npm run test`. **All 58 Jest tests must continue to pass.** Run `npm run quality` to confirm prettier + eslint + jest are all green.
8. Verify `npx expo start` runs without errors against the iOS simulator and Android emulator (this is a manual verification).

**Acceptance.**

- `app/App.tsx`, `app/index.js`, `app/app.json`, `app/babel.config.js`, `app/metro.config.js` exist.
- `app/ios/` and `app/android/` are present and added to `.gitignore` where appropriate (e.g. `**/Pods/`, `**/build/`, `**/Podfile.lock`).
- `npm run quality` from `app/` passes.
- `npm run quality` from the repo root passes.
- README.md updated to mention the shell.

## 6. Epic 11 — Server Plane

| Story | Title | Estimate | Acceptance |
|-------|-------|----------|------------|
| 11.1 | Cloudflare Workers WS gateway skeleton | M | `wrangler dev` accepts a WebSocket connection, echoes a handshake, terminates cleanly. No vendor wiring yet. |
| 11.2 | Engine-router policy KV | S | A KV namespace `policy` holds the JSON shape `{ "EN→ES": {...}, ... }`. The Worker exposes `GET /policy` and returns it; ETag-cached. |
| 11.3 | Group-mode Durable Object relay | M | `POST /sessions/group` issues a JWT; the Durable Object accepts a 2nd peer and forwards JSON deltas; max-30-min timeout; per-message size cap. |
| 11.4 | PostHog ingestion path (opt-in) | S | The Worker exposes `POST /telemetry` that forwards to PostHog only when the body's `optIn === true`. |
| 11.5 | CI pipeline (server) | S | `npm run --workspace server typecheck && lint && test`. GitHub Actions workflow `server-quality.yaml` mirrors it. |

The server lives in a new `projects/smart-translator-earphone/server/` directory **only after** the user agrees to take on Cloudflare account setup. Until then, every client story uses the embedded fallback path.

## 7. Per-PR Strategy (post-reconciliation)

The original 16-PR stack from this roadmap (PR #2–PR #17) has been reconciled with the parallel-merged PR #18 (see [`reviews/reconciliation-decision.md`](reviews/reconciliation-decision.md)) and **consolidated into a single PR** at the user's request:

**Closed (Epic 2-5 duplicates of merged PR #18):**

- PR #4, PR #5, PR #6, PR #7, PR #8, PR #9, PR #10 — Stream-A engine providers (STT/MT/TTS) and conversation session controller. Functionality shipped on `main` via merged PR #18 with a different architecture (env-driven factories + dispatch routers vs. embedded fallback policies + provider abstraction). Kept architectural artifacts documented in `reviews/reconciliation-decision.md` §4 ("Carry-Forward Register") for future refactor PRs.

**Consolidated into one PR (this branch):**

1. PR #2's audio-pipeline `stop()` fix + chunker `utteranceBoundary` flag.
2. PR #3's BMAD Phase R review (BA/PM/PO/SM) + this roadmap + reconciliation decision.
3. PR #11's Epic 6 lecture view-model + transcript export.
4. PR #12's Epic 7 LocalStore + HistoryViewModel + Settings tree + Auth/Subscription contracts.
5. PR #13's Epic 8 connectivity tracker + language-pack manager.
6. PR #14's Epic 9 group session client primitives (invite token + join URL + GroupViewModel).
7. PR #15's Epic 10 telemetry/crash/resilience/onboarding modules.
8. PR #16's Story 10.2 privacy / no-audio static check.
9. PR #17's Epic 11 server plane (relay protocol + session store + telemetry ingest validator).

**Out of scope (deferred to future PRs):**

- **Bootstrap-1 (RN + Expo Bare shell)** — already shipped by merged PR #18.
- **Native modules (Stream E)** — Stories 2.3b (Whisper), 3.4b (NLLB), 4.3b (native TTS), 8.2/8.3 (on-device runtime). Need physical iOS + Android devices.
- **Cloudflare deployment artifacts** — `wrangler.toml`, Worker entry, Durable Object binding. Need Cloudflare credentials. The pure-TS protocol logic lives in this PR's `app/src/server/` and is unit-testable today.

Each PR must:

- Pass root `npm run quality` (Prettier, ESLint, markdownlint, docs:build, test:install, test:urls, validate:refs, validate:skills).
- Pass project `npm run quality` (typecheck, lint, jest).
- Use Conventional Commits.
- Include a body following the repo's PR template (`git_pr action=fetch_template`).
- Not require any vendor credential to **pass tests** — only to run an integration smoke test that's gated behind a `VENDOR_CREDENTIALS_AVAILABLE=1` env flag.

## 8. Risk Register

| Tag | Risk | Mitigation |
|-----|------|-----------|
| Risk-Cost | Pro-tier defaults could push blended cost above the brief's USD 0.05–0.15/min ceiling. | Pro defaults to Azure Neural TTS; ElevenLabs is an explicit Premium upgrade. Tracked in Story 4.1 acceptance. |
| Risk-Market | TWS unit numbers don't equal addressable iOS-15+/Android-10+/3 GB-RAM installed base. | Year-1 ARR projection is already conservative; flagged for next market-research refresh. |
| Risk-Hardware | Native modules (1.6/1.7/8.2/8.3) require physical iOS + Android devices for verification. | Stream E sprints scheduled around device availability; failure to provision delays only Stream E, not the critical path through Streams A–D. |
| Risk-Vendor | Vendor outage or pricing change on a primary corridor. | Engine router fallback table + remote config (Story 2.5 + Epic 11.2). |
| Risk-CI | GitHub Actions disabled on fork; CI signal is local-only. | Every PR runs the same `npm run quality` locally before push; user has been asked to enable Actions. |
| Risk-Scope | "~3-month MVP" target is tight for 10 epics. | Descope candidates: E6 (lecture) and E9 (group) to fast-follow. |

## 9. Doc-debt Backlog

Items that were caught in the review pass and do **not** block implementation but should be addressed in a future docs PR:

- **D-1** Add an explicit cross-reference in `prd.md` §10 noting that FR-3 group mode UI is in E9.4, not E5.
- **D-2** Add a one-line "not currently routed; reference only" note next to Anthropic Claude in `technical-research.md` §3.1.
- **D-3** Cross-link `product-brief.md` Risks table from `prd-validation.md`.
- **D-4** Update `epics-and-stories.md` summary table to reflect the 2.3a/b, 3.4a/b, 4.3a/b splits and the existence of Epic 11.

## 10. FR-Mapping (corrected)

| FR | Owning Epics |
|----|--------------|
| FR-1 Conversation Mode | E1 (audio), E2 (STT), E3 (MT), E4 (TTS), E5 (UI), Epic 11 (cloud transport) |
| FR-2 Lecture Mode | E1, E2, E3, E4, E6, Epic 11 |
| FR-3 Group Mode | **E9 only** (UI) + Epic 11.3 (relay) |
| FR-4 Language Coverage | E2, E3, E8, ADR-004 routing |
| FR-5 Live Transcript | E5.3, E6.1, E6.2 |
| FR-6 Auto Lang Detect | E2.4 |
| FR-7 History | E7.1, E7.2 |
| FR-8 Offline Mode | E2.3a/b, E3.4a/b, E8.* |
| FR-9 TTS Customization | E4.4, E7.3 |
| FR-10 Quick Launch | E7.6 |

## 11. Definition of Done (per epic)

An epic is **done** when:

1. Every non-deferred story in the epic has a merged PR with passing CI.
2. All FR/NFR acceptance criteria mapped to that epic in [`implementation-readiness-check.md`](./implementation-readiness-check.md) §2 are met.
3. The cumulative `npm run quality` (root + project) passes on `main`.
4. The epic's hand-off contracts (SM review §6) are exercised by integration tests in the next epic.
5. The roadmap is updated to reflect closed items.

## 12. Sign-off

Signatures from the four-role review pass:

- **Business Analyst (Mary):** approved 2026-05-05.
- **Product Manager (John):** approved with the Epic-11 addendum 2026-05-05.
- **Product Owner (Sarah):** approved with the Bootstrap-1 + 2.3a/b + 3.4a/b + 4.3a/b refinements 2026-05-05.
- **Scrum Master (Bob):** sprint plan approved 2026-05-05; S1 ready for kick-off.

This roadmap supersedes any informal sequencing documented elsewhere. When this document and another artifact disagree, **this document wins** for sequencing questions; the source artifacts (PRD, architecture, ADRs) win for capability and architectural questions.
