import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import {
  PrismaClient,
  PaymentDirection,
  PaymentMethod,
  ProductStatus,
  PurchaseStatus,
  SaleStatus,
  StockMovementType,
  WarehouseType
} from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env"), override: true });
const prisma = new PrismaClient();

const permissionMap = {
  dashboard_view: "Voir dashboard",
  products_manage: "Gérer articles",
  customers_manage: "Gérer clients",
  suppliers_manage: "Gérer fournisseurs",
  purchases_manage: "Gérer achats",
  inventory_manage: "Gérer stock",
  sales_manage: "Gérer ventes",
  pos_use: "Utiliser la caisse",
  reports_view: "Voir rapports",
  settings_manage: "Gérer paramètres",
  users_manage: "Gérer utilisateurs",
  audit_view: "Voir logs",
  cash_manage: "Gérer caisse"
} as const;

async function seedRoles() {
  const allPermissions = await Promise.all(
    Object.entries(permissionMap).map(([code, label]) =>
      prisma.permission.upsert({
        where: { code },
        update: { label },
        create: { code, label }
      })
    )
  );

  const roleDefinitions = {
    admin: Object.keys(permissionMap),
    manager: [
      "dashboard_view",
      "products_manage",
      "customers_manage",
      "suppliers_manage",
      "purchases_manage",
      "inventory_manage",
      "sales_manage",
      "reports_view",
      "cash_manage"
    ],
    operateur_commandes: ["sales_manage"],
    caissier: ["dashboard_view", "customers_manage", "sales_manage", "pos_use", "cash_manage"],
    vendeur: ["dashboard_view", "customers_manage", "sales_manage", "reports_view"]
  } as const;

  for (const [name, codes] of Object.entries(roleDefinitions)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { label: name.charAt(0).toUpperCase() + name.slice(1) },
      create: { name, label: name.charAt(0).toUpperCase() + name.slice(1) }
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const code of codes) {
      const permission = allPermissions.find((item) => item.code === code)!;
      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }
}

