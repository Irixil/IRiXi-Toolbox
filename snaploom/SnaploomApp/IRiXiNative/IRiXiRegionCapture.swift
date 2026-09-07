import AppKit
import CoreGraphics
import UniformTypeIdentifiers
import Vision

private enum IRiXiCaptureMode: Sendable {
    case area
    case window
    case fullscreen
    case ocr
    case translate
}

private struct IRiXiWindowCandidate: Sendable {
    let id: CGWindowID
    let bounds: CGRect
}

private final class IRiXiCaptureGate: @unchecked Sendable {
    static let shared = IRiXiCaptureGate()

    private let lock = NSLock()
    private var active = false

    func begin() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !active else { return false }
        active = true
        return true
    }

    func end() {
        lock.lock()
        active = false
        lock.unlock()
    }

    func isActive() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return active
    }
}

private final class IRiXiCapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
private final class IRiXiCaptureSelectionView: NSView {
    let screenshot: CGImage
    let mode: IRiXiCaptureMode
    let captureRect: CGRect
    let windowCandidates: [IRiXiWindowCandidate]
    var onSelectionStarted: (() -> Void)?
    var onEdit: ((NSImage) -> Void)?
    var onCopy: ((NSImage) -> Void)?
    var onSave: ((NSImage) -> Void)?
    var onPin: ((NSImage) -> Void)?
    var onRecognize: ((NSImage) -> Void)?
    var onTranslate: ((NSImage) -> Void)?
    var onCancel: (() -> Void)?

    private var selection = NSRect.zero
    private var dragOrigin = NSPoint.zero
    private var isDragging = false
    private var selectedWindowID: CGWindowID?
    private var trackingArea: NSTrackingArea?

