'use strict';

const path = require('node:path');
const { app } = require('electron');

async function main() {
  await app.whenReady();
  const nativeModule = require(path.join(__dirname, '..', 'build', 'native-module', 'irixi-native.node'));
  const result = nativeModule.startAreaCapture();
  console.log(JSON.stringify({ captureStartResult: result }));
  if (result !== 0 && result !== 'started') {
    app.exit(1);
    return;
  }

  const deadline = Date.now() + 300_000;
  const timer = setInterval(() => {
    if (!nativeModule.isAreaCaptureActive() || Date.now() >= deadline) {
      clearInterval(timer);
      nativeModule.cancelAreaCapture();
      app.quit();
    }
  }, 250);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
