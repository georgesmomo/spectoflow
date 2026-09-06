#!/bin/sh
set -e
node cli.js migrate
exec node src/index.js
