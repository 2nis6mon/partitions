<!-- bmad:context -->
<!-- Vérifié le 2026-10-23, dépôt sans commit (aucun SHA). Géré par bmad-project-context ; le contenu entre ces marqueurs est remplacé à chaque refresh. Écrire hors des marqueurs ce qui doit être conservé. -->

## partitions

Web-app personnelle pour lire une partition de piano sur iPad (Safari, ajoutée à l'écran d'accueil) : métronome, curseur, notes jouées colorées en rouge. Serveur Node/Express sur le Mac, front en JavaScript sans build, rendu par OpenSheetMusicDisplay (OSMD), conversion PDF → MusicXML par Audiveris. Usage décrit dans `README.md` ; documents de planification dans `_bmad-output/`.

## Règles

- Ne jamais supprimer, renommer ni écraser un fichier de `scores/` : ce sont les partitions de l'utilisateur, absentes de git donc irrécupérables. Pour tester, importer une partition nouvelle et ne supprimer que celle-là.

## Où sont les choses

- Import et conversion Audiveris : `server.js` (`/api/upload`, `runAudiveris`) ; fichiers temporaires dans `.work/`.
- Lecture, métronome, curseur, reprises : `public/app.js` (`buildSteps`, `computeTimes`, `tick`).

## Lancer et vérifier

- Aucun test automatisé : `npm test` échoue volontairement. Vérifier avec `npm start` puis `http://localhost:3000`.
- La validation finale se fait sur un vrai iPad, ce qu'un agent ne peut pas faire : terminer chaque changement visible en indiquant à l'utilisateur quoi tester sur l'iPad (son, toucher, défilement, rotation).

## Écarts avec les conventions habituelles

- `public/` est servi tel quel, sans bundler ni transpilation : écrire du JavaScript que Safari exécute directement, sans `import` de paquets npm. Une bibliothèque front se sert comme OSMD, via une route statique dans `server.js` et une balise `<script>`.
- `public/app.js` utilise des API internes d'OSMD (`cursor.Iterator`, `GNotesUnderCursor`, `getSVGGElement`) : ne pas mettre à jour `opensheetmusicdisplay` sans revérifier le curseur, la coloration et le toucher sur une note.
- Sur iPad, l'audio ne démarre qu'à la suite d'un geste de l'utilisateur : `audio()` doit rester appelé depuis un gestionnaire de clic ou de toucher, jamais au chargement ni dans un minuteur.

<!-- /bmad:context -->
