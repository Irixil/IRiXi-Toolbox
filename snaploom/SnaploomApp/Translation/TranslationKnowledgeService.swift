import CoreServices
import Foundation
import NaturalLanguage
import Security

struct IRiXiAICitation: Equatable {
    let title: String
    let url: URL
    let range: NSRange?
}

struct IRiXiAIExplanation: Equatable {
    let text: String
    let citations: [IRiXiAICitation]
}

enum IRiXiTranslationKnowledgeError: LocalizedError {
    case emptyText
    case textTooLong
    case missingAPIKey
    case invalidResponse
    case remote(String)
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .emptyText:
            return "请先输入文字，或在原文中选中要解释的词。"
        case .textTooLong:
            return "AI 解释最多发送 3000 个字符，请缩短原文后重试。"
        case .missingAPIKey:
            return "请先设置 OpenAI API 密钥。"
        case .invalidResponse:
            return "AI 返回的内容无法读取，请稍后重试。"
        case .remote(let message):
            return message
        case .keychain:
            return "系统钥匙串没有完成这个操作。"
        }
    }
}

enum IRiXiLocalDictionary {
    static let maximumDisplayedCharacters = 7_000

    static func explanation(for sourceText: String, selectedText: String?) -> String {
        let source = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        let selected = selectedText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let focus = selected.isEmpty ? source : selected
        guard !focus.isEmpty else { return "请先输入文字，或选中要查的词。" }

        let directTerm = normalizedTerm(focus)
        let visibleWordCount = focus.split(whereSeparator: { $0.isWhitespace }).count
        if (!selected.isEmpty || visibleWordCount <= 3), let direct = definition(for: directTerm) {
            return limited("查询：\(directTerm)\n\n\(direct)")
        }

        let terms = lookupTerms(in: focus)
        let definitions = terms.compactMap { term -> String? in
            guard let value = definition(for: term) else { return nil }
            return "\(term)\n\(value)"
        }
        guard !definitions.isEmpty else {
            return "本机词典暂时没有找到“\(limited(focus, maximum: 80))”。\n\n你可以选中更短的单词或短语再试，也可以使用“AI 联网解释”结合上下文查询。"
        }
        let heading = selected.isEmpty ? "从这段文字中找到的词典释义" : "所选内容的词典释义"
        return limited(([heading] + definitions).joined(separator: "\n\n"))
    }

    static func lookupTerms(in text: String) -> [String] {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return [] }

        let stopWords: Set<String> = [
            "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
            "had", "has", "have", "he", "her", "him", "his", "i", "in", "is", "it",
            "its", "me", "my", "not", "of", "on", "or", "our", "she", "so", "that",
            "the", "their", "them", "they", "this", "to", "was", "we", "were", "with",
            "you", "your",
        ]
        let tagger = NLTagger(tagSchemes: [.lexicalClass])
        tagger.string = normalized
        var terms: [String] = []
        var seen = Set<String>()
        let options: NLTagger.Options = [.omitWhitespace, .omitPunctuation, .joinNames]
        tagger.enumerateTags(
            in: normalized.startIndex..<normalized.endIndex,
            unit: .word,
            scheme: .lexicalClass,
            options: options
        ) { _, range in
            let raw = String(normalized[range]).trimmingCharacters(in: .whitespacesAndNewlines)
            let term = normalizedTerm(raw)
            let key = term.lowercased()
            guard term.count > 1,
                  term.count <= 64,
                  !stopWords.contains(key),
                  term.range(of: #"[\p{L}]"#, options: .regularExpression) != nil,
                  seen.insert(key).inserted else { return true }
            terms.append(term)
            return terms.count < 6
        }
        return terms
    }

    static func normalizedTerm(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
    }

    private static func definition(for term: String) -> String? {
        guard !term.isEmpty, term.count <= 160 else { return nil }
        let range = CFRange(location: 0, length: (term as NSString).length)
        guard let value = DCSCopyTextDefinition(nil, term as CFString, range)?.takeRetainedValue()
        else { return nil }
        let definition = (value as String).trimmingCharacters(in: .whitespacesAndNewlines)
        return definition.isEmpty ? nil : definition
    }

