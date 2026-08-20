import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Sparkles, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { cleanDisplayText, cleanWarehouseName, formatCurrency, formatNumber } from "../../lib/format";
import { Badge, Button, EmptyState, Field, Input, LoadingBlock, PageHeader, SectionCard, Select, Textarea } from "../../components/ui/primitives";
import { useAuth } from "../../providers/AuthProvider";

type ProductColor = { id: string; reference: string; name: string; type: string; isAvailable?: boolean };
type ProductSize = { id: string; reference: string; name: string; type: string };

type ProductVariant = {
  id: string;
  label?: string | null;
  size?: string | null;
  color?: string | null;
  reference?: string | null;
  barcode?: string | null;
  stockOnHand: number;
};

type ProductMeta = {
  types: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; typeId?: string | null; type?: { id: string; name: string } | null }>;
  brands: Array<{ id: string; name: string }>;
  units: Array<{ id: string; name: string }>;
  warehouses: Array<{ id: string; name: string; type: string }>;
  colors: ProductColor[];
  sizes: ProductSize[];
};

type Product = {
  id: string;
  reference: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  dimensions?: string | null;
  weight?: string | null;
  isTaxExempt: boolean;
  isCommissioned: boolean;
  sourcingMode: "" | "BUY_RESELL" | "CONSIGNMENT" | "MANUFACTURED";
  purchasePriceHt: number;
  purchasePriceTtc: number;
  salePriceHt: number;
  salePriceTtc: number;
  promoPriceHt?: number | null;
  promoPriceTtc?: number | null;
  promoPriceActive: boolean;
  taxRate: number;
  stockOnHand: number;
  minStock: number;
  status: "ACTIVE" | "INACTIVE";
  type?: { name: string } | null;
  category?: { name: string } | null;
  brand?: { name: string } | null;
  unit?: { name: string } | null;
  warehouse?: { name: string } | null;
  variants?: ProductVariant[];
};

type ProductSourcingMode = Product["sourcingMode"];

type ProductVariantForm = {
  color: string;
  size: string;
  reference: string;
  barcode: string;
  stockOnHand: string;
};

type ProductForm = {
  reference: string;
  barcode: string;
  name: string;
  typeId: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  warehouseId: string;
  purchasePriceHt: string;
  purchasePriceTtc: string;
  salePriceHt: string;
  salePriceTtc: string;
  promoPriceHt: string;
  promoPriceTtc: string;
  promoPriceActive: boolean;
  taxRate: string;
  stockOnHand: string;
  minStock: string;
  imageUrl: string;
  description: string;
  dimensionLength: string;
  dimensionWidth: string;
  dimensionHeight: string;
  weight: string;
  isTaxExempt: boolean;
  isCommissioned: boolean;
  sourcingMode: "" | ProductSourcingMode;
  status: "ACTIVE" | "INACTIVE";
  variants: ProductVariantForm[];
};

type ProductTab = "main" | "pricing" | "details" | "variants" | "declinaisons" | "photo";

type ImportResult = {
  created: number;
  updated: number;
  errors: Array<{ row: number; message: string }>;
};

const defaultForm: ProductForm = {
  reference: "",
  barcode: "",
  name: "",
  typeId: "",
  categoryId: "",
  brandId: "",
  unitId: "",
  warehouseId: "",
  purchasePriceHt: "0",
  purchasePriceTtc: "0",
  salePriceHt: "0",
  salePriceTtc: "0",
  promoPriceHt: "0",
  promoPriceTtc: "0",
  promoPriceActive: false,
  taxRate: "20",
  stockOnHand: "0",
  minStock: "0",
  imageUrl: "",
  description: "",
  dimensionLength: "",
  dimensionWidth: "",
  dimensionHeight: "",
  weight: "",
  isTaxExempt: false,
  isCommissioned: false,
  sourcingMode: "",
  status: "ACTIVE",
  variants: []
};

const modalTabs: Array<{ id: ProductTab; label: string }> = [
  { id: "main", label: "Principale" },
  { id: "pricing", label: "Prix" },
  { id: "details", label: "Details" },
  { id: "variants", label: "Variantes" },
  { id: "declinaisons", label: "Declinaisons" },
  { id: "photo", label: "Photo" }
];

function parseDimensions(value?: string | null) {
  const parts = (value ?? "")
    .split(/[xX]/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    length: parts[0] ?? "",
    width: parts[1] ?? "",
    height: parts[2] ?? ""
  };
}

function formatDimensions(length: string, width: string, height: string) {
  const parts = [length, width, height].map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" x ") : null;
}

function createBarcodeValue() {
  const seed = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
  return seed.replace(/\D/g, "").slice(-13).padStart(13, "0");
}

function slugSegment(value: string) {
  return value
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildVariantReference(baseReference: string, colorReference?: string | null, sizeReference?: string | null) {
  return [baseReference, colorReference, sizeReference].map((item) => slugSegment(item ?? "")).filter(Boolean).join("-");
}

function buildVariantLabel(productName: string, color?: string | null, size?: string | null) {
  return [productName.trim(), color?.trim(), size?.trim()].filter(Boolean).join(" - ");
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function detectDelimiter(input: string) {
  const firstLine = input.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  return firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
}

function parseCsv(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows
    .slice(1)
    .map((values) => {
      const entry: Record<string, string> = {};
      headers.forEach((header, index) => {
        if (header) {
          entry[header] = (values[index] ?? "").trim();
        }
      });
      return entry;
    })
    .filter((entry) => Object.values(entry).some((value) => value.length > 0));
}

function loadImageFromSource(source: Blob | string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      reject(new Error("Image impossible a charger."));
    };
    image.src = url;
  });
}

