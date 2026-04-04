# 🚀 Guide de déploiement MailOne — De zéro à en ligne

## Ce dont vous aurez besoin

- Un compte **GitHub** (gratuit) — github.com
- Un compte **Supabase** (gratuit) — supabase.com
- Un compte **Stripe** — stripe.com
- Un compte **Vercel** (gratuit) — vercel.com
- Un compte **Resend** (gratuit) — resend.com
- Un domaine (optionnel) — ~10€/an sur namecheap.com

**Temps estimé : 2-3 heures pour un premier déploiement**

---

## ÉTAPE 1 — Supabase (base de données)

### 1.1 Créer le projet

1. Allez sur **app.supabase.com** → "New project"
2. Choisissez un nom : `mailone-prod`
3. Choisissez une région : **Europe (Frankfurt)** pour le RGPD
4. Notez le mot de passe de base de données

### 1.2 Créer le schéma

1. Dans votre projet Supabase → **SQL Editor** → "New query"
2. Copiez-collez tout le contenu de `supabase-schema.sql`
3. Cliquez **Run**
4. Vérifiez que les tables `users`, `subscriptions`, `referrals` sont créées

### 1.3 Récupérer les clés

Supabase → **Settings** → **API** :
- `Project URL` → votre `SUPABASE_URL`
- `anon / public` → votre `SUPABASE_ANON_KEY`
- `service_role / secret` → votre `SUPABASE_SERVICE_ROLE_KEY`

⚠️ La `service_role` key ne doit JAMAIS être exposée côté frontend.

---

## ÉTAPE 2 — Stripe (paiements)

### 2.1 Créer les produits

Dans **Stripe Dashboard** → **Produits** → "Ajouter un produit" :

**Produit 1 : MailOne Solo**
- Ajouter un tarif mensuel : 99,00€ / mois → notez le `price_XXXX`
- Ajouter un tarif annuel : 990,00€ / an → notez le `price_XXXX`

**Produit 2 : MailOne Équipe**
- Ajouter un tarif mensuel : 900,00€ / mois → notez le `price_XXXX`
- Ajouter un tarif annuel : 9 000,00€ / an → notez le `price_XXXX`

**Produit 3 : MailOne Entreprise**
- Ajouter un tarif mensuel : 1 780,00€ / mois → notez le `price_XXXX`
- Ajouter un tarif annuel : 17 800,00€ / an → notez le `price_XXXX`

### 2.2 Récupérer les clés API

Stripe Dashboard → **Développeurs** → **Clés API** :
- `Clé secrète` → votre `STRIPE_SECRET_KEY` (commence par `sk_live_` en prod)

### 2.3 Configurer le portail client

Stripe Dashboard → **Paramètres** → **Portail client** :
- Activez "Permettre aux clients de mettre à jour leur abonnement"
- Activez "Permettre aux clients d'annuler leur abonnement"
- Sauvegardez

### 2.4 Configurer les webhooks (après déploiement)

Une fois votre backend déployé sur Vercel :

Stripe Dashboard → **Développeurs** → **Webhooks** → "Ajouter un endpoint" :
- URL : `https://votre-backend.vercel.app/api/stripe/webhook`
- Événements à écouter :
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Notez le `Signing secret` → votre `STRIPE_WEBHOOK_SECRET`

---

## ÉTAPE 3 — Resend (emails)

1. Créez un compte sur **resend.com**
2. **Domaines** → "Add domain" → entrez votre domaine (ex: `mailone.app`)
3. Suivez les instructions pour ajouter les enregistrements DNS chez votre registrar
4. Une fois le domaine vérifié → **API Keys** → "Create API key"
5. Notez votre `RESEND_API_KEY`

---

## ÉTAPE 4 — Déployer le backend sur Vercel

### 4.1 Pousser sur GitHub

```bash
cd mailone-backend
git init
git add .
git commit -m "MailOne backend initial"
git branch -M main
git remote add origin https://github.com/VOTRE_USERNAME/mailone-backend.git
git push -u origin main
```

### 4.2 Déployer sur Vercel

1. Allez sur **vercel.com** → "New Project"
2. Importez votre repository GitHub `mailone-backend`
3. Framework Preset : **Other**
4. Root Directory : `.` (racine)
5. Cliquez **Deploy**

### 4.3 Configurer les variables d'environnement

Dans Vercel → votre projet → **Settings** → **Environment Variables** :

Ajoutez TOUTES les variables de `.env.example` avec vos vraies valeurs :

