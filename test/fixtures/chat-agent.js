'use strict';
// Test fixture: a fake agent that emits one plain line + one spectoflow sentinel, then exits 0.
process.stdout.write('reading project files\n');
process.stdout.write('::spectoflow role=developer kind=status msg=finished T-001 Add login form\n');
process.stdout.write('all good\n');
