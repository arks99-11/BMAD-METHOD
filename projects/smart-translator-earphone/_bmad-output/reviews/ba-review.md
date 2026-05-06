---
workflowType: 'review'
project_name: 'Smart Translator Earphone'
phase: 'pre-implementation'
agent: 'Mary (Business Analyst)'
date: '2026-05-05'
inputDocuments:
  - brainstorming-report.md
  - market-research.md
  - technical-research.md
  - product-brief.md
---

# BA Review — Pre-Implementation Pass

## 1. Method

This review re-reads the four Phase-1 / early-Phase-2 artifacts produced by the BA workflow (brainstorming, market research, technical research, product brief) before the team commits to building Epics 2–10. The goal is **not** to re-do the work — it is to surface internal inconsistencies, stale data, or unstated assumptions that will hurt downstream stories if left in.

Three lenses:

1. **Internal consistency.** Do the four documents agree with each other (numbers, scope, terminology)?
2. **Currency.** Are the cited vendor specs, prices, and competitive claims still defensible at implementation time? Where they cannot be re-verified in the BA's environment, the original "planning-grade" disclaimer is preserved.
3. **Tracing into product brief.** Does every claim in `product-brief.md` rest on something that appears in one of the three input documents?

Severity: `info` (note for the team) · `warn` (fix or document) · `block` (must resolve before implementation continues).

## 2. Findings

### 2.1 Internal consistency

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| BA-01 | info | Brainstorming §3 cites "high-pass filter, AGC, optional noise reduction" without numeric specs. Technical research §7 names "20 ms PCM frames at 16 kHz mono" and Architecture §3.3 / Story 1.4 fix concrete cutoffs (100 Hz cascade, ≥18 dB at 60 Hz). The chain of refinement is intentional and correct — no edit needed. | OK. |
| BA-02 | info | Brainstorming §2.3 ("Group Mode") talks about "3+ participants, possibly more than 2 languages." PRD scopes v1 group mode down to a 2-person QR pair (PRD §8 explicit out-of-scope). The brainstorming document is the unconstrained idea list; the brief's Scope section narrows correctly. | OK. |
| BA-03 | info | Brainstorming §5 anticipates "USD 4.99/month or 39.99/year" for Pro; product brief §Success Criteria reuses these numbers. Market research §5 gives ARPU range USD 30–55/year. USD 39.99/year sits inside that range. | OK. |
| BA-04 | warn | Brainstorming §5.4 estimates blended cloud cost USD 0.05–0.15/min "before margins compress." Technical research §7 + ADR-004 default policy pick DeepL/Deepgram/ElevenLabs as Pro defaults. ElevenLabs at USD 150–300 / M chars is the dominant cost driver and is **not** included in the brainstorming estimate. **Reality check:** running ElevenLabs streaming TTS for the *user's* language (translation output) on a 50-words-per-minute speaker costs roughly USD 0.05–0.10 per minute by itself. Combined with Deepgram + DeepL, blended Pro-tier cost lands around USD 0.10–0.20/min, not 0.05–0.15. | Resolution: do **not** silently ship Pro-tier with ElevenLabs as default. Either gate ElevenLabs behind a higher-tier "Premium voice" feature flag, or default Pro to Azure Neural TTS (~USD 16 / M chars) and offer ElevenLabs as an explicit upgrade. Tracked in roadmap.md §Risk-Cost. |
| BA-05 | info | Market-research §3.1 + product brief alignment around "every hardware competitor still requires a phone app" — the wedge — is consistent and is the headline marketing claim. | OK. |
| BA-06 | warn | Market-research §6 cites ">300M units/year TWS shipments globally as of 2024" without a per-OS split. PRD NFR-2 caps support to iOS 15+ / Android 10+ with ARM64 + ≥3 GB RAM. The available addressable hardware is materially smaller than the ">300M" figure once those constraints are applied. | Resolution: for the Year-1 ARR projection in the brief, the analysis is already conservative enough that this gap doesn't change the headline. Flagged for the next market-research refresh: add a per-OS / per-RAM-tier breakdown of installed base to make the addressable-population number defensible. Tracked in roadmap.md §Risk-Market. |

### 2.2 Currency

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| BA-07 | info | Vendor pricing (Deepgram, DeepL, ElevenLabs, Azure, Google) is cited as "indicative" in all three Phase-1 documents. The numbers are consistent with public pricing as of the document date and remain "planning-grade" for routing decisions. | OK; the engine-router (Story 2.5) reads from remote config so price-driven re-routing does not require an app release. |
| BA-08 | info | Whisper / NLLB-200 are cited in technical-research §6 as on-device candidates. As of May 2026 these remain the dominant open candidates; no leapfrog in the multilingual on-device space has materialized that would force a rewrite of ADR-002. | OK. |
| BA-09 | warn | Technical research §3.1 lists "Anthropic Claude" as a candidate MT engine with cost "varies." ADR-004's default policy does **not** route any corridor to Claude. Either Claude should be removed from the technical-research comparison (it adds a row that is never exercised) or it should appear as an explicit Pro-tier alternative beside GPT-4o-mini. | Resolution: leave Claude in the comparison as a non-routed reference (it is informative for cost / quality benchmarking) but add a one-line note pointing to ADR-004's actual routing decision. Low-priority documentation polish; tracked in roadmap.md §Doc-debt. |

### 2.3 Tracing

| ID | Severity | Finding | Resolution |
|----|----------|---------|------------|
| BA-10 | info | Product-brief Vision (§"Voice cloning preserves the speaker's emotional register") is correctly out of scope for v1 and is covered by PRD §8 + V-10. | OK. |
| BA-11 | warn | Product-brief Risks (§"Risks") table is referenced but truncated in the source document — the closing rows of the table are present (lines 127+) but no follow-up resolution mapping exists in `prd-validation.md` or `implementation-readiness-check.md`. | Resolution: not a blocker for Epic 2 implementation; flagged for a future doc pass. The risks themselves are reflected operationally in NFR-3, NFR-4, NFR-6 and the corresponding stories. Tracked in roadmap.md §Doc-debt. |

## 3. Summary

- **Block-level findings:** 0.
- **Warnings:** 4 (BA-04, BA-06, BA-09, BA-11) — none of them block Epic 2 start; the only one with operational teeth is BA-04 (cost-tier composition for Pro defaults), which is captured as a roadmap risk and a default-policy note rather than a code change.
- **Info:** 7.

The Phase-1 / brief artifacts are **approved for the implementation phase** with the noted follow-ups.

## 4. Sign-off

- **Business Analyst (Mary):** approved 2026-05-05.
