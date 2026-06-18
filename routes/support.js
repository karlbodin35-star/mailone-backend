// ══════════════════════════════════════════════════════════════
// MAILONE — MAX : Agent Support Autonome (sans API externe)
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const rateLimit = require('express-rate-limit');
const { sanitize } = require('../lib/security');

const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Trop de messages. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Base de connaissances ─────────────────────────────────────
const KB = [
  {
    id: 'greeting',
    patterns: ['bonjour', 'salut', 'hello', 'bonsoir', 'hey', 'coucou', 'allo', 'yo'],
    reply: `Bonjour ! Je suis MAX, l'assistant MailOne. Je peux vous aider avec les fonctionnalités, les tarifs, la connexion email, la sécurité ou les problèmes courants.\n\nQu'est-ce que je peux faire pour vous ?`,
  },
  {
    id: 'who',
    patterns: ['qui es-tu', 'qui es tu', 'tu es qui', "c'est quoi max", 'tu es quoi', 'tu fais quoi', 'tu es un robot', 'ia ou humain', 'bot'],
    reply: `Je suis MAX, l'assistant support de MailOne. Je suis un agent IA intégré directement dans l'application, disponible 24h/24.\n\nPour les cas complexes, je vous oriente vers support@mailone.app — réponse humaine sous 24h ouvrées.`,
  },
  {
    id: 'pricing',
    patterns: ['tarif', 'prix', 'plan', 'plans', 'combien', 'cout', 'abonnement', 'solo', 'team', 'enterprise', 'payer', 'facturation', 'offre', 'formule', 'moins cher', 'cher'],
    reply: `MailOne propose un plan unique :\n\n• MailOne Solo — 14,99€/mois HT — 1 boîte mail, toutes fonctionnalités incluses, 500 réponses IA/mois\n\nEssai gratuit 14 jours, sans carte bancaire.\nAbonnement annuel : 149,90€/an (2 mois offerts).`,
  },
  {
    id: 'free_trial',
    patterns: ['essai', 'gratuit', '14 jours', 'tester', 'essayer', 'sans carte', 'sans engagement', 'periode essai', 'trial'],
    reply: `L'essai gratuit dure 14 jours sur tous les plans, sans carte bancaire requise.\n\nVous accédez à toutes les fonctionnalités du plan choisi. À la fin des 14 jours, vous choisissez de continuer ou non — aucun prélèvement automatique.`,
  },
  {
    id: 'how_it_works',
    patterns: ['comment ca marche', 'comment fonctionne', "c'est quoi mailone", 'a quoi ca sert', 'presentation', 'presente', 'explique', 'kesako', 'kézako'],
    reply: `MailOne est un gestionnaire de mails intelligent pour artisans et PME françaises.\n\nConcrètement :\n• Vos emails sont triés automatiquement (Urgences, Devis, RDV, Factures)\n• L'IA génère des réponses professionnelles adaptées à votre métier\n• L'agenda intègre les RDV et détecte les conflits de créneaux\n• L'IA détecte votre activité à la première connexion (plombier, avocat, médecin…)\n• Toutes les données sont chiffrées AES-256`,
  },
  {
    id: 'features',
    patterns: ['fonctionnalite', 'feature', 'options', 'capacite', 'que fait', 'ce qu il fait', 'tout ce que'],
    reply: `Les fonctionnalités principales de MailOne :\n\n• Tri automatique des emails par catégorie\n• Réponses professionnelles générées par l'IA (Agent IA Pro)\n• Calendrier 24H avec gestion des conflits\n• Chat interne entre collègues (plans Team & Enterprise)\n• Agenda partagé (plans Team & Enterprise)\n• Chiffrement AES-256-GCM de toutes les données\n• Conformité RGPD totale, données hébergées en Europe`,
  },
  {
    id: 'team_feature',
    patterns: ['equipe', 'team feature', 'collegues', 'collaborateurs', 'membres', 'inviter', 'invitation', 'siege', 'chat interne', 'partage'],
    reply: `La fonctionnalité Équipe est disponible sur les plans Team (10 sièges) et Enterprise (50 sièges).\n\n• Invitations par email depuis le panel "Mon Équipe"\n• Chat interne en temps réel entre collègues\n• Agenda partagé visible par toute l'équipe\n• Le propriétaire gère les sièges (ajouter / retirer des membres)\n\nLe nombre de sièges est strict : exactement 10 pour Team, 50 pour Enterprise.`,
  },
  {
    id: 'calendar',
    patterns: ['calendrier', 'agenda', 'rendez-vous', 'rdv', 'creneau', 'planning', 'schedule', 'horaire'],
    reply: `MailOne intègre un calendrier intelligent :\n\n• Détection automatique des RDV dans vos emails\n• Vérification des conflits de créneaux\n• Proposition d'horaires alternatifs\n• Vue 24H de votre journée\n• Agenda partagé avec l'équipe (plans Team & Enterprise)`,
  },
  {
    id: 'ai_replies',
    patterns: ['reponse ia', 'generer reponse', 'rediger', 'agent ia', 'agent pro', 'automatique', 'automatiquement', 'quota', 'limite ia', 'quota ia'],
    reply: `L'Agent IA Pro génère des réponses professionnelles adaptées à votre métier.\n\nQuota de réponses IA selon le plan :\n• Solo : 500 / mois\n• Team : 2 000 / mois\n• Enterprise : 5 000 / mois\n\nSi le quota est atteint, vous pouvez continuer à rédiger manuellement. Le compteur se remet à zéro le 1er du mois.`,
  },
  {
    id: 'security',
    patterns: ['securite', 'donnees', 'chiffrement', 'rgpd', 'confidentialite', 'confidentiel', 'prive', 'hacker', 'pirate', 'aes', 'protection', 'vie privee'],
    reply: `MailOne prend la sécurité très au sérieux :\n\n• Chiffrement AES-256-GCM bout-en-bout\n• Zéro revente de données, jamais\n• Données hébergées en Europe (Supabase EU)\n• Conformité RGPD totale\n• Suppression immédiate et complète à la résiliation\n\nAucun tiers ne peut accéder à vos emails.`,
  },
  {
    id: 'cancel',
    patterns: ['annuler', 'resilier', 'arreter', 'supprimer mon compte', 'desabonner', 'resiliation', 'quitter', 'partir'],
    reply: `Pour résilier votre abonnement :\n\n1. Connectez-vous à MailOne\n2. Allez dans Mon Compte → Abonnement → Résilier\n3. Confirmez la résiliation\n\nVos données sont supprimées immédiatement et définitivement. Aucun prélèvement supplémentaire.`,
  },
  {
    id: 'data_after_cancel',
    patterns: ['donnees apres', 'donnees si resilie', 'que devient', "qu'arrive", 'supprime', 'suppression', 'resiliation donnees', 'recuperer donnees'],
    reply: `En cas de résiliation, toutes vos données sont supprimées immédiatement et définitivement : emails, réponses, historique, informations de compte.\n\nIl n'y a aucune période de rétention. Une fois résilié, rien ne subsiste sur nos serveurs.`,
  },
  {
    id: 'login_issue',
    patterns: ['connexion impossible', 'pas connecter', 'login', 'mot de passe oublie', 'identifiant', 'acces impossible', 'oublie mot de passe', 'reinitialiser', 'lien expire'],
    reply: `Si vous n'arrivez pas à vous connecter :\n\n1. Vérifiez l'adresse email et le mot de passe\n2. Cliquez sur "Mot de passe oublié" sur la page de connexion\n3. Consultez vos spams si l'email n'arrive pas\n4. Le lien de réinitialisation expire après 1 heure\n\nSi le problème persiste : support@mailone.app`,
  },
  {
    id: 'email_connect',
    patterns: ['boite mail', 'gmail', 'outlook', 'imap', 'connecter mail', 'synchroniser', 'sync email', 'hotmail', 'ovh mail', 'orange mail'],
    reply: `MailOne fonctionne avec votre propre compte email via IMAP.\n\nComptes compatibles :\n• Gmail (avec mot de passe d'application Google)\n• Outlook / Hotmail\n• OVH / Orange / SFR\n• Tout serveur IMAP standard\n\nPour connecter votre boîte mail, allez dans Mon Compte → Connexion Email et suivez les instructions.`,
  },
  {
    id: 'invitation_not_received',
    patterns: ['invitation non recue', 'invit', 'invitation equipe', 'mail equipe pas recu', 'pas recu invitation'],
    reply: `Si vous n'avez pas reçu l'invitation d'équipe :\n\n1. Vérifiez vos spams / courrier indésirable\n2. Demandez au propriétaire de renvoyer l'invitation depuis Mon Équipe\n3. Vérifiez que l'adresse email est correcte\n\nToujours rien ? Écrivez à support@mailone.app`,
  },
  {
    id: 'annual_discount',
    patterns: ['annuel', 'mensuel', 'reduction', 'economie', 'annuellement', 'par an', 'par mois'],
    reply: `MailOne propose deux fréquences de facturation :\n\n• Mensuel : flexibilité totale, sans engagement\n• Annuel : réduction significative par rapport au mensuel (économisez plusieurs mois)\n\nPour voir les tarifs exacts, rendez-vous sur mailone.app.`,
  },
  {
    id: 'contact',
    patterns: ['contact', 'joindre', 'humain', 'personne reelle', 'equipe support', 'email support', 'aide humaine'],
    reply: `Pour contacter l'équipe MailOne :\n\n📧 support@mailone.app\nRéponse garantie sous 24h ouvrées.\n\nPour les urgences techniques, précisez votre adresse email et décrivez le problème en détail.`,
  },
  {
    id: 'sync_issue',
    patterns: ['synchronisation', 'sync', 'pas a jour', 'emails pas charges', 'mails pas charges', 'chargement', 'lent'],
    reply: `Si vos emails ne se synchronisent pas :\n\n1. Vérifiez votre connexion internet\n2. Reconnectez votre boîte mail dans Mon Compte → Connexion Email\n3. Vérifiez que les identifiants IMAP sont corrects (le mot de passe d'application pour Gmail)\n\nSi le problème persiste : support@mailone.app`,
  },
  {
    id: 'craft',
    patterns: ['artisan', 'pme', 'plombier', 'electricien', 'avocat', 'medecin', 'comptable', 'btp', 'metier', 'profession'],
    reply: `MailOne s'adapte automatiquement à votre métier.\n\nÀ la première connexion, l'IA détecte votre activité (plombier, avocat, médecin, comptable, BTP…) et adapte les modèles de réponses et les catégories d'emails à votre secteur.\n\nPlus besoin de configurer quoi que ce soit manuellement.`,
  },
];