    private lazy var editButton = makeButton(title: "标注", action: #selector(editSelection))
    private lazy var copyButton = makeButton(title: "复制", action: #selector(copySelection))
    private lazy var saveButton = makeButton(title: "保存", action: #selector(saveSelection))
    private lazy var pinButton = makeButton(title: "钉图", action: #selector(pinSelection))
    private lazy var recognizeButton = makeButton(title: "提取文字", action: #selector(recognizeSelection))
    private lazy var translateButton = makeButton(title: "翻译文字", action: #selector(translateSelection))
    private lazy var cancelButton = makeButton(title: "取消", action: #selector(cancelCapture))

    init(
        frame: NSRect,
        screenshot: CGImage,
        mode: IRiXiCaptureMode,
        captureRect: CGRect,
        windowCandidates: [IRiXiWindowCandidate]
    ) {
        self.screenshot = screenshot
        self.mode = mode
        self.captureRect = captureRect
        self.windowCandidates = windowCandidates
        super.init(frame: frame)
        wantsLayer = true
        addSubview(editButton)
        addSubview(copyButton)
        addSubview(saveButton)
        addSubview(pinButton)
        addSubview(recognizeButton)
        addSubview(translateButton)
        addSubview(cancelButton)

        if mode == .ocr || mode == .translate {
            copyButton.title = mode == .ocr ? "识别" : "翻译"
            saveButton.isHidden = true
        }

        if mode == .fullscreen {
            selection = NSRect(origin: .zero, size: frame.size)
            positionButtons()
            setButtonsHidden(false)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var acceptsFirstResponder: Bool { true }

    override func updateTrackingAreas() {
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let next = NSTrackingArea(
            rect: .zero,
            options: [.mouseMoved, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(next)
        trackingArea = next
        super.updateTrackingAreas()
    }

    private func makeButton(title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .regular
        button.isHidden = true
        return button
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSGraphicsContext.current?.imageInterpolation = .none
        NSImage(cgImage: screenshot, size: bounds.size).draw(in: bounds)

        guard selection.width > 0, selection.height > 0 else {
            NSColor.black.withAlphaComponent(0.22).setFill()
            bounds.fill()
            switch mode {
            case .area:
                drawHint("拖动选择截图区域 · 按 Esc 取消")
            case .window:
                drawHint("移动鼠标选择窗口 · 单击确认 · 按 Esc 取消")
            case .fullscreen:
                break
            case .ocr:
                drawHint("拖动选择要识别的文字或二维码 · 按 Esc 取消")
            case .translate:
                drawHint("拖动选择要翻译的图片文字 · 按 Esc 取消")
            }
            return
        }

        let shade = NSBezierPath(rect: bounds)
        shade.appendRect(selection)
        shade.windingRule = .evenOdd
        NSColor.black.withAlphaComponent(0.42).setFill()
        shade.fill()

        NSColor.systemBlue.setStroke()
        let border = NSBezierPath(rect: selection.insetBy(dx: 0.5, dy: 0.5))
        border.lineWidth = 2
        border.stroke()

        let sizeText = "\(Int(selection.width)) × \(Int(selection.height))"
        drawHint(sizeText, above: selection)
    }

    private func drawHint(_ text: String, above rect: NSRect? = nil) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: NSColor.white,
            .backgroundColor: NSColor.black.withAlphaComponent(0.72),
        ]
        let attributed = NSAttributedString(string: "  \(text)  ", attributes: attributes)
        let size = attributed.size()
        let target: NSPoint
        if let rect {
            target = NSPoint(
                x: min(max(rect.minX, 8), bounds.maxX - size.width - 8),
                y: min(bounds.maxY - size.height - 8, rect.maxY + 8)
            )
        } else {
            target = NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2)
        }
        attributed.draw(at: target)
    }

    override func mouseMoved(with event: NSEvent) {
        guard mode == .window, selectedWindowID == nil else {
            super.mouseMoved(with: event)
            return
        }
        let point = convert(event.locationInWindow, from: nil)
        let candidate = windowCandidate(at: point)
        selection = candidate.map(localRect(for:)) ?? .zero
        setButtonsHidden(true)
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)

        switch mode {
        case .area, .ocr, .translate:
            onSelectionStarted?()
            isDragging = true
            dragOrigin = convert(event.locationInWindow, from: nil)
            selection = NSRect(origin: dragOrigin, size: .zero)
            setButtonsHidden(true)
            needsDisplay = true
        case .window:
            let point = convert(event.locationInWindow, from: nil)
            guard let candidate = windowCandidate(at: point) else { return }
            onSelectionStarted?()
            selectedWindowID = candidate.id
            selection = localRect(for: candidate)
            positionButtons()
            setButtonsHidden(false)
            needsDisplay = true
        case .fullscreen:
            break
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard (mode == .area || mode == .ocr || mode == .translate), isDragging else { return }
        let point = convert(event.locationInWindow, from: nil)
        selection = normalizedRect(from: dragOrigin, to: point).intersection(bounds)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard (mode == .area || mode == .ocr || mode == .translate), isDragging else { return }
        isDragging = false
        let point = convert(event.locationInWindow, from: nil)
        selection = normalizedRect(from: dragOrigin, to: point).intersection(bounds)
        guard selection.width >= 8, selection.height >= 8 else {
            selection = .zero
            setButtonsHidden(true)
            needsDisplay = true
            return
        }
        positionButtons()
        setButtonsHidden(false)
        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onCancel?()
            return
        }
        super.keyDown(with: event)
    }

    private func windowCandidate(at point: NSPoint) -> IRiXiWindowCandidate? {
        let globalPoint = CGPoint(
            x: captureRect.minX + point.x,
            y: captureRect.minY + (bounds.height - point.y)
        )
        return windowCandidates.first { $0.bounds.contains(globalPoint) }
    }

    private func localRect(for candidate: IRiXiWindowCandidate) -> NSRect {
        let clipped = candidate.bounds.intersection(captureRect)
        guard !clipped.isNull, !clipped.isEmpty else { return .zero }
        return NSRect(
            x: clipped.minX - captureRect.minX,
            y: bounds.height - (clipped.maxY - captureRect.minY),
            width: clipped.width,
            height: clipped.height
        ).intersection(bounds)
    }

    private func normalizedRect(from start: NSPoint, to end: NSPoint) -> NSRect {
        NSRect(
            x: min(start.x, end.x),
            y: min(start.y, end.y),
            width: abs(end.x - start.x),
            height: abs(end.y - start.y)
        )
    }

    private func setButtonsHidden(_ hidden: Bool) {
        let isImageCapture = mode == .area || mode == .window || mode == .fullscreen
        editButton.isHidden = hidden || !isImageCapture
        copyButton.isHidden = hidden
        saveButton.isHidden = hidden || mode == .ocr || mode == .translate
        pinButton.isHidden = hidden || !isImageCapture
        recognizeButton.isHidden = hidden || !isImageCapture
        translateButton.isHidden = hidden || !isImageCapture
        cancelButton.isHidden = hidden
    }

    private func positionButtons() {
        let buttonWidth: CGFloat = 64
        let buttonHeight: CGFloat = 30
        let gap: CGFloat = 8
        let buttons: [NSButton]
        if mode == .ocr || mode == .translate {
            buttons = [copyButton, cancelButton]
        } else {
            buttons = [editButton, copyButton, saveButton, pinButton, recognizeButton, translateButton, cancelButton]
        }
        let totalWidth = buttonWidth * CGFloat(buttons.count) + gap * CGFloat(max(0, buttons.count - 1))
        let x = min(max(selection.maxX - totalWidth, 8), bounds.maxX - totalWidth - 8)
        let preferredY = selection.minY - buttonHeight - 8
        let y = preferredY >= 8
            ? preferredY
            : min(bounds.maxY - buttonHeight - 8, selection.maxY + 8)
        for (index, button) in buttons.enumerated() {
            button.frame = NSRect(
                x: x + CGFloat(index) * (buttonWidth + gap),
                y: y,
                width: buttonWidth,
                height: buttonHeight
            )
        }
    }

    private func selectedImage() -> NSImage? {
        guard selection.width >= 8, selection.height >= 8 else { return nil }

        if mode == .window, let selectedWindowID,
           let image = CGWindowListCreateImage(
               .null,
               .optionIncludingWindow,
               selectedWindowID,
               [.bestResolution, .boundsIgnoreFraming]
           ) {
            return NSImage(cgImage: image, size: selection.size)
        }

        let scaleX = CGFloat(screenshot.width) / bounds.width
        let scaleY = CGFloat(screenshot.height) / bounds.height
        let crop = CGRect(
            x: selection.minX * scaleX,
            y: (bounds.height - selection.maxY) * scaleY,
            width: selection.width * scaleX,
            height: selection.height * scaleY
        ).integral
        guard let image = screenshot.cropping(to: crop) else { return nil }
        return NSImage(cgImage: image, size: selection.size)
    }

    @objc private func copySelection() {
        guard let image = selectedImage() else { return }
        onCopy?(image)
    }

    @objc private func editSelection() {
        guard let image = selectedImage() else { return }
        onEdit?(image)
    }

    @objc private func saveSelection() {
        guard let image = selectedImage() else { return }
        onSave?(image)
    }

    @objc private func pinSelection() {
        guard let image = selectedImage() else { return }
        onPin?(image)
    }

    @objc private func recognizeSelection() {
        guard let image = selectedImage() else { return }
        onRecognize?(image)
    }

    @objc private func translateSelection() {
        guard let image = selectedImage() else { return }
        onTranslate?(image)
    }

    @objc private func cancelCapture() {
        onCancel?()
    }
}

@MainActor
private final class IRiXiOCRResultController {
    static let shared = IRiXiOCRResultController()

    private var window: NSPanel?
    private var textView: NSTextView?
    private var copyButton: NSButton?
    private var resultText = ""

    func recognize(_ image: NSImage) {
        show(title: "IRiXi 识别文字", text: "正在识别文字和二维码…", canCopy: false)
        var proposedRect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
            show(title: "IRiXi 识别文字", text: "没有读到截图内容，请重新选择。", canCopy: false)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let textRequest = VNRecognizeTextRequest()
            textRequest.recognitionLevel = .accurate
            textRequest.usesLanguageCorrection = true
            textRequest.automaticallyDetectsLanguage = true
            let barcodeRequest = VNDetectBarcodesRequest()

            do {
                try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([textRequest, barcodeRequest])
                let textLines = (textRequest.results ?? [])
                    .sorted { left, right in
                        if abs(left.boundingBox.midY - right.boundingBox.midY) > 0.02 {
                            return left.boundingBox.midY > right.boundingBox.midY
                        }
                        return left.boundingBox.minX < right.boundingBox.minX
                    }
                    .compactMap { $0.topCandidates(1).first?.string }
                let barcodes = (barcodeRequest.results ?? []).compactMap(\.payloadStringValue)

                var sections: [String] = []
                if !textLines.isEmpty { sections.append(textLines.joined(separator: "\n")) }
                if !barcodes.isEmpty { sections.append("二维码\n" + barcodes.joined(separator: "\n")) }
                let result = sections.isEmpty ? "没有识别到文字或二维码。" : sections.joined(separator: "\n\n")
                DispatchQueue.main.async { [weak self] in
                    self?.show(title: "IRiXi 识别文字", text: result, canCopy: !sections.isEmpty)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.show(title: "IRiXi 识别文字", text: "识别没有完成，请重新选择清晰一些的区域。", canCopy: false)
                }
            }
        }
    }

    fileprivate func show(title: String, text: String, canCopy: Bool) {
        ensureWindow()
        window?.title = title
        resultText = canCopy ? text : ""
        textView?.string = text
        copyButton?.isEnabled = canCopy
        window?.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKey()
    }

    private func ensureWindow() {
        guard window == nil else { return }

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 420),
            styleMask: [.titled, .closable, .resizable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = "IRiXi 识别文字"
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        let text = NSTextView()
        text.isEditable = false
        text.isSelectable = true
        text.font = .systemFont(ofSize: 15)
        text.textContainerInset = NSSize(width: 12, height: 12)
        scrollView.documentView = text

        let copy = NSButton(title: "复制结果", target: self, action: #selector(copyResult))
        copy.bezelStyle = .rounded
        copy.translatesAutoresizingMaskIntoConstraints = false

        let close = NSButton(title: "关闭", target: self, action: #selector(closeWindow))
        close.bezelStyle = .rounded
        close.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView(frame: panel.contentRect(forFrameRect: panel.frame))
        content.addSubview(scrollView)
        content.addSubview(copy)
        content.addSubview(close)
        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            scrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            scrollView.topAnchor.constraint(equalTo: content.topAnchor, constant: 16),
            scrollView.bottomAnchor.constraint(equalTo: copy.topAnchor, constant: -14),
            copy.trailingAnchor.constraint(equalTo: close.leadingAnchor, constant: -10),
            copy.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
            close.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            close.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
        ])

        panel.contentView = content
        panel.center()
        window = panel
        textView = text
        copyButton = copy
    }

    @objc private func copyResult() {
        guard !resultText.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(resultText, forType: .string)
    }

    @objc private func closeWindow() {
        window?.orderOut(nil)
    }
}

@MainActor
private final class IRiXiImageTranslationController {
    static let shared = IRiXiImageTranslationController()

    func translate(_ image: NSImage) {
        let translationCoordinator = IRiXiTranslationCoordinator.shared
        let requestID = translationCoordinator.beginImageTranslation()
        guard #available(macOS 15.0, *) else {
            translationCoordinator.failImageTranslation(
                requestID: requestID,
                message: "截图翻译需要 macOS 15 或更高版本。"
            )
            return
        }

        var proposedRect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
            translationCoordinator.failImageTranslation(
                requestID: requestID,
                message: "没有读到截图内容，请重新选择。"
            )
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.automaticallyDetectsLanguage = true
            do {
                try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
                let text = (request.results ?? [])
                    .sorted { left, right in
                        if abs(left.boundingBox.midY - right.boundingBox.midY) > 0.02 {
                            return left.boundingBox.midY > right.boundingBox.midY
                        }
                        return left.boundingBox.minX < right.boundingBox.minX
                    }
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                DispatchQueue.main.async {
                    guard !text.isEmpty else {
                        translationCoordinator.failImageTranslation(
                            requestID: requestID,
                            message: "没有识别到可翻译的文字。"
                        )
                        return
                    }
                    translationCoordinator.finishImageTranslation(requestID: requestID, text: text)
                }
            } catch {
                DispatchQueue.main.async {
                    translationCoordinator.failImageTranslation(
                        requestID: requestID,
                        message: "文字识别没有完成，请重新选择清晰一些的区域。"
                    )
                }
            }
        }
    }
}

@MainActor
private final class IRiXiCaptureController {
    static let shared = IRiXiCaptureController()

    private var panels: [IRiXiCapturePanel] = []
    private var snaploomOverlays: [OverlayWindowController] = []
    private var stashedWindows: [NSWindow] = []
    private weak var selectedPanel: IRiXiCapturePanel?

    func begin(mode: IRiXiCaptureMode) {
        guard panels.isEmpty, snaploomOverlays.isEmpty else { return }
        stashedWindows = NSApp.windows.filter { $0.isVisible && !($0 is IRiXiCapturePanel) }
        stashedWindows.forEach { $0.orderOut(nil) }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            self?.captureAndShowSnaploom(mode: mode)
        }
    }

    func cancel() {
        finish()
    }

    /// Runs Snaploom's original selection and annotation canvas inside the
    /// IRiXi process.  This replaces the temporary simplified selector/editor;
    /// it is still one application and therefore one screen-recording identity.
    private func captureAndShowSnaploom(mode: IRiXiCaptureMode) {
        let context = ScreenCaptureManager.makeImmediateCaptureContext()
        let captures = ScreenCaptureManager.captureAllScreensImmediately(context: context)
        guard !captures.isEmpty else {
            failAndFinish("屏幕画面读取失败，请重新检查屏幕录制权限。")
            return
        }

        let preferredScreen = mode == .fullscreen
            ? (NSScreen.main ?? captures[0].screen)
            : (NSScreen.screens.first(where: { $0.frame.contains(context.mouseLocation) })
                ?? NSScreen.main ?? captures[0].screen)
        let capture = captures.first(where: { $0.screen === preferredScreen }) ?? captures[0]
        let overlay = OverlayWindowController(capture: capture)
        overlay.overlayDelegate = self
        snaploomOverlays = [overlay]

        switch mode {
        case .fullscreen:
            overlay.showOverlay()
            overlay.applyFullScreenSelection()
        case .ocr:
            overlay.setAutoOCRMode()
            overlay.showOverlay()
        case .translate:
            overlay.setAutoTranslateOverlayMode(targetLang: nil)
            overlay.showOverlay()
        case .area, .window:
            // Window snapping is part of Snaploom's original overlay, so the
            // window command shares the same mature selector and editor.
            overlay.showOverlay()
        }
    }

    private func captureAndShow(mode: IRiXiCaptureMode) {
        let allScreens = NSScreen.screens
        guard !allScreens.isEmpty else {
            failAndFinish("没有找到可截图的显示器。")
            return
        }

        let screens: [NSScreen]
        if mode == .fullscreen {
            screens = [NSScreen.main ?? allScreens[0]]
        } else {
            screens = allScreens
        }

        let primaryHeight = allScreens[0].frame.maxY
        let candidates = mode == .window ? Self.visibleWindowCandidates() : []
        var created: [IRiXiCapturePanel] = []

        for screen in screens {
            let captureRect = CGRect(
                x: screen.frame.minX,
                y: primaryHeight - screen.frame.maxY,
                width: screen.frame.width,
                height: screen.frame.height
            )
            guard let screenshot = CGWindowListCreateImage(
                captureRect,
                .optionOnScreenOnly,
                kCGNullWindowID,
                .bestResolution
            ) else {
                created.forEach { $0.close() }
                failAndFinish("屏幕画面读取失败，请重新检查屏幕录制权限。")
                return
            }

            let panel = IRiXiCapturePanel(
                contentRect: screen.frame,
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false,
                screen: screen
            )
            panel.level = .screenSaver
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isOpaque = true
            panel.backgroundColor = .black
            panel.hasShadow = false
            panel.ignoresMouseEvents = false
            panel.acceptsMouseMovedEvents = true

            let view = IRiXiCaptureSelectionView(
                frame: NSRect(origin: .zero, size: screen.frame.size),
                screenshot: screenshot,
                mode: mode,
                captureRect: captureRect,
                windowCandidates: candidates
            )
            view.onSelectionStarted = { [weak self, weak panel] in
                guard let self, let panel else { return }
                self.selectedPanel = panel
                self.panels.filter { $0 !== panel }.forEach { $0.orderOut(nil) }
            }
            view.onCopy = { [weak self] image in
                if mode == .ocr {
                    self?.recognizeAndFinish(image)
                } else if mode == .translate {
                    self?.translateAndFinish(image)
                } else {
                    self?.copyAndFinish(image)
                }
            }
            view.onEdit = { [weak self] image in
                self?.editAndFinish(image)
            }
            view.onSave = { [weak self] image in self?.save(image) }
            view.onPin = { [weak self] image in
                self?.pinAndFinish(image)
            }
            view.onRecognize = { [weak self] image in
                self?.recognizeAndFinish(image)
            }
            view.onTranslate = { [weak self] image in
                self?.translateAndFinish(image)
            }
            view.onCancel = { [weak self] in self?.finish() }
            panel.contentView = view
            created.append(panel)
        }

        panels = created
        if mode == .fullscreen {
            selectedPanel = panels.first
        }
        NSApp.activate(ignoringOtherApps: true)
        for panel in panels {
            panel.orderFrontRegardless()
            panel.makeFirstResponder(panel.contentView)
        }
        panels.first?.makeKey()
    }

    private static func visibleWindowCandidates() -> [IRiXiWindowCandidate] {
        let ownPID = ProcessInfo.processInfo.processIdentifier
        guard let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else { return [] }

        return rawWindows.compactMap { info in
            let layer = info[kCGWindowLayer as String] as? Int ?? -1
            let ownerPID = info[kCGWindowOwnerPID as String] as? Int32 ?? -1
            let alpha = info[kCGWindowAlpha as String] as? Double ?? 0
            guard let rawBounds = info[kCGWindowBounds as String] else { return nil }
            let boundsDictionary = rawBounds as! CFDictionary
            guard layer == 0, ownerPID != ownPID, alpha > 0.01,
                  let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
                  bounds.width >= 40, bounds.height >= 40,
                  let number = info[kCGWindowNumber as String] as? UInt32
            else { return nil }
            return IRiXiWindowCandidate(id: CGWindowID(number), bounds: bounds)
        }
    }

    private func copyAndFinish(_ image: NSImage) {
        NSPasteboard.general.clearContents()
        _ = NSPasteboard.general.writeObjects([image])
        finish()
    }

    private func recognizeAndFinish(_ image: NSImage) {
        finish()
        IRiXiOCRResultController.shared.recognize(image)
    }

    private func translateAndFinish(_ image: NSImage) {
        finish()
        IRiXiImageTranslationController.shared.translate(image)
    }

    private func editAndFinish(_ image: NSImage) {
        finish()
        IRiXiImageEditorController.open(image: image)
    }

    private func pinAndFinish(_ image: NSImage) {
        finish()
        IRiXiPinManager.shared.open(image)
    }

    private func save(_ image: NSImage) {
        panels.forEach { $0.orderOut(nil) }
        let savePanel = NSSavePanel()
        savePanel.allowedContentTypes = [.png]
        savePanel.canCreateDirectories = true
        savePanel.nameFieldStringValue = Self.defaultFilename()
        savePanel.begin { [weak self] response in
            guard let self else { return }
            if response == .OK, let url = savePanel.url, self.writePNG(image, to: url) {
                self.finish()
                return
            }
            if response == .OK {
                let alert = NSAlert()
                alert.messageText = "截图没有保存成功"
                alert.informativeText = "原文件和剪贴板没有被修改，请换一个位置重试。"
                alert.runModal()
            }
            self.restoreCapturePanels()
        }
    }

    private func writePNG(_ image: NSImage, to url: URL) -> Bool {
        guard
            let tiff = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let data = bitmap.representation(using: .png, properties: [:])
        else { return false }
        do {
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func restoreCapturePanels() {
        let visiblePanels = selectedPanel.map { [$0] } ?? panels
        NSApp.activate(ignoringOtherApps: true)
        visiblePanels.forEach { $0.orderFrontRegardless() }
        visiblePanels.first?.makeKey()
        visiblePanels.first?.makeFirstResponder(visiblePanels.first?.contentView)
    }

    private func failAndFinish(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "截图没有开始"
        alert.informativeText = message
        alert.addButton(withTitle: "知道了")
        alert.runModal()
        finish()
    }

    private func finish() {
        snaploomOverlays.forEach { $0.tearDown() }
        snaploomOverlays.removeAll()
        panels.forEach {
            $0.orderOut(nil)
            $0.close()
        }
        panels.removeAll()
        selectedPanel = nil

        stashedWindows.forEach { $0.orderFront(nil) }
        if let keyWindow = stashedWindows.first(where: { $0.canBecomeKey }) {
            keyWindow.makeKey()
        }
        stashedWindows.removeAll()
        IRiXiCaptureGate.shared.end()
    }

    private static func defaultFilename() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        return "IRiXi 截图 \(formatter.string(from: Date())).png"
    }
}

extension IRiXiCaptureController: OverlayWindowControllerDelegate {
    func overlayDidCancel(_ controller: OverlayWindowController) { finish() }

    func overlayDidConfirm(
        _ controller: OverlayWindowController,
        capturedImage: NSImage?,
        annotationData: CaptureAnnotationData?
    ) {
        finish()
    }

    func overlayDidRequestPin(
        _ controller: OverlayWindowController,
        image: NSImage,
        annotationData: CaptureAnnotationData?
    ) {
        finish()
        IRiXiPinManager.shared.open(image)
    }

    func overlayDidRequestOCR(
        _ controller: OverlayWindowController,
        result: OCRScanResult,
        image: NSImage?
    ) {
        finish()
        if !result.copyText.isEmpty {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(result.copyText, forType: .string)
        }
        IRiXiOCRResultController.shared.show(
            title: "IRiXi 识别文字",
            text: result.copyText.isEmpty ? "没有识别到文字或二维码。" : result.copyText,
            canCopy: !result.copyText.isEmpty
        )
    }

    func overlayDidRequestUpload(
        _ controller: OverlayWindowController,
        image: NSImage,
        annotationData: CaptureAnnotationData?
    ) {}

    func overlayDidRequestStartRecording(
        _ controller: OverlayWindowController, rect: NSRect, screen: NSScreen
    ) {}
    func overlayDidRequestStopRecording(_ controller: OverlayWindowController) {}
    func overlayDidRequestScrollCapture(
        _ controller: OverlayWindowController, rect: NSRect, screen: NSScreen
    ) {}
    func overlayDidRequestStopScrollCapture(_ controller: OverlayWindowController) {}
    func overlayDidRequestCancelScrollCapture(_ controller: OverlayWindowController) {}
    func overlayDidRequestToggleAutoScroll(_ controller: OverlayWindowController) {}
    func overlayDidRequestAccessibilityPermission(_ controller: OverlayWindowController) {}
    func overlayDidRequestInputMonitoringPermission(_ controller: OverlayWindowController) {}
    func overlayDidBeginSelection(_ controller: OverlayWindowController) {}
    func overlayDidChangeSelection(_ controller: OverlayWindowController, globalRect: NSRect) {}
    func overlayDidRemoteResizeSelection(
        _ controller: OverlayWindowController, globalRect: NSRect
    ) {}
    func overlayDidFinishRemoteResize(
        _ controller: OverlayWindowController, globalRect: NSRect
    ) {}
    func overlayCrossScreenImage(_ controller: OverlayWindowController) -> NSImage? { nil }
    func overlayDidChangeWindowSnapState(_ controller: OverlayWindowController) {}
}

/// Return values: 0 = accepted, 1 = busy, 2 = permission required.
private func irixiNativeStartCapture(_ mode: IRiXiCaptureMode) -> Int32 {
    guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else { return 2 }
    guard IRiXiCaptureGate.shared.begin() else { return 1 }
    DispatchQueue.main.async {
        IRiXiCaptureController.shared.begin(mode: mode)
    }
    return 0
}

@_cdecl("irixi_native_start_area_capture")
public func irixiNativeStartAreaCapture() -> Int32 {
    irixiNativeStartCapture(.area)
}

@_cdecl("irixi_native_start_window_capture")
public func irixiNativeStartWindowCapture() -> Int32 {
    irixiNativeStartCapture(.window)
}

@_cdecl("irixi_native_start_fullscreen_capture")
public func irixiNativeStartFullscreenCapture() -> Int32 {
    irixiNativeStartCapture(.fullscreen)
}

@_cdecl("irixi_native_start_ocr_capture")
public func irixiNativeStartOCRCapture() -> Int32 {
    irixiNativeStartCapture(.ocr)
}

@_cdecl("irixi_native_start_image_translation_capture")
public func irixiNativeStartImageTranslationCapture() -> Int32 {
    irixiNativeStartCapture(.translate)
}

@_cdecl("irixi_native_cancel_area_capture")
public func irixiNativeCancelAreaCapture() {
    DispatchQueue.main.async {
        IRiXiCaptureController.shared.cancel()
    }
}

@_cdecl("irixi_native_is_area_capture_active")
public func irixiNativeIsAreaCaptureActive() -> Bool {
    IRiXiCaptureGate.shared.isActive()
}
