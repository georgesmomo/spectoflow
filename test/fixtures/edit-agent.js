'use strict';
// Test fixture: an agent that changes a file where it runs (its cwd) — the task's worktree when isolated.
// The prompt is the last argument; "fail" makes it exit 1, "feedback" appends a second line.
const fs = require('fs');
const prompt = process.argv[process.argv.length - 1];
fs.writeFileSync('feature.txt', /feedback/i.test(prompt) ? 'feature v1\nreviewed\n' : 'feature v1\n');
process.stdout.write('::spectoflow role=developer kind=status msg=edited feature.txt\n');
process.stdout.write('Changed feature.txt.\n');
process.exit(/\bfail\b/.test(prompt) ? 1 : 0);
