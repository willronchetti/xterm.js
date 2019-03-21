var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var os = require('os');
var pty = require('node-pty');
var fs = require('fs');
var archiver = require('archiver');


var passport = require('passport');
var Strategy = require('passport-local').Strategy;

var users = []

// Configure the local strategy for use by Passport.
//
// The local strategy require a `verify` function which receives the credentials
// (`username` and `password`) submitted by the user.  The function must verify
// that the password is correct and then invoke `cb` with a user object, which
// will be set at `req.user` in route handlers after authentication.
passport.use(new Strategy({
    usernameField: 'username',
    passwordField: 'token',
    session: false
  },
  function(username, password, cb) {
    console.log('checking password: ' + password ); 

    // the environmental variable NICETOKEN will be passed into the docker container
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


// Initialize Passport and restore authentication state, if any, from the session.
app.use(passport.initialize());
app.use(passport.session());

app.use('/build', express.static(__dirname + '/../build'));


app.get('/loginfail',
  function(req, res) {
  res.status(400);
  res.send('Unauthorized - bad token');
});


app.get('/', 
  passport.authenticate('local', { failureRedirect: '/loginfail' }),
  function(req, res){
    // not worth an entire templating engine to replace one variable in on file, so
    // read the file and replace a string with the magic token for this instance
    myindex = fs.readFileSync(__dirname + '/index.html').toString();
    myindex = myindex.replace("%USERTOKEN%", req.query.token);
    res.setHeader('Content-Type', 'text/html');
    res.send(myindex);
    //res.sendFile(__dirname + '/index.html');
});

app.get('/style.css', function(req, res){
  res.sendFile(__dirname + '/style.css');
});

app.get('/main.js', function(req, res){
  res.sendFile(__dirname + '/main.js');
});

app.post('/terminals', function (req, res) {
  passport.authenticate('local', { failureRedirect: '/loginfail' });
  var cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 30,
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

  term.on('data', function(data) {
    try {
      ws.send(data);
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
  function(req, res){
    var archive = archiver('zip');	

    archive.on('error', function(err) {
      res.status(500).send({error: err.message});
    });

    //on stream closed we can end the request
    archive.on('end', function() {
      console.log('Archive wrote %d bytes', archive.pointer());
    });

    //set the archive name
    res.attachment('archive-download.zip');

    //this is the streaming magic
    archive.pipe(res);

	// pipe archive data to the file
	//archive.pipe(output);

    archive.directory('/home/student', false);
    archive.finalize();
});



var port = process.env.PORT || 3000,
    host = os.platform() === 'win32' ? '127.0.0.1' : '0.0.0.0';

console.log('App listening to http://' + host + ':' + port);
app.listen(port, host);

