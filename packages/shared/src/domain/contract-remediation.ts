import { ApplyContractContextArgs, type ApplyContractContextResponse } from '../lain/tools.js';

// El espejo de lain permite un contexto vacío (el motor lo acepta), pero la UI
// de remediación exige al menos una declaración: la regla vive aquí, en la
// capa de dominio, no en el espejo del wire.
export const ContractApplyBody = ApplyContractContextArgs.superRefine((value, ctx) => {
  const count =
    (value.provides?.length ?? 0) +
    (value.host_aliases?.length ?? 0) +
    (value.bindings?.length ?? 0);
  if (count === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['provides'],
      message: 'at least one contract declaration is required',
    });
  }
});
export type ContractApplyBody = ApplyContractContextArgs;
export type ContractApplyResult = ApplyContractContextResponse;
