#!/usr/bin/env node
// Strip devDependencies from screeps-client/package.json before publishing.
// The published artifact is a static frontend bundle — devDeps are build-time only
// and only clutter the registry view. Runs from screeps-client/'s prepublishOnly.

import { readFileSync, writeFileSync } from 'node:fs'

const file = 'package.json'
const pkg = JSON.parse(readFileSync(file, 'utf8'))
delete pkg.devDependencies
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
