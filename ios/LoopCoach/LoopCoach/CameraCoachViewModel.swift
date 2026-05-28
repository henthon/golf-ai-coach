import AVFoundation
import Combine
import CoreImage
import SwiftUI

@MainActor
final class CameraCoachViewModel: NSObject, ObservableObject {
    @Published var isRunning = false
    @Published var status = "准备就绪"
    @Published var currentCue = "准备开始。原生 App 会使用 iPhone 的系统音频路由：戴耳机走耳机，没戴耳机走外放。"
    @Published var cues: [CoachCue] = []
    @Published var swingCount = 0
    @Published var cueCount = 0
    @Published var tempoText = "--"
    @Published var stabilityText = "--"
    @Published var rangeText = "--"
    @Published var strictness = 2
    @Published var audioRouteLabel = "外放"

    let session = AVCaptureSession()

    var strictnessLabel: String {
        switch strictness {
        case 1: "少说"
        case 3: "严格"
        default: "平衡"
        }
    }

    private let speech = SpeechCoach()
    private let queue = DispatchQueue(label: "loopcoach.camera")
    private let ciContext = CIContext()
    private var previousPixels: [UInt8]?
    private var frameSkip = 0
    private var swing: SwingWindow?
    private var lastCueAt = Date.distantPast
    private var lastCueText = ""
    private var cancellable: AnyCancellable?

    override init() {
        super.init()
        cancellable = speech.$routeLabel
            .receive(on: DispatchQueue.main)
            .sink { [weak self] label in
                self?.audioRouteLabel = label
            }
    }

    func prepare() async {
        let granted = await AVCaptureDevice.requestAccess(for: .video)
        guard granted else {
            status = "摄像头未授权"
            return
        }
        configureCamera()
    }

    func toggleSession() {
        isRunning ? stop() : start()
    }

    func testVoice() {
        speech.testVoice()
        currentCue = "语音测试已发送。如果连接耳机，会从耳机播；否则会从 iPhone 外放播。"
    }

    private func start() {
        status = "实时分析中"
        isRunning = true
        swingCount = 0
        cueCount = 0
        cues.removeAll()
        previousPixels = nil
        swing = nil
        speech.speak("我开始看你的动作了。先做一次自然挥杆，我会等动作完成后再提示。")
        queue.async { [session] in
            if !session.isRunning {
                session.startRunning()
            }
        }
    }

    private func stop() {
        status = "已暂停"
        isRunning = false
        queue.async { [session] in
            if session.isRunning {
                session.stopRunning()
            }
        }
    }

