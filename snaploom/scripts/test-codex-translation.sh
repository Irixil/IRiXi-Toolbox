#!/bin/zsh
set -euo pipefail
project_root="${0:A:h:h}"
output_root="$project_root/build/codex-translation-tests"
mkdir -p "$output_root/ModuleCache.noindex"
xcrun swiftc -module-cache-path "$output_root/ModuleCache.noindex" \
  "$project_root/SnaploomApp/Translation/CodexTranslationService.swift" \
  "$project_root/scripts/CodexTranslationChecks.swift" -o "$output_root/checks"
chmod +x "$project_root/scripts/fake-codex-translation.js"
"$output_root/checks" --fixture "$project_root/scripts/fake-codex-translation.js" "$@"
