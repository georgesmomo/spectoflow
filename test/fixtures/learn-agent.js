'use strict';
// Test fixture: a fake agent whose brain_learn MCP tool was refused, so it prints the fallback line.
process.stdout.write('working\n');
process.stdout.write('::spectoflow learn category=avoid msg=Never publish without asking\n');
