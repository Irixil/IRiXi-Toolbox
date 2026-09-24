import AppKit
import NaturalLanguage
@preconcurrency import Translation

/// Apple translation is local. Optional Codex explanation sends only the
/// explicitly submitted text and this window's recent dialogue to OpenAI.
@MainActor
final class NativeInputTranslationWindowController: NSObject, NSWindowDelegate, NSTextViewDelegate {
    static let partnerDefaultsKey = "irixi.translation.partner"
    static let maximumTextCharacters = 5_000
    static let aiConsentDefaultsKey = "irixi.translation.codex-consent-v1"

    private let window: NSWindow
    private let partnerPicker = NSPopUpButton()
    private let directionLabel = NSTextField(labelWithString: "中文 ↔ 英语")
    private let sourceTextView = NSTextView()
    private let resultTextView = NSTextView()
    private let detailTextView = NSTextView()
    private let statusLabel = NSTextField(labelWithString: "输入文字后点“翻译”")
    private let translateButton = NSButton(title: "翻译", target: nil, action: nil)
    private let detailButton = NSButton(title: "详细释义", target: nil, action: nil)
    private let aiExplainButton = NSButton(title: "AI 解释", target: nil, action: nil)
    private let aiSettingsButton = NSButton(title: "账号说明", target: nil, action: nil)
    private let followupField = NSTextField()
    private let followupButton = NSButton(title: "追问", target: nil, action: nil)
    private let webSearchButton = NSButton(checkboxWithTitle: "联网核实", target: nil, action: nil)
    private let speechButton = NSButton(title: "朗读英文", target: nil, action: nil)
    private let pauseSpeechButton = NSButton(title: "暂停", target: nil, action: nil)
    private let stopSpeechButton = NSButton(title: "停止", target: nil, action: nil)
    private let speechRatePicker = NSPopUpButton()
    private let copyButton = NSButton(title: "复制译文", target: nil, action: nil)
    private let shortcutRecorder: TranslationShortcutRecorderButton
    private let speechController = TranslationSpeechPlaybackController()
    private let aiExplanationService = CodexTranslationService()
    private var chatHistory: [(question: String, answer: String)] = []
    private var chatSource = ""
    private let onUserTextChange: () -> Void

    private var partner = "en"
    private var translationID = UUID()
    private var englishSpeechText = ""
    private var steadyStatus = "输入文字后点“翻译”"
    private var pendingAutomaticTranslation: DispatchWorkItem?
    private var aiExplanationRunning = false

