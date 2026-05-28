import SwiftUI

struct ContentView: View {
    @StateObject private var coach = CameraCoachViewModel()
    @State private var strictness: Double = 2

    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.07, blue: 0.12).ignoresSafeArea()

            VStack(spacing: 14) {
                header

                ZStack(alignment: .bottomLeading) {
                    CameraPreview(session: coach.session)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(Color.white.opacity(0.14), lineWidth: 1)
                        )

                    if !coach.isRunning {
                        VStack(spacing: 12) {
                            Image(systemName: "figure.golf")
                                .font(.system(size: 58, weight: .semibold))
                                .foregroundStyle(.green)
                            Text("把 iPhone 架在侧面或正后方")
                                .font(.title2.weight(.bold))
                            Text("点击开始后，挥杆完成时会通过耳机或外放播报最关键的一条建议。")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black.opacity(0.48))
                    }

                    HStack(spacing: 8) {
                        metric("节奏", coach.tempoText)
                        metric("稳定", coach.stabilityText)
                        metric("幅度", coach.rangeText)
                    }
                    .padding(10)
                }
                .frame(maxHeight: 420)

                controls

                currentCue

                stats

                cueLog
            }
            .padding()
        }
        .preferredColorScheme(.dark)
        .task {
            await coach.prepare()
        }
        .onChange(of: strictness) { _, newValue in
            coach.strictness = Int(newValue.rounded())
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("LoopCoach")
                    .font(.largeTitle.weight(.black))
                Text("原生 iPhone 高尔夫耳机教练")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(coach.audioRouteLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.blue.opacity(0.22), in: Capsule())
                Text(coach.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var controls: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Button {
                    coach.toggleSession()
                } label: {
                    Label(coach.isRunning ? "停止指导" : "开始实时指导", systemImage: coach.isRunning ? "stop.fill" : "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)

                Button {
                    coach.testVoice()
                } label: {
                    Label("测试语音", systemImage: "speaker.wave.2.fill")
                }
                .buttonStyle(.bordered)
            }

            HStack {
                Text("反馈强度")
                    .font(.subheadline.weight(.semibold))
                Slider(value: $strictness, in: 1...3, step: 1)
                Text(coach.strictnessLabel)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.yellow)
                    .frame(width: 44, alignment: .trailing)
            }
        }
    }

    private var currentCue: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("当前提示")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(coach.currentCue)
                .font(.title3.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var stats: some View {
        HStack(spacing: 10) {
            metric("挥杆", "\(coach.swingCount)")
            metric("提示", "\(coach.cueCount)")
            metric("输出", coach.audioRouteLabel)
        }
    }

    private var cueLog: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("提示记录")
                .font(.headline)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(coach.cues) { cue in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(cue.time, style: .time)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(cue.text)
                                .font(.callout)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }
        }
        .frame(maxHeight: 220)
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

