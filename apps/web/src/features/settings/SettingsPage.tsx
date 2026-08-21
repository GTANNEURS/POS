import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { getStoredTheme, saveTheme, type AppTheme } from "../../lib/theme";
import { Button, Field, Input, LoadingBlock, PageHeader, SectionCard, Textarea } from "../../components/ui/primitives";

type SettingRow = { key: string; value: unknown };
type Permission = { id: string; code: string; name?: string; label: string };
type Role = { id: string; name: string; label: string; rolePermissions: Array<{ permission: Permission }> };
type UserLoginMode = "admin" | "manager" | "caissier" | "operateur" | "autre";
type UserGroupTab = "admins" | "managers" | "caissiers" | "operateurs";
type BoutiqueTeamTab = "managers" | "caissiers" | "operateurs" | "vendeurs";
type UserRow = {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  defaultWarehouseId: string | null;
  loginMode: UserLoginMode;
  loginUsername: string;
  pinCode: string;
};
type SellerOption = { id: string; fullName: string };
type BoutiqueRow = { id: string; name: string; address: string; phone: string; managerName: string; sellerNames: string[]; ticketPrefix: string };
type BoutiqueOption = { id: string; name: string };
type CategoryOption = { id: string; name: string; typeId: string | null; typeName: string };
type ColorRow = { id: string; reference: string; name: string; type: string; isAvailable: boolean };
type SizeRow = { id: string; name: string; type: string };
type CurrencyRow = { id: string; code: string; name: string; symbol: string | null; rateFromMad: number; rateMode: "MANUAL" | "AUTO"; isBase: boolean; isActive: boolean };
type PaymentMethodRow = { id: string; code: string; label: string; isActive: boolean };
type SellerRow = { id: string; fullName: string; email: string; boutiqueId: string | null; boutiqueName: string; commissionRate: number; categoryIds: string[]; categoryNames: string[]; specialtyCategoryId?: string | null; specialtyCategoryName?: string };
type BoutiquesPayload = { boutiques: BoutiqueRow[]; sellers: SellerOption[] };
type SellersPayload = { sellers: SellerRow[]; boutiques: BoutiqueOption[]; categories: CategoryOption[] };
type ColorsPayload = { colors: ColorRow[]; types: string[] };
type SizesPayload = { sizes: SizeRow[]; types: string[] };
type TypeListPayload = { types: string[] };
type CurrenciesPayload = { baseCurrency: "MAD"; currencies: CurrencyRow[] };
type PaymentMethodsPayload = { paymentMethods: PaymentMethodRow[] };
type UsersPayload = { users: UserRow[]; roles: Role[]; permissions: Permission[]; warehouses: BoutiqueOption[] };
type PosBootstrapPayload = { warehouses: Array<{ id: string; name: string; type?: string }>; sellers: SellerOption[] };
type SettingsTab = "societe" | "tickets" | "boutique" | "utilisateurs" | "vendeurs" | "couleurs" | "tailles" | "devises" | "paiements";
type ReferenceSubTab = "elements" | "types";
type UserDetailTab = "infos" | "droits";
type TicketPrintType = "cash" | "reprint" | "detax" | "gift" | "credit";
type TicketPrintProfile = {
  label: string;
  enabled: boolean;
  fontFamily: string;
  baseFontSize: number;
  titleFontSize: number;
  itemFontSize: number;
  logoHeight: number;
  barcodeHeight: number;
  headerText: string;
  cgvText: string;
  footerText: string;
  fixedBottomText: string;
  showLogo: boolean;
  showCompanyName: boolean;
  showBoutique: boolean;
  showDate: boolean;
  showTicketNumber: boolean;
  showClient: boolean;
  showSeller: boolean;
  showArticles: boolean;
  showTotals: boolean;
  showPayments: boolean;
  showCgv: boolean;
  showFooter: boolean;
  showBarcode: boolean;
  showCompanyInfo: boolean;
};
type TicketPrintProfiles = Record<TicketPrintType, TicketPrintProfile>;

const CODE39_MAP: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
  "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn", "A": "wnnnnwnnw", "B": "nnwnnwnnw",
  "C": "wnwnnwnnn", "D": "nnnnwwnnw", "E": "wnnnwwnnn", "F": "nnwnwwnnn",
  "G": "nnnnnwwnw", "H": "wnnnnwwnn", "I": "nnwnnwwnn", "J": "nnnnwwwnn",
  "K": "wnnnnnnww", "L": "nnwnnnnww", "M": "wnwnnnnwn", "N": "nnnnwnnww",
  "O": "wnnnwnnwn", "P": "nnwnwnnwn", "Q": "nnnnnnwww", "R": "wnnnnnwwn",
  "S": "nnwnnnwwn", "T": "nnnnwnwwn", "U": "wwnnnnnnw", "V": "nwwnnnnnw",
  "W": "wwwnnnnnn", "X": "nwnnwnnnw", "Y": "wwnnwnnnn", "Z": "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn"
};

type SettingsForm = {
  company_name: string;
  company_currency: string;
  default_tax_rate: string;
  ticket_cgv: string;
  ticket_footer: string;
  company_logo_url: string;
  company_address: string;
  company_email: string;
  company_website: string;
  company_patente: string;
  company_ice: string;
  company_rc: string;
  company_cnss: string;
  product_colors: string;
  product_sizes: string;
  currencies: string;
  ticket_print_profiles: TicketPrintProfiles;
};

const defaultTicketPrintProfiles: TicketPrintProfiles = {
  cash: {
    label: "Ticket de caisse",
    enabled: true,
    fontFamily: "Arial",
    baseFontSize: 11,
    titleFontSize: 16,
    itemFontSize: 10,
    logoHeight: 18,
    barcodeHeight: 46,
    headerText: "",
    cgvText: `CONDITIONS GENERALES DE VENTE
- Merci de conserver ce ticket, il constitue votre preuve d'achat.
- Les echanges sont acceptes dans un delai de 7 jours sur presentation du ticket.
- Les articles doivent etre retournes dans leur etat d'origine avec etiquette.`,
    footerText: "Merci pour votre visite",
    fixedBottomText: "Merci pour votre visite",
    showLogo: true,
    showCompanyName: true,
    showBoutique: true,
    showDate: true,
    showTicketNumber: true,
    showClient: true,
    showSeller: true,
    showArticles: true,
    showTotals: true,
    showPayments: true,
    showCgv: true,
    showFooter: true,
    showBarcode: true,
    showCompanyInfo: true
  },
  reprint: {
    label: "Re-impression ticket",
    enabled: true,
    fontFamily: "Arial",
    baseFontSize: 11,
    titleFontSize: 16,
    itemFontSize: 10,
    logoHeight: 18,
    barcodeHeight: 46,
    headerText: "DUPLICATA",
    cgvText: "",
    footerText: "Merci pour votre visite",
    fixedBottomText: "Merci pour votre visite",
    showLogo: true,
    showCompanyName: true,
    showBoutique: true,
    showDate: true,
    showTicketNumber: true,
    showClient: true,
    showSeller: true,
    showArticles: true,
    showTotals: true,
    showPayments: true,
    showCgv: true,
    showFooter: true,
    showBarcode: true,
    showCompanyInfo: true
  },
  detax: {
    label: "Ticket detaxe",
    enabled: true,
    fontFamily: "Arial",
    baseFontSize: 11,
    titleFontSize: 15,
    itemFontSize: 10,
    logoHeight: 16,
    barcodeHeight: 44,
    headerText: "DETAXE",
    cgvText: "",
    footerText: "Document detaxe client",
    fixedBottomText: "Merci pour votre visite",
    showLogo: true,
    showCompanyName: true,
    showBoutique: true,
    showDate: true,
    showTicketNumber: true,
    showClient: true,
    showSeller: false,
    showArticles: true,
    showTotals: true,
    showPayments: false,
    showCgv: false,
    showFooter: true,
    showBarcode: true,
    showCompanyInfo: true
  },
  gift: {
    label: "Ticket cadeau",
    enabled: true,
    fontFamily: "Arial",
    baseFontSize: 11,
    titleFontSize: 15,
    itemFontSize: 10,
    logoHeight: 18,
    barcodeHeight: 42,
    headerText: "TICKET CADEAU",
    cgvText: "",
    footerText: "Echange possible selon conditions boutique.",
    fixedBottomText: "Merci pour votre visite",
    showLogo: true,
    showCompanyName: true,
    showBoutique: true,
    showDate: true,
    showTicketNumber: true,
    showClient: false,
    showSeller: false,
    showArticles: true,
    showTotals: false,
    showPayments: false,
    showCgv: false,
    showFooter: true,
    showBarcode: true,
    showCompanyInfo: false
  },
  credit: {
    label: "Ticket avoir",
    enabled: true,
    fontFamily: "Arial",
    baseFontSize: 11,
    titleFontSize: 15,
    itemFontSize: 10,
    logoHeight: 18,
    barcodeHeight: 46,
    headerText: "BON D'AVOIR",
    cgvText: "",
    footerText: "Bon valable uniquement dans la boutique d'origine.",
    fixedBottomText: "Merci pour votre visite",
    showLogo: true,
    showCompanyName: true,
    showBoutique: true,
    showDate: true,
    showTicketNumber: true,
    showClient: true,
    showSeller: false,
    showArticles: true,
    showTotals: true,
    showPayments: false,
    showCgv: false,
    showFooter: true,
    showBarcode: true,
    showCompanyInfo: true
  }
};

const defaultForm: SettingsForm = {
  company_name: "Galerie des Tanneurs",
  company_currency: "MAD",
  default_tax_rate: "20",
  ticket_cgv: `CONDITIONS GÉNÉRALES DE VENTE
• Merci de conserver ce ticket, il constitue votre preuve d'achat.

• Les échanges sont acceptés dans un délai de 7 jours à compter de la date d'achat, sur présentation du ticket de caisse.

• Les articles doivent être retournés dans leur état d'origine, non portés, non utilisés et munis de leurs étiquettes d'origine.

• Aucun remboursement en espèces ne sera effectué, sauf disposition légale contraire.

• Les articles soldés, promotionnels, personnalisés ou fabriqués sur mesure ne sont ni repris ni échangés.

• Les défauts résultant d'une mauvaise utilisation, d'un entretien inadapté, d'une usure normale ou d'un accident ne sont pas couverts.

• Toute réclamation doit être signalée dans les meilleurs délais auprès du service clientèle ou du magasin.`,
  ticket_footer: "Merci pour votre confiance.",
  company_logo_url: "",
  company_address: "",
  company_email: "",
  company_website: "",
  company_patente: "",
  company_ice: "",
  company_rc: "",
  company_cnss: "",
  product_colors: "Noir, Camel, Marron, Orange",
  product_sizes: "XS, S, M, L, XL",
  currencies: "MAD, EUR, USD",
  ticket_print_profiles: defaultTicketPrintProfiles
};

const tabs: Array<{ key: SettingsTab; label: string }> = [
  { key: "societe", label: "Societe" },
  { key: "tickets", label: "Tickets" },
  { key: "boutique", label: "Boutique" },
  { key: "utilisateurs", label: "Admins" },
  { key: "couleurs", label: "Couleurs" },
  { key: "tailles", label: "Tailles" },
  { key: "devises", label: "Devises" },
  { key: "paiements", label: "Modes de paiement" }
];

const boutiqueTeamTabs: Array<{ key: BoutiqueTeamTab; label: string; roleName?: string }> = [
  { key: "managers", label: "Managers", roleName: "manager" },
  { key: "caissiers", label: "Caissiers", roleName: "caissier" },
  { key: "operateurs", label: "Operateurs", roleName: "operateur_commandes" },
  { key: "vendeurs", label: "Vendeurs" }
];

function toList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeTicketPrintProfiles(value: unknown): TicketPrintProfiles {
  const source = value && typeof value === "object" ? value as Partial<Record<TicketPrintType, Partial<TicketPrintProfile>>> : {};
  return (Object.keys(defaultTicketPrintProfiles) as TicketPrintType[]).reduce((profiles, type) => ({
    ...profiles,
    [type]: {
      ...defaultTicketPrintProfiles[type],
      ...(source[type] && typeof source[type] === "object" ? source[type] : {})
    }
  }), {} as TicketPrintProfiles);
}

function settingString(value: unknown, fallback = "") {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : fallback;
}

