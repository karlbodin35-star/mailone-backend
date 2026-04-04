const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM || 'MailOne <noreply@mailone.app>';

// ── TEMPLATES HTML ──────────────────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f3ef; margin: 0; padding: 24px; color: #1a1814; }
  .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e0dbd2; }
  .header { background: #1a1814; padding: 24px 32px; display: flex; align-items: center; }
  .logo { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
  .logo-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #15a06a; margin-left: 2px; }
  .body { padding: 32px; }
  h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; margin: 0 0 10px; }
  p { font-size: 14px; color: #4a4540; line-height: 1.7; margin: 0 0 16px; }
  .btn { display: inline-block; padding: 13px 24px; background: #15a06a; color: #fff; border-radius: 9px; text-decoration: none; font-weight: 700; font-size: 14px; margin: 8px 0; }
  .btn-dark { background: #1a1814; }
  .info-box { background: #edf8f2; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 18px; margin: 16px 0; font-size: 13px; color: #166534; }
  .divider { height: 1px; background: #e0dbd2; margin: 24px 0; }
  .footer { padding: 20px 32px; background: #f5f3ef; font-size: 11px; color: #8a8480; line-height: 1.6; }
  .footer a { color: #15a06a; text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">MailOne<span class="logo-dot"></span></div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    MailOne SAS · <a href="${process.env.FRONTEND_URL}">mailone.app</a> · 
    <a href="${process.env.FRONTEND_URL}/legal.html">CGU & Confidentialité</a><br>
    Vous recevez cet email car vous avez créé un compte MailOne. 
    <a href="${process.env.FRONTEND_URL}/account.html">Gérer mes préférences</a>
  </div>
</div>
</body>
</html>`;

// ── EMAILS ──────────────────────────────────────────────────

async function sendWelcomeEmail({ email, firstName, plan, trialEnd }) {
  const planNames = { solo: 'Solo ✨', team: 'Équipe ⭐', enterprise: 'Entreprise 🏢' };
  const planPrices = { solo: '99€/mois', team: '900€/mois', enterprise: '1 780€/mois' };
  const trialDate = new Date(trialEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = baseTemplate(`
    <h1>Bienvenue sur MailOne, ${firstName} ! 🎉</h1>
    <p>Votre compte est créé et votre essai gratuit de <strong>14 jours</strong> commence maintenant.</p>
    <div class="info-box">
      ✅ <strong>Plan ${planNames[plan] || plan}</strong> — ${planPrices[plan] || ''}<br>
      📅 Essai gratuit jusqu'au ${trialDate}<br>
      💳 Aucune facturation avant la fin de l'essai
    </div>
    <p>Voici comment démarrer :</p>
    <p>
      <strong>1.</strong> Connectez votre Gmail ou Outlook (lecture seule, 2 minutes)<br>
      <strong>2.</strong> Laissez l'agent analyser vos premiers mails<br>
      <strong>3.</strong> Copiez vos premières réponses et voyez le temps gagné
    </p>
    <a href="${process.env.FRONTEND_URL}/app.html" class="btn">Accéder à mon application →</a>
    <div class="divider"></div>
    <p style="font-size:13px;color:#8a8480">Des questions ? Répondez à cet email ou contactez <a href="mailto:${process.env.EMAIL_SUPPORT}" style="color:#15a06a">${process.env.EMAIL_SUPPORT}</a></p>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Bienvenue sur MailOne, ${firstName} ! Votre essai de 14 jours commence maintenant`,
    html,
  });
}

async function sendTrialEndingEmail({ email, firstName, plan, daysLeft, portalUrl }) {
  const planNames = { solo: 'Solo ✨', team: 'Équipe ⭐', enterprise: 'Entreprise 🏢' };
  const planPrices = { solo: '99€/mois', team: '900€/mois', enterprise: '1 780€/mois' };

  const html = baseTemplate(`
    <h1>Votre essai se termine dans ${daysLeft} jours ⏰</h1>
    <p>Bonjour ${firstName},</p>
    <p>Votre essai gratuit du plan <strong>${planNames[plan] || plan}</strong> se termine dans <strong>${daysLeft} jours</strong>.</p>
    <div class="info-box">
      💡 Pour continuer à utiliser MailOne sans interruption, activez votre abonnement maintenant.<br><br>
      <strong>Plan ${planNames[plan] || plan} — ${planPrices[plan] || ''}</strong><br>
      2 mois offerts avec l'abonnement annuel !
    </div>
    <a href="${portalUrl || process.env.FRONTEND_URL + '/account.html#plan'}" class="btn">Activer mon abonnement →</a>
    <a href="${process.env.FRONTEND_URL}/index.html#pricing" class="btn btn-dark" style="margin-left:10px">Voir tous les plans</a>
    <div class="divider"></div>
    <p style="font-size:13px;color:#8a8480">Si vous ne souhaitez pas continuer, votre accès s'arrêtera automatiquement à la fin de l'essai. Aucune facturation.</p>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `⏰ Votre essai MailOne se termine dans ${daysLeft} jours`,
    html,
  });
}

async function sendPaymentSuccessEmail({ email, firstName, plan, amount, periodEnd, invoiceUrl }) {
  const planNames = { solo: 'Solo ✨', team: 'Équipe ⭐', enterprise: 'Entreprise 🏢' };
  const renewDate = new Date(periodEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = baseTemplate(`
    <h1>Paiement confirmé ✅</h1>
    <p>Bonjour ${firstName},</p>
    <p>Votre paiement a bien été reçu. Merci de faire confiance à MailOne !</p>
    <div class="info-box">
      ✅ <strong>Montant :</strong> ${(amount / 100).toFixed(2)}€<br>
      📦 <strong>Plan :</strong> ${planNames[plan] || plan}<br>
      📅 <strong>Prochain renouvellement :</strong> ${renewDate}
    </div>
    ${invoiceUrl ? `<a href="${invoiceUrl}" class="btn">📥 Télécharger ma facture</a>` : ''}
    <div class="divider"></div>
    <p style="font-size:13px;color:#8a8480">Gérez votre abonnement à tout moment depuis <a href="${process.env.FRONTEND_URL}/account.html" style="color:#15a06a">votre espace compte</a>.</p>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `✅ Paiement confirmé — MailOne ${planNames[plan] || plan}`,
    html,
  });
}

async function sendPaymentFailedEmail({ email, firstName, retryUrl }) {
  const html = baseTemplate(`
    <h1>⚠️ Problème avec votre paiement</h1>
    <p>Bonjour ${firstName},</p>
    <p>Nous n'avons pas pu traiter votre paiement. Cela peut arriver pour plusieurs raisons : carte expirée, fonds insuffisants ou limite atteinte.</p>
    <div class="info-box" style="background:#fef1ee;border-color:#fca5a5;color:#7f1d1d">
      ⚠️ <strong>Votre accès sera suspendu dans 7 jours</strong> si le paiement n'est pas régularisé.
    </div>
    <a href="${retryUrl || process.env.FRONTEND_URL + '/account.html#plan'}" class="btn" style="background:#c93820">Mettre à jour ma carte de paiement →</a>
    <div class="divider"></div>
    <p style="font-size:13px;color:#8a8480">Un problème ? Contactez-nous : <a href="mailto:${process.env.EMAIL_SUPPORT}" style="color:#15a06a">${process.env.EMAIL_SUPPORT}</a></p>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `⚠️ Paiement échoué — Action requise sur MailOne`,
    html,
  });
}

async function sendPasswordResetEmail({ email, firstName, resetUrl }) {
  const html = baseTemplate(`
    <h1>Réinitialisation de mot de passe 🔑</h1>
    <p>Bonjour ${firstName || ''},</p>
    <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous — ce lien est valable <strong>1 heure</strong>.</p>
    <a href="${resetUrl}" class="btn">Réinitialiser mon mot de passe →</a>
    <div class="divider"></div>
    <p style="font-size:13px;color:#8a8480">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe reste inchangé.</p>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `🔑 Réinitialisez votre mot de passe MailOne`,
    html,
  });
}

async function sendCancellationEmail({ email, firstName, accessEnd }) {
  const endDate = new Date(accessEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const html = baseTemplate(`
    <h1>Votre abonnement a été annulé</h1>
    <p>Bonjour ${firstName},</p>
    <p>Votre abonnement MailOne a bien été annulé. Vous conservez l'accès à toutes les fonctionnalités jusqu'au <strong>${endDate}</strong>.</p>
    <div class="info-box">
      📅 Accès garanti jusqu'au ${endDate}<br>
      🗑️ Vos données seront supprimées 30 jours après cette date, conformément au RGPD
    </div>
    <p>Vous pouvez vous réabonner à tout moment depuis votre espace compte.</p>
    <a href="${process.env.FRONTEND_URL}/account.html" class="btn btn-dark">Réactiver mon compte</a>
    <div class="divider"></div>
    <p style="font-size:13px;color:#8a8480">Un retour à partager ? Répondez à cet email — vos retours nous aident vraiment à améliorer MailOne.</p>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Votre abonnement MailOne a été annulé`,
    html,
  });
}

async function sendReferralRewardEmail({ email, firstName, rewardMonths, referreeName }) {
  const html = baseTemplate(`
    <h1>🎁 Vous avez gagné ${rewardMonths} mois gratuit${rewardMonths > 1 ? 's' : ''} !</h1>
    <p>Bonjour ${firstName},</p>
    <p><strong>${referreeName}</strong> vient de s'abonner à MailOne grâce à votre recommandation.</p>
    <div class="info-box">
      🎁 <strong>${rewardMonths} mois gratuit${rewardMonths > 1 ? 's' : ''}</strong> ajouté${rewardMonths > 1 ? 's' : ''} à votre abonnement<br>
      ✅ Le crédit sera appliqué à votre prochain renouvellement automatiquement
    </div>
    <p>Continuez à parrainer vos confrères — chaque nouveau filleul abonné = 1 mois gratuit de plus !</p>
    <a href="${process.env.FRONTEND_URL}/referral.html" class="btn">Voir mon programme de parrainage →</a>
  `);

  return await resend.emails.send({
    from: FROM,
    to: email,
    subject: `🎁 Vous avez gagné ${rewardMonths} mois gratuit${rewardMonths > 1 ? 's' : ''} !`,
    html,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendTrialEndingEmail,
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendPasswordResetEmail,
  sendCancellationEmail,
  sendReferralRewardEmail,
};
