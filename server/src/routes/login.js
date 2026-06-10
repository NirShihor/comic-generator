const express = require('express');
const router = express.Router();
const { generateToken } = require('../middleware/auth');

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comic Generator - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           display: flex; justify-content: center; align-items: center;
           min-height: 100vh; background: #1a1a2e; color: #eee; }
    .login-box { background: #16213e; padding: 2rem; border-radius: 12px;
                 box-shadow: 0 8px 32px rgba(0,0,0,0.3); width: 320px; }
    h1 { font-size: 1.4rem; margin-bottom: 1.5rem; text-align: center; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #333;
            border-radius: 6px; background: #0f3460; color: #eee;
            font-size: 1rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #e94560; }
    button { width: 100%; padding: 0.75rem; border: none; border-radius: 6px;
             background: #e94560; color: white; font-size: 1rem;
             cursor: pointer; font-weight: 600; }
    button:hover { background: #c73652; }
    .error { color: #e94560; text-align: center; margin-bottom: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>Comic Generator</h1>
    ERRORS
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Enter password" autofocus required />
      <button type="submit">Log In</button>
    </form>
  </div>
</body>
</html>`;

router.get('/', (req, res) => {
  res.type('html').send(LOGIN_HTML.replace('ERRORS', ''));
});

router.post('/', express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body;
  const expected = process.env.AUTH_PASSWORD;

  if (!expected || password === expected) {
    const token = generateToken(expected || '');
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    return res.redirect('/');
  }

  res.type('html').send(LOGIN_HTML.replace('ERRORS', '<div class="error">Wrong password</div>'));
});

module.exports = router;
