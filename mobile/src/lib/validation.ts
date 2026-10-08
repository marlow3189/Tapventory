// Proste, wspólne reguły walidacji formularzy (te same na każdym ekranie).

export const MIN_PASSWORD = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const isEmail = (s: string): boolean => EMAIL_RE.test(s.trim());