| Variable | Valeur |
|---|---|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://mailone.app` |
| `JWT_SECRET` | (clé aléatoire 64 chars) |
| `SUPABASE_URL` | (depuis Supabase) |
| `SUPABASE_ANON_KEY` | (depuis Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | (depuis Supabase) |
| `STRIPE_SECRET_KEY` | (depuis Stripe) |
| `STRIPE_WEBHOOK_SECRET` | (depuis Stripe webhooks) |
| `STRIPE_PRICE_SOLO_MONTHLY` | (Price ID Stripe) |
| `STRIPE_PRICE_SOLO_ANNUAL` | (Price ID Stripe) |
| `STRIPE_PRICE_TEAM_MONTHLY` | (Price ID Stripe) |
| `STRIPE_PRICE_TEAM_ANNUAL` | (Price ID Stripe) |
| `STRIPE_PRICE_ENT_MONTHLY` | (Price ID Stripe) |
| `STRIPE_PRICE_ENT_ANNUAL` | (Price ID Stripe) |
| `RESEND_API_KEY` | (depuis Resend) |
| `EMAIL_FROM` | `MailOne <noreply@mailone.app>` |
| `EMAIL_SUPPORT` | `support@mailone.app` |
| `ANTHROPIC_API_KEY` | (depuis console.anthropic.com) |

Redéployez après avoir ajouté les variables.

**Votre API sera disponible sur** : `https://mailone-backend.vercel.app`

---

## ÉTAPE 5 — Déployer le frontend

### 5.1 Mettre à jour les URLs dans le frontend

Dans `mailone.js` et dans les pages HTML, remplacez :
```javascript
const API_URL = 'http://localhost:3000';
// par :
const API_URL = 'https://mailone-backend.vercel.app';
```

### 5.2 Déployer sur Vercel (ou Netlify)

Option A — **Vercel** :
```bash
cd mailone-site
vercel deploy --prod
```

Option B — **Netlify** (drag & drop) :
1. netlify.com → "Add new site" → "Deploy manually"
2. Glissez-déposez votre dossier `mailone-site`

### 5.3 Configurer votre domaine

Dans Vercel/Netlify → **Domains** → "Add domain" → `mailone.app`
Suivez les instructions DNS chez votre registrar.

---

## ÉTAPE 6 — Connecter le frontend au backend

Dans vos fichiers HTML, remplacez les appels `localStorage` par des appels API :

**Exemple — Inscription :**
```javascript
// Avant (localStorage)
localStorage.setItem('mailone_user', JSON.stringify({name, email, plan}));

// Après (vraie API)
const res = await fetch('https://votre-api.vercel.app/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ firstName, lastName, email, password, plan, billing })
});
const data = await res.json();
if (data.token) {
  localStorage.setItem('mailone_token', data.token);
  localStorage.setItem('mailone_user', JSON.stringify(data.user));
  window.location.href = 'success.html';
}
```

---

## ÉTAPE 7 — Tester en production

### Checklist avant le lancement :

- [ ] `https://votre-api.vercel.app/health` répond `{"status":"ok"}`
- [ ] Inscription avec un vrai email fonctionne
- [ ] Email de bienvenue reçu
- [ ] Connexion fonctionne
- [ ] Paiement Stripe test (carte `4242 4242 4242 4242`)
- [ ] Email de confirmation de paiement reçu
- [ ] Portail client Stripe accessible depuis Mon Compte
- [ ] Webhook Stripe déclenche bien la mise à jour en base
- [ ] HTTPS sur le frontend et le backend
- [ ] Mentions légales avec vraies informations (SIRET, adresse)

---

## RÉCAPITULATIF DES COÛTS

| Service | Coût |
|---|---|
| Vercel (backend + frontend) | **Gratuit** |
| Supabase (jusqu'à 500 users) | **Gratuit** |
| Resend (jusqu'à 3 000 emails/mois) | **Gratuit** |
| Stripe | **1,5% + 0,25€** par transaction |
| Domaine (namecheap) | **~10€/an** |
| **Total au lancement** | **~10€/an** |

---

## SUPPORT

Un problème ? Contactez : support@mailone.app

Documentation Supabase : docs.supabase.com
Documentation Stripe : stripe.com/docs
Documentation Vercel : vercel.com/docs
Documentation Resend : resend.com/docs

---

## ÉTAPE 8 — Passer Stripe en mode LIVE (production réelle)

### 8.1 Activer le mode live

Dans Stripe Dashboard → cliquez sur le toggle **"Test"** en haut à gauche pour passer en **"Live"**.

⚠️ En mode live, les vrais euros sont débités.

### 8.2 Recréer vos produits en mode live

Les produits et Price IDs que vous avez créés en mode test **ne fonctionnent pas** en mode live. Vous devez les recréer :

1. Stripe Live Dashboard → **Produits** → créez les mêmes 3 produits
2. Notez les nouveaux Price IDs live (commencent par `price_live_...`)
3. Dans Vercel → **Settings → Environment Variables** → mettez à jour les 6 `STRIPE_PRICE_*`
4. Mettez à jour `STRIPE_SECRET_KEY` avec votre clé live (`sk_live_...`)

### 8.3 Reconfigurer le webhook en live

Dans Stripe Live Dashboard → **Développeurs → Webhooks** :
- Créez un nouveau webhook avec la même URL backend
- Notez le nouveau `Signing secret` live
- Mettez à jour `STRIPE_WEBHOOK_SECRET` dans Vercel

### 8.4 Tester avec une vraie carte

Faites un paiement test avec votre propre carte bancaire (1€) pour vérifier :
- Le paiement est bien enregistré dans Stripe
- L'email de confirmation est reçu
- Le statut en base Supabase passe bien à `active`
- Le portail client fonctionne

### 8.5 Checklist mode live

- [ ] Clé secrète live configurée (`sk_live_...`)
- [ ] 6 Price IDs live dans les variables Vercel
- [ ] Webhook live configuré avec le bon signing secret
- [ ] Test paiement réussi avec vraie carte
- [ ] Email de confirmation reçu
- [ ] Portail Stripe accessible depuis Mon Compte
- [ ] Mentions légales complètes (SIRET, adresse, dirigeant)
- [ ] CGV avec politique de remboursement
- [ ] SSL/HTTPS actif sur le domaine
- [ ] Page 404 configurée sur votre hébergeur

---

## ✅ Vous êtes prêt à lancer !

Félicitations — MailOne est maintenant un vrai SaaS prêt à encaisser ses premiers clients.

**Récapitulatif de ce que vous avez :**
- Frontend complet : 15+ pages HTML
- Backend Node.js : auth, paiements, emails, IA
- Base de données Supabase sécurisée
- Stripe avec abonnements, trials 14j, portail client
- 7 emails transactionnels automatiques
- Programme de parrainage
- Dashboard admin
- Blog SEO
- RGPD conforme
