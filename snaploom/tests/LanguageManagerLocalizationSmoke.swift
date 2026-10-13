import Foundation
@testable import IRiXiNativeKit

UserDefaults.standard.set("en", forKey: "appLanguage")
let frameworkBundle = Bundle(for: LanguageManager.self)
precondition(frameworkBundle.bundleIdentifier == "com.irixi.toolbox.native-kit")
precondition(LanguageManager.shared.resolvedLanguage == "zh-Hans")
for (key, expected) in [
    ("Copy", "拷贝"),
    ("Save", "存储"),
    ("Cancel", "取消"),
    ("Arrow", "箭头"),
    ("Font", "字体"),
    ("System", "系统"),
    ("System (SF Pro)", "系统（SF Pro）"),
    ("OCR & QR", "文字/二维码"),
    ("PII", "隐私信息"),
] {
    precondition(LanguageManager.shared.localizedString(key) == expected, "Unexpected translation for \(key)")
}
print("LanguageManager framework lookup and Simplified Chinese values passed with English preference")
