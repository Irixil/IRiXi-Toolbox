import AppKit
import NaturalLanguage
@preconcurrency import Translation

/// Input translation stays entirely inside the native helper. Source text and
/// translated text are never returned through the helper's JSONL status pipe.
@MainActor
final class NativeInputTranslationWindowController: NSObject, NSWindowDelegate, NSTextViewDelegate {
    static let partnerDefaultsKey = "irixi.translation.partner"
    static let maximumTextCharacters = 5_000

    private let window: NSWindow
    private let partnerPicker = NSPopUpButton()
    private let directionLabel = NSTextField(labelWithString: "中文 ↔ 英语")
    private let sourceTextView = NSTextView()
    private let resultTextView = NSTextView()
    private let statusLabel = NSTextField(labelWithString: "输入文字后点“翻译”")
    private let translateButton = NSButton(title: "翻译", target: nil, action: nil)
    private let speechButton = NSButton(title: "朗读英文", target: nil, action: nil)
    private let pauseSpeechButton = NSButton(title: "暂停", target: nil, action: nil)
    private let stopSpeechButton = NSButton(title: "停止", target: nil, action: nil)
    private let speechRatePicker = NSPopUpButton()
    private let copyButton = NSButton(title: "复制译文", target: nil, action: nil)
    private let shortcutRecorder: TranslationShortcutRecorderButton
    private let speechController = TranslationSpeechPlaybackController()

    private var partner = "en"
    private var translationID = UUID()
    private var englishSpeechText = ""
    private var steadyStatus = "输入文字后点“翻译”"
    private var pendingAutomaticTranslation: DispatchWorkItem?

    init(
        onShortcutChange: @escaping (TranslationShortcutDefinition) -> Bool
    ) {
        shortcutRecorder = TranslationShortcutRecorderButton()
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 500),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init()

