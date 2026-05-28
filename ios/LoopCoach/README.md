# LoopCoach iOS

This is the native iPhone prototype for LoopCoach.

## Why native

The web prototype can show camera/video feedback, but mobile browsers may block delayed speech. The native iOS app uses:

- `AVCaptureSession` for camera frames
- `AVSpeechSynthesizer` for coaching voice
- `AVAudioSession` with `.playback` and `.spokenAudio`
- iOS system audio routing: headphones when connected, speaker when not connected

## Open

Install Xcode, then open:

```text
/Users/wu/golf-ai-coach/ios/LoopCoach/LoopCoach.xcodeproj
```

Select your iPhone as the run target and press Run.

## Current MVP

- Live back-camera preview
- Motion-based swing detection
- Swing count, tempo, stability, and range metrics
- Voice test button
- Real-time coaching cue log
- Native audio route display: `耳机` or `外放`

## Notes

This is still a prototype. It uses motion heuristics, not professional pose or club tracking yet. The next version should add Vision/Core ML pose detection and a coach-labeled swing dataset.

