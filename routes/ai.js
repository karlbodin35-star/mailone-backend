// ══════════════════════════════════════════════════════════════
// MAILONE — Agent IA Hybride
// Priorité : agents locaux → Anthropic en dernier recours
// Le quota ne se consomme QUE lors d'un appel Anthropic
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireSubscription } = require('../lib/auth');

const PLAN_QUOTAS = { solo: 500, team: 2000, enterprise: 5000 };

const SYSTEM_PROMPT = `Tu es l'Agent MailOne Pro, le moteur d'intelligence artificielle intégré à l'application MailOne pour artisans et PME.

RÈGLES ABSOLUES :
- Ne mentionne JAMAIS Claude, Anthropic, GPT, OpenAI, ou tout autre fournisseur d'IA tiers
- Si on te demande quel modèle tu es : "Je suis l'Agent MailOne Pro."
- Si on te demande qui t'a créé : "Je suis développé par l'équipe MailOne."
- Génère uniquement des réponses professionnelles à des emails d'artisans et PME
- Rédige toujours en français naturel, sans formatage markdown
- Réponds en moins de 150 mots sauf si la complexité le justifie`;

// ════════════════════════════════════════════════════════════
// AGENT LOCAL — extrait dans lib/localAgent.js (réutilisé par /api/dashboard)
// ════════════════════════════════════════════════════════════
const { normalize, localGenerateReply, localAnalyze } = require('../lib/localAgent');

// ════════════════════════════════════════════════════════════
// AGENT LOCAL — CHAT BOÎTE MAIL
// ════════════════════════════════════════════════════════════

function localChat(message, mailsContext) {
  const msg = normalize(message);
  const mails = mailsContext || [];

  // Résumé global
  if (/\b(resume|recapitulatif|apercu|situation|boite|bilan|vue)\b/.test(msg)) {
    const cats = { urgent: 0, quote: 0, appt: 0, invoice: 0 };
    mails.forEach(m => { if (cats[m.cat] !== undefined) cats[m.cat]++; });
    const followCount = mails.filter(m => m.follow || m.hasFollowUp).length;
    return {
      reply: `Résumé de votre boîte (${mails.length} emails) :\n\n• ${cats.urgent} urgence${cats.urgent !== 1 ? 's' : ''}\n• ${cats.quote} devis\n• ${cats.appt} rendez-vous\n• ${cats.invoice} facture${cats.invoice !== 1 ? 's' : ''}\n• ${followCount} relance${followCount !== 1 ? 's' : ''} en attente`,
      confident: true,
    };
  }

  // Relances
  if (/\b(relance|attente|attend|pas repondu|sans reponse)\b/.test(msg)) {
    const list = mails.filter(m => m.follow || m.hasFollowUp);
    if (list.length === 0) return { reply: 'Aucune relance en attente. Vous êtes à jour !', confident: true };
    const items = list.slice(0, 5).map(m => `• ${m.sender} — "${m.subject}"`).join('\n');
    return { reply: `${list.length} relance${list.length !== 1 ? 's' : ''} en attente :\n\n${items}${list.length > 5 ? `\n…et ${list.length - 5} autres.` : ''}`, confident: true };
  }

  // Urgences
  if (/\b(urgent|urgence|priorite|critique|important)\b/.test(msg)) {
    const list = mails.filter(m => m.cat === 'urgent');
    if (list.length === 0) return { reply: 'Aucune urgence en ce moment. Bonne nouvelle !', confident: true };
    const items = list.slice(0, 5).map(m => `• ${m.sender} — "${m.subject}"`).join('\n');
    return { reply: `${list.length} urgence${list.length !== 1 ? 's' : ''} :\n\n${items}`, confident: true };
  }

  // Devis
  if (/\b(devis|demande de prix|estimation)\b/.test(msg)) {
    const list = mails.filter(m => m.cat === 'quote');
    if (list.length === 0) return { reply: 'Aucune demande de devis en attente.', confident: true };
    const items = list.slice(0, 5).map(m => `• ${m.sender} — "${m.subject}"`).join('\n');
    return { reply: `${list.length} demande${list.length !== 1 ? 's' : ''} de devis :\n\n${items}`, confident: true };
  }

  // Factures
  if (/\b(facture|paiement|virement|reglement)\b/.test(msg)) {
    const list = mails.filter(m => m.cat === 'invoice');
    if (list.length === 0) return { reply: 'Aucune facture détectée dans votre boîte.', confident: true };
    const items = list.slice(0, 5).map(m => `• ${m.sender} — "${m.subject}"`).join('\n');
    return { reply: `${list.length} email${list.length !== 1 ? 's' : ''} facture :\n\n${items}`, confident: true };
  }

  // Comptage général
  if (/\b(combien|nombre|total|count)\b/.test(msg)) {
    return { reply: `Votre boîte contient actuellement ${mails.length} email${mails.length !== 1 ? 's' : ''} chargé${mails.length !== 1 ? 's' : ''}.`, confident: true };
  }

  // Recherche par expéditeur
  const senderMatch = msg.match(/\b(?:de|avec|par|depuis|envoye par)\s+([a-z]{3,}(?:\s+[a-z]{3,})?)/);
  if (senderMatch) {
    const query = senderMatch[1];
    const found = mails.filter(m =>
      normalize(m.sender || '').includes(query) ||
      normalize(m.senderEmail || '').includes(query)
    );
    if (found.length > 0) {
      const items = found.slice(0, 5).map(m => `• "${m.subject}" (${m.date || 'date inconnue'})`).join('\n');
      return { reply: `${found.length} email${found.length !== 1 ? 's' : ''} de ${found[0].sender} :\n\n${items}`, confident: true };
    }
    if (mails.length > 0) return { reply: `Je n'ai pas trouvé d'email de "${senderMatch[1]}" dans votre boîte.`, confident: true };
  }

  // Dernier email
  if (/\b(dernier|dernier email|plus recent|recent)\b/.test(msg)) {
    if (mails.length === 0) return { reply: 'Votre boîte est vide ou non synchronisée.', confident: true };
    const last = mails[0];
    return { reply: `Dernier email reçu : "${last.subject}" de ${last.sender}${last.date ? ` le ${last.date}` : ''}.`, confident: true };
  }

  // Pas confiant → fallback Anthropic
  return { reply: null, confident: false };
}

