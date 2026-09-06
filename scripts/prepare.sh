#!/bin/zsh
set -euo pipefail

repo_root="${0:A:h:h}"
snaploom_root="$repo_root/snaploom"
app_root="$repo_root/app"

"$snaploom_root/scripts/build-irixi-native-kit.sh"

framework="$snaploom_root/build/irixi-native-kit/IRiXiNativeKit.framework"
framework_binary="$framework/IRiXiNativeKit"
node_executable="$(command -v node)"
node_headers="${IRIXI_NODE_HEADERS:-${node_executable:A:h:h}/include/node}"
framework_hash="$(/usr/bin/shasum -a 256 "$framework_binary" | /usr/bin/awk '{print $1}')"

if [[ ! -f "$node_headers/node_api.h" ]]; then
  print -u2 "Cannot find node_api.h. Set IRIXI_NODE_HEADERS to your Node.js headers directory."
  exit 1
fi

cd "$app_root"
if [[ ! -d node_modules ]]; then
  npm install
fi

IRIXI_NATIVE_FRAMEWORK="$framework" \
IRIXI_NATIVE_FRAMEWORK_SHA256="$framework_hash" \
IRIXI_NODE_HEADERS="$node_headers" \
npm run stage:native-module

print "IRiXi native module is ready. Run: cd app && npm test && npm run pack"