// ── Normaliser le texte ───────────────────────────────────────
function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Trouver la meilleure réponse ─────────────────────────────
function findBestMatch(message) {
  const msg = normalize(message);

  let bestScore = 0;
  let bestEntry = null;

  for (const entry of KB) {
    let score = 0;
    for (const pattern of entry.patterns) {
      const norm = normalize(pattern);
      if (msg.includes(norm)) {
        score += norm.split(' ').length * 2; // phrases multi-mots = plus de poids
      } else {
        // correspondance partielle mot par mot
        const words = norm.split(' ');
        for (const w of words) {
          if (w.length > 3 && msg.includes(w)) score += 1;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestScore > 0 ? bestEntry : null;
}

// ── POST /api/support/chat ────────────────────────────────────
router.post('/chat', supportLimiter, async (req, res) => {
  try {
    const message = sanitize(req.body.message || '').trim();

    if (!message) return res.status(400).json({ error: 'Message requis.' });
    if (message.length > 1000) return res.status(400).json({ error: 'Message trop long.' });

    const match = findBestMatch(message);

    const reply = match
      ? match.reply
      : `Je ne suis pas certain de comprendre votre question. Pourriez-vous la reformuler ?\n\nJe peux vous aider sur :\n• Les fonctionnalités de MailOne\n• Les tarifs et abonnements\n• La connexion à votre boîte mail\n• La sécurité et le RGPD\n• Les problèmes courants\n\nOu contactez directement support@mailone.app pour une aide personnalisée.`;

    res.json({ reply });

  } catch (err) {
    console.error('Support chat error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur interne.' });
  }
});

module.exports = router;
