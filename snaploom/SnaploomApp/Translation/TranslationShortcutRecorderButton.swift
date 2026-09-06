import AppKit

/// Small, reusable AppKit shortcut recorder. It only records a key while the
/// user has explicitly clicked the button; it never installs a passive key
/// monitor in the background.
@MainActor
final class TranslationShortcutRecorderButton: NSButton {
    var onShortcutRecorded: ((TranslationShortcutDefinition) -> Bool)?
    var onMessage: ((String) -> Void)?

    private var shortcut: TranslationShortcutDefinition
    private var keyMonitor: Any?

    init(shortcut: TranslationShortcutDefinition? = nil) {
        self.shortcut = shortcut ?? .load()
        super.init(frame: .zero)
        bezelStyle = .rounded
        target = self
        action = #selector(beginRecording)
        toolTip = "点击后按下新的划译快捷键"
        setAccessibilityLabel("划译快捷键")
        refreshTitle()
    }

    required init?(coder: NSCoder) {
        nil
    }

    deinit {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    }

    @objc private func beginRecording() {
        stopRecording()
        title = "请按新快捷键…"
        onMessage?("请按一个带 ⌘、⌥、⌃ 或 ⇧ 的组合键；按 Esc 取消")
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.record(event)
            return nil
        }
    }

    private func record(_ event: NSEvent) {
        if event.keyCode == 53 { // Escape
            stopRecording()
            refreshTitle()
            onMessage?("已取消修改快捷键")
            return
        }

        let candidate = TranslationShortcutDefinition(
            keyCode: UInt32(event.keyCode),
            modifiers: event.modifierFlags
        )
        guard candidate.isValid else {
            NSSound.beep()
            onMessage?("快捷键需要包含 ⌘、⌥、⌃ 或 ⇧，并使用字母、数字或功能键")
            return
        }

        stopRecording()
        if onShortcutRecorded?(candidate) == true {
            shortcut = candidate
            shortcut.save()
            refreshTitle()
            onMessage?("划译快捷键已改为 \(shortcut.displayString)")
        } else {
            refreshTitle()
            NSSound.beep()
            onMessage?("这个快捷键已被其他应用占用，请换一个")
        }
    }

    private func stopRecording() {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        keyMonitor = nil
    }

    private func refreshTitle() {
        title = "划译快捷键：\(shortcut.displayString)"
        setAccessibilityValue(shortcut.displayString)
    }
}
