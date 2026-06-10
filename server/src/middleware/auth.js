const crypto = require('crypto');

function generateToken(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name.trim()] = rest.join('=').trim();
  });
  return cookies;
}

function authMiddleware(req, res, next) {
  const password = process.env.AUTH_PASSWORD;
  if (!password) return next();

  if (req.path === '/api/health') return next();
  if (req.path === '/login') return next();

  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.auth_token === generateToken(password)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.redirect('/login');
}

module.exports = { authMiddleware, generateToken };
