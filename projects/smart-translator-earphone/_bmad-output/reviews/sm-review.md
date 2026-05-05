---
workflowType: 'review'
project_name: 'Smart Translator Earphone'
phase: 'pre-implementation'
agent: 'Bob (Scrum Master)'
date: '2026-05-05'
inputDocuments:
  - epics-and-stories.md
  - reviews/ba-review.md
  - reviews/pm-review.md
  - reviews/po-review.md
---

# SM Review — Sequencing & Sprint Plan

## 1. Method

The SM does not re-question requirements; the SM **sequences**. This review takes the stories the PO marked READY/BLOCKED, reads the PRD architecture's dependency graph, and produces a concrete sprint-by-sprint plan with explicit:

- Critical path
- Parallelizable streams
- Hand-off points (where one team's output becomes another's input)
- External-blocker mitigations (credentials, server accounts)

## 2. Critical path

```
                       ┌──── E2.* STT ─────┐
                       │                   ▼
E1 (done) ─► RN-shell ─┤                E3.* MT ─► E4.* TTS ─► E5+E6 (UI) ─► E10 (polish) ─► Beta
                       │                                              ▲
                       └──── E7.1 + E10.3 (TS-only, no shell) ────────┤
                       └──── Epic 11 (Server) ────────────────────────┤
                       └──── Native modules (Stories 1.6, 1.7,
                              4.3-native, 8.2, 8.3) ──────────────────┘
```

The **single longest critical path** is: bootstrap RN shell → conversation UI (E5) → polish (E10) → beta. Everything that can run *off-path* should.

## 3. Parallelizable streams

| Stream | What it produces | Independence |
|--------|------------------|--------------|
| **STREAM-A "Engines"** (TS, no shell) | `E2.*` + `E3.*` + E4.1 + E4.2 + E2.5 (with embedded fallback) | Fully independent of the RN shell. Driven against mock servers; only requires real cloud credentials at integration-test time. |
| **STREAM-B "Persistence"** (TS, no shell) | E7.1 (SQLite + FTS5 shim with `expo-sqlite` mock) + E10.3 (CI lint rule) | Fully independent. |
| **STREAM-C "Server"** (Epic 11) | Cloudflare Workers WS gateway + group relay + engine-router KV + PostHog ingestion | Fully independent until E2.5 / `E9.*` / E10.1 try to hit a real endpoint. |
| **STREAM-D "RN Shell + UI"** | Bootstrap-1 then E4.4 + `E5.*` + `E6.*` + E7.2 + E7.3 + E8.4 + E9.4 + E10.6 | Begins after Bootstrap-1; everything queues here. |
| **STREAM-E "Native modules"** | Real implementation of 1.6 + 1.7 + 4.3-native + 8.2 + 8.3 + 7.6 | Requires Xcode + Android Studio + real devices. Schedule against device availability, not against any other stream. |

## 4. Bootstrap-1 (blocking task; not yet a story)

**Task:** create the React Native + Expo Bare shell inside `projects/smart-translator-earphone/app/`, preserving the existing pure-TS `core/audio/` modules and tests.

**Acceptance:**

- `npx create-expo-app -t expo-template-bare-typescript` (or equivalent) is run, output is **merged** into `app/` without overwriting `app/src/core/audio/*`.
- `app/src/index.ts` continues to export the audio core; a new `app/App.tsx` wires it up to a placeholder UI that renders "Smart Translator Earphone" and logs an audio frame count to the JS console (proves the bridge works at the lowest level).
- `npm run quality` inside `app/` continues to pass: typecheck, eslint, **all 58 Jest tests**, prettier.
- `npm run start` (Metro bundler) starts without errors.
- `app/ios/` and `app/android/` exist with their respective Podfile / Gradle config and are gitignored where appropriate.
- `tsconfig.json` paths (`@core/audio/*`, etc.) are preserved.
- README.md updated to reflect the shell exists.

**Estimate:** M (2–3 days), the bulk of which is reconciling the Expo Bare template's `tsconfig` / `package.json` / `babel.config.js` with the existing audio module's pure-TS-strict config without breaking `npm run quality`.

## 5. Sprint plan (10-week horizon)

