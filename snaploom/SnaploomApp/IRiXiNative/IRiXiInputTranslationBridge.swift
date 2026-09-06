import AppKit
import Combine
import SwiftUI
@preconcurrency import Translation

/// Supplies Apple's supported SwiftUI-backed translation session to the
/// existing Snaploom input-translation window without bringing its legacy
/// network translation path into the IRiXi in-process module.
@available(macOS 15.0, *)
@MainActor
final class IRiXiInputTranslationBridgeRuntime: ObservableObject {
    static let shared = IRiXiInputTranslationBridgeRuntime()

    @Published var configuration: TranslationSession.Configuration?
    private var hostingView: NSView?
    private var pendingTexts: [String] = []
    private var pendingCompletion: ((Result<[String], Error>) -> Void)?
    private var translationID: UUID?

    func translate(
        texts: [String],
        configuration: TranslationSession.Configuration,
        completion: @escaping (Result<[String], Error>) -> Void
    ) {
        cancel()
        let requestID = UUID()
        translationID = requestID
        pendingTexts = texts
        pendingCompletion = completion

        let hosting = NSHostingView(rootView: IRiXiInputTranslationBridgeView(bridge: self))
        hosting.frame = NSRect(x: -2, y: -2, width: 1, height: 1)
        NSApp.windows.first(where: { $0.contentView != nil })?.contentView?.addSubview(hosting)
        hostingView = hosting
        self.configuration = configuration

        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            guard let self,
                  self.translationID == requestID,
                  let completion = self.pendingCompletion
            else { return }
            self.cleanup()
            completion(.failure(IRiXiInputTranslationError.failed(
                "Apple 本机翻译等待超时，请确认语言包可用后重试。"
            )))
        }
    }

    fileprivate func sessionReady(_ session: TranslationSession) {
        guard let completion = pendingCompletion else { return }
        let texts = pendingTexts
        let requestID = translationID
        Task {
            do {
                try await session.prepareTranslation()
                var output: [String] = []
                output.reserveCapacity(texts.count)
                for text in texts {
                    guard await MainActor.run(body: { self.translationID == requestID }) else { return }
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.isEmpty {
                        output.append(text)
                    } else {
                        output.append(try await session.translate(trimmed).targetText)
                    }
                }
                await MainActor.run {
                    guard self.translationID == requestID else { return }
                    self.cleanup()
                    completion(.success(output))
                }
            } catch {
                await MainActor.run {
                    guard self.translationID == requestID else { return }
                    self.cleanup()
                    completion(.failure(IRiXiInputTranslationError.failed(error.localizedDescription)))
                }
            }
        }
    }

    func cancel() {
        cleanup()
    }

    private func cleanup() {
        hostingView?.removeFromSuperview()
        hostingView = nil
        pendingTexts = []
        pendingCompletion = nil
        configuration = nil
        translationID = nil
    }
}

@available(macOS 15.0, *)
private struct IRiXiInputTranslationBridgeView: View {
    @ObservedObject var bridge: IRiXiInputTranslationBridgeRuntime

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .translationTask(bridge.configuration) { session in
                await MainActor.run {
                    bridge.sessionReady(session)
                }
            }
    }
}

private enum IRiXiInputTranslationError: LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let message): return message
        }
    }
}
