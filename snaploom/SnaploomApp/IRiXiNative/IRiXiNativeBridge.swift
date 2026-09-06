import AppKit
import CoreGraphics
import Foundation

private let irixiNativeCurrentABIVersion: Int32 = 6

@MainActor
private final class IRiXiNativeTestWindowController {
    static let shared = IRiXiNativeTestWindowController()

    private var window: NSPanel?

    func show() {
        if let window {
            window.orderFrontRegardless()
            return
        }

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 188),
            styleMask: [.titled, .closable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = "IRiXi 原生模块验证"
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let title = NSTextField(labelWithString: "这个窗口由 IRiXi 主程序内部的原生模块打开")
        title.font = .systemFont(ofSize: 15, weight: .semibold)
        title.alignment = .center
        title.translatesAutoresizingMaskIntoConstraints = false

        let detail = NSTextField(labelWithString: "它不是第二个 App，也不会接管灵动岛的应用生命周期。")
        detail.font = .systemFont(ofSize: 12)
        detail.textColor = .secondaryLabelColor
        detail.alignment = .center
        detail.translatesAutoresizingMaskIntoConstraints = false

        let content = NSView(frame: panel.contentRect(forFrameRect: panel.frame))
        content.addSubview(title)
        content.addSubview(detail)
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            title.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            title.centerYAnchor.constraint(equalTo: content.centerYAnchor, constant: -16),
            detail.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            detail.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 12),
        ])
        panel.contentView = content
        panel.center()
        window = panel
        panel.orderFrontRegardless()
    }

    func hide() {
        window?.orderOut(nil)
    }
}

@_cdecl("irixi_native_abi_version")
public func irixiNativeABIVersion() -> Int32 {
    irixiNativeCurrentABIVersion
}

/// Copies the host application's bundle identifier into a caller-owned UTF-8
/// buffer. Returning the required byte count keeps ownership on the Node side.
@_cdecl("irixi_native_copy_bundle_identifier")
public func irixiNativeCopyBundleIdentifier(
    _ buffer: UnsafeMutablePointer<CChar>?,
    _ capacity: Int32
) -> Int32 {
    let value = Bundle.main.bundleIdentifier ?? ""
    let bytes = Array(value.utf8CString)
    guard let buffer, capacity > 0 else { return Int32(bytes.count) }

    let count = min(bytes.count, Int(capacity))
    for index in 0..<count {
        buffer[index] = bytes[index]
    }
    if count == Int(capacity) {
        buffer[count - 1] = 0
    }
    return Int32(bytes.count)
}

@_cdecl("irixi_native_has_screen_capture_access")
public func irixiNativeHasScreenCaptureAccess() -> Bool {
    CGPreflightScreenCaptureAccess()
}

/// This function must only be called after a visible user action. W19 keeps it
/// available for the packaged manual check but never invokes it automatically.
@_cdecl("irixi_native_request_screen_capture_access")
public func irixiNativeRequestScreenCaptureAccess() -> Bool {
    CGRequestScreenCaptureAccess()
}

@_cdecl("irixi_native_show_test_window")
public func irixiNativeShowTestWindow() {
    DispatchQueue.main.async {
        IRiXiNativeTestWindowController.shared.show()
    }
}

@_cdecl("irixi_native_hide_test_window")
public func irixiNativeHideTestWindow() {
    DispatchQueue.main.async {
        IRiXiNativeTestWindowController.shared.hide()
    }
}
