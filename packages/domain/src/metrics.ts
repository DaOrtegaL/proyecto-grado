/** Definiciones de indicadores (sección 15 de la especificación) y cálculos puros. */
export const METRIC_CODES = [
  'INVENTORY_COVERAGE',
  'ALERT_ANTICIPATION',
  'RENEWAL_TIME',
  'INSTALL_SUCCESS_RATE',
  'DEPLOYMENT_ERROR_RATE',
  'FALSE_POSITIVE_RATE',
  'AUDIT_COMPLETENESS',
  'INCIDENTS_P1P2',
  'SUS_SCORE',
] as const;
export type MetricCode = (typeof METRIC_CODES)[number];

export interface MetricDefinitionSeed {
  code: MetricCode;
  name: string;
  formula: string;
  unit: string;
  description: string;
  source: string;
}

export const METRIC_DEFINITIONS: MetricDefinitionSeed[] = [
  { code: 'INVENTORY_COVERAGE', name: 'Cobertura del inventario', formula: 'Terminales elegibles inventariadas correctamente / Total de terminales elegibles × 100', unit: '%', description: 'Diferencia terminales conocidas de terminales efectivamente inventariadas (al menos un inventario exitoso en el periodo).', source: 'InventoryScan, Terminal' },
  { code: 'ALERT_ANTICIPATION', name: 'Anticipación de alertas', formula: 'Fecha de vencimiento − Fecha de primera alerta válida (días)', unit: 'días', description: 'Promedio de días entre la primera alerta de cada certificado y su vencimiento.', source: 'Alert' },
  { code: 'RENEWAL_TIME', name: 'Tiempo de renovación', formula: 'Fecha de instalación verificada − Fecha de creación de la solicitud (horas)', unit: 'horas', description: 'Promedio de horas de las renovaciones completadas.', source: 'RenewalRequest' },
  { code: 'INSTALL_SUCCESS_RATE', name: 'Tasa de éxito de instalación', formula: 'Instalaciones verificadas exitosamente / Total de intentos completados × 100', unit: '%', description: 'Sobre destinos de instalación con resultado final.', source: 'DeploymentTarget' },
  { code: 'DEPLOYMENT_ERROR_RATE', name: 'Errores de despliegue', formula: 'Intentos fallidos / Total de intentos × 100 (y errores por cada 100 operaciones)', unit: '%', description: 'Incluye fallas de instalación y de verificación.', source: 'DeploymentAttempt' },
  { code: 'FALSE_POSITIVE_RATE', name: 'Falsos positivos', formula: 'Alertas confirmadas como falsos positivos / Total de alertas evaluadas × 100', unit: '%', description: 'Solo cuenta alertas evaluadas por una persona.', source: 'Alert' },
  { code: 'AUDIT_COMPLETENESS', name: 'Completitud de auditoría', formula: 'Operaciones con todos los campos de auditoría obligatorios / Total de operaciones evaluadas × 100', unit: '%', description: 'Campos obligatorios: usuario, acción, recurso, resultado, correlación y estado posterior.', source: 'AuditEvent' },
  { code: 'INCIDENTS_P1P2', name: 'Incidentes P1/P2 relacionados con certificados', formula: 'Conteo de incidentes confirmados P1 o P2 en el periodo (normalizable por 30 días)', unit: 'incidentes', description: 'Permite comparar periodos equivalentes.', source: 'Incident' },
  { code: 'SUS_SCORE', name: 'Usabilidad (SUS)', formula: 'Promedio de puntuaciones SUS (0–100)', unit: 'puntos', description: 'Cuestionario System Usability Scale de diez preguntas.', source: 'UsabilitySurvey' },
];

/** Metas preliminares de investigación; no son estándares universales (sección 16). */
export const DEFAULT_METRIC_TARGETS = [
  { metricCode: 'INVENTORY_COVERAGE', comparator: 'GTE', targetValue: 95 },
  { metricCode: 'ALERT_ANTICIPATION', comparator: 'GTE', targetValue: 30 },
  { metricCode: 'AUDIT_COMPLETENESS', comparator: 'GTE', targetValue: 100 },
] as const;

export function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Preguntas oficiales del System Usability Scale (versión en español). */
export const SUS_QUESTIONS = [
  'Creo que me gustaría utilizar este sistema con frecuencia.',
  'Encontré el sistema innecesariamente complejo.',
  'Pensé que el sistema era fácil de usar.',
  'Creo que necesitaría el apoyo de un experto para poder utilizar este sistema.',
  'Encontré que las diversas funciones del sistema estaban bien integradas.',
  'Pensé que había demasiada inconsistencia en este sistema.',
  'Imagino que la mayoría de las personas aprendería a utilizar este sistema muy rápidamente.',
  'Encontré el sistema muy incómodo de usar.',
  'Me sentí muy seguro al utilizar el sistema.',
  'Necesité aprender muchas cosas antes de poder empezar a utilizar el sistema.',
] as const;

/**
 * Puntuación SUS: preguntas impares aportan (respuesta − 1); pares aportan (5 − respuesta);
 * la suma se multiplica por 2,5 para obtener un valor entre 0 y 100.
 */
export function susScore(answers: number[]): number {
  if (answers.length !== 10 || answers.some((a) => !Number.isInteger(a) || a < 1 || a > 5)) {
    throw new Error('El SUS requiere diez respuestas enteras entre 1 y 5.');
  }
  const sum = answers.reduce((acc, a, i) => acc + (i % 2 === 0 ? a - 1 : 5 - a), 0);
  return sum * 2.5;
}

export interface MetricComparison {
  metricCode: string;
  baseline: number | null;
  pilot: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  baselineSample: number;
  pilotSample: number;
}

export function compareValues(
  metricCode: string,
  baseline: { value: number | null; sampleSize: number },
  pilot: { value: number | null; sampleSize: number },
): MetricComparison {
  const abs = baseline.value !== null && pilot.value !== null ? pilot.value - baseline.value : null;
  const rel = abs !== null && baseline.value ? (abs / Math.abs(baseline.value)) * 100 : null;
  return {
    metricCode,
    baseline: baseline.value,
    pilot: pilot.value,
    absoluteChange: abs,
    relativeChange: rel,
    baselineSample: baseline.sampleSize,
    pilotSample: pilot.sampleSize,
  };
}
