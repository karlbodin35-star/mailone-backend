// ══════════════════════════════════════════════════════════════
// MAILONE — Cron job emails onboarding
// Appelé chaque matin à 8h par Vercel Cron
// URL : GET /api/cron/emails
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const {
  sendWelcomeEmail,
  sendTrialEndingEmail,
} = require('../lib/emails');

// ── SÉCURITÉ : vérifier que c'est bien Vercel qui appelle ────
function verifyCronSecret(req, res) {
  const secret = req.headers['authorization'];
  if (process.env.NODE_ENV === 'production' &&
      secret !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Non autorisé.' });
    return false;
  }
  return true;
}

// ── ENDPOINT PRINCIPAL ────────────────────────────────────────
router.get('/emails', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  const now = new Date();
  const results = {
    welcome:  { checked: 0, sent: 0, errors: 0 },
    j3:       { checked: 0, sent: 0, errors: 0 },
    j11:      { checked: 0, sent: 0, errors: 0 },
    j14:      { checked: 0, sent: 0, errors: 0 },
    total_sent: 0,
  };

  console.log(`\n🕐 Cron emails démarré — ${now.toISOString()}`);

  try {

    // ════════════════════════════════════════════════════════
    // EMAIL J+0 — BIENVENUE
    // Condition : inscrit depuis moins de 24h, welcome pas envoyé
    // ════════════════════════════════════════════════════════
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { data: newUsers } = await supabase
      .from('users')
      .select(`
        id, email, first_name,
        subscriptions(plan, trial_end),
        email_sequence!inner(welcome_sent)
      `)
      .gte('created_at', yesterday)
      .eq('email_sequence.welcome_sent', false)
      .eq('is_active', true);

    results.welcome.checked = newUsers?.length || 0;

    for (const user of (newUsers || [])) {
      try {
        const plan = user.subscriptions?.[0]?.plan || 'solo';
        const trialEnd = user.subscriptions?.[0]?.trial_end ||
          new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

        await sendWelcomeEmail({
          email: user.email,
          firstName: user.first_name,
          plan,
          trialEnd,
        });

        // Marquer comme envoyé
        await supabase
          .from('email_sequence')
          .update({ welcome_sent: true, welcome_sent_at: now.toISOString() })
          .eq('user_id', user.id);

        results.welcome.sent++;
        console.log(`  ✅ Bienvenue → ${user.email}`);
      } catch (err) {
        results.welcome.errors++;
        console.error(`  ❌ Bienvenue erreur pour ${user.email}:`, err.message);
      }
    }

    // ════════════════════════════════════════════════════════
    // EMAIL J+3 — RELANCE SI INACTIF
    // Condition : inscrit il y a 3 jours (±6h), j3 pas envoyé,
    //             ET n'a pas encore utilisé l'IA (pas de ai_usage)
    // ════════════════════════════════════════════════════════
    const day3Start = new Date(now - (3 * 24 + 6) * 60 * 60 * 1000).toISOString();
    const day3End   = new Date(now - (3 * 24 - 6) * 60 * 60 * 1000).toISOString();

    const { data: day3Users } = await supabase
      .from('users')
      .select(`
        id, email, first_name,
        email_sequence!inner(j3_sent)
      `)
      .gte('created_at', day3Start)
      .lte('created_at', day3End)
      .eq('email_sequence.j3_sent', false)
      .eq('is_active', true);

    results.j3.checked = day3Users?.length || 0;

    for (const user of (day3Users || [])) {
      try {
        // Vérifier si l'utilisateur a déjà utilisé l'IA
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const { data: usage } = await supabase
          .from('ai_usage')
          .select('count')
          .eq('user_id', user.id)
          .eq('month_key', currentMonth)
          .single();

        const isInactive = !usage || usage.count === 0;

        if (isInactive) {
          // Envoyer email de relance J+3 via Resend directement
          const { Resend } = require('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);

          await resend.emails.send({
            from: process.env.EMAIL_FROM || 'MailOne <noreply@mailone.app>',
            to: user.email,
            subject: `${user.first_name}, avez-vous traité votre premier mail avec MailOne ?`,
            html: buildJ3Email(user.first_name),
          });

          results.j3.sent++;
          console.log(`  ✅ Relance J+3 → ${user.email}`);
        } else {
          console.log(`  ⏭  J+3 ignoré (actif) → ${user.email}`);
        }

        // Toujours marquer j3 comme traité (qu'on ait envoyé ou non)
        await supabase
          .from('email_sequence')
          .update({ j3_sent: true, j3_sent_at: now.toISOString() })
          .eq('user_id', user.id);

      } catch (err) {
        results.j3.errors++;
        console.error(`  ❌ J+3 erreur pour ${user.email}:`, err.message);
      }
    }

    // ════════════════════════════════════════════════════════
    // EMAIL J+11 — ALERTE FIN D'ESSAI DANS 3 JOURS
    // Condition : essai expire dans 3 jours (±12h), j11 pas envoyé
    // ════════════════════════════════════════════════════════
    const in3daysStart = new Date(now.getTime() + (3 * 24 - 12) * 60 * 60 * 1000).toISOString();
    const in3daysEnd   = new Date(now.getTime() + (3 * 24 + 12) * 60 * 60 * 1000).toISOString();

    const { data: j11Users } = await supabase
      .from('subscriptions')
      .select(`
        user_id, plan,
        users!inner(email, first_name),
        email_sequence:user_id(j11_sent)
      `)
      .gte('trial_end', in3daysStart)
      .lte('trial_end', in3daysEnd)
      .eq('status', 'trialing');

    results.j11.checked = j11Users?.length || 0;

    for (const sub of (j11Users || [])) {
      // Vérifier que j11 pas encore envoyé
      const { data: seq } = await supabase
        .from('email_sequence')
        .select('j11_sent')
        .eq('user_id', sub.user_id)
        .single();

      if (seq?.j11_sent) continue;

      try {
        await sendTrialEndingEmail({
          email: sub.users.email,
          firstName: sub.users.first_name,
          plan: sub.plan,
          daysLeft: 3,
          portalUrl: `${process.env.FRONTEND_URL}/account.html#plan`,
        });

        await supabase
          .from('email_sequence')
          .update({ j11_sent: true, j11_sent_at: now.toISOString() })
          .eq('user_id', sub.user_id);

        results.j11.sent++;
        console.log(`  ✅ Alerte J+11 → ${sub.users.email}`);
      } catch (err) {
        results.j11.errors++;
        console.error(`  ❌ J+11 erreur:`, err.message);
      }
    }

    // ════════════════════════════════════════════════════════
    // EMAIL J+14 — ESSAI EXPIRÉ AUJOURD'HUI
    // Condition : essai a expiré dans les dernières 24h, j14 pas envoyé,
    //             et toujours en statut trialing (pas encore converti)
    // ════════════════════════════════════════════════════════
    const { data: expiredSubs } = await supabase
      .from('subscriptions')
      .select(`
        user_id, plan, trial_end,
        users!inner(email, first_name)
      `)
      .lte('trial_end', now.toISOString())
      .gte('trial_end', yesterday)
      .eq('status', 'trialing');

    results.j14.checked = expiredSubs?.length || 0;

    for (const sub of (expiredSubs || [])) {
      const { data: seq } = await supabase
        .from('email_sequence')
        .select('j14_sent')
        .eq('user_id', sub.user_id)
        .single();

      if (seq?.j14_sent) continue;

      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);

        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'MailOne <noreply@mailone.app>',
          to: sub.users.email,
          subject: `Votre essai MailOne est terminé — et maintenant ?`,
          html: buildJ14Email(sub.users.first_name, sub.plan),
        });

        await supabase
          .from('email_sequence')
          .update({ j14_sent: true, j14_sent_at: now.toISOString() })
          .eq('user_id', sub.user_id);

        // Mettre à jour le statut de l'abonnement
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('user_id', sub.user_id)
          .eq('status', 'trialing');

        results.j14.sent++;
        console.log(`  ✅ Expiration J+14 → ${sub.users.email}`);
      } catch (err) {
        results.j14.errors++;
        console.error(`  ❌ J+14 erreur:`, err.message);
      }
    }

  } catch (err) {
    console.error('Cron fatal error:', err);
    return res.status(500).json({ error: err.message, results });
  }

  results.total_sent = results.welcome.sent + results.j3.sent + results.j11.sent + results.j14.sent;

  console.log(`\n📊 Résumé cron:`);
  console.log(`   Bienvenue J+0 : ${results.welcome.sent}/${results.welcome.checked} envoyés`);
  console.log(`   Relance J+3   : ${results.j3.sent}/${results.j3.checked} envoyés`);
  console.log(`   Alerte J+11   : ${results.j11.sent}/${results.j11.checked} envoyés`);
  console.log(`   Expiration J+14: ${results.j14.sent}/${results.j14.checked} envoyés`);
  console.log(`   Total         : ${results.total_sent} emails envoyés\n`);

  res.json({ success: true, ran_at: now.toISOString(), results });
});

