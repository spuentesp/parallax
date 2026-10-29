// Del diff unificado de un archivo del PR a LAS LÍNEAS QUE CAMBIAN, en la numeración del código
// BASE. El índice del código (Lain) describe el código tal como estaba, no el del PR, así que
// "qué símbolo toca este cambio" se contesta con las líneas viejas:
//   - una línea borrada o modificada es su propia línea vieja;
//   - una inserción pura se ancla a la línea vieja justo antes de ella (el símbolo que la rodea).
// Puro: sin red ni estado.

export interface ChangedLine {
  /** Línea en el archivo BASE (0 = antes de la primera línea: nivel de módulo). */
  readonly oldLine: number;
  readonly kind: 'removed' | 'added';
  /** Una inserción que empieza una definición nueva: no pertenece al símbolo de al lado. */
  readonly startsNewDefinition: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// Primera línea de una definición nueva, en los lenguajes que el índice suele traer.
const DEFINITION =
  /^(?:@\w|(?:async\s+)?def\s|class\s|func\s|(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\b|class\s|interface\s|enum\s|type\s+\w+\s*=|const\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function)))/;

/** Líneas cambiadas de un patch, en numeración base. Un patch vacío o ausente no cambia nada. */
export function changedLines(patch: string | undefined): ChangedLine[] {
  if (!patch) return [];
  const out: ChangedLine[] = [];
  let oldLine = 0;
  let inHunk = false;
  // La racha de líneas añadidas en curso (sin borradas en medio).
  let run: { anchor: number; first: string | null; lines: number } | null = null;
  const flush = (): void => {
    if (!run) return;
    out.push({
      oldLine: run.anchor,
      kind: 'added',
      startsNewDefinition: run.first !== null && DEFINITION.test(run.first),
    });
    run = null;
  };
  for (const raw of patch.split('\n')) {
    const h = HUNK.exec(raw);
    if (h) {
      flush();
      oldLine = Number(h[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith('\\')) continue;
    const tag = raw[0];
    if (tag === '+') {
      const text = raw.slice(1).trim();
      if (!run) run = { anchor: Math.max(0, oldLine - 1), first: null, lines: 0 };
      // La primera línea con contenido decide si la racha empieza una definición.
      if (run.first === null && text !== '') run.first = text;
      run.lines++;
    } else if (tag === '-') {
      flush();
      out.push({ oldLine, kind: 'removed', startsNewDefinition: false });
      oldLine++;
    } else {
      // Contexto (' ' o línea vacía final del patch).
      flush();
      oldLine++;
    }
  }
  flush();
  return out;
}