    init(
        onShortcutChange: @escaping (TranslationShortcutDefinition) -> Bool,
        onUserTextChange: @escaping () -> Void = {}
    ) {
        shortcutRecorder = TranslationShortcutRecorderButton()
        self.onUserTextChange = onUserTextChange
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 680, height: 720),
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
        translateButton.isEnabled = true
        window.level = .screenSaver
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        window.makeFirstResponder(sourceTextView)
    }

    func showSelection(_ text: String, partner: String) {
        cancelAIExplanation(updateStatus: false)
        resetChat()
        show(partner: partner)
        sourceTextView.string = text
        translate()
    }

    func showImageRecognitionPending(partner: String) {
        show(partner: partner)
        resetForImageRecognition()
        translateButton.isEnabled = false
        setSteadyStatus("正在识别截图中的文字…")
    }

    func showImageRecognitionFailure(_ message: String, partner: String) {
        show(partner: partner)
        resetForImageRecognition()
        setSteadyStatus(message + "可以在上方手动输入或粘贴后重试。")
        window.makeFirstResponder(sourceTextView)
        NSSound.beep()
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
        window.title = "IRiXi 翻译与朗读"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 620, height: 680)
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

        detailTextView.font = .systemFont(ofSize: 14)
        detailTextView.isEditable = false
        detailTextView.isSelectable = true
        detailTextView.isRichText = true
        detailTextView.backgroundColor = .controlBackgroundColor
        detailTextView.textContainerInset = NSSize(width: 10, height: 10)
        detailTextView.string = "本机词典不联网。点击 AI 解释使用 Codex 会员额度 · Luna 低思考。"

        translateButton.target = self
        translateButton.action = #selector(translate)
        translateButton.keyEquivalent = "\r"
        translateButton.bezelStyle = .rounded

        detailButton.target = self
        detailButton.action = #selector(showLocalExplanation)
        detailButton.bezelStyle = .rounded

        aiExplainButton.target = self
        aiExplainButton.action = #selector(explainWithAI)
        aiExplainButton.bezelStyle = .rounded

        aiSettingsButton.target = self
        aiSettingsButton.action = #selector(configureAI)
        aiSettingsButton.bezelStyle = .rounded

        followupField.placeholderString = "继续问，例如：能举个例子吗？"
        followupField.setAccessibilityLabel("向 AI 追问")
        followupField.target = self
        followupField.action = #selector(askFollowup)
        followupButton.target = self
        followupButton.action = #selector(askFollowup)
        followupButton.bezelStyle = .rounded
        followupButton.isEnabled = false
        followupField.isEnabled = false
        webSearchButton.toolTip = "勾选后允许网页搜索，会增加耗时和额度消耗"

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

        let knowledgeButtons = NSStackView(views: [
            detailButton,
            aiExplainButton,
            aiSettingsButton,
            webSearchButton,
            NSView(),
        ])
        knowledgeButtons.orientation = .horizontal
        knowledgeButtons.alignment = .centerY
        knowledgeButtons.spacing = 8

        let sourceScroll = scrollView(for: sourceTextView)
        let resultScroll = scrollView(for: resultTextView)
        let detailScroll = scrollView(for: detailTextView)
        sourceScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 105).isActive = true
        resultScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 90).isActive = true
        detailScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 175).isActive = true
        let followupRow = NSStackView(views: [followupField, followupButton])
        followupRow.orientation = .horizontal
        followupRow.spacing = 8
        followupField.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let stack = NSStackView(views: [
            header,
            fieldLabel("原文"),
            sourceScroll,
            buttons,
            fieldLabel("译文"),
            resultScroll,
            knowledgeButtons,
            fieldLabel("详细释义"),
            detailScroll,
            followupRow,
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
            knowledgeButtons.widthAnchor.constraint(equalTo: stack.widthAnchor),
            detailScroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            followupRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    func textDidChange(_ notification: Notification) {
        guard (notification.object as? NSTextView) === sourceTextView else { return }
        onUserTextChange()
        pendingAutomaticTranslation?.cancel()
        translationID = UUID()
        cancelAIExplanation(updateStatus: false)
        resetChat()
        detailTextView.string = ""

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
        cancelAIExplanation(updateStatus: false)
        resetChat()
        let identifiers = ["en", "ja", "ko"]
        setPartner(identifiers[max(0, partnerPicker.indexOfSelectedItem)])
        resultTextView.string = ""
        detailTextView.string = ""
        copyButton.isEnabled = false
        setSteadyStatus("已切换为中文与\(partnerName)互译")
    }

    @objc private func translate() {
        cancelAIExplanation(updateStatus: false)
        resetChat()
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
            detailTextView.string = IRiXiLocalDictionary.explanation(for: text, selectedText: nil)
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
                self.populateAutomaticLocalExplanation(for: text)
                self.copyButton.isEnabled = !translated.isEmpty
                let sourceIsEnglish = TranslationDirectionResolver.languageCode(
                    direction.sourceIdentifier
                ) == "en"
                let targetIsEnglish = TranslationDirectionResolver.languageCode(
                    direction.targetIdentifier
                ) == "en"
                self.englishSpeechText = sourceIsEnglish ? text : targetIsEnglish ? translated : ""
                self.speechButton.isEnabled = !self.englishSpeechText.isEmpty
                self.setSteadyStatus("翻译完成 · 文字只在 IRiXi 本机处理")
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

    @objc private func showLocalExplanation() {
        let source = sourceTextView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            setSteadyStatus("请先输入文字，或在原文中选中要查的词")
            NSSound.beep()
            return
        }
        cancelAIExplanation(updateStatus: false)
        let focus = selectedSourceText()
        detailTextView.string = IRiXiLocalDictionary.explanation(
            for: source,
            selectedText: focus == source ? nil : focus
        )
        setSteadyStatus("本机词典释义 · 没有上传文字")
    }

    @objc private func explainWithAI() {
        if aiExplanationRunning {
            cancelAIExplanation(updateStatus: true)
            return
        }
        let source = sourceTextView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            setSteadyStatus("请先输入文字，或在原文中选中要解释的词")
            NSSound.beep()
            return
        }
        guard source.count <= IRiXiAIExplanationService.maximumInputCharacters else {
            setSteadyStatus("AI 解释最多发送 3000 个字符，请缩短原文后重试")
            NSSound.beep()
            return
        }
        guard confirmAIExternalSendIfNeeded() else { return }
        resetChat()
        chatSource = source
        startAIExplanation(question: "请解释“\(selectedSourceText())”在原文中的意思。")
    }

    @objc private func configureAI() {
        let alert = NSAlert()
        alert.messageText = "Codex 会员解释 · Luna 低思考"
        alert.informativeText = "使用这台 Mac 上 Codex 已登录的 ChatGPT 账号，不需要 API 密钥。额度不足时会停止，不会切到收费 API。\n\n请在 Codex 中完成登录。对话仅保留在当前翻译窗口内；更换原文或关闭窗口会清空，不接续开发任务。"
        alert.addButton(withTitle: "知道了")
        alert.runModal()
    }

    @objc private func askFollowup() {
        guard !aiExplanationRunning, !chatHistory.isEmpty else { return }
        let question = followupField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, question.count <= 1000 else {
            setSteadyStatus("请输入 1～1000 个字符的追问")
            return
        }
        startAIExplanation(question: question)
    }

    private func resetChat() {
        chatHistory = []
        chatSource = ""
        followupField.stringValue = ""
        followupField.isEnabled = false
        followupButton.isEnabled = false
    }

    private func startAIExplanation(question: String) {
        pendingAutomaticTranslation?.cancel()
        pendingAutomaticTranslation = nil
        translationID = UUID()
        let source = chatSource
        let history = chatHistory.suffix(4).map { "用户：\($0.question)\n助手：\($0.answer)" }.joined(separator: "\n\n")
        let prompt = "原文（待解释资料）：\n\(source)\n\n本窗口最近的对话：\n\(history)\n\n本次问题：\n\(question)"
        guard prompt.count <= CodexTranslationService.maximumInputCharacters else {
            setSteadyStatus("对话较长，请点击“AI 解释”重新开始，以节省额度。")
            return
        }
        aiExplanationRunning = true
        aiExplainButton.title = "停止 AI"
        translateButton.isEnabled = false
        detailButton.isEnabled = false
        followupButton.isEnabled = false
        followupField.isEnabled = false
        webSearchButton.isEnabled = false
        if chatHistory.isEmpty { detailTextView.string = "正在请求 Codex · Luna 低思考…" }
        setSteadyStatus("正在解释 · 使用 Codex 额度 · 可点“停止 AI”取消")
        aiExplanationService.ask(prompt, search: webSearchButton.state == .on) { [weak self] result in
            guard let self else { return }
            defer { self.finishAIExplanationUI() }
            switch result {
            case .success(let answer):
                self.chatHistory.append((question: question, answer: answer))
                if self.chatHistory.count > 4 { self.chatHistory.removeFirst() }
                self.detailTextView.string = self.chatHistory.map { "你：\($0.question)\n\nAI：\($0.answer)" }.joined(separator: "\n\n")
                self.detailTextView.scrollRangeToVisible(NSRange(location: (self.detailTextView.string as NSString).length, length: 0))
                self.followupField.stringValue = ""
                self.setSteadyStatus("解释完成 · Luna 低思考 · 可继续追问（保留最近四轮）")
            case .failure(let error):
                if self.chatHistory.isEmpty { self.detailTextView.string = error.localizedDescription }
                self.setSteadyStatus(error.localizedDescription)
            }
        }
    }


    private func confirmAIExternalSendIfNeeded() -> Bool {
        if UserDefaults.standard.bool(forKey: Self.aiConsentDefaultsKey) { return true }
        let alert = NSAlert()
        alert.messageText = "是否使用 Codex 解释？"
        alert.informativeText = "原文、问题与最近四轮追问会发送给 OpenAI，使用 ChatGPT 账号的 Codex 额度（Luna 低思考）。只在勾选“联网核实”时搜索网页。不会读取开发任务或修改电脑文件，不会自动使用收费 API。本机翻译与朗读保持原样。"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "同意并继续")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return false }
        UserDefaults.standard.set(true, forKey: Self.aiConsentDefaultsKey)
        return true
    }

    private func selectedSourceText() -> String {
        let source = sourceTextView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = sourceTextView.selectedRange()
        let sourceNSString = sourceTextView.string as NSString
        guard range.length > 0, NSMaxRange(range) <= sourceNSString.length else { return source }
        let selected = sourceNSString.substring(with: range)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return selected.isEmpty ? source : selected
    }

    private func populateAutomaticLocalExplanation(for text: String) {
        let words = IRiXiLocalDictionary.lookupTerms(in: text)
        if text.count <= 80, words.count <= 4 {
            detailTextView.string = IRiXiLocalDictionary.explanation(for: text, selectedText: nil)
        } else {
            detailTextView.string = "选中原文中的词，再点“详细释义”查本机词典；也可以点“AI 解释”并继续追问。"
        }
    }

    private func cancelAIExplanation(updateStatus: Bool) {
        guard aiExplanationRunning else { return }
        aiExplanationService.cancel()
        finishAIExplanationUI()
        if updateStatus { setSteadyStatus("已停止 AI 解释") }
    }

    private func finishAIExplanationUI() {
        aiExplanationRunning = false
        aiExplainButton.title = "AI 解释"
        translateButton.isEnabled = true
        detailButton.isEnabled = true
        followupButton.isEnabled = !chatHistory.isEmpty
        followupField.isEnabled = !chatHistory.isEmpty
        webSearchButton.isEnabled = true
    }

    private func stopSpeech() {
        speechController.stop()
    }

    private func resetForImageRecognition() {
        resetChat()
        pendingAutomaticTranslation?.cancel()
        pendingAutomaticTranslation = nil
        translationID = UUID()
        if #available(macOS 15.0, *) {
            TranslationBridge.shared.cancel()
        }
        stopSpeech()
        sourceTextView.string = ""
        resultTextView.string = ""
        detailTextView.string = ""
        englishSpeechText = ""
        copyButton.isEnabled = false
        speechButton.isEnabled = false
        cancelAIExplanation(updateStatus: false)
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
        resetChat()
        pendingAutomaticTranslation?.cancel()
        pendingAutomaticTranslation = nil
        translationID = UUID()
        if #available(macOS 15.0, *) {
            TranslationBridge.shared.cancel()
        }
        cancelAIExplanation(updateStatus: false)
        stopSpeech()
    }
}
