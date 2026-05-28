import Foundation

struct CoachCue: Identifiable {
    let id = UUID()
    let text: String
    let time: Date
}

struct MotionSample {
    let energy: Double
    let centerX: Double
    let centerY: Double
    let widthRatio: Double
    let heightRatio: Double
    let timestamp: TimeInterval
}

struct SwingWindow {
    let startedAt: TimeInterval
    var peakEnergy: Double
    var maxWidth: Double
    var maxHeight: Double
    var minX: Double
    var maxX: Double
    var minY: Double
    var maxY: Double

    mutating func absorb(_ sample: MotionSample) {
        peakEnergy = max(peakEnergy, sample.energy)
        maxWidth = max(maxWidth, sample.widthRatio)
        maxHeight = max(maxHeight, sample.heightRatio)
        minX = min(minX, sample.centerX)
        maxX = max(maxX, sample.centerX)
        minY = min(minY, sample.centerY)
        maxY = max(maxY, sample.centerY)
    }
}

