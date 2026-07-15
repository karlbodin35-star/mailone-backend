# RAPPORT — Exécution autonome MailOne (15 juillet 2026)

## 1. Tâches réalisées (avec commits)

### Phase 1 — Fonctionnalités cœur
| Tâche | État | Commits |
|---|---|---|
| 1.1 Suivi des emails sans réponse | ✅ Fait | backend `4e77263`, site `1a78a3c` |
| 1.2 Extraction coordonnées + Carnet clients | ✅ Fait (table à créer, voir §3) | backend `38f4c32`, `e59d4fa`, site `1a78a3c` |
| 1.3 Dashboard triage split-screen dark | ✅ Déjà en prod avant ce lot | site `e61f146` et suivants |

**1.1 en détail** : ancienneté calculée côté serveur (`waitingDays` sur chaque mail),
dossier « ⏰ Sans réponse » dans la colonne latérale (compteur rouge), badge
vert/orange/rouge sur chaque mail en attente, **seuil configurable** (1/2/3/5/7 jours,
défaut 3, mémorisé par navigateur), bouton **« 📨 Brouillon de relance »** dans la vue
mail (brouillon local avec excuse pour le délai — jamais d'envoi automatique).

**1.2 en détail** : extraction nom/email/téléphone (normalisé 06…)/adresse française
depuis les mails entrants, à chaque chargement du dashboard, en tâche de fond.
**Seules les coordonnées sont stockées** (règle n°1 respectée), expéditeurs
machine (noreply/newsletter) exclus, déduplication par (user, email), les champs
découverts complètent la fiche sans jamais écraser. Vue « 👥 Carnet clients »
avec recherche et suppression.

### Phase 2 — Agents marketing & prospection
| Agent | État | Commits |
|---|---|---|
| 2.1 Contenu (Instagram/LinkedIn + suggestion visuelle) | ✅ | backend `87ea6bb`, site `5d063e9` |
| 2.2 Prospection (email + SMS + LinkedIn, brouillons only) | ✅ | idem |
| 2.3 Veille/relance (tableau prospects, relance suggérée J+4) | ✅ (table à créer, voir §3) | idem |

Page dédiée **`/agents`** (lien « 🧲 Prospection » dans la colonne du dashboard) :
3 onglets, boutons Copier partout, note explicite « aucun envoi automatique ».
Générateurs **locaux et gratuits** (aucun coût API) ; aucune spec d'agent
préexistante trouvée dans le repo.

### Phase 3 — Conformité & qualité
| Tâche | État | Commits |
|---|---|---|
| 3.1 Mentions légales LCEN | ✅ placeholders balisés | site `fde82b1` |
| 3.2 Audit (liens, syntaxe JS, placeholders) | ✅ tout vert | — |
| 3.2 Tests unitaires extraction + sans-réponse | ✅ 7 tests dédiés | backend `cc6abbd` |

**Suite de tests : 42 tests verts** (extraction contacts, normalisation téléphone,
détection sans réponse, buckets d'urgence, traduction 20 langues, dashboard,
mails, agenda, OAuth…). Sécurité : Helmet + CSP + rate-limiting déjà en place.
Hébergeurs renseignés en dur (Vercel + Supabase, données UE).

### Phase 4 — Préparé, NON activé
| Tâche | État | Commits |
|---|---|---|
| 4.1/4.2 Envoi réel Gmail API + re-consentement | ✅ code prêt, **flag OFF** | backend `d305a20` |

## 2. Blocages / décisions qui t'attendent

1. **Deux tables SQL à créer dans Supabase** (SQL Editor → Run) — sans elles,
   Carnet clients et Suivi prospects affichent une erreur propre mais ne stockent rien :
   ```sql
   create table if not exists contacts (
     id uuid primary key default uuid_generate_v4(),
     user_id uuid references users(id) on delete cascade,
     name text, email text not null, phone text, address text,
     first_seen timestamptz default now(), last_seen timestamptz default now(),
     unique(user_id, email)
   );
   create index if not exists idx_contacts_user on contacts(user_id, last_seen);

   create table if not exists prospects (
     id uuid primary key default uuid_generate_v4(),
     user_id uuid references users(id) on delete cascade,
     name text not null, metier text, ville text, canal text default 'email',
     statut text check (statut in ('a_contacter','contacte','relance','repondu','client','perdu')) default 'a_contacter',
     notes text, last_action_at timestamptz, created_at timestamptz default now()
   );
   create index if not exists idx_prospects_user on prospects(user_id, created_at);
   ```
2. **Clés Microsoft (Outlook)** — toujours en attente de ta création Azure
   (guide déjà fourni en conversation). Le bouton Outlook reste un cul-de-sac d'ici là.
3. **Crédits API Anthropic** épuisés — sans impact sur ce lot (tout est local/gratuit),
   mais l'assistant IA « premium » reste dégradé.
4. **Validation Google (scope restreint)** — nécessaire avant d'ouvrir Gmail
   au-delà de 100 utilisateurs tests, et indispensable pour `gmail.send` public.

## 3. Infos à me fournir (mentions légales)

Dans `legal.html`, remplace les balises :
- `[SIRET]` (2 occurrences) — ton numéro SIRET
- `[ADRESSE_SOCIETE]` — siège social de MailOne SAS
- `[DIRECTEUR_PUBLICATION]` — nom du dirigeant
- Hébergeurs : **déjà renseignés** (Vercel Inc. / Supabase, données UE)

## 4. Activer les features flaggées (Phase 4)

Envoi réel via l'API Gmail (voir `mailone-backend/docs/GMAIL_SEND_UPGRADE.md`) :
1. Ajouter le scope `gmail.send` dans `routes/oauth.js` + `routes/auth.js`
2. Déclarer le scope dans l'écran de consentement Google Cloud
3. `printf '%s' "true" | vercel env add ENABLE_SEND production` puis `vercel --prod`
4. Les utilisateurs existants recliquent « Connecter Gmail » (re-consentement,
   le flux `prompt=consent` est déjà en place) — sans ça, repli automatique
   sur le brouillon mailto, rien ne casse.

Retour arrière : supprimer `ENABLE_SEND`, redéployer.

---
*Règles produit vérifiées sur tout le lot : zéro contenu d'email stocké côté
serveur ; aucun envoi sans clic explicite de l'utilisateur.*
