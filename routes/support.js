// ══════════════════════════════════════════════════════════════
// MAILONE — Support IA : chatbot d'aide disponible sans connexion
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { sanitize } = require('../lib/security');

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de messages. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const SYSTEM_PROMPT = `Tu es MAX, l'assistant support intelligent de MailOne.

PRÉSENTATION DE MAILONE :
MailOne est un gestionnaire de mails intelligent pour artisans et PME françaises.
L'IA analyse, catégorise et génère des réponses professionnelles automatiquement.

FONCTIONNALITÉS PRINCIPALES :
- Tri automatique des mails en catégories : Urgences, Devis, Rendez-vous, Factures
- Génération de réponses professionnelles par l'IA (Agent MailOne Pro)
- Calendrier 24H avec détection de conflits et proposition de créneaux
- Assistante IA intégrée dans la boîte mail (résumés, recherche, analyses)
- Détection automatique du métier à la première connexion (plombier, avocat, médecin…)
- Chiffrement AES-256-GCM de toutes les données

PLANS ET TARIFS :
- Solo : 1 utilisateur, 500 réponses IA/mois
- Team : 10 utilisateurs, 2000 réponses IA/mois, chat interne, calendrier partagé
- Enterprise : 50 utilisateurs, 5000 réponses IA/mois, toutes les fonctionnalités
- Essai gratuit 14 jours sur tous les plans, sans carte bancaire
- Abonnement mensuel ou annuel (réduction sur l'annuel)

FONCTIONNALITÉ ÉQUIPE (plans Team & Enterprise) :
- Nombre de sièges strict : exactement 10 pour Team, 50 pour Enterprise
- Invitations par email depuis le panel "Mon Équipe"
- Chat interne entre collègues en temps réel
- Agenda partagé : les RDVs partagés sont visibles par toute l'équipe
- Le propriétaire gère les sièges (ajouter/retirer des membres)

SÉCURITÉ & RGPD :
- Chiffrement bout-en-bout AES-256-GCM
- Zéro revente de données, jamais
- Suppression totale et immédiate à la résiliation de l'abonnement
- Conformité RGPD totale — données hébergées en Europe (Supabase EU)

PROBLÈMES COURANTS ET SOLUTIONS :
- Connexion impossible : vérifier email/mot de passe, utiliser "Mot de passe oublié"
- Quota IA atteint : l'agent local reste disponible sans limite, quota remis à zéro le 1er du mois
- Invitation non reçue : vérifier les spams, le propriétaire peut renvoyer depuis le panel Équipe
- Données non synchronisées : l'app fonctionne avec votre propre compte email (Gmail, Outlook…) en connexion IMAP/OAuth
- Annulation : depuis Mon Compte → Abonnement → Résilier. Données supprimées immédiatement.

CONTACT HUMAIN :
Si le problème n'est pas résolu : support@mailone.app — réponse sous 24h ouvrées.

RÈGLES :
- Réponds en français naturel et concis (max 120 mots sauf question complexe)
- Sois direct et utile — pas de blabla
- Si tu ne sais pas : oriente vers support@mailone.app
- Ne mentionne jamais Claude, Anthropic, GPT ou OpenAI
- Si on demande qui tu es : "Je suis MAX, l'assistant support de MailOne."`;

// ── POST /api/support/chat ────────────────────────────────
router.post('/chat', supportLimiter, async (req, res) => {
  try {
    const message  = sanitize(req.body.message || '').trim();
    const history  = (req.body.history || []).slice(-8); // max 8 échanges précédents

    if (!message) return res.status(400).json({ error: 'Message requis.' });
    if (message.length > 1000) return res.status(400).json({ error: 'Message trop long.' });

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        stream: true,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
    res.end();

  } catch (err) {
    console.error('Support chat error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur du support IA.' });
  }
});

module.exports = router;
