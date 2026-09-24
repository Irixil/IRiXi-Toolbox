import Foundation

// All requests are intercepted in memory: no API key or external call is used.
final class ExplanationProtocol: URLProtocol {
    static let delivered = DispatchSemaphore(value: 0)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        let data = Data(#"{"output":[{"type":"message","content":[{"type":"output_text","text":"test explanation"}]}]}"#.utf8)
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
        Self.delivered.signal()
    }
    override func stopLoading() {}
}

@main
struct TranslationKnowledgeChecks {
    static func main() throws {
        let terms = IRiXiLocalDictionary.lookupTerms(in: "If I had a heart, I could love you")
        precondition(terms.contains(where: { $0.lowercased() == "heart" }))
        precondition(!terms.contains(where: { $0.lowercased() == "the" }))

        let local = IRiXiLocalDictionary.explanation(for: "heart", selectedText: nil)
        precondition(!local.isEmpty)

        let requestData = try IRiXiAIExplanationService.requestBody(
            focus: "heart",
            context: "If I had a heart",
            translation: "如果我有一颗心"
        )
        let request = try JSONSerialization.jsonObject(with: requestData) as! [String: Any]
        precondition(request["model"] as? String == "gpt-5.5")
        precondition(request["store"] as? Bool == false)
        precondition(request["tool_choice"] as? String == "required")
        precondition((request["include"] as? [String]) == ["web_search_call.action.sources"])
        let tools = request["tools"] as! [[String: String]]
        precondition(tools == [["type": "web_search"]])
        let prompt = request["input"] as! String
        precondition(prompt.contains("heart"))
        precondition(prompt.contains("If I had a heart"))
        precondition(!prompt.contains("sk-test"))

        let responseObject: [String: Any] = [
            "output": [
                [
                    "type": "web_search_call",
                    "action": [
                        "type": "search",
                        "sources": [
                            ["title": "Dictionary source", "url": "https://example.com/dictionary"],
                        ],
                    ],
                ],
                [
                    "type": "message",
                    "content": [
                        [
                            "type": "output_text",
                            "text": "这里表示感情与同理心。",
                            "annotations": [
                                [
                                    "type": "url_citation",
                                    "start_index": 5,
                                    "end_index": 9,
                                    "title": "Dictionary source",
                                    "url": "https://example.com/dictionary",
                                ],
                            ],
                        ],
                    ],
                ],
            ],
        ]
        let responseData = try JSONSerialization.data(withJSONObject: responseObject)
        let response = try IRiXiAIExplanationService.parseResponse(responseData)
        precondition(response.text == "这里表示感情与同理心。")
        precondition(response.citations.count == 1)
        precondition(response.citations[0].title == "Dictionary source")
        precondition(response.citations[0].url.absoluteString == "https://example.com/dictionary")
        precondition(response.citations[0].range == NSRange(location: 5, length: 4))

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ExplanationProtocol.self]
        let service = IRiXiAIExplanationService(configuration: configuration)
        var callbacks: [String] = []
        service.explain(focus: "old", context: "old", translation: "", apiKey: "test-only") { _ in callbacks.append("old") }
        precondition(ExplanationProtocol.delivered.wait(timeout: .now() + 2) == .success)
        // Hold the main queue while the old success callback is enqueued.
        Thread.sleep(forTimeInterval: 0.1)
        service.cancel()
        service.explain(focus: "new", context: "new", translation: "", apiKey: "test-only") { result in
            if case .success = result { callbacks.append("new") }
        }
        let deadline = Date().addingTimeInterval(2)
        while callbacks.isEmpty && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        precondition(callbacks == ["new"], "Superseded results must not overwrite the new request")
        service.explain(focus: "cancel", context: "cancel", translation: "", apiKey: "test-only") { _ in callbacks.append("cancel") }
        service.cancel()
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        precondition(callbacks == ["new"], "Cancelled requests must not publish a queued result")

        print("Translation knowledge checks passed")
    }
}
