# LoopCoach

LoopCoach is a browser-based MVP for a real-time golf audio coach. It uses the camera or an uploaded swing video, watches motion patterns in real time, and speaks concise coaching cues through the system audio or connected earphones.

## Run

```bash
cd /Users/wu/golf-ai-coach
python3 -m http.server 5173
```

Open:

```text
http://localhost:5173
```

For phone camera testing, use the HTTPS server instead:

```bash
cd /Users/wu/golf-ai-coach
python3 serve_https.py
```

It prints a phone URL like:

```text
https://<your-computer-lan-ip>:5443
```

The browser may show a certificate warning because this is a local prototype. If camera permission is still blocked, use the upload-video button or the demo button to test the coaching loop.

## MVP Scope

- Live camera or uploaded video input
- Real-time motion analysis without external installs
- Optional MediaPipe pose-model enhancement when the browser can load it
- Audio coaching through Web Speech
- Side view, down-the-line, and generic sport modes
- Swing count, tempo, range, stability, cue history
- Recalibration and feedback strictness controls

This prototype is useful for validating the hands-free training experience. It is not yet a professional biomechanics model. The next version should add pose estimation and club tracking, then validate against coach-labeled swing videos.

## Public Deployment

See [DEPLOY.md](./DEPLOY.md). The current MVP can be deployed as a static HTTPS site. A backend server is only needed later for accounts, saved videos, payments, datasets, or server-side AI.
