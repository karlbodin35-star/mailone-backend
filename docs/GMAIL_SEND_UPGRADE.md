# Passage de `gmail.readonly` à `gmail.send` — guide d'activation

> État actuel : le code d'envoi est PRÊT (`lib/oauthHelpers.js → sendGmailReply`,
> branché dans `routes/mails.js`) mais DÉSACTIVÉ par le feature flag `ENABLE_SEND`.
> Tant que le flag est absent/false, les comptes Gmail OAuth reçoivent `501
> SEND_UNSUPPORTED` et le frontend bascule sur un brouillon mailto — l'utilisateur
> envoie lui-même. Règle produit n°2 respectée dans tous les cas : l'envoi n'a
> lieu QUE sur clic explicite de l'utilisateur.

## 1. Ajouter le scope dans le code OAuth

Dans `routes/oauth.js` (connexion boîte Gmail) et `routes/auth.js` (login Google),
remplacer le scope :

```
https://www.googleapis.com/auth/gmail.readonly
```
par :
```
https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send
```

## 2. Google Cloud Console

- Écran de consentement OAuth → section « Scopes » : ajouter `gmail.send`.
- En mode **Test** : rien d'autre à faire, les ~100 utilisateurs tests peuvent consentir.
- En production publique : `gmail.send` est un scope **restreint** → validation
  Google + évaluation de sécurité CASA (compter plusieurs semaines).

## 3. Re-consentement des utilisateurs existants

Les tokens déjà stockés n'ont PAS le droit d'envoi. Le flux `/api/oauth/gmail/start`
utilise déjà `prompt=consent` : il suffit que l'utilisateur reclique
« Connecter Gmail » (le dashboard affiche déjà ce bouton sur `SCOPE_MISSING`).

Séquence utilisateur existant :
1. Il clique « Envoyer » → le serveur tente `sendGmailReply` → Gmail répond 403
   (scope insuffisant) → `sendGmailReply` renvoie null → 501 → mailto (aucune casse).
2. Pour activer le vrai envoi : dashboard → reconnecter Gmail → cocher LES DEUX
   cases (lecture + envoi) sur l'écran Google.

## 4. Activer le flag

```
vercel env add ENABLE_SEND production   # valeur : true (via printf, sans \n !)
vercel --prod
```

Retour arrière instantané : supprimer la variable ou la passer à `false`, redéployer.
