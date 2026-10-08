# IRiXi Toolbox app

This directory contains the Electron host for IRiXi Toolbox. The complete project also requires the native source in `../snaploom`.

System requirement: macOS 13+ on Apple silicon.

From the repository root, run:

```bash
./scripts/prepare.sh
cd app
npm test
npm run pack
```

The application uses bundle identifier `com.irixi.toolbox`. Screen capture, OCR, image translation, input translation, selection translation, and English speech are loaded in the main application process through `IRiXiNativeKit.framework`; no separate screen-permission helper is packaged.

This source preview does not include the private local signing identity used by the maintainer. Packaging requires an existing stable signing identity and stops if none is available; set `IRIXI_CODESIGN_IDENTITY` to select your own identity. Public binary distribution requires the distributor's own Apple Developer ID and notarization. See the [repository README](../README.md) for current setup, permissions, and feature boundaries.

The combined project is distributed under GPLv3. TO-DO Panel's MIT notice and all native upstream notices are preserved in this repository.