// ════════════════════════════════════════════════════════════
// QUOTA — seulement consommé lors d'un appel Anthropic
// ════════════════════════════════════════════════════════════

async function checkAndIncrementQuota(userId, plan) {
  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const quota    = PLAN_QUOTAS[plan] || PLAN_QUOTAS.solo;

  const { data: existing } = await supabase
    .from('ai_usage').select('count')
    .eq('user_id', userId).eq('month_key', monthKey).single();

  const currentCount = existing?.count || 0;
  if (currentCount >= quota) {
    return { allowed: false, count: currentCount, quota, resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('fr-FR') };
  }

  if (existing) {
    await supabase.from('ai_usage').update({ count: currentCount + 1, updated_at: now.toISOString() }).eq('user_id', userId).eq('month_key', monthKey);
  } else {
    await supabase.from('ai_usage').insert({ user_id: userId, month_key: monthKey, count: 1 });
  }
  return { allowed: true, count: currentCount + 1, quota };
}

// SSE pour réponse locale (format compatible frontend)
function sendLocalSSE(res, text, extra = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Source', 'local');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`);
  res.write('data: {"type":"message_stop"}\n\n');
  res.end();
}

// Appel Anthropic streaming (fallback)
async function callAnthropic(res, systemPrompt, messages, maxTokens = 600, quotaHeaders = {}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) throw new Error(`Anthropic ${response.status}`);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Source', 'anthropic');
  Object.entries(quotaHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(decoder.decode(value));
  }
  res.end();
}

// ════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════

// ── GET /api/ai/usage ─────────────────────────────────────────
router.get('/usage', requireAuth, requireSubscription, async (req, res) => {
  const now      = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const plan     = req.subscription?.plan || 'solo';
  const quota    = PLAN_QUOTAS[plan] || PLAN_QUOTAS.solo;

  const { data } = await supabase.from('ai_usage').select('count').eq('user_id', req.user.id).eq('month_key', monthKey).single();
  const used      = data?.count || 0;
  const remaining = Math.max(0, quota - used);
  const pct       = Math.round(used / quota * 100);

  res.json({
    used, quota, remaining, pct, plan,
    alert: pct >= 80 ? `Vous avez utilisé ${pct}% de votre quota mensuel (${used}/${quota} réponses IA).` : null,
    resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('fr-FR'),
    note: 'Les réponses générées localement ne consomment pas de quota.',
  });
});

