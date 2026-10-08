// Wspólny interfejs „dostawcy odczytu". Aplikacja i potok nie wiedzą, KTÓRY model czyta fakturę —
// dzięki temu można porównać modele (zestaw ewaluacyjny) i zmienić dostawcę bez przepisywania reszty.

export type Effort = 'low' | 'medium' | 'high';

export type PageInput =
  | { kind: 'image'; mediaType: string; base64: string }
  | { kind: 'pdf'; base64: string };

export type ProviderResult = {
  /** surowy obiekt JSON zwrócony przez model (jeszcze niezweryfikowany) */
  json: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type ProviderErrorCode =
  | 'refusal'      // model odmówił (zabezpieczenia)
  | 'truncated'    // odpowiedź ucięta limitem tokenów
  | 'bad_json'     // nie dało się odczytać odpowiedzi jako JSON
  | 'unavailable'  // klucz, limity, awaria usługi — to nie wina dokumentu
  | 'timeout'
  | 'rejected';    // serwer odrzucił żądanie (np. plik nie do odczytu)

export class ProviderError extends Error {
  code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export interface ExtractionProvider {
  extract(args: { model: string; effort: Effort; pages: PageInput[]; signal?: AbortSignal }): Promise<ProviderResult>;
}