async function seedCoreData() {
  const units = await Promise.all([
    prisma.unit.upsert({ where: { name: "PiÃƒÆ’Ã‚Â¨ce" }, update: { symbol: "pc" }, create: { name: "PiÃƒÆ’Ã‚Â¨ce", symbol: "pc" } }),
    prisma.unit.upsert({ where: { name: "MÃƒÆ’Ã‚Â¨tre" }, update: { symbol: "m" }, create: { name: "MÃƒÆ’Ã‚Â¨tre", symbol: "m" } })
  ]);

  await prisma.unit.deleteMany({
    where: {
      OR: [
        { symbol: "pc", name: { not: "PiÃƒÆ’Ã‚Â¨ce" } },
        { symbol: "m", name: { not: "MÃƒÆ’Ã‚Â¨tre" } }
      ]
    }
  });

  const [typeFashion, typeAccessories] = await Promise.all([
    prisma.productType.upsert({ where: { name: "Mode" }, update: {}, create: { name: "Mode" } }),
    prisma.productType.upsert({ where: { name: "Accessoires" }, update: {}, create: { name: "Accessoires" } })
  ]);

  const [catSac, catVetement, catChaussure] = await Promise.all([
    prisma.productCategory.upsert({ where: { name: "Sacs" }, update: {}, create: { name: "Sacs" } }),
    prisma.productCategory.upsert({ where: { name: "VÃƒÆ’Ã‚Âªtements" }, update: {}, create: { name: "VÃƒÆ’Ã‚Âªtements" } }),
    prisma.productCategory.upsert({ where: { name: "Chaussures" }, update: {}, create: { name: "Chaussures" } })
  ]);

  const [brandGdt, brandHeritage] = await Promise.all([
    prisma.brand.upsert({ where: { name: "GDT" }, update: {}, create: { name: "GDT" } }),
    prisma.brand.upsert({ where: { name: "Heritage" }, update: {}, create: { name: "Heritage" } })
  ]);

  const [storeGueliz, storeMouassine, depotCentral] = await Promise.all([
    prisma.warehouse.upsert({
      where: { code: "BGUELIZ" },
      update: { name: "Boutique Gueliz" },
      create: { name: "Boutique Gueliz", code: "BGUELIZ", type: WarehouseType.STORE }
    }),
    prisma.warehouse.upsert({
      where: { code: "BMOUASSINE" },
      update: { name: "Boutique Mouassine" },
      create: { name: "Boutique Mouassine", code: "BMOUASSINE", type: WarehouseType.STORE }
    }),
    prisma.warehouse.upsert({
      where: { code: "DEPOT" },
      update: { name: "Dépôt Central", isDefault: true },
      create: { name: "Dépôt Central", code: "DEPOT", type: WarehouseType.WAREHOUSE, isDefault: true }
    })
  ]);

  await prisma.cashRegister.upsert({ where: { name: "Caisse Gueliz" }, update: {}, create: { name: "Caisse Gueliz", warehouseId: storeGueliz.id } });
  await prisma.cashRegister.upsert({ where: { name: "Caisse Mouassine" }, update: {}, create: { name: "Caisse Mouassine", warehouseId: storeMouassine.id } });

  await prisma.transporter.upsert({ where: { name: "Transport Atlas" }, update: {}, create: { name: "Transport Atlas", phone: "+212600000001" } });
  await prisma.transporter.upsert({ where: { name: "Livraison Express" }, update: {}, create: { name: "Livraison Express", phone: "+212600000002" } });

  const supplier1 = await prisma.supplier.upsert({
    where: { id: "seed-supplier-1" },
    update: {},
    create: { id: "seed-supplier-1", name: "Maison Cuir Premium", phone: "+212611111111", city: "Marrakech", email: "contact@cuir-premium.ma" }
  });
  const supplier2 = await prisma.supplier.upsert({
    where: { id: "seed-supplier-2" },
    update: {},
    create: { id: "seed-supplier-2", name: "Textile Atlas", phone: "+212622222222", city: "Casablanca", email: "sales@textile-atlas.ma" }
  });

  const customer1 = await prisma.customer.upsert({
    where: { id: "seed-customer-1" },
    update: {},
    create: { id: "seed-customer-1", fullName: "Sara Benali", phone: "+212633333333", city: "Marrakech", loyaltyPoints: 120, level: "Gold" }
  });
  const customer2 = await prisma.customer.upsert({
    where: { id: "seed-customer-2" },
    update: {},
    create: { id: "seed-customer-2", fullName: "Youssef Tazi", phone: "+212644444444", city: "Rabat", loyaltyPoints: 45, level: "Silver" }
  });

  const products = [
    { reference: "SAC-001", barcode: "611000001", name: "Sac cuir camel", typeId: typeAccessories.id, categoryId: catSac.id, brandId: brandGdt.id, warehouseId: depotCentral.id, purchaseHt: 800, saleHt: 1350, stock: 18, minStock: 4 },
    { reference: "VET-001", barcode: "611000002", name: "Veste artisanale noire", typeId: typeFashion.id, categoryId: catVetement.id, brandId: brandHeritage.id, warehouseId: depotCentral.id, purchaseHt: 600, saleHt: 980, stock: 12, minStock: 3 },
    { reference: "CHS-001", barcode: "611000003", name: "Babouche premium", typeId: typeFashion.id, categoryId: catChaussure.id, brandId: brandGdt.id, warehouseId: depotCentral.id, purchaseHt: 210, saleHt: 390, stock: 30, minStock: 6 }
  ];

  const seededProducts = [] as { id: string; reference: string; salePriceTtc: number; purchasePriceTtc: number; stockOnHand: number }[];
  for (const item of products) {
    const product = await prisma.product.upsert({
      where: { reference: item.reference },
      update: {
        name: item.name,
        typeId: item.typeId,
        categoryId: item.categoryId,
        brandId: item.brandId,
        unitId: units[0].id,
        warehouseId: item.warehouseId,
        description: `${item.name} - collection GDT`
      },
      create: {
        reference: item.reference,
        barcode: item.barcode,
        name: item.name,
        typeId: item.typeId,
        categoryId: item.categoryId,
        brandId: item.brandId,
        unitId: units[0].id,
        warehouseId: item.warehouseId,
        purchasePriceHt: item.purchaseHt,
        purchasePriceTtc: item.purchaseHt * 1.2,
        salePriceHt: item.saleHt,
        salePriceTtc: item.saleHt * 1.2,
        taxRate: 20,
        stockOnHand: item.stock,
        minStock: item.minStock,
        description: `${item.name} - collection GDT`,
        status: ProductStatus.ACTIVE
      }
    });

    seededProducts.push({
      id: product.id,
      reference: product.reference,
      salePriceTtc: Number(product.salePriceTtc),
      purchasePriceTtc: Number(product.purchasePriceTtc),
      stockOnHand: product.stockOnHand
    });
  }

  const settings = {
    company_name: "Galerie des Tanneurs",
    company_currency: "MAD",
    default_tax_rate: 20,
    ticket_footer: "Merci pour votre visite"
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  return { supplier1, supplier2, customer1, customer2, storeGueliz, storeMouassine, depotCentral, seededProducts };
}

async function seedUsers(defaultWarehouseId: string) {
  const passwords = {
    admin: await bcrypt.hash("Admin123!", 12),
    manager: await bcrypt.hash("Manager123!", 12),
    caissier: await bcrypt.hash("Cashier123!", 12),
    vendeur: await bcrypt.hash("Seller123!", 12)
  };

  const users = [
    { email: "admin@gdt.local", fullName: "Admin Principal", role: "admin", passwordHash: passwords.admin },
    { email: "manager@gdt.local", fullName: "Manager Boutique", role: "manager", passwordHash: passwords.manager },
    { email: "caissier@gdt.local", fullName: "Caissier Principal", role: "caissier", passwordHash: passwords.caissier },
    { email: "vendeur@gdt.local", fullName: "Vendeur Showroom", role: "vendeur", passwordHash: passwords.vendeur }
  ];

  for (const userInput of users) {
    const user = await prisma.user.upsert({
      where: { email: userInput.email },
      update: { fullName: userInput.fullName, passwordHash: userInput.passwordHash, defaultWarehouseId },
      create: { email: userInput.email, fullName: userInput.fullName, passwordHash: userInput.passwordHash, defaultWarehouseId }
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: userInput.role } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id }
    });
  }
}

