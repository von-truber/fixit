// Size limits shared by the page and the function. Kept free of imports so the
// page can use them without bundling Zod.
export const LIMITS = {
  explain: 8000,
  digest: 40000,
  context: 300,
} as const;
