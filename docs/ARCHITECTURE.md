# Architecture

## Structure

- `apps/api`: API REST sécurisée, logique métier, Prisma, audit
- `apps/web`: interface admin + POS
- `prisma`: modèle de données unifié
- `packages/types`: types partagés

## Principes

- backend stateless avec JWT access token + refresh token
- permissions granulaires dérivées des rôles
- audit log pour actions critiques
- stock géré par mouvements + stock courant produit
- multi-boutiques via `warehouses` de type `STORE`
- POS dédié avec sessions de caisse
