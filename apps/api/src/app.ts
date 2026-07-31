import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { productsRouter } from "./modules/products/products.routes.js";
import { customersRouter } from "./modules/customers/customers.routes.js";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes.js";
import { transportersRouter } from "./modules/transporters/transporters.routes.js";
import { purchasesRouter } from "./modules/purchases/purchases.routes.js";
import { inventoryRouter } from "./modules/inventory/inventory.routes.js";
import { inventoriesRouter } from "./modules/inventories/inventories.routes.js";
import { salesRouter } from "./modules/sales/sales.routes.js";
import { posRouter } from "./modules/pos/pos.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin non autorisee: ${origin}`));
      },
      credentials: true
    })
  );
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(morgan("dev"));
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, message: "API GDT Suite operationnelle" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/suppliers", suppliersRouter);
  app.use("/api/transporters", transportersRouter);
  app.use("/api/purchases", purchasesRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/inventories", inventoriesRouter);
  app.use("/api/sales", salesRouter);
  app.use("/api/pos", posRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/settings", settingsRouter);

  app.use(errorHandler);
  return app;
}