async function centerImageOnWhiteBackground(source: Blob | string, size = 1200) {
  const image = await loadImageFromSource(source);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = image.naturalWidth || image.width;
  sourceCanvas.height = image.naturalHeight || image.height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Traitement image indisponible sur ce navigateur.");
  sourceContext.drawImage(image, 0, 0);

  const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = pixels.data;
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      const alpha = data[(y * sourceCanvas.width + x) * 4 + 3];
      if (alpha > 12) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const hasVisiblePixels = maxX > minX && maxY > minY;
  const cropX = hasVisiblePixels ? minX : 0;
  const cropY = hasVisiblePixels ? minY : 0;
  const cropWidth = hasVisiblePixels ? maxX - minX + 1 : sourceCanvas.width;
  const cropHeight = hasVisiblePixels ? maxY - minY + 1 : sourceCanvas.height;
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = size;
  outputCanvas.height = size;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("Traitement image indisponible sur ce navigateur.");

  outputContext.fillStyle = "#ffffff";
  outputContext.fillRect(0, 0, size, size);
  const padding = Math.round(size * 0.08);
  const scale = Math.min((size - padding * 2) / cropWidth, (size - padding * 2) / cropHeight);
  const drawWidth = Math.round(cropWidth * scale);
  const drawHeight = Math.round(cropHeight * scale);
  const drawX = Math.round((size - drawWidth) / 2);
  const drawY = Math.round((size - drawHeight) / 2);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, drawX, drawY, drawWidth, drawHeight);

  return outputCanvas.toDataURL("image/jpeg", 0.9);
}

async function optimizeProductPhotoWithAi(imageUrl: string) {
  const { removeBackground } = await import("@imgly/background-removal");
  const transparentArticle = await removeBackground(imageUrl);
  return centerImageOnWhiteBackground(transparentArticle);
}