// ── TEMPLATES EMAIL ───────────────────────────────────────────
function buildJ3Email(firstName) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;background:#f5f3ef;padding:24px}
.c{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e0dbd2}
.h{background:#1a1814;padding:20px 28px}
.logo{font-size:18px;font-weight:800;color:#fff}
.b{padding:28px}h1{font-size:20px;font-weight:800;margin-bottom:10px}
p{font-size:14px;color:#4a4540;line-height:1.7;margin-bottom:12px}
.box{background:#edf8f2;border:1px solid #bbf7d0;border-radius:9px;padding:14px 18px;margin:16px 0;font-size:13px;color:#166534}
.btn{display:inline-block;padding:12px 22px;background:#15a06a;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px}
.f{padding:16px 28px;background:#f5f3ef;font-size:11px;color:#8a8480}</style></head>
<body><div class="c">
<div class="h"><span class="logo">MailOne●</span></div>
<div class="b">
<h1>Bonjour ${firstName},</h1>
<p>Vous avez créé votre compte il y a 3 jours — mais je vois que vous n'avez pas encore traité de mail avec MailOne.</p>
<p>C'est normal, voici exactement comment démarrer en 30 secondes :</p>
<div class="box">
<strong>🚀 En 30 secondes :</strong><br><br>
1. Ouvrez MailOne et cliquez sur le premier mail<br>
2. Lisez le résumé en une ligne (en haut en vert)<br>
3. Regardez la réponse générée à droite<br>
4. Copiez-la et collez-la dans Gmail<br><br>
<strong>C'est tout.</strong>
</div>
<a href="${process.env.FRONTEND_URL}/app.html" class="btn">Ouvrir MailOne →</a>
<p style="margin-top:20px;font-size:13px;color:#8a8480">Un problème ? Répondez à cet email, je vous aide personnellement.</p>
</div>
<div class="f">MailOne · <a href="${process.env.FRONTEND_URL}" style="color:#15a06a">mailone.app</a></div>
</div></body></html>`;
}

function buildJ14Email(firstName, plan) {
  const planNames = { solo: 'Solo ✨', team: 'Équipe ⭐', enterprise: 'Entreprise 🏢' };
  const planPrices = { solo: '99€/mois', team: '900€/mois', enterprise: '1 780€/mois' };
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;background:#f5f3ef;padding:24px}
.c{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e0dbd2}
.h{background:#1a1814;padding:20px 28px}
.logo{font-size:18px;font-weight:800;color:#fff}
.b{padding:28px}h1{font-size:20px;font-weight:800;margin-bottom:10px}
p{font-size:14px;color:#4a4540;line-height:1.7;margin-bottom:12px}
.btn{display:inline-block;padding:12px 22px;background:#15a06a;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px}
.feedback{background:#f9f9f9;border:1px solid #e5e5e5;border-radius:9px;padding:16px;margin:16px 0}
.fb-btn{display:block;padding:8px 14px;border:1px solid #ddd;border-radius:7px;text-decoration:none;color:#333;font-size:13px;margin-bottom:6px}
.f{padding:16px 28px;background:#f5f3ef;font-size:11px;color:#8a8480}</style></head>
<body><div class="c">
<div class="h"><span class="logo">MailOne●</span></div>
<div class="b">
<h1>Bonjour ${firstName},</h1>
<p>Votre essai gratuit de 14 jours sur MailOne s'est terminé aujourd'hui.</p>
<p>Votre accès est suspendu, mais <strong>toutes vos données sont conservées</strong>. Reprenez exactement où vous en étiez :</p>
<a href="${process.env.FRONTEND_URL}/account.html#plan" class="btn">Réactiver mon accès — ${planPrices[plan] || '99€/mois'}</a>
<div class="feedback">
<p style="font-weight:700;margin-bottom:10px">Vous avez décidé de ne pas continuer ?</p>
<p style="font-size:13px;margin-bottom:10px">C'est ok. Mais aidez-moi à améliorer MailOne :</p>
<a href="mailto:support@mailone.app?subject=Feedback - Trop cher" class="fb-btn">💸 Trop cher</a>
<a href="mailto:support@mailone.app?subject=Feedback - Pas compris" class="fb-btn">🤔 Pas bien compris</a>
<a href="mailto:support@mailone.app?subject=Feedback - Connexion" class="fb-btn">🔧 Problème technique</a>
<a href="mailto:support@mailone.app?subject=Feedback - Autre" class="fb-btn">💬 Autre raison</a>
</div>
</div>
<div class="f">MailOne · <a href="${process.env.FRONTEND_URL}" style="color:#15a06a">mailone.app</a></div>
</div></body></html>`;
}

module.exports = router;
