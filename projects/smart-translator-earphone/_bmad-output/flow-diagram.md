# Smart Translator — End-to-end Flow Diagram

> Audio in → STT → MT → TTS → Audio out, as wired in code today.

This document is a one-page architectural reference for how a single
spoken utterance moves through the app. All diagrams are Mermaid (GitHub
renders them natively).

## 1. High-level pipeline

```mermaid
flowchart LR
    A[🎤 Mic / earphone<br/>AudioCaptureProvider]
    A --> B[AudioPipeline<br/>HighPassFilter<br/>VAD<br/>AudioChunker]
    B -- AudioChunk --> C[SttEngineRouter<br/>Whisper / Google / Mock]
    C -- partial transcript --> U1[UI: TranscriptBubble]
    C -- final transcript --> D[TranslationRouter<br/>DeepL / OpenAI / Google / Mock]
    D --> U2[UI: translated bubble<br/>+ history archive]
    D --> E{speakOutput?}
    E -- yes --> F[TtsEngineRouter<br/>Azure / Google / Mock]
    F --> G[AudioPlaybackQueue]
    G --> H[🔈 Speaker / earphone]
    E -- no<br/>lecture mode --> U2

    AD[🎧 AudioDeviceMonitor<br/>navigator.mediaDevices] -.status.-> U3[UI: Home<br/>AudioDeviceStatus card]

    classDef ui fill:#1e293b,color:#f1f5f9,stroke:#475569;
    classDef io fill:#0f172a,color:#38bdf8,stroke:#38bdf8;
    classDef router fill:#334155,color:#f1f5f9,stroke:#94a3b8;
    classDef monitor fill:#1e293b,color:#34d399,stroke:#34d399,stroke-dasharray: 5 5;
    class U1,U2,U3 ui;
    class A,H io;
    class B,C,D,F,G router;
    class AD monitor;
```

## 2. Conversation-mode sequence (one utterance)

```mermaid
sequenceDiagram
    autonumber
    actor User as 🗣️ Speaker A
    participant Mic as Mic / 🎧 earphone
    participant Cap as AudioCaptureProvider<br/>(Web / Expo)
    participant Pipe as AudioPipeline<br/>(VAD + Chunker + HPF)
    participant Stt as SttEngineRouter
    participant Tr as TranslationRouter
    participant Tts as TtsEngineRouter
    participant Play as AudioPlaybackQueue
    participant Out as 🔈 earphone (other ear)
    participant Store as SessionStore
    participant UI as ConversationScreen

    User->>Mic: speaks "Hello, how are you?"
    loop every 20 ms
        Mic->>Cap: PCM samples (native callback)
        Cap->>Pipe: onFrame(AudioFrame, 16 kHz int16)
    end
    Pipe->>Pipe: HighPassFilter (4-stage, 100 Hz)
    Pipe->>Pipe: VAD: speech start detected
    Pipe->>Pipe: VAD: silence ≥ 700 ms → utterance end
    Pipe->>Stt: AudioChunk { utteranceBoundary: true }
    Stt->>Stt: pick first available provider<br/>(Whisper/Google/Mock)
    Stt-->>Store: SttEvent partial: "Hello"
    Store-->>UI: partial bubble (Speaker A)
    Stt-->>Store: SttEvent partial: "Hello, how"
    Store-->>UI: bubble updates
    Stt-->>Store: SttEvent final: "Hello, how are you?"
    Store-->>UI: bubble status → final<br/>store toggles to Speaker B
    Stt-)Tr: translate({src='en', tgt='es'})
    Tr-->>Store: translation-final: "Hola, ¿cómo estás?"
    Store-->>UI: bubble status → translated
    alt speakOutput=true (conversation)
        Tr-)Tts: synthesize(translation, voice)
        Tts-->>Play: enqueue PCM
        Play->>Out: schedule playback
        Play-->>Store: chunk-start / chunk-end
        Store-->>UI: status indicator pulses
    else speakOutput=false (lecture)
        Note over Tts,Out: TTS skipped — silent transcript only
    end
```

## 3. Component map (state + ownership)

