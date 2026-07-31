const { resolve } = require("node:path");
require("dotenv").config({ path: resolve(__dirname, "../.env") });

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function normalizeTicketPrefix(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6);
}

function defaultTicketPrefixForBoutique(name) {
  const normalized = String(name ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "");
  const directMap = {
    GUELIZ: "GUE",
    MOUASSINE: "MOA",
    MAJORELLE: "MAJ",
    SOFITEL: "SOF",
    MAVENUE: "MAV"
  };
  if (directMap[normalized]) return directMap[normalized];
  return normalized.slice(0, 3) || "POS";
}

function getPosTicketPeriod(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Casablanca",
    year: "2-digit",
    month: "numeric"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "00";
  const month = parts.find((part) => part.type === "month")?.value ?? "1";
  return `${year}${month}`;
}

function replaceMatchingStrings(value, replacements) {
  if (typeof value === "string") {
    return replacements.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceMatchingStrings(entry, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceMatchingStrings(entry, replacements)])
    );
  }
  return value;
}

async function main() {
  const [sales, boutiqueSetting, auditLogs] = await Promise.all([
    prisma.sale.findMany({
      orderBy: [{ warehouseId: "asc" }, { createdAt: "asc" }],
      select: { id: true, number: true, createdAt: true, warehouseId: true, warehouse: { select: { name: true } } }
    }),
    prisma.setting.findUnique({ where: { key: "boutiques_config" } }),
    prisma.auditLog.findMany({
      where: { metadata: { not: undefined } },
      select: { id: true, metadata: true }
    })
  ]);

  const savedBoutiques = Array.isArray(boutiqueSetting?.value) ? boutiqueSetting.value : [];
  const prefixesByWarehouse = new Map(
    sales.map((sale) => {
      const savedBoutique = savedBoutiques.find((item) => item.id === sale.warehouseId);
      const prefix = normalizeTicketPrefix(savedBoutique?.ticketPrefix ?? "") || defaultTicketPrefixForBoutique(savedBoutique?.name || sale.warehouse.name);
      return [sale.warehouseId, prefix];
    })
  );

  const occupiedSequences = new Map();
  for (const sale of sales) {
    const prefix = prefixesByWarehouse.get(sale.warehouseId);
    if (!prefix || sale.number.startsWith("TCK-")) continue;
    const match = sale.number.match(new RegExp(`^${prefix}-(\\d+)-(\\d{7})$`));
    if (!match) continue;
    const key = `${sale.warehouseId}:${match[1]}`;
    const current = occupiedSequences.get(key) ?? 1000000;
    occupiedSequences.set(key, Math.max(current, Number(match[2])));
  }

  const tckSales = sales.filter((sale) => sale.number.startsWith("TCK-"));
  if (!tckSales.length) {
    console.log("Aucun ticket TCK a renumeroter.");
    return;
  }

  const replacements = new Map();
  for (const sale of tckSales) {
    const prefix = prefixesByWarehouse.get(sale.warehouseId);
    if (!prefix) continue;
    const period = getPosTicketPeriod(sale.createdAt);
    const key = `${sale.warehouseId}:${period}`;
    const nextSequence = (occupiedSequences.get(key) ?? 1000000) + 1;
    occupiedSequences.set(key, nextSequence);
    replacements.set(sale.number, `${prefix}-${period}-${String(nextSequence).padStart(7, "0")}`);
  }

  await prisma.$transaction(async (tx) => {
    for (const sale of tckSales) {
      await tx.sale.update({
        where: { id: sale.id },
        data: { number: `TMP-${sale.id}` }
      });
    }

    for (const sale of tckSales) {
      await tx.sale.update({
        where: { id: sale.id },
        data: { number: replacements.get(sale.number) }
      });
    }

    for (const log of auditLogs) {
      const nextMetadata = replaceMatchingStrings(log.metadata, replacements);
      if (JSON.stringify(nextMetadata) === JSON.stringify(log.metadata)) continue;
      await tx.auditLog.update({
        where: { id: log.id },
        data: { metadata: nextMetadata }
      });
    }
  });

  console.log(
    JSON.stringify(
      tckSales.map((sale) => ({
        id: sale.id,
        oldNumber: sale.number,
        newNumber: replacements.get(sale.number)
      })),
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
