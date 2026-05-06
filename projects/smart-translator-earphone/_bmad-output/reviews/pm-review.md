---
workflowType: 'review'
project_name: 'Smart Translator Earphone'
phase: 'pre-implementation'
agent: 'John (Product Manager)'
date: '2026-05-05'
inputDocuments:
  - prd.md
  - prd-validation.md
  - ux-design.md
  - architecture.md
  - epics-and-stories.md
  - adrs/ADR-001.md
  - adrs/ADR-002.md
  - adrs/ADR-003.md
  - adrs/ADR-004.md
  - adrs/ADR-005.md
---

# PM Review — Pre-Implementation Pass

## 1. Method

The PRD is the **capability contract** for v1. Before Epic 2 implementation begins, the PM verifies that the FRs and NFRs are unambiguously mapped to stories, that no FR is implicitly subdivided across epics in a way that creates orphaned acceptance criteria, and that the architecture and ADRs do not silently assume capabilities the PRD does not authorize.

Three lenses:

1. **FR / NFR coverage matrix.** Every FR and NFR maps to one or more stories with acceptance criteria that fully satisfy it.
2. **Cross-epic capability chains.** Capabilities that span epics (e.g. FR-3 group mode = relay + UI + auth) have explicit hand-off points.
3. **PRD ↔ ADR consistency.** No ADR introduces a capability the PRD does not call for; no PRD requirement is left without an ADR or architecture pointer when one is needed.

## 2. Findings

### 2.1 FR / NFR coverage matrix

| Req | Stories | Acceptance criteria sufficient to satisfy the requirement? | Severity |
|-----|---------|------------------------------------------------------------|----------|
| FR-1 Conversation Mode | E1.1–1.7, E2.1–2.5, E3.1–3.5, E4.1–4.4, E5.1–5.5 | Yes — capture, STT, MT, TTS, and the UI surface are all covered with explicit accept-criteria. | info |
| FR-2 Lecture Mode | E1.*, E2.*, E3.*, E4.*, E6.1–6.4 | Yes. | info |
| FR-3 Group Mode (2-person QR) | E9.1–9.4 | Yes. PRD §10 also lists E5 here, but inspection of the epics shows the group-mode UI surface is **owned entirely by Story 9.4** — Epic 5 is conversation-mode UI only. | **warn** |
| FR-4 Language Coverage (≥20 cloud, ≥10 offline) | E2.1–2.5, E3.1–3.4, E8.1 | Yes. ADR-004 codifies the per-corridor routing table. | info |
| FR-5 Live Transcript | E5.3, E6.1, E6.2 | Yes — interim/final styling is covered by 5.3, scrollback by 6.3. | info |
| FR-6 Auto Lang Detect | E2.4 | Yes (gated on STT engine support per V-05). | info |
| FR-7 History (FTS5 + delete-all) | E7.1, E7.2 | Yes. | info |
| FR-8 Offline Mode | E8.1–8.4 | Yes — covers downloader, runtime, UI affordances. **However** Stories 8.2 and 8.3 explicitly delegate the "actual native runtime" back to E2.3 / E3.4. The acceptance criteria across epics are non-overlapping but the **memory-profiling pass on Pixel 6a** that is the v1 gate lives in 8.2's accept-criteria. Stories 2.3 and 3.4 only need to ship a working interface. | **warn** |
| FR-9 TTS Voice Customization | E4.1–4.4, E7.3 | Yes. | info |
| FR-10 Quick-Launch Shortcut | E7.6 | Yes (widgets + Siri/Assistant). | info |
| NFR-1 Latency | E1.5, E2.5, E3.5, E10.1 | Yes — story 10.1 holds the explicit P95 acceptance gate (≤1.5 s WiFi, ≤1.8 s 4G); per-stage targets live in technical research §7 and architecture §3.4. | info |
| NFR-2 OS support | E1.6, E1.7 + implicit | Yes. | info |
| NFR-3 Battery (≤15%/hour) | E10.2 | Yes — explicit 30-min benchmark on Pixel 7a / iPhone 13. | info |
| NFR-4 Privacy (no audio retention; cloud-off mode) | E10.3 + arch §6.3 + project-context.md rule 6 | Yes — code-level CI lint rule + runtime sampling monitor. | info |
| NFR-5 Audio quality (≥85% accuracy at SNR ≥10 dB) | E1.3, E1.4 | Yes — explicit FP/FN bounds in 1.3. | info |
| NFR-6 Reliability (5 s blip; <0.1% crash) | E10.4, E10.5 | Yes. | info |