// ── POST /api/ai/generate-reply ───────────────────────────────
router.post('/generate-reply', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { mailContent, sender, subject, mailCategory } = req.body;
    if (!mailContent) return res.status(400).json({ error: 'Contenu du mail requis.' });

    const plan = req.subscription?.plan || 'solo';

    // 1. Agent local
    const local = localGenerateReply(mailContent, sender, subject, mailCategory);
    if (local.confident) {
      return sendLocalSSE(res, local.reply);
    }

    // 2. Anthropic en fallback (quota consommé seulement ici)
    const quotaCheck = await checkAndIncrementQuota(req.user.id, plan);
    if (!quotaCheck.allowed) {
      // Quota épuisé → on renvoie quand même la réponse locale
      return sendLocalSSE(res, local.reply);
    }

    const catInstr = {
      urgent:  'Réponds de façon professionnelle et rassurante à cette urgence. Mentionne une intervention rapide.',
      quote:   'Réponds de façon commerciale à cette demande de devis. Propose une visite technique.',
      appt:    'Confirme ou propose un rendez-vous précis. Demande adresse et informations d\'accès.',
      invoice: 'Fournis les coordonnées bancaires professionnellement. Utilise : [VOTRE IBAN], [VOTRE BIC].',
    };

    try {
      await callAnthropic(res, SYSTEM_PROMPT, [{
        role: 'user',
        content: `${catInstr[mailCategory] || catInstr.quote}\n\nMail reçu de ${sender || 'un client'} :\nSujet : ${subject || 'Sans objet'}\n\n${mailContent}`,
      }], 600, {
        'X-Quota-Used': quotaCheck.count,
        'X-Quota-Total': quotaCheck.quota,
        'X-Quota-Remaining': quotaCheck.quota - quotaCheck.count,
      });
    } catch (anthropicErr) {
      console.error('Anthropic fallback failed, using local:', anthropicErr.message);
      if (!res.headersSent) sendLocalSSE(res, local.reply);
    }

  } catch (err) {
    console.error('generate-reply error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la génération.' });
  }
});

// ── POST /api/ai/analyze ──────────────────────────────────────
// N'utilise PAS Anthropic — toujours local
router.post('/analyze', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { mailContent, subject } = req.body;
    const analysis = localAnalyze(mailContent, subject);
    res.json({ analysis, source: 'local' });
  } catch (err) {
    console.error('analyze error:', err.message);
    res.status(500).json({ error: 'Erreur lors de l\'analyse.' });
  }
});

// ── POST /api/ai/chat ─────────────────────────────────────────
router.post('/chat', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { message, history = [], mailsContext = [], userName = '' } = req.body;
    if (!message) return res.status(400).json({ error: 'Message requis.' });

    const plan = req.subscription?.plan || 'solo';

    // 1. Agent local
    const local = localChat(message, mailsContext);
    if (local.confident) {
      return sendLocalSSE(res, local.reply);
    }

    // 2. Anthropic en fallback
    const quotaCheck = await checkAndIncrementQuota(req.user.id, plan);
    if (!quotaCheck.allowed) {
      return sendLocalSSE(res, `Je ne suis pas en mesure de répondre précisément à cette question. Votre quota mensuel de ${quotaCheck.quota} réponses IA est atteint.\n\nPour les questions simples sur votre boîte, je reste disponible sans limite.`);
    }

    const mailboxCtx = mailsContext.length > 0
      ? mailsContext.map((m, i) => `[${i + 1}] De: ${m.sender} | Sujet: "${m.subject}" | Catégorie: ${m.cat}${m.follow ? ' | ⚠️ RELANCE' : ''}`).join('\n')
      : 'Boîte vide ou non synchronisée.';

    const systemPrompt = `Tu es l'Assistante MailOne Pro, l'IA personnelle de ${userName || 'l\'utilisateur'} intégrée à sa boîte mail professionnelle.

BOÎTE MAIL (${mailsContext.length} emails) :
${mailboxCtx}

RÈGLES :
- Ne mentionne JAMAIS Claude, Anthropic, GPT, OpenAI
- Si on demande qui tu es : "Je suis l'Assistante MailOne Pro"
- Réponds en français naturel et concis
- Cite les noms et détails précis des emails quand pertinent
- Sois directe et utile`;

    try {
      await callAnthropic(res, systemPrompt, [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ], 1024, {
        'X-Quota-Remaining': quotaCheck.quota - quotaCheck.count,
      });
    } catch (anthropicErr) {
      console.error('Anthropic chat fallback failed:', anthropicErr.message);
      if (!res.headersSent) {
        sendLocalSSE(res, `Je ne peux pas répondre précisément à cette question pour le moment. Essayez de reformuler ou posez-moi une question sur vos urgences, devis, relances ou rendez-vous.`);
      }
    }

  } catch (err) {
    console.error('AI chat error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la conversation.' });
  }
});

