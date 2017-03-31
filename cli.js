/* Cbe / cli.js
 * command line interface for Cbe
 * (c) 2015 David (daXXog) Volm ><> + + + <><
 * Released under Apache License, Version 2.0:
 * http://www.apache.org/licenses/LICENSE-2.0.html  
 */

var express = require('express'),
    app = express(),
    CBE = require('./cbe.js'),
    settings = require('./settings.js');
    //cbe = new CBE(require('./settings.js'));


console.log(settings);
new CBE(settings);

//app.use('', cbe.app);

// listen on c9
// https://cbe-daxxog.c9.io/

//console.log([process.env.IP, process.env.PORT].join(':'));
//console.log('https://cbe-daxxog.c9.io/');
//app.listen(process.env.PORT, process.env.IP);

//app.listen(7777);