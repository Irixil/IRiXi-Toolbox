import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

enum TranslationSelectionError: Error, Equatable {
    case accessibilityPermission
    case noSelection
    case protectedContent
    case textTooLong
}

struct TranslationPasteboardSnapshot {
    struct Item {
        let entries: [(type: NSPasteboard.PasteboardType, data: Data)]
    }

    let items: [Item]

    static func capture(from pasteboard: NSPasteboard = .general) -> TranslationPasteboardSnapshot {
        let items = (pasteboard.pasteboardItems ?? []).map { item in
            Item(entries: item.types.compactMap { type in
                item.data(forType: type).map { (type, $0) }
            })
        }
        return TranslationPasteboardSnapshot(items: items)
    }

    func restore(to pasteboard: NSPasteboard = .general) {
        pasteboard.clearContents()
        let restoredItems = items.map { snapshot in
            let item = NSPasteboardItem()
            for entry in snapshot.entries {
                item.setData(entry.data, forType: entry.type)
            }
            return item
        }
        if !restoredItems.isEmpty {
            pasteboard.writeObjects(restoredItems)
        }
    }
}

/// Reads only the selection the user explicitly asked to translate. The normal
/// path uses Accessibility. The compatibility fallback borrows the pasteboard
/// for Cmd-C and restores every original pasteboard item before returning.
@MainActor
final class TranslationSelectionService {
    static let maximumTextCharacters = 5_000

    var hasAccessibilityPermission: Bool {
        AXIsProcessTrusted()
    }

    @discardableResult
    func requestAccessibilityPermission() -> Bool {
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    func captureSelection(from sourceApplication: NSRunningApplication?) async throws -> String {
        guard hasAccessibilityPermission else {
            throw TranslationSelectionError.accessibilityPermission
        }

        guard let sourceApplication, !sourceApplication.isTerminated else {
            throw TranslationSelectionError.noSelection
        }
        // Some apps allow an accessibility-trusted caller to synthesize Copy
        // but do not expose kAXFocusedUIElement or kAXSelectedText. Treat that
        // as a compatibility case and continue to the pasteboard fallback.
        if let focusedElement = try? focusedUIElement(in: sourceApplication) {
            if isProtected(focusedElement) {
                throw TranslationSelectionError.protectedContent
            }

            if let text: String = attribute(kAXSelectedTextAttribute, of: focusedElement),
               !text.isEmpty {
                return try validated(text)
            }
        }
        return try validated(await readSelectionThroughPasteboard(from: sourceApplication))
    }

    private func validated(_ text: String) throws -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw TranslationSelectionError.noSelection }
        guard trimmed.count <= Self.maximumTextCharacters else {
            throw TranslationSelectionError.textTooLong
        }
        return trimmed
    }

    private func focusedUIElement(in application: NSRunningApplication) throws -> AXUIElement {
        let root = AXUIElementCreateApplication(application.processIdentifier)
        var value: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(
            root,
            kAXFocusedUIElementAttribute as CFString,
            &value
        )
        guard status == .success, let value else {
            throw TranslationSelectionError.noSelection
        }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    private func attribute<T>(_ name: String, of element: AXUIElement) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
            return nil
        }
        return value as? T
    }

    private func isProtected(_ element: AXUIElement) -> Bool {
        let subrole: String? = attribute(kAXSubroleAttribute, of: element)
        return subrole == kAXSecureTextFieldSubrole
    }

    private func readSelectionThroughPasteboard(
        from sourceApplication: NSRunningApplication
    ) async throws -> String {
        let pasteboard = NSPasteboard.general
        let snapshot = TranslationPasteboardSnapshot.capture(from: pasteboard)
        defer { snapshot.restore(to: pasteboard) }

        sourceApplication.activate(options: [])
        try await Task.sleep(nanoseconds: 50_000_000)
        pasteboard.clearContents()
        let initialChangeCount = pasteboard.changeCount
        postCommandCopy()

        for _ in 0..<25 {
            try await Task.sleep(nanoseconds: 12_000_000)
            if pasteboard.changeCount != initialChangeCount,
               let text = pasteboard.string(forType: .string),
               !text.isEmpty {
                return text
            }
        }
        throw TranslationSelectionError.noSelection
    }

    private func postCommandCopy() {
        guard let source = CGEventSource(stateID: .combinedSessionState) else { return }
        let keyCode = CGKeyCode(kVK_ANSI_C)
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
        keyDown?.flags = .maskCommand
        keyUp?.flags = .maskCommand
        keyDown?.post(tap: .cghidEventTap)
        keyUp?.post(tap: .cghidEventTap)
    }
}
