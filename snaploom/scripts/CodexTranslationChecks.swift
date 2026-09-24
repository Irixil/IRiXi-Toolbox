import Foundation

@main struct CodexTranslationChecks {
    static func main() {
        let params = CodexTranslationService.threadParameters(cwd: "/tmp", config: [
            "mcp_servers": ["example": ["enabled": true]], "plugins": ["example@local": [:]]
        ], search: false)
        let config = params["config"] as! [String: Any]
        precondition(params["model"] as? String == "gpt-5.6-luna")
        precondition(config["model_reasoning_effort"] as? String == "low")
        precondition(params["ephemeral"] as? Bool == true)
        precondition(params["sandbox"] as? String == "read-only")
        precondition((params["environments"] as? [String])?.isEmpty == true)
        precondition(params["allowProviderModelFallback"] as? Bool == false)
        precondition(config["mcp_servers.example.enabled"] as? Bool == false)
        precondition(config["plugins.example@local.enabled"] as? Bool == false)
        precondition(config["web_search"] as? String == "disabled")
        precondition(config["features.skip_host_skill_discovery"] as? Bool == true)
        precondition(config["features.shell_snapshot"] as? Bool == false)
        precondition(config["features.remote_plugin"] as? Bool == false)
        precondition(config["sqlite_home"] as? String == "/tmp/codex-state")
        print("PASS: Luna low, ephemeral, no environment, no model fallback, connections disabled")
        if let index = CommandLine.arguments.firstIndex(of: "--fixture"), index + 1 < CommandLine.arguments.count {
            let fixture = URL(fileURLWithPath: CommandLine.arguments[index + 1])
            for mode in ["success", "api", "missing-model", "wrong-model", "quota", "tool"] {
                setenv("IRIXI_TRANSLATION_TEST_MODE", mode, 1)
                let service = CodexTranslationService(testExecutable: fixture)
                var result: Result<String, Error>?
                service.ask("测试") { result = $0 }
                let deadline = Date().addingTimeInterval(5)
                while result == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
                guard let result else { fatalError("fixture timeout: \(mode)") }
                switch result {
                case .success: precondition(mode == "success")
                case .failure: precondition(mode != "success")
                }
                print("PASS: \(mode)")
            }
            setenv("IRIXI_TRANSLATION_TEST_MODE", "slow", 1)
            let service = CodexTranslationService(testExecutable: fixture)
            var staleCallback = false
            var replacementFinished = false
            service.ask("旧请求") { _ in staleCallback = true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.2))
            service.cancel()
            setenv("IRIXI_TRANSLATION_TEST_MODE", "success", 1)
            service.ask("新请求") { result in
                if case .success = result { replacementFinished = true }
            }
            let deadline = Date().addingTimeInterval(2)
            while Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
            precondition(!staleCallback && replacementFinished)
            print("PASS: cancellation and replacement suppress stale callbacks")
            unsetenv("IRIXI_TRANSLATION_TEST_MODE")
        }
        guard CommandLine.arguments.contains("--live") else { return }
        let service = CodexTranslationService()
        var finished = false
        var passed = false
        service.ask("请用两句话解释 API 是什么意思，并给一个生活中的比喻。") { result in
            switch result {
            case .success(let text): print("LIVE ANSWER: \(text)"); passed = !text.isEmpty
            case .failure(let error): print("LIVE ERROR: \(error.localizedDescription)")
            }
            finished = true
        }
        let deadline = Date().addingTimeInterval(95)
        while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        precondition(finished && passed, "Live translation not verified")
    }
}
