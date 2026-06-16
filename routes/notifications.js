// ══════════════════════════════════════════════════════════════
// MAILONE — Push Notifications (Web Push)
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const webpush  = require('web-push');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:support@mailone.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// ── Sécurité cron ─────────────────────────────────────────────
function verifyCronSecret(req, res) {
  const secret = req.headers['authorization'];
  if (process.env.NODE_ENV === 'production' &&
      secret !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Non autorisé.' });
    return false;
  }
  return true;
}

// ── POST /api/notifications/subscribe ────────────────────────
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Subscription invalide.' });

    await supabase.from('push_subscriptions').upsert({
      user_id:  req.user.id,
      endpoint: subscription.endpoint,
      p256dh:   subscription.keys?.p256dh,
      auth:     subscription.keys?.auth,
    }, { onConflict: 'endpoint' });

    res.json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ error: 'Erreur enregistrement.' });
  }
});

// ── DELETE /api/notifications/unsubscribe ─────────────────────
router.delete('/unsubscribe', requireAuth, async (req, res) => {
  try {
    await supabase.from('push_subscriptions')
      .delete()
      .eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur.' });
  }
});

// ── Helper : envoyer à tous les abonnés ──────────────────────
async function pushToAll(payload) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth');

  if (!subs?.length) return { sent: 0, errors: 0 };

  let sent = 0, errors = 0;
  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      if (err.statusCode === 410) {
        // Subscription expirée → supprimer
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      }
      errors++;
    }
  }));

  return { sent, errors };
}

// ── GET /api/notifications/cron/morning ──────────────────────
// Cron : 0 7 * * * (7h chaque matin)
router.get('/cron/morning', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  const result = await pushToAll({
    title: '🌅 Bonjour — MailOne',
    body:  'Consultez vos emails du matin et vos réponses IA.',
    tag:   'mailone-morning',
    url:   '/app.html',
  });
  res.json({ success: true, ...result });
});

// ── GET /api/notifications/cron/afternoon ────────────────────
// Cron : 0 14 * * * (14h chaque après-midi)
router.get('/cron/afternoon', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  const result = await pushToAll({
    title: '⏰ Rappel — MailOne',
    body:  'Des emails attendent votre attention cet après-midi.',
    tag:   'mailone-afternoon',
    url:   '/app.html',
  });
  res.json({ success: true, ...result });
});

module.exports = router;
module.exports.pushToAll = pushToAll;
