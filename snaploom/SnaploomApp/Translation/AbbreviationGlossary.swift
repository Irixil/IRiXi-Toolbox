import Foundation

struct AbbreviationExplanation: Equatable, Sendable {
    let abbreviation: String
    let fullName: String
    let chineseMeaning: String
    let usage: String
}

/// The authorized Huayi glossary, kept local and used only for short exact
/// matches. Unknown text remains a normal translation instead of a guess.
enum AbbreviationGlossary {
    static func explanation(for text: String) -> AbbreviationExplanation? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 18 else { return nil }
        let key = normalizedKey(trimmed)
        guard key.count >= 2 else { return nil }
        return entries[key]
    }

    static func normalizedKey(_ text: String) -> String {
        let scalars = text.uppercased().unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0)
        }
        return String(String.UnicodeScalarView(scalars))
    }

    private static let entries: [String: AbbreviationExplanation] = [
        "AI": item("AI", "Artificial Intelligence", "人工智能", "让计算机完成感知、推理、生成和决策等通常需要人类智能的任务。"),
        "ML": item("ML", "Machine Learning", "机器学习", "让模型从数据中学习规律，用于预测、分类、推荐和异常检测。"),
        "DL": item("DL", "Deep Learning", "深度学习", "使用多层神经网络学习复杂特征，是图像、语音和大模型的重要基础。"),
        "NLP": item("NLP", "Natural Language Processing", "自然语言处理", "让计算机理解、生成和处理人类语言。"),
        "CV": item("CV", "Computer Vision", "计算机视觉", "让计算机识别和理解图片、视频及真实世界中的视觉信息。"),
        "LLM": item("LLM", "Large Language Model", "大语言模型", "基于大量文本训练，用于问答、写作、翻译、总结和代码生成。"),
        "GPT": item("GPT", "Generative Pre-trained Transformer", "生成式预训练 Transformer", "先进行大规模预训练，再根据上下文生成文本、代码或其他内容。"),
        "RAG": item("RAG", "Retrieval-Augmented Generation", "检索增强生成", "先检索外部知识，再让大模型结合检索结果回答，以提高准确性和时效性。"),
        "AGI": item("AGI", "Artificial General Intelligence", "通用人工智能", "指能够跨领域学习并完成广泛认知任务的人工智能。"),
        "AIGC": item("AIGC", "AI-Generated Content", "人工智能生成内容", "使用人工智能生成文字、图片、音频、视频或代码。"),
        "OCR": item("OCR", "Optical Character Recognition", "光学字符识别", "把图片、扫描件或屏幕中的文字转换成可编辑文本。"),
        "ASR": item("ASR", "Automatic Speech Recognition", "自动语音识别", "把人说的话转换成文字。"),
        "TTS": item("TTS", "Text-to-Speech", "文字转语音", "把文字合成为可播放的人声。"),
        "STT": item("STT", "Speech-to-Text", "语音转文字", "把语音内容识别成文本，通常与 ASR 含义相近。"),
        "API": item("API", "Application Programming Interface", "应用程序编程接口", "规定不同软件之间如何请求能力和交换数据。"),
        "SDK": item("SDK", "Software Development Kit", "软件开发工具包", "为特定平台或服务提供代码库、工具、示例和文档。"),
        "IDE": item("IDE", "Integrated Development Environment", "集成开发环境", "把代码编辑、运行、调试和项目管理集中在一个工具中。"),
        "UI": item("UI", "User Interface", "用户界面", "用户直接看到并操作的页面、按钮、菜单和反馈。"),
        "UX": item("UX", "User Experience", "用户体验", "描述用户使用产品全过程中的效率、感受和满意度。"),
        "GUI": item("GUI", "Graphical User Interface", "图形用户界面", "通过窗口、图标、菜单和指针让用户操作软件。"),
        "CLI": item("CLI", "Command-Line Interface", "命令行界面", "通过输入文本命令操作程序或系统。"),
        "CPU": item("CPU", "Central Processing Unit", "中央处理器", "执行通用计算指令并协调计算机主要部件。"),
        "GPU": item("GPU", "Graphics Processing Unit", "图形处理器", "擅长并行计算，常用于图形渲染和人工智能训练推理。"),
        "TPU": item("TPU", "Tensor Processing Unit", "张量处理器", "面向机器学习张量计算设计的专用加速器。"),
        "NPU": item("NPU", "Neural Processing Unit", "神经网络处理器", "专门加速神经网络推理或训练任务。"),
        "RAM": item("RAM", "Random Access Memory", "随机存取存储器", "临时保存正在运行的程序和数据，断电后内容通常消失。"),
        "ROM": item("ROM", "Read-Only Memory", "只读存储器", "保存固件等不需要频繁修改的数据。"),
        "SSD": item("SSD", "Solid-State Drive", "固态硬盘", "使用闪存保存数据，通常比机械硬盘速度更快。"),
        "HDD": item("HDD", "Hard Disk Drive", "机械硬盘", "使用旋转磁盘长期保存文件和数据。"),
        "OS": item("OS", "Operating System", "操作系统", "管理硬件资源，并为应用程序提供运行环境。"),
        "VM": item("VM", "Virtual Machine", "虚拟机", "用软件模拟一台独立计算机，可运行自己的操作系统。"),
        "VPC": item("VPC", "Virtual Private Cloud", "虚拟私有云", "在公有云中划分逻辑隔离的私有网络环境。"),
        "VPN": item("VPN", "Virtual Private Network", "虚拟专用网络", "通过加密隧道连接远程网络或保护传输流量。"),
        "DNS": item("DNS", "Domain Name System", "域名系统", "把域名解析成网络通信所需的 IP 地址。"),
        "IP": item("IP", "Internet Protocol", "互联网协议", "负责网络中的地址标识和数据包路由。"),
        "TCP": item("TCP", "Transmission Control Protocol", "传输控制协议", "提供可靠、有序、面向连接的数据传输。"),
        "UDP": item("UDP", "User Datagram Protocol", "用户数据报协议", "提供低开销、无连接传输，常用于实时音视频和游戏。"),
        "HTTP": item("HTTP", "Hypertext Transfer Protocol", "超文本传输协议", "浏览器与网站服务器交换网页和接口数据的基础协议。"),
        "HTTPS": item("HTTPS", "Hypertext Transfer Protocol Secure", "安全超文本传输协议", "在 HTTP 上增加 TLS 加密，保护传输内容和身份。"),
        "URL": item("URL", "Uniform Resource Locator", "统一资源定位符", "表示网络资源的位置和访问方式，也就是常说的网址。"),
        "URI": item("URI", "Uniform Resource Identifier", "统一资源标识符", "用于唯一标识某个资源，URL 是常见的一类 URI。"),
        "HTML": item("HTML", "HyperText Markup Language", "超文本标记语言", "定义网页内容的结构和语义。"),
        "CSS": item("CSS", "Cascading Style Sheets", "层叠样式表", "控制网页的颜色、字体、布局和响应式样式。"),
        "XML": item("XML", "Extensible Markup Language", "可扩展标记语言", "用带标签的结构存储和交换数据。"),
        "JSON": item("JSON", "JavaScript Object Notation", "JavaScript 对象表示法", "一种轻量的数据交换格式，广泛用于 Web API。"),
        "YAML": item("YAML", "YAML Ain't Markup Language", "一种人类可读的数据序列化格式", "常用于配置文件、部署文件和自动化流程。"),
        "SQL": item("SQL", "Structured Query Language", "结构化查询语言", "用于查询和管理关系型数据库中的数据。"),
        "NOSQL": item("NoSQL", "Not Only SQL", "非关系型数据库技术", "用于键值、文档、列族或图等灵活数据模型。"),
        "DBMS": item("DBMS", "Database Management System", "数据库管理系统", "负责数据库的存储、查询、权限、事务和维护。"),
        "ORM": item("ORM", "Object-Relational Mapping", "对象关系映射", "在程序对象和关系型数据库表之间转换数据。"),
        "CRUD": item("CRUD", "Create, Read, Update, Delete", "增、查、改、删", "概括数据系统最常见的四类基本操作。"),
        "REST": item("REST", "Representational State Transfer", "表述性状态转移", "一种常见 Web API 设计风格，围绕资源和 HTTP 方法组织接口。"),
        "RPC": item("RPC", "Remote Procedure Call", "远程过程调用", "让程序像调用本地函数一样调用另一台机器上的服务。"),
        "GRPC": item("gRPC", "gRPC Remote Procedure Calls", "高性能远程过程调用框架", "使用接口定义和二进制协议连接微服务与跨语言系统。"),
        "SSE": item("SSE", "Server-Sent Events", "服务器发送事件", "让服务器通过单向长连接持续向网页推送更新。"),
        "WS": item("WS", "WebSocket", "WebSocket 双向通信", "在客户端和服务器之间建立持久的双向实时连接。"),
        "CDN": item("CDN", "Content Delivery Network", "内容分发网络", "把内容缓存到靠近用户的节点，以降低延迟和源站压力。"),
        "SSH": item("SSH", "Secure Shell", "安全外壳协议", "用于加密登录远程服务器、执行命令和传输文件。"),
        "TLS": item("TLS", "Transport Layer Security", "传输层安全协议", "为网络连接提供加密、身份验证和完整性保护。"),
        "SSL": item("SSL", "Secure Sockets Layer", "安全套接层", "TLS 的前身；日常所说 SSL 证书通常实际用于 TLS。"),
        "JWT": item("JWT", "JSON Web Token", "JSON Web 令牌", "在系统之间安全传递身份和声明信息。"),
        "OAUTH": item("OAuth", "Open Authorization", "开放授权", "允许用户授权第三方应用访问部分资源，而无需交出密码。"),
        "SSO": item("SSO", "Single Sign-On", "单点登录", "让用户登录一次后访问多个关联应用。"),
        "MFA": item("MFA", "Multi-Factor Authentication", "多因素认证", "组合密码、设备、生物特征等多种凭据提高账户安全性。"),
        "IAM": item("IAM", "Identity and Access Management", "身份与访问管理", "统一管理用户身份、角色和资源访问权限。"),
        "RBAC": item("RBAC", "Role-Based Access Control", "基于角色的访问控制", "把权限分配给角色，再把角色分配给用户。"),
        "CI": item("CI", "Continuous Integration", "持续集成", "频繁合并代码并自动构建、检查和测试。"),
        "CD": item("CD", "Continuous Delivery / Continuous Deployment", "持续交付／持续部署", "自动把通过验证的软件交付或部署到目标环境。"),
        "CICD": item("CI/CD", "Continuous Integration and Continuous Delivery/Deployment", "持续集成与持续交付／部署", "用自动化流水线完成代码检查、测试、构建和发布。"),
        "DEVOPS": item("DevOps", "Development and Operations", "开发运维一体化", "通过协作、自动化和可观测性缩短软件交付周期。"),
        "SRE": item("SRE", "Site Reliability Engineering", "站点可靠性工程", "用软件工程方法提升线上系统的可靠性、容量和运维效率。"),
        "QA": item("QA", "Quality Assurance", "质量保证", "通过流程、测试和标准降低软件缺陷。"),
        "UAT": item("UAT", "User Acceptance Testing", "用户验收测试", "由业务或最终用户确认系统是否满足实际需求。"),
        "TDD": item("TDD", "Test-Driven Development", "测试驱动开发", "先写失败测试，再写最少代码使其通过，然后重构。"),
        "BDD": item("BDD", "Behavior-Driven Development", "行为驱动开发", "用业务可读的行为场景连接需求、开发和测试。"),
        "OOP": item("OOP", "Object-Oriented Programming", "面向对象编程", "用对象、类、封装、继承和多态组织程序。"),
        "MVC": item("MVC", "Model-View-Controller", "模型－视图－控制器", "把数据、界面和交互控制分开组织。"),
        "MVVM": item("MVVM", "Model-View-ViewModel", "模型－视图－视图模型", "通过 ViewModel 管理界面状态并连接数据与视图。"),
        "SPA": item("SPA", "Single-Page Application", "单页应用", "页面不整体刷新，由前端动态更新内容和路由。"),
        "SSR": item("SSR", "Server-Side Rendering", "服务端渲染", "在服务器生成页面 HTML，以改善首屏速度和搜索引擎收录。"),
        "CSR": item("CSR", "Client-Side Rendering", "客户端渲染", "由浏览器运行 JavaScript 并生成页面内容。"),
        "PWA": item("PWA", "Progressive Web App", "渐进式 Web 应用", "让网站具备离线、安装和推送等接近原生应用的能力。"),
        "WASM": item("Wasm", "WebAssembly", "WebAssembly 二进制指令格式", "让 C、C++、Rust 等代码在浏览器或其他沙箱环境中高效运行。"),
        "JVM": item("JVM", "Java Virtual Machine", "Java 虚拟机", "运行 Java 字节码并提供跨平台执行环境。"),
        "JDK": item("JDK", "Java Development Kit", "Java 开发工具包", "包含编译器、调试器、运行环境和开发工具。"),
        "JRE": item("JRE", "Java Runtime Environment", "Java 运行环境", "提供运行 Java 程序所需的虚拟机和基础库。"),
        "K8S": item("K8s", "Kubernetes", "Kubernetes 容器编排平台", "自动部署、扩缩容和管理容器化应用；名称用 K、8 个中间字母和 s 缩写而成。"),
        "GC": item("GC", "Garbage Collection", "垃圾回收", "自动回收程序中不再使用的内存。"),
        "DOM": item("DOM", "Document Object Model", "文档对象模型", "把网页文档表示成可由程序读取和修改的树结构。"),
        "IO": item("I/O", "Input/Output", "输入／输出", "描述程序与文件、网络、设备或用户之间的数据交换。"),
        "CAP": item("CAP", "Consistency, Availability, Partition Tolerance", "一致性、可用性、分区容错", "描述分布式系统在网络分区下难以同时完全满足的三项性质。"),
        "ACID": item("ACID", "Atomicity, Consistency, Isolation, Durability", "原子性、一致性、隔离性、持久性", "描述数据库事务可靠执行的四项核心性质。"),
        "ETL": item("ETL", "Extract, Transform, Load", "抽取、转换、加载", "把多来源数据清洗转换后装入数据仓库。"),
        "OLTP": item("OLTP", "Online Transaction Processing", "联机事务处理", "处理高频、短小、实时的业务交易。"),
        "OLAP": item("OLAP", "Online Analytical Processing", "联机分析处理", "面向多维度汇总、分析和决策查询。"),
        "BI": item("BI", "Business Intelligence", "商业智能", "通过数据分析、报表和仪表盘支持经营决策。"),
        "SAAS": item("SaaS", "Software as a Service", "软件即服务", "用户通过网络直接使用由服务商托管的软件。"),
        "PAAS": item("PaaS", "Platform as a Service", "平台即服务", "提供应用开发、运行和部署所需的平台能力。"),
        "IAAS": item("IaaS", "Infrastructure as a Service", "基础设施即服务", "按需提供计算、存储和网络等云基础资源。"),
        "FAAS": item("FaaS", "Function as a Service", "函数即服务", "按事件运行短小函数，平台负责服务器和弹性伸缩。"),
        "CMS": item("CMS", "Content Management System", "内容管理系统", "用于创建、编辑、组织和发布网站或媒体内容。"),
        "CRM": item("CRM", "Customer Relationship Management", "客户关系管理", "管理客户资料、销售过程、服务和营销互动。"),
        "ERP": item("ERP", "Enterprise Resource Planning", "企业资源计划", "整合财务、供应链、生产、人力等企业核心流程。"),
        "IOT": item("IoT", "Internet of Things", "物联网", "让传感器、设备和系统通过网络采集数据并协同工作。"),
        "AR": item("AR", "Augmented Reality", "增强现实", "在真实画面上叠加数字信息或虚拟对象。"),
        "VR": item("VR", "Virtual Reality", "虚拟现实", "用头显等设备让用户沉浸在计算机生成的环境中。"),
        "MR": item("MR", "Mixed Reality", "混合现实", "让真实环境与虚拟对象相互定位和交互。"),
        "XSS": item("XSS", "Cross-Site Scripting", "跨站脚本攻击", "攻击者向网页注入脚本，窃取信息或冒充用户操作。"),
        "CSRF": item("CSRF", "Cross-Site Request Forgery", "跨站请求伪造", "诱导已登录用户在不知情时向目标网站发送操作请求。"),
        "AES": item("AES", "Advanced Encryption Standard", "高级加密标准", "常用的对称加密算法，用同一密钥加密和解密数据。"),
        "RSA": item("RSA", "Rivest-Shamir-Adleman", "RSA 非对称加密算法", "使用公钥和私钥进行加密、密钥交换或数字签名。"),
        "SHA": item("SHA", "Secure Hash Algorithm", "安全哈希算法", "把数据生成固定长度摘要，用于完整性校验和签名。"),
        "UUID": item("UUID", "Universally Unique Identifier", "通用唯一标识符", "生成跨系统低冲突概率的资源标识。"),
        "UTF8": item("UTF-8", "Unicode Transformation Format – 8-bit", "Unicode 的 8 位编码格式", "以兼容 ASCII 的可变长度字节表示全球文字。"),
        "ASCII": item("ASCII", "American Standard Code for Information Interchange", "美国信息交换标准代码", "用数字编码基础英文字母、数字、符号和控制字符。"),
    ]

    private static func item(
        _ abbreviation: String,
        _ fullName: String,
        _ chineseMeaning: String,
        _ usage: String
    ) -> AbbreviationExplanation {
        AbbreviationExplanation(
            abbreviation: abbreviation,
            fullName: fullName,
            chineseMeaning: chineseMeaning,
            usage: usage
        )
    }
}
