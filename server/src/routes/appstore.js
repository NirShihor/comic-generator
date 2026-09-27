const express = require('express');
const router = express.Router();
const { verifyNotification, processor } = require('../services/appStoreServer');

// POST /api/appstore/notifications — App Store Server Notifications V2.
// Configured in App Store Connect as both the Production and Sandbox URL.
// Responds 200 once the notification is durably recorded (Apple stops
// retrying); 400 if it doesn't verify; 500 if it couldn't be recorded
// (Apple retries). Analytics delivery problems never produce an error here.
router.post('/notifications', async (req, res) => {
  const signedPayload = req.body && req.body.signedPayload;
  if (!signedPayload) return res.status(400).json({ error: 'signedPayload required' });

  let verified;
  try {
    verified = await verifyNotification(signedPayload);
  } catch (err) {
    console.warn('[appstore] rejected notification:', err.status ?? err.message);
    return res.status(400).json({ error: 'verification failed' });
  }

  try {
    const { status } = await processor.processNotification(verified);
    console.log(`[appstore] ${verified.environment} ${verified.notification.notificationType}`
      + `${verified.notification.subtype ? '/' + verified.notification.subtype : ''} → ${status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('[appstore] processing failed:', err.message);
    res.status(500).json({ error: 'processing failed' });
  }
});

module.exports = router;
