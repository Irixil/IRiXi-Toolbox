import AppKit
import Foundation

enum NativeHelperAction: String {
    case health
    case translationInputOpen = "translation.input.open"
    case translationSelection = "translation.selection"
    case captureArea = "capture.area"
    case captureWindow = "capture.window"
    case captureFullscreen = "capture.fullscreen"
    case captureOCR = "capture.ocr"
    case captureTranslate = "capture.translate"
}

struct NativeHelperCommand: Sendable {
    let action: NativeHelperAction
    let partner: String?
    let target: String?
}

private struct NativeHelperResponse: Encodable {
    let v = 1
    let id: String?
    let status: String
    let code: String?
}

/// The native helper's only command surface. Each process accepts newline-delimited
/// JSON from its inherited stdin and writes status-only JSON to stdout. It never
/// opens a socket and never accepts a path, URL, command, or arbitrary argument.
final class NativeHelperServer: @unchecked Sendable {
    static let protocolVersion = 1
    static let maximumLineBytes = 64 * 1024

    private let input: FileHandle
    private let output: FileHandle
    private let queue = DispatchQueue(label: "com.irixi.toolbox.native-helper.stdin")
    private let outputLock = NSLock()
    private var seenRequestIDs = Set<String>()
    private let actionHandler: @Sendable (NativeHelperCommand, @escaping @Sendable (Bool) -> Void) -> Void

    init(
        input: FileHandle = .standardInput,
        output: FileHandle = .standardOutput,
        actionHandler: @escaping @Sendable (NativeHelperCommand, @escaping @Sendable (Bool) -> Void) -> Void
    ) {
        self.input = input
        self.output = output
        self.actionHandler = actionHandler
    }

    func start() {
        queue.async { [self] in
            readLoop()
        }
    }

    private func readLoop() {
        var buffer = Data()
        var discardingOversizedLine = false

        while true {
            guard let chunk = readPipeChunk() else {
                requestApplicationExit()
                return
            }

            guard !chunk.isEmpty else {
                requestApplicationExit()
                return
            }

            for byte in chunk {
                if discardingOversizedLine {
                    if byte == 0x0A {
                        discardingOversizedLine = false
                    }
                    continue
                }

                if byte == 0x0A {
                    processLine(buffer)
                    buffer.removeAll(keepingCapacity: true)
                    continue
                }

                buffer.append(byte)
                if buffer.count > Self.maximumLineBytes {
                    writeFailure(id: nil, code: "protocol_error")
                    buffer.removeAll(keepingCapacity: true)
                    discardingOversizedLine = true
                }
            }
        }
    }

    /// `FileHandle.read(upToCount:)` can wait for the requested byte count when
    /// this app is launched as a nested GUI helper. POSIX `read(2)` returns as
    /// soon as the parent writes one JSONL request, which is the pipe behaviour
    /// required by this protocol.
    private func readPipeChunk() -> Data? {
        var bytes = [UInt8](repeating: 0, count: 4 * 1024)
        while true {
            let count = Darwin.read(input.fileDescriptor, &bytes, bytes.count)
            if count > 0 {
                return Data(bytes.prefix(Int(count)))
            }
            if count == 0 {
                return Data()
            }
            if errno != EINTR {
                return nil
            }
        }
    }

    private func processLine(_ line: Data) {
        guard !line.isEmpty else { return }

        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: line)
        } catch {
            writeFailure(id: nil, code: "protocol_error")
            return
        }

        guard let request = object as? [String: Any] else {
            writeFailure(id: nil, code: "protocol_error")
            return
        }

        let requiredKeys: Set<String> = ["v", "id", "action", "args"]
        guard Set(request.keys) == requiredKeys else {
            writeFailure(id: request["id"] as? String, code: "protocol_error")
            return
        }

        guard let version = request["v"] as? Int,
              version == Self.protocolVersion else {
            writeFailure(id: request["id"] as? String, code: "protocol_error")
            return
        }

        guard let id = request["id"] as? String,
              id.utf8.count <= 36,
              UUID(uuidString: id) != nil else {
            writeFailure(id: nil, code: "protocol_error")
            return
        }

        guard !seenRequestIDs.contains(id) else {
            writeFailure(id: id, code: "duplicate")
            return
        }
        seenRequestIDs.insert(id)

        guard let rawAction = request["action"] as? String,
              let action = NativeHelperAction(rawValue: rawAction) else {
            writeFailure(id: id, code: "invalid_action")
            return
        }

        guard let args = request["args"] as? [String: Any] else {
            writeFailure(id: id, code: "invalid_args")
            return
        }

        let command: NativeHelperCommand
        switch action {
        case .health:
            guard args.isEmpty else {
                writeFailure(id: id, code: "invalid_args")
                return
            }
            command = .init(action: action, partner: nil, target: nil)
        case .translationInputOpen, .translationSelection:
            guard Set(args.keys) == ["partner"],
                  let partner = args["partner"] as? String,
                  ["en", "ja", "ko"].contains(partner) else {
                writeFailure(id: id, code: "invalid_args")
                return
            }
            command = .init(action: action, partner: partner, target: nil)
        case .captureArea, .captureWindow, .captureFullscreen, .captureOCR:
            guard args.isEmpty else {
                writeFailure(id: id, code: "invalid_args")
                return
            }
            command = .init(action: action, partner: nil, target: nil)
        case .captureTranslate:
            let allowedTargets = Set(TranslationService.availableLanguages.map(\.code))
            guard Set(args.keys) == ["target"],
                  let target = args["target"] as? String,
                  allowedTargets.contains(target) else {
                writeFailure(id: id, code: "invalid_args")
                return
            }
            command = .init(action: action, partner: nil, target: target)
        }

        switch action {
        case .health:
            writeResponse(.init(id: id, status: "completed", code: nil))
        case .translationInputOpen, .translationSelection,
             .captureArea, .captureWindow, .captureFullscreen,
             .captureOCR, .captureTranslate:
            writeResponse(.init(id: id, status: "started", code: nil))
            actionHandler(command) { [weak self] succeeded in
                guard let self else { return }
                if succeeded {
                    self.writeResponse(.init(id: id, status: "completed", code: nil))
                } else {
                    self.writeFailure(id: id, code: "failed")
                }
            }
        }
    }

    private func writeFailure(id: String?, code: String) {
        writeResponse(.init(id: id, status: "failed", code: code))
    }

    private func writeResponse(_ response: NativeHelperResponse) {
        guard var data = try? JSONEncoder().encode(response) else { return }
        data.append(0x0A)

        outputLock.lock()
        defer { outputLock.unlock() }
        do {
            try output.write(contentsOf: data)
        } catch {
            requestApplicationExit()
        }
    }

    private func requestApplicationExit() {
        DispatchQueue.main.async {
            NSApp.terminate(nil)
        }
    }
}
