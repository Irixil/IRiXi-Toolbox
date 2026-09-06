@preconcurrency import AVFoundation
import Foundation

enum TranslationSpeechRate: Double, CaseIterable, Sendable {
    case normal = 1
    case oneAndQuarter = 1.25
    case oneAndHalf = 1.5
    case double = 2
    case triple = 3
    case quadruple = 4
    case quintuple = 5

    static let defaultsKey = "irixi.translation.speechRate"

    var displayName: String {
        switch self {
        case .normal: return "1×"
        case .oneAndQuarter: return "1.25×"
        case .oneAndHalf: return "1.5×"
        case .double: return "2×"
        case .triple: return "3×"
        case .quadruple: return "4×"
        case .quintuple: return "5×"
        }
    }

    static func saved(defaults: UserDefaults = .standard) -> TranslationSpeechRate {
        TranslationSpeechRate(rawValue: defaults.double(forKey: defaultsKey)) ?? .normal
    }

    func save(defaults: UserDefaults = .standard) {
        defaults.set(rawValue, forKey: Self.defaultsKey)
    }
}

enum TranslationSpeechVoiceResolver {
    private static let preferredEnglishIdentifiers = [
        "com.apple.ttsbundle.siri_nicky_en-US_compact",
        "com.apple.ttsbundle.siri_aaron_en-US_compact",
        "com.apple.voice.compact.en-US.Samantha",
    ]

    static func englishVoice() -> AVSpeechSynthesisVoice? {
        let candidates = AVSpeechSynthesisVoice.speechVoices().filter {
            $0.language.caseInsensitiveCompare("en-US") == .orderedSame
        }
        return candidates.max { voiceRank($0) < voiceRank($1) }
            ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    static func rankingScore(
        qualityRawValue: Int,
        name: String,
        identifier: String
    ) -> Int {
        var rank = qualityRawValue * 1_000
        let normalizedIdentifier = identifier.lowercased()
        if let index = preferredEnglishIdentifiers.firstIndex(of: identifier) {
            rank += 200 - index * 10
        }
        if name.lowercased() == "ava" { rank += 250 }
        if name.lowercased() == "samantha" { rank += 20 }
        if normalizedIdentifier.contains(".siri_") { rank += 60 }
        if normalizedIdentifier.contains(".eloquence.") { rank -= 100 }
        if normalizedIdentifier.contains(".speech.synthesis.") { rank -= 200 }
        return rank
    }

    private static func voiceRank(_ voice: AVSpeechSynthesisVoice) -> Int {
        rankingScore(
            qualityRawValue: voice.quality.rawValue,
            name: voice.name,
            identifier: voice.identifier
        )
    }
}

enum TranslationSpeechState: Equatable, Sendable {
    case stopped
    case rendering
    case playing
    case paused
}

private enum TranslationSpeechRenderResult: Sendable {
    case success(URL)
    case failure
}

private final class TranslationSpeechBufferWriter: @unchecked Sendable {
    private let lock = NSLock()
    private let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("irixi-translation-speech-\(UUID().uuidString)")
        .appendingPathExtension("caf")
    private var audioFile: AVAudioFile?
    private var wroteAudio = false
    private var finished = false

    func consume(_ buffer: AVAudioBuffer) -> TranslationSpeechRenderResult? {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return nil }
        guard let pcmBuffer = buffer as? AVAudioPCMBuffer else {
            finished = true
            audioFile = nil
            return .failure
        }
        if pcmBuffer.frameLength == 0 {
            finished = true
            audioFile = nil
            return wroteAudio ? .success(url) : .failure
        }

        do {
            if audioFile == nil {
                audioFile = try AVAudioFile(
                    forWriting: url,
                    settings: pcmBuffer.format.settings,
                    commonFormat: pcmBuffer.format.commonFormat,
                    interleaved: pcmBuffer.format.isInterleaved
                )
            }
            try audioFile?.write(from: pcmBuffer)
            wroteAudio = true
            return nil
        } catch {
            finished = true
            audioFile = nil
            return .failure
        }
    }
}

