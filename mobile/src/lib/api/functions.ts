// Wywołania Edge Functions (kod po stronie serwera: klucze AI nigdy nie trafiają do telefonu).

import { FunctionsHttpError, FunctionsFetchError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export class FunctionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FunctionError';
    this.code = code;
  }
}

/** Wywołuje funkcję i zamienia każdy rodzaj błędu na FunctionError z czytelnym polskim tekstem. */
export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> });
  if (!error) return data as T;

  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await error.context.json();
      const e = payload?.error;
      throw new FunctionError(e?.code ?? 'function_error', e?.message ?? 'Operacja nie powiodła się.');
    } catch (inner) {
      if (inner instanceof FunctionError) throw inner;
      throw new FunctionError('function_error', 'Serwer zwrócił błąd. Spróbuj ponownie za chwilę.');
    }
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    throw new FunctionError('network', 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
  }
  throw new FunctionError('unknown', 'Coś poszło nie tak. Spróbuj ponownie.');
}
