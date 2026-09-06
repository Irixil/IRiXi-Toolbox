'use strict';

// Development-only convenience entry. Production code never resolves through
// this file; native-module-manager.js loads the one fixed packaged path.
module.exports = require('../../build/native-module/irixi-native.node');
