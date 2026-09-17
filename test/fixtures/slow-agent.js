'use strict';
// Test fixture: an agent that never finishes on its own (a stuck run).
process.stdout.write('thinking…\n');
setInterval(() => {}, 1000);
