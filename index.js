var domain = require('domain');
var log = require('winston');
var express = require('express');

var config = {
  debug: false,
  log_level: 'info',
  log_path: __dirname + '/callmyphoneforme.log',
  using_proxy: true,
  web_port: 5309,
  run_as_user: null,
  stripe_secret_key: 'sk_test_kV2ZDOHexA8Ey5KWmy2RyLWs',
  signing_secret: 'qsO19RlP6pV0qIEALNOqMi3HdibNmCNF'
};

var stripe = require('stripe')(config.stripe_secret_key);


main();

function main() {
  // Make sure we have permission to bind to the requested port
  if (config.web_port < 1024 && process.getuid() !== 0)
    throw new Error('Binding to ports less than 1024 requires root privileges');

  var app = express();
  app.disable('x-powered-by');
  app.set('env', config.debug ? 'development' : 'production');
  app.set('trust proxy', config.using_proxy);
  app.use(catchErrors);
  app.use(express.bodyParser());
  app.use(express.cookieParser(config.signing_secret));
  app.use(express.session({ cookie: { maxAge: 60 * 1000 }}));
  app.use(express.logger({ stream: {
    write: function(str) {
      if (str[str.length - 1] === '\n')
        str = str.substr(0, str.length - 1);
      log.info(str);
    }
  } }));
  app.use(express.favicon(__dirname + '/public/favicon.ico'));

  // Serve static files
  app.use(express.static(__dirname + '/public'));

  // Setup endpoints
  app.get('/', homepage);
  app.post('/', payment);

  // Setup error handlers
  app.all('*', handle404);
  app.use(app.router);
  app.use(handleError);

  app.listen(config.web_port, function() {
    // If run_as_user is set, try to switch users
    if (config.run_as_user) {
      try {
        process.setuid(config.run_as_user);
        log.info('Changed to running as user ' + config.run_as_user);
      } catch (err) {
        log.error('Failed to change to user ' + config.run_as_user + ': ' + err);
      }
    }

    // Now that we've dropped root privileges (if requested), setup file logging
    // NOTE: Any messages logged before this will go to the console only
    if (config.log_path)
      log.add(log.transports.File, { level: config.log_level, filename: config.log_path });

    log.info('callmyphoneforme is listening on port ' + config.web_port);
  });
}

/**************************************
 * Request handlers
 **************************************/

function homepage(req, res, next) {
  res.sendfile(__dirname + '/public/index.html');
}

function payment(req, res, next) {
  res.type('application/json');

  var token = req.body;
  if (!token)
    return res.send(500, 'Missing payment token');

  log.info('Received payment request with token ' + token);

  stripe.charges.create(
    {
      amount: 100,
      currency: 'usd',
      card: token
    },
    function(err, charge) {
      if (err) {
        log.error('Charge failed: ' + err);
        return res.send(500, 'Charge failed');
      }

      log.info('Charge ' + charge.id + ' succeeded, contacting Twilio');


    }
  );
}

/**************************************
 * Helper Methods
 **************************************/

/**
 * Create a domain for each request to gracefully handle errors.
 */
function catchErrors(req, res, next) {
  var d = domain.create();
  d.on('error', next);
  d.run(next);
}

/**
 * Generates a 404 response.
 */
function handle404(req, res) {
  res.statusCode = 404;
  res.sendfile(__dirname + '/public/notfound.html');
}

/**
 * Generates a 500 response.
 */
function handleError(err, req, res, next) {
  log.error('[REQ ERROR]: ' + (err.stack || '' + err));
  res.statusCode = 500;
  res.sendfile(__dirname + '/public/error.html');
}
