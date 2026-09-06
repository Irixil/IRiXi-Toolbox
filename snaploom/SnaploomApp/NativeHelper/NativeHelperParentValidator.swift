import Darwin
import Foundation
import Security

enum NativeHelperParentValidator {
    enum Failure: String, Error {
        case helperBundleName = "helper_bundle_name"
        case helpersDirectory = "helpers_directory"
        case contentsDirectory = "contents_directory"
        case hostBundle = "host_bundle"
        case hostBundleIdentifier = "host_bundle_identifier"
        case hostExecutableName = "host_executable_name"
        case parentExecutableUnavailable = "parent_executable_unavailable"
        case parentExecutableMismatch = "parent_executable_mismatch"
        case hostSignature = "host_signature"
    }

    private static let expectedHostBundleIdentifier = "com.irixi.toolbox"

    static func validateParent() -> Result<Void, Failure> {
        #if DEBUG
        // Compiled out of Release builds; used only before the helper is
        // embedded in IRiXi so the protocol can be exercised in isolation.
        if ProcessInfo.processInfo.environment["IRIXI_HELPER_ALLOW_TEST_PARENT"] == "1" {
            return .success(())
        }
        #endif

        let helperBundleURL = Bundle.main.bundleURL.standardizedFileURL
        guard helperBundleURL.lastPathComponent == "IRiXi Native Helper.app" else {
            return .failure(.helperBundleName)
        }

        let helpersDirectory = helperBundleURL.deletingLastPathComponent()
        guard helpersDirectory.lastPathComponent == "Helpers" else {
            return .failure(.helpersDirectory)
        }

        let contentsDirectory = helpersDirectory.deletingLastPathComponent()
        guard contentsDirectory.lastPathComponent == "Contents" else {
            return .failure(.contentsDirectory)
        }

        let hostBundleURL = contentsDirectory.deletingLastPathComponent()
        guard hostBundleURL.pathExtension == "app", let hostBundle = Bundle(url: hostBundleURL) else {
            return .failure(.hostBundle)
        }
        guard hostBundle.bundleIdentifier == expectedHostBundleIdentifier else {
            return .failure(.hostBundleIdentifier)
        }
        guard let executableName = hostBundle.object(forInfoDictionaryKey: "CFBundleExecutable") as? String,
              !executableName.isEmpty else {
            return .failure(.hostExecutableName)
        }

        let expectedExecutable = hostBundleURL
            .appendingPathComponent("Contents/MacOS", isDirectory: true)
            .appendingPathComponent(executableName)
            .standardizedFileURL

        guard let parentExecutable = parentExecutableURL() else {
            return .failure(.parentExecutableUnavailable)
        }
        guard normalized(parentExecutable) == normalized(expectedExecutable) else {
            return .failure(.parentExecutableMismatch)
        }

        guard hasValidHostSignature(at: hostBundleURL) else {
            return .failure(.hostSignature)
        }
        return .success(())
    }

    private static func parentExecutableURL() -> URL? {
        var buffer = [CChar](repeating: 0, count: 4 * 1024)
        let length = proc_pidpath(getppid(), &buffer, UInt32(buffer.count))
        guard length > 0 else { return nil }
        return URL(fileURLWithPath: String(cString: buffer))
    }

    private static func normalized(_ url: URL) -> String {
        url.resolvingSymlinksInPath()
            .standardizedFileURL
            .path
            .precomposedStringWithCanonicalMapping
    }

    private static func hasValidHostSignature(at bundleURL: URL) -> Bool {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(bundleURL as CFURL, [], &staticCode) == errSecSuccess,
              let staticCode else {
            return false
        }

        var requirement: SecRequirement?
        let requirementText = "identifier \"\(expectedHostBundleIdentifier)\"" as CFString
        guard SecRequirementCreateWithString(requirementText, [], &requirement) == errSecSuccess,
              let requirement else {
            return false
        }

        let flags = SecCSFlags(rawValue: kSecCSStrictValidate)
        return SecStaticCodeCheckValidity(staticCode, flags, requirement) == errSecSuccess
    }
}