async function seedBusinessData(data: Awaited<ReturnType<typeof seedCoreData>>) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@gdt.local" } });
  const register = await prisma.cashRegister.findFirstOrThrow({ where: { warehouseId: data.storeGueliz.id } });

  const purchase = await prisma.purchase.upsert({
    where: { number: "BC-2026-0001" },
    update: {},
    create: {
      number: "BC-2026-0001",
      supplierId: data.supplier1.id,
      warehouseId: data.depotCentral.id,
      createdById: admin.id,
      status: PurchaseStatus.RECEIVED,
      subtotal: 2010,
      taxAmount: 402,
      totalAmount: 2412,
      amountDue: 900,
      orderedAt: new Date(),
      receivedAt: new Date()
    }
  });

  if ((await prisma.purchaseItem.count({ where: { purchaseId: purchase.id } })) === 0) {
    for (const product of data.seededProducts.slice(0, 2)) {
      await prisma.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          productId: product.id,
          quantity: 5,
          unitCostHt: product.purchasePriceTtc / 1.2,
          unitCostTtc: product.purchasePriceTtc,
          taxRate: 20,
          lineTotal: product.purchasePriceTtc * 5
        }
      });
    }
  }

  const sale = await prisma.sale.upsert({
    where: { number: "VTE-2026-0001" },
    update: { note: "Ticket dÃƒÆ’Ã‚Â©monstration" },
    create: {
      number: "VTE-2026-0001",
      customerId: data.customer1.id,
      warehouseId: data.storeGueliz.id,
      createdById: admin.id,
      sellerName: "Vendeur Showroom",
      status: SaleStatus.PAID,
      subtotal: 2100,
      discountAmount: 100,
      taxAmount: 400,
      totalAmount: 2400,
      paidAmount: 2400,
      note: "Ticket dÃƒÆ’Ã‚Â©monstration"
    }
  });

  if ((await prisma.saleItem.count({ where: { saleId: sale.id } })) === 0) {
    for (const product of data.seededProducts.slice(0, 2)) {
      await prisma.saleItem.create({
        data: {
          saleId: sale.id,
          productId: product.id,
          quantity: 1,
          unitPriceHt: product.salePriceTtc / 1.2,
          unitPriceTtc: product.salePriceTtc,
          discountAmount: 0,
          taxRate: 20,
          lineTotal: product.salePriceTtc
        }
      });
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          warehouseId: data.storeGueliz.id,
          type: StockMovementType.OUT,
          quantity: 1,
          beforeStock: product.stockOnHand,
          afterStock: product.stockOnHand - 1,
          referenceType: "sale",
          referenceId: sale.id,
          notes: "Vente POS démo"
        }
      });
    }
  }

  if ((await prisma.payment.count({ where: { saleId: sale.id } })) === 0) {
    await prisma.payment.create({
      data: {
        saleId: sale.id,
        amount: 2400,
        method: PaymentMethod.CASH,
        direction: PaymentDirection.IN,
        reference: "Ticket caisse"
      }
    });
  }

  const cashier = await prisma.user.findUniqueOrThrow({ where: { email: "caissier@gdt.local" } });
  if ((await prisma.cashSession.count({ where: { registerId: register.id, status: "OPEN" } })) === 0) {
    await prisma.cashSession.create({
      data: {
        registerId: register.id,
        openedById: cashier.id,
        openingAmount: 1500,
        status: "OPEN"
      }
    });
  }

  await prisma.loyaltyTransaction.createMany({
    data: [
      { customerId: data.customer1.id, points: 20, reason: "Achat POS demo" },
      { customerId: data.customer2.id, points: 10, reason: "Bonus fidelite" }
    ],
    skipDuplicates: true
  });
}

async function main() {
  await seedRoles();
  const core = await seedCoreData();
  await seedUsers(core.storeGueliz.id);
  await seedBusinessData(core);
  console.log("Seed GDT Suite terminÃƒÆ’Ã‚Â©.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

