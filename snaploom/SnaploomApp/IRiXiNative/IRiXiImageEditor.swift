import AppKit
import CoreImage
import UniformTypeIdentifiers

@MainActor
enum IRiXiImageOutput {
    static func copy(_ image: NSImage) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.writeObjects([image])
    }

    static func save(_ image: NSImage, attachedTo window: NSWindow? = nil) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = filename()
        let completion: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { return }
            guard let tiff = image.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiff),
                  let data = bitmap.representation(using: .png, properties: [:])
            else { return }
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                let alert = NSAlert()
                alert.messageText = "图片没有保存成功"
                alert.informativeText = "请换一个位置后重试；当前截图和标注仍然保留。"
                alert.addButton(withTitle: "知道了")
                if let window {
                    alert.beginSheetModal(for: window)
                } else {
                    alert.runModal()
                }
            }
        }
        if let window {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
    }

    private static func filename() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        return "IRiXi 截图 \(formatter.string(from: Date())).png"
    }
}

private enum IRiXiAnnotationKind: Int, CaseIterable {
    case pen
    case arrow
    case rectangle
    case ellipse
    case text
    case blur

    var title: String {
        switch self {
        case .pen: return "画笔"
        case .arrow: return "箭头"
        case .rectangle: return "矩形"
        case .ellipse: return "椭圆"
        case .text: return "文字"
        case .blur: return "模糊"
        }
    }
}

private struct IRiXiAnnotation {
    let kind: IRiXiAnnotationKind
    var points: [NSPoint]
    var text: String
    let color: NSColor
    let width: CGFloat

    var rect: NSRect {
        guard let first = points.first, let last = points.last else { return .zero }
        return NSRect(
            x: min(first.x, last.x),
            y: min(first.y, last.y),
            width: abs(last.x - first.x),
            height: abs(last.y - first.y)
        )
    }
}

@MainActor
private final class IRiXiAnnotationCanvas: NSView {
    var tool: IRiXiAnnotationKind = .arrow
    var color: NSColor = .systemRed
    var strokeWidth: CGFloat = 4
    var onHistoryChange: (() -> Void)?

    private let sourceImage: NSImage
    private var annotations: [IRiXiAnnotation] = []
    private var redoAnnotations: [IRiXiAnnotation] = []
    private var draft: IRiXiAnnotation?
    private lazy var pixelatedImage: NSImage? = Self.makePixelatedImage(sourceImage)

