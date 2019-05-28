var express = require('express');
var expressWs = require('express-ws');
var os = require('os');
var pty = require('node-pty');
var fs = require('fs');
var archiver = require('archiver');

var passport = require('passport');
var LocalStrategy = require('passport-local').Strategy;

var users = []


function startServer() {
    var app = express();
    expressWs(app);

    // Configure the local strategy for use by Passport.
    //
    // The local strategy require a `verify` function which receives the credentials
    // (`username` and `password`) submitted by the user.  The function must verify
    // that the password is correct and then invoke `done` with a user object, which
    // will be set at `req.user` in route handlers after authentication.
    passport.use(new LocalStrategy({
	  usernameField: 'username',
	  passwordField: 'token',
	  session: false
    },
    function(username, password, cb) {

      // THE environmental variable NICETOKEN will be passed into the docker container
      // so this is what we check the password against
      var a_nice_token = process.env.NICETOKEN;
	    if ( password == a_nice_token ) {
	      // the generic user in the docker container is 'student'
	      return cb(null, 'student');
	    } else {
	      return cb(null, false);
	    }
    }));

  passport.serializeUser(function(user, cb) {
	  var id = users.length + 1
	  users[id] = user
	  console.log('serializing ' + user + ' with id ' + id );
	  cb(null, id);
  });

  passport.deserializeUser(function(id, cb) {
	  console.log('deserializing id ' + id + ' as user ' + users[id]  );
	  cb(null, users[id] );
  });

  var terminals = {},
      logs = {};

  app.use(passport.initialize());
  app.use(passport.session());

  app.use('/build', express.static(__dirname + '/../build'));

  app.get('/loginfail',
    function(req, res) {
      res.status(400);
      res.send('Unauthorized - bad token');
  });

  app.get('/', passport.authenticate('local', {failureRedirect: '/loginfail'}),
  function(req, res){
      idx = fs.readFileSync(__dirname + '/index.html').toString();
      idx = idx.replace("%USERTOKEN%", req.query.token);
      res.send(idx);
  });

  app.get('/style.css', function(req, res){
    res.sendFile(__dirname + '/style.css');
  });

  app.get('/dist/client-bundle.js', function(req, res){
    res.sendFile(__dirname + '/dist/client-bundle.js');
  });

  app.post('/terminals', function(req, res) {
    passport.authenticate('local', { failureRedirect: '/loginfail' });
    var cols = parseInt(req.query.cols),
        rows = parseInt(req.query.rows),
        term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
          name: 'xterm-color',
          cols: cols || 80,
          rows: rows || 24,
          cwd: process.env.PWD,
          env: process.env
        });

    console.log('Created terminal with PID: ' + term.pid);
    terminals[term.pid] = term;
    logs[term.pid] = '';
    term.on('data', function(data) {
      logs[term.pid] += data;
    });
    res.send(term.pid.toString());
    res.end();
  });

  app.post('/terminals/:pid/size', function (req, res) {
    var pid = parseInt(req.params.pid),
        cols = parseInt(req.query.cols),
        rows = parseInt(req.query.rows),
        term = terminals[pid];

    term.resize(cols, rows);
    console.log('Resized terminal ' + pid + ' to ' + cols + ' cols and ' + rows + ' rows.');
    res.end();
  });

  app.ws('/terminals/:pid', function (ws, req) {
    var term = terminals[parseInt(req.params.pid)];
    console.log('Connected to terminal ' + term.pid);
    ws.send(logs[term.pid]);

    function buffer(socket, timeout) {
      let s = '';
      let sender = null;
      return (data) => {
        s += data;
        if (!sender) {
          sender = setTimeout(() => {
            socket.send(s);
            s = '';
            sender = null;
          }, timeout);
        }
      };
    }
    const send = buffer(ws, 5);

    term.on('data', function(data) {
      try {
        send(data);
      } catch (ex) {
        // The WebSocket is not open, ignore
      }
    });
    ws.on('message', function(msg) {
      term.write(msg);
    });
    ws.on('close', function () {
      term.kill();
      console.log('Closed terminal ' + term.pid);
      // Clean things up
      delete terminals[term.pid];
      delete logs[term.pid];
    });
  });

  app.get('/download-archive',
      passport.authenticate('local', { failureRedirect: '/loginfail' }),
      function(req, res) {
        var archive = archiver('zip');

        archive.on('error', function(err) {
          res.status(500).send({error: err.message});
        });

        archive.on('end', function() {
          console.log('Archive wrote %d bytes', archive.pointer());
        });

        res.attachment('archive-download.zip');
        archive.pipe(res);
        archive.directory('/home/student', false);
        archive.finalize();

  });

  var port = process.env.PORT || 3000,
      host = os.platform() === 'win32' ? '127.0.0.1' : '0.0.0.0';

  console.log('App listening to http://' + host + ':' + port);
  app.listen(port, host);
}

module.exports = startServer;
