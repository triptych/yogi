/*
Copyright (c) 2012, Yahoo! Inc. All rights reserved.
Code licensed under the BSD License:
http://yuilibrary.com/license/
*/
var nopt = require('nopt'),
    path = require('path'),
    cmds = require('./cmds'),
    known = {
        t: Number,
        c: Number,
        x: Array,
        cli: Boolean,
        coverage: Boolean,
        yeti: Boolean,
        hub: String,
        connected: Boolean,
        istanbul: Boolean,
        config: path,
        version: Boolean,
        help: Boolean,
        loglevel: [ 'silent', 'info', 'debug', 'warn' ],
        lint: [ 'defaults', 'strict', 'preferred' ],
        filter: [ 'raw', 'min', 'debug', 'coverage' ]
    },
    shorts = {
        "v" : ["--version"],
        "h" : ["--help"],
        "lvl": ["--loglevel"],
        "s": ["--loglevel", "silent"],
        "silent": ["--loglevel", "silent"],
        "debug": ["--loglevel", "debug"]
    };

exports.known = known;
exports.shorts = shorts;

exports.parse = function(args) {
    args = args || process.argv;
    var main = args[2] || 'help',
        off = 3, parsed, cmd, found;

    if (main && main.indexOf('-') === 0) {
        off = 2;
        main = 'help';
    }
    parsed = nopt(known, shorts, args, off);

    if (parsed.version) {
        main = 'version';
    }

    if (parsed.coverage) {
        parsed.filter = 'coverage';
    }
    if (!parsed.filter) {
        parsed.filter = 'raw';
    }

    parsed.lint = parsed.lint || 'preferred';

    cmd = cmds[main];
    if (!cmd) {
        found = [];
        Object.keys(cmds).forEach(function(c) {
            if (c.indexOf(main) === 0) {
                found.push(c);
            }
        });
        if (found.length > 1) {
            cmd = found;
        } else {
            cmd = cmds[found[0]];
        }
    }

    return {
        main: main,
        cmd: cmd,
        parsed: parsed
    };
};