// ── POST /api/ai/translate-mail ───────────────────────────────
// Mail en anglais → traduction FR du mail + réponse EN + traduction FR
// de la réponse. Consomme 1 unité de quota (appel Anthropic).
router.post('/translate-mail', requireAuth, requireSubscription, async (req, res) => {
  try {
    const { subject, body, sender } = req.body;
    if (!body && !subject) return res.status(400).json({ error: 'Contenu requis.' });

    const plan = req.subscription?.plan || 'solo';
    const quotaCheck = await checkAndIncrementQuota(req.user.id, plan);
    if (!quotaCheck.allowed) {
      return res.status(429).json({ error: 'Quota IA mensuel atteint.', code: 'QUOTA_EXCEEDED' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `Tu aides un artisan français qui a reçu cet email. Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans markdown.

Email de "${sender || 'un contact'}" — Sujet : "${(subject || '').slice(0, 200)}"
${(body || '').slice(0, 1200)}

Si l'email est principalement EN ANGLAIS, renvoie :
{"lang":"en","mailFr":"traduction française fidèle et naturelle de l'email","reply":"réponse professionnelle EN ANGLAIS au nom de l'artisan (3-4 phrases, concrète, sans markdown)","replyFr":"traduction française de cette réponse"}

Si l'email est en français (ou autre), renvoie : {"lang":"fr"}`,
        }],
      }),
    });

    if (!response.ok) throw new Error('Anthropic ' + response.status);
    const data = await response.json();
    const raw  = (data.content?.[0]?.text || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON invalide');
    res.json(JSON.parse(jsonMatch[0]));

  } catch (err) {
    console.error('translate-mail error:', err.message);
    res.status(500).json({ error: 'Traduction indisponible pour le moment.' });
  }
});

