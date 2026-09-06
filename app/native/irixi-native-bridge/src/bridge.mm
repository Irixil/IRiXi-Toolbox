#include <node_api.h>

#include <cstdint>
#include <string>
#include <vector>

extern "C" int32_t irixi_native_abi_version(void);
extern "C" int32_t irixi_native_copy_bundle_identifier(char* buffer, int32_t capacity);
extern "C" bool irixi_native_has_screen_capture_access(void);
extern "C" bool irixi_native_request_screen_capture_access(void);
extern "C" void irixi_native_show_test_window(void);
extern "C" void irixi_native_hide_test_window(void);
extern "C" int32_t irixi_native_start_area_capture(void);
extern "C" int32_t irixi_native_start_window_capture(void);
extern "C" int32_t irixi_native_start_fullscreen_capture(void);
extern "C" int32_t irixi_native_start_ocr_capture(void);
extern "C" int32_t irixi_native_start_image_translation_capture(void);
extern "C" void irixi_native_cancel_area_capture(void);
extern "C" bool irixi_native_is_area_capture_active(void);
extern "C" void irixi_native_initialize_translation(void);
extern "C" int32_t irixi_native_open_input_translation(const char* partner);
extern "C" int32_t irixi_native_translate_current_selection(void);

namespace {
constexpr int32_t kExpectedAbiVersion = 6;

bool RequireNoArguments(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc == 0) return true;
  napi_throw_type_error(env, nullptr, "This native method does not accept arguments.");
  return false;
}

bool ReadPartnerArgument(napi_env env, napi_callback_info info, std::string* partner) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype type = napi_undefined;
  if (argc != 1 || napi_typeof(env, argv[0], &type) != napi_ok || type != napi_string) {
    napi_throw_type_error(env, nullptr, "A translation partner string is required.");
    return false;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[0], nullptr, 0, &length) != napi_ok || length > 16) {
    napi_throw_type_error(env, nullptr, "The translation partner is invalid.");
    return false;
  }
  std::vector<char> buffer(length + 1, 0);
  if (napi_get_value_string_utf8(env, argv[0], buffer.data(), buffer.size(), &length) != napi_ok) {
    napi_throw_type_error(env, nullptr, "The translation partner is invalid.");
    return false;
  }
  partner->assign(buffer.data(), length);
  return true;
}

napi_value GetHostBundleIdentifier(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  const int32_t required = irixi_native_copy_bundle_identifier(nullptr, 0);
  if (required <= 1 || required > 4096) {
    napi_throw_error(env, nullptr, "The host bundle identifier is unavailable.");
    return nullptr;
  }
  std::vector<char> buffer(static_cast<size_t>(required), 0);
  const int32_t copied = irixi_native_copy_bundle_identifier(buffer.data(), required);
  if (copied != required) {
    napi_throw_error(env, nullptr, "The host bundle identifier changed while reading.");
    return nullptr;
  }
  napi_value result;
  napi_create_string_utf8(env, buffer.data(), NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value GetScreenRecordingPermissionStatus(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  const char* status = irixi_native_has_screen_capture_access() ? "authorized" : "not_granted";
  napi_value result;
  napi_create_string_utf8(env, status, NAPI_AUTO_LENGTH, &result);
  return result;
}

napi_value RequestScreenRecordingPermission(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_get_boolean(env, irixi_native_request_screen_capture_access(), &result);
  return result;
}

napi_value OpenTestWindow(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  irixi_native_show_test_window();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value CloseTestWindow(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  irixi_native_hide_test_window();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value StartAreaCapture(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_start_area_capture(), &result);
  return result;
}

napi_value StartWindowCapture(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_start_window_capture(), &result);
  return result;
}

napi_value StartFullscreenCapture(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_start_fullscreen_capture(), &result);
  return result;
}

napi_value StartOCRCapture(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_start_ocr_capture(), &result);
  return result;
}

napi_value StartImageTranslationCapture(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_start_image_translation_capture(), &result);
  return result;
}

napi_value CancelAreaCapture(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  irixi_native_cancel_area_capture();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value IsAreaCaptureActive(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_get_boolean(env, irixi_native_is_area_capture_active(), &result);
  return result;
}

napi_value InitializeTranslation(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  irixi_native_initialize_translation();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value OpenInputTranslation(napi_env env, napi_callback_info info) {
  std::string partner;
  if (!ReadPartnerArgument(env, info, &partner)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_open_input_translation(partner.c_str()), &result);
  return result;
}

napi_value TranslateCurrentSelection(napi_env env, napi_callback_info info) {
  if (!RequireNoArguments(env, info)) return nullptr;
  napi_value result;
  napi_create_int32(env, irixi_native_translate_current_selection(), &result);
  return result;
}
}  // namespace

NAPI_MODULE_INIT() {
  if (irixi_native_abi_version() != kExpectedAbiVersion) {
    napi_throw_error(env, nullptr, "IRiXiNativeKit ABI mismatch.");
    return exports;
  }

  const napi_property_descriptor properties[] = {
      {"getHostBundleIdentifier", nullptr, GetHostBundleIdentifier, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getScreenRecordingPermissionStatus", nullptr, GetScreenRecordingPermissionStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"requestScreenRecordingPermission", nullptr, RequestScreenRecordingPermission, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"openTestWindow", nullptr, OpenTestWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"closeTestWindow", nullptr, CloseTestWindow, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startAreaCapture", nullptr, StartAreaCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startWindowCapture", nullptr, StartWindowCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startFullscreenCapture", nullptr, StartFullscreenCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startOCRCapture", nullptr, StartOCRCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"startImageTranslationCapture", nullptr, StartImageTranslationCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"cancelAreaCapture", nullptr, CancelAreaCapture, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"isAreaCaptureActive", nullptr, IsAreaCaptureActive, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"initializeTranslation", nullptr, InitializeTranslation, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"openInputTranslation", nullptr, OpenInputTranslation, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"translateCurrentSelection", nullptr, TranslateCurrentSelection, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
