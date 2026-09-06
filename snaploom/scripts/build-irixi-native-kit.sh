#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
source_files=(
  "$project_root/SnaploomApp/IRiXiNative/IRiXiNativeBridge.swift"
  "$project_root/SnaploomApp/IRiXiNative/IRiXiRegionCapture.swift"
  "$project_root/SnaploomApp/IRiXiNative/IRiXiInputTranslationBridge.swift"
  "$project_root/SnaploomApp/IRiXiNative/IRiXiImageEditor.swift"
  "$project_root/SnaploomApp/Translation/AbbreviationGlossary.swift"
  "$project_root/SnaploomApp/Translation/TranslationDirectionResolver.swift"
  "$project_root/SnaploomApp/Translation/TranslationSelectionService.swift"
  "$project_root/SnaploomApp/Translation/TranslationSelectionSourceTracker.swift"
  "$project_root/SnaploomApp/Translation/TranslationShortcutManager.swift"
  "$project_root/SnaploomApp/Translation/TranslationShortcutRecorderButton.swift"
  "$project_root/SnaploomApp/Translation/SpeechPlaybackController.swift"
  "$project_root/SnaploomApp/Translation/NativeInputTranslationWindowController.swift"
  "$project_root/SnaploomApp/IRiXiNative/IRiXiTranslationCoordinator.swift"
  "$project_root/SnaploomApp/Model/Annotation.swift"
  "$project_root/SnaploomApp/Model/AnnotationCodable.swift"
  "$project_root/SnaploomApp/Model/CaptureEditState.swift"
  "$project_root/SnaploomApp/UI/Tools/"*.swift
  "$project_root/SnaploomApp/UI/Toolbar/"*.swift
  "$project_root/SnaploomApp/UI/Popover/"*.swift
  "$project_root/SnaploomApp/UI/Overlay/"*.swift
  "$project_root/SnaploomApp/UI/Editor/EditorView.swift"
  "$project_root/SnaploomApp/UI/Editor/EditorTopBarView.swift"
  "$project_root/SnaploomApp/Services/LanguageManager.swift"
  "$project_root/SnaploomApp/Services/BuildVariant.swift"
  "$project_root/SnaploomApp/Services/ImageEffects.swift"
  "$project_root/SnaploomApp/Services/BeautifyRenderer.swift"
  "$project_root/SnaploomApp/Services/BoundarySnapIndex.swift"
  "$project_root/SnaploomApp/Services/ImageEncoder.swift"
  "$project_root/SnaploomApp/Services/TmpScratchDirectory.swift"
  "$project_root/SnaploomApp/Services/VisionOCR.swift"
  "$project_root/SnaploomApp/Services/AutoRedactor.swift"
  "$project_root/SnaploomApp/Services/ImageSaveService.swift"
  "$project_root/SnaploomApp/Services/FilenameFormatter.swift"
  "$project_root/SnaploomApp/Services/SaveDirectoryAccess.swift"
  "$project_root/SnaploomApp/Services/ToolShortcutManager.swift"
  "$project_root/SnaploomApp/Services/TranslationService.swift"
  "$project_root/SnaploomApp/Services/TranslationOverlay.swift"
  "$project_root/SnaploomApp/Capture/ScreenCaptureManager.swift"
)
plist_file="$project_root/SnaploomApp/IRiXiNative/Info.plist"
output_root="${1:-$project_root/build/irixi-native-kit}"
framework="$output_root/IRiXiNativeKit.framework"
module_dir="$framework/Modules/IRiXiNativeKit.swiftmodule"
module_cache="$output_root/ModuleCache.noindex"
sdk_path="$(xcrun --sdk macosx --show-sdk-path)"

rm -rf "$framework"
mkdir -p "$module_dir"
mkdir -p "$framework/Resources"
mkdir -p "$module_cache"
cp "$plist_file" "$framework/Info.plist"
cp "$plist_file" "$framework/Resources/Info.plist"

xcrun swiftc \
  -parse-as-library \
  -D IRIXI_HELPER \
  -D OFFLINE \
  -emit-library \
  -emit-module \
  -module-name IRiXiNativeKit \
  -target arm64-apple-macos13.0 \
  -sdk "$sdk_path" \
  -module-cache-path "$module_cache" \
  -emit-module-path "$module_dir/arm64-apple-macos.swiftmodule" \
  -Xlinker -install_name \
  -Xlinker '@rpath/IRiXiNativeKit.framework/IRiXiNativeKit' \
  "${source_files[@]}" \
  -o "$framework/IRiXiNativeKit"

codesign --force --sign - --timestamp=none "$framework"
codesign --verify --strict "$framework"
file "$framework/IRiXiNativeKit"
otool -D "$framework/IRiXiNativeKit"
shasum -a 256 "$framework/IRiXiNativeKit"