```mermaid
flowchart TB
    subgraph App[Expo app shell]
        H[HomeScreen]
        C[ConversationScreen]
        L[LectureScreen]
        Hi[HistoryScreen]
        S[SettingsScreen]
    end

    subgraph State[State]
        Store[SessionStore<br/>singleton]
        Hook[useSessionStore]
    end

    subgraph Engine[Engine layer]
        Router[EngineRouter]
        Pipe[AudioPipeline]
        SttR[SttEngineRouter]
        TrR[TranslationRouter]
        TtsR[TtsEngineRouter]
        Pb[AudioPlaybackQueue]
    end

    subgraph Providers[Provider chain<br/>fail-over]
        WC[WhisperCloud]
        GS[GoogleSTT]
        MS[MockSTT]
        DL[DeepL]
        OA[OpenAI]
        GT[GoogleMT]
        MT[MockMT]
        AZ[AzureTTS]
        GG[GoogleTTS]
        MTTS[MockTTS]
    end

    subgraph Hardware[Audio I/O abstraction]
        Cap[WebAudioCaptureProvider<br/>or ExpoAudioCaptureProvider]
        Out[ExpoAudioPlaybackProvider]
        Dev[🎧 AudioDeviceMonitor<br/>WebAudioDeviceMonitor]
    end

    H --> Hook
    C --> Hook
    L --> Hook
    Hi --> Hook
    S --> Hook
    Hook --> Store
    Store -->|on Start| Router
    Router --> Pipe
    Router --> SttR
    Router --> TrR
    Router --> TtsR
    Router --> Pb
    Pipe --> Cap
    Pb --> Out
    H -.observes.-> Dev
    Dev -.enumerateDevices<br/>+ devicechange.-> Cap

    SttR --> WC
    SttR --> GS
    SttR --> MS
    TrR --> DL
    TrR --> OA
    TrR --> GT
    TrR --> MT
    TtsR --> AZ
    TtsR --> GG
    TtsR --> MTTS

    classDef ui fill:#1e293b,color:#f1f5f9,stroke:#475569;
    classDef state fill:#334155,color:#f1f5f9,stroke:#94a3b8;
    classDef engine fill:#0c4a6e,color:#bae6fd,stroke:#38bdf8;
    classDef prov fill:#075985,color:#e0f2fe,stroke:#7dd3fc;
    classDef hw fill:#064e3b,color:#a7f3d0,stroke:#34d399;

    class H,C,L,Hi,S ui;
    class Store,Hook state;
    class Router,Pipe,SttR,TrR,TtsR,Pb engine;
    class WC,GS,MS,DL,OA,GT,MT,AZ,GG,MTTS prov;
    class Cap,Out,Dev hw;
```

## 4. Code path (file references)

| Stage | File | Key symbol |
|-------|------|------------|
| User taps **Start Translation** | `src/screens/ConversationScreen.tsx` | `sessionStore.startSession()` |
| Build router from env + selected engines | `src/core/engine-factory.ts` | `createEngineRouter` |
| Orchestrate the full pipeline | `src/core/engine-router.ts` | `EngineRouter.start` / `handleSttEvent` / `translateAndSpeak` |
| Capture mic audio | `src/core/audio/web-audio-capture.ts` (web) <br/>`src/core/audio/expo-audio-capture.ts` (native) | `WebAudioCaptureProvider` |
| Detect connected audio device | `src/core/audio/web-audio-device-monitor.ts` | `WebAudioDeviceMonitor` |
| Voice-activity + chunking + noise reduction | `src/core/audio/audio-pipeline.ts` <br/>`src/core/audio/vad.ts` <br/>`src/core/audio/audio-chunker.ts` <br/>`src/core/audio/noise-reduction.ts` | `AudioPipeline`, `VoiceActivityDetector`, `AudioChunker`, `HighPassFilter` |
| STT provider chain | `src/core/stt/stt-engine-router.ts` | `SttEngineRouter` |
| Translation provider chain | `src/core/translation/translation-router.ts` | `TranslationRouter` |
| TTS provider chain | `src/core/tts/tts-engine-router.ts` | `TtsEngineRouter` |
| Playback queue (low-latency) | `src/core/audio/audio-playback.ts` | `AudioPlaybackQueue` |
| Aggregate state for the UI | `src/state/SessionStore.ts` | `SessionStore` |
| Render transcripts + waveform | `src/screens/ConversationScreen.tsx` <br/>`src/components/TranscriptBubble.tsx` <br/>`src/components/WaveformIndicator.tsx` | — |

## 5. Data shapes (cheat sheet)

```ts
// src/core/audio/audio-types.ts
SAMPLE_RATE_HZ = 16_000
FRAME_DURATION_MS = 20
FRAME_SAMPLES = 320          // = 16_000 × 20 / 1_000

interface AudioFrame  { samples: Int16Array; seq: number; startTimestampMs; durationMs }
interface AudioChunk  { samples: Int16Array; startTimestampMs; durationMs;
                        utteranceBoundary?: boolean; final?: boolean }
type SttEvent         = { type: 'partial' | 'final'; sessionId; text; detectedLang? }
type TranslationResult = { text; sourceLang; targetLang; provider; latencyMs }
```

## 6. Where the AudioDeviceMonitor sits

The new `AudioDeviceMonitor` is a **status-only side channel** — it does
not feed audio into the pipeline. It exists so the Home screen can show
the user *which earphone is connected before they hit Start*.

```mermaid
flowchart LR
    Home[HomeScreen] --> ADS[AudioDeviceStatus]
    ADS --> WADM[WebAudioDeviceMonitor<br/>web platform only]
    ADS -.future.-> Native[Native AudioSession bridge<br/>iOS AVAudioSession + Android AudioManager]
    WADM --> ED[navigator.mediaDevices<br/>enumerateDevices]
    WADM --> DC[devicechange event]
    ED --> Heur[classifyDeviceLabel<br/>bluetooth / wired / speaker / unknown]

    classDef ui fill:#1e293b,color:#f1f5f9,stroke:#475569;
    classDef monitor fill:#064e3b,color:#a7f3d0,stroke:#34d399;
    classDef api fill:#0c4a6e,color:#bae6fd,stroke:#38bdf8;
    class Home,ADS ui;
    class WADM,Native monitor;
    class ED,DC,Heur api;
```