    init(image: NSImage) {
        sourceImage = image
        let size = NSSize(width: max(1, image.size.width), height: max(1, image.size.height))
        super.init(frame: NSRect(origin: .zero, size: size))
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var acceptsFirstResponder: Bool { true }

    var canUndo: Bool { !annotations.isEmpty }
    var canRedo: Bool { !redoAnnotations.isEmpty }

    func undo() {
        guard let value = annotations.popLast() else { return }
        redoAnnotations.append(value)
        needsDisplay = true
        onHistoryChange?()
    }

    func redo() {
        guard let value = redoAnnotations.popLast() else { return }
        annotations.append(value)
        needsDisplay = true
        onHistoryChange?()
    }

    func renderedImage() -> NSImage {
        let image = NSImage(size: bounds.size)
        image.lockFocus()
        drawContent(includeDraft: false)
        image.unlockFocus()
        return image
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        drawContent(includeDraft: true)
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let point = clamped(convert(event.locationInWindow, from: nil))
        if tool == .text {
            addText(at: point)
            return
        }
        draft = IRiXiAnnotation(
            kind: tool,
            points: [point, point],
            text: "",
            color: color,
            width: strokeWidth
        )
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard var value = draft else { return }
        let point = clamped(convert(event.locationInWindow, from: nil))
        if value.kind == .pen {
            value.points.append(point)
        } else if value.points.count > 1 {
            value.points[value.points.count - 1] = point
        }
        draft = value
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard var value = draft else { return }
        let point = clamped(convert(event.locationInWindow, from: nil))
        if value.kind == .pen {
            value.points.append(point)
        } else if value.points.count > 1 {
            value.points[value.points.count - 1] = point
        }
        draft = nil
        let meaningful = value.kind == .pen
            ? value.points.count > 2
            : value.rect.width >= 3 || value.rect.height >= 3
        if meaningful {
            annotations.append(value)
            redoAnnotations.removeAll()
            onHistoryChange?()
        }
        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers == "z" {
            event.modifierFlags.contains(.shift) ? redo() : undo()
            return
        }
        super.keyDown(with: event)
    }

    private func addText(at point: NSPoint) {
        let alert = NSAlert()
        alert.messageText = "添加文字"
        alert.informativeText = "输入要放到图片上的内容。"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        alert.accessoryView = field
        alert.addButton(withTitle: "添加")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let text = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        annotations.append(IRiXiAnnotation(
            kind: .text,
            points: [point],
            text: String(text.prefix(500)),
            color: color,
            width: strokeWidth
        ))
        redoAnnotations.removeAll()
        onHistoryChange?()
        needsDisplay = true
    }

    private func clamped(_ point: NSPoint) -> NSPoint {
        NSPoint(
            x: min(max(point.x, bounds.minX), bounds.maxX),
            y: min(max(point.y, bounds.minY), bounds.maxY)
        )
    }

    private func drawContent(includeDraft: Bool) {
        NSGraphicsContext.current?.imageInterpolation = .high
        sourceImage.draw(in: bounds, from: .zero, operation: .copy, fraction: 1)
        for annotation in annotations { draw(annotation) }
        if includeDraft, let draft { draw(draft) }
    }

    private func draw(_ annotation: IRiXiAnnotation) {
        guard let first = annotation.points.first else { return }
        switch annotation.kind {
        case .pen:
            guard annotation.points.count > 1 else { return }
            let path = NSBezierPath()
            path.move(to: first)
            for point in annotation.points.dropFirst() { path.line(to: point) }
            configure(path, annotation)
            path.stroke()
        case .arrow:
            guard let last = annotation.points.last else { return }
            let path = NSBezierPath()
            path.move(to: first)
            path.line(to: last)
            let angle = atan2(last.y - first.y, last.x - first.x)
            let length = max(10, annotation.width * 4)
            for offset in [CGFloat.pi * 0.82, -CGFloat.pi * 0.82] {
                path.move(to: last)
                path.line(to: NSPoint(
                    x: last.x + cos(angle + offset) * length,
                    y: last.y + sin(angle + offset) * length
                ))
            }
            configure(path, annotation)
            path.stroke()
        case .rectangle:
            let path = NSBezierPath(rect: annotation.rect)
            configure(path, annotation)
            path.stroke()
        case .ellipse:
            let path = NSBezierPath(ovalIn: annotation.rect)
            configure(path, annotation)
            path.stroke()
        case .text:
            let fontSize = max(14, annotation.width * 5)
            let shadow = NSShadow()
            shadow.shadowBlurRadius = 2
            shadow.shadowOffset = NSSize(width: 0, height: -1)
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.55)
            NSAttributedString(
                string: annotation.text,
                attributes: [
                    .font: NSFont.systemFont(ofSize: fontSize, weight: .semibold),
                    .foregroundColor: annotation.color,
                    .shadow: shadow,
                ]
            ).draw(at: first)
        case .blur:
            guard annotation.rect.width >= 2, annotation.rect.height >= 2,
                  let pixelatedImage
            else { return }
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: annotation.rect).addClip()
            pixelatedImage.draw(in: bounds, from: .zero, operation: .copy, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    private func configure(_ path: NSBezierPath, _ annotation: IRiXiAnnotation) {
        annotation.color.setStroke()
        path.lineWidth = annotation.width
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
    }

    private static func makePixelatedImage(_ image: NSImage) -> NSImage? {
        var rect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
              let filter = CIFilter(name: "CIPixellate")
        else { return nil }
        let input = CIImage(cgImage: cgImage)
        filter.setValue(input, forKey: kCIInputImageKey)
        filter.setValue(16, forKey: kCIInputScaleKey)
        guard let output = filter.outputImage?.cropped(to: input.extent),
              let result = CIContext().createCGImage(output, from: input.extent)
        else { return nil }
        return NSImage(cgImage: result, size: image.size)
    }
}

@MainActor
final class IRiXiImageEditorController: NSObject, NSWindowDelegate {
    private static var active: [IRiXiImageEditorController] = []

    private let sourceImage: NSImage
    private var window: NSWindow?
    private var canvas: IRiXiAnnotationCanvas?
    private var toolButtons: [IRiXiAnnotationKind: NSButton] = [:]
    private var undoButton: NSButton?
    private var redoButton: NSButton?

    static func open(image: NSImage) {
        let controller = IRiXiImageEditorController(image: image)
        active.append(controller)
        controller.show()
    }

    private init(image: NSImage) {
        sourceImage = image
        super.init()
    }

    private func show() {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let size = NSSize(
            width: min(max(760, sourceImage.size.width + 80), screen.visibleFrame.width * 0.9),
            height: min(max(520, sourceImage.size.height + 120), screen.visibleFrame.height * 0.9)
        )
        let panel = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.title = "IRiXi 图片标注"
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width: 720, height: 480)
        panel.delegate = self

        let editor = IRiXiAnnotationCanvas(image: sourceImage)
        editor.onHistoryChange = { [weak self] in self?.refreshHistoryButtons() }
        canvas = editor

        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasHorizontalScroller = true
        scroll.hasVerticalScroller = true
        scroll.allowsMagnification = true
        scroll.minMagnification = 0.1
        scroll.maxMagnification = 5
        scroll.backgroundColor = NSColor(white: 0.12, alpha: 1)
        scroll.drawsBackground = true
        scroll.documentView = editor

        let toolbar = makeToolbar()
        toolbar.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView(frame: NSRect(origin: .zero, size: size))
        content.addSubview(toolbar)
        content.addSubview(scroll)
        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            toolbar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            toolbar.topAnchor.constraint(equalTo: content.topAnchor, constant: 10),
            toolbar.heightAnchor.constraint(equalToConstant: 34),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 10),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        panel.contentView = content
        panel.center()
        window = panel
        selectTool(.arrow)
        refreshHistoryButtons()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(editor)
    }