function TicketPreview({ profile, form }: { profile: TicketPrintProfile; form: SettingsForm }) {
  const previewItems = [
    { name: "36H", reference: "A235", qty: 1, total: "1.490,00 MAD" },
    { name: "ABS GM", reference: "58507", qty: 1, total: "1.990,00 MAD" }
  ];
  const line = <div className="my-2 border-t border-dashed border-[#bca48d]" />;

  return (
    <div className="sticky top-4 rounded-[28px] border border-orange-300/20 bg-[#f8f1e7] p-4 text-[#17110d] shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
      <div
        className="mx-auto w-[272px] rounded-[10px] bg-white px-4 py-5 shadow-inner"
        style={{ fontFamily: `${profile.fontFamily}, Arial, sans-serif`, fontSize: `${profile.baseFontSize}px` }}
      >
        <div className="text-center">
          {profile.showLogo ? (
            <div className="mx-auto mb-2 flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#ffb15c] to-[#ff7a00] px-2" style={{ width: 58, height: profile.logoHeight + 18 }}>
              {form.company_logo_url ? <img src={form.company_logo_url} alt="Logo" className="max-h-full max-w-full object-contain mix-blend-multiply" /> : <span className="text-sm font-bold">GDT</span>}
            </div>
          ) : null}
          {profile.showCompanyName ? <div className="font-bold" style={{ fontSize: `${profile.titleFontSize}px` }}>{form.company_name || "Galerie des Tanneurs"}</div> : null}
          {profile.showBoutique ? <div className="font-semibold">Gueliz</div> : null}
          {profile.showDate ? <div className="text-[#6c5c4f]">12/06/2026 14:35</div> : null}
          {profile.headerText ? <div className="mt-2 inline-flex rounded-full border border-[#17110d] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]">{profile.headerText}</div> : null}
        </div>
        {line}
        {profile.showTicketNumber ? <div className="text-center font-bold" style={{ fontSize: `${profile.titleFontSize}px` }}>Ticket N° : GUE-266-1000012</div> : null}
        {profile.showClient ? <div><strong>Client :</strong> Client comptoir</div> : null}
        {profile.showSeller ? <div><strong>Vendeur :</strong> Nadia</div> : null}
        {profile.showArticles ? (
          <>
            {line}
            <div className="grid grid-cols-[1fr_34px_78px] gap-2 text-[9px] font-bold uppercase tracking-[0.08em] text-[#6c5c4f]">
              <span>Article</span><span className="text-center">Qte</span><span className="text-right">Total</span>
            </div>
            <div className="mt-1 space-y-2">
              {previewItems.map((item) => (
                <div key={item.reference} className="grid grid-cols-[1fr_34px_78px] gap-2" style={{ fontSize: `${profile.itemFontSize}px` }}>
                  <div><div className="font-semibold">{item.name}</div><div className="text-[8px] text-[#6c5c4f]">{item.reference}</div></div>
                  <div className="text-center">{item.qty}</div>
                  <div className="text-right">{profile.showTotals ? item.total : ""}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}
        {profile.showTotals ? <>{line}<div className="flex justify-between font-bold" style={{ fontSize: `${profile.titleFontSize - 1}px` }}><span>Total</span><span>3.480,00 MAD</span></div></> : null}
        {profile.showPayments ? <>{line}<div className="font-bold">Paiements</div><div className="text-[9px] uppercase tracking-[0.08em]">ESPECE - CARTE BANCAIRE</div></> : null}
        {(profile.showCgv || profile.showFooter || profile.showBarcode) ? (
          <>
            {line}
            {profile.showCgv ? <div className="whitespace-pre-line text-left text-[8px] leading-tight">{profile.cgvText || form.ticket_cgv}</div> : null}
            {profile.showFooter ? <div className="mt-2 text-center text-[10px]">{profile.footerText || form.ticket_footer}</div> : null}
            {profile.showBarcode ? <div className="mt-2 grid place-items-center"><div className="w-full bg-[repeating-linear-gradient(90deg,#111_0,#111_2px,#fff_2px,#fff_4px,#111_4px,#111_7px,#fff_7px,#fff_10px)]" style={{ height: profile.barcodeHeight }} /></div> : null}
          </>
        ) : null}
        {profile.showCompanyInfo ? <>{line}<div className="text-center text-[9px] text-[#6c5c4f]">{form.company_address || "Adresse societe"}<br />{form.company_email || "contact@gdt.local"}<br />{form.company_website || "www.gdt.ma"}</div></> : null}
        {profile.fixedBottomText ? <div className="mt-2 text-center text-[10px] text-[#6c5c4f]">{profile.fixedBottomText}</div> : null}
      </div>
    </div>
  );
}

function primaryUserMode(user: Pick<UserRow, "roles" | "loginMode">) {
  if (user.roles.includes("admin")) return "admin" as const;
  if (user.roles.includes("caissier")) return "caissier" as const;
  if (user.roles.includes("operateur_commandes")) return "operateur" as const;
  if (user.roles.includes("manager")) return "manager" as const;
  return "autre" as const;
}

function buildNewUserDraft(tab: UserGroupTab | BoutiqueTeamTab = "caissiers", defaultWarehouseId = "") {
  const roleNames =
    tab === "admins" ? ["admin"] :
    tab === "managers" ? ["manager"] :
    tab === "operateurs" ? ["operateur_commandes"] :
    ["caissier"];

  return {
    fullName: "",
    email: "",
    password: "ChangeMe123!",
    roleNames,
    isActive: true,
    defaultWarehouseId,
    loginUsername: "",
    pinCode: ""
  };
}

function sanitizeBarcodeValue(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.\- $/+%]/g, "-");
}

function accessCodeForUser(user: UserRow) {
  const mode = primaryUserMode(user);
  if (mode === "manager") return sanitizeBarcodeValue(`MGR-${user.loginUsername || user.fullName}`);
  if (mode === "operateur") return sanitizeBarcodeValue(`OPR-${user.loginUsername || user.fullName}`);
  if (mode === "caissier") return sanitizeBarcodeValue(`CSH-${user.pinCode || user.id.slice(-6)}`);
  return sanitizeBarcodeValue(`ADM-${user.email}`);
}

function buildCode39Svg(value: string, height = 56) {
  const encoded = `*${sanitizeBarcodeValue(value)}*`;
  let x = 0;
  const parts: string[] = [];
  for (const character of encoded) {
    const pattern = CODE39_MAP[character] ?? CODE39_MAP["-"];
    for (let index = 0; index < pattern.length; index += 1) {
      const isBar = index % 2 === 0;
      const width = pattern[index] === "w" ? 6 : 2;
      if (isBar) {
        parts.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#201812" rx="0.4" />`);
      }
      x += width;
    }
    x += 2;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height + 16}" preserveAspectRatio="none">${parts.join("")}<rect x="0" y="${height}" width="${x}" height="16" fill="transparent" /></svg>`;
}

function AccessBadgeCard({ user, warehouseName }: { user: UserRow; warehouseName: string }) {
  const accessCode = accessCodeForUser(user);
  const mode = primaryUserMode(user);
  const subtitle = mode === "manager" || mode === "operateur" ? user.loginUsername : mode === "caissier" ? `Code ${user.pinCode}` : user.email;
  const modeLabel = mode === "operateur" ? "operateur" : mode;

  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#bba896]">{modeLabel}</p>
          <p className="mt-1 truncate text-xs text-[#e7dbcf]">{subtitle}</p>
          <p className="mt-1 truncate text-[11px] text-[#bcae9f]">{warehouseName}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${user.isActive ? "bg-emerald-400/15 text-emerald-100" : "bg-white/5 text-[#cbbcae]"}`}>{user.isActive ? "Actif" : "Inactif"}</span>
      </div>
      {mode !== "admin" ? (
        <div className="mt-3 rounded-[18px] border border-white/10 bg-[#f4eadf] px-3 py-2">
          <div className="h-14 w-full" dangerouslySetInnerHTML={{ __html: buildCode39Svg(accessCode) }} />
          <p className="mt-2 text-center font-mono text-[11px] tracking-[0.18em] text-[#2b2017]">{accessCode}</p>
        </div>
      ) : null}
    </div>
  );
}

function ReferenceTab({
  title,
  description,
  label,
  value,
  placeholder,
  onChange,
  onSubmit,
  saving,
  message
}: {
  title: string;
  description: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  message: string | null;
}) {
  return (
    <SectionCard title={title} description={description}>
      <form className="space-y-4" onSubmit={onSubmit}>
        <Field label={label}>
          <Textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {toList(value).map((item) => <span key={item} className="badge">{item}</span>)}
          {!toList(value).length ? <span className="text-sm text-[#bcae9f]">Aucune valeur enregistree.</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <Button className="!px-3 !py-2 text-xs" type="submit">{saving ? "Enregistrement..." : "Sauvegarder"}</Button>
          {message ? <span className="text-sm text-[#e5d8cb]">{message}</span> : null}
        </div>
      </form>
    </SectionCard>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("societe");
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SettingsForm>(defaultForm);
  const [boutiques, setBoutiques] = useState<BoutiqueRow[]>([]);
  const [sellerOptions, setSellerOptions] = useState<SellerOption[]>([]);
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [initialUserRows, setInitialUserRows] = useState<UserRow[]>([]);
  const [userRoles, setUserRoles] = useState<Role[]>([]);
  const [userPermissions, setUserPermissions] = useState<Permission[]>([]);
  const [userWarehouses, setUserWarehouses] = useState<BoutiqueOption[]>([]);
  const [sellerRows, setSellerRows] = useState<SellerRow[]>([]);
  const [sellerBoutiques, setSellerBoutiques] = useState<BoutiqueOption[]>([]);
  const [sellerCategories, setSellerCategories] = useState<CategoryOption[]>([]);
  const [colors, setColors] = useState<ColorRow[]>([]);
  const [colorTypes, setColorTypes] = useState<string[]>(["Maroquinerie", "Chaussure", "Vetement"]);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [newColorOpen, setNewColorOpen] = useState(false);
  const [newColor, setNewColor] = useState({ reference: "", name: "", type: "Maroquinerie", isAvailable: true });
  const [colorSubTab, setColorSubTab] = useState<ReferenceSubTab>("elements");
  const [colorTypeFilter, setColorTypeFilter] = useState("");
  const [colorSearch, setColorSearch] = useState("");
  const [newColorType, setNewColorType] = useState("");
  const [editingColorType, setEditingColorType] = useState<string | null>(null);
  const [colorTypeDraft, setColorTypeDraft] = useState("");
  const [sizes, setSizes] = useState<SizeRow[]>([]);
  const [sizeTypes, setSizeTypes] = useState<string[]>(["Chaussure femme", "Chaussure homme", "Sportswear", "Vetement femme", "Vetement homme", "Size"]);
  const [editingSizeId, setEditingSizeId] = useState<string | null>(null);
  const [newSizeOpen, setNewSizeOpen] = useState(false);
  const [newSize, setNewSize] = useState({ name: "", type: "Size" });
  const [sizeSubTab, setSizeSubTab] = useState<ReferenceSubTab>("elements");
  const [newSizeType, setNewSizeType] = useState("");
  const [editingSizeType, setEditingSizeType] = useState<string | null>(null);
  const [sizeTypeDraft, setSizeTypeDraft] = useState("");
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [editingCurrencyId, setEditingCurrencyId] = useState<string | null>(null);
  const [newCurrencyOpen, setNewCurrencyOpen] = useState(false);
  const [newCurrency, setNewCurrency] = useState({ code: "", name: "", symbol: "", rateFromMad: "1", rateMode: "MANUAL" as "MANUAL" | "AUTO", isActive: true });
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [newPaymentMethodOpen, setNewPaymentMethodOpen] = useState(false);
  const [newPaymentMethod, setNewPaymentMethod] = useState({ code: "", label: "" });
  const [selectedBoutiqueId, setSelectedBoutiqueId] = useState<string | null>(null);
  const [editingBoutique, setEditingBoutique] = useState(false);
  const [newBoutiqueOpen, setNewBoutiqueOpen] = useState(false);
  const [newBoutique, setNewBoutique] = useState({ name: "", address: "", phone: "", managerName: "", sellerNames: [] as string[], ticketPrefix: "" });
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [editingSeller, setEditingSeller] = useState(false);
  const [newSellerOpen, setNewSellerOpen] = useState(false);
  const [newSeller, setNewSeller] = useState({ fullName: "", boutiqueId: "", commissionRate: "0", categoryIds: [] as string[] });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState(false);
  const [userDetailTab, setUserDetailTab] = useState<UserDetailTab>("infos");
  const [selectedUserPassword, setSelectedUserPassword] = useState("");
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [userGroupTab, setUserGroupTab] = useState<UserGroupTab>("admins");
  const [boutiqueTeamTab, setBoutiqueTeamTab] = useState<BoutiqueTeamTab>("managers");
  const [newUser, setNewUser] = useState(buildNewUserDraft("admins"));
  const [selectedPrintType, setSelectedPrintType] = useState<TicketPrintType>("cash");

  const selectedBoutique = boutiques.find((boutique) => boutique.id === selectedBoutiqueId) ?? null;
  const selectedSeller = sellerRows.find((seller) => seller.id === selectedSellerId) ?? null;
  const selectedUser = userRows.find((user) => user.id === selectedUserId) ?? null;
  const cashierRows = userRows.filter((user) => user.roles.includes("caissier"));
  const adminUsers = userRows.filter((user) => primaryUserMode(user) === "admin");
  const managerUsers = userRows.filter((user) => primaryUserMode(user) === "manager");
  const groupedCashierUsers = userRows.filter((user) => primaryUserMode(user) === "caissier");
  const operatorUsers = userRows.filter((user) => primaryUserMode(user) === "operateur");
  const selectedBoutiqueCashiers = selectedBoutique ? cashierRows.filter((user) => user.defaultWarehouseId === selectedBoutique.id) : [];
  const selectedBoutiqueManagers = selectedBoutique ? managerUsers.filter((user) => user.defaultWarehouseId === selectedBoutique.id) : [];
  const selectedBoutiqueOperators = selectedBoutique ? operatorUsers.filter((user) => user.defaultWarehouseId === selectedBoutique.id) : [];
  const selectedBoutiqueSellers = selectedBoutique ? sellerRows.filter((seller) => seller.boutiqueId === selectedBoutique.id || selectedBoutique.sellerNames.includes(seller.fullName)) : [];
  const selectedBoutiqueTeamCount = selectedBoutiqueManagers.length + selectedBoutiqueCashiers.length + selectedBoutiqueOperators.length + selectedBoutiqueSellers.length;
  const selectedUserMode = selectedUser ? primaryUserMode(selectedUser) : "manager";
  const newUserMode = primaryUserMode({
    roles: newUser.roleNames,
    loginMode:
      newUser.roleNames.includes("admin") ? "admin" :
      newUser.roleNames.includes("caissier") ? "caissier" :
      newUser.roleNames.includes("operateur_commandes") ? "operateur" :
      "manager"
  });
  const selectedUserWarehouseName = selectedUser?.defaultWarehouseId
    ? userWarehouses.find((warehouse) => warehouse.id === selectedUser.defaultWarehouseId)?.name ?? "Boutique inconnue"
    : "Toutes boutiques";
  const sellerCategoryTypes = Array.from(new Map(sellerCategories.map((category) => [category.typeId ?? "__none", { id: category.typeId ?? "__none", name: category.typeName || "Sans type" }])).values());
  const selectedUserPermissions = selectedUser ? Array.from(new Map(userRoles.filter((role) => selectedUser.roles.includes(role.name)).flatMap((role) => role.rolePermissions.map((item) => [item.permission.id, item.permission] as const))).values()) : [];
  const selectedPrintProfile = form.ticket_print_profiles[selectedPrintType];

  function extractFriendlyPasswordMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error ?? "");
    if (raw.includes("\"path\":[\"password\"]") && raw.includes("\"minimum\":6")) {
      return "Le mot de passe doit contenir au moins 6 caracteres.";
    }
    return raw || "Operation impossible.";
  }

  function validateNewUserPassword(password: string, roleNames: string[]) {
    if (roleNames.includes("caissier")) {
      return null;
    }
    if (password.trim().length < 6) {
      return "Le mot de passe est obligatoire et doit contenir au moins 6 caracteres.";
    }
    return null;
  }

  function validateSelectedUserPassword(password: string) {
    if (!password.trim()) {
      return null;
    }
    if (password.trim().length < 6) {
      return "Le nouveau mot de passe doit contenir au moins 6 caracteres.";
    }
    return null;
  }

  function changeTheme(nextTheme: AppTheme) {
    setTheme(nextTheme);
    saveTheme(nextTheme);
    setMessage(nextTheme === "light" ? "Theme clair active." : "Theme sombre active.");
  }

  function updateTicketPrintProfile(type: TicketPrintType, patch: Partial<TicketPrintProfile>) {
    setForm((current) => ({
      ...current,
      ticket_print_profiles: {
        ...current.ticket_print_profiles,
        [type]: {
          ...current.ticket_print_profiles[type],
          ...patch
        }
      }
    }));
  }

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const data = await api<SettingRow[]>("/settings");
      const rawSettings = Object.fromEntries(data.map((item) => [item.key, item.value]));
      const mapped = Object.fromEntries(data.map((item) => [item.key, settingString(item.value)]));
      setForm({
        company_name: mapped.company_name || defaultForm.company_name,
        company_currency: mapped.company_currency || defaultForm.company_currency,
        default_tax_rate: mapped.default_tax_rate || defaultForm.default_tax_rate,
        ticket_cgv: mapped.ticket_cgv || defaultForm.ticket_cgv,
        ticket_footer: mapped.ticket_footer || defaultForm.ticket_footer,
        company_logo_url: mapped.company_logo_url || defaultForm.company_logo_url,
        company_address: mapped.company_address || defaultForm.company_address,
        company_email: mapped.company_email || defaultForm.company_email,
        company_website: mapped.company_website || defaultForm.company_website,
        company_patente: mapped.company_patente || defaultForm.company_patente,
        company_ice: mapped.company_ice || defaultForm.company_ice,
        company_rc: mapped.company_rc || defaultForm.company_rc,
        company_cnss: mapped.company_cnss || defaultForm.company_cnss,
        product_colors: mapped.product_colors || defaultForm.product_colors,
        product_sizes: mapped.product_sizes || defaultForm.product_sizes,
        currencies: mapped.currencies || defaultForm.currencies,
        ticket_print_profiles: normalizeTicketPrintProfiles(rawSettings.ticket_print_profiles)
      });

      const boutiquesPromise = api<BoutiquesPayload>("/settings/boutiques")
        .then((boutiqueData) => ({
          boutiques: boutiqueData.boutiques,
          sellerOptions: boutiqueData.sellers,
          fallbackSellers: boutiqueData.sellers,
          fallbackBoutiques: boutiqueData.boutiques.map((boutique) => ({ id: boutique.id, name: boutique.name })),
          message: null as string | null
        }))
        .catch(async () => {
          try {
            const fallback = await api<PosBootstrapPayload>("/pos/bootstrap");
            return {
              boutiques: fallback.warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name, address: "", phone: "", managerName: "", sellerNames: [], ticketPrefix: "" })),
              sellerOptions: fallback.sellers,
              fallbackSellers: fallback.sellers,
              fallbackBoutiques: fallback.warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name })),
              message: null as string | null
            };
          } catch {
            return {
              boutiques: [],
              sellerOptions: [],
              fallbackSellers: [],
              fallbackBoutiques: [],
              message: "Boutiques indisponibles. Relance l'API pour activer la nouvelle route."
            };
          }
        });

      const usersPromise = api<UsersPayload>("/users").catch(() => null);
      const sellersPromise = api<SellersPayload>("/settings/sellers").catch(() => null);
      const colorsPromise = api<ColorsPayload>("/settings/colors").catch(() => null);
      const sizesPromise = api<SizesPayload>("/settings/sizes").catch(() => null);
      const currenciesPromise = api<CurrenciesPayload>("/settings/currencies").catch(() => null);
      const paymentMethodsPromise = api<PaymentMethodsPayload>("/settings/payment-methods").catch(() => null);

      const [boutiqueResult, userData, sellerData, colorData, sizeData, currencyData, paymentMethodsData] = await Promise.all([
        boutiquesPromise,
        usersPromise,
        sellersPromise,
        colorsPromise,
        sizesPromise,
        currenciesPromise,
        paymentMethodsPromise
      ]);

      setBoutiques(boutiqueResult.boutiques);
      setSellerOptions(boutiqueResult.sellerOptions);
      if (boutiqueResult.message) {
        setMessage(boutiqueResult.message);
      }

      if (userData) {
        setUserRows(userData.users);
        setInitialUserRows(userData.users);
        setUserRoles(userData.roles);
        setUserPermissions(userData.permissions);
        setUserWarehouses(userData.warehouses ?? []);
      } else {
        setUserRows([]);
        setInitialUserRows([]);
        setUserRoles([]);
        setUserPermissions([]);
        setUserWarehouses([]);
      }

      if (sellerData) {
        setSellerRows(sellerData.sellers);
        setSellerBoutiques(sellerData.boutiques);
        setSellerCategories(sellerData.categories);
      } else {
        setSellerRows(boutiqueResult.fallbackSellers.map((seller) => ({ id: seller.id, fullName: seller.fullName, email: "", boutiqueId: null, boutiqueName: "", commissionRate: 0, categoryIds: [], categoryNames: [] })));
        setSellerBoutiques(boutiqueResult.fallbackBoutiques);
        setSellerCategories([]);
      }

      if (colorData) {
        setColors(colorData.colors);
        setColorTypes(colorData.types);
      } else {
        setColors([]);
      }

      if (sizeData) {
        setSizes(sizeData.sizes);
        setSizeTypes(sizeData.types);
      } else {
        setSizes([]);
      }

      setCurrencies(currencyData?.currencies ?? []);
      setPaymentMethods(paymentMethodsData?.paymentMethods ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Chargement des parametres impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    await api("/settings", { method: "PUT", body: JSON.stringify({ ...form, default_tax_rate: Number(form.default_tax_rate) }) });
    setSaving(false);
    setMessage("Parametres enregistres.");
    await load();
  }

  async function submitTicketProfiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api("/settings", { method: "PUT", body: JSON.stringify({ ...form, default_tax_rate: Number(form.default_tax_rate) }) });
      setMessage("Personnalisation des tickets enregistree.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sauvegarde des tickets impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submitBoutiques(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api("/settings/boutiques", { method: "PUT", body: JSON.stringify({ boutiques }) });
      const changedTeamUsers = userRows.filter((user) => primaryUserMode(user) !== "admin").filter((user) => {
        const initialUser = initialUserRows.find((item) => item.id === user.id);
        return (initialUser?.defaultWarehouseId ?? null) !== (user.defaultWarehouseId ?? null);
      });
      if (changedTeamUsers.length) {
        await Promise.all(changedTeamUsers.map((user) => api<UserRow>(`/users/${user.id}`, {
          method: "PUT",
          body: JSON.stringify({
            fullName: user.fullName,
            email: user.email,
            password: "",
            roleNames: user.roles,
            isActive: user.isActive,
            defaultWarehouseId: user.defaultWarehouseId || null,
            loginUsername: user.loginUsername || "",
            pinCode: user.pinCode || ""
          })
        })));
      }
      if (sellerRows.length) {
        await api("/settings/sellers", {
          method: "PUT",
          body: JSON.stringify({
            sellers: sellerRows.map((seller) => ({
              id: seller.id,
              boutiqueId: seller.boutiqueId || null,
              commissionRate: Number(seller.commissionRate || 0),
              categoryIds: seller.categoryIds || []
            }))
          })
        });
      }
      setMessage("Boutiques mises a jour.");
      setEditingBoutique(false);
      setSelectedBoutiqueId(null);
      await load();
    } catch {
      setMessage("Sauvegarde boutique indisponible. Relance l'API pour activer la nouvelle route.");
    } finally {
      setSaving(false);
    }
  }

  async function saveBoutiqueTeam() {
    setSaving(true);
    setMessage(null);
    try {
      await api("/settings/boutiques", { method: "PUT", body: JSON.stringify({ boutiques }) });
      const changedTeamUsers = userRows.filter((user) => primaryUserMode(user) !== "admin").filter((user) => {
        const initialUser = initialUserRows.find((item) => item.id === user.id);
        return (initialUser?.defaultWarehouseId ?? null) !== (user.defaultWarehouseId ?? null);
      });
      if (changedTeamUsers.length) {
        await Promise.all(changedTeamUsers.map((user) => api<UserRow>(`/users/${user.id}`, {
          method: "PUT",
          body: JSON.stringify({
            fullName: user.fullName,
            email: user.email,
            password: "",
            roleNames: user.roles,
            isActive: user.isActive,
            defaultWarehouseId: user.defaultWarehouseId || null,
            loginUsername: user.loginUsername || "",
            pinCode: user.pinCode || ""
          })
        })));
      }
      if (sellerRows.length) {
        await api("/settings/sellers", {
          method: "PUT",
          body: JSON.stringify({
            sellers: sellerRows.map((seller) => ({
              id: seller.id,
              boutiqueId: seller.boutiqueId || null,
              commissionRate: Number(seller.commissionRate || 0),
              categoryIds: seller.categoryIds || []
            }))
          })
        });
      }
      setMessage("Equipe boutique mise a jour.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sauvegarde equipe boutique impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function submitSellers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api("/settings/sellers", {
        method: "PUT",
        body: JSON.stringify({
          sellers: sellerRows.map((seller) => ({
            id: seller.id,
            boutiqueId: seller.boutiqueId || null,
            commissionRate: Number(seller.commissionRate || 0),
            categoryIds: seller.categoryIds || []
          }))
        })
      });
      setMessage("Vendeurs mis a jour.");
      setEditingSeller(false);
      setSelectedSellerId(null);
      await load();
    } catch {
      setMessage("Sauvegarde vendeur indisponible. Relance l'API pour activer la nouvelle route.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSeller(seller: SellerRow) {
    if (!window.confirm(`Supprimer le vendeur ${seller.fullName} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/settings/sellers/${seller.id}`, { method: "DELETE" });
      setSellerRows((current) => current.filter((item) => item.id !== seller.id));
      setSelectedSellerId(null);
      setEditingSeller(false);
      setMessage("Vendeur supprime.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression vendeur impossible.");
    } finally {
      setSaving(false);
    }
  }
  async function createSeller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        fullName: newSeller.fullName,
        boutiqueId: newSeller.boutiqueId || null,
        commissionRate: Number(newSeller.commissionRate || 0),
        categoryIds: newSeller.categoryIds
      };
      const created = await api<SellerRow>("/settings/sellers", { method: "POST", body: JSON.stringify(payload) });
      setSellerRows((current) => [...current, created]);
      setNewSeller({ fullName: "", boutiqueId: "", commissionRate: "0", categoryIds: [] });
      setNewSellerOpen(false);
      setSelectedSellerId(null);
      setMessage("Vendeur cree.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation vendeur impossible.");
    } finally {
      setSaving(false);
    }
  }

  function roleLabel(roleName: string) {
    return userRoles.find((role) => role.name === roleName)?.label ?? roleName;
  }

  function updateUser(id: string, patch: Partial<UserRow>) {
    setUserRows((current) => current.map((user) => user.id === id ? { ...user, ...patch } : user));
  }

  function toggleUserRole(userId: string, roleName: string) {
    const user = userRows.find((item) => item.id === userId);
    const current = user?.roles ?? [];
    const roles = current.includes(roleName) ? current.filter((item) => item !== roleName) : [...current, roleName];
    updateUser(userId, { roles: roles.length ? roles : current });
  }

  function toggleNewUserRole(roleName: string) {
    setNewUser((current) => {
      const roleNames = current.roleNames.includes(roleName) ? current.roleNames.filter((item) => item !== roleName) : [...current.roleNames, roleName];
      return { ...current, roleNames: roleNames.length ? roleNames : current.roleNames };
    });
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const passwordError = validateNewUserPassword(newUser.password, newUser.roleNames);
    if (passwordError) {
      setMessage(passwordError);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const created = await api<UserRow>("/users", { method: "POST", body: JSON.stringify(newUser) });
      setUserRows((current) => [created, ...current]);
      setNewUser(activeTab === "boutique" && selectedBoutique ? buildNewUserDraft(boutiqueTeamTab, selectedBoutique.id) : buildNewUserDraft(userGroupTab));
      setNewUserOpen(false);
      setMessage("Utilisateur cree.");
      await load();
    } catch (err) {
      setMessage(extractFriendlyPasswordMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveUser(user: UserRow) {
    const passwordError = validateSelectedUserPassword(selectedUserPassword);
    if (passwordError) {
      setMessage(passwordError);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<UserRow>(`/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          fullName: user.fullName,
          email: user.email,
          password: selectedUserPassword.trim(),
          roleNames: user.roles,
          isActive: user.isActive,
          defaultWarehouseId: user.defaultWarehouseId || null,
          loginUsername: user.loginUsername || "",
          pinCode: user.pinCode || ""
        })
      });
      setUserRows((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSelectedUserPassword("");
      setEditingUser(false);
      setMessage("Utilisateur mis a jour.");
      await load();
    } catch (err) {
      setMessage(extractFriendlyPasswordMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: UserRow) {
    if (!window.confirm(`Supprimer l'utilisateur ${user.fullName} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/users/${user.id}`, { method: "DELETE" });
      setUserRows((current) => current.filter((item) => item.id !== user.id));
      setInitialUserRows((current) => current.filter((item) => item.id !== user.id));
      if (selectedUserId === user.id) {
        setSelectedUserId(null);
        setEditingUser(false);
        setSelectedUserPassword("");
      }
      setMessage("Utilisateur supprime.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression utilisateur impossible.");
    } finally {
      setSaving(false);
    }
  }

  function printUserBadge(user: UserRow) {
    const mode = primaryUserMode(user);
    if (mode === "admin") {
      setMessage("Le badge imprimable est prevu pour les managers et caissiers.");
      return;
    }
    const warehouseName = user.defaultWarehouseId ? userWarehouses.find((warehouse) => warehouse.id === user.defaultWarehouseId)?.name ?? "Boutique non affectee" : "Boutique non affectee";
    const code = accessCodeForUser(user);
    const barcode = buildCode39Svg(code, 44);
    const subtitle = mode === "manager" || mode === "operateur" ? `Utilisateur : ${user.loginUsername}` : `Code : ${user.pinCode}`;
    const popup = window.open("", "_blank", "width=420,height=260");
    if (!popup) {
      setMessage("Autorise les fenetres popup pour imprimer le badge.");
      return;
    }
    popup.document.write(`
      <html>
        <head>
          <title>Badge ${user.fullName}</title>
          <style>
            @page { size: 85.6mm 54mm; margin: 0; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, sans-serif; background: #f2e8dc; }
            .badge {
              width: 85.6mm;
              height: 54mm;
              padding: 5mm;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              background: linear-gradient(135deg, #2c1d13 0%, #4a2d17 100%);
              color: #fff7ee;
            }
            .top { display: flex; justify-content: space-between; gap: 10px; }
            .brand { font-size: 8px; letter-spacing: 0.35em; text-transform: uppercase; color: #f4c28d; }
            .role { font-size: 9px; text-transform: uppercase; letter-spacing: 0.2em; color: #f6d7b0; text-align: right; }
            .name { margin-top: 4px; font-size: 18px; font-weight: 700; line-height: 1.1; }
            .meta { font-size: 10px; line-height: 1.5; color: #f3dfc6; }
            .barcode-wrap { border-radius: 10px; background: #f5eadf; padding: 8px 10px 6px; }
            .barcode-text { margin-top: 5px; text-align: center; color: #281d15; font: 700 10px/1 monospace; letter-spacing: 0.22em; }
          </style>
        </head>
        <body>
          <div class="badge">
            <div class="top">
              <div>
                <div class="brand">GDT SUITE</div>
                <div class="name">${user.fullName}</div>
              </div>
              <div class="role">${mode}</div>
            </div>
            <div class="meta">
              <div>${subtitle}</div>
              <div>${warehouseName}</div>
            </div>
            <div class="barcode-wrap">
              ${barcode}
              <div class="barcode-text">${code}</div>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    popup.document.close();
  }
  function updateColor(id: string, patch: Partial<ColorRow>) {
    setColors((current) => current.map((color) => color.id === id ? { ...color, ...patch } : color));
  }

  async function createColor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const created = await api<ColorRow>("/settings/colors", { method: "POST", body: JSON.stringify(newColor) });
      setColors((current) => [...current, created]);
      setNewColor({ reference: "", name: "", type: colorTypes[0] ?? "Maroquinerie", isAvailable: true });
      setNewColorOpen(false);
      setMessage("Couleur creee.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation couleur impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveColor(color: ColorRow) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<ColorRow>(`/settings/colors/${color.id}`, { method: "PUT", body: JSON.stringify({ reference: color.reference, name: color.name, type: color.type, isAvailable: color.isAvailable }) });
      setColors((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingColorId(null);
      setMessage("Couleur mise a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mise a jour couleur impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteColor(color: ColorRow) {
    if (!window.confirm(`Supprimer la couleur ${color.name} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/settings/colors/${color.id}`, { method: "DELETE" });
      setColors((current) => current.filter((item) => item.id !== color.id));
      setMessage("Couleur supprimee.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression couleur impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function createColorType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = await api<TypeListPayload>("/settings/color-types", { method: "POST", body: JSON.stringify({ name: newColorType }) });
      setColorTypes(payload.types);
      setNewColorType("");
      setMessage("Type couleur cree.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation type couleur impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveColorType(type: string) {
    setSaving(true);
    setMessage(null);
    try {
      const nextName = colorTypeDraft.trim();
      const payload = await api<TypeListPayload>(`/settings/color-types/${encodeURIComponent(type)}`, { method: "PUT", body: JSON.stringify({ name: nextName }) });
      setColorTypes(payload.types);
      setColors((current) => current.map((color) => color.type === type ? { ...color, type: nextName } : color));
      setEditingColorType(null);
      setColorTypeDraft("");
      setMessage("Type couleur mis a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mise a jour type couleur impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteColorType(type: string) {
    if (!window.confirm(`Supprimer le type couleur ${type} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = await api<TypeListPayload>(`/settings/color-types/${encodeURIComponent(type)}`, { method: "DELETE" });
      setColorTypes(payload.types);
      setMessage("Type couleur supprime.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression type couleur impossible.");
    } finally {
      setSaving(false);
    }
  }

  function updateSize(id: string, patch: Partial<SizeRow>) {
    setSizes((current) => current.map((size) => size.id === id ? { ...size, ...patch } : size));
  }

  async function createSize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const created = await api<SizeRow>("/settings/sizes", { method: "POST", body: JSON.stringify(newSize) });
      setSizes((current) => [...current, created]);
      setNewSize({ name: "", type: sizeTypes[0] ?? "Size" });
      setNewSizeOpen(false);
      setMessage("Taille creee.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation taille impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSize(size: SizeRow) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<SizeRow>(`/settings/sizes/${size.id}`, { method: "PUT", body: JSON.stringify({ name: size.name, type: size.type }) });
      setSizes((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingSizeId(null);
      setMessage("Taille mise a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mise a jour taille impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSize(size: SizeRow) {
    if (!window.confirm(`Supprimer la taille ${size.name} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/settings/sizes/${size.id}`, { method: "DELETE" });
      setSizes((current) => current.filter((item) => item.id !== size.id));
      setMessage("Taille supprimee.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression taille impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function createSizeType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = await api<TypeListPayload>("/settings/size-types", { method: "POST", body: JSON.stringify({ name: newSizeType }) });
      setSizeTypes(payload.types);
      setNewSizeType("");
      setMessage("Type taille cree.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation type taille impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSizeType(type: string) {
    setSaving(true);
    setMessage(null);
    try {
      const nextName = sizeTypeDraft.trim();
      const payload = await api<TypeListPayload>(`/settings/size-types/${encodeURIComponent(type)}`, { method: "PUT", body: JSON.stringify({ name: nextName }) });
      setSizeTypes(payload.types);
      setSizes((current) => current.map((size) => size.type === type ? { ...size, type: nextName } : size));
      setEditingSizeType(null);
      setSizeTypeDraft("");
      setMessage("Type taille mis a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mise a jour type taille impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSizeType(type: string) {
    if (!window.confirm(`Supprimer le type taille ${type} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = await api<TypeListPayload>(`/settings/size-types/${encodeURIComponent(type)}`, { method: "DELETE" });
      setSizeTypes(payload.types);
      setMessage("Type taille supprime.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression type taille impossible.");
    } finally {
      setSaving(false);
    }
  }

  function updateCurrency(id: string, patch: Partial<CurrencyRow>) {
    setCurrencies((current) => current.map((currency) => currency.id === id ? { ...currency, ...patch } : currency));
  }

  async function createCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = { ...newCurrency, rateFromMad: Number(newCurrency.rateFromMad || 1) };
      const created = await api<CurrencyRow>("/settings/currencies", { method: "POST", body: JSON.stringify(payload) });
      setCurrencies((current) => [...current, created]);
      setNewCurrency({ code: "", name: "", symbol: "", rateFromMad: "1", rateMode: "MANUAL", isActive: true });
      setNewCurrencyOpen(false);
      setMessage("Devise creee.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation devise impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrency(currency: CurrencyRow) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<CurrencyRow>(`/settings/currencies/${currency.id}`, { method: "PUT", body: JSON.stringify({ code: currency.code, name: currency.name, symbol: currency.symbol || "", rateFromMad: Number(currency.rateFromMad || 1), rateMode: currency.rateMode, isActive: currency.isActive }) });
      setCurrencies((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingCurrencyId(null);
      setMessage("Devise mise a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mise a jour devise impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshCurrency(currency: CurrencyRow) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<CurrencyRow>(`/settings/currencies/${currency.id}/refresh`, { method: "POST" });
      setCurrencies((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage("Taux automatique mis a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Taux automatique indisponible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCurrency(currency: CurrencyRow) {
    if (!window.confirm(`Supprimer la devise ${currency.code} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/settings/currencies/${currency.id}`, { method: "DELETE" });
      setCurrencies((current) => current.filter((item) => item.id !== currency.id));
      setMessage("Devise supprimee.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression devise impossible.");
    } finally {
      setSaving(false);
    }
  }
  function updatePaymentMethod(id: string, patch: Partial<PaymentMethodRow>) {
    setPaymentMethods((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function createPaymentMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = { code: newPaymentMethod.code.trim().toUpperCase(), label: newPaymentMethod.label.trim() };
      const created = await api<PaymentMethodRow>("/settings/payment-methods", { method: "POST", body: JSON.stringify(payload) });
      setPaymentMethods((current) => [...current, created]);
      setNewPaymentMethod({ code: "", label: "" });
      setNewPaymentMethodOpen(false);
      setMessage("Mode de paiement cree.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation mode de paiement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function savePaymentMethod(paymentMethod: PaymentMethodRow) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<PaymentMethodRow>(`/settings/payment-methods/${paymentMethod.id}`, { method: "PUT", body: JSON.stringify({ code: paymentMethod.code.trim().toUpperCase(), label: paymentMethod.label.trim(), isActive: paymentMethod.isActive }) });
      setPaymentMethods((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage("Mode de paiement mis a jour.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Mise a jour mode de paiement impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePaymentMethod(paymentMethod: PaymentMethodRow) {
    if (!window.confirm(`Supprimer le mode de paiement ${paymentMethod.label} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/settings/payment-methods/${paymentMethod.id}`, { method: "DELETE" });
      setPaymentMethods((current) => current.filter((item) => item.id !== paymentMethod.id));
      setMessage("Mode de paiement supprime.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression mode de paiement impossible.");
    } finally {
      setSaving(false);
    }
  }
  function updateBoutique(id: string, patch: Partial<BoutiqueRow>) {
    setBoutiques((current) => current.map((boutique) => boutique.id === id ? { ...boutique, ...patch } : boutique));
  }

  function updateSeller(id: string, patch: Partial<SellerRow>) {
    setSellerRows((current) => current.map((seller) => {
      if (seller.id !== id) return seller;
      const boutiqueName = patch.boutiqueId !== undefined ? sellerBoutiques.find((boutique) => boutique.id === patch.boutiqueId)?.name ?? "" : seller.boutiqueName;
      const categoryNames = patch.categoryIds !== undefined ? sellerCategories.filter((category) => patch.categoryIds?.includes(category.id)).map((category) => category.name) : seller.categoryNames;
      const specialtyCategoryName = categoryNames[0] ?? "";
      return { ...seller, ...patch, boutiqueName, categoryNames, specialtyCategoryName };
    }));
  }

  function getCategoryIdsByType(typeId: string) {
    return sellerCategories.filter((category) => (category.typeId ?? "__none") === typeId).map((category) => category.id);
  }

  function toggleSellerType(sellerId: string, typeId: string) {
    const seller = sellerRows.find((item) => item.id === sellerId);
    const current = seller?.categoryIds ?? [];
    const typeCategoryIds = getCategoryIdsByType(typeId);
    const allSelected = typeCategoryIds.every((id) => current.includes(id));
    const categoryIds = allSelected ? current.filter((id) => !typeCategoryIds.includes(id)) : Array.from(new Set([...current, ...typeCategoryIds]));
    updateSeller(sellerId, { categoryIds });
  }

  function toggleNewSellerType(typeId: string) {
    setNewSeller((current) => {
      const typeCategoryIds = getCategoryIdsByType(typeId);
      const allSelected = typeCategoryIds.every((id) => current.categoryIds.includes(id));
      return {
        ...current,
        categoryIds: allSelected ? current.categoryIds.filter((id) => !typeCategoryIds.includes(id)) : Array.from(new Set([...current.categoryIds, ...typeCategoryIds]))
      };
    });
  }

  function toggleSellerCategory(sellerId: string, categoryId: string) {
    const seller = sellerRows.find((item) => item.id === sellerId);
    const current = seller?.categoryIds ?? [];
    const categoryIds = current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId];
    updateSeller(sellerId, { categoryIds });
  }

  function toggleNewSellerCategory(categoryId: string) {
    setNewSeller((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId]
    }));
  }
  function toggleBoutiqueSeller(boutiqueId: string, sellerName: string) {
    setBoutiques((current) => current.map((boutique) => {
      if (boutique.id !== boutiqueId) return boutique;
      const sellerNames = boutique.sellerNames.includes(sellerName)
        ? boutique.sellerNames.filter((name) => name !== sellerName)
        : [...boutique.sellerNames, sellerName];
      return { ...boutique, sellerNames };
    }));
  }

  function toggleNewBoutiqueSeller(sellerName: string) {
    setNewBoutique((current) => ({
      ...current,
      sellerNames: current.sellerNames.includes(sellerName)
        ? current.sellerNames.filter((name) => name !== sellerName)
        : [...current.sellerNames, sellerName]
    }));
  }

  function boutiqueNameForUser(user: UserRow) {
    if (!user.defaultWarehouseId) return "Non affecte";
    return userWarehouses.find((warehouse) => warehouse.id === user.defaultWarehouseId)?.name ?? "Boutique inconnue";
  }

  function toggleBoutiqueCashier(boutiqueId: string, userId: string) {
    setUserRows((current) => current.map((user) => {
      if (user.id !== userId) return user;
      return {
        ...user,
        defaultWarehouseId: user.defaultWarehouseId === boutiqueId ? null : boutiqueId
      };
    }));
  }

  function toggleBoutiqueUser(boutiqueId: string, userId: string) {
    setUserRows((current) => current.map((user) => {
      if (user.id !== userId) return user;
      return {
        ...user,
        defaultWarehouseId: user.defaultWarehouseId === boutiqueId ? null : boutiqueId
      };
    }));
  }

  function toggleBoutiqueSellerAssignment(boutiqueId: string, sellerId: string) {
    setSellerRows((current) => current.map((seller) => {
      if (seller.id !== sellerId) return seller;
      const isAttached = seller.boutiqueId === boutiqueId;
      return {
        ...seller,
        boutiqueId: isAttached ? null : boutiqueId,
        boutiqueName: isAttached ? "" : sellerBoutiques.find((boutique) => boutique.id === boutiqueId)?.name ?? selectedBoutique?.name ?? ""
      };
    }));
  }

  function openBoutiqueUserCreate(tab: Exclude<BoutiqueTeamTab, "vendeurs">) {
    if (!selectedBoutique) return;
    setBoutiqueTeamTab(tab);
    setSelectedUserId(null);
    setNewSellerOpen(false);
    setNewUser(buildNewUserDraft(tab, selectedBoutique.id));
    setNewUserOpen(true);
  }

  function openBoutiqueSellerCreate() {
    if (!selectedBoutique) return;
    setBoutiqueTeamTab("vendeurs");
    setSelectedSellerId(null);
    setNewUserOpen(false);
    setNewSeller({ fullName: "", boutiqueId: selectedBoutique.id, commissionRate: "0", categoryIds: [] });
    setNewSellerOpen(true);
  }

  async function createBoutique(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const created = await api<BoutiqueRow>("/settings/boutiques", { method: "POST", body: JSON.stringify(newBoutique) });
      setBoutiques((current) => [...current, created]);
      setSelectedBoutiqueId(created.id);
      setEditingBoutique(false);
      setNewBoutiqueOpen(false);
      setNewBoutique({ name: "", address: "", phone: "", managerName: "", sellerNames: [], ticketPrefix: "" });
      setMessage("Boutique creee.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Creation boutique impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteBoutique(boutique: BoutiqueRow) {
    if (!window.confirm(`Supprimer la boutique ${boutique.name} ?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/settings/boutiques/${boutique.id}`, { method: "DELETE" });
      setBoutiques((current) => current.filter((item) => item.id !== boutique.id));
      if (selectedBoutiqueId === boutique.id) setSelectedBoutiqueId(null);
      setMessage("Boutique supprimee.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Suppression boutique impossible.");
    } finally {
      setSaving(false);
    }
  }

  function renderBoutiqueTeamPanel() {
    if (!selectedBoutique) return null;
    const activeTeamTab = boutiqueTeamTabs.find((tab) => tab.key === boutiqueTeamTab) ?? boutiqueTeamTabs[0];
    const userRowsForTab =
      boutiqueTeamTab === "managers" ? managerUsers :
      boutiqueTeamTab === "operateurs" ? operatorUsers :
      boutiqueTeamTab === "caissiers" ? groupedCashierUsers :
      [];
    const attachedUserRows = userRowsForTab.filter((user) => user.defaultWarehouseId === selectedBoutique.id);
    const addUserLabel =
      boutiqueTeamTab === "managers" ? "Ajouter manager" :
      boutiqueTeamTab === "operateurs" ? "Ajouter operateur" :
      boutiqueTeamTab === "caissiers" ? "Ajouter caissier" :
      "Ajouter vendeur";
    const selectedUserForBoutique = selectedUser && primaryUserMode(selectedUser) !== "admin" ? selectedUser : null;
    const selectedSellerForBoutique = selectedSeller && boutiqueTeamTab === "vendeurs" ? selectedSeller : null;

    return (
      <div className="rounded-[28px] border border-orange-300/15 bg-black/20 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-200/80">Equipe boutique</p>
            <p className="mt-1 text-sm text-[#d6c8ba]">Managers, caissiers, operateurs et vendeurs rattaches a {selectedBoutique.name}.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void saveBoutiqueTeam()} disabled={saving}>
              {saving ? "Sauvegarde..." : "Sauvegarder equipe"}
            </Button>
            <Button
              className="!px-3 !py-2 text-xs"
              type="button"
              onClick={() => {
                if (boutiqueTeamTab === "vendeurs") {
                  openBoutiqueSellerCreate();
                } else {
                  openBoutiqueUserCreate(boutiqueTeamTab);
                }
              }}
            >
              {addUserLabel}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 rounded-[22px] border border-white/10 bg-black/20 p-2">
          {boutiqueTeamTabs.map((tab) => {
            const count =
              tab.key === "managers" ? selectedBoutiqueManagers.length :
              tab.key === "caissiers" ? selectedBoutiqueCashiers.length :
              tab.key === "operateurs" ? selectedBoutiqueOperators.length :
              selectedBoutiqueSellers.length;
            return (
              <button
                key={tab.key}
                type="button"
                className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${boutiqueTeamTab === tab.key ? "bg-orange-300 text-black shadow-[0_10px_24px_rgba(255,138,31,.18)]" : "text-[#e9dccc] hover:bg-white/5"}`}
                onClick={() => {
                  setBoutiqueTeamTab(tab.key);
                  setNewUserOpen(false);
                  setNewSellerOpen(false);
                  setSelectedUserId(null);
                  setSelectedSellerId(null);
                }}
              >
                {tab.label} <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {newUserOpen && boutiqueTeamTab !== "vendeurs" ? (
          <form className="mt-4 rounded-[24px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createUser}>
            <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Nom complet"><Input value={newUser.fullName} onChange={(e) => setNewUser((current) => ({ ...current, fullName: e.target.value }))} required /></Field>
              <Field label="Email"><Input type="email" value={newUser.email} onChange={(e) => setNewUser((current) => ({ ...current, email: e.target.value }))} required /></Field>
              {newUserMode !== "caissier" ? <Field label="Mot de passe"><Input type="password" minLength={6} value={newUser.password} onChange={(e) => setNewUser((current) => ({ ...current, password: e.target.value }))} required /></Field> : null}
              {newUserMode === "manager" || newUserMode === "operateur" ? <Field label="Identifiant"><Input value={newUser.loginUsername} onChange={(e) => setNewUser((current) => ({ ...current, loginUsername: e.target.value }))} placeholder={newUserMode === "operateur" ? "identifiant operateur" : "identifiant manager"} /></Field> : null}
              {newUserMode === "caissier" ? <Field label="Code confidentiel"><Input value={newUser.pinCode} onChange={(e) => setNewUser((current) => ({ ...current, pinCode: e.target.value.replace(/\D+/g, "") }))} placeholder="laisse vide pour generer" /></Field> : null}
              <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#eadccf]"><input type="checkbox" checked={newUser.isActive} onChange={(e) => setNewUser((current) => ({ ...current, isActive: e.target.checked }))} /> Actif</label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => setNewUserOpen(false)}>Annuler</Button>
              <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer"}</Button>
            </div>
          </form>
        ) : null}

        {newSellerOpen && boutiqueTeamTab === "vendeurs" ? (
          <form className="mt-4 rounded-[24px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createSeller}>
            <div className="grid items-end gap-3 md:grid-cols-3">
              <Field label="Nom vendeur"><Input value={newSeller.fullName} onChange={(e) => setNewSeller((current) => ({ ...current, fullName: e.target.value }))} required /></Field>
              <Field label="Taux commission %"><Input className="max-w-[150px]" type="number" step="0.01" min="0" value={newSeller.commissionRate} onChange={(e) => setNewSeller((current) => ({ ...current, commissionRate: e.target.value }))} /></Field>
              <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#eadccf]"><input type="checkbox" checked={Boolean(newSeller.boutiqueId)} onChange={(e) => setNewSeller((current) => ({ ...current, boutiqueId: e.target.checked ? selectedBoutique.id : "" }))} /> Rattache a la boutique</label>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Categories affectees</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sellerCategories.map((category) => { const checked = newSeller.categoryIds.includes(category.id); return <label key={category.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleNewSellerCategory(category.id)} />{category.name}</label>; })}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => setNewSellerOpen(false)}>Annuler</Button>
              <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer"}</Button>
            </div>
          </form>
        ) : null}

        {selectedUserForBoutique && boutiqueTeamTab !== "vendeurs" ? (
          <form className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4" onSubmit={(event) => { event.preventDefault(); void saveUser(selectedUserForBoutique); }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d9c5b1]">Modifier {selectedUserForBoutique.fullName}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => printUserBadge(selectedUserForBoutique)}>Imprimer badge</Button>
                <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteUser(selectedUserForBoutique)}>Supprimer</Button>
              </div>
            </div>
            <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Nom complet"><Input value={selectedUserForBoutique.fullName} onChange={(e) => updateUser(selectedUserForBoutique.id, { fullName: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={selectedUserForBoutique.email} onChange={(e) => updateUser(selectedUserForBoutique.id, { email: e.target.value })} /></Field>
              {selectedUserMode === "manager" || selectedUserMode === "operateur" ? <Field label="Identifiant"><Input value={selectedUserForBoutique.loginUsername} onChange={(e) => updateUser(selectedUserForBoutique.id, { loginUsername: e.target.value })} /></Field> : null}
              {selectedUserMode === "caissier" ? <Field label="Code confidentiel"><Input value={selectedUserForBoutique.pinCode} onChange={(e) => updateUser(selectedUserForBoutique.id, { pinCode: e.target.value.replace(/\D+/g, "") })} /></Field> : null}
              {selectedUserMode !== "caissier" ? <Field label="Nouveau mot de passe"><Input type="password" minLength={6} value={selectedUserPassword} onChange={(e) => setSelectedUserPassword(e.target.value)} placeholder="Laisser vide" /></Field> : null}
              <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#eadccf]"><input type="checkbox" checked={selectedUserForBoutique.isActive} onChange={(e) => updateUser(selectedUserForBoutique.id, { isActive: e.target.checked })} /> Actif</label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => { setSelectedUserId(null); setSelectedUserPassword(""); }}>Fermer</Button>
              <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Enregistrement..." : "Sauvegarder"}</Button>
            </div>
          </form>
        ) : null}

        {selectedSellerForBoutique ? (
          <form className="mt-4 rounded-[24px] border border-white/10 bg-black/20 p-4" onSubmit={submitSellers}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d9c5b1]">Modifier {selectedSellerForBoutique.fullName}</p>
              <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteSeller(selectedSellerForBoutique)}>Supprimer</Button>
            </div>
            <div className="grid items-end gap-3 md:grid-cols-3">
              <Field label="Vendeur"><Input value={selectedSellerForBoutique.fullName} readOnly /></Field>
              <Field label="Taux commission %"><Input className="max-w-[150px]" type="number" step="0.01" min="0" value={selectedSellerForBoutique.commissionRate} onChange={(e) => updateSeller(selectedSellerForBoutique.id, { commissionRate: Number(e.target.value || 0) })} /></Field>
              <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#eadccf]"><input type="checkbox" checked={selectedSellerForBoutique.boutiqueId === selectedBoutique.id} onChange={() => toggleBoutiqueSellerAssignment(selectedBoutique.id, selectedSellerForBoutique.id)} /> Rattache a la boutique</label>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Categories affectees</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sellerCategories.map((category) => { const checked = selectedSellerForBoutique.categoryIds.includes(category.id); return <label key={category.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleSellerCategory(selectedSellerForBoutique.id, category.id)} />{category.name}</label>; })}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => setSelectedSellerId(null)}>Fermer</Button>
              <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Enregistrement..." : "Sauvegarder"}</Button>
            </div>
          </form>
        ) : null}

        <div className="mt-4">
          {boutiqueTeamTab !== "vendeurs" ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {userRowsForTab.map((user) => {
                const checked = user.defaultWarehouseId === selectedBoutique.id;
                return (
                  <div key={user.id} className={`rounded-2xl border p-3 transition ${checked ? "border-orange-300/35 bg-orange-300/10" : "border-white/10 bg-black/20"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex min-w-0 items-start gap-2 text-[#eadccf]">
                        <input className="mt-1" type="checkbox" checked={checked} onChange={() => toggleBoutiqueUser(selectedBoutique.id, user.id)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{user.fullName}</span>
                          <span className="block truncate text-[11px] text-[#bcae9f]">{checked ? "Rattache a cette boutique" : boutiqueNameForUser(user)}</span>
                        </span>
                      </label>
                      <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => { setSelectedUserId(user.id); setSelectedUserPassword(""); setNewUserOpen(false); }}>Gerer</Button>
                    </div>
                  </div>
                );
              })}
              {!userRowsForTab.length ? <div className="text-sm text-[#bcae9f]">Aucun {activeTeamTab.label.toLowerCase()} disponible.</div> : null}
              {userRowsForTab.length && !attachedUserRows.length ? <div className="text-sm text-[#bcae9f]">Aucun {activeTeamTab.label.toLowerCase()} rattache a cette boutique.</div> : null}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sellerRows.map((seller) => {
                const checked = seller.boutiqueId === selectedBoutique.id || selectedBoutique.sellerNames.includes(seller.fullName);
                return (
                  <div key={seller.id} className={`rounded-2xl border p-3 transition ${checked ? "border-orange-300/35 bg-orange-300/10" : "border-white/10 bg-black/20"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex min-w-0 items-start gap-2 text-[#eadccf]">
                        <input className="mt-1" type="checkbox" checked={checked} onChange={() => toggleBoutiqueSellerAssignment(selectedBoutique.id, seller.id)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{seller.fullName}</span>
                          <span className="block truncate text-[11px] text-[#bcae9f]">{checked ? `${seller.commissionRate}% commission` : seller.boutiqueName || "Non affecte"}</span>
                        </span>
                      </label>
                      <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => { setSelectedSellerId(seller.id); setNewSellerOpen(false); }}>Gerer</Button>
                    </div>
                  </div>
                );
              })}
              {!sellerRows.length ? <div className="text-sm text-[#bcae9f]">Aucun vendeur disponible.</div> : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  const normalizedColorSearch = colorSearch.trim().toLowerCase();
  const filteredColors = colors.filter((color) => {
    const matchesType = !colorTypeFilter || color.type === colorTypeFilter;
    const haystack = [color.reference, color.name].join(" ").toLowerCase();
    const matchesSearch = !normalizedColorSearch || haystack.includes(normalizedColorSearch);
    return matchesType && matchesSearch;
  });

  if (loading) return <LoadingBlock label="Chargement des parametres..." />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Parametres" title="" />

      <div className="flex flex-wrap gap-2 rounded-[26px] border border-white/10 bg-black/20 p-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${activeTab === tab.key ? "bg-orange-300 text-black" : "text-[#e9dccc] hover:bg-white/5"}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message ? <div className="rounded-2xl border border-orange-300/20 bg-orange-300/10 px-4 py-3 text-sm text-orange-100">{message}</div> : null}

      {activeTab === "societe" ? (
        <SectionCard title="Societe">
          <div className="mb-5 rounded-[24px] border border-white/10 bg-black/20 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/80">Theme interface</p>
                <p className="mt-1 text-sm text-[#cdbfb1]">Choisir l'affichage de l'application sur ce poste.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-[20px] border border-white/10 bg-black/20 p-1.5 sm:min-w-[320px]">
                <button
                  type="button"
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${theme === "dark" ? "bg-orange-300 text-black" : "text-[#e9dccc] hover:bg-white/5"}`}
                  onClick={() => changeTheme("dark")}
                >
                  Mode sombre
                </button>
                <button
                  type="button"
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${theme === "light" ? "bg-orange-300 text-black" : "text-[#e9dccc] hover:bg-white/5"}`}
                  onClick={() => changeTheme("light")}
                >
                  Mode clair
                </button>
              </div>
            </div>
          </div>
          <form className="grid gap-4 xl:grid-cols-2" onSubmit={submit}>
            <Field label="Nom societe"><Input value={form.company_name} onChange={(e) => setForm((current) => ({ ...current, company_name: e.target.value }))} /></Field>
            <Field label="Logo URL"><Input value={form.company_logo_url} onChange={(e) => setForm((current) => ({ ...current, company_logo_url: e.target.value }))} placeholder="https://.../logo.png" /></Field>
            <Field label="Devise"><Input value={form.company_currency} onChange={(e) => setForm((current) => ({ ...current, company_currency: e.target.value }))} /></Field>
            <Field label="TVA par defaut %"><Input type="number" step="0.01" value={form.default_tax_rate} onChange={(e) => setForm((current) => ({ ...current, default_tax_rate: e.target.value }))} /></Field>
            <Field label="Adresse"><Input value={form.company_address} onChange={(e) => setForm((current) => ({ ...current, company_address: e.target.value }))} /></Field>
            <Field label="Email"><Input value={form.company_email} onChange={(e) => setForm((current) => ({ ...current, company_email: e.target.value }))} /></Field>
            <Field label="Site web"><Input value={form.company_website} onChange={(e) => setForm((current) => ({ ...current, company_website: e.target.value }))} /></Field>
            <Field label="Patente"><Input value={form.company_patente} onChange={(e) => setForm((current) => ({ ...current, company_patente: e.target.value }))} /></Field>
            <Field label="ICE"><Input value={form.company_ice} onChange={(e) => setForm((current) => ({ ...current, company_ice: e.target.value }))} /></Field>
            <Field label="RC"><Input value={form.company_rc} onChange={(e) => setForm((current) => ({ ...current, company_rc: e.target.value }))} /></Field>
            <Field label="CNSS"><Input value={form.company_cnss} onChange={(e) => setForm((current) => ({ ...current, company_cnss: e.target.value }))} /></Field>
            <div />
            <Field label="Conditions generales de vente"><Textarea rows={11} value={form.ticket_cgv} onChange={(e) => setForm((current) => ({ ...current, ticket_cgv: e.target.value }))} /></Field>
            <Field label="Pied de page"><Textarea rows={4} value={form.ticket_footer} onChange={(e) => setForm((current) => ({ ...current, ticket_footer: e.target.value }))} /></Field>
            <div className="flex items-end xl:justify-end"><div><Button className="!px-3 !py-2 text-xs" type="submit">{saving ? "Enregistrement..." : "Sauvegarder"}</Button></div></div>
          </form>
        </SectionCard>
      ) : null}

      {activeTab === "tickets" ? (
        <SectionCard title="Personnalisation des tickets">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <form className="space-y-5" onSubmit={submitTicketProfiles}>
              <div className="flex flex-wrap gap-2 rounded-[24px] border border-white/10 bg-black/20 p-2">
                {(Object.keys(form.ticket_print_profiles) as TicketPrintType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${selectedPrintType === type ? "bg-orange-300 text-black shadow-[0_12px_28px_rgba(255,138,31,.24)]" : "text-[#e9dccc] hover:bg-white/5"}`}
                    onClick={() => setSelectedPrintType(type)}
                  >
                    {form.ticket_print_profiles[type].label}
                  </button>
                ))}
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-200/80">Afficher / retirer</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {([
                    ["showLogo", "Logo"],
                    ["showCompanyName", "Societe"],
                    ["showBoutique", "Boutique"],
                    ["showDate", "Date"],
                    ["showTicketNumber", "Numero ticket"],
                    ["showClient", "Client"],
                    ["showSeller", "Vendeur"],
                    ["showArticles", "Articles"],
                    ["showTotals", "Totaux/prix"],
                    ["showPayments", "Paiements"],
                    ["showCgv", "Conditions vente"],
                    ["showFooter", "Message pied"],
                    ["showBarcode", "Code-barres"],
                    ["showCompanyInfo", "Infos societe"]
                  ] as Array<[keyof TicketPrintProfile, string]>).map(([key, label]) => (
                    <label key={String(key)} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${selectedPrintProfile[key] ? "border-orange-300/35 bg-orange-300/12 text-white" : "border-white/10 bg-black/20 text-[#d9c9bb]"}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedPrintProfile[key])}
                        onChange={(e) => updateTicketPrintProfile(selectedPrintType, { [key]: e.target.checked } as Partial<TicketPrintProfile>)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.04)]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-200/80">Style</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Field label="Nom du ticket"><Input value={selectedPrintProfile.label} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { label: e.target.value })} /></Field>
                  <Field label="Police"><Input value={selectedPrintProfile.fontFamily} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { fontFamily: e.target.value })} placeholder="Arial, Helvetica..." /></Field>
                  <Field label="Taille generale"><Input type="number" min="8" max="16" value={selectedPrintProfile.baseFontSize} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { baseFontSize: Number(e.target.value) })} /></Field>
                  <Field label="Taille titre"><Input type="number" min="10" max="24" value={selectedPrintProfile.titleFontSize} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { titleFontSize: Number(e.target.value) })} /></Field>
                  <Field label="Taille articles"><Input type="number" min="8" max="16" value={selectedPrintProfile.itemFontSize} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { itemFontSize: Number(e.target.value) })} /></Field>
                  <Field label="Hauteur logo"><Input type="number" min="0" max="34" value={selectedPrintProfile.logoHeight} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { logoHeight: Number(e.target.value) })} /></Field>
                  <Field label="Hauteur code-barres"><Input type="number" min="20" max="80" value={selectedPrintProfile.barcodeHeight} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { barcodeHeight: Number(e.target.value) })} /></Field>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                <Field label="Texte en haut / badge"><Input value={selectedPrintProfile.headerText} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { headerText: e.target.value })} placeholder="Ex. DUPLICATA, DETAXE..." /></Field>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                <Field label="Message fixe bas ticket"><Input value={selectedPrintProfile.fixedBottomText} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { fixedBottomText: e.target.value })} /></Field>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                <Field label="Conditions / texte detaille"><Textarea rows={5} value={selectedPrintProfile.cgvText} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { cgvText: e.target.value })} /></Field>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-black/20 p-4">
                <Field label="Message pied de ticket"><Textarea rows={4} value={selectedPrintProfile.footerText} onChange={(e) => updateTicketPrintProfile(selectedPrintType, { footerText: e.target.value })} /></Field>
              </div>

              <div className="rounded-[24px] border border-orange-300/20 bg-orange-300/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-200/80">Source commune</p>
                <p className="mt-1 text-sm text-[#eadfd4]">Logo, nom societe, adresse, email et site web sont repris depuis l'onglet Societe.</p>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => updateTicketPrintProfile(selectedPrintType, defaultTicketPrintProfiles[selectedPrintType])}>Restaurer ce ticket</Button>
                <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Enregistrement..." : "Sauvegarder les tickets"}</Button>
              </div>
            </form>

            <TicketPreview profile={selectedPrintProfile} form={form} />
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "boutique" ? (
        selectedBoutique ? (
          <SectionCard title={selectedBoutique.name} actions={<><Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => { setSelectedBoutiqueId(null); setEditingBoutique(false); }}>Retour a la liste</Button><Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setEditingBoutique((current) => !current)}>{editingBoutique ? "Annuler" : "Modifier"}</Button></>}>
            {editingBoutique ? (
              <form className="space-y-4" onSubmit={submitBoutiques}>
                <div className="grid items-end gap-4 md:grid-cols-3">
                  <Field label="Boutique"><Input value={selectedBoutique.name} onChange={(e) => updateBoutique(selectedBoutique.id, { name: e.target.value })} /></Field>
                  <Field label="Telephone"><Input value={selectedBoutique.phone} onChange={(e) => updateBoutique(selectedBoutique.id, { phone: e.target.value })} /></Field>
                  <Field label="Adresse"><Input value={selectedBoutique.address} onChange={(e) => updateBoutique(selectedBoutique.id, { address: e.target.value })} /></Field>
                  <Field label="Responsable boutique"><Input value={selectedBoutique.managerName} onChange={(e) => updateBoutique(selectedBoutique.id, { managerName: e.target.value })} /></Field>
                  <Field label="Sigle ticket caisse"><Input value={selectedBoutique.ticketPrefix} onChange={(e) => updateBoutique(selectedBoutique.id, { ticketPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} placeholder="GUE" /></Field>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Vendeurs attachees</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {sellerOptions.map((seller) => {
                      const checked = selectedBoutique.sellerNames.includes(seller.fullName);
                      return <label key={seller.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleBoutiqueSeller(selectedBoutique.id, seller.fullName)} />{seller.fullName}</label>;
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Caissiers rattaches</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {cashierRows.map((cashier) => {
                      const checked = cashier.defaultWarehouseId === selectedBoutique.id;
                      return (
                        <label
                          key={cashier.id}
                          className={`rounded-2xl border px-3 py-2 transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}
                        >
                          <div className="flex items-start gap-2">
                            <input className="mt-0.5" type="checkbox" checked={checked} onChange={() => toggleBoutiqueCashier(selectedBoutique.id, cashier.id)} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{cashier.fullName}</p>
                              <p className="text-[11px] text-[#bcae9f]">{checked ? "Acces caisse active" : boutiqueNameForUser(cashier)}</p>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                    {!cashierRows.length ? <span className="text-sm text-[#bcae9f]">Aucun caissier disponible.</span> : null}
                  </div>
                </div>
                <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Enregistrement..." : "Sauvegarder"}</Button>
              </form>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Boutique</p><p className="mt-1 text-sm font-semibold text-white">{selectedBoutique.name}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Sigle ticket</p><p className="mt-1 text-sm font-semibold text-white">{selectedBoutique.ticketPrefix || "Non renseigne"}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Telephone</p><p className="mt-1 text-sm font-semibold text-white">{selectedBoutique.phone || "Non renseigne"}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Responsable</p><p className="mt-1 text-sm font-semibold text-white">{selectedBoutique.managerName || "Non renseigne"}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Equipe</p><p className="mt-1 text-sm font-semibold text-white">{selectedBoutiqueTeamCount}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Caissiers</p><p className="mt-1 text-sm font-semibold text-white">{selectedBoutiqueCashiers.length}</p></div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.16em] text-[#bba896]">Adresse</p><p className="mt-1 text-xs text-[#efe3d7]">{selectedBoutique.address || "Aucune adresse"}</p></div>
                {renderBoutiqueTeamPanel()}
              </div>
            )}
          </SectionCard>
        ) : (
          <SectionCard title="Boutiques" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setNewBoutiqueOpen((current) => !current)}>{newBoutiqueOpen ? "Fermer" : "Ajouter boutique"}</Button>}>
            {newBoutiqueOpen ? (
              <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createBoutique}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Boutique"><Input value={newBoutique.name} onChange={(e) => setNewBoutique((current) => ({ ...current, name: e.target.value }))} /></Field>
                  <Field label="Telephone"><Input value={newBoutique.phone} onChange={(e) => setNewBoutique((current) => ({ ...current, phone: e.target.value }))} /></Field>
                  <Field label="Adresse"><Input value={newBoutique.address} onChange={(e) => setNewBoutique((current) => ({ ...current, address: e.target.value }))} /></Field>
                  <Field label="Responsable boutique"><Input value={newBoutique.managerName} onChange={(e) => setNewBoutique((current) => ({ ...current, managerName: e.target.value }))} /></Field>
                  <Field label="Sigle ticket caisse"><Input value={newBoutique.ticketPrefix} onChange={(e) => setNewBoutique((current) => ({ ...current, ticketPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) }))} placeholder="GUE" /></Field>
                </div>
                <div className="mt-4"><p className="mb-2 text-sm font-semibold text-[#efe3d7]">Vendeurs attachees</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sellerOptions.map((seller) => { const checked = newBoutique.sellerNames.includes(seller.fullName); return <label key={seller.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleNewBoutiqueSeller(seller.fullName)} />{seller.fullName}</label>; })}</div></div>
                <p className="mt-4 text-xs text-[#bcae9f]">Les caissiers se rattachent a la boutique depuis la fiche boutique apres creation.</p>
                <Button className="mt-4 !px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer la boutique"}</Button>
              </form>
            ) : null}
            <div className="overflow-hidden rounded-[24px] border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-[#d9c5b1]"><tr><th className="px-4 py-3">Boutique</th><th className="px-4 py-3">Sigle ticket</th><th className="px-4 py-3">Responsable</th><th className="px-4 py-3">Telephone</th><th className="px-4 py-3">Vendeurs</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/10">{boutiques.map((boutique) => <tr key={boutique.id} className="cursor-pointer transition hover:bg-white/5" onClick={() => { setSelectedBoutiqueId(boutique.id); setEditingBoutique(false); }}><td className="px-4 py-4 font-semibold text-white">{boutique.name}<p className="mt-1 text-xs font-normal text-[#b9aa9c]">{boutique.address || "Aucune adresse"}</p></td><td className="px-4 py-4 text-[#eadccf]">{boutique.ticketPrefix || "-"}</td><td className="px-4 py-4 text-[#eadccf]">{boutique.managerName || "-"}</td><td className="px-4 py-4 text-[#eadccf]">{boutique.phone || "-"}</td><td className="px-4 py-4 text-[#eadccf]">{boutique.sellerNames.length}</td><td className="px-4 py-4 text-right"><Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={(event) => { event.stopPropagation(); void deleteBoutique(boutique); }}>Supprimer</Button></td></tr>)}</tbody></table>{!boutiques.length ? <div className="p-6 text-center text-sm text-[#d8cabc]">Aucune boutique trouvee.</div> : null}</div>
          </SectionCard>
        )
      ) : null}
      {activeTab === "utilisateurs" ? (
        selectedUser ? (
          <SectionCard title={selectedUser.fullName} actions={<><Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => { setSelectedUserId(null); setEditingUser(false); setSelectedUserPassword(""); setUserDetailTab("infos"); }}>Retour a la liste</Button>{primaryUserMode(selectedUser) !== "admin" ? <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => printUserBadge(selectedUser)}>Imprimer badge</Button> : null}{editingUser ? <Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void saveUser(selectedUser)} disabled={saving}>{saving ? "Enregistrement..." : "Sauvegarder"}</Button> : null}<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setEditingUser((current) => !current)}>{editingUser ? "Annuler" : "Modifier"}</Button><Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteUser(selectedUser)}>Supprimer</Button></>}>
            <div className="mb-5 flex flex-wrap gap-2 rounded-[22px] border border-white/10 bg-black/20 p-2">
              <button type="button" className={`rounded-2xl px-4 py-2 text-xs font-semibold transition ${userDetailTab === "infos" ? "bg-orange-300 text-black" : "text-[#e9dccc] hover:bg-white/5"}`} onClick={() => setUserDetailTab("infos")}>Informations</button>
              <button type="button" className={`rounded-2xl px-4 py-2 text-xs font-semibold transition ${userDetailTab === "droits" ? "bg-orange-300 text-black" : "text-[#e9dccc] hover:bg-white/5"}`} onClick={() => setUserDetailTab("droits")}>Droits d'acces</button>
            </div>
            {userDetailTab === "infos" ? (
              editingUser ? (
                <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Nom complet"><Input value={selectedUser.fullName} onChange={(e) => updateUser(selectedUser.id, { fullName: e.target.value })} /></Field>
                  <Field label="Email"><Input type="email" value={selectedUser.email} onChange={(e) => updateUser(selectedUser.id, { email: e.target.value })} /></Field>
                  <Field label="Boutique rattachee">
                    <select className="input-base" value={selectedUser.defaultWarehouseId ?? ""} onChange={(e) => updateUser(selectedUser.id, { defaultWarehouseId: e.target.value || null })}>
                      <option value="">Toutes boutiques</option>
                      {userWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </select>
                  </Field>
                  {selectedUserMode === "manager" || selectedUserMode === "operateur" ? (
                    <Field label="Utilisateur">
                      <Input value={selectedUser.loginUsername} onChange={(e) => updateUser(selectedUser.id, { loginUsername: e.target.value })} placeholder={selectedUserMode === "operateur" ? "identifiant operateur" : "identifiant manager"} />
                    </Field>
                  ) : null}
                  {selectedUserMode === "caissier" ? (
                    <Field label="Code confidentiel">
                      <Input value={selectedUser.pinCode} onChange={(e) => updateUser(selectedUser.id, { pinCode: e.target.value.replace(/\D+/g, "") })} placeholder="code caisse" />
                    </Field>
                  ) : null}
                  {selectedUserMode !== "caissier" ? <Field label="Nouveau mot de passe"><Input type="password" minLength={6} value={selectedUserPassword} onChange={(e) => setSelectedUserPassword(e.target.value)} placeholder="Laisser vide ou saisir 6 caracteres minimum" /></Field> : <div />}
                  <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#eadccf]"><input type="checkbox" checked={selectedUser.isActive} onChange={(e) => updateUser(selectedUser.id, { isActive: e.target.checked })} /> Actif</label>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5"><p className="text-[9px] uppercase tracking-[0.14em] text-[#bba896]">Utilisateur</p><p className="mt-1 text-[13px] font-semibold text-white">{selectedUser.fullName}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5"><p className="text-[9px] uppercase tracking-[0.14em] text-[#bba896]">Email</p><p className="mt-1 text-[13px] font-semibold text-white">{selectedUser.email}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5"><p className="text-[9px] uppercase tracking-[0.14em] text-[#bba896]">Boutique</p><p className="mt-1 text-[13px] font-semibold text-white">{selectedUserWarehouseName}</p></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5"><p className="text-[9px] uppercase tracking-[0.14em] text-[#bba896]">Statut</p><p className="mt-1 text-[13px] font-semibold text-white">{selectedUser.isActive ? "Actif" : "Inactif"}</p></div>
                  </div>
                  {selectedUserMode === "manager" || selectedUserMode === "operateur" || selectedUserMode === "caissier" ? (
                    <AccessBadgeCard user={selectedUser} warehouseName={selectedUserWarehouseName} />
                  ) : null}
                </div>
              )
            ) : null}
            {userDetailTab === "droits" ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Roles</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {userRoles.map((role) => {
                      const checked = selectedUser.roles.includes(role.name);
                      return <label key={role.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" disabled={!editingUser} checked={checked} onChange={() => toggleUserRole(selectedUser.id, role.name)} />{role.label}</label>;
                    })}
                  </div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
                  <p className="mb-3 text-sm font-semibold text-[#efe3d7]">Permissions actives selon les roles</p>
                  <div className="flex flex-wrap gap-2">{selectedUserPermissions.map((permission) => <span key={permission.id} className="badge">{permission.label}</span>)}{!selectedUserPermissions.length ? <span className="text-sm text-[#bcae9f]">Aucun droit affecte.</span> : null}</div>
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard title="Admins" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => {
            setNewUserOpen((current) => {
              const next = !current;
              if (next) {
                setUserGroupTab("admins");
                setNewUser(buildNewUserDraft("admins"));
              }
              return next;
            });
          }}>{newUserOpen ? "Fermer" : "Ajouter admin"}</Button>}>
            {newUserOpen ? (
              <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createUser}>
                <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Nom complet"><Input value={newUser.fullName} onChange={(e) => setNewUser((current) => ({ ...current, fullName: e.target.value }))} required /></Field>
                  <Field label="Email"><Input type="email" value={newUser.email} onChange={(e) => setNewUser((current) => ({ ...current, email: e.target.value }))} required /></Field>
                  {newUserMode !== "caissier" ? <Field label="Mot de passe"><Input type="password" minLength={6} value={newUser.password} onChange={(e) => setNewUser((current) => ({ ...current, password: e.target.value }))} placeholder="6 caracteres minimum" required /></Field> : <div />}
                  {newUserMode === "manager" || newUserMode === "operateur" ? <Field label="Utilisateur"><Input value={newUser.loginUsername} onChange={(e) => setNewUser((current) => ({ ...current, loginUsername: e.target.value }))} placeholder={newUserMode === "operateur" ? "identifiant operateur" : "identifiant manager"} /></Field> : null}
                  {newUserMode === "caissier" ? <Field label="Code confidentiel"><Input value={newUser.pinCode} onChange={(e) => setNewUser((current) => ({ ...current, pinCode: e.target.value.replace(/\D+/g, "") }))} placeholder="laisse vide pour generer" /></Field> : null}
                  <label className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#eadccf]"><input type="checkbox" checked={newUser.isActive} onChange={(e) => setNewUser((current) => ({ ...current, isActive: e.target.checked }))} /> Actif</label>
                </div>
                <p className="mt-4 text-xs text-[#bcae9f]">Les managers, caissiers, operateurs et vendeurs se gerent maintenant dans la fiche de chaque boutique.</p>
                <Button className="mt-4 !px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer l'utilisateur"}</Button>
              </form>
            ) : null}
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.22em] text-[#d9c5b1]">Administrateurs</p>
                <span className="badge !px-2 !py-1 text-[11px]">{adminUsers.length}</span>
              </div>
              {adminUsers.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {adminUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="rounded-2xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-orange-300/30 hover:bg-orange-300/10"
                      onClick={() => { setSelectedUserId(user.id); setEditingUser(false); setSelectedUserPassword(""); setUserDetailTab("infos"); }}
                    >
                      <span className="block truncate text-sm font-semibold text-white">{user.fullName}</span>
                      <span className="mt-1 block truncate text-[11px] text-[#bcae9f]">{user.email}</span>
                    </button>
                  ))}
                </div>
              ) : <div className="text-sm text-[#bcae9f]">Aucun admin.</div>}
            </div>
          </SectionCard>
        )
      ) : null}
      {activeTab === "vendeurs" ? (
        selectedSeller ? (
          <SectionCard title={selectedSeller.fullName} actions={<><Button type="button" variant="secondary" className="!px-3 !py-2 text-xs" onClick={() => { setSelectedSellerId(null); setEditingSeller(false); }}>Retour a la liste</Button><Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setEditingSeller((current) => !current)}>{editingSeller ? "Annuler" : "Modifier"}</Button><Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteSeller(selectedSeller)}>Supprimer</Button></>}>
            {editingSeller ? (
              <form className="space-y-4" onSubmit={submitSellers}>
                <div className="grid items-end gap-4 md:grid-cols-3">
                  <Field label="Vendeur"><Input value={selectedSeller.fullName} readOnly /></Field>
                  <Field label="Boutique"><select className="input-base" value={selectedSeller.boutiqueId ?? ""} onChange={(e) => updateSeller(selectedSeller.id, { boutiqueId: e.target.value || null })}><option value="">Aucune boutique</option>{sellerBoutiques.map((boutique) => <option key={boutique.id} value={boutique.id}>{boutique.name}</option>)}</select></Field>
                  <Field label="Taux de commission %"><Input className="max-w-[150px]" type="number" step="0.01" min="0" value={selectedSeller.commissionRate} onChange={(e) => updateSeller(selectedSeller.id, { commissionRate: Number(e.target.value || 0) })} /></Field>
                  <div className="space-y-3 md:col-span-3">
                    <div>
                      <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Type</p>
                      <div className="flex flex-wrap gap-2">
                        {sellerCategoryTypes.map((type) => {
                          const typeCategoryIds = getCategoryIdsByType(type.id);
                          const checked = typeCategoryIds.length > 0 && typeCategoryIds.every((id) => selectedSeller.categoryIds.includes(id));
                          return <label key={type.id} className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleSellerType(selectedSeller.id, type.id)} />{type.name}</label>;
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Categories affectees</p>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sellerCategories.map((category) => { const checked = selectedSeller.categoryIds.includes(category.id); return <label key={category.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleSellerCategory(selectedSeller.id, category.id)} />{category.name}</label>; })}</div>
                    </div>
                  </div>
                </div>
                <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Enregistrement..." : "Sauvegarder"}</Button>
              </form>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#bba896]">Information</p><p className="mt-2 font-semibold text-white">{selectedSeller.fullName}</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#bba896]">Boutique</p><p className="mt-2 font-semibold text-white">{selectedSeller.boutiqueName || "Non affecte"}</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#bba896]">Commission</p><p className="mt-2 font-semibold text-white">{selectedSeller.commissionRate}%</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#bba896]">Specialite</p><p className="mt-2 font-semibold text-white">{selectedSeller.categoryNames.length ? selectedSeller.categoryNames.join(", ") : "Non affectee"}</p></div>
              </div>
            )}
          </SectionCard>
        ) : (
          <SectionCard title="Vendeurs" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setNewSellerOpen((current) => !current)}>{newSellerOpen ? "Fermer" : "Ajouter vendeur"}</Button>}>
            {newSellerOpen ? (
              <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createSeller}>
                <div className="grid items-end gap-3 md:grid-cols-3">
                  <Field label="Nom vendeur"><Input value={newSeller.fullName} onChange={(e) => setNewSeller((current) => ({ ...current, fullName: e.target.value }))} required /></Field>
                  <Field label="Boutique"><select className="input-base" value={newSeller.boutiqueId} onChange={(e) => setNewSeller((current) => ({ ...current, boutiqueId: e.target.value }))}><option value="">Aucune boutique</option>{sellerBoutiques.map((boutique) => <option key={boutique.id} value={boutique.id}>{boutique.name}</option>)}</select></Field>
                  <Field label="Taux de commission %"><Input className="max-w-[150px]" type="number" step="0.01" min="0" value={newSeller.commissionRate} onChange={(e) => setNewSeller((current) => ({ ...current, commissionRate: e.target.value }))} /></Field>
                  <div className="space-y-3 md:col-span-3">
                    <div>
                      <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Type</p>
                      <div className="flex flex-wrap gap-2">
                        {sellerCategoryTypes.map((type) => {
                          const typeCategoryIds = getCategoryIdsByType(type.id);
                          const checked = typeCategoryIds.length > 0 && typeCategoryIds.every((id) => newSeller.categoryIds.includes(id));
                          return <label key={type.id} className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleNewSellerType(type.id)} />{type.name}</label>;
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-sm font-semibold text-[#efe3d7]">Categories affectees</p>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sellerCategories.map((category) => { const checked = newSeller.categoryIds.includes(category.id); return <label key={category.id} className={`rounded-2xl border px-3 py-2 text-sm transition ${checked ? "border-orange-300/40 bg-orange-300/15 text-white" : "border-white/10 bg-black/20 text-[#dacdc0]"}`}><input className="mr-2" type="checkbox" checked={checked} onChange={() => toggleNewSellerCategory(category.id)} />{category.name}</label>; })}</div>
                    </div>
                  </div>
                </div>
                <Button className="mt-4 !px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer le vendeur"}</Button>
              </form>
            ) : null}
            <div className="overflow-hidden rounded-[24px] border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-[#d9c5b1]"><tr><th className="px-4 py-3">Vendeur</th><th className="px-4 py-3">Boutique</th><th className="px-4 py-3">Commission</th><th className="px-4 py-3">Specialite</th></tr></thead><tbody className="divide-y divide-white/10">{sellerRows.map((seller) => <tr key={seller.id} className="cursor-pointer transition hover:bg-white/5" onClick={() => { setSelectedSellerId(seller.id); setEditingSeller(false); }}><td className="px-4 py-4 font-semibold text-white">{seller.fullName}</td><td className="px-4 py-4 text-[#eadccf]">{seller.boutiqueName || "-"}</td><td className="px-4 py-4 text-[#eadccf]">{seller.commissionRate}%</td><td className="px-4 py-4 text-[#eadccf]">{seller.categoryNames.length ? seller.categoryNames.join(", ") : "-"}</td></tr>)}</tbody></table>{!sellerRows.length ? <div className="p-6 text-center text-sm text-[#d8cabc]">Aucun vendeur trouve. Ajoute un utilisateur avec le role vendeur.</div> : null}</div>
          </SectionCard>
        )
      ) : null}

      {activeTab === "couleurs" ? (
        <div className="grid gap-5">
          <div className="flex flex-wrap gap-2 rounded-[24px] border border-white/10 bg-black/20 p-2">
            <button type="button" className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${colorSubTab === "elements" ? "bg-orange-300 text-[#28170e] shadow-[0_14px_30px_rgba(255,140,35,0.22)]" : "text-[#eadccf] hover:bg-white/10"}`} onClick={() => setColorSubTab("elements")}>Couleurs</button>
            <button type="button" className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${colorSubTab === "types" ? "bg-orange-300 text-[#28170e] shadow-[0_14px_30px_rgba(255,140,35,0.22)]" : "text-[#eadccf] hover:bg-white/10"}`} onClick={() => setColorSubTab("types")}>Types couleurs</button>
          </div>
          {colorSubTab === "elements" ? (
            <SectionCard title="Couleurs" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setNewColorOpen((current) => !current)}>{newColorOpen ? "Fermer" : "Ajouter couleur"}</Button>}>
              {newColorOpen ? (
                <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createColor}>
                  <div className="grid items-end gap-3 md:grid-cols-4">
                    <Field label="Code"><Input value={newColor.reference} onChange={(e) => setNewColor((current) => ({ ...current, reference: e.target.value }))} required /></Field>
                    <Field label="Couleur"><Input value={newColor.name} onChange={(e) => setNewColor((current) => ({ ...current, name: e.target.value }))} required /></Field>
                    <Field label="Type"><select className="input-base" value={newColor.type} onChange={(e) => setNewColor((current) => ({ ...current, type: e.target.value }))}>{colorTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
                    <label className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold text-[#eadccf]"><input type="checkbox" checked={newColor.isAvailable} onChange={(e) => setNewColor((current) => ({ ...current, isAvailable: e.target.checked }))} /> Disponible</label>
                  </div>
                  <Button className="mt-4 !px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer"}</Button>
                </form>
              ) : null}
              <div className="mb-4 grid gap-3 rounded-[22px] border border-white/10 bg-black/20 p-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                <Field label="Filtrer par type">
                  <select className="input-base" value={colorTypeFilter} onChange={(e) => setColorTypeFilter(e.target.value)}>
                    <option value="">Tous les types</option>
                    {colorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Recherche couleur">
                  <Input value={colorSearch} onChange={(e) => setColorSearch(e.target.value)} placeholder="Reference ou nom de couleur..." />
                </Field>
                <div className="flex items-end">
                  <Button
                    className="!h-11 !px-3.5 !text-xs"
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setColorTypeFilter("");
                      setColorSearch("");
                    }}
                  >
                    Reinitialiser
                  </Button>
                </div>
                <div className="md:col-span-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#cbb9a8]">
                  {filteredColors.length} couleur(s) affichee(s) sur {colors.length}
                </div>
              </div>
              <div className="overflow-hidden rounded-[24px] border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-[#d9c5b1]"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Couleur</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredColors.map((color) => {
                      const editing = editingColorId === color.id;
                      return <tr key={color.id} className="transition hover:bg-white/5"><td className="px-4 py-3">{editing ? <Input value={color.reference} onChange={(e) => updateColor(color.id, { reference: e.target.value })} /> : <span className="font-semibold text-white">{color.reference}</span>}</td><td className="px-4 py-3">{editing ? <Input value={color.name} onChange={(e) => updateColor(color.id, { name: e.target.value })} /> : <span className="text-[#eadccf]">{color.name}</span>}</td><td className="px-4 py-3">{editing ? <select className="input-base" value={color.type} onChange={(e) => updateColor(color.id, { type: e.target.value })}>{colorTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select> : <span className="badge">{color.type}</span>}</td><td className="px-4 py-3">{editing ? <select className="input-base" value={color.isAvailable ? "available" : "out"} onChange={(e) => updateColor(color.id, { isAvailable: e.target.value === "available" })}><option value="available">Disponible</option><option value="out">Rupture</option></select> : <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${color.isAvailable ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100" : "border-red-300/30 bg-red-400/15 text-red-100"}`}>{color.isAvailable ? "Disponible" : "Rupture"}</span>}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">{editing ? <Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void saveColor(color)}>Sauvegarder</Button> : <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => setEditingColorId(color.id)}>Modifier</Button>}<Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteColor(color)}>Supprimer</Button></div></td></tr>;
                    })}
                  </tbody>
                </table>
                {!filteredColors.length ? <div className="p-6 text-center text-sm text-[#d8cabc]">Aucune couleur trouvee pour ces filtres.</div> : null}
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Types couleurs">
              <form className="mb-5 grid items-end gap-3 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4 md:grid-cols-[1fr_auto]" onSubmit={createColorType}>
                <Field label="Nouveau type couleur"><Input value={newColorType} onChange={(e) => setNewColorType(e.target.value)} placeholder="Ex: Cuir, Textile, Accessoire..." required /></Field>
                <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Ajouter type"}</Button>
              </form>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {colorTypes.map((type) => {
                  const editing = editingColorType === type;
                  const usedCount = colors.filter((color) => color.type === type).length;
                  return <div key={type} className="rounded-[22px] border border-white/10 bg-black/20 p-4"><p className="text-[11px] uppercase tracking-[0.22em] text-[#bba896]">Type couleur</p>{editing ? <Input className="mt-3" value={colorTypeDraft} onChange={(e) => setColorTypeDraft(e.target.value)} /> : <p className="mt-2 text-lg font-semibold text-white">{type}</p>}<p className="mt-1 text-xs text-[#cbb9a8]">{usedCount} couleur(s) liee(s)</p><div className="mt-4 flex flex-wrap gap-2">{editing ? <Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void saveColorType(type)}>Sauvegarder</Button> : <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => { setEditingColorType(type); setColorTypeDraft(type); }}>Modifier</Button>}<Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteColorType(type)}>Supprimer</Button></div></div>;
                })}
              </div>
            </SectionCard>
          )}
        </div>
      ) : null}
      {activeTab === "tailles" ? (
        <div className="grid gap-5">
          <div className="flex flex-wrap gap-2 rounded-[24px] border border-white/10 bg-black/20 p-2">
            <button type="button" className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${sizeSubTab === "elements" ? "bg-orange-300 text-[#28170e] shadow-[0_14px_30px_rgba(255,140,35,0.22)]" : "text-[#eadccf] hover:bg-white/10"}`} onClick={() => setSizeSubTab("elements")}>Tailles</button>
            <button type="button" className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${sizeSubTab === "types" ? "bg-orange-300 text-[#28170e] shadow-[0_14px_30px_rgba(255,140,35,0.22)]" : "text-[#eadccf] hover:bg-white/10"}`} onClick={() => setSizeSubTab("types")}>Types tailles</button>
          </div>
          {sizeSubTab === "elements" ? (
            <SectionCard title="Tailles" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setNewSizeOpen((current) => !current)}>{newSizeOpen ? "Fermer" : "Ajouter taille"}</Button>}>
              {newSizeOpen ? (
                <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createSize}>
                  <div className="grid items-end gap-3 md:grid-cols-2">
                    <Field label="Taille"><Input value={newSize.name} onChange={(e) => setNewSize((current) => ({ ...current, name: e.target.value }))} required /></Field>
                    <Field label="Type"><select className="input-base" value={newSize.type} onChange={(e) => setNewSize((current) => ({ ...current, type: e.target.value }))}>{sizeTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
                  </div>
                  <Button className="mt-4 !px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer"}</Button>
                </form>
              ) : null}
              <div className="overflow-hidden rounded-[24px] border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-[#d9c5b1]"><tr><th className="px-4 py-3">Taille</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
                  <tbody className="divide-y divide-white/10">
                    {sizes.map((size) => {
                      const editing = editingSizeId === size.id;
                      return <tr key={size.id} className="transition hover:bg-white/5"><td className="px-4 py-3">{editing ? <Input value={size.name} onChange={(e) => updateSize(size.id, { name: e.target.value })} /> : <span className="font-semibold text-white">{size.name}</span>}</td><td className="px-4 py-3">{editing ? <select className="input-base" value={size.type} onChange={(e) => updateSize(size.id, { type: e.target.value })}>{sizeTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select> : <span className="badge">{size.type}</span>}</td><td className="px-4 py-3 text-right"><div className="flex justify-end gap-2">{editing ? <Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void saveSize(size)}>Sauvegarder</Button> : <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => setEditingSizeId(size.id)}>Modifier</Button>}<Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteSize(size)}>Supprimer</Button></div></td></tr>;
                    })}
                  </tbody>
                </table>
                {!sizes.length ? <div className="p-6 text-center text-sm text-[#d8cabc]">Aucune taille trouvee.</div> : null}
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Types tailles">
              <form className="mb-5 grid items-end gap-3 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4 md:grid-cols-[1fr_auto]" onSubmit={createSizeType}>
                <Field label="Nouveau type taille"><Input value={newSizeType} onChange={(e) => setNewSizeType(e.target.value)} placeholder="Ex: Chaussure enfant, Vetement..." required /></Field>
                <Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Ajouter type"}</Button>
              </form>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {sizeTypes.map((type) => {
                  const editing = editingSizeType === type;
                  const usedCount = sizes.filter((size) => size.type === type).length;
                  return <div key={type} className="rounded-[22px] border border-white/10 bg-black/20 p-4"><p className="text-[11px] uppercase tracking-[0.22em] text-[#bba896]">Type taille</p>{editing ? <Input className="mt-3" value={sizeTypeDraft} onChange={(e) => setSizeTypeDraft(e.target.value)} /> : <p className="mt-2 text-lg font-semibold text-white">{type}</p>}<p className="mt-1 text-xs text-[#cbb9a8]">{usedCount} taille(s) liee(s)</p><div className="mt-4 flex flex-wrap gap-2">{editing ? <Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void saveSizeType(type)}>Sauvegarder</Button> : <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => { setEditingSizeType(type); setSizeTypeDraft(type); }}>Modifier</Button>}<Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteSizeType(type)}>Supprimer</Button></div></div>;
                })}
              </div>
            </SectionCard>
          )}
        </div>
      ) : null}
      {activeTab === "devises" ? (
        <div className="grid gap-5">
          <SectionCard title="Devises" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setNewCurrencyOpen((current) => !current)}>{newCurrencyOpen ? "Fermer" : "Ajouter devise"}</Button>}>
            <div className="mb-4 rounded-[22px] border border-orange-300/20 bg-orange-300/10 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-orange-200/80">Devise societe</p>
              <p className="mt-1 text-2xl font-semibold text-white">MAD</p>
              <p className="mt-1 text-sm text-[#d9c9bb]">Toutes les conversions se calculent depuis le MAD.</p>
            </div>

            {newCurrencyOpen ? (
              <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createCurrency}>
                <div className="grid items-end gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <Field label="Code"><Input value={newCurrency.code} onChange={(e) => setNewCurrency((current) => ({ ...current, code: e.target.value.toUpperCase().slice(0, 3) }))} placeholder="EUR" required /></Field>
                  <Field label="Devise"><Input value={newCurrency.name} onChange={(e) => setNewCurrency((current) => ({ ...current, name: e.target.value }))} placeholder="Euro" required /></Field>
                  <Field label="Symbole"><Input value={newCurrency.symbol} onChange={(e) => setNewCurrency((current) => ({ ...current, symbol: e.target.value }))} placeholder="EUR" /></Field>
                  <Field label="Taux 1 MAD"><Input type="number" step="0.000001" min="0.000001" value={newCurrency.rateFromMad} onChange={(e) => setNewCurrency((current) => ({ ...current, rateFromMad: e.target.value }))} /></Field>
                  <Field label="Mode"><select className="input-base" value={newCurrency.rateMode} onChange={(e) => setNewCurrency((current) => ({ ...current, rateMode: e.target.value as CurrencyRow["rateMode"] }))}><option value="MANUAL">Manuel</option><option value="AUTO">Automatique</option></select></Field>
                  <label className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-[#eadccf]"><input type="checkbox" checked={newCurrency.isActive} onChange={(e) => setNewCurrency((current) => ({ ...current, isActive: e.target.checked }))} /> Active</label>
                </div>
                <Button className="mt-4 !px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer"}</Button>
              </form>
            ) : null}

            <div className="overflow-hidden rounded-[24px] border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-[#d9c5b1]"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Devise</th><th className="px-4 py-3">Symbole</th><th className="px-4 py-3">Taux 1 MAD</th><th className="px-4 py-3">Mode</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/10">
                  {currencies.map((currency) => {
                    const editing = editingCurrencyId === currency.id;
                    return <tr key={currency.id} className="transition hover:bg-white/5"><td className="px-4 py-3">{editing && !currency.isBase ? <Input value={currency.code} onChange={(e) => updateCurrency(currency.id, { code: e.target.value.toUpperCase().slice(0, 3) })} /> : <span className="font-semibold text-white">{currency.code}</span>}</td><td className="px-4 py-3">{editing ? <Input value={currency.name} onChange={(e) => updateCurrency(currency.id, { name: e.target.value })} /> : <span className="text-[#eadccf]">{currency.name}</span>}</td><td className="px-4 py-3">{editing ? <Input value={currency.symbol ?? ""} onChange={(e) => updateCurrency(currency.id, { symbol: e.target.value })} /> : <span className="text-[#eadccf]">{currency.symbol || currency.code}</span>}</td><td className="px-4 py-3">{editing ? <Input type="number" step="0.000001" min="0.000001" value={currency.rateFromMad} onChange={(e) => updateCurrency(currency.id, { rateFromMad: Number(e.target.value || 1) })} disabled={currency.isBase} /> : <span className="font-semibold text-white">{Number(currency.rateFromMad).toFixed(6)}</span>}</td><td className="px-4 py-3">{editing ? <select className="input-base" value={currency.rateMode} onChange={(e) => updateCurrency(currency.id, { rateMode: e.target.value as CurrencyRow["rateMode"] })} disabled={currency.isBase}><option value="MANUAL">Manuel</option><option value="AUTO">Automatique</option></select> : <span className="badge">{currency.rateMode === "AUTO" ? "Auto" : "Manuel"}</span>}</td><td className="px-4 py-3">{editing ? <label className="inline-flex items-center gap-2 text-[#eadccf]"><input type="checkbox" checked={currency.isActive} onChange={(e) => updateCurrency(currency.id, { isActive: e.target.checked })} disabled={currency.isBase} /> Active</label> : <span className={`badge ${currency.isActive ? "" : "opacity-60"}`}>{currency.isActive ? "Active" : "Inactive"}</span>}</td><td className="px-4 py-3 text-right"><div className="flex flex-wrap justify-end gap-2">{editing ? <Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void saveCurrency(currency)}>Sauvegarder</Button> : <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => setEditingCurrencyId(currency.id)}>Modifier</Button>}{!currency.isBase ? <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void refreshCurrency(currency)}>Auto</Button> : null}{!currency.isBase ? <Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deleteCurrency(currency)}>Supprimer</Button> : null}</div></td></tr>;
                  })}
                </tbody>
              </table>
              {!currencies.length ? <div className="p-6 text-center text-sm text-[#d8cabc]">Aucune devise trouvee.</div> : null}
            </div>
          </SectionCard>
        </div>
      ) : null}
      {activeTab === "paiements" ? (
        <div className="grid gap-5">
          <SectionCard title="Modes de paiement" actions={<Button className="!px-3 !py-2 text-xs" type="button" onClick={() => setNewPaymentMethodOpen((current) => !current)}>{newPaymentMethodOpen ? "Fermer" : "Ajouter mode"}</Button>}>
            {newPaymentMethodOpen ? (
              <form className="mb-5 rounded-[26px] border border-orange-300/20 bg-orange-300/10 p-4" onSubmit={createPaymentMethod}>
                <div className="grid items-end gap-3 md:grid-cols-3">
                  <Field label="Code"><Input value={newPaymentMethod.code} onChange={(e) => setNewPaymentMethod((current) => ({ ...current, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24) }))} placeholder="CASH" required /></Field>
                  <Field label="Libelle"><Input value={newPaymentMethod.label} onChange={(e) => setNewPaymentMethod((current) => ({ ...current, label: e.target.value }))} placeholder="Especes" required /></Field>
                  <div><Button className="!px-3 !py-2 text-xs" type="submit" disabled={saving}>{saving ? "Creation..." : "Enregistrer"}</Button></div>
                </div>
              </form>
            ) : null}
            <div className="overflow-hidden rounded-[24px] border border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-[0.22em] text-[#d9c5b1]"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Libelle</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/10">
                  {paymentMethods.map((paymentMethod) => (
                    <tr key={paymentMethod.id} className="transition hover:bg-white/5">
                      <td className="px-4 py-3"><Input value={paymentMethod.code} onChange={(e) => updatePaymentMethod(paymentMethod.id, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24) })} /></td>
                      <td className="px-4 py-3"><Input value={paymentMethod.label} onChange={(e) => updatePaymentMethod(paymentMethod.id, { label: e.target.value })} /></td>
                      <td className="px-4 py-3"><label className="inline-flex items-center gap-2 text-[#eadccf]"><input type="checkbox" checked={paymentMethod.isActive} onChange={(e) => updatePaymentMethod(paymentMethod.id, { isActive: e.target.checked })} /> Active</label></td>
                      <td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Button className="!px-3 !py-2 text-xs" type="button" onClick={() => void savePaymentMethod(paymentMethod)}>Sauvegarder</Button><Button className="!px-3 !py-2 text-xs" type="button" variant="secondary" onClick={() => void deletePaymentMethod(paymentMethod)}>Supprimer</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!paymentMethods.length ? <div className="p-6 text-center text-sm text-[#d8cabc]">Aucun mode de paiement trouve.</div> : null}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}




