// Prosty „kurier" wyniku skanowania: ekran skanera oddaje kod kreskowy ekranowi,
// który go o to poprosił (np. formularz produktu), i wraca. Unikamy przekazywania
// funkcji przez parametry trasy (niedozwolone w nawigacji).

type Listener = (ean: string) => void;
const listeners = new Set<Listener>();

export function onScanned(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitScanned(ean: string) {
  for (const fn of Array.from(listeners)) fn(ean);
}
