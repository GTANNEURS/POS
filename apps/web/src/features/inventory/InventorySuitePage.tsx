import { useMemo, useState } from "react";
import { ClipboardCheck, Package2 } from "lucide-react";
import { useAuth } from "../../providers/AuthProvider";
import { Button } from "../../components/ui/primitives";
import { InventoryPage as StockOperationsPage } from "./InventoryPage";
import { InventoryCountingPage } from "./InventoryCountingPage";

export function InventorySuitePage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"count" | "stock">("count");

  const canManageInventory = useMemo(
    () => user?.permissions.includes("inventory_manage") ?? false,
    [user?.permissions]
  );

  if (!canManageInventory) {
    return <InventoryCountingPage countingOnly />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-3">
        <div className="flex flex-wrap gap-3">
          <Button
            variant={activeTab === "count" ? "primary" : "secondary"}
            className="!h-10 !px-5 !text-sm"
            onClick={() => setActiveTab("count")}
          >
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Inventaires
          </Button>
          <Button
            variant={activeTab === "stock" ? "primary" : "secondary"}
            className="!h-10 !px-5 !text-sm"
            onClick={() => setActiveTab("stock")}
          >
            <Package2 className="mr-2 h-4 w-4" />
            Stock & mouvements
          </Button>
        </div>
      </div>

      {activeTab === "count" ? <InventoryCountingPage /> : <StockOperationsPage />}
    </div>
  );
}
