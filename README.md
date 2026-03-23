# Project World News

Carte mondiale des tensions geopolitique en temps reel, alimentee par plusieurs sources de donnees (NewsAPI/GNews, GDELT, ACLED), avec une API Node.js, une interface web Next.js et une application mobile Expo.

## Objectif

Le projet vise a:
- collecter des evenements geopolitique recents;
- normaliser et dedoublonner les donnees;
- calculer des scores pays pour visualiser les zones de tension;
- exposer les donnees via API et interfaces client (web/mobile).

## Stack Technique

- Monorepo npm workspaces
- API: Node.js, Express, PostgreSQL, PostGIS
- Web: Next.js, React, TypeScript, MapLibre
- Mobile: React Native, Expo
- DevOps local: Docker Compose

## Architecture

- apps/api: ingestion, normalisation, scoring, endpoints REST
- apps/web: visualisation interactive de la carte et des evenements
- apps/mobile: application mobile Expo

## Lancement Rapide

### 1) Installer les dependances

```bash
npm install
```

### 2) Demarrer la base de donnees

```bash
docker compose up -d
```

### 3) Configurer l'API

Copier le fichier d'exemple:

```bash
copy apps\api\.env.example apps\api\.env
```

Puis renseigner les variables necessaires dans apps/api/.env.

### 4) Lancer web + api

```bash
npm run dev
```

## Scripts Utiles

- npm run dev: lance API et Web en parallele
- npm run dev:api: lance uniquement l'API
- npm run dev:web: lance uniquement le Web
- npm run dev:mobile: lance le client mobile Expo
- npm run build:web: build de production du web

Ingestion cote API:

- npm --prefix apps/api run ingest:gdelt
- npm --prefix apps/api run ingest:acled
- npm --prefix apps/api run ingest:news
- npm --prefix apps/api run ingest:all

## Qualite & Bonnes Pratiques

- Separation claire des responsabilites (ingestion, services, repositories)
- Suite de tests Node.js sur le coeur de la logique API
- Variables d'environnement externalisees
- Endpoint admin protege par token
- Fallback data pour assurer la continuite en mode local

## Notes Securite

- Ne jamais versionner de secrets reels.
- Utiliser uniquement des placeholders dans les fichiers d'exemple.
- En cas de fuite de cle, faire une rotation immediate cote fournisseur.

## Roadmap Courte

- Ajouter CI (tests + lint) sur pull requests
- Ajouter un guide contribution (CONTRIBUTING)
- Ajouter snapshots visuels web/mobile pour la documentation
