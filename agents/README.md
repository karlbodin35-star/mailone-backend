# Agents marketing MailOne — zéro token, zéro IA

Trois agents en code pur (templates + règles). **Aucun appel LLM, coût : 0 €.**
Tout est **brouillon** : rien n'est jamais envoyé automatiquement.

## Lancer les agents

```bash
# 1. Agent Contenu — posts & stories (PNG + caption .txt)
node agents/contenu.js --type story --theme benefice
node agents/contenu.js --type post  --theme citation --metier plombier --ville Rennes
node agents/contenu.js --batch 10                     # mix thèmes/formats
# thèmes : citation · chiffre · benefice · avantapres · cta
# → output/posts/

# 2. Agent Prospection — brouillons email + SMS + LinkedIn
node agents/prospection.js                            # prospects « à contacter » (Supabase)
node agents/prospection.js --canal sms
node agents/prospection.js --offline --prenom Marc --metier plombier --ville Rennes
# → output/prospection/

# 3. Agent Relance — tableau + brouillons pour les relances dues
node agents/relance.js                                # règles J+3 / J+7 / J+15
node agents/relance.js --seuils 2,5,10                # seuils personnalisés
# → output/prospection/relance-*.txt
```

Le tableau de bord web (page `/agents` du site, réservé admin) utilise les
**mêmes règles** de relance via `agents/lib/relanceRules.js`.

## Ajouter un template visuel

`agents/templates/visuals.js` : ajouter une fonction `(W, H, data) → SVG`
dans `TEMPLATES`. Palette DA : fond `#07090F`, accent `#5B8CFF→#9F7BFF`,
glass `rgba(255,255,255,.04)`, ok `#3DD68C`, urgent `#FF5C5C`.
Utiliser `shell()` (fond + orbes + grille + logo) et `wrap()` (retour à la ligne).

## Enrichir la banque de textes

`agents/data/textes.json` : ajouter des entrées `{id, visuel, caption}` dans la
bonne catégorie (`id` unique — il sert à la rotation anti-répétition).
Variables disponibles : `{métier} {bénéfice} {chiffre} {ville}` (pools par
défaut dans `agents/lib/fill.js`).

`agents/data/prospection.json` : idem pour email/sms/linkedin/relance,
variables `{prénom} {métier} {ville} {taille}`.

## Rotation anti-répétition

Les ids utilisés sont mémorisés dans `agents/data/.used.json` (ignoré par git).
Quand une catégorie est épuisée, le cycle repart. Supprimer le fichier pour
réinitialiser.

## Tests

```bash
npm test -- tests/agents-module.test.js
```
Couvre : remplissage des variables, règles de dates, intégrité des banques
(100 textes / 15×3 templates), rendu SVG des 5 templates × 2 formats, et
génération d'un vrai PNG via sharp.
