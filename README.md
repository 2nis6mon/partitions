# Partitions — suivi de partition pour iPad

Web-app à ouvrir dans Safari sur l'iPad : elle convertit une partition de piano PDF en partition
interactive, joue un métronome et fait avancer un curseur en colorant en rouge les notes jouées.

## Installation (sur le Mac, une seule fois)

1. **Audiveris** (reconnaissance optique de partitions, gratuit) : télécharger le `.dmg` macOS sur
   https://github.com/Audiveris/audiveris/releases et glisser l'app dans `/Applications`.
   Autre emplacement : lancer le serveur avec `AUDIVERIS_CMD=/chemin/vers/Audiveris npm start`.
2. `npm install`

## Utilisation

```
npm start
```

Le terminal affiche l'adresse à ouvrir sur l'iPad (ex. `http://192.168.1.20:3000`). L'iPad et le Mac
doivent être sur le même Wi-Fi. Dans Safari : Partager → « Sur l'écran d'accueil » pour l'avoir comme une app.

- ☰ Bibliothèque : importer un PDF (converti par Audiveris, 1 à 3 min) ou directement un MusicXML (`.mxl`, `.musicxml`).
- ▶ / ❚❚ : lecture / pause. Un décompte d'une mesure précède le départ (désactivable).
- ⏮ : retour au début. Toucher une note pour démarrer à cet endroit.
- BPM : tempo du métronome, 80 par défaut, mémorisé pour chaque partition. L'unité est celle du
  chiffrage (noire en 4/4, croche en 6/8).
- Les reprises sont suivies automatiquement.

## Limites

- La qualité de la reconnaissance dépend du PDF : un PDF exporté d'un logiciel de notation donne de
  bons résultats, un scan flou beaucoup moins. Si une partition existe en MusicXML (MuseScore, IMSLP…),
  préférez-la.
- Le curseur suit le métronome, pas ce que vous jouez réellement.
- Activez le son de l'iPad : le mode silencieux est contourné sur iPadOS 16.4+, mais pas sur les versions plus anciennes.
