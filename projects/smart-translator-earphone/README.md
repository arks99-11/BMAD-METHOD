# Smart Translator Earphone

**Project Status:** Phase 4 — Implementation (Epic 1: Audio Pipeline Foundation in progress)

A mobile application that turns any ordinary Bluetooth or wired earphone into a real-time AI translation device — no specialized hardware required.

## Why this project

Dedicated translation earphones (Timekettle WT2/M3, Waverly Labs Ambassador, Pixel Buds with Live Translate) cost USD 200–400 and lock users into a specific hardware ecosystem. Most users already own perfectly capable earphones; the missing piece is the software that turns those earphones into a translator. This project closes that gap.

## Documents (BMAD planning artifacts)

All planning artifacts live in [`_bmad-output/`](./_bmad-output/) and were produced by following the BMAD Method workflow.

### Phase 1 — Analysis

- [`brainstorming-report.md`](./_bmad-output/brainstorming-report.md) — Use cases, modes, audio handling, differentiators, business model
- [`market-research.md`](./_bmad-output/market-research.md) — Competitor landscape, market sizing, pain points
- [`technical-research.md`](./_bmad-output/technical-research.md) — STT/TTS/translation engines, audio routing, on-device ML, latency optimization
- [`product-brief.md`](./_bmad-output/product-brief.md) — Executive summary, problem, solution, differentiators, target users, risks

### Phase 2 — Planning

- [`prd.md`](./_bmad-output/prd.md) — Product Requirements Document (10 functional + 6 non-functional requirements)
- [`prd-validation.md`](./_bmad-output/prd-validation.md) — PRD validation report
- [`ux-design.md`](./_bmad-output/ux-design.md) — Screen flows, mode-specific UI, onboarding, settings

### Phase 3 — Solution Design

- [`architecture.md`](./_bmad-output/architecture.md) — High-level architecture, component breakdown, deployment topology
- [`adrs/`](./_bmad-output/adrs/) — Architecture Decision Records (ADR-001 through ADR-005)
- [`epics-and-stories.md`](./_bmad-output/epics-and-stories.md) — 10 epics, 55 stories with acceptance criteria
- [`implementation-readiness-check.md`](./_bmad-output/implementation-readiness-check.md) — Cross-document consistency review
- [`project-context.md`](./_bmad-output/project-context.md) — Technology stack, conventions, implementation rules for AI agents

## App (Phase 4)

The mobile app source lives in [`app/`](./app/). It is an [Expo](https://expo.dev/) React Native (TypeScript) application.

Currently implemented (Epic 1 — Audio Pipeline Foundation):

- `audio-capture` — Platform-agnostic interface + mock provider for capturing PCM frames from a Bluetooth/wired headset microphone.
- `audio-buffer` — Ring-buffer + chunker that aggregates raw PCM frames into fixed-duration chunks suitable for streaming STT.
- `vad` — Energy-based Voice Activity Detection with hysteresis (start/stop thresholds + minimum silence duration) for utterance segmentation.
- `noise-reduction` — Spectral subtraction primitives and a high-pass filter for low-frequency rumble suppression.
- `audio-playback` — Output queue/scheduler that plays TTS audio chunks back through the connected headset without overlap.

See [`app/README.md`](./app/README.md) for setup, testing, and architecture details.

## Quick start (planning artifacts only)

```bash
# Read in order
ls projects/smart-translator-earphone/_bmad-output/
```

## Quick start (app)

```bash
cd projects/smart-translator-earphone/app
npm install
npm test          # runs Jest unit tests for Epic 1 modules
```

## Workflow conventions used

- Each Phase 1–3 document is self-contained and can be read independently, but they cross-reference one another (e.g. PRD references the brief; epics reference PRD requirements).
- Functional Requirements are tagged `FR-1`..`FR-10`; Non-Functional Requirements `NFR-1`..`NFR-6`. Stories reference these IDs explicitly so the FR coverage map can be regenerated at any time.
- ADRs follow the canonical format: Context → Decision → Consequences → Alternatives Considered.
