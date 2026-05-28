import AVFoundation
import Combine

final class SpeechCoach: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var routeLabel = "外放"

    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
        configureAudioSession()
        updateRouteLabel()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(routeChanged),
            name: AVAudioSession.routeChangeNotification,
            object: nil
        )
    }

    func testVoice() {
        speak("耳机测试。听到这句话，就说明实时教练语音已经打开。", interrupt: true)
    }

    func speak(_ text: String, interrupt: Bool = true) {
        configureAudioSession()
        if interrupt {
            synthesizer.stopSpeaking(at: .immediate)
        }

        let utterance = AVSpeechUtterance(string: paced(text))
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        utterance.rate = 0.46
        utterance.pitchMultiplier = 1.02
        utterance.volume = 1.0
        synthesizer.speak(utterance)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            updateRouteLabel()
        } catch {
            routeLabel = "音频未就绪"
        }
    }

    @objc private func routeChanged() {
        updateRouteLabel()
    }

    private func updateRouteLabel() {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        let hasHeadphones = outputs.contains { port in
            [.bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .headphones].contains(port.portType)
        }
        routeLabel = hasHeadphones ? "耳机" : "外放"
    }

    private func paced(_ text: String) -> String {
        text
            .replacingOccurrences(of: "。", with: "。 ")
            .replacingOccurrences(of: "，", with: "， ")
            .replacingOccurrences(of: "下一杆", with: "下一杆，")
    }
}

