---
workflowType: 'handoff'
project_name: 'Smart Translator Earphone'
phase: 'mid-implementation'
date: '2026-05-05'
audience: 'incoming developer / next session'
---

# Smart Translator Earphone — Developer Handoff

This document is the single starting point for the developer taking over
this project. It captures the **current state**, **architecture**, **how
to run / test**, **decisions made**, **what is deliberately deferred**,
and a **prioritized list of next steps**.

If you only read one file before starting work, read this one. After
that, read [`flow-diagram.md`](./flow-diagram.md) for the audio →
translation → playback pipeline at a glance.

---

## 1. Repository at a glance

- **Repo:** `arks99-11/BMAD-METHOD` (fork)
- **Project root:** `projects/smart-translator-earphone/`
- **App root (Expo):** `projects/smart-translator-earphone/app/`
- **Server (Cloudflare Worker, partial):** `projects/smart-translator-earphone/app/src/server/`
- **Open PR:** [#19 — consolidated Phase R stack](https://github.com/arks99-11/BMAD-METHOD/pull/19) — base = `main`
- **Working branch:** `devin/1777973885-consolidated`
- **Test count (project):** 294 Jest tests passing
- **Quality gate:** `npm run quality` at root **and** at `projects/smart-translator-earphone/app/` — both green
- **CI on the fork:** GitHub Actions is **disabled**. Re-enable at
  <https://github.com/arks99-11/BMAD-METHOD/settings/actions> when you are
  ready. Until then, local `npm run quality` is the source of truth.

### Branch layout

After consolidation, only two long-lived branches matter:

```
main                                  (production target, has Epic 1 + Epic 2-5 from PR #18)
└── devin/1777973885-consolidated     (PR #19 — Epic 6/7/8/9/10/11 + audio fix + free Google MT + tab capture + mic picker)
```

All earlier per-epic branches (PR #2, #3, #11–#17) were collapsed into
PR #19 and their branches deleted. PR #4–#10 were closed during the
reconciliation; see [`reviews/reconciliation-decision.md`](./reviews/reconciliation-decision.md).

---

## 2. What is on `main` already

Merged into `main` and is the baseline you can rely on:

- **PR #1** — Smart Translator Earphone BMAD project (Phase 1–4 docs +
  Epic 1 audio pipeline foundation in TS, plus iOS/Android native
  skeletons).
- **PR #18** — Runnable Expo shell with Whisper-cloud / Google STT,
  DeepL / OpenAI / Google MT, Azure / Google TTS, EngineRouter, plus
  Conversation / Lecture / History / Settings screens (web + native
  bare RN). 77 Jest tests.

The rest of the value lives in **PR #19** (still open at handoff).

---

## 3. What is on PR #19 (open, ready to merge)

PR #19 is the consolidation of every other piece of work:

| Epic / theme | Code added in PR #19 | File pointer |
|---|---|---|
| Audio pipeline fix | Tag final chunk as utterance boundary on `stop()` | `core/audio/audio-chunker.ts` |
| BMAD Phase R review docs | BA / PM / PO / SM reviews + reconciliation decision + roadmap | `_bmad-output/reviews/`, `_bmad-output/roadmap.md` |
| Epic 6 — Lecture | Lecture view-model + transcript export | `core/lecture/` |
| Epic 7 — Local store / settings | LocalStore, HistoryViewModel, settings tree, account contracts | `core/store/`, `core/history/`, `core/settings/`, `core/account/` |
| Epic 8 — Offline | ConnectivityTracker + LanguagePackManager | `core/connectivity/`, `core/packs/` |
| Epic 9 — Group | Group session client primitives + invite tokens | `core/group/` |
| Epic 10 — Telemetry / resilience | Buffered telemetry sink, crash reporter, circuit breaker, retry, onboarding state, privacy no-audio static check | `core/telemetry/`, `core/crash/`, `core/resilience/`, `core/onboarding/`, `core/privacy/` |
| Epic 11 — Server plane | Relay protocol, session store, telemetry ingest validator | `src/server/` |
| End-to-end flow diagram | 6 Mermaid diagrams + code path table + data shapes cheatsheet | `_bmad-output/flow-diagram.md` |
| Audio device monitor + UI | `enumerateDevices()` + `devicechange` listener + Home card | `core/audio/audio-device-monitor.ts`, `web-audio-device-monitor.ts`, `components/AudioDeviceStatus.tsx` |
| Free Google translation | Unofficial endpoint provider, no API key needed | `core/translation/google-translate-free-provider.ts` |
| Tab / system audio capture | `getDisplayMedia` provider + Home picker | `core/audio/web-tab-audio-capture.ts`, `components/InputSourcePicker.tsx` |
| Microphone source picker | `deviceId` plumbing + Home strip picker | `core/audio/web-audio-capture.ts` (deviceId option), `components/MicSourcePicker.tsx` |

Latest commit on the branch at handoff: `67bb7837`.

---

## 4. Architecture in 60 seconds

The runtime pipeline is:

```
AudioCaptureProvider
  (mic   = WebAudioCaptureProvider | ExpoAudioCaptureProvider | Mock)
  (tab   = WebTabAudioCaptureProvider                          | Mock)
        │ AudioFrame  (16 kHz mono int16, 320 samples / frame)
        ▼
AudioPipeline
  ├── HighPassFilter  (4-stage 100 Hz)
  ├── VoiceActivityDetector
  └── AudioChunker    (cuts on VAD end-of-utterance, also on stop())
        │ AudioChunk
        ▼
SttEngineRouter      (Deepgram | Google | Whisper-cloud | Mock)
        │ SttEvent (partial → final)
        ▼
TranslationRouter    (Google paid | DeepL | OpenAI | GoogleFree | Mock)
        │ TranslationResult
        ▼  (only when speakOutput = true, i.e. Conversation mode)
TtsEngineRouter      (ElevenLabs | Azure | Google | Native bridge | Mock)
        │ PlaybackChunk
        ▼
AudioPlaybackProvider (Expo on web/iOS/Android, Mock in node)
```

`EngineRouter` is the orchestrator that wires these together and is
constructed by `engine-factory.ts` from environment variables.
`SessionStore` (in `state/`) is the single React-facing facade — the
Home, Conversation, Lecture, History, and Settings screens all read /
mutate state through it.

For the visual version with sequence + component diagrams, see
[`flow-diagram.md`](./flow-diagram.md) (rendered Mermaid).

`AudioDeviceMonitor` is a **status side-channel**, not part of the
pipeline. It listens to `navigator.mediaDevices.devicechange` so the
UI can show which earphone is connected; it does NOT feed audio into
the pipeline.

---

## 5. Setup — first 10 minutes

```bash
# 1. clone and install
git clone https://github.com/arks99-11/BMAD-METHOD.git
cd BMAD-METHOD
npm ci                                # installs root tooling

cd projects/smart-translator-earphone/app
npm ci                                # installs Expo + provider deps

# 2. quality gate (must be green before you push)
cd ../../..                           # back to repo root
npm run quality                       # root: prettier, eslint, markdownlint, skill validator
cd projects/smart-translator-earphone/app
npm run quality                       # project: tsc strict + Jest

# 3. run the web app
npx expo start --web --port 8081
# open http://localhost:8081
```

### Environment variables

`.env` files are loaded by `engine-factory.ts` to enable cloud
providers. None are required to run — without keys the app falls back
to the free Google translate endpoint and Mock STT/TTS.

| Variable | Provider | Notes |
|---|---|---|
| `EXPO_PUBLIC_DEEPGRAM_API_KEY` | Deepgram STT | Streaming WebSocket |
| `EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY` | Google STT + Google Translate (paid) | When set, free Google MT is **not** registered |
| `EXPO_PUBLIC_DEEPL_API_KEY` | DeepL MT | Free tier OK |
| `EXPO_PUBLIC_OPENAI_API_KEY` | OpenAI / GPT-4o-mini MT | Streaming pre-emption |
| `EXPO_PUBLIC_ELEVENLABS_API_KEY` | ElevenLabs TTS | Voice catalog |
| `EXPO_PUBLIC_AZURE_SPEECH_KEY` + `EXPO_PUBLIC_AZURE_SPEECH_REGION` | Azure Speech | Both must be set |

Without any of these, the app uses Mock providers (deterministic, no
network) plus free Google translate. This is the recommended demo
mode.

---

## 6. How to test (manual, on a real device)

### Prerequisites

- Chrome / Edge / Brave (Firefox + Safari only partially support tab
  audio).
- Earphones connected (Bluetooth or wired).
- A YouTube tab in the same browser for tab-audio test.

### Test plan (the same one used at handoff)

1. **Earphone detection**
   - Home screen → top card "Audio devices".
   - Click "Allow microphone to identify devices" the first time.
   - You should see your earphone name (e.g. `AirPods Pro`) with a
     green dot.
   - Unplug / re-plug — the card updates in real time.

2. **Microphone source picker**
   - Below "Audio devices" → strip with "Default (OS)" + each input
     device.
   - Click between tiles; the active tile gets a coloured border.
   - The picker hides if input source is set to "Tab audio".

3. **Tab audio capture**
   - Below "Microphone" → "Audio source" with two tiles: 🎙 Microphone
     and 📺 Tab audio.
   - Click "Tab audio". On Chromium-based browsers it activates; on
     others the tile is disabled with "Not supported on this device".

4. **Conversation flow with mic**
   - From: `Auto-detect`, To: `Vietnamese`, mode: `Conversation`,
     source: `Microphone`.
   - Click **Start Translation**. Speak an English sentence. After
     1–3 seconds you should see the original transcript and the
     Vietnamese translation, with the translation also spoken back
     through your earphone.

5. **Conversation flow with tab audio (YouTube)**
   - Stop the previous session. Switch source to `Tab audio`. Click
     Start. The browser shows a screen-share picker — pick the
     YouTube tab AND **tick "Share tab audio"** (otherwise the
     stream has no audio and the app surfaces a clear error).
   - Play the video. Captions should appear in Vietnamese.
   - Stop by clicking "Stop sharing" in the browser's screen-share
     chip (the app auto-stops on track end) or by pressing Stop.

6. **Lecture mode** — same as Conversation but no spoken playback;
   useful for one-way scenarios (lectures, podcasts).

---

## 7. Decisions log (read this before changing direction)

These are decisions that have already been made and are not up for
re-debate without a strong reason. They are documented because the
incoming developer will likely wonder "why this and not that?"

1. **Pure-TS architecture for engines.** All STT / MT / TTS providers,
   the audio pipeline, and the server plane are written in TypeScript
   with no native module dependencies. This is what makes 294 unit
   tests run in under 5 seconds with no device hardware.

2. **Two parallel implementations of Epic 2-5 were reconciled.**
   PR #18 shipped a runnable Expo shell with Whisper-cloud / Google /
   DeepL / OpenAI / Azure / ElevenLabs providers. The original Phase R
   stack was a different architecture with the same scope. We chose
   PR #18 as the runnable baseline and kept Phase R's Epic 6–11 work
   on top. See [`reviews/reconciliation-decision.md`](./reviews/reconciliation-decision.md).

3. **Free Google translate endpoint is NOT for production.** It uses
   `translate.googleapis.com/translate_a/single` (unofficial,
   rate-limited per IP). It is the default when no Google Cloud API
   key is set so the demo works out of the box. As soon as
   `EXPO_PUBLIC_GOOGLE_CLOUD_API_KEY` is set, the paid provider takes
   priority and the free one is not registered.

4. **Tab audio capture is web-only by design.** iOS blocks system
   audio capture entirely (no public API). Android's
   `AudioPlaybackCapture` requires per-app opt-in which YouTube /
   Netflix / etc. opt out of. The web `getDisplayMedia` path is the
   only legal cross-platform path; on native we fall back to a Mock
   provider so feature detection works.

5. **Phone call audio capture is not implemented and will not be.**
   Apple blocks it 100%. Android third-party call recording is illegal
   in most jurisdictions. The only legal workaround — speakerphone +
   mic capture — already works through the existing mic provider.

6. **Microphone picker is web-only for now.** Native Expo recorder
   doesn't expose per-device selection from JS; this requires a
   native module which is deferred to the native sprint.

7. **GitHub Actions is disabled on the fork.** This is intentional
   while the project lives on a personal fork; once the user enables
   Actions in repo settings, the existing `.github/workflows/quality.yaml`
   will run identical checks to local `npm run quality`.

---

## 8. Known limitations / explicit deferrals

These are things we *know* are not built yet. Each has a defensible
reason for not being done now.

| Story / area | Why deferred | Where to start |
|---|---|---|
| 2.3 Whisper on-device STT (whisper.cpp) | Requires native module, model bundling | Native sprint |
| 3.4 NLLB on-device MT | Requires native module, 1.5 GB model | Native sprint |
| 4.3b Native TTS adapter (AVSpeech / Android TTS) | Requires native bridge | Native sprint |
| 8.2 / 8.3 On-device runtime adapters | Depends on 2.3 / 3.4 | Native sprint |
| Cloudflare Worker entry + `wrangler.toml` | PR #19 has the protocol logic in `src/server/`; deployment artifacts not yet authored | Server-deploy sprint |
| Native iOS `AVAudioSession.routeChangeNotification` | Skeleton present in `src/native/`, not wired | Native sprint |
| Native Android `AudioDeviceCallback` | Skeleton present in `src/native/`, not wired | Native sprint |
| Persistent settings via LocalStore | LocalStore exists (Epic 7); SessionStore.micDeviceId is in-memory only | Plumb LocalStore key into SessionStore.setMicDeviceId / setInputSource |
| Settings screen UX for mic / tab choice | Both pickers live on Home; no Settings entry for persistence | Wire after the LocalStore plumb above |

---

## 9. Suggested next steps (priority order)

These are direct, scoped tasks the next developer can pick up.

### Tier 1 — small, high-value
1. **Persist `inputSource` and `micDeviceId` via LocalStore.** Today
   they reset on reload. Add a `SessionPreferences` key to LocalStore
   (Epic 7 already has the abstractions), hydrate in
   `SessionStore.constructor`, and write through the setters. ~30 LOC,
   ~6 unit tests.
2. **Verify free Google translate endpoint stability.** Add a CI test
   that exercises the live endpoint once a day with a budget of e.g.
   3 round-trips. If Google changes the response shape, we want to
   know within 24 h, not when a user reports a broken demo.
3. **Add a "Skip language detection" optimization.** When the user
   has explicitly picked a source language, the language detection
   policy still runs. Short-circuit it for ~30 ms savings per
   utterance.

### Tier 2 — medium scope
4. **Bootstrap iOS native AVAudioSession bridge** to surface route
   changes (BT vs wired vs speaker) to the JS layer. This lets us
   show real device names on iOS where Web Audio's
   `enumerateDevices` is not available.
5. **Wire LecturePane (Epic 6) and HistoryScreen (Epic 7) into the
   navigator.** The view-models are tested but the screens are
   placeholders; PR #18's screens use a different state shape and
   need to be reconciled with the Epic 6/7 view-models.
6. **Cloudflare Worker entry + `wrangler.toml`.** PR #19 has the
   relay protocol + session store + ingest validator in `src/server/`.
   What's missing is the Worker `fetch` handler that wires those
   together and the deployment config. Roughly ~80 LOC plus a
   `wrangler.toml`. Requires Cloudflare credentials.

### Tier 3 — larger sprints
7. **Native sprint** — Whisper on-device, NLLB on-device, native TTS
   adapters, language pack downloader. Requires Mac + Android Studio
   and 2–4 weeks of focused work. Roadmap §3 has the story-level
   plan.
8. **Group session end-to-end.** Epic 9 has the client primitives
   (invite tokens, group state machine) and Epic 11 has the relay
   protocol. The missing piece is wiring them through a Cloudflare
   Worker host, plus QR / link share UX for invites.

---

## 10. Where everything lives

A 30-second "directory orientation" for the incoming developer:

```
projects/smart-translator-earphone/
├── README.md                            ← project overview
├── _bmad-output/
│   ├── handoff.md                       ← THIS FILE
│   ├── flow-diagram.md                  ← runtime pipeline diagrams (Mermaid)
│   ├── roadmap.md                       ← per-stream backlog
│   ├── reviews/                         ← BA / PM / PO / SM Phase R reviews
│   │   ├── reconciliation-decision.md   ← why PR #4-#10 were closed
│   │   └── …
│   ├── prd.md, architecture.md, …       ← Phase 1-3 artefacts
│   └── adrs/                            ← architecture decision records
└── app/                                 ← Expo project (web + iOS + Android)
    ├── package.json                     ← `npm run quality` is the gate
    ├── jest.config.cjs                  ← tests live next to source
    ├── tsconfig.json                    ← strict mode on
    └── src/
        ├── core/                        ← engines (no React, no RN)
        │   ├── audio/                   ← capture, pipeline, playback, device monitor
        │   ├── stt/                     ← STT providers + router + audio encoding
        │   ├── translation/             ← MT providers + router (paid + free)
        │   ├── tts/                     ← TTS providers + router + voice catalog
        │   ├── lecture/, history/,      ← Epic 6 / 7 view-models
        │   │   settings/, account/, store/
        │   ├── connectivity/, packs/    ← Epic 8
        │   ├── group/                   ← Epic 9
        │   ├── telemetry/, crash/,      ← Epic 10
        │   │   resilience/, onboarding/, privacy/
        │   ├── engine-factory.ts        ← env-driven provider selection
        │   └── engine-router.ts         ← orchestrates capture → STT → MT → TTS
        ├── components/                  ← React Native components
        │   ├── AudioDeviceStatus.tsx
        │   ├── InputSourcePicker.tsx    ← mic vs tab
        │   ├── MicSourcePicker.tsx      ← which mic
        │   └── …
        ├── screens/                     ← Home / Conversation / Lecture / History / Settings
        ├── state/                       ← SessionStore (single React-facing facade)
        ├── server/                      ← Cloudflare Worker logic (Epic 11)
        └── native/                      ← iOS + Android module skeletons
```

---

## 11. Quick reference

- **Open PR:** <https://github.com/arks99-11/BMAD-METHOD/pull/19>
- **Run web app:** `cd projects/smart-translator-earphone/app && npx expo start --web --port 8081`
- **Quality gate:** `npm run quality` at root **and** at `projects/smart-translator-earphone/app/`
- **Conventional commits required.** Pre-commit / pre-push hooks are
  not enforced by the repo, but `AGENTS.md` requires both.
- **Never push to `main` directly.** Always go through a PR.
- **Don't force-push the consolidated branch** until PR #19 merges —
  it's the live target of the open PR.

When in doubt, read [`flow-diagram.md`](./flow-diagram.md) and
[`reviews/reconciliation-decision.md`](./reviews/reconciliation-decision.md)
before changing architecture.
