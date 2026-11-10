import type { RateLimitReason } from "./cache";

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AiDisabledError extends AiError {
  constructor() {
    super("El asistente de IA está desactivado.");
  }
}

export class AiAuthRequiredError extends AiError {
  constructor() {
    super("Se requiere una cuenta para generar análisis con IA.");
  }
}

export class AiNotConfiguredError extends AiError {
  constructor() {
    super("El asistente de IA no tiene una clave de API configurada.");
  }
}

export class AiBusyError extends AiError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 15) {
    super("Hay demasiadas solicitudes de IA en curso.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class AiPassageTooLargeError extends AiError {
  readonly maxVerses: number;

  constructor(maxVerses: number) {
    super(`El pasaje supera el máximo de ${maxVerses} versículos.`);
    this.maxVerses = maxVerses;
  }
}

export class AiPromptTooLargeError extends AiError {
  readonly maxChars: number;

  constructor(maxChars: number) {
    super(`El pasaje supera el máximo de ${maxChars} caracteres de contexto.`);
    this.maxChars = maxChars;
  }
}

export class AiStorageError extends AiError {
  /** Storage detail for server logs. Never render this value to the user. */
  readonly detail: string;

  constructor(detail: string) {
    super("No se pudo acceder al almacén del asistente de IA.");
    this.detail = detail;
  }
}

export class AiRateLimitError extends AiError {
  readonly reason: RateLimitReason;
  readonly retryAfterSeconds: number;
  readonly perUserDaily: number;
  readonly perUserBurst: number;

  constructor(options: {
    reason: RateLimitReason;
    retryAfterSeconds: number;
    perUserDaily: number;
    perUserBurst: number;
  }) {
    super("Se alcanzó un límite de uso del asistente de IA.");
    this.reason = options.reason;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.perUserDaily = options.perUserDaily;
    this.perUserBurst = options.perUserBurst;
  }
}

export class AiProviderError extends AiError {
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  /** Provider detail for server logs. Never render this value to the user. */
  readonly detail: string;

  constructor(options: {
    message: string;
    status?: number | null;
    retryAfterSeconds?: number | null;
    detail?: string;
  }) {
    super(options.message);
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.detail = options.detail ?? "";
  }
}
