#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
output_root="${1:-$project_root/build/language-manager-localization}"
framework="$output_root/IRiXiNativeKit.framework"

IRIXI_NATIVE_KIT_ENABLE_TESTING=1 "$project_root/scripts/build-irixi-native-kit.sh" "$output_root"

for localization in "$project_root/SnaploomApp/"*.lproj; do
  if test -f "$localization/Localizable.strings"; then
    test -f "$framework/Resources/${localization:t}/Localizable.strings"
  fi
done
grep 'Bundle(for: LanguageManager.self)' "$project_root/SnaploomApp/Services/LanguageManager.swift" >/dev/null
grep 'return "zh-Hans"' "$project_root/SnaploomApp/Services/LanguageManager.swift" >/dev/null
grep '"OCR & QR" = "文字/二维码";' "$framework/Resources/zh-Hans.lproj/Localizable.strings" >/dev/null
grep '"PII" = "隐私信息";' "$framework/Resources/zh-Hans.lproj/Localizable.strings" >/dev/null

python3 - "$project_root" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
sources = [
    root / "SnaploomApp/UI/Overlay/OverlayView.swift",
    *sorted((root / "SnaploomApp/UI/Toolbar").glob("*.swift")),
    *sorted((root / "SnaploomApp/UI/Tools").glob("*.swift")),
    *sorted((root / "SnaploomApp/UI/Editor").glob("*.swift")),
    *sorted((root / "SnaploomApp/UI/Popover").glob("*.swift")),
    root / "SnaploomApp/Translation/NativeInputTranslationWindowController.swift",
    root / "SnaploomApp/IRiXiNative/IRiXiImageEditor.swift",
    root / "SnaploomApp/IRiXiNative/IRiXiRegionCapture.swift",
]
keys = {key for path in sources for key in re.findall(r'\bL\("([^"\\]*(?:\\.[^"\\]*)*)"\)', path.read_text())}
strings = (root / "SnaploomApp/zh-Hans.lproj/Localizable.strings").read_text()
missing = sorted(key for key in keys if f'"{key}" =' not in strings)
if missing:
    raise SystemExit("Missing zh-Hans L() keys: " + ", ".join(missing))
print(f"Simplified Chinese key coverage passed: {len(keys)} literal L() keys")
PY

swiftc -F "$output_root" -framework IRiXiNativeKit \
  -module-cache-path "$output_root/TestModuleCache.noindex" \
  -Xlinker -rpath -Xlinker "$output_root" \
  "$project_root/tests/LanguageManagerLocalizationSmoke.swift" \
  -o "$output_root/language-manager-localization-smoke"
"$output_root/language-manager-localization-smoke"

fixture="$output_root/package-without-localizations.app"
mkdir -p "$fixture/Contents/Frameworks/IRiXiNativeKit.framework" "$fixture/Contents/Resources"
touch "$fixture/Contents/Frameworks/irixi-native.node" \
  "$fixture/Contents/Frameworks/IRiXiNativeKit.framework/IRiXiNativeKit" \
  "$fixture/Contents/Resources/native-module-manifest.json"
if node "$project_root/../app/scripts/verify-packaged-native-module.js" "$fixture" \
  >"$output_root/package-verifier-missing-localization.log" 2>&1; then
  echo 'Packaged-module verification unexpectedly accepted missing zh-Hans resources.' >&2
  exit 1
fi
grep 'zh-Hans.lproj/Localizable.strings' "$output_root/package-verifier-missing-localization.log" >/dev/null
echo 'LanguageManager localization checks passed'
