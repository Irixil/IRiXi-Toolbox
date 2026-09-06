{
  "variables": {
    "irixi_native_framework_dir%": "../../build/native-module"
  },
  "targets": [
    {
      "target_name": "irixi-native",
      "sources": ["src/bridge.mm"],
      "libraries": [
        "-F<(irixi_native_framework_dir)",
        "-framework IRiXiNativeKit"
      ],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "13.0",
        "OTHER_LDFLAGS": ["-Wl,-rpath,@loader_path"]
      }
    }
  ]
}
