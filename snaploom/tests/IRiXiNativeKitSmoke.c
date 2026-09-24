#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>

typedef int32_t (*abi_version_fn)(void);
typedef int32_t (*copy_bundle_id_fn)(char *, int32_t);
typedef bool (*screen_access_fn)(void);

static void *required_symbol(void *handle, const char *name) {
    void *symbol = dlsym(handle, name);
    if (symbol == NULL) {
        fprintf(stderr, "missing symbol %s: %s\n", name, dlerror());
        exit(1);
    }
    return symbol;
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s /path/to/IRiXiNativeKit\n", argv[0]);
        return 2;
    }

    void *handle = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (handle == NULL) {
        fprintf(stderr, "dlopen failed: %s\n", dlerror());
        return 1;
    }

    abi_version_fn abi_version = (abi_version_fn)required_symbol(handle, "irixi_native_abi_version");
    copy_bundle_id_fn copy_bundle_id = (copy_bundle_id_fn)required_symbol(handle, "irixi_native_copy_bundle_identifier");
    screen_access_fn has_screen_access = (screen_access_fn)required_symbol(handle, "irixi_native_has_screen_capture_access");
    required_symbol(handle, "irixi_native_request_screen_capture_access");
    required_symbol(handle, "irixi_native_show_test_window");
    required_symbol(handle, "irixi_native_hide_test_window");
    required_symbol(handle, "irixi_native_start_area_capture");
    required_symbol(handle, "irixi_native_start_window_capture");
    required_symbol(handle, "irixi_native_start_fullscreen_capture");
    required_symbol(handle, "irixi_native_start_ocr_capture");
    required_symbol(handle, "irixi_native_start_image_translation_capture");
    required_symbol(handle, "irixi_native_cancel_area_capture");
    required_symbol(handle, "irixi_native_set_area_capture_shortcut");
    required_symbol(handle, "irixi_native_initialize_translation");
    required_symbol(handle, "irixi_native_open_input_translation");
    required_symbol(handle, "irixi_native_translate_current_selection");
    screen_access_fn is_area_capture_active = (screen_access_fn)required_symbol(
        handle, "irixi_native_is_area_capture_active");

    if (abi_version() != 7) {
        fprintf(stderr, "unexpected ABI version\n");
        return 1;
    }

    char bundle_id[512] = {0};
    int32_t required = copy_bundle_id(bundle_id, (int32_t)sizeof(bundle_id));
    if (required <= 0) {
        fprintf(stderr, "bundle identifier result is not a valid C string length\n");
        return 1;
    }

    if (is_area_capture_active()) {
        fprintf(stderr, "area capture must be inactive before first use\n");
        return 1;
    }

    printf("abi=7 bundle_id=%s screen_access=%s capture=inactive\n",
           bundle_id[0] == '\0' ? "<none-for-cli-host>" : bundle_id,
           has_screen_access() ? "granted" : "not-granted");
    dlclose(handle);
    return 0;
}
