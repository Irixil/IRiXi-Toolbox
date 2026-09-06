import AppKit
import Carbon.HIToolbox
import Foundation

struct TranslationShortcutDefinition: Codable, Equatable, Sendable {
    static let storageKey = "irixi.translation.selectionShortcut"
    static let defaultVersionKey = "irixi.translation.selectionShortcutDefaultVersion"
    static let currentDefaultVersion = 2
    static let legacyDefaultValue = TranslationShortcutDefinition(
        keyCode: UInt32(kVK_ANSI_T),
        modifiers: [.command]
    )
    static let defaultValue = TranslationShortcutDefinition(
        keyCode: UInt32(kVK_ANSI_Y),
        modifiers: [.control, .option]
    )

    let keyCode: UInt32
    private let modifierRawValue: UInt

    init(keyCode: UInt32, modifiers: NSEvent.ModifierFlags) {
        self.keyCode = keyCode
        modifierRawValue = modifiers
            .intersection([.command, .control, .option, .shift])
            .rawValue
    }

    var modifiers: NSEvent.ModifierFlags {
        NSEvent.ModifierFlags(rawValue: modifierRawValue)
    }

    var isValid: Bool {
        !modifiers.isEmpty && Self.keyNames[keyCode] != nil
    }

    var displayString: String {
        var value = ""
        if modifiers.contains(.control) { value += "⌃" }
        if modifiers.contains(.option) { value += "⌥" }
        if modifiers.contains(.shift) { value += "⇧" }
        if modifiers.contains(.command) { value += "⌘" }
        value += Self.keyNames[keyCode] ?? "?"
        return value
    }

    func save(defaults: UserDefaults = .standard) {
        guard isValid, let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    static func load(defaults: UserDefaults = .standard) -> TranslationShortcutDefinition {
        guard let data = defaults.data(forKey: storageKey),
              let value = try? JSONDecoder().decode(Self.self, from: data),
              value.isValid else {
            defaultValue.save(defaults: defaults)
            defaults.set(currentDefaultVersion, forKey: defaultVersionKey)
            return defaultValue
        }

        let savedVersion = defaults.integer(forKey: defaultVersionKey)
        if savedVersion < currentDefaultVersion, value == legacyDefaultValue {
            defaultValue.save(defaults: defaults)
            defaults.set(currentDefaultVersion, forKey: defaultVersionKey)
            return defaultValue
        }
        defaults.set(currentDefaultVersion, forKey: defaultVersionKey)
        return value
    }

    static let keyNames: [UInt32: String] = [
        UInt32(kVK_ANSI_A): "A", UInt32(kVK_ANSI_B): "B",
        UInt32(kVK_ANSI_C): "C", UInt32(kVK_ANSI_D): "D",
        UInt32(kVK_ANSI_E): "E", UInt32(kVK_ANSI_F): "F",
        UInt32(kVK_ANSI_G): "G", UInt32(kVK_ANSI_H): "H",
        UInt32(kVK_ANSI_I): "I", UInt32(kVK_ANSI_J): "J",
        UInt32(kVK_ANSI_K): "K", UInt32(kVK_ANSI_L): "L",
        UInt32(kVK_ANSI_M): "M", UInt32(kVK_ANSI_N): "N",
        UInt32(kVK_ANSI_O): "O", UInt32(kVK_ANSI_P): "P",
        UInt32(kVK_ANSI_Q): "Q", UInt32(kVK_ANSI_R): "R",
        UInt32(kVK_ANSI_S): "S", UInt32(kVK_ANSI_T): "T",
        UInt32(kVK_ANSI_U): "U", UInt32(kVK_ANSI_V): "V",
        UInt32(kVK_ANSI_W): "W", UInt32(kVK_ANSI_X): "X",
        UInt32(kVK_ANSI_Y): "Y", UInt32(kVK_ANSI_Z): "Z",
        UInt32(kVK_ANSI_0): "0", UInt32(kVK_ANSI_1): "1",
        UInt32(kVK_ANSI_2): "2", UInt32(kVK_ANSI_3): "3",
        UInt32(kVK_ANSI_4): "4", UInt32(kVK_ANSI_5): "5",
        UInt32(kVK_ANSI_6): "6", UInt32(kVK_ANSI_7): "7",
        UInt32(kVK_ANSI_8): "8", UInt32(kVK_ANSI_9): "9",
        UInt32(kVK_Space): "Space", UInt32(kVK_Return): "Return",
        UInt32(kVK_Tab): "Tab", UInt32(kVK_Delete): "Delete",
        UInt32(kVK_LeftArrow): "←", UInt32(kVK_RightArrow): "→",
        UInt32(kVK_UpArrow): "↑", UInt32(kVK_DownArrow): "↓",
        UInt32(kVK_F1): "F1", UInt32(kVK_F2): "F2",
        UInt32(kVK_F3): "F3", UInt32(kVK_F4): "F4",
        UInt32(kVK_F5): "F5", UInt32(kVK_F6): "F6",
        UInt32(kVK_F7): "F7", UInt32(kVK_F8): "F8",
        UInt32(kVK_F9): "F9", UInt32(kVK_F10): "F10",
        UInt32(kVK_F11): "F11", UInt32(kVK_F12): "F12",
    ]
}

enum TranslationShortcutRegistrationError: Error, Equatable {
    case invalid
    case conflict
    case unavailable(OSStatus)
}

@MainActor
final class TranslationShortcutManager {
    var onTrigger: (() -> Void)?

    nonisolated(unsafe) private var eventHandler: EventHandlerRef?
    nonisolated(unsafe) private var hotKey: EventHotKeyRef?
    private(set) var currentShortcut: TranslationShortcutDefinition?

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }

    func register(_ shortcut: TranslationShortcutDefinition) throws {
        guard shortcut.isValid else { throw TranslationShortcutRegistrationError.invalid }
        try installEventHandlerIfNeeded()
        if shortcut == currentShortcut { return }

        var newHotKey: EventHotKeyRef?
        let identifier = EventHotKeyID(signature: Self.signature, id: 1)
        let status = RegisterEventHotKey(
            shortcut.keyCode,
            carbonModifiers(for: shortcut.modifiers),
            identifier,
            GetApplicationEventTarget(),
            0,
            &newHotKey
        )
        guard status == noErr, let newHotKey else {
            if status == eventHotKeyExistsErr {
                throw TranslationShortcutRegistrationError.conflict
            }
            throw TranslationShortcutRegistrationError.unavailable(status)
        }

        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = newHotKey
        currentShortcut = shortcut
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
        currentShortcut = nil
    }

    private func installEventHandlerIfNeeded() throws {
        guard eventHandler == nil else { return }
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let userData, event != nil else {
                    return OSStatus(eventNotHandledErr)
                }
                let manager = Unmanaged<TranslationShortcutManager>
                    .fromOpaque(userData)
                    .takeUnretainedValue()
                Task { @MainActor in manager.onTrigger?() }
                return noErr
            },
            1,
            &eventType,
            pointer,
            &eventHandler
        )
        guard status == noErr, eventHandler != nil else {
            throw TranslationShortcutRegistrationError.unavailable(status)
        }
    }

    private func carbonModifiers(for flags: NSEvent.ModifierFlags) -> UInt32 {
        var value: UInt32 = 0
        if flags.contains(.command) { value |= UInt32(cmdKey) }
        if flags.contains(.control) { value |= UInt32(controlKey) }
        if flags.contains(.option) { value |= UInt32(optionKey) }
        if flags.contains(.shift) { value |= UInt32(shiftKey) }
        return value
    }

    private static let signature: OSType = 0x4952_5854 // IRXT
}
