# GDT Suite

Suite web professionnelle `stock + CRM + achats + ventes + POS/caisse`, construite pour continuer le même univers visuel premium sombre/orange que l'application actuelle.

## Stack

- Frontend: `React 18 + TypeScript + Vite`
- UI: `Tailwind CSS + composants maison`
- Backend: `Node.js + Express + TypeScript`
- Base de données: `PostgreSQL`
- ORM: `Prisma`
- Auth: `JWT + refresh token + rôles + permissions`
- Charts: `Recharts`
- Base locale: `Docker Compose`

## Arborescence finale

```text
gdt-suite/
  apps/
    api/
      src/
        common/
        config/
        modules/
          auth/
          customers/
          dashboard/
          inventory/
          pos/
          products/
          purchases/
          reports/
          sales/
          settings/
          suppliers/
          users/
    web/
      src/
        app/
        components/
          layout/
          ui/
        features/
          auth/
          customers/
          dashboard/
          inventory/
          pos/
          products/
          purchases/
          reports/
          sales/
          settings/
          suppliers/
          users/
        lib/
        providers/
        styles/
  prisma/
    schema.prisma
    seed.ts
  docs/
    ARCHITECTURE.md
    ROADMAP.md
  docker-compose.yml
  package.json
  .env.example
```

## Modules déjà livrés dans la V1

- Authentification sécurisée avec login/logout, JWT, refresh token, rôles et permissions
- Dashboard multi-boutiques avec KPI, graphiques, top produits et activité récente
- Gestion produits avec prix HT/TTC, TVA, stock, statuts et référentiels
- Référentiels `Type produit`, `Catégorie produit`, `Transporteurs`
- CRM clients avec fidélité, segmentation simple et historique de CA
- Fournisseurs
- Achats fournisseurs:
  - Bon de commande
  - Bon de réception
  - base UI pour facture fournisseur
  - base UI pour avoir fournisseur
- Stock:
  - alertes
  - mouvements
  - ajustements
- Ventes:
  - liste
  - statuts
  - annulation contrôlée
- POS / caisse:
  - recherche produit
  - panier
  - client
  - vendeur
  - multi-modes de paiement
  - génération ticket
- Rapports:
  - ventes par boutique
  - valorisation stock
  - top produits
  - alertes stock
- Paramètres société
- Utilisateurs
- Journal d’audit backend

## Menu métier actuellement posé

- `Tableau de bord`
- `Gestion`
  - `Produits`
  - `Type produit`
  - `Catégorie produit`
  - `Fournisseurs`
  - `Clients`
  - `Transporteurs`
- `Achat`
  - `Bon de commande`
  - `Bon de réception`
  - `Avoir fournisseur`
  - `Facture fournisseur`
- `Stock`
- `Ventes`
- `POS / Caisse`
- `Rapports`
- `Utilisateurs`
- `Paramètres`

## Commandes exactes d'installation sous Windows

Depuis le dossier [gdt-suite](C:/xampp/htdocs/order_app/gdt-suite):

```powershell
cd C:\xampp\htdocs\order_app\gdt-suite
Copy-Item .env.example .env
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env
```

Lancer PostgreSQL avec Docker:

```powershell
docker compose up -d postgres
```

Installer les dépendances:

```powershell
npm install
```

Initialiser Prisma et les données de démonstration:

```powershell
npm run db:push
npm run db:seed
```

Lancer frontend + backend:

```powershell
npm run dev
```

## URLs locales

- Frontend: [http://localhost:5180](http://localhost:5180)
- API: [http://localhost:4000/api](http://localhost:4000/api)
- Healthcheck: [http://localhost:4000/api/health](http://localhost:4000/api/health)

## Comptes de démonstration

- `admin@gdt.local` / `Admin123!`
- `manager@gdt.local` / `Manager123!`
- `caissier@gdt.local` / `Cashier123!`
- `vendeur@gdt.local` / `Seller123!`

## Parcours prioritaire déjà prêt à brancher

1. Se connecter
2. Voir le dashboard
3. Créer des produits
4. Créer un fournisseur
5. Créer un bon de commande
6. Valider un bon de réception
7. Ajuster le stock
8. Encaisser via la caisse POS
9. Voir les ventes
10. Voir les rapports

## Prochaines améliorations recommandées

- gestion complète des variantes `taille / couleur`
- transferts magasin -> magasin et dépôt -> magasin
- inventaire physique guidé
- ouverture / clôture de caisse UI complète
- tickets suspendus et reprise panier
- retours clients, remboursements et bons d’avoir
- factures fournisseurs et avoirs fournisseurs complets
- PDF / impression ticket et rapports
- upload logo et images produits
- notifications temps réel
- tests automatiques frontend/backend
- CI/CD et durcissement production

