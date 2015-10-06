/* Cbe
 * CLAM block explorer
 * (c) 2015 David (daXXog) Volm ><> + + + <><
 * Released under Apache License, Version 2.0:
 * http://www.apache.org/licenses/LICENSE-2.0.html  
 */

//eh pos: 12

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
                that.rawtransactions = db.collection('rawtransactions');
                that.transactions = db.collection('transactions');
                that.txos = db.collection('txos');
                that.txis = db.collection('txis');
                
                /*
                that.blocks.drop();
                that.rawtransactions.drop();
                that.transactions.drop();
                that.txos.drop();
                that.txis.drop();
                */
                
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
                            
                            //that.blockGrabber.push(523939);
                            //that.blockGrabber.push(525360);
                            
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
                    var parsed = CBE.parseBlock(block);
                    
                    parsed.tx.forEach(function(hash) {
                        var tx = {};
                        
                        tx.height = height;
                        tx.hash = hash;
                        
                        that.txGrabber.push(tx, function(err) {
                            eh(err, 8);
                        });
                        
                        that.rawTxGrabber.push(hash, function(err) {
                            eh(err, 12);
                        });
                    });
                    
                    that.blocks.insert(parsed, cb);
                } else {
                    cb({
                        Error: err,
                        command: 'getblockbynumber'
                    });
                }
            });
        }, 2);
        
        //async magical tx grabber, dumps into mongodb
        this.txGrabber = async.queue(function(tx, cb) {
            var hash = tx.hash,
                height = tx.height;
            
            console.log('getting transaction ' + hash);
            
            rpc.cmd('gettransaction', hash, function(err, tx) {
                if(!err) {
                    var parsed;
                    
                    tx.height = height;
                    parsed = CBE.parseTx(tx);
                    
                    parsed.vout.forEach(function(txo) {
                        that.txos.insert(CBE.parseTxo(parsed, txo), function(err) {
                            if(err) {
                                eh({
                                    Error: err,
                                    collection: 'txos',
                                    command: 'gettransaction'
                                }, 9);
                            }
                        });
                    });
                    
                    parsed.vin.forEach(function(txi) {
                        CBE.parseTxi(parsed, txi, that.txos, function(err, parsed) {
                            if(!err) {
                                that.txis.insert(parsed, function(err) {
                                    if(err) {
                                        eh({
                                            Error: err,
                                            collection: 'txis',
                                            command: 'gettransaction'
                                        }, 11);
                                    }
                                });
                            } else {
                                eh({
                                    Error: err,
                                    collection: 'txos',
                                    command: 'gettransaction'
                                }, 10);
                            }
                        });
                    });
                    
                    that.transactions.insert(parsed, cb);
                } else {
                    cb({
                        Error: err,
                        command: 'gettransaction'
                    });
                }
            });
        }, 2);
        
        //async magical raw tx grabber, dumps into mongodb
        this.rawTxGrabber = async.queue(function(hash, cb) {
            console.log('getting raw transaction ' + hash);
            
            rpc.cmd('getrawtransaction', hash, function(err, rawtx) {
                if(!err) {
                    that.rawtransactions.insert({
                        _id: hash,
                        data: rawtx
                    }, cb);
                } else {
                    cb({
                        Error: err,
                        command: 'getrawtransaction'
                    });
                }
            });
        });
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
    
    CBE.parseTx = function(parse) {
        var tx = {};
        
        tx._id = parse.txid;
        tx.version = parse.version;
        tx.time = parse.time;
        tx.locktime = parse.locktime;
        
        if(tx.version === 2) {
            tx.clamspeech = parse['clam-speech'];
        }
        
        tx.vin = parse.vin;
        tx.vout = parse.vout;
        tx.blockhash = parse.blockhash;
        tx.height = parse.height;
        
        return tx;
    };
    
    CBE.parseTxo = function(tx, parse) {
        var txo = {};
        
        txo._id = [tx._id, parse.n].join(':');
        txo.spent = false;
        txo.value = parse.value;
        txo.time = tx.time;
        txo.locktime = tx.locktime;
        txo.height = tx.height;
        
        if(parse.scriptPubKey.type !== 'nonstandard') {
            if(parse.scriptPubKey.addresses.length === 1) {
                txo.address = parse.scriptPubKey.addresses[0];
            } else {
                console.log('found addresses.length > 1');
            }
        } else {
            txo.address = 'nonstandard';
            console.log('found nonstandard transaction');
        }
        
        return txo;
    };
    
    CBE.parseTxi = function(tx, parse, txos, cb) {
        var txi = {},
            coinbase = false;
        
        if(typeof parse.coinbase === 'string') {
            txi.coinbase = parse.coinbase;
            coinbase = true;
        } else {
            txi._id = [parse.txid, parse.vout].join(':');
        }
        
        txi.txid = tx._id;
        txi.time = tx.time;
        txi.locktime = tx.locktime;
        txi.height = tx.height;
        //not used txi.sequence = parse.sequence;
        
        if(!coinbase) {
            setTimeout(function() {
                txos.findAndModify({
                    _id: txi._id
                }, {}, {
                    $set: {
                        spent: true
                    }
                }, function(err, doc) {
                    var txo = doc.value;
                    
                    if(!err) {
                        if(txo !== null) {
                            txi.address = txo.address;
                            txi.value = txo.value;
                            
                            cb(null, txi);
                        } else {
                            cb('Could not find txo for txi: ' + txi._id);
                        }
                    } else {
                        cb(err);
                    }
                });
            }, 10000); //wait to update
        }
    };
    
    return CBE;
}));
