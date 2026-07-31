# Deploiement Vercel

## Architecture cible

- Frontend React/Vite servi par Vercel
- API Express exposee via fonctions Node.js sous `/api`
- Base de donnees PostgreSQL externe

## Fichiers prepares

- `vercel.json`
- `api/index.js`
- `api/[...route].js`
- `.env.production.example`
- `apps/api/.env.production.example`
- `apps/web/.env.production.example`

## Variables d'environnement a definir dans Vercel

### Backend

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `ACCESS_TOKEN_TTL`
- `REFRESH_TOKEN_TTL_DAYS`
- `APP_NAME`
- `COMPANY_NAME`
- `DEFAULT_CURRENCY`
- `WEB_URL`
- `CORS_ORIGINS`
- `COOKIE_DOMAIN`
- `SECURE_COOKIES`

### Frontend

- `VITE_API_URL=/api`

## Valeurs recommandees en production

```env
WEB_URL=https://votre-domaine.vercel.app
CORS_ORIGINS=https://votre-domaine.vercel.app,https://votre-preview.vercel.app
COOKIE_DOMAIN=
SECURE_COOKIES=true
VITE_API_URL=/api
```

## Variables exactes a coller dans Vercel

### Project Settings -> Environment Variables

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?schema=public
JWT_ACCESS_SECRET=remplacer-par-un-secret-long-et-unique
JWT_REFRESH_SECRET=remplacer-par-un-autre-secret-long-et-unique
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
APP_NAME=GDT Suite
COMPANY_NAME=Galerie des Tanneurs
DEFAULT_CURRENCY=MAD
WEB_URL=https://votre-domaine.vercel.app
CORS_ORIGINS=https://votre-domaine.vercel.app,https://votre-projet-git-branch.vercel.app
COOKIE_DOMAIN=
SECURE_COOKIES=true
VITE_API_URL=/api
```

### Variables optionnelles

```env
API_PORT=4000
WEB_PORT=5173
```

### A ne pas utiliser en production

- `VITE_API_PROXY_TARGET`
- une URL `localhost`
- `SECURE_COOKIES=false`

## Notes importantes

- L'application `gdt-suite` utilise PostgreSQL via Prisma. Il faut donc une base distante accessible depuis Vercel.
- Le cookie de refresh est force en `secure` en production.
- Le frontend appelle maintenant l'API en relatif (`/api`), ce qui simplifie les previews Vercel et la production.
- En local, Vite proxy automatiquement `/api` vers `http://localhost:4000`.

## Reglages Vercel conseilles

- Root Directory: `gdt-suite`
- Framework Preset: `Vite`
- Build Command: laisse `npm run build`
- Output Directory: gere par `vercel.json`
- Node.js Version: `20.x`

## Ordre de mise en ligne recommande

1. Creer une base PostgreSQL distante
2. Ajouter toutes les variables Vercel
3. Pointer le Root Directory sur `gdt-suite`
4. Lancer le premier deploy
5. Verifier `/api/health`
6. Tester la connexion et l'ouverture de session caisse

## Verification apres deploiement

1. Ouvrir `/`
2. Verifier `GET /api/health`
3. Tester la connexion
4. Verifier qu'un refresh de page sur une route interne React fonctionne
5. Verifier qu'un login pose bien le cookie de refresh en HTTPS
