#!/usr/bin/env node

const path = require('path');
const prePublish = require('../../../scripts/prepublish');

prePublish('@sam-logic/compile-code', path.join(__dirname, '../'));