    private func makeToolbar() -> NSStackView {
        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 6

        for kind in IRiXiAnnotationKind.allCases {
            let button = makeButton(kind.title, #selector(toolClicked(_:)))
            button.tag = kind.rawValue
            toolButtons[kind] = button
            stack.addArrangedSubview(button)
        }

        let colorWell = NSColorWell()
        colorWell.color = .systemRed
        colorWell.target = self
        colorWell.action = #selector(colorChanged(_:))
        colorWell.toolTip = "标注颜色"
        stack.addArrangedSubview(colorWell)

        let width = NSSlider(value: 4, minValue: 1, maxValue: 16, target: self, action: #selector(widthChanged(_:)))
        width.frame.size.width = 72
        width.widthAnchor.constraint(equalToConstant: 72).isActive = true
        width.toolTip = "线条粗细"
        stack.addArrangedSubview(width)

        let undo = makeButton("撤销", #selector(undo))
        let redo = makeButton("重做", #selector(redo))
        undoButton = undo
        redoButton = redo
        stack.addArrangedSubview(undo)
        stack.addArrangedSubview(redo)
        stack.addArrangedSubview(NSView())
        stack.addArrangedSubview(makeButton("钉图", #selector(pin)))
        stack.addArrangedSubview(makeButton("复制", #selector(copyImage)))
        stack.addArrangedSubview(makeButton("保存", #selector(saveImage)))
        return stack
    }

    private func makeButton(_ title: String, _ action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .small
        return button
    }

    @objc private func toolClicked(_ sender: NSButton) {
        guard let kind = IRiXiAnnotationKind(rawValue: sender.tag) else { return }
        selectTool(kind)
    }

    private func selectTool(_ kind: IRiXiAnnotationKind) {
        canvas?.tool = kind
        for (value, button) in toolButtons { button.state = value == kind ? .on : .off }
    }

    @objc private func colorChanged(_ sender: NSColorWell) { canvas?.color = sender.color }
    @objc private func widthChanged(_ sender: NSSlider) { canvas?.strokeWidth = CGFloat(sender.doubleValue) }
    @objc private func undo() { canvas?.undo() }
    @objc private func redo() { canvas?.redo() }

    @objc private func copyImage() {
        guard let image = canvas?.renderedImage() else { return }
        IRiXiImageOutput.copy(image)
    }

    @objc private func saveImage() {
        guard let image = canvas?.renderedImage() else { return }
        IRiXiImageOutput.save(image, attachedTo: window)
    }

    @objc private func pin() {
        guard let image = canvas?.renderedImage() else { return }
        IRiXiPinManager.shared.open(image)
    }

    private func refreshHistoryButtons() {
        undoButton?.isEnabled = canvas?.canUndo == true
        redoButton?.isEnabled = canvas?.canRedo == true
    }

    func windowWillClose(_ notification: Notification) {
        Self.active.removeAll { $0 === self }
        canvas = nil
        window = nil
    }
}

@MainActor
final class IRiXiPinManager {
    static let shared = IRiXiPinManager()
    private var controllers: [IRiXiPinnedImageController] = []

    func open(_ image: NSImage) {
        let controller = IRiXiPinnedImageController(image: image)
        controller.onClose = { [weak self, weak controller] in
            guard let controller else { return }
            self?.controllers.removeAll { $0 === controller }
        }
        controllers.append(controller)
        controller.show()
    }
}

private final class IRiXiPinPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@MainActor
private final class IRiXiPinnedImageController {
    var onClose: (() -> Void)?
    private let image: NSImage
    private let initialSize: NSSize
    private let panel: IRiXiPinPanel
    private let imageView: IRiXiPinnedImageView

    init(image: NSImage) {
        self.image = image
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let source = NSSize(width: max(1, image.size.width), height: max(1, image.size.height))
        let scale = min(1, min(screen.visibleFrame.width * 0.75 / source.width, screen.visibleFrame.height * 0.75 / source.height))
        initialSize = NSSize(width: source.width * scale, height: source.height * scale)
        panel = IRiXiPinPanel(
            contentRect: NSRect(origin: .zero, size: initialSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        imageView = IRiXiPinnedImageView(image: image)
        imageView.frame = NSRect(origin: .zero, size: initialSize)
        imageView.autoresizingMask = [.width, .height]
        panel.contentView = imageView
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentAspectRatio = source

        imageView.onClose = { [weak self] in self?.closePanel() }
        imageView.onCopy = { IRiXiImageOutput.copy(image) }
        imageView.onSave = { [weak panel] in IRiXiImageOutput.save(image, attachedTo: panel) }
        imageView.onEdit = { [weak self] in
            IRiXiImageEditorController.open(image: image)
            self?.closePanel()
        }
        imageView.onZoom = { [weak self] factor, point in self?.zoom(by: factor, around: point) }
    }

    func show() {
        panel.center()
        panel.orderFrontRegardless()
    }

    private func closePanel() {
        panel.orderOut(nil)
        panel.close()
        onClose?()
    }

    private func zoom(by factor: CGFloat, around point: NSPoint) {
        let old = panel.frame
        let current = old.width / initialSize.width
        let next = min(5, max(0.1, current * factor))
        guard abs(next - current) > 0.001 else { return }
        let size = NSSize(width: initialSize.width * next, height: initialSize.height * next)
        let screenPoint = NSPoint(x: old.minX + point.x, y: old.minY + point.y)
        let fraction = NSPoint(x: point.x / old.width, y: point.y / old.height)
        panel.setFrame(NSRect(
            x: screenPoint.x - fraction.x * size.width,
            y: screenPoint.y - fraction.y * size.height,
            width: size.width,
            height: size.height
        ), display: true)
    }
}

@MainActor
private final class IRiXiPinnedImageView: NSView {
    var onClose: (() -> Void)?
    var onCopy: (() -> Void)?
    var onSave: (() -> Void)?
    var onEdit: (() -> Void)?
    var onZoom: ((CGFloat, NSPoint) -> Void)?

    private let image: NSImage
    private var trackingArea: NSTrackingArea?
    private lazy var editButton = overlayButton(symbol: "pencil", action: #selector(editPinnedImage))
    private lazy var closeButton = overlayButton(symbol: "xmark", action: #selector(closePinnedImage))

    init(image: NSImage) {
        self.image = image
        super.init(frame: .zero)
        addSubview(editButton)
        addSubview(closeButton)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds, xRadius: 6, yRadius: 6)
        path.addClip()
        image.draw(in: bounds, from: .zero, operation: .copy, fraction: 1)
        NSColor.white.withAlphaComponent(0.35).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6)
        border.stroke()
    }

    override func layout() {
        closeButton.frame = NSRect(x: bounds.maxX - 30, y: bounds.maxY - 30, width: 24, height: 24)
        editButton.frame = NSRect(x: bounds.maxX - 58, y: bounds.maxY - 30, width: 24, height: 24)
    }

    override func updateTrackingAreas() {
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        trackingArea = area
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        editButton.isHidden = false
        closeButton.isHidden = false
    }

    override func mouseExited(with event: NSEvent) {
        editButton.isHidden = true
        closeButton.isHidden = true
    }

    override func scrollWheel(with event: NSEvent) {
        let sensitivity: CGFloat = event.hasPreciseScrollingDeltas ? 0.005 : 0.03
        onZoom?(max(0.1, 1 + event.scrollingDeltaY * sensitivity), convert(event.locationInWindow, from: nil))
    }

    override func magnify(with event: NSEvent) {
        onZoom?(max(0.1, 1 + event.magnification), convert(event.locationInWindow, from: nil))
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = NSMenu()
        for (title, action) in [
            ("复制图片", #selector(copyPinnedImage)),
            ("另存为…", #selector(savePinnedImage)),
            ("编辑标注", #selector(editPinnedImage)),
        ] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        menu.addItem(.separator())
        let closeItem = NSMenuItem(title: "关闭钉图", action: #selector(closePinnedImage), keyEquivalent: "")
        closeItem.target = self
        menu.addItem(closeItem)
        return menu
    }

    private func overlayButton(symbol: String, action: Selector) -> NSButton {
        let button = NSButton(frame: NSRect(x: 0, y: 0, width: 24, height: 24))
        button.bezelStyle = .circular
        button.isBordered = false
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        button.contentTintColor = .white
        button.wantsLayer = true
        button.layer?.cornerRadius = 12
        button.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.65).cgColor
        button.target = self
        button.action = action
        button.isHidden = true
        return button
    }

    @objc private func closePinnedImage() { onClose?() }
    @objc private func copyPinnedImage() { onCopy?() }
    @objc private func savePinnedImage() { onSave?() }
    @objc private func editPinnedImage() { onEdit?() }
}
