import AVFoundation
import AppKit
import Carbon.HIToolbox
import Foundation

@main
struct TranslationBasicsChecks {
    static func main() {
        expect(
            TranslationSpeechRate.allCases.map(\.rawValue) == [1, 1.25, 1.5, 2, 3, 4, 5],
            "seven speech rates"
        )
        expect(
            TranslationSpeechRate.allCases.map(\.displayName)
                == ["1×", "1.25×", "1.5×", "2×", "3×", "4×", "5×"],
            "speech rate labels"
        )

        let suite = "TranslationBasicsChecks.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            fail("temporary defaults")
        }
        defaults.removePersistentDomain(forName: suite)
        expect(TranslationSpeechRate.saved(defaults: defaults) == .normal, "default rate")
        TranslationSpeechRate.quintuple.save(defaults: defaults)
        expect(TranslationSpeechRate.saved(defaults: defaults) == .quintuple, "saved rate")
        defaults.set(9, forKey: TranslationSpeechRate.defaultsKey)
        expect(TranslationSpeechRate.saved(defaults: defaults) == .normal, "invalid rate fallback")
        defaults.removePersistentDomain(forName: suite)

        let rag = AbbreviationGlossary.explanation(for: "R.A.G.")
        expect(rag?.fullName == "Retrieval-Augmented Generation", "RAG full name")
        expect(rag?.chineseMeaning == "检索增强生成", "RAG Chinese meaning")
        expect(rag?.usage.contains("检索") == true, "RAG usage")
        expect(AbbreviationGlossary.explanation(for: "CI/CD")?.abbreviation == "CI/CD", "CI/CD separators")
        expect(AbbreviationGlossary.explanation(for: "utf-8")?.abbreviation == "UTF-8", "UTF-8 separators")
        expect(AbbreviationGlossary.explanation(for: "k8s")?.fullName == "Kubernetes", "K8s case")
        expect(AbbreviationGlossary.explanation(for: "hello") == nil, "ordinary word rejection")
        expect(AbbreviationGlossary.explanation(for: "XYZQ") == nil, "unknown abbreviation rejection")

        expect(TranslationShortcutDefinition.defaultValue.displayString == "⌃⌥Y", "default shortcut")
        expect(TranslationShortcutDefinition.defaultValue.isValid, "valid default shortcut")
        TranslationShortcutDefinition.defaultValue.save(defaults: defaults)
        expect(
            TranslationShortcutDefinition.load(defaults: defaults)
                == TranslationShortcutDefinition.defaultValue,
            "saved shortcut"
        )

        defaults.removePersistentDomain(forName: suite)
        TranslationShortcutDefinition.legacyDefaultValue.save(defaults: defaults)
        expect(
            TranslationShortcutDefinition.load(defaults: defaults)
                == TranslationShortcutDefinition.defaultValue,
            "legacy default migration"
        )

        defaults.removePersistentDomain(forName: suite)
        let customShortcut = TranslationShortcutDefinition(
            keyCode: UInt32(kVK_ANSI_J),
            modifiers: [.command, .shift]
        )
        customShortcut.save(defaults: defaults)
        expect(
            TranslationShortcutDefinition.load(defaults: defaults) == customShortcut,
            "custom shortcut preservation"
        )

        expect(TranslationSelectionService.maximumTextCharacters == 5_000, "selection limit")
        checkPasteboardRestoration()
        checkLanguageResolution()

        let compact = TranslationSpeechVoiceResolver.rankingScore(
            qualityRawValue: AVSpeechSynthesisVoiceQuality.default.rawValue,
            name: "Samantha",
            identifier: "com.apple.voice.compact.en-US.Samantha"
        )
        let enhanced = TranslationSpeechVoiceResolver.rankingScore(
            qualityRawValue: AVSpeechSynthesisVoiceQuality.enhanced.rawValue,
            name: "Ava",
            identifier: "com.apple.voice.enhanced.en-US.Ava"
        )
        expect(enhanced > compact, "enhanced voice preference")

        print("translation basics checks passed")
    }

    private static func checkLanguageResolution() {
        for token in ["NL", "JA", "XYZQ", "K8s", "CI/CD", "UTF-8", "C++", "C#"] {
            let source = TranslationDirectionResolver.sourceIdentifier(
                text: token,
                locale: Locale(identifier: "zh_CN"),
                detector: { _ in .dutch }
            )
            expect(source == "en", "technical token \(token)")
        }

        let chineseToEnglish = TranslationDirectionResolver.resolve(
            text: "你好",
            partner: "en",
            locale: Locale(identifier: "zh_CN"),
            detector: { _ in .simplifiedChinese }
        )
        expect(chineseToEnglish?.sourceIdentifier == "zh-Hans", "simplified source")
        expect(chineseToEnglish?.targetIdentifier == "en", "Chinese to partner")
        expect(chineseToEnglish?.label == "中文 → 英语", "Chinese direction label")

        let englishToChinese = TranslationDirectionResolver.resolve(
            text: "Hello",
            partner: "en",
            detector: { _ in .english }
        )
        expect(englishToChinese?.targetIdentifier == "zh-Hans", "partner to Chinese")
        expect(englishToChinese?.label == "英语 → 中文", "English direction label")

        let englishToJapanese = TranslationDirectionResolver.resolve(
            text: "GPU",
            partner: "ja",
            detector: { _ in .dutch }
        )
        expect(englishToJapanese?.sourceIdentifier == "en", "technical English source")
        expect(englishToJapanese?.targetIdentifier == "ja", "technical English to Japanese")
        expect(englishToJapanese?.label == "英语 → 日语", "technical direction label")

        let traditional = TranslationDirectionResolver.sourceIdentifier(
            text: "請把繁體方案發給我",
            locale: Locale(identifier: "zh_CN"),
            detector: { _ in .simplifiedChinese }
        )
        expect(traditional == "zh-Hant", "traditional evidence")
        expect(
            TranslationDirectionResolver.resolve(
                text: "?",
                partner: "en",
                detector: { _ in .undetermined }
            ) == nil,
            "undetermined source"
        )
    }

    private static func checkPasteboardRestoration() {
        let name = NSPasteboard.Name("irixi.translation.checks.\(UUID().uuidString)")
        let pasteboard = NSPasteboard(name: name)
        pasteboard.clearContents()

        let customType = NSPasteboard.PasteboardType("com.irixi.translation-check")
        let first = NSPasteboardItem()
        first.setString("original text", forType: .string)
        first.setData(Data([0x01, 0x02, 0x03]), forType: customType)
        let second = NSPasteboardItem()
        second.setString("second item", forType: .string)
        expect(pasteboard.writeObjects([first, second]), "prepare pasteboard")

        let snapshot = TranslationPasteboardSnapshot.capture(from: pasteboard)
        pasteboard.clearContents()
        pasteboard.setString("temporary", forType: .string)
        snapshot.restore(to: pasteboard)

        let restored = pasteboard.pasteboardItems ?? []
        expect(restored.count == 2, "restore all pasteboard items")
        expect(restored[0].string(forType: .string) == "original text", "restore text type")
        expect(restored[0].data(forType: customType) == Data([0x01, 0x02, 0x03]), "restore custom type")
        expect(restored[1].string(forType: .string) == "second item", "restore second item")
        pasteboard.clearContents()
    }

    private static func expect(_ condition: @autoclosure () -> Bool, _ label: String) {
        if !condition() { fail(label) }
    }

    private static func fail(_ label: String) -> Never {
        FileHandle.standardError.write(Data("translation basics check failed: \(label)\n".utf8))
        exit(1)
    }
}