    private static func limited(_ value: String, maximum: Int = maximumDisplayedCharacters) -> String {
        guard value.count > maximum else { return value }
        return String(value.prefix(maximum)) + "\n\n……（本机词典内容较长，已省略后文）"
    }
}

enum IRiXiAIKeychain {
    static let service = "com.irixi.toolbox.ai.openai"
    static let account = "api-key"

    static func loadAPIKey() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else { return nil }
        return value
    }

    static func saveAPIKey(_ value: String) throws {
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { throw IRiXiTranslationKnowledgeError.missingAPIKey }
        let keyData = Data(key.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [kSecValueData as String: keyData]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addition = query
            addition[kSecValueData as String] = keyData
            addition[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(addition as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw IRiXiTranslationKnowledgeError.keychain(addStatus)
            }
        } else if status != errSecSuccess {
            throw IRiXiTranslationKnowledgeError.keychain(status)
        }
    }

    static func deleteAPIKey() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw IRiXiTranslationKnowledgeError.keychain(status)
        }
    }
}

final class IRiXiAIExplanationService {
    static let defaultModel = "gpt-5.5"
    static let maximumInputCharacters = 3_000

    private var task: URLSessionDataTask?
    private var requestID: UUID?
    private let configuration: URLSessionConfiguration

    init(configuration: URLSessionConfiguration = .ephemeral) {
        self.configuration = configuration
    }

    func cancel() {
        requestID = nil
        task?.cancel()
        task = nil
    }

    func explain(
        focus: String,
        context: String,
        translation: String,
        apiKey: String,
        completion: @escaping (Result<IRiXiAIExplanation, Error>) -> Void
    ) {
        cancel()
        let normalizedContext = context.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedFocus = focus.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedContext.isEmpty else {
            completion(.failure(IRiXiTranslationKnowledgeError.emptyText))
            return
        }
        guard normalizedContext.count <= Self.maximumInputCharacters else {
            completion(.failure(IRiXiTranslationKnowledgeError.textTooLong))
            return
        }
        guard !key.isEmpty else {
            completion(.failure(IRiXiTranslationKnowledgeError.missingAPIKey))
            return
        }

        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 50
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")

        do {
            request.httpBody = try Self.requestBody(
                focus: normalizedFocus.isEmpty ? normalizedContext : normalizedFocus,
                context: normalizedContext,
                translation: translation
            )
        } catch {
            completion(.failure(error))
            return
        }

        configuration.timeoutIntervalForRequest = 50
        configuration.timeoutIntervalForResource = 60
        configuration.waitsForConnectivity = false
        configuration.httpMaximumConnectionsPerHost = 1
        let session = URLSession(configuration: configuration)
        let id = UUID()
        requestID = id
        task = session.dataTask(with: request) { [weak self] data, response, error in
            defer { session.finishTasksAndInvalidate() }
            let result: Result<IRiXiAIExplanation, Error> = Result {
                if let error { throw error }
                guard let http = response as? HTTPURLResponse, let data else {
                    throw IRiXiTranslationKnowledgeError.invalidResponse
                }
                if !(200...299).contains(http.statusCode) {
                    throw Self.remoteError(from: data, statusCode: http.statusCode)
                }
                return try Self.parseResponse(data)
            }
            DispatchQueue.main.async {
                guard let self, self.requestID == id else { return }
                self.task = nil
                self.requestID = nil
                completion(result)
            }
        }
        task?.resume()
    }

