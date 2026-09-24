#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
output_root="$project_root/build/translation-knowledge-tests"
module_cache="$output_root/ModuleCache.noindex"
binary="$output_root/translation-knowledge-checks"

mkdir -p "$module_cache"
xcrun swiftc \
  -target arm64-apple-macos13.0 \
  -module-cache-path "$module_cache" \
  "$project_root/SnaploomApp/Translation/TranslationKnowledgeService.swift" \
  "$project_root/scripts/TranslationKnowledgeChecks.swift" \
  -o "$binary"

"$binary"
