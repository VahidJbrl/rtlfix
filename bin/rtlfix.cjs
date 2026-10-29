#!/usr/bin/env node
'use strict';
var major = Number(process.versions.node.split('.')[0]);
if (!(major >= 18)) {
  console.error('rtlfix needs Node.js 18 or newer, but this is Node.js ' + process.version + '.');
  console.error('Install a current Node.js from https://nodejs.org or with nvm, then run rtlfix again.');
  process.exit(1);
}
var path = require('path');
var url = require('url');
var load = new Function('u', 'return import(u)');
load(url.pathToFileURL(path.join(__dirname, '..', 'src', 'cli.mjs')).href)
  .then(function (cli) { return cli.main(process.argv.slice(2)); })
  .catch(function (e) {
    console.error('rtlfix: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
