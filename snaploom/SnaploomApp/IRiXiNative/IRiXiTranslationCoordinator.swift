import AppKit
import Foundation

/// Owns the mature input/selection translation feature inside the IRiXi host
/// process. No helper app, socket, or second permission identity is involved.
@MainActor
final class IRiXiTranslationCoordinator {
    static let shared = IRiXiTranslationCoordinator()

    private var windowController: NativeInputTranslationWindowController?
    private let selectionService = TranslationSelectionService()
    private let sourceTracker = TranslationSelectionSourceTracker()
    private let shortcutManager = TranslationShortcutManager()
    private var shortcutStartupMessage: String?
    private var prepared = false
    private var presentationID = UUID()

    func prepare() {
        guard !prepared else { return }
        prepared = true
        sourceTracker.start()
        shortcutManager.onTrigger = { [weak self] in
            guard let self else { return }
            let partner = UserDefaults.standard.string(
                forKey: NativeInputTranslationWindowController.partnerDefaultsKey
            ) ?? "en"
            self.translateCurrentSelection(partner: partner)
        }
        do {
            try shortcutManager.register(.load())
        } catch {
            shortcutStartupMessage = "划译快捷键暂时无法启用；仍可从 IRiXi 打开输入翻译"
        }
    }

    func openInput(partner: String) {
        prepare()
        invalidatePendingPresentation()
        ensureWindowController()
        windowController?.show(partner: normalizedPartner(partner))
    }

    func translateCurrentSelection(partner: String? = nil) {
        prepare()
        let requestID = beginPresentation()
        let chosenPartner = normalizedPartner(
            partner ?? UserDefaults.standard.string(
                forKey: NativeInputTranslationWindowController.partnerDefaultsKey
            ) ?? "en"
        )
        let sourceApplication = sourceTracker.preferredSourceApplication()
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let text = try await selectionService.captureSelection(from: sourceApplication)
                guard presentationID == requestID else { return }
                ensureWindowController()
                windowController?.showSelection(text, partner: chosenPartner)
            } catch let error as TranslationSelectionError {
                guard presentationID == requestID else { return }
                if error == .accessibilityPermission {
                    selectionService.requestAccessibilityPermission()
                }
                ensureWindowController()
                windowController?.showSelectionError(error, partner: chosenPartner)
            } catch {
                guard presentationID == requestID else { return }
                ensureWindowController()
                windowController?.showSelectionError(.noSelection, partner: chosenPartner)
            }
        }
    }

    func beginImageTranslation() -> UUID {
        prepare()
        let requestID = beginPresentation()
        let partner = preferredPartner()
        ensureWindowController()
        windowController?.showImageRecognitionPending(partner: partner)
        return requestID
    }

    func finishImageTranslation(requestID: UUID, text: String) {
        guard presentationID == requestID else { return }
        ensureWindowController()
        windowController?.showSelection(text, partner: preferredPartner())
    }

    func failImageTranslation(requestID: UUID, message: String) {
        guard presentationID == requestID else { return }
        ensureWindowController()
        windowController?.showImageRecognitionFailure(message, partner: preferredPartner())
    }

    private func ensureWindowController() {
        guard windowController == nil else { return }
        windowController = NativeInputTranslationWindowController(
            onShortcutChange: { [weak self] shortcut in
                guard let self else { return false }
                do {
                    try shortcutManager.register(shortcut)
                    shortcutStartupMessage = nil
                    return true
                } catch {
                    return false
                }
            },
            onUserTextChange: { [weak self] in
                self?.invalidatePendingPresentation()
            }
        )
        if let shortcutStartupMessage {
            windowController?.showShortcutMessage(shortcutStartupMessage)
        }
    }

    private func normalizedPartner(_ value: String) -> String {
        ["en", "ja", "ko"].contains(value) ? value : "en"
    }

    private func preferredPartner() -> String {
        normalizedPartner(
            UserDefaults.standard.string(
                forKey: NativeInputTranslationWindowController.partnerDefaultsKey
            ) ?? "en"
        )
    }

    @discardableResult
    private func beginPresentation() -> UUID {
        let requestID = UUID()
        presentationID = requestID
        return requestID
    }

    private func invalidatePendingPresentation() {
        presentationID = UUID()
    }
}

@_cdecl("irixi_native_initialize_translation")
public func irixiNativeInitializeTranslation() {
    DispatchQueue.main.async {
        IRiXiTranslationCoordinator.shared.prepare()
    }
}

@_cdecl("irixi_native_open_input_translation")
public func irixiNativeOpenInputTranslation(_ partner: UnsafePointer<CChar>?) -> Int32 {
    let value = partner.map { String(cString: $0) } ?? "en"
    DispatchQueue.main.async {
        IRiXiTranslationCoordinator.shared.openInput(partner: value)
    }
    return 0
}

@_cdecl("irixi_native_translate_current_selection")
public func irixiNativeTranslateCurrentSelection() -> Int32 {
    DispatchQueue.main.async {
        IRiXiTranslationCoordinator.shared.translateCurrentSelection()
    }
    return 0
}