// ── POST /api/ai/demo-analyze ─────────────────────────────────
// Public (no auth) — quick JSON analysis for the demo page
router.post('/demo-analyze', async (req, res) => {
  try {
    const { metier, sender, subject, body } = req.body;
    if (!subject && !body) return res.status(400).json({ error: 'Contenu requis.' });

    const metierDesc = {
      plombier:    'plombier/chauffagiste',
      electricien: 'électricien',
      pme:         'responsable PME',
    }[metier] || 'artisan';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
        messages: [{
          role: 'user',
          content: `Analyse cet email pour un ${metierDesc}. Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans markdown.

Email de "${sender}", sujet: "${subject}"
Corps: ${(body || '').slice(0, 600)}

Format JSON requis (respecte exactement ces valeurs possibles) :
{"categorie":"urgent|devis|rdv|facture","badge":"🚨 Urgent|📋 Devis|📅 RDV|💰 Facture","badgeColor":"#C0392B|#1D4ED8|#2A7A50|#B45309","priorite":"🔴 Critique|🔥 Commercial|🟢 Planification|🟡 Admin","delai":"Immédiat|Aujourd'hui|< 48h|Cette semaine","action":"verbe + objet en 5 mots max","ton":"Rassurant|Commercial|Expert|Formel|Cordial","resume":"résumé factuel en 12 mots max"}`,
        }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = await response.json();
    const raw  = (data.content?.[0]?.text || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON invalide');
    res.json(JSON.parse(jsonMatch[0]));

  } catch (err) {
    console.error('Demo analyze error:', err.message);
    // Fallback local
    const text   = ((req.body.subject || '') + ' ' + (req.body.body || '')).toLowerCase();
    const isUrgent  = /urgent|panne|fuite|sos|panne/.test(text);
    const isDevis   = /devis|tarif|prix|budget|offre/.test(text);
    const isRdv     = /rendez-vous|rdv|créneau|disponible/.test(text);
    const isFacture = /facture|règlement|virement|iban/.test(text);
    const cat = isUrgent ? 'urgent' : isDevis ? 'devis' : isRdv ? 'rdv' : isFacture ? 'facture' : 'devis';
    const map = {
      urgent:  { badge:'🚨 Urgent',  badgeColor:'#C0392B', priorite:'🔴 Critique',    delai:'Immédiat',      action:'Appeler et intervenir',    ton:'Rassurant' },
      devis:   { badge:'📋 Devis',   badgeColor:'#1D4ED8', priorite:'🔥 Commercial',  delai:'< 48h',         action:'Proposer une visite',      ton:'Commercial' },
      rdv:     { badge:'📅 RDV',     badgeColor:'#2A7A50', priorite:'🟢 Planification',delai:'Cette semaine', action:'Confirmer le créneau',     ton:'Cordial' },
      facture: { badge:'💰 Facture', badgeColor:'#B45309', priorite:'🟡 Admin',       delai:'Aujourd\'hui',  action:'Envoyer les coordonnées',  ton:'Pro' },
    };
    res.json({ categorie: cat, resume: (req.body.subject || '').slice(0, 60), ...map[cat] });
  }
});

// ── POST /api/ai/demo-reply ───────────────────────────────────
// Public (no auth) — generates reply JSON for the demo page
// Non-streaming to avoid Vercel SSE constraints; frontend simulates typing
router.post('/demo-reply', async (req, res) => {
  try {
    const { metier, sender, subject, body, ton, categorie } = req.body;
    if (!subject && !body) return res.status(400).json({ error: 'Contenu requis.' });

    const metierDesc = {
      plombier:    'plombier/chauffagiste',
      electricien: 'électricien',
      pme:         'responsable PME',
    }[metier] || 'artisan';

    const catInstr = {
      urgent:  "C'est une URGENCE. Réponds de façon rassurante, mentionne ta disponibilité immédiate.",
      devis:   "C'est une demande de DEVIS. Réponds commercialement, propose une visite technique.",
      rdv:     "C'est une demande de RDV. Confirme ta disponibilité, demande les informations nécessaires.",
      facture: "C'est une question de FACTURATION. Réponds professionnellement et fournis ce qui est demandé.",
    };

    const systemPrompt = `Tu es un ${metierDesc} français professionnel qui répond à ses emails.
Ton à adopter : ${ton || 'Professionnel'}.
${catInstr[categorie] || catInstr.devis}
Règles strictes :
- Français naturel et direct
- Aucun markdown, aucun astérisque, aucun tiret décoratif
- 3 à 5 paragraphes courts
- Commence par "Bonjour," et le prénom si disponible
- Termine par "Cordialement," puis une ligne vide puis ton prénom et nom fictifs cohérents avec le métier
- Sois concret et utile, pas vague`;

    const userMessage = `Email reçu de ${sender || 'un client'} :\nSujet : ${subject || 'Sans objet'}\n\n${body || subject}`;

    let reply = '';

    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        console.error('Anthropic demo-reply error:', anthropicRes.status, errText);
        throw new Error('Anthropic ' + anthropicRes.status);
      }

      const data = await anthropicRes.json();
      reply = data.content?.[0]?.text || '';

    } catch (anthropicErr) {
      console.error('demo-reply Anthropic fallback:', anthropicErr.message);
      // Local fallback
      const local = localGenerateReply(body || subject, sender, subject, categorie);
      reply = local.reply;
    }

    res.json({ reply });

  } catch (err) {
    console.error('Demo reply error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur lors de la génération.' });
  }
});

module.exports = router;
