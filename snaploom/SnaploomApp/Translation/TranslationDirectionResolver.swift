import Foundation
import NaturalLanguage

struct TranslationDirection: Equatable, Sendable {
    let sourceIdentifier: String
    let targetIdentifier: String
    let label: String
}

/// Preserves Huayi's tested source-language rules while keeping Snaploom's
/// deliberately small Chinese/English/Japanese/Korean partner picker.
enum TranslationDirectionResolver {
    typealias Detector = (_ text: String) -> NLLanguage?

    static func resolve(
        text: String,
        partner: String,
        locale: Locale = .current,
        detector: Detector = NLLanguageRecognizer.dominantLanguage(for:)
    ) -> TranslationDirection? {
        guard ["en", "ja", "ko"].contains(partner),
              let source = sourceIdentifier(text: text, locale: locale, detector: detector)
        else { return nil }

        let sourceCode = languageCode(source)
        let target = sourceCode == partner ? "zh-Hans" : partner
        return TranslationDirection(
            sourceIdentifier: source,
            targetIdentifier: target,
            label: "\(localizedName(source)) → \(localizedName(target))"
        )
    }

    static func sourceIdentifier(
        text: String,
        locale: Locale = .current,
        detector: Detector = NLLanguageRecognizer.dominantLanguage(for:)
    ) -> String? {
        if isLikelyEnglishTechnicalToken(text) { return "en" }
        guard let detected = detector(text), detected != .undetermined else { return nil }

        guard detected == .simplifiedChinese || detected == .traditionalChinese else {
            return detected.rawValue
        }

        let simplified = text.applyingTransform(StringTransform("Hant-Hans"), reverse: false) ?? text
        let traditional = text.applyingTransform(StringTransform("Hans-Hant"), reverse: false) ?? text
        let hasTraditionalEvidence = simplified != text
        let hasSimplifiedEvidence = traditional != text

        if hasSimplifiedEvidence && !hasTraditionalEvidence { return "zh-Hans" }
        if hasTraditionalEvidence && !hasSimplifiedEvidence { return "zh-Hant" }

        if let script = locale.scriptCode {
            return script == "Hant" ? "zh-Hant" : script == "Hans" ? "zh-Hans" : detected.rawValue
        }
        switch locale.regionCode {
        case "TW", "HK", "MO": return "zh-Hant"
        case "CN", "SG", "MY": return "zh-Hans"
        default: return detected.rawValue
        }
    }

    static func isLikelyEnglishTechnicalToken(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...32).contains(trimmed.count) else { return false }

        var containsASCIILetter = false
        for scalar in trimmed.unicodeScalars {
            switch scalar.value {
            case 65...90, 97...122:
                containsASCIILetter = true
            case 48...57, 35, 38, 43, 45, 46, 47, 95:
                continue
            default:
                return false
            }
        }
        return containsASCIILetter
    }

    static func languageCode(_ identifier: String) -> String {
        identifier.split(separator: "-", maxSplits: 1).first.map(String.init)?.lowercased()
            ?? identifier.lowercased()
    }

    private static func localizedName(_ identifier: String) -> String {
        switch languageCode(identifier) {
        case "zh": return "中文"
        case "en": return "英语"
        case "ja": return "日语"
        case "ko": return "韩语"
        default: return "原文"
        }
    }
}
