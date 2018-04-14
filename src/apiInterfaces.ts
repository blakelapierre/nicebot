var http = require('http');
var https = require('https');

function jsonHttpRequest(host, port, data, callback, path = undefined){
    path = path || '/json_rpc';

    var options = {
        hostname: host,
        port: port,
        path: path,
        method: data ? 'POST' : 'GET',
        headers: {
            'Content-Length': data.length,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };

    var req = (port == 443 ? https : http).request(options, function(res){
        var replyData = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk){
            replyData += chunk;
        });
        res.on('end', function(){
            var replyJson;
            // console.log({replyData});
            try{
                replyJson = JSON.parse(replyData || '{}');
            }
            catch(e){
              console.error('parse error', e, replyData);
                callback(e, replyData);
                return;
            }
            callback(null, replyJson);
        });
    });

    req.on('error', function(e){
        callback(e);
    });

    req.end(data);
}

function rpc(host, port, method, params, callback){

    var data = JSON.stringify({
        'id': "0",
        'jsonrpc': "2.0",
        'method': method,
        'params': params,
        'password': 'password'
    });
    jsonHttpRequest(host, port, data, function(error, replyJson){
        if (error){
            callback(error, replyJson);
            return;
        }
        callback(replyJson.error, replyJson.result);
    });
}

function batchRpc(host, port, array, callback){
    var rpcArray = [];
    for (var i = 0; i < array.length; i++){
        rpcArray.push({
            'id': i.toString(),
            'jsonrpc': "2.0",
            'method': array[i][0],
            'params': array[i][1],
            'password': 'password'
        });
    }
    var data = JSON.stringify(rpcArray);
    jsonHttpRequest(host, port, data, callback);
}


export {createAPI};

function createAPI(daemonConfig, walletConfig) {
  return {
      // batchRpcDaemon: function(batchArray, callback){
      //     batchRpc(daemonConfig.host, daemonConfig.port, batchArray, callback);
      // },
      rpcDaemon: function(method, params, callback){
          rpc(daemonConfig.host, daemonConfig.port, method, params, callback);
      },
      daemonGetInfo: callback => jsonHttpRequest(daemonConfig.host, daemonConfig.port, '', callback, '/getinfo'),
      //,
      // pool: function(method, callback){
      //     jsonHttpRequest('127.0.0.1', poolApiConfig.port, '', callback, method);
      // },
      rpcWallet: function(method, params, callback){
          rpc(walletConfig.host, walletConfig.port, method, params, callback);
      },
      jsonHttpRequest
  };
}
