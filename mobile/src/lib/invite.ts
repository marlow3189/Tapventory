// Kod zaproszenia ma 8 znaków; ludziom pokazujemy go jako ABCD-EFGH.

export function formatInviteCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function isCompleteInviteCode(code: string): boolean {
  return code.replace(/[^A-Za-z0-9]/g, '').length === 8;
}