        shortcutRecorder.onShortcutRecorded = onShortcutChange
        shortcutRecorder.onMessage = { [weak self] message in
            self?.setSteadyStatus(message)
        }
        speechController.onStateChange = { [weak self] state in
            self?.updateSpeechUI(state)
        }
        configureWindow()
        buildContent()
    }

    func show(partner: String) {
        setPartner(partner)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.center()
        window.makeFirstResponder(sourceTextView)
    }

    func showSelection(_ text: String, partner: String) {
        show(partner: partner)
        sourceTextView.string = text
        translate()
    }

    func showSelectionError(_ error: TranslationSelectionError, partner: String) {
        show(partner: partner)
        switch error {
        case .accessibilityPermission:
            setSteadyStatus("需要辅助功能权限才能读取所选文字；仍可直接粘贴翻译")
        case .noSelection:
            setSteadyStatus("没有读到所选文字；请在上方手动粘贴，或回原应用重新选择")
        case .protectedContent:
            setSteadyStatus("出于安全考虑，密码等受保护内容不能划译")
        case .textTooLong:
            setSteadyStatus("所选文字太长，请缩短到 5000 个字符以内")
        }
        NSSound.beep()
    }

    func showShortcutMessage(_ message: String) {
        setSteadyStatus(message)
    }

    private func configureWindow() {
        window.title = "IRiXi 输入翻译"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 520, height: 430)
        window.delegate = self
    }

    private func buildContent() {
        partnerPicker.addItems(withTitles: ["英语", "日语", "韩语"])
        partnerPicker.target = self
        partnerPicker.action = #selector(partnerChanged)

        directionLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        directionLabel.textColor = .secondaryLabelColor

        sourceTextView.font = .systemFont(ofSize: 15)
        sourceTextView.delegate = self
        sourceTextView.isRichText = false
        sourceTextView.allowsUndo = true
        sourceTextView.textContainerInset = NSSize(width: 10, height: 10)

        resultTextView.font = .systemFont(ofSize: 15)
        resultTextView.isEditable = false
        resultTextView.isSelectable = true
        resultTextView.isRichText = false
        resultTextView.backgroundColor = .controlBackgroundColor
        resultTextView.textContainerInset = NSSize(width: 10, height: 10)

        translateButton.target = self
        translateButton.action = #selector(translate)
        translateButton.keyEquivalent = "\r"
        translateButton.bezelStyle = .rounded

        speechButton.target = self
        speechButton.action = #selector(toggleSpeech)
        speechButton.bezelStyle = .rounded
        speechButton.isEnabled = false

        pauseSpeechButton.target = self
        pauseSpeechButton.action = #selector(toggleSpeechPause)
        pauseSpeechButton.bezelStyle = .rounded
        pauseSpeechButton.isEnabled = false

        stopSpeechButton.target = self
        stopSpeechButton.action = #selector(stopSpeechFromButton)
        stopSpeechButton.bezelStyle = .rounded
        stopSpeechButton.isEnabled = false

        speechRatePicker.addItems(withTitles: TranslationSpeechRate.allCases.map(\.displayName))
        speechRatePicker.selectItem(
            at: TranslationSpeechRate.allCases.firstIndex(of: speechController.rate) ?? 0
        )
        speechRatePicker.target = self
        speechRatePicker.action = #selector(speechRateChanged)
        speechRatePicker.toolTip = "英文朗读速度"

        copyButton.target = self
        copyButton.action = #selector(copyTranslation)
        copyButton.bezelStyle = .rounded
        copyButton.isEnabled = false

        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.maximumNumberOfLines = 2

        let header = NSStackView(views: [directionLabel, NSView(), shortcutRecorder, partnerPicker])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 10

        let buttons = NSStackView(views: [
            translateButton,
            speechButton,
            pauseSpeechButton,
            stopSpeechButton,
            speechRatePicker,
            copyButton,
            NSView(),
        ])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8

        let sourceScroll = scrollView(for: sourceTextView)
        let resultScroll = scrollView(for: resultTextView)
        sourceScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true
        resultScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true

        let stack = NSStackView(views: [
            header,
            fieldLabel("原文"),
            sourceScroll,
            buttons,
            fieldLabel("译文"),
            resultScroll,
            statusLabel,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false

        guard let content = window.contentView else { return }
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -18),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 18),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -16),
            header.widthAnchor.constraint(equalTo: stack.widthAnchor),
            sourceScroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            buttons.widthAnchor.constraint(equalTo: stack.widthAnchor),
            resultScroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    func textDidChange(_ notification: Notification) {
        guard (notification.object as? NSTextView) === sourceTextView else { return }
        pendingAutomaticTranslation?.cancel()
        translationID = UUID()

        let text = sourceTextView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= Self.maximumTextCharacters else { return }

        let work = DispatchWorkItem { [weak self] in self?.translate() }
        pendingAutomaticTranslation = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func scrollView(for textView: NSTextView) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.borderType = .bezelBorder
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.documentView = textView
        textView.minSize = NSSize(width: 0, height: 90)
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        return scroll
    }

    private func fieldLabel(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func setPartner(_ identifier: String) {
        partner = ["en", "ja", "ko"].contains(identifier) ? identifier : "en"
        UserDefaults.standard.set(partner, forKey: Self.partnerDefaultsKey)
        partnerPicker.selectItem(at: ["en", "ja", "ko"].firstIndex(of: partner) ?? 0)
        directionLabel.stringValue = "中文 ↔ \(partnerName)"
        if partner != "en" {
            stopSpeech()
            englishSpeechText = ""
            speechButton.isEnabled = false
        }
    }

    private var partnerName: String {
        ["en": "英语", "ja": "日语", "ko": "韩语"][partner] ?? "英语"
    }

    @objc private func partnerChanged() {
        let identifiers = ["en", "ja", "ko"]
        setPartner(identifiers[max(0, partnerPicker.indexOfSelectedItem)])
        resultTextView.string = ""
        copyButton.isEnabled = false
        setSteadyStatus("已切换为中文与\(partnerName)互译")
    }

    @objc private func translate() {
        pendingAutomaticTranslation?.cancel()
        pendingAutomaticTranslation = nil
        let text = sourceTextView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            setSteadyStatus("请先输入或粘贴要翻译的文字")
            NSSound.beep()
            return
        }
        guard text.count <= Self.maximumTextCharacters else {
            setSteadyStatus("文字太长，请缩短到 5000 个字符以内")
            NSSound.beep()
            return
        }

        stopSpeech()
        if let explanation = AbbreviationGlossary.explanation(for: text) {
            translationID = UUID()
            directionLabel.stringValue = "英文缩写解释"
            let result = [
                "\(explanation.abbreviation) · \(explanation.fullName)",
                explanation.chineseMeaning,
                "用法：\(explanation.usage)",
            ].joined(separator: "\n\n")
            resultTextView.string = result
            copyButton.isEnabled = true
            englishSpeechText = "\(explanation.abbreviation). \(explanation.fullName)"
            speechButton.isEnabled = true
            setSteadyStatus("本机缩写解释 · 不联网")
            return
        }

        guard #available(macOS 15.0, *) else {
            setSteadyStatus("输入翻译需要 macOS 15 或更高版本")
            return
        }

        guard let direction = TranslationDirectionResolver.resolve(text: text, partner: partner) else {
            setSteadyStatus("无法判断原文语言，请补充更多文字后重试")
            return
        }
        let source = Locale.Language(identifier: direction.sourceIdentifier)
        let target = Locale.Language(identifier: direction.targetIdentifier)
        directionLabel.stringValue = direction.label

        let requestID = UUID()
        translationID = requestID
        translateButton.isEnabled = false
        copyButton.isEnabled = false
        speechButton.isEnabled = false
        resultTextView.string = ""
        setSteadyStatus("正在准备 Apple 本机翻译…首次使用可能需要下载语言包")

        let configuration = TranslationSession.Configuration(source: source, target: target)
        TranslationBridge.shared.translate(texts: [text], configuration: configuration) { [weak self] result in
            guard let self, self.translationID == requestID else { return }
            self.translateButton.isEnabled = true
            switch result {
            case .success(let values):
                let translated = values.first ?? ""
                self.resultTextView.string = translated
                self.copyButton.isEnabled = !translated.isEmpty
                let sourceIsEnglish = TranslationDirectionResolver.languageCode(
                    direction.sourceIdentifier
                ) == "en"
                let targetIsEnglish = TranslationDirectionResolver.languageCode(
                    direction.targetIdentifier
                ) == "en"
                self.englishSpeechText = sourceIsEnglish ? text : targetIsEnglish ? translated : ""
                self.speechButton.isEnabled = !self.englishSpeechText.isEmpty
                self.setSteadyStatus("翻译完成 · 文字只在本机助手中处理")
            case .failure:
                self.resultTextView.string = ""
                self.englishSpeechText = ""
                self.setSteadyStatus("翻译没有完成。请确认语言包可用后重试")
            }
        }
    }

    @objc private func toggleSpeech() {
        guard !englishSpeechText.isEmpty else { return }
        speechController.speakEnglish(englishSpeechText)
    }

    @objc private func toggleSpeechPause() {
        if speechController.state == .paused {
            speechController.resume()
        } else {
            speechController.pause()
        }
    }

    @objc private func stopSpeechFromButton() {
        stopSpeech()
    }

    @objc private func speechRateChanged() {
        let rates = TranslationSpeechRate.allCases
        let index = max(0, min(speechRatePicker.indexOfSelectedItem, rates.count - 1))
        speechController.setRate(rates[index])
        if speechController.state == .stopped {
            setSteadyStatus("英文朗读速度：\(rates[index].displayName)")
        } else {
            updateSpeechUI(speechController.state)
        }
    }

    @objc private func copyTranslation() {
        let translated = resultTextView.string
        guard !translated.isEmpty else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(translated, forType: .string)
        setSteadyStatus("译文已复制")
    }

    private func stopSpeech() {
        speechController.stop()
    }

    private func setSteadyStatus(_ value: String) {
        steadyStatus = value
        if speechController.state == .stopped {
            statusLabel.stringValue = value
        }
    }

    private func updateSpeechUI(_ state: TranslationSpeechState) {
        let speed = speechController.rate.displayName
        switch state {
        case .stopped:
            speechButton.title = "朗读英文"
            speechButton.isEnabled = !englishSpeechText.isEmpty
            pauseSpeechButton.title = "暂停"
            pauseSpeechButton.isEnabled = false
            stopSpeechButton.isEnabled = false
            statusLabel.stringValue = steadyStatus
        case .rendering:
            speechButton.title = "重新朗读"
            speechButton.isEnabled = true
            pauseSpeechButton.title = "暂停"
            pauseSpeechButton.isEnabled = false
            stopSpeechButton.isEnabled = true
            statusLabel.stringValue = "正在准备英文朗读 · \(speed)"
        case .playing:
            speechButton.title = "重新朗读"
            speechButton.isEnabled = true
            pauseSpeechButton.title = "暂停"
            pauseSpeechButton.isEnabled = true
            stopSpeechButton.isEnabled = true
            statusLabel.stringValue = "正在朗读英文 · \(speed)"
        case .paused:
            speechButton.title = "重新朗读"
            speechButton.isEnabled = true
            pauseSpeechButton.title = "继续"
            pauseSpeechButton.isEnabled = true
            stopSpeechButton.isEnabled = true
            statusLabel.stringValue = "英文朗读已暂停 · \(speed)"
        }
    }

    func windowWillClose(_ notification: Notification) {
        pendingAutomaticTranslation?.cancel()
        pendingAutomaticTranslation = nil
        translationID = UUID()
        if #available(macOS 15.0, *) {
            TranslationBridge.shared.cancel()
        }
        stopSpeech()
    }
}
