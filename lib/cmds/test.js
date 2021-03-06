/*
Copyright (c) 2012, Yahoo! Inc. All rights reserved.
Code licensed under the BSD License:
http://yuilibrary.com/license/
*/
var log = require('../log'),
    util = require('../util'),
    git = require('../git'),
    path = require('path'),
    portfinder = require('portfinder'),
    fs = require('fs'),
    fork = require('child_process').fork,
    spawn = require('child_process').spawn, //comma
mods = {
    init: function(options) {
        if (options.parsed.argv.remain.length) {
            this.modules = options.parsed.argv.remain;
        }

        this.options = options;

        this.useYeti = options.parsed.yeti;
        this.yetiHub = options.parsed.hub || 'http://hub.davglass.com:80/';
        this.yetiAgents = options.parsed.agents;
        
        this.filter = options.parsed.filter;

        if (this.filter === 'coverage') {
            this.coverage = true;
        }

        var module = util.findModule(true),
            self = this;

        if (module && this.modules && this.modules.length) {
            this.modules.unshift(module.name);
            this.modules = util.dedupe(this.modules);
            module = null;
        }
        if (!module) {
            log.debug('not a module, is it yui?');
            if (util.isYUI()) {
                module = {
                    name: 'yui3',
                    dir: path.join(git.findRoot(), '../src')
                };
            } else {
                log.bail('not in a module directory');
            }
        }
        
        this.module = module;
        if (this.yetiHub && this.useYeti) {
            if (this.yetiAgents) {
                this.agents();
            } else {
                this.yeti();
            }
        } else {
            this.prepGrover(function(port) {
                if (options.parsed.cli) {
                    self.cli(port, function() {
                        self.killGrover();
                    });
                } else {
                    if (options.parsed.cli === false) {
                        self.grover();
                    } else {
                        self.cli(port, function() {
                            self.grover();
                        });
                    }
                }
            });
        }
    },
    buildYUI: function(callback) {
        log.info('installing yui to create npm package');
        var yuibase = path.join(git.findRoot(), '../src/yui'),
            shifter = path.join(__dirname, '../../node_modules/.bin/shifter'),
            child,
            self = this;
        
        child = spawn(shifter, [
            '--config',
            'build-npm.json'
        ], {
            cwd: yuibase
        });

        child.stdout.on('data', function(data) {
            console.log(data.toString().trim());
        });

        child.on('exit', function() {
            log.info('yui install complete, continuing..');
            self.installNPM(callback);
        });
    },
    removeLocalYUITest: function(callback) {
        log.warn('removing localYUITest install');
        var npmbase = path.join(git.findRoot(), '../build-npm'),
            child,
            self = this;

        if (!util.exists(npmbase)) {
            log.error('yui needs to be built first!');
            return self.buildYUI(callback);
        }
        
        child = spawn('npm', [
            'remove',
            'yuitest',
            '-loglevel',
            'silent'
        ], {
            cwd: npmbase
        });

        child.stdout.on('data', function(data) {
            console.log(data.toString().trim());
        });

        child.on('exit', function() {
            log.info('npm removal complete, continuing..');
            self.cli(callback);
        });

    },
    cli: function(port, callback) {
        log.debug('checking for cli based tests');
        var gbase = path.join(git.findRoot(), '../'),
            yuitestBin = path.join(__dirname, '../../node_modules/.bin/yuitest'),
            base, batch,
            self = this, yuitest,
            tests = [], files = [],
            testBase = path.join(this.module.dir, 'tests', 'cli'),
            env = process.env;

        env.NODE_PATH = path.join(__dirname, '../../node_modules');
        env.TEST_PORT = port;
        
        if (util.exists(path.join(gbase, 'node_modules/.bin/yuitest'))) {
            log.info(path.join(gbase, 'node_modules/.bin/yuitest'));
            this.killGrover();
            log.bail('Found a local install of YUITest, remove it please..');
            //return this.removeLocalYUITest(callback);
        }

        if (!util.exists(yuitestBin)) {
            this.killGrover();
            log.bail('local yogi yuitest can not be found, you may need to reinstall yogi..');
        }
        
        if (util.isYUI() && (this.module.name === 'yui3' || this.modules)) {
            base = path.join(git.findRoot(), '../src');
            batch = fs.readdirSync(base);
            batch.forEach(function(mod) {
                var testBase = path.join(base, mod, 'tests/cli');
                if (util.exists(testBase)) {
                    files = fs.readdirSync(testBase);
                    files.forEach(function(file) {
                        var ext = path.extname(file);
                        if (ext === '.js') {
                            tests.push(path.join(testBase, file));
                        }
                    });
                }
            });
            tests.sort();
            tests.push(path.join(gbase, 'src/common/tests/prep.js'));
        } else {
            if (util.exists(testBase)) {
                files = fs.readdirSync(testBase);
                files.forEach(function(file) {
                    var ext = path.extname(file);
                    if (ext === '.js') {
                        tests.push(path.join(testBase, file));
                    }
                });
            }
        }

        if (tests.length) {
            log.info('starting cli tests');
            log.debug('executing: ' + yuitestBin + ' ' + tests.join(' '));
            log.log('');
            yuitest = spawn(yuitestBin, tests, {
                env: env
            });
            yuitest.stdout.on('data', function (data) {
                process.stdout.write(data.toString());
            });

            yuitest.stderr.on('data', function (data) {
                data = data.toString().trim();
                log.error('yuitest: ' +  data);
            });

            yuitest.on('exit', function(code) {
                if (code) {
                    self.killGrover();
                    log.bail('yuitest returned a failure');
                }
                log.info('yuitest tests complete'.green);
                if (callback) {
                    callback();
                }
            });
        } else {
            log.debug('module does not have cli based tests');
            if (callback) {
                log.debug('no cli modules, calling callback to start grover');
                callback();
            }
        }
    },
    killGrover: function() {
        log.debug('sending grover SIGKILL');
        process.kill(this.groverProcess.pid, 'SIGKILL');
    },
    grover: function() {
        /*
        log.debug('sending grover SIGCONT');
        process.kill(this.groverProcess.pid, 'SIGCONT');
        */
        log.debug('sending grover continue message');

        this.groverProcess.send({ 'continue': true });
    },
    groverProcess: null,
    agents: function() {
        log.info('fetching yeti agents from ' + this.yetiHub);
        var yeti = require('yeti'),
            client = yeti.createClient(this.yetiHub);

            client.connect(function() {
                client.getAgents(function(err, agents) {
                    log.info('hub currently has ' + agents.length + ' connected agents');
                    agents.sort().forEach(function(a) {
                        console.log('               ', a);
                    });
                    client.end();
                });
            });
    },
    yeti: function() {
        var tests = this.resolveTests(),
            yetiBin = path.join(__dirname, '../../node_modules/.bin/yeti'),
            gbase = path.join(git.findRoot(), '../'),
            child, self = this;

        log.info('using hub: ' + this.yetiHub);

        log.debug('setting server root to: ' + gbase);
        log.info('starting yeti output\n');
        tests.forEach(function(val, key) {
            tests[key] = val.replace(gbase, '');
        });
        process.chdir(gbase);

        tests.unshift(self.yetiHub);
        tests.unshift('--hub');

        child = spawn(yetiBin, tests, {
            cwd: gbase,
            stdio: 'inherit'
        });
        
        child.on('exit', function(code) {
            if (code) {
                log.bail('yeti tests failed');
            }
            log.info('yeti tests complete');
        });
    },
    resolveTests: function() {
        var tests = [], base,
            self = this, batch,
            exclude = {},
            testPath = path.join(this.module.dir, 'tests', 'unit');

        if (this.options.parsed.x) {
            this.options.parsed.x.forEach(function(m) {
                exclude[m] = true;
            });
        }
        log.debug('scanning ' + testPath);

        if (util.exists(testPath)) {
            tests = util.getTests(testPath, self.coverage);
        } else {
            if (util.isYUI() && (this.module.name === 'yui3' || this.modules)) {
                base = path.join(git.findRoot(), '../src');
                if (!this.modules) {
                    this.modules = [];
                    batch = fs.readdirSync(base);
                    batch.forEach(function(mod) {
                        self.modules.push(mod);
                    });
                }
                this.modules.sort();

                log.info('using override modules: ' + this.modules.sort().join(', '));
                if (Object.keys(exclude).length) {
                    log.warn('excluding the following modules: ' + Object.keys(exclude).sort().join(', '));
                }
                this.modules.forEach(function(mod) {
                    if (exclude[mod]) {
                        return;
                    }
                    var p = path.join(base, mod, 'tests/unit');

                    if (util.exists(p)) {
                        tests = [].concat(tests, util.getTests(p, self.coverage));
                    }
                });
            } else {
                if (this.module) {
                    log.bail('seems this module does not have tests, you should add some :)');
                } else {
                    log.bail('are you in a module directory?');
                }
            }
        }

        return tests;
    },
    prepGrover: function(callback) {
        log.info('prepping grover tests');
        var groverBin = path.join(__dirname, '../../node_modules/.bin/grover'),
            tests = [],
            gbase = path.join(git.findRoot(), '../'),
            self = this, grover;

        if (!util.exists(groverBin)) {
            log.bail('grover is not installed :(');
        }
        
        log.debug('setting server root to: ' + gbase);
        process.chdir(gbase);
        
        tests = this.resolveTests();

        tests.forEach(function(val, key) {
            tests[key] = val.replace(gbase, '');
        });

        if (this.coverage) {
            log.info('turning on coverage support in grover');
            tests.unshift('?filter=coverage');
            tests.unshift('--suffix');
            tests.unshift('--coverage');
            tests.unshift('70');
            tests.unshift('--coverage-warn');
        } else {
            tests.unshift('?filter=' + this.filter);
            tests.unshift('--suffix');
        }
        

        portfinder.getPort(function (err, port) {
            var timer;
            
            log.debug('setting grover port to ' + port);
            tests.unshift(port);
            tests.unshift('--port');
            tests.unshift('--server');
            tests.unshift('--no-run');
        
            if (self.options.parsed.t) {
                tests.unshift(self.options.parsed.t);
                tests.unshift('--timeout');
            }
            if (self.options.parsed.c) {
                tests.unshift(self.options.parsed.c);
                tests.unshift('--concurrent');
            }
            log.debug('executing testing in:\n' + tests.join('\n'));
            grover = fork(groverBin, tests, {
                cwd: gbase
            });

            self.groverProcess = grover;
            
            grover.on('exit', function(code) {
                if (code) {
                    log.bail('grover returned a failure');
                }
                log.info('grover tests complete'.green);
            });

            grover.on('message', function (msg) {
                if (msg.serving) {
                    clearInterval(timer);
                    callback(port);
                }
                if (msg.done) {
                    self.killGrover();
                }
            });
            
        });

    },
    help: function() {
        return [
            'test',
            'grover tells you what is wrong',
            'run from inside a module to test it',
            'pass extra modules to test them too.',
            'from ./src to test all',
            '--coverage to generate a coverage report',
            '--cli to run only cli tests',
            '--filter (min|raw|debug) pass filter to test files',
            '--yeti Will run tests on http://hub.davglass.com (experimental)',
            '--yeti --hub <url> Use this hub instead  (experimental)',
            '--yeti --agents List the agents connected to the hub  (experimental)'
        ];
    }
};

util.mix(exports, mods);