| Sprint (~2 wk) | Streams active | Deliverables | External requirements |
|----------------|---------------|--------------|------------------------|
| **S1** | A, B | E2.1 (Deepgram via mock WS server) · E2.2 (Google STT via REST mock) · E2.5 (embedded fallback policy) · E7.1 (SQLite shim + FTS5 with `expo-sqlite` mocks) · E10.3 (CI lint) | None (mocks only) |
| **S2** | A, B, C | E3.1 (DeepL) · E3.2 (Google MT) · E3.5 (pre-emption) · E4.1 (ElevenLabs) · E4.2 (Azure) · E2.4 (auto-detect via Google) · Epic 11 stub (`server/` package, `wrangler` skeleton, README, `npm run dev:server` recipe) | Cloudflare account (free tier), or proceed without — server is purely local at S2. |
| **S3** | C, D (begins) | Epic 11.1 (WS gateway minimal) · Epic 11.2 (engine-router KV) · **Bootstrap-1** · E5.1 home screen | Cloudflare account, GitHub Actions enable-on-fork (already flagged to user) |
| **S4** | D | E5.2 conversation active session · E5.3 transcript pair · E5.4 transparency sheet · E5.5 permissions · E4.4 voice picker UI | None |
| **S5** | D | E6.1–6.4 lecture mode · E7.2 history list · E7.3 settings tree · E10.6 onboarding polish | None |
| **S6** | C, E | Epic 11.3 (group relay) · 1.6 iOS native · 1.7 Android native | iOS dev machine + Apple Developer account; Android Studio |
| **S7** | E | 4.3-native · 8.2 Whisper.cpp on-device · 8.3 NLLB-200 on-device · 8.1 language pack downloader · 8.4 offline UI | Same |
| **S8** | D, C | E9.1–9.4 group mode · E7.4 sign-in · 11.4 PostHog ingestion path · 10.1 latency telemetry | Apple/Google OAuth clients, PostHog account |
| **S9** | D | E7.5 subscriptions · E7.6 quick-launch widgets · 10.4 Sentry · 10.5 network resilience · 10.2 battery | Sentry account, App Store Connect + Play Console; subscription products configured |
| **S10** | D | 10.7 store assets · 10.8 beta release | Beta tester recruitment |

This is **9–10 sprints (≈18–20 weeks) of calendar time** with two engineers running streams A/B and D in parallel. The brief's "~3 month MVP" target is achievable only by descoping E6 (lecture) or E9 (group) to a fast-follow — flagged for PM/PO during sprint planning.

## 6. Hand-off contracts

These are the explicit interface contracts that allow streams to run in parallel without integration drift:

| Hand-off | Producer | Consumer | Contract |
|----------|----------|----------|----------|
| Audio frames | E1 (done) | E2 STTProvider | `AudioFrame` type in `@core/audio/audio-types.ts`: 16 kHz mono int16 PCM, 320 samples per frame. |
| Chunks | E1 chunker | E2 streaming adapters | `AudioChunk` with `final` and `utteranceBoundary` flags. |
| Partial / final transcripts | E2 STTProvider | E3 MTProvider + E5/E6 UI | `STTEvent` discriminated union: `partial`, `final`, `language-detected`, `error`. |
| Translated text + metadata | E3 MTProvider | E4 TTSProvider + E5/E6 UI | `MTResult { sourceText, translatedText, sourceLang, targetLang, isInterim }`. |
| TTS audio chunks | E4 TTSProvider | E1 playback queue | 24 kHz int16 PCM in 100–500 ms chunks. |
| Engine policy | E2.5 engine-router | E2 + E3 + E4 adapters | Static fallback table (now) → KV-fetched table (Epic 11.2). Same JSON shape both ways. |
| Group relay messages | E9 client | Epic 11.3 server | `RelayMessage` JSON: `{ kind: "transcript-delta" \| "session-end" \| "join", sessionId, payload }`. |

Each hand-off contract gets a TypeScript type in `@core/types/` checked by both sides; a contract test ensures producer and consumer compile against the same definition.

## 7. Risk register (sequencing-relevant)

| Risk | Mitigation |
|------|------------|
| RN/Expo Bare bootstrap conflicts with existing `app/src/core/audio/*` strict-TS config. | Run Bootstrap-1 in a throwaway branch first; merge `package.json` / `tsconfig.json` deliberately; do not overwrite source files. |
| GitHub Actions disabled on the fork → no CI feedback on every PR. | User has been asked to enable Actions; if they don't, every PR runs the same root + project quality checks locally before push (already in `AGENTS.md`). |
| Native module (1.6, 1.7) work blocked on hardware availability. | Schedule STREAM-E around hardware availability; everything else runs on commodity Linux/macOS dev machines. |
| Vendor credentials (Deepgram, DeepL, ElevenLabs, etc.) not provisioned. | All Stream A adapters are written against documented WS / REST shapes with mock servers; integration tests gated behind a `VENDOR_CREDENTIALS_AVAILABLE=1` flag, default off. |
| Cost over-run on Pro-tier defaults (BA-04). | Roadmap §Risk-Cost notes Pro defaults to Azure Neural TTS unless user opts into ElevenLabs. |
| Critical-path slip in S5 (UI). | Descope E6 (lecture) to a fast-follow; ship MVP with Conversation + Group only. Escalate to PM. |

## 8. Sign-off

- **Scrum Master (Bob):** plan approved, ready for sprint S1 kick-off. 2026-05-05.
