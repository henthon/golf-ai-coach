# LoopCoach Product Plan

## North Star

Give solo athletes the feeling of having a coach beside them by turning live video into short, timely audio cues.

## First Wedge

Golf practice is the first sport because the user can place a phone on a tripod, repeat a consistent movement, and benefit from immediate correction without walking back to the screen.

## MVP Built Here

- Browser app with camera input, uploaded video input, and demo mode
- Real-time motion analysis that detects swing-like movement from frame changes
- Audio cues through browser speech synthesis
- Session stats: swing count, tempo, stability, range, consistency
- Modes for side view, down-the-line view, and generic sport use
- Local HTTP and optional HTTPS servers

## Honest Limits

The current prototype validates the hands-free coaching experience. It does not yet perform professional-grade pose, club path, face angle, or impact analysis.

## Model Roadmap

1. Add pose estimation for shoulders, hips, knees, head, wrists, and ankles.
2. Add club detection for shaft angle, top position, downswing plane, and follow-through path.
3. Build a coach-labeled dataset of good swings and common faults.
4. Train fault classifiers for a small set of high-value cues.
5. Personalize thresholds by player after 10-20 baseline swings.
6. Expand the same pipeline to tennis serve, basketball shooting, fitness, and rehab exercises.

## Suggested Validation

- Test with 10 golfers using only audio feedback.
- Measure whether users take fewer trips back to the phone.
- Compare cue usefulness against coach labels.
- Track false positives per 10 swings; keep the product quiet unless confidence is high.