    private func configureCamera() {
        queue.async {
            self.session.beginConfiguration()
            self.session.sessionPreset = .high

            guard
                let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                let input = try? AVCaptureDeviceInput(device: camera),
                self.session.canAddInput(input)
            else {
                DispatchQueue.main.async { self.status = "摄像头不可用" }
                self.session.commitConfiguration()
                return
            }

            self.session.addInput(input)

            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: self.queue)

            if self.session.canAddOutput(output) {
                self.session.addOutput(output)
            }
            self.session.commitConfiguration()
        }
    }

    private func process(sampleBuffer: CMSampleBuffer) {
        guard isRunning else { return }
        frameSkip = (frameSkip + 1) % 4
        guard frameSkip == 0 else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        guard let sample = makeMotionSample(from: pixelBuffer, timestamp: CACurrentMediaTime()) else { return }
        classify(sample)
    }

    private func makeMotionSample(from pixelBuffer: CVPixelBuffer, timestamp: TimeInterval) -> MotionSample? {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        let targetWidth = 96
        let targetHeight = 54
        let scaleX = CGFloat(targetWidth) / image.extent.width
        let scaleY = CGFloat(targetHeight) / image.extent.height
        let resized = image.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        var pixels = [UInt8](repeating: 0, count: targetWidth * targetHeight * 4)
        ciContext.render(
            resized,
            toBitmap: &pixels,
            rowBytes: targetWidth * 4,
            bounds: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight),
            format: .BGRA8,
            colorSpace: CGColorSpaceCreateDeviceRGB()
        )

        guard let previous = previousPixels else {
            previousPixels = pixels
            return nil
        }
        previousPixels = pixels

        var changed = 0
        var sumX = 0.0
        var sumY = 0.0
        var minX = targetWidth
        var minY = targetHeight
        var maxX = 0
        var maxY = 0

        for y in stride(from: 0, to: targetHeight, by: 2) {
            for x in stride(from: 0, to: targetWidth, by: 2) {
                let i = (y * targetWidth + x) * 4
                let diff = abs(Int(pixels[i]) - Int(previous[i]))
                    + abs(Int(pixels[i + 1]) - Int(previous[i + 1]))
                    + abs(Int(pixels[i + 2]) - Int(previous[i + 2]))
                if diff > 42 {
                    changed += 1
                    sumX += Double(x)
                    sumY += Double(y)
                    minX = min(minX, x)
                    minY = min(minY, y)
                    maxX = max(maxX, x)
                    maxY = max(maxY, y)
                }
            }
        }

        let total = Double((targetWidth / 2) * (targetHeight / 2))
        let energy = Double(changed) / total * 100
        let centerX = changed > 0 ? sumX / Double(changed) / Double(targetWidth) : 0.5
        let centerY = changed > 0 ? sumY / Double(changed) / Double(targetHeight) : 0.5
        let widthRatio = changed > 0 ? Double(maxX - minX) / Double(targetWidth) : 0
        let heightRatio = changed > 0 ? Double(maxY - minY) / Double(targetHeight) : 0

        return MotionSample(
            energy: energy,
            centerX: centerX,
            centerY: centerY,
            widthRatio: widthRatio,
            heightRatio: heightRatio,
            timestamp: timestamp
        )
    }

    private func classify(_ sample: MotionSample) {
        let energyThreshold = strictness == 3 ? 7.5 : strictness == 1 ? 14.0 : 10.5
        let active = sample.energy > energyThreshold

        if swing == nil, active {
            swing = SwingWindow(
                startedAt: sample.timestamp,
                peakEnergy: sample.energy,
                maxWidth: sample.widthRatio,
                maxHeight: sample.heightRatio,
                minX: sample.centerX,
                maxX: sample.centerX,
                minY: sample.centerY,
                maxY: sample.centerY
            )
            return
        }

        guard var currentSwing = swing else { return }
        currentSwing.absorb(sample)
        swing = currentSwing

        let elapsed = sample.timestamp - currentSwing.startedAt
        let quietAgain = sample.energy < max(4.0, energyThreshold * 0.45) && elapsed > 0.65
        let timeout = elapsed > 5.5

        if quietAgain || timeout {
            finish(currentSwing, endedAt: sample.timestamp)
            swing = nil
        }
    }

    private func finish(_ swing: SwingWindow, endedAt: TimeInterval) {
        let duration = endedAt - swing.startedAt
        guard duration > 0.55, swing.peakEnergy > 9 else { return }

        swingCount += 1
        let tempo = min(3.5, max(0.4, duration))
        let sway = abs(swing.maxX - swing.minX)
        let vertical = swing.maxY - swing.minY
        let rangeScore = Int(min(100, max(25, swing.maxWidth * 185 + swing.maxHeight * 62)))
        let stabilityScore = Int(max(20, 100 - sway * 220 - vertical * 65))

        tempoText = String(format: "%.1fs", tempo)
        stabilityText = "\(stabilityScore)"
        rangeText = "\(rangeScore)"

        let cue = chooseCue(tempo: tempo, sway: sway, vertical: vertical, rangeScore: rangeScore, stabilityScore: stabilityScore)
        addCue(cue)
    }

    private func chooseCue(tempo: Double, sway: Double, vertical: Double, rangeScore: Int, stabilityScore: Int) -> String {
        if tempo < 0.95 {
            return "这杆节奏太急。下一杆，先把上杆放慢，转身完成后再启动下杆。"
        }
        if sway > (strictness == 3 ? 0.12 : 0.17) {
            return "身体横向晃动偏多。下一杆，右脚内侧稳住，像绕身体中轴转过去。"
        }
        if vertical > 0.24 {
            return "击球区身体高度变化明显。下一杆，保持头部高度，等收杆后再看球。"
        }
        if rangeScore < 48 {
            return "动作幅度偏小。先不加力，把肩膀转满，再让手臂自然跟上。"
        }
        if stabilityScore > 76 {
            return "这杆整体更稳定。记住这个节奏，下一杆复制同样的上杆速度。"
        }
        return "这一杆没有明显问题。继续保持站位和节奏。"
    }

    private func addCue(_ text: String) {
        let now = Date()
        let cooldown: TimeInterval = strictness == 3 ? 3.0 : strictness == 1 ? 7.0 : 4.8
        guard text != lastCueText || now.timeIntervalSince(lastCueAt) > 10 else { return }
        guard now.timeIntervalSince(lastCueAt) > cooldown else { return }

        lastCueAt = now
        lastCueText = text
        cueCount += 1
        currentCue = text
        cues.insert(CoachCue(text: text, time: now), at: 0)
        cues = Array(cues.prefix(20))
        speech.speak(text)
    }
}

extension CameraCoachViewModel: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        Task { @MainActor in
            self.process(sampleBuffer: sampleBuffer)
        }
    }
}
