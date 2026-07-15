# RAPPORT — Agents marketing zéro token (15 juillet 2026)

**Règle absolue respectée : aucun appel IA nulle part.** Templates SVG, banques
de textes rédigées à la main, règles de dates en code pur. Coût d'exploitation : **0 €**.
Tout est brouillon — aucun envoi automatique, jamais.

## 1. Ce qui a été fait (commits dans mailone-backend)

| Livrable | Détail | Commit |
|---|---|---|
| Socle du module | `agents/lib/` : fill (variables+pools), rotation anti-répétition (`.used.json`), règles de relance J+3/7/15 configurables · sharp en devDependency · `output/` gitignoré | `feat: socle module agents` |
| Banques de contenus | **100 textes de posts** (20 × 5 catégories : citation, chiffre, bénéfice, avant/après, CTA) + **45 templates de prospection** (15 × email/SMS/LinkedIn) + 7 templates de relance — variables `{métier} {ville} {prénom} {taille} {bénéfice} {chiffre}` | `feat: banques de textes` |
| **Agent Contenu** | 5 templates SVG reprenant la DA exacte (fond #07090F, orbes floues, grille, glass, dégradé #5B8CFF→#9F7BFF, logo, glow) → PNG via sharp · formats story 1080×1920 et post 1080×1080 · CLI `--type/--theme/--metier/--ville/--batch` · rotation intelligente | `feat: agent contenu` |
| **Agent Prospection** | Brouillons personnalisés depuis la table `prospects` (ou `--offline`) · sortie `output/prospection/*.txt` · zéro envoi | `feat: agent prospection` |
| **Agent Relance** | Tableau console (prospect, statut, dernière action, prochaine relance) · brouillons pour les relances dues · seuils `--seuils 3,7,15` · **mêmes règles branchées dans le dashboard web** `/agents` (onglet Suivi, réservé admin) | `feat: agent relance` |
| Qualité | 11 tests (variables, dates J+3/7/15, intégrité des banques 100/45, SVG 5×2 formats, **vrai PNG vérifié par signature**) → **53 tests verts au total** · `agents/README.md` complet | `chore: tests + README agents` |

## 2. Exemples générés (réels, dans `output/`)

**3 posts** (PNG + caption) :
- `2026-07-15-chi-12-post.png` — chiffre clé « 1 clic / pour relancer un client » (1080×1080)
- `2026-07-15-ava-01-story.png` — avant/après « 21 h : encore 14 mails » → « 21 h : boîte vide depuis 18 h » (1080×1920, vérifié visuellement : DA conforme)
- `2026-07-15-cta-20-post.png` — CTA « Le soir, on ferme la boîte » + bouton dégradé

**2 brouillons prospection** :

> **Email (Marc, plombier, Rennes)** — Objet : *Vos confrères de Rennes gagnent du temps* — « Bonjour Marc, Les artisans qui répondent en premier décrochent les chantiers — à Rennes comme ailleurs. MailOne vous met dans cette position tous les jours […] 14 jours gratuits : https://mailone.app »

> **SMS (Julie, électricienne, Nantes)** — « Bonjour Julie ! MailOne : l'appli mail pensée pour les electriciens (gros boutons, 3 écrans, tout en français). 2 clics pour brancher votre Gmail : mailone.app — [PRÉNOM] »

## 3. Blocages / décisions qui t'attendent

1. **`[VOTRE PRÉNOM]` / `[PRÉNOM]`** dans les signatures de prospection : donne-moi
   ton prénom d'expéditeur et je le mets en dur (ou en variable d'env).
2. **Fontes** : les PNG utilisent Space Grotesk/DM Sans si installées sur la machine,
   sinon repli propre sur Segoe UI/Arial (c'est le cas actuellement — rendu vérifié,
   très correct). Pour un rendu 100 % identique au site : installer les 2 fontes
   Google sur le poste qui génère (double-clic sur les .ttf), rien à changer au code.
3. **Accord singulier/pluriel** des métiers dans certains templates
   (« les electriciens » sans accent si tu tapes `--metier electricien`) : mets
   l'accent dans le flag (`--metier électricien`) ou dis-moi d'ajouter une table
   de correction.
4. Rien d'autre — pas de credential requis, pas d'API, pas de coût.
