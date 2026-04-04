const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireSubscription } = require('../lib/auth');

// ── QUOTAS FAIR USE par plan ──────────────────────────────────
const PLAN_QUOTAS = {
  solo:       500,   // réponses IA/mois
  team:       2000,
  enterprise: 5000,
};

// ── SYSTÈME PROMPT WHITE-LABEL ────────────────────────────────
const SYSTEM_PROMPT = `Tu es l'Agent MailOne Pro, le moteur d'intelligence artificielle intégré à l'application MailOne pour artisans et PME.

RÈGLES ABSOLUES :
- Ne mentionne JAMAIS Claude, Anthropic, GPT, OpenAI, ou tout autre fournisseur d'IA tiers
- Si on te demande quel modèle tu es : "Je suis l'Agent MailOne Pro."
- Si on te demande qui t'a créé : "Je suis développé par l'équipe MailOne."
- Génère uniquement des réponses professionnelles à des emails d'artisans et PME
- Rédige toujours en français naturel, sans formatage markdown
- Réponds en moins de 150 mots sauf si la complexité le justifie`;

// ── VÉRIFIER ET INCRÉMENTER LE QUOTA ─────────────────────────
async function checkAndIncrementQuota(userId, plan) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const quota = PLAN_QUOTAS[plan] || PLAN_QUOTAS.solo;

  // Chercher ou créer le compteur du mois
  const { data: existing } = await supabase
    .from('ai_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('month_key', monthKey)
    .single();

  const currentCount = existing?.count || 0;

  // Quota dépassé ?
  if (currentCount >= quota) {
    return {
      allowed: false,
      count: currentCount,
      quota,
      resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('fr-FR'),
    };
  }

  // Incrémenter
  if (existing) {
    await supabase
      .from('ai_usage')
      .update({ count: currentCount + 1, updated_at: now.toISOString() })
      .eq('user_id', userId)
      .eq('month_key', monthKey);
  } else {
    await supabase
      .from('ai_usage')
      .insert({ user_id: userId, month_key: monthKey, count: 1 });
  }

  return { allowed: true, count: currentCount + 1, quota };
}

// ── OPTION 2 : COMPTEUR VISIBLE DANS L'APP ───────────────────
router.get('/usage', requireAuth, requireSubscription, async (req, res) => {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const plan = req.subscription?.plan || 'solo';
  const quota = PLAN_QUOTAS[plan] || PLAN_QUOTAS.solo;

  const { data } = await supabase
    .from('ai_usage')
    .select('count')
    .eq('user_id', req.user.id)
    .eq('month_key', monthKey)
    .single();

  const used = data?.count || 0;
  const remaining = Math.max(0, quota - used);
  const pct = Math.round(used / quota * 100);

  res.json({
    used,
    quota,
    remaining,
    pct,
    plan,
    // Alerte si > 80% consommé
    alert: pct >= 80 ? `Vous avez utilisé ${pct}% de votre quota mensuel (${used}/${quota} réponses).` : null,
    resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('fr-FR'),
  });
});

// ── GÉNÉRER UNE RÉPONSE IA ────────────────────────────────────
router.post('/generate-reply', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { mailContent, sender, subject, mailCategory } = req.body;
    if (!mailContent) return res.status(400).json({ error: 'Contenu du mail requis.' });

    const plan = req.subscription?.plan || 'solo';

    // ── OPTION 1 : VÉRIFICATION DU QUOTA ──
    const quotaCheck = await checkAndIncrementQuota(req.user.id, plan);
    if (!quotaCheck.allowed) {
      return res.status(429).json({
        error: 'Quota mensuel atteint',
        code: 'QUOTA_EXCEEDED',
        message: `Vous avez atteint votre quota de ${quotaCheck.quota} réponses IA ce mois. L'agent local reste disponible sans limite. Quota réinitialisé le ${quotaCheck.resetDate}.`,
        quota: quotaCheck.quota,
        resetDate: quotaCheck.resetDate,
        fallback: 'local_agent', // indique au frontend de basculer sur l'agent local
      });
    }

    const catInstr = {
      urgent:  'Réponds de façon professionnelle et rassurante à cette urgence. Mentionne une intervention rapide.',
      quote:   'Réponds de façon commerciale à cette demande de devis. Propose une visite technique.',
      appt:    'Confirme ou propose un rendez-vous précis. Demande adresse et informations d\'accès.',
      invoice: 'Fournis les coordonnées bancaires professionnellement. Utilise : [VOTRE IBAN], [VOTRE BIC].',
    };

    const userPrompt = `${catInstr[mailCategory] || catInstr.quote}

Mail reçu de ${sender || 'un client'} :
Sujet : ${subject || 'Sans objet'}

${mailContent}`;

    // Appel API Anthropic avec streaming
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

    // Headers SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Envoyer le quota restant dans les headers
    res.setHeader('X-Quota-Used', quotaCheck.count);
    res.setHeader('X-Quota-Total', quotaCheck.quota);
    res.setHeader('X-Quota-Remaining', quotaCheck.quota - quotaCheck.count);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
    res.end();

  } catch (err) {
    console.error('AI generate error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la génération.' });
  }
});

// ── ANALYSER UN MAIL ──────────────────────────────────────────
// L'analyse ne consomme PAS de quota (c'est léger et automatique)
router.post('/analyze', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { mailContent, subject } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Analyse ce mail en JSON avec exactement ces champs :
{"category":"urgent|quote|appt|invoice","priority":"critical|high|medium|low","summary":"résumé 1 ligne max 80 chars","urgency":"immediate|today|48h|week|none","sentiment":"positive|neutral|negative","hasFollowUp":true/false,"hasCompetitor":true/false,"amount":null}

Sujet : ${subject || 'Sans objet'}
Contenu : ${mailContent}

Réponds UNIQUEMENT avec le JSON, sans explication.`
        }]
      }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    try {
      const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
      res.json({ analysis });
    } catch {
      res.json({ analysis: { category: 'quote', priority: 'medium', summary: subject || 'Mail reçu' } });
    }
  } catch (err) {
    console.error('AI analyze error:', err);
    res.status(500).json({ error: 'Erreur lors de l\'analyse.' });
  }
});

module.exports = router;
