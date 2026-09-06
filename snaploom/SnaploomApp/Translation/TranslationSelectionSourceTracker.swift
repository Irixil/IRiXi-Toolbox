import AppKit
import Darwin

/// Remembers the most recent real source application without reading or
/// storing any of its content. The helper and its Electron parent are excluded
/// so clicking IRiXi does not erase the app where the user made a selection.
@MainActor
final class TranslationSelectionSourceTracker: NSObject {
    private let workspace = NSWorkspace.shared
    private let parentProcessIdentifier: pid_t
    private var lastExternalApplication: NSRunningApplication?
    private var isStarted = false

    init(parentProcessIdentifier: pid_t = getppid()) {
        self.parentProcessIdentifier = parentProcessIdentifier
        super.init()
    }

    deinit {
        workspace.notificationCenter.removeObserver(self)
    }

    func start() {
        guard !isStarted else { return }
        isStarted = true
        workspace.notificationCenter.addObserver(
            self,
            selector: #selector(applicationDidActivate),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
        rememberIfEligible(workspace.frontmostApplication)
    }

    func preferredSourceApplication() -> NSRunningApplication? {
        rememberIfEligible(workspace.frontmostApplication)
        guard let app = lastExternalApplication, !app.isTerminated else { return nil }
        return app
    }

    @objc private func applicationDidActivate(_ notification: Notification) {
        let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
            as? NSRunningApplication
        rememberIfEligible(application)
    }

    private func rememberIfEligible(_ application: NSRunningApplication?) {
        guard let application,
              !application.isTerminated,
              application.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              application.processIdentifier != parentProcessIdentifier
        else { return }
        lastExternalApplication = application
    }
}
