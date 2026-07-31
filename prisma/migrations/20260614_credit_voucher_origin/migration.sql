ALTER TABLE `GiftVoucher`
  ADD COLUMN `customerName` VARCHAR(191) NULL,
  ADD COLUMN `customerPhone` VARCHAR(191) NULL,
  ADD COLUMN `warehouseId` VARCHAR(191) NULL,
  ADD COLUMN `origin` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN `sourceDocumentId` VARCHAR(191) NULL,
  ADD COLUMN `sourceDocumentNumber` VARCHAR(191) NULL,
  ADD COLUMN `createdByUserId` VARCHAR(191) NULL;

CREATE INDEX `GiftVoucher_warehouseId_idx` ON `GiftVoucher`(`warehouseId`);
CREATE INDEX `GiftVoucher_origin_idx` ON `GiftVoucher`(`origin`);