/// Renders speech once at a natural voice rate, then changes playback speed
/// without changing pitch. This preserves the seven Huayi speed choices,
/// including 3×–5× values that AVSpeechUtterance alone cannot express.
@MainActor
final class TranslationSpeechPlaybackController {
    var onStateChange: ((TranslationSpeechState) -> Void)?

    private(set) var state: TranslationSpeechState = .stopped {
        didSet {
            guard state != oldValue else { return }
            onStateChange?(state)
        }
    }
    private(set) var rate = TranslationSpeechRate.saved()

    private let synthesizer = AVSpeechSynthesizer()
    private let audioEngine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let timePitch = AVAudioUnitTimePitch()
    private var activeAudioFile: AVAudioFile?
    private var activeTemporaryURL: URL?
    private var generation = 0

    init() {
        audioEngine.attach(playerNode)
        audioEngine.attach(timePitch)
        audioEngine.connect(playerNode, to: timePitch, format: nil)
        audioEngine.connect(timePitch, to: audioEngine.mainMixerNode, format: nil)
        timePitch.rate = Float(rate.rawValue)
    }

    func setRate(_ newRate: TranslationSpeechRate) {
        rate = newRate
        rate.save()
        timePitch.rate = Float(newRate.rawValue)
    }

    func speakEnglish(_ text: String) {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        stop()
        generation &+= 1
        let requestGeneration = generation
        let utterance = AVSpeechUtterance(string: content)
        utterance.voice = TranslationSpeechVoiceResolver.englishVoice()
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.96
        utterance.pitchMultiplier = 1
        state = .rendering

        let writer = TranslationSpeechBufferWriter()
        synthesizer.write(utterance) { [weak self] buffer in
            guard let result = writer.consume(buffer) else { return }
            Task { @MainActor [weak self] in
                self?.finishRendering(result, generation: requestGeneration)
            }
        }
    }

    func pause() {
        guard state == .playing else { return }
        playerNode.pause()
        state = .paused
    }

    func resume() {
        guard state == .paused else { return }
        do {
            if !audioEngine.isRunning { try audioEngine.start() }
            playerNode.play()
            state = .playing
        } catch {
            finishPlayback(generation: generation)
        }
    }

    func stop() {
        generation &+= 1
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        playerNode.stop()
        audioEngine.pause()
        activeAudioFile = nil
        removeActiveTemporaryFile()
        state = .stopped
    }

    private func finishRendering(_ result: TranslationSpeechRenderResult, generation: Int) {
        guard generation == self.generation, state == .rendering else {
            if case .success(let url) = result { try? FileManager.default.removeItem(at: url) }
            return
        }
        switch result {
        case .success(let url):
            playRenderedAudio(at: url, generation: generation)
        case .failure:
            finishPlayback(generation: generation)
        }
    }

    private func playRenderedAudio(at url: URL, generation: Int) {
        do {
            let file = try AVAudioFile(forReading: url)
            activeAudioFile = file
            activeTemporaryURL = url
            timePitch.rate = Float(rate.rawValue)
            playerNode.scheduleFile(
                file,
                at: nil,
                completionCallbackType: .dataPlayedBack,
                completionHandler: playbackCompletionHandler(generation: generation)
            )
            audioEngine.prepare()
            if !audioEngine.isRunning { try audioEngine.start() }
            playerNode.play()
            state = .playing
        } catch {
            try? FileManager.default.removeItem(at: url)
            finishPlayback(generation: generation)
        }
    }

    private nonisolated func playbackCompletionHandler(
        generation: Int
    ) -> @Sendable (AVAudioPlayerNodeCompletionCallbackType) -> Void {
        { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.finishPlayback(generation: generation)
            }
        }
    }

    private func finishPlayback(generation: Int) {
        guard generation == self.generation else { return }
        playerNode.stop()
        audioEngine.pause()
        activeAudioFile = nil
        removeActiveTemporaryFile()
        state = .stopped
    }

    private func removeActiveTemporaryFile() {
        if let activeTemporaryURL {
            try? FileManager.default.removeItem(at: activeTemporaryURL)
        }
        activeTemporaryURL = nil
    }
}
