var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var os = require('os');
var pty = require('node-pty');

var terminals = {},
    logs = {};

var passport = require('passport');
var Strategy = require('passport-local').Strategy;

var users = []

// Verify Credentials
passport.use(new Strategy({
    usernameField: 'username',
    passwordField: 'token',
    session: false
    },
    function (username, password, cb) {
        console.log('checking password: ' + password);
        var good_token = process.env.NICETOKEN;
        if (password == good_token) {
            return cb(null, 'student');
        }
        else {
            return cb(null, false);
        }

    }));

passport.serializeUser(function (user, cb) {
    var id = users.length + 1
    users[id] = user
    console.log('serializing ' + user + ' with id ' + id );
    cb(null, id);
}

passport.deserializeUser(function(id, cb) {
    console.log('deserializing id ' + id + ' as user ' + users[id] );
    cb(null, users[id] );
});

app.use(passport.initialize());
app.use(passport.session());

app.use('/build', express.static(__dirname + '/../../build'));
app.use('/demo', express.static(__dirname + '/../../demo'));
app.use('/zmodemjs', express.static(__dirname + '/../../node_modules/zmodem.js/dist'));

app.get('/', function(req, res){
    passport.authenticate('local', { failureRedirect: '/loginfail' } ),
    function(req, res) {
        myindex = fs.readFileSync(__dirname + '/index.html').toString();
        myindex = myindiex.replace("%USERTOKEN%", req.query.token);
        res.setHeader('Content-Type', 'text/html');
        res.send(myindex);
    }
});

app.get('/loginfail', function(req, res) {
    res.status(400);
    res.send('Unauthorized - bad token');
});

app.get('/style.css', function(req, res){
  res.sendFile(__dirname + '../style.css');
});

app.get('/main.js', function(req, res){
  res.sendFile(__dirname + '/main.js');
});

app.post('/terminals', function (req, res) {
  passport.authenticate('local', { failureRedirect: '/loginfail' } );
  var cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
        encoding: null,
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
    passport.authenticate('local', { failureRedirect : '/loginfail' }),
    function(req, res) {
        var archive = archiver('zip');
        archive.on('error', function(err) {
            res.status(500).send({error: err.message});
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
