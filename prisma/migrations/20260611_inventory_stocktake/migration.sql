DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryStatus') THEN
    CREATE TYPE "InventoryStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PENDING_VALIDATION', 'VALIDATED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryMethod') THEN
    CREATE TYPE "InventoryMethod" AS ENUM ('COMPLETE', 'CATEGORY', 'REFERENCE', 'TYPE', 'LOCATION', 'PARTIAL', 'CYCLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryItemStatus') THEN
    CREATE TYPE "InventoryItemStatus" AS ENUM ('PENDING', 'COUNTED', 'MATCHED', 'EXCESS', 'SHORTAGE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "inventories" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "InventoryMethod" NOT NULL,
  "status" "InventoryStatus" NOT NULL DEFAULT 'DRAFT',
  "scope" TEXT,
  "filterSnapshot" JSONB,
  "notes" TEXT,
  "allowCashierCounting" BOOLEAN NOT NULL DEFAULT FALSE,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validatedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "validatedById" TEXT,
  CONSTRAINT "inventories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventories_reference_key" UNIQUE ("reference"),
  CONSTRAINT "inventories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventories_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "productVariantId" TEXT,
  "warehouseId" TEXT,
  "productReference" TEXT NOT NULL,
  "barcode" TEXT,
  "productName" TEXT NOT NULL,
  "category" TEXT,
  "type" TEXT,
  "brand" TEXT,
  "color" TEXT,
  "size" TEXT,
  "location" TEXT,
  "theoreticalQty" INTEGER NOT NULL,
  "countedQty" INTEGER,
  "differenceQty" INTEGER NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(14,2),
  "differenceValue" DECIMAL(14,2),
  "status" "InventoryItemStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventory_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "inventory_logs" (
  "id" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "inventoryItemId" TEXT,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_logs_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_logs_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "inventories_status_startedAt_idx" ON "inventories"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "inventories_type_status_idx" ON "inventories"("type", "status");

CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_status_idx" ON "inventory_items"("inventoryId", "status");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_productReference_idx" ON "inventory_items"("inventoryId", "productReference");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_barcode_idx" ON "inventory_items"("inventoryId", "barcode");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_category_idx" ON "inventory_items"("inventoryId", "category");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_type_idx" ON "inventory_items"("inventoryId", "type");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_brand_idx" ON "inventory_items"("inventoryId", "brand");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_color_idx" ON "inventory_items"("inventoryId", "color");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_size_idx" ON "inventory_items"("inventoryId", "size");
CREATE INDEX IF NOT EXISTS "inventory_items_inventoryId_warehouseId_idx" ON "inventory_items"("inventoryId", "warehouseId");

CREATE INDEX IF NOT EXISTS "inventory_logs_inventoryId_createdAt_idx" ON "inventory_logs"("inventoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "inventory_logs_inventoryItemId_createdAt_idx" ON "inventory_logs"("inventoryItemId", "createdAt");