    static func requestBody(focus: String, context: String, translation: String) throws -> Data {
        let existingTranslation = translation.trimmingCharacters(in: .whitespacesAndNewlines)
        let prompt = """
        要重点解释的内容：\(focus)

        原文上下文：\(context)

        当前本机译文：\(existingTranslation.isEmpty ? "暂无" : existingTranslation)

        请结合可靠网页资料，用简体中文说明这个词、短语或句子在当前语境中的准确含义。依次写：
        1. 这里的具体意思
        2. 词性或语法作用
        3. 常见含义与当前含义的区别
        4. 两个自然例句（附中文）
        5. 常见搭配、词形变化或容易混淆的表达
        不要编造词源、发音或用法；资料不足时明确说明。
        """
        let payload: [String: Any] = [
            "model": defaultModel,
            "store": false,
            "tools": [["type": "web_search"]],
            "tool_choice": "required",
            "include": ["web_search_call.action.sources"],
            "instructions": "你是一名严谨的双语词典编辑。使用网页搜索核实含义和用法；输出清楚、具体、适合中文母语者阅读的纯文本，不使用表格。",
            "input": prompt,
            "max_output_tokens": 1_200,
        ]
        return try JSONSerialization.data(withJSONObject: payload, options: [])
    }

    static func parseResponse(_ data: Data) throws -> IRiXiAIExplanation {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw IRiXiTranslationKnowledgeError.invalidResponse }
        if let error = root["error"] as? [String: Any],
           let message = error["message"] as? String {
            throw IRiXiTranslationKnowledgeError.remote(limitedRemoteMessage(message))
        }
        guard let output = root["output"] as? [[String: Any]] else {
            throw IRiXiTranslationKnowledgeError.invalidResponse
        }

        var text = ""
        var citations: [IRiXiAICitation] = []
        for item in output {
            if item["type"] as? String == "web_search_call",
               let action = item["action"] as? [String: Any],
               let sources = action["sources"] as? [[String: Any]] {
                for source in sources {
                    appendCitation(source, range: nil, citations: &citations)
                }
            }
            guard item["type"] as? String == "message",
                  let content = item["content"] as? [[String: Any]] else { continue }
            for part in content where part["type"] as? String == "output_text" {
                guard let value = part["text"] as? String, !value.isEmpty else { continue }
                if !text.isEmpty { text += "\n\n" }
                let baseOffset = (text as NSString).length
                text += value
                let annotations = part["annotations"] as? [[String: Any]] ?? []
                for annotation in annotations where annotation["type"] as? String == "url_citation" {
                    let start = annotation["start_index"] as? Int
                    let end = annotation["end_index"] as? Int
                    let range: NSRange?
                    if let start, let end, start >= 0, end > start {
                        range = NSRange(location: baseOffset + start, length: end - start)
                    } else {
                        range = nil
                    }
                    appendCitation(annotation, range: range, citations: &citations)
                }
            }
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw IRiXiTranslationKnowledgeError.invalidResponse
        }
        return IRiXiAIExplanation(text: text, citations: citations)
    }

    private static func appendCitation(
        _ value: [String: Any],
        range: NSRange?,
        citations: inout [IRiXiAICitation]
    ) {
        guard let rawURL = value["url"] as? String,
              let url = URL(string: rawURL),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else { return }
        let title = (value["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let citation = IRiXiAICitation(
            title: title?.isEmpty == false ? title! : (url.host ?? "网页来源"),
            url: url,
            range: range
        )
        if let index = citations.firstIndex(where: { $0.url == url }) {
            if citations[index].range == nil, range != nil { citations[index] = citation }
            return
        }
        citations.append(citation)
    }

    private static func remoteError(from data: Data, statusCode: Int) -> Error {
        if let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = root["error"] as? [String: Any],
           let message = error["message"] as? String {
            return IRiXiTranslationKnowledgeError.remote(
                "OpenAI 请求失败：\(limitedRemoteMessage(message))"
            )
        }
        return IRiXiTranslationKnowledgeError.remote("OpenAI 请求失败（\(statusCode)）。")
    }

    private static func limitedRemoteMessage(_ value: String) -> String {
        let cleaned = value.replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(cleaned.prefix(240))
    }
}
