/* Cbe
 * CLAM block explorer
 * (c) 2015 David (daXXog) Volm ><> + + + <><
 * Released under Apache License, Version 2.0:
 * http://www.apache.org/licenses/LICENSE-2.0.html  
 */

/* UMD LOADER: https://github.com/umdjs/umd/blob/master/returnExports.js */
(function (root, factory) {
    if (typeof exports === 'object') {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like enviroments that support module.exports,
        // like Node.
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(factory);
    } else {
        // Browser globals (root is window)
        root.Cbe = factory();
  }
}(this, function() {
    var express = require('express'),
        async = require('async'),
        redis = require('redis'),
        MongoClient = require('mongodb').MongoClient,
        clamcoin = require('clamcoin'),
        EventEmitter = require('events').EventEmitter,
        inherits = require('util').inherits,
        cachedCommands = [
            'getbestblockhash',
            'getblockcount',
            'getcheckpoint',
            'getconnectioncount',
            'getdifficulty',
            'getnettotals',
            'getpeerinfo'
        ],
        versions = [
            'v1'
        ],
        CBE;
    
    CBE = function(options) {
        var app    = this.app    = express.Router(),
            rpc    = this.rpc    = new clamcoin.Client(options.rpc),
            client = this.client = redis.createClient(options.redis.port, options.redis.host),
            eh     = this.eh     = options.eh,
            that   = this,
            
            PULSE = 10000;
            
        if(typeof options.redis.auth === 'string') {
            client.auth(options.redis.auth, eh); //redis authentication
        }
        
        MongoClient.connect(options.mongo, function(err, db) {
            if(!err) {
                that.blocks = db.collection('blocks');
                that.transactions = db.collection('transactions');
                that.emit('connected');
            } else {
                eh(err, 1);
            }
        });
        
        //root
        app.get('/', function(req, res) {
            res.json({});
        });
        
        //magic cache
        async.forever(function(cb) {
            async.forEach(cachedCommands, function(cmd, cb) {
                rpc.cmd(cmd, function(err, data) {
                    if(!err) {
                        client.hset('cbe', cmd, JSON.stringify(data), cb);
                    } else {
                        cb({
                            Error: err,
                            command: cmd
                        });
                    }
                });
            }, function(err) {
                if(!err) {
                    setTimeout(cb, PULSE);
                } else {
                    cb(err);
                }
            });
        }, function(err) {
            if(err) {
                eh(err, 7);
            }
        });
        
        //cached api
        versions.forEach(function(version) {
            switch(version) {
                default:
                    cachedCommands.forEach(function(cmd) {
                        app.get('/' + ['api', version, cmd].join('/'), function(req, res) {
                            client.hget('cbe', cmd, function(err, _data) {
                                if(!err) {
                                    try {
                                        var data = JSON.parse(_data);
                                        res.json(data);
                                    } catch(e) {
                                        eh(e, 6);
                                        res.status(500).json('sec J1');
                                    }
                                } else {
                                    eh(err, 2);
                                    res.status(500).json('sec R1');
                                }
                            });
                        });
                    });
                  break;
            }
        });
        
        //database connected
        this.on('connected', function() {
            //find missing blocks in database and dump them
            client.hget('cbe', 'getblockcount', function(err, count) {
                if(!err) {
                    that.blocks.aggregate([{
                        '$project': {
                            '_id': '$height',
                            'nextblockhash': {
                                '$cond': [{
                                    '$gt': ['$nextblockhash', null ]
                                }, true, false]
                            }
                        }
                    }], function(err, blocks) {
                        if(!err) {
                            var all = new Array(parseInt(count, 10));
                            
                            blocks.forEach(function(v) {
                                if(v.nextblockhash === true) {
                                    all[v._id] = true;
                                }
                            });
                            
                            async.forEachOf(all, function(v, i, cb) {
                                if(v !== true) {
                                    that.blockGrabber.push(i, cb);
                                }
                            }, function(err) {
                                if(err) {
                                    eh(err, 5);
                                }
                            });
                        } else {
                            eh(err, 3);
                        }
                    });
                } else {
                    eh(err, 4);
                }
            });
        });
        
        //async magical block grabber, dumps into mongodb
        this.blockGrabber = async.queue(function(height, cb) {
            console.log('getting block #' + height);
            
            rpc.cmd('getblockbynumber', height, function(err, block) {
                if(!err) {
                    that.blocks.insert(CBE.parseBlock(block), cb);
                } else {
                    cb({
                        Error: err,
                        command: 'getblockbynumber'
                    });
                }
            });
        }, 4);
    }; inherits(CBE, EventEmitter);
    
    CBE.parseBlock = function(parse) {
        var block = {};
        
        block._id = parse.hash;
        block.size = parse.size;
        block.height = parse.height;
        block.version = parse.version;
        block.merkleroot = parse.merkleroot;
        block.mint = parse.mint;
        block.moneysupply = parse.moneysupply;
        block.digsupply = parse.digsupply;
        block.stakesupply = parse.stakesupply;
        block.activesupply = parse.activesupply;
        block.time = parse.time;
        block.nonce = parse.nonce;
        block.bits = parse.bits;
        block.difficulty = parse.difficulty;
        block.chaintrust = parse.chaintrust;
        
        if(block.height !== 0) {
            block.previousblockhash = parse.previousblockhash;
        }
        
        if(typeof parse.nextblockhash === 'string') {
            block.nextblockhash = parse.nextblockhash;
        }
        
        block.flags = parse.flags;
        block.proofhash = parse.proofhash;
        block.entropybit = parse.entropybit;
        block.modifier = parse.modifier;
        block.tx = parse.tx;
        
        return block;
    };
    
    return CBE;
}));
