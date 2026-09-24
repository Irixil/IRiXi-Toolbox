import AppKit
import Darwin

@main struct CodexTranslationPreview {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : Bundle.main.bundlePath + "/Contents/Frameworks/IRiXiNativeKit.framework/IRiXiNativeKit"
        guard let library = dlopen(path, RTLD_NOW | RTLD_LOCAL),
              let symbol = dlsym(library, "irixi_native_open_input_translation") else { fatalError("framework unavailable") }
        let openWindow = unsafeBitCast(symbol, to: (@convention(c) (UnsafePointer<CChar>?) -> Int32).self)
        _ = openWindow(nil)
        app.activate(ignoringOtherApps: true)
        app.run()
    }
}