**Resolution for FR-3 (PM-warn-1):** PRD §10 mapping line "FR-3 Group Mode | E5, E9" is misleading. The roadmap will document FR-3 as **owned by Epic 9 alone**; Epic 5 only owns the conversation-mode entry point that *can launch* a group-mode flow. No story-level changes needed.

**Resolution for FR-8 (PM-warn-2):** The cross-epic hand-off is correct but not obvious. The roadmap explicitly orders Story 2.3 → 8.2 → 8.3 → 8.1 → 8.4 and notes that 2.3 ships a *typed interface + mock adapter*, while the actual `whisper.cpp` native runtime + memory-profiling acceptance lives in 8.2.

### 2.2 Cross-epic capability chains

| Capability | Stories that must complete before "feature works end-to-end" | Severity |
|-----------|-----------------------------------------------------------|----------|
| Conversation mode (FR-1) live demo | E1.1–1.5 (TS audio pipeline) → E2.1 (Deepgram) → E3.1 (DeepL) → E4.1 or E4.3 (TTS) → E5.1–5.3 (UI). E1.6/1.7 native modules must ship before a real device demo is possible. | info |
| Lecture mode (FR-2) live demo | Same as conversation but UI is E6.1–6.3. | info |
| Group mode (FR-3) live demo | E9.1–9.4 + the same audio + STT + MT + TTS chain. **Server work** (Cloudflare Workers Durable Object) is named in 9.3 but **no separate epic exists for the server itself.** This is a real gap — the `wrangler` project, the deployment pipeline, the secret-store binding, and the CI for the Worker all belong to a server epic that the PRD does not name. | **warn** |
| Pro subscription (E7.5) | E7.4 sign-in must precede E7.5; both must precede E10.7 (App-Store assets including subscription metadata). | info |
| Telemetry (E10.1) | The PostHog integration is named in arch §6.1 + project-context.md but there is no story for "set up PostHog project, add SDK, route events through opt-in gate." E10.1 implies it but does not ship it. | **warn** |
| Engine router policy fetch (E2.5) | Server-side KV / Worker for the policy file does not exist; E2.5 says "Loads from Cloudflare Workers KV via a signed URL; falls back to embedded JSON if remote fetch fails." If the Worker isn't built, the embedded JSON path is the only one ever exercised. | **warn** |

**Resolution for the three warns above:** the roadmap introduces an explicit **Epic 11 — Server Plane** that covers (a) Cloudflare Workers + Durable Objects for streaming gateway and group relay, (b) policy KV + remote-config endpoint, (c) PostHog opt-in event ingestion path. This is **not** in the PRD because the PRD is the client capability contract; it sits under "infrastructure that supports the FRs." Epic 11 is sized after this review pass and added to the implementation plan.

### 2.3 PRD ↔ ADR consistency

| ADR | Relates to | Concern | Severity |
|-----|-----------|---------|----------|
| ADR-001 RN + Expo Bare | NFR-2 cross-platform, all UI epics | Consistent with PRD; no conflict. | info |
| ADR-002 Cloud-first w/ on-device fallback | FR-8 offline, NFR-1 latency, NFR-4 privacy | Consistent; the privacy posture is purely architectural (no audio retention) and that is enforced by the server-side CI lint per Story 10.3. | info |
| ADR-003 Streaming STT for both modes | NFR-1 | Consistent. | info |
| ADR-004 Per-corridor engine routing | FR-4 | Consistent; the embedded fallback table is part of the client. | info |
| ADR-005 Audio routing strategy | NFR-2, FR-9 | Consistent; the eight `AudioSessionMode` values defined in the ADR are exhaustively switched in `audio-session-types.ts` and are referenced by Stories 1.6 / 1.7. | info |

## 3. Summary

- **Block-level findings:** 0.
- **Warnings:** 5 (PM-warn-1 PRD §10 mapping, PM-warn-2 FR-8 hand-off, PM-warn-3/4/5 server-plane gap and dependents).
- **Info:** the rest.

The PRD is **approved to enter Epic 2 implementation** with two structural follow-ups baked into the roadmap:

1. The roadmap explicitly orders cross-epic hand-offs for FR-8 (offline runtime).
2. The roadmap introduces **Epic 11 — Server Plane** to cover Cloudflare Workers, the engine-router policy KV, and the PostHog ingestion path that the PRD assumes but does not own.

## 4. Sign-off

- **Product Manager (John):** approved with the Epic-11 addendum. 2026-05-05.
