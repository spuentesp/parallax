// Construcción ÚNICA del modelo del investigador a partir de la configuración.
// /api/query y el worker de assessments pasan por aquí: credencial, endpoint,
// modelos y presupuesto salen de la misma fuente (config.ts) y no se vuelven a
// armar a mano en cada ruta.

import { type AppConfig, investigatorSettings } from '../config.js';
import type { InvestigatorBudget } from './investigator.js';
import { NemotronProvider } from './nemotron.js';

export interface InvestigatorModel {
  provider: NemotronProvider;
  settings: ReturnType<typeof investigatorSettings>;
  budget: InvestigatorBudget;
}

/** null = sin NEBIUS_TOKEN: el llamador declara failed:no_model_configured (P08). */
export function investigatorModel(cfg: AppConfig): InvestigatorModel | null {
  if (!cfg.nebiusToken) return null;
  const settings = investigatorSettings(cfg);
  return {
    provider: new NemotronProvider({
      baseUrl: settings.baseUrl,
      apiKey: cfg.nebiusToken,
      plannerModel: settings.plannerModel,
      workerModel: settings.workerModel,
      timeoutMs: Math.min(60_000, settings.maxModelMs),
    }),
    settings,
    budget: { maxToolCalls: settings.maxToolCalls, maxModelMs: settings.maxModelMs },
  };
}