function ProductModal({
  open,
  title,
  form,
  meta,
  error,
  saving,
  onClose,
  onSubmit,
  onChange,
  onVariantsChange
}: {
  open: boolean;
  title: string;
  form: ProductForm;
  meta: ProductMeta | null;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => void;
  onVariantsChange: (variants: ProductVariantForm[]) => void;
}) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<ProductTab>("main");
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [selectedColorType, setSelectedColorType] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [selectedSizeType, setSelectedSizeType] = useState("");
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setActiveTab("main");
    setSelectedColorIds([]);
    setSelectedSizeIds([]);
    setSelectedColorType("");
    setColorSearch("");
    setSelectedSizeType("");
    setPhotoProcessing(false);
    setPhotoMessage(null);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      window.alert("Choisis une image de moins de 3 Mo.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onChange("imageUrl", typeof reader.result === "string" ? reader.result : "");
      setPhotoMessage("Photo chargee. Tu peux l'optimiser avec IA.");
    };
    reader.readAsDataURL(file);
  };

  const optimizePhoto = async () => {
    if (!form.imageUrl) return;
    setPhotoProcessing(true);
    setPhotoMessage("Optimisation IA en cours... La premiere fois peut prendre quelques secondes.");
    try {
      const optimized = await optimizeProductPhotoWithAi(form.imageUrl);
      onChange("imageUrl", optimized);
      setPhotoMessage("Photo optimisee: fond blanc, article centre.");
    } catch (err) {
      setPhotoMessage(err instanceof Error ? err.message : "Optimisation IA impossible pour cette photo.");
    } finally {
      setPhotoProcessing(false);
    }
  };

  const marginValue = Number(form.salePriceTtc || 0) - Number(form.purchasePriceTtc || 0);
  const filteredCategories = (meta?.categories ?? []).filter((item) => !form.typeId || item.typeId === form.typeId);
  const colorTypes = Array.from(new Set((meta?.colors ?? []).map((item) => item.type).filter(Boolean))).sort();
  const sizeTypes = Array.from(new Set((meta?.sizes ?? []).map((item) => item.type).filter(Boolean))).sort();
  const normalizedColorSearch = colorSearch.trim().toLowerCase();
  const filteredColors = (meta?.colors ?? []).filter((item) => {
    const matchesType = !selectedColorType || item.type === selectedColorType;
    const haystack = [item.reference, item.name, item.type].join(" ").toLowerCase();
    return matchesType && (!normalizedColorSearch || haystack.includes(normalizedColorSearch));
  });
  const filteredSizes = (meta?.sizes ?? []).filter((item) => !selectedSizeType || item.type === selectedSizeType);

  const parseMoney = (value: string) => {
    const normalized = Number(value.replace(",", ".").trim());
    return Number.isFinite(normalized) ? normalized : null;
  };

  const formatMoney = (value: number) => value.toFixed(2);

  const syncPair = (family: "purchase" | "sale", source: "ht" | "ttc", rawValue: string, rawTaxRate = form.taxRate) => {
    const rate = parseMoney(rawTaxRate) ?? 0;
    const parsedValue = parseMoney(rawValue);
    const htKey = family === "purchase" ? "purchasePriceHt" : "salePriceHt";
    const ttcKey = family === "purchase" ? "purchasePriceTtc" : "salePriceTtc";

    if (source === "ht") {
      onChange(htKey, rawValue);
      onChange(ttcKey, parsedValue === null ? "" : formatMoney(parsedValue * (1 + rate / 100)));
      return;
    }

    onChange(ttcKey, rawValue);
    onChange(htKey, parsedValue === null ? "" : formatMoney(parsedValue / (1 + rate / 100)));
  };

  const syncPromoPair = (source: "ht" | "ttc", rawValue: string, rawTaxRate = form.taxRate) => {
    const rate = parseMoney(rawTaxRate) ?? 0;
    const parsedValue = parseMoney(rawValue);

    if (source === "ht") {
      onChange("promoPriceHt", rawValue);
      onChange("promoPriceTtc", parsedValue === null ? "" : formatMoney(parsedValue * (1 + rate / 100)));
      return;
    }

    onChange("promoPriceTtc", rawValue);
    onChange("promoPriceHt", parsedValue === null ? "" : formatMoney(parsedValue / (1 + rate / 100)));
  };

  const handleTaxRateChange = (rawValue: string) => {
    onChange("taxRate", rawValue);

    if (form.purchasePriceHt.trim()) {
      syncPair("purchase", "ht", form.purchasePriceHt, rawValue);
    } else if (form.purchasePriceTtc.trim()) {
      syncPair("purchase", "ttc", form.purchasePriceTtc, rawValue);
    }

    if (form.salePriceHt.trim()) {
      syncPair("sale", "ht", form.salePriceHt, rawValue);
    } else if (form.salePriceTtc.trim()) {
      syncPair("sale", "ttc", form.salePriceTtc, rawValue);
    }

    if (form.promoPriceActive) {
      if (form.promoPriceHt.trim()) {
        syncPromoPair("ht", form.promoPriceHt, rawValue);
      } else if (form.promoPriceTtc.trim()) {
        syncPromoPair("ttc", form.promoPriceTtc, rawValue);
      }
    }
  };

  const generateBarcode = () => {
    onChange("barcode", createBarcodeValue());
  };

  const toggleSelection = (values: string[], id: string) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  const allFilteredColorIds = filteredColors.map((color) => color.id);
  const allFilteredSizeIds = filteredSizes.map((size) => size.id);
  const allFilteredColorsSelected = allFilteredColorIds.length > 0 && allFilteredColorIds.every((id) => selectedColorIds.includes(id));
  const allFilteredSizesSelected = allFilteredSizeIds.length > 0 && allFilteredSizeIds.every((id) => selectedSizeIds.includes(id));

  const toggleAllFilteredColors = () => {
    setSelectedColorIds((current) => {
      const currentSet = new Set(current);
      if (allFilteredColorsSelected) {
        allFilteredColorIds.forEach((id) => currentSet.delete(id));
      } else {
        allFilteredColorIds.forEach((id) => currentSet.add(id));
      }
      return Array.from(currentSet);
    });
  };

  const toggleAllFilteredSizes = () => {
    setSelectedSizeIds((current) => {
      const currentSet = new Set(current);
      if (allFilteredSizesSelected) {
        allFilteredSizeIds.forEach((id) => currentSet.delete(id));
      } else {
        allFilteredSizeIds.forEach((id) => currentSet.add(id));
      }
      return Array.from(currentSet);
    });
  };

  const updateVariant = (index: number, patch: Partial<ProductVariantForm>) => {
    onVariantsChange(form.variants.map((variant, variantIndex) => {
      if (variantIndex !== index) return variant;
      const nextVariant = { ...variant, ...patch };
      return {
        ...nextVariant,
        reference: nextVariant.reference,
        barcode: nextVariant.barcode,
        stockOnHand: nextVariant.stockOnHand
      };
    }));
  };

  const removeVariant = (index: number) => {
    onVariantsChange(form.variants.filter((_, variantIndex) => variantIndex !== index));
  };

  const addEmptyVariant = () => {
    onVariantsChange([
      ...form.variants,
      {
        color: "",
        size: "",
        reference: form.reference ? `${slugSegment(form.reference)}-VAR-${form.variants.length + 1}` : "",
        barcode: createBarcodeValue(),
        stockOnHand: "0"
      }
    ]);
  };

  const generateVariants = () => {
    const colors = (meta?.colors ?? []).filter((item) => selectedColorIds.includes(item.id));
    const sizes = (meta?.sizes ?? []).filter((item) => selectedSizeIds.includes(item.id));

    if (!colors.length && !sizes.length) {
      window.alert("Choisis au moins une couleur ou une taille.");
      return;
    }
    if (!form.reference.trim()) {
      window.alert("Renseigne d'abord la reference article.");
      return;
    }

    const existingMap = new Map(form.variants.map((variant) => [`${variant.color}::${variant.size}`, variant]));
    const nextVariants: ProductVariantForm[] = [];

    const pushVariant = (color?: ProductColor, size?: ProductSize) => {
      const colorName = color?.name ?? "";
      const sizeName = size?.name ?? "";
      const key = `${colorName}::${sizeName}`;
      const existing = existingMap.get(key);
      nextVariants.push(existing ?? {
        color: colorName,
        size: sizeName,
        reference: buildVariantReference(form.reference, color?.reference, size?.reference),
        barcode: createBarcodeValue(),
        stockOnHand: "0"
      });
    };

    if (colors.length && sizes.length) {
      colors.forEach((color) => sizes.forEach((size) => pushVariant(color, size)));
    } else if (colors.length) {
      colors.forEach((color) => pushVariant(color, undefined));
    } else {
      sizes.forEach((size) => pushVariant(undefined, size));
    }

    onVariantsChange(nextVariants);
    setActiveTab("declinaisons");
  };

  const selectedColors = (meta?.colors ?? []).filter((item) => selectedColorIds.includes(item.id));
  const selectedSizes = (meta?.sizes ?? []).filter((item) => selectedSizeIds.includes(item.id));
  const selectedColorLabel = selectedColors.length ? selectedColors.map((item) => item.reference ? `${item.reference} ${item.name}` : item.name).join(", ") : "Choisir les couleurs";
  const selectedSizeLabel = selectedSizes.length ? selectedSizes.map((item) => item.name).join(", ") : "Choisir les tailles";
  const colorReferenceByName = new Map((meta?.colors ?? []).map((color) => [color.name, color.reference]));
  const groupedVariants = form.variants.reduce<Array<{ color: string; colorReference: string; items: Array<{ variant: ProductVariantForm; index: number }> }>>((groups, variant, index) => {
    const colorKey = variant.color?.trim() || "Sans couleur";
    const existingGroup = groups.find((group) => group.color === colorKey);
    const entry = { variant, index };
    if (existingGroup) {
      existingGroup.items.push(entry);
    } else {
      groups.push({ color: colorKey, colorReference: colorReferenceByName.get(colorKey) ?? "", items: [entry] });
    }
    return groups;
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#050403]/82 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="max-h-[92vh] w-full max-w-[1120px] overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,#17120f,#100c0a)] shadow-[0_32px_90px_rgba(0,0,0,0.55)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-5 py-4 md:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-300/75">Articles</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          </div>
          <button type="button" className="btn-ghost !h-10 !w-10 !rounded-full !p-0" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="max-h-[calc(92vh-84px)] overflow-y-auto bg-black/[0.18] px-5 py-5 md:px-6" onSubmit={onSubmit}>
          <div className="mb-5 grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
            <div role="tablist" aria-orientation="vertical" className="rounded-[24px] border border-white/10 bg-black/20 p-3">
              <div className="space-y-2">
                {modalTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={activeTab === tab.id ? "w-full rounded-[20px] border border-orange-300/25 bg-[linear-gradient(135deg,rgba(255,163,72,0.26),rgba(255,140,40,0.12))] px-4 py-3 text-left shadow-[0_18px_36px_rgba(255,140,40,0.16)]" : "w-full rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.05]"}
                  >
                    <span className={activeTab === tab.id ? "block text-sm font-semibold text-white" : "block text-sm font-semibold text-[#efe3d7]"}>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-[540px] rounded-[24px] border border-white/10 bg-black/16 p-4 md:p-5">
              {activeTab === "main" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Reference">
                    <Input value={form.reference} onChange={(event) => onChange("reference", event.target.value)} />
                  </Field>
                  <Field label="Code-barres">
                    <div className="flex gap-2">
                      <Input value={form.barcode} onChange={(event) => onChange("barcode", event.target.value)} />
                      <Button variant="secondary" type="button" className="shrink-0 !px-4" onClick={generateBarcode}>Generer</Button>
                    </div>
                  </Field>
                  <Field label="Nom de l'article" hint="Champ obligatoire">
                    <Input value={form.name} onChange={(event) => onChange("name", event.target.value)} />
                  </Field>
                  <Field label="Statut">
                    <Select value={form.status} onChange={(event) => onChange("status", event.target.value as ProductForm["status"])}>
                      <option value="ACTIVE">Actif</option>
                      <option value="INACTIVE">Inactif</option>
                    </Select>
                  </Field>
                  <Field label="Type">
                    <Select value={form.typeId} onChange={(event) => {
                      const nextTypeId = event.target.value;
                      onChange("typeId", nextTypeId);
                      if (form.categoryId) {
                        const currentCategory = (meta?.categories ?? []).find((item) => item.id === form.categoryId);
                        if (currentCategory && currentCategory.typeId !== nextTypeId) {
                          onChange("categoryId", "");
                        }
                      }
                    }}>
                      <option value="">Choisir</option>
                      {meta?.types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Categorie">
                    <Select value={form.categoryId} onChange={(event) => onChange("categoryId", event.target.value)}>
                      <option value="">Choisir</option>
                      {filteredCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Marque">
                    <Select value={form.brandId} onChange={(event) => onChange("brandId", event.target.value)}>
                      <option value="">Choisir</option>
                      {meta?.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </Select>
                  </Field>
                  <div className="md:col-span-2">
                    <Field label="Description">
                      <Textarea rows={3} value={form.description} onChange={(event) => onChange("description", event.target.value)} />
                    </Field>
                  </div>
                </div>
              ) : null}

              {activeTab === "pricing" ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="Achat HT">
                      <Input type="number" step="0.01" value={form.purchasePriceHt} onChange={(event) => syncPair("purchase", "ht", event.target.value)} />
                    </Field>
                    <Field label="Achat TTC">
                      <Input type="number" step="0.01" value={form.purchasePriceTtc} onChange={(event) => syncPair("purchase", "ttc", event.target.value)} />
                    </Field>
                    <Field label="TVA %">
                      <Input type="number" step="0.01" value={form.taxRate} onChange={(event) => handleTaxRateChange(event.target.value)} />
                    </Field>
                    <Field label="Vente HT">
                      <Input type="number" step="0.01" value={form.salePriceHt} onChange={(event) => syncPair("sale", "ht", event.target.value)} />
                    </Field>
                    <Field label="Vente TTC">
                      <Input type="number" step="0.01" value={form.salePriceTtc} onChange={(event) => syncPair("sale", "ttc", event.target.value)} />
                    </Field>
                    <Field label="Marge">
                      <Input type="number" step="0.01" value={marginValue.toFixed(2)} readOnly />
                    </Field>
                  </div>

                  <div className="rounded-[22px] border border-orange-300/20 bg-orange-300/8 p-4">
                    <label className="flex items-start gap-3 text-sm text-[#efe3d7]">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-orange-400"
                        checked={form.promoPriceActive}
                        onChange={(event) => onChange("promoPriceActive", event.target.checked)}
                      />
                      <span>
                        <span className="block font-semibold text-white">Activer prix promo</span>
                        <span className="mt-1 block text-xs leading-5 text-[#cdbfaf]">Si le prix promo est actif, il sera utilise dans la caisse et aucune remise article/ticket ne sera appliquee sur cet article.</span>
                      </span>
                    </label>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Field label="Prix promo HT">
                        <Input type="number" step="0.01" value={form.promoPriceHt} disabled={!form.promoPriceActive} onChange={(event) => syncPromoPair("ht", event.target.value)} />
                      </Field>
                      <Field label="Prix promo TTC">
                        <Input type="number" step="0.01" value={form.promoPriceTtc} disabled={!form.promoPriceActive} onChange={(event) => syncPromoPair("ttc", event.target.value)} />
                      </Field>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "details" ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="Stock initial">
                      <Input type="number" value={form.stockOnHand} onChange={(event) => onChange("stockOnHand", event.target.value)} />
                    </Field>
                    <Field label="Depot / magasin">
                      <Select value={form.warehouseId} onChange={(event) => onChange("warehouseId", event.target.value)}>
                        <option value="">Choisir</option>
                        {meta?.warehouses.map((item) => <option key={item.id} value={item.id}>{cleanWarehouseName(item.name)}</option>)}
                      </Select>
                    </Field>
                    <Field label="Stock minimum">
                      <Input type="number" value={form.minStock} onChange={(event) => onChange("minStock", event.target.value)} />
                    </Field>
                    <Field label="Unite">
                      <Select value={form.unitId} onChange={(event) => onChange("unitId", event.target.value)}>
                        <option value="">Choisir</option>
                        {meta?.units.map((item) => <option key={item.id} value={item.id}>{cleanDisplayText(item.name)}</option>)}
                      </Select>
                    </Field>
                    <Field label="Dimension">
                      <div className="grid grid-cols-3 gap-2">
                        <Input value={form.dimensionLength} onChange={(event) => onChange("dimensionLength", event.target.value)} placeholder="Long." />
                        <Input value={form.dimensionWidth} onChange={(event) => onChange("dimensionWidth", event.target.value)} placeholder="Larg." />
                        <Input value={form.dimensionHeight} onChange={(event) => onChange("dimensionHeight", event.target.value)} placeholder="Haut." />
                      </div>
                    </Field>
                    <Field label="Poid">
                      <Input value={form.weight} onChange={(event) => onChange("weight", event.target.value)} placeholder="Ex. 1.25 kg" />
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#efe3d7]">
                      <input type="checkbox" className="h-4 w-4 accent-orange-400" checked={form.isTaxExempt} onChange={(event) => onChange("isTaxExempt", event.target.checked)} />
                      <span>Article detaxable</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#efe3d7]">
                      <input type="checkbox" className="h-4 w-4 accent-orange-400" checked={form.isCommissioned} onChange={(event) => onChange("isCommissioned", event.target.checked)} />
                      <span>Article soumis a la commission</span>
                    </label>
                    <Field label="Mode article">
                      <Select value={form.sourcingMode} onChange={(event) => onChange("sourcingMode", event.target.value as ProductForm["sourcingMode"])}>
                        <option value="">Choisir</option>
                        <option value="BUY_RESELL">Achete / revendu</option>
                        <option value="CONSIGNMENT">Depot de vente</option>
                        <option value="MANUFACTURED">Fabrique</option>
                      </Select>
                    </Field>
                  </div>
                </div>
              ) : null}

              {activeTab === "variants" ? (
                <div className="product-variant-builder space-y-4 rounded-[22px] border border-white/10 bg-black/18 p-4">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-1.5">
                      <div className="product-variant-kicker text-xs font-semibold uppercase tracking-[0.22em] text-orange-200/80">Couleurs</div>
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                        <Select value={selectedColorType} onChange={(event) => setSelectedColorType(event.target.value)} className="!h-10 !border-white/12 !bg-black/35 !text-sm !text-[#f4e8dc]">
                          <option value="">Tous les types</option>
                          {colorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                        </Select>
                        <Input value={colorSearch} onChange={(event) => setColorSearch(event.target.value)} placeholder="Recherche couleur ou reference..." className="!h-10 !border-white/12 !bg-black/35 !text-sm !text-[#f4e8dc]" />
                      </div>
                       <details className="product-variant-picker group rounded-[18px] border border-white/10 bg-black/28">
                        <summary className="product-variant-summary flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-white">
                          <span className="min-w-0 truncate">{selectedColorLabel}</span>
                          <span className="shrink-0 rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-0.5 text-[11px] text-orange-100">{selectedColors.length}</span>
                        </summary>
                        <div className="max-h-[260px] space-y-1 overflow-y-auto border-t border-white/10 p-2">
                          {selectedColors.length ? (
                            <div className="mb-2 rounded-[14px] border border-white/10 bg-white/[0.035] p-2">
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#baa999]">Couleurs deja selectionnees</p>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedColors.map((color) => (
                                  <button key={color.id} type="button" className="rounded-full border border-orange-300/25 bg-orange-300/10 px-2 py-1 text-[10px] font-semibold text-orange-100 transition hover:bg-orange-300/18" onClick={() => setSelectedColorIds((current) => current.filter((id) => id !== color.id))}>
                                    {color.reference ? `${color.reference} - ` : ""}{color.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {filteredColors.length ? (
                            <button
                              type="button"
                              className="mb-1 w-full rounded-[14px] border border-orange-300/25 bg-orange-300/10 px-3 py-2 text-left text-xs font-semibold text-orange-100 transition hover:bg-orange-300/16"
                              onClick={toggleAllFilteredColors}
                            >
                              {allFilteredColorsSelected ? "Tout deselectionner dans cette vue" : "Selectionner les couleurs affichees"}
                            </button>
                          ) : null}
                          {filteredColors.map((color) => (
                            <label key={color.id} className="flex cursor-pointer items-start gap-3 rounded-[14px] px-3 py-2 text-sm text-[#efe3d7] transition hover:bg-white/[0.06]">
                              <input type="checkbox" className="mt-1 h-4 w-4 accent-orange-400" checked={selectedColorIds.includes(color.id)} onChange={() => setSelectedColorIds((current) => toggleSelection(current, color.id))} />
                              <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-white">{color.name}</span>
                                  <span className="text-xs text-[#baa999]">{color.type}</span>
                                </span>
                                <span className="flex shrink-0 flex-col items-end gap-1">
                                  <span className="rounded-full border border-orange-300/25 bg-orange-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-100">{color.reference || "-"}</span>
                                  {color.isAvailable === false ? <span className="rounded-full border border-red-300/25 bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-100">Rupture</span> : null}
                                </span>
                              </span>
                            </label>
                          ))}
                          {!filteredColors.length ? <div className="px-3 py-2 text-xs text-[#baa999]">Aucune couleur trouvee pour ce type ou cette recherche.</div> : null}
                        </div>
                      </details>
                    </div>

                    <div className="space-y-1.5">
                      <div className="product-variant-kicker text-xs font-semibold uppercase tracking-[0.22em] text-orange-200/80">Tailles</div>
                      <Select value={selectedSizeType} onChange={(event) => {
                        const nextType = event.target.value;
                        setSelectedSizeType(nextType);
                        setSelectedSizeIds((current) => current.filter((id) => (meta?.sizes ?? []).some((item) => item.id === id && (!nextType || item.type === nextType))));
                      }} className="!h-10 !border-white/12 !bg-black/35 !text-sm !text-[#f4e8dc]">
                        <option value="">Tous les types</option>
                        {sizeTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                      </Select>
                      <details className="product-variant-picker group rounded-[18px] border border-white/10 bg-black/28">
                        <summary className="product-variant-summary flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-white">
                          <span className="min-w-0 truncate">{selectedSizeLabel}</span>
                          <span className="shrink-0 rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-0.5 text-[11px] text-orange-100">{selectedSizes.length}</span>
                        </summary>
                        <div className="max-h-[260px] space-y-1 overflow-y-auto border-t border-white/10 p-2">
                          {filteredSizes.length ? (
                            <button
                              type="button"
                              className="mb-1 w-full rounded-[14px] border border-orange-300/25 bg-orange-300/10 px-3 py-2 text-left text-xs font-semibold text-orange-100 transition hover:bg-orange-300/16"
                              onClick={toggleAllFilteredSizes}
                            >
                              {allFilteredSizesSelected ? "Tout deselectionner" : "Selectionner toutes les tailles"}
                            </button>
                          ) : null}
                          {filteredSizes.map((size) => (
                            <label key={size.id} className="flex cursor-pointer items-start gap-3 rounded-[14px] px-3 py-2 text-sm text-[#efe3d7] transition hover:bg-white/[0.06]">
                              <input type="checkbox" className="mt-1 h-4 w-4 accent-orange-400" checked={selectedSizeIds.includes(size.id)} onChange={() => setSelectedSizeIds((current) => toggleSelection(current, size.id))} />
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-white">{size.name}</span>
                                <span className="text-xs text-[#baa999]">{size.type}</span>
                              </span>
                            </label>
                          ))}
                          {!filteredSizes.length ? <div className="px-3 py-2 text-xs text-[#baa999]">Aucune taille pour ce type.</div> : null}
                        </div>
                      </details>
                    </div>
                    </div>

                  <div className="product-variant-recap flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-white/[0.03] p-3 text-xs text-[#baa999]">
                    <div className="flex flex-wrap gap-4">
                      <div>Couleurs selectionnees: <span className="text-white">{selectedColors.length}</span></div>
                      <div>Tailles selectionnees: <span className="text-white">{selectedSizes.length}</span></div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[#eadfd4]">{formatNumber(form.variants.length)} variante(s)</div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" variant="secondary" className="!px-3" onClick={generateVariants}>Generer les declinaisons</Button>
                    <Button type="button" variant="secondary" className="!px-3" onClick={addEmptyVariant}>Ajouter une ligne</Button>
                  </div>
                </div>
              ) : null}

                            {activeTab === "declinaisons" ? (
                <div className="product-variant-builder rounded-[22px] border border-white/10 bg-black/18 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="product-variant-title text-sm font-semibold text-white">Declinaisons</div>
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-[#eadfd4]">{formatNumber(form.variants.length)} variante(s)</div>
                  </div>

                  {!form.variants.length ? (
                    <EmptyState title="Aucune variante" description="Choisis des tailles et des couleurs puis genere les declinaisons." compact />
                  ) : (
                    <div className="space-y-3">
                      {groupedVariants.map((group) => (
                         <div key={group.color} className="product-variant-group rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
                            <div className="product-variant-group-head mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                {group.colorReference ? (
                                  <span className="rounded-full border border-orange-300/25 bg-orange-300/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-100">{group.colorReference}</span>
                                ) : null}
                                <div className="product-variant-title text-sm font-semibold text-white">{group.color}</div>
                              </div>
                            <div className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2.5 py-1 text-[11px] text-orange-100">{formatNumber(group.items.length)} variante(s)</div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="product-variant-grid-head hidden xl:grid xl:grid-cols-[96px_72px_minmax(0,1.1fr)_88px_40px] xl:gap-2 xl:rounded-[12px] xl:border xl:border-white/8 xl:bg-white/[0.03] xl:px-3 xl:py-2 xl:text-[10px] xl:font-medium xl:uppercase xl:tracking-[0.16em] xl:text-[#bfae9f]">
                              <div>Taille</div>
                              <div>Stock</div>
                              <div>Code-barres variante</div>
                              <div>Generer</div>
                              <div></div>
                            </div>

                            {group.items.map(({ variant, index }) => (
                              <div key={`${variant.reference}-${index}`} className="product-variant-row rounded-[12px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.012))] px-3 py-2">
                                <div className="mb-1.5 flex items-center justify-between gap-3 xl:hidden">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      {colorReferenceByName.get(variant.color) ? (
                                        <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-100">{colorReferenceByName.get(variant.color)}</span>
                                      ) : null}
                                      <div className="truncate text-[13px] font-semibold text-white">{buildVariantLabel(form.name || "Article", variant.color, variant.size) || `Variante ${index + 1}`}</div>
                                    </div>
                                  </div>
                                  <Button type="button" variant="secondary" className="!h-7 !px-2" onClick={() => removeVariant(index)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>

                                <div className="grid gap-1.5 xl:grid-cols-[96px_72px_minmax(0,1.1fr)_88px_40px] xl:items-center">
                                  <label className="block space-y-1 xl:space-y-0">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#bfae9f] xl:hidden">Taille</span>
                                    <Select value={variant.size} onChange={(event) => updateVariant(index, { size: event.target.value })} className="!h-8 !border-white/12 !bg-black/35 !text-[12px] !text-[#f4e8dc]">
                                      <option value="">Choisir</option>
                                      {(meta?.sizes ?? []).map((size) => <option key={size.id} value={size.name}>{size.name}</option>)}
                                    </Select>
                                  </label>
                                  <label className="block space-y-1 xl:space-y-0">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#bfae9f] xl:hidden">Stock</span>
                                    <Input type="number" value={variant.stockOnHand} onChange={(event) => updateVariant(index, { stockOnHand: event.target.value })} className="!h-8 !w-[64px] !border-white/12 !bg-black/35 !px-1 !text-center !text-[12px] !text-[#f4e8dc]" />
                                  </label>
                                  <label className="block space-y-1 xl:space-y-0">
                                    <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#bfae9f] xl:hidden">Code-barres variante</span>
                                    <Input value={variant.barcode} onChange={(event) => updateVariant(index, { barcode: event.target.value })} className="!h-8 !border-white/12 !bg-black/35 !text-[12px] !text-[#f4e8dc]" />
                                  </label>
                                  <div className="flex items-end">
                                    <Button type="button" variant="secondary" className="!h-8 w-full !px-2 !text-[10px]" onClick={() => updateVariant(index, { barcode: createBarcodeValue() })}>Gen.</Button>
                                  </div>
                                  <div className="hidden xl:flex xl:items-end">
                                    <Button type="button" variant="secondary" className="!h-8 !w-9 !px-0" onClick={() => removeVariant(index)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === "photo" ? (
                <div className="mx-auto max-w-[520px]">
                  <Field label="Photo article" hint="PNG, JPG ou WEBP. Maximum 3 Mo. L'optimisation IA garde l'article sur fond blanc.">
                    <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImageChange} />
                    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex h-[300px] w-full items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-white">
                          {form.imageUrl ? (
                            <img src={form.imageUrl} alt="Apercu article" className="h-full w-full object-contain" />
                          ) : (
                            <span className="text-xs text-[#7a6d5f]">Aucune photo</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Button variant="secondary" type="button" onClick={() => imageInputRef.current?.click()}>
                            <Upload className="mr-2 h-4 w-4" />
                            Choisir une photo
                          </Button>
                          {form.imageUrl ? (
                            <Button type="button" onClick={() => void optimizePhoto()} disabled={photoProcessing}>
                              <Sparkles className="mr-2 h-4 w-4" />
                              {photoProcessing ? "Optimisation..." : "Optimiser photo IA"}
                            </Button>
                          ) : null}
                          {form.imageUrl ? (
                            <Button variant="secondary" type="button" onClick={() => onChange("imageUrl", "")}>
                              Supprimer la photo
                            </Button>
                          ) : null}
                        </div>
                        {photoMessage ? (
                          <div className="rounded-2xl border border-orange-300/20 bg-orange-300/10 px-4 py-3 text-sm text-orange-100">
                            {photoMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Field>
                </div>
              ) : null}
            </div>
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-white/10 pt-4">
            <Button variant="secondary" type="button" onClick={onClose}>Annuler</Button>
            <Button type="submit">{saving ? "Enregistrement..." : "Enregistrer"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProductsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<ProductMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const searchReadyRef = useRef(false);
  const canEditProducts = user?.roles.includes("admin") ?? false;
  const scopedWarehouseName = cleanWarehouseName(user?.defaultWarehouse?.name ?? null) || null;

  async function load(searchValue = "", options: { refreshMeta?: boolean; soft?: boolean } = {}) {
    if (!options.soft) setLoading(true);
    setError(null);
    try {
      const productsPromise = api<Product[]>(`/products${searchValue ? `?search=${encodeURIComponent(searchValue)}` : ""}`);
      const metadataPromise = !meta || options.refreshMeta ? api<ProductMeta>("/products/meta") : Promise.resolve(meta);
      const [products, metadata] = await Promise.all([productsPromise, metadataPromise]);
      setItems(products);
      setMeta(metadata);
      if (!form.warehouseId && metadata.warehouses[0]) {
        setForm((current) => ({ ...current, warehouseId: current.warehouseId || metadata.warehouses[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("", { refreshMeta: true });
  }, []);

  useEffect(() => {
    if (!searchReadyRef.current) {
      searchReadyRef.current = true;
      return;
    }
    const timeout = window.setTimeout(() => {
      void load(search, { soft: true });
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const pageSize = 20;

  const stats = useMemo(() => ({
    total: items.length,
    lowStock: items.filter((item) => item.stockOnHand <= item.minStock).length,
    stockValue: items.reduce((sum, item) => sum + item.stockOnHand * Number(item.purchasePriceTtc), 0)
  }), [items]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedItems = useMemo(() => items.slice((currentPage - 1) * pageSize, currentPage * pageSize), [items, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function patchForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function replaceVariants(variants: ProductVariantForm[]) {
    setForm((current) => ({ ...current, variants }));
  }

  function productToForm(product?: Product): ProductForm {
    if (!product) {
      return {
        ...defaultForm,
        warehouseId: meta?.warehouses[0]?.id ?? ""
      };
    }

    const dimensions = parseDimensions(product.dimensions);

    return {
      reference: product.reference,
      barcode: product.barcode ?? "",
      name: product.name,
      typeId: meta?.types.find((item) => item.name === product.type?.name)?.id ?? "",
      categoryId: meta?.categories.find((item) => item.name === product.category?.name)?.id ?? "",
      brandId: meta?.brands.find((item) => item.name === product.brand?.name)?.id ?? "",
      unitId: meta?.units.find((item) => item.name === product.unit?.name)?.id ?? "",
      warehouseId: meta?.warehouses.find((item) => item.name === product.warehouse?.name)?.id ?? "",
      purchasePriceHt: String(product.purchasePriceHt),
      purchasePriceTtc: String(product.purchasePriceTtc),
      salePriceHt: String(product.salePriceHt),
      salePriceTtc: String(product.salePriceTtc),
      promoPriceHt: String(product.promoPriceHt ?? "0"),
      promoPriceTtc: String(product.promoPriceTtc ?? "0"),
      promoPriceActive: Boolean(product.promoPriceActive),
      taxRate: String(product.taxRate),
      stockOnHand: String(product.stockOnHand),
      minStock: String(product.minStock),
      imageUrl: product.imageUrl ?? "",
      description: product.description ?? "",
      dimensionLength: dimensions.length,
      dimensionWidth: dimensions.width,
      dimensionHeight: dimensions.height,
      weight: product.weight ?? "",
      isTaxExempt: product.isTaxExempt,
      isCommissioned: product.isCommissioned,
      sourcingMode: product.sourcingMode,
      status: product.status,
      variants: (product.variants ?? []).map((variant) => ({
        color: variant.color ?? "",
        size: variant.size ?? "",
        reference: variant.reference ?? "",
        barcode: variant.barcode ?? "",
        stockOnHand: String(variant.stockOnHand ?? 0)
      }))
    };
  }

  function downloadCsvTemplate() {
    const link = document.createElement("a");
    link.href = "/modele-import-articles.csv";
    link.download = "modele-import-articles.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function openCreateModal() {
    if (!canEditProducts) return;
    setEditingId(null);
    setError(null);
    setForm(productToForm());
    setModalOpen(true);
  }

  async function startEdit(product: Product) {
    if (!canEditProducts) return;
    setEditingId(product.id);
    setError(null);
    try {
      const detailedProduct = await api<Product>(`/products/${product.id}`);
      setForm(productToForm(detailedProduct));
      setModalOpen(true);
    } catch (err) {
      setEditingId(null);
      setError(err instanceof Error ? err.message : "Chargement article impossible.");
    }
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (!canEditProducts) return;
    event.preventDefault();
    setSaving(true);
    setError(null);

    if (!form.barcode.trim()) {
      setSaving(false);
      setError("Code-barres article obligatoire.");
      return;
    }
    if (!form.sourcingMode) {
      setSaving(false);
      setError("Mode article obligatoire.");
      return;
    }
    if (form.promoPriceActive && Number(form.promoPriceTtc || 0) <= 0) {
      setSaving(false);
      setError("Renseigne le prix promo TTC.");
      return;
    }

    const variants = form.variants.map((variant, index) => ({
      color: variant.color.trim() || null,
      size: variant.size.trim() || null,
      reference: variant.reference.trim(),
      barcode: variant.barcode.trim(),
      stockOnHand: Number(variant.stockOnHand || 0),
      label: buildVariantLabel(form.name || `Article ${index + 1}`, variant.color, variant.size)
    }));

    if (variants.some((variant) => !variant.reference || !variant.barcode)) {
      setSaving(false);
      setError("Chaque variante doit avoir une reference et un code-barres.");
      return;
    }

    const selectedSourcingMode = form.sourcingMode as ProductSourcingMode;
    const payload = {
      ...form,
      barcode: form.barcode || null,
      imageUrl: form.imageUrl || null,
      description: form.description || null,
      dimensions: formatDimensions(form.dimensionLength, form.dimensionWidth, form.dimensionHeight),
      weight: form.weight || null,
      typeId: form.typeId || null,
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      unitId: form.unitId || null,
      warehouseId: form.warehouseId || null,
      promoPriceHt: form.promoPriceActive ? Number(form.promoPriceHt || 0) : null,
      promoPriceTtc: form.promoPriceActive ? Number(form.promoPriceTtc || 0) : null,
      promoPriceActive: form.promoPriceActive,
      sourcingMode: selectedSourcingMode,
      variants
    };

    try {
      if (editingId) {
        await api(`/products/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/products", { method: "POST", body: JSON.stringify(payload) });
      }
      setModalOpen(false);
      setEditingId(null);
      setForm(productToForm());
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!canEditProducts) return;
    if (!window.confirm("Supprimer cet article ?")) return;
    try {
      await api(`/products/${id}`, { method: "DELETE" });
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    if (!canEditProducts) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportMessage(null);
    setError(null);

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        throw new Error("Le fichier CSV est vide ou invalide.");
      }

      const chunkSize = 150;
      let created = 0;
      let updated = 0;
      const errors: ImportResult["errors"] = [];

      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize);
        const result = await api<ImportResult>("/products/import", {
          method: "POST",
          body: JSON.stringify({ rows: chunk })
        });

        created += result.created;
        updated += result.updated;
        errors.push(...result.errors.map((error) => ({ ...error, row: error.row + start })));
      }

      const summary = `${created} crees, ${updated} mis a jour${errors.length ? `, ${errors.length} ligne(s) en erreur` : ""}.`;
      setImportMessage(summary);
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import impossible.");
    } finally {
      setImporting(false);
    }
  }
  function openDetails(id: string) {
    navigate(`/gestion/produits/${id}`);
  }

  function handleRowKeyDown(event: ReactKeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetails(id);
    }
  }

  if (loading && !meta) return <LoadingBlock label="Chargement du catalogue articles..." />;

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Gestion"
          title="Articles"
          actions={
            <>
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={downloadCsvTemplate}>Modele CSV</Button>
              {canEditProducts ? <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} /> : null}
              {canEditProducts ? (
                <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {importing ? "Import..." : "Import CSV"}
                </Button>
              ) : null}
              <Button variant="secondary" className="!h-9 !px-3.5 !text-[13px]" onClick={() => void load(search)}>Actualiser</Button>
              {canEditProducts ? (
                <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nouvel article
                </Button>
              ) : null}
            </>
          }
        />

        <SectionCard
          title="Liste des articles"
          description={scopedWarehouseName
            ? `Boutique ${scopedWarehouseName}: ${formatNumber(stats.total)} articles, ${formatNumber(stats.lowStock)} en alerte, valorisation ${formatCurrency(stats.stockValue)}.`
            : `Catalogue: ${formatNumber(stats.total)} articles, ${formatNumber(stats.lowStock)} en alerte, valorisation ${formatCurrency(stats.stockValue)}.`}
          actions={<Input className="w-full min-w-[260px] md:w-[320px]" placeholder="Rechercher un article..." value={search} onChange={(event) => setSearch(event.target.value)} />}
        >
          <div className="mb-4 flex flex-wrap gap-3 text-xs text-[#baa999]">
            {importMessage ? <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">{importMessage}</span> : null}
          </div>
          {error ? <div className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          {items.length === 0 ? (
            <EmptyState title="Aucun article" description="Aucun article disponible pour cette boutique." compact action={canEditProducts ? <Button className="!h-9 !px-3.5 !text-[13px]" onClick={openCreateModal}>Nouvel article</Button> : undefined} />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Article</th>
                      <th>Reference</th>
                      <th>Prix vente TTC</th>
                      <th>Stock Globale</th>
                      <th>Statut</th>
                      {canEditProducts ? <th className="product-actions-sticky text-center">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((item) => (
                      <tr
                        key={item.id}
                        className="cursor-pointer"
                        tabIndex={0}
                        onClick={() => openDetails(item.id)}
                        onKeyDown={(event) => handleRowKeyDown(event, item.id)}
                      >
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                              {item.imageUrl ? (
                                <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                              ) : (
                                <span className="text-sm font-semibold uppercase text-[#bba999]">{item.name.slice(0, 1) || "A"}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-white">{item.name}</div>
                              <div className="mt-1 truncate text-xs text-[#b9aa9b]">{item.category?.name ?? "Sans categorie"} - {item.brand?.name ?? "Sans marque"}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div>{item.reference}</div>
                          <div className="mt-1 text-xs text-[#b9aa9b]">{item.barcode || item.type?.name || "-"}</div>
                        </td>
                        <td>{formatCurrency(Number(item.salePriceTtc))}</td>
                        <td>
                          <div className={item.stockOnHand < 0 ? "font-semibold text-rose-200" : undefined}>{formatNumber(item.stockOnHand)}</div>
                          <div className="mt-1 text-xs text-[#b9aa9b]">Min {formatNumber(item.minStock)}</div>
                        </td>
                        <td>
                          <Badge tone={item.status === "ACTIVE" ? (item.stockOnHand < 0 ? "danger" : item.stockOnHand <= item.minStock ? "warning" : "success") : "danger"}>
                            {item.status === "ACTIVE" ? "Actif" : "Inactif"}
                          </Badge>
                        </td>
                        {canEditProducts ? (
                          <td className="product-actions-sticky">
                            <div className="flex justify-center gap-1.5">
                              <Button variant="secondary" className="!h-8 !w-8 !px-0 !py-0" onClick={(event) => { event.stopPropagation(); void startEdit(item); }}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="secondary" className="!h-8 !w-8 !px-0 !py-0" onClick={(event) => { event.stopPropagation(); void remove(item.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm text-[#cdbfb1] md:flex-row md:items-center md:justify-between">
                <div>Page {currentPage} / {totalPages} - {formatNumber(items.length)} article(s)</div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>Precedent</Button>
                  <Button variant="secondary" className="!h-8 !px-3 !text-[12px]" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages}>Suivant</Button>
                </div>
              </div>
            </>
          )}
        </SectionCard>
      </div>

      <ProductModal
        open={modalOpen}
        title={editingId ? "Modifier l'article" : "Nouvel article"}
        form={form}
        meta={meta}
        error={error}
        saving={saving}
        onClose={closeModal}
        onSubmit={submit}
        onChange={patchForm}
        onVariantsChange={replaceVariants}
      />
    </>
  );
}

































