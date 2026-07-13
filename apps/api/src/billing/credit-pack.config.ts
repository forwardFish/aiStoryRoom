export type CreditPackKey = "credits_300" | "credits_650";

export interface CreditPackDefinition {
  key: CreditPackKey;
  productId: string;
  credits: number;
  expectedAmountCents: number;
  currency: "USD";
}

export function getCreditPacks(): Record<CreditPackKey, CreditPackDefinition> {
  return {
    credits_300: {
      key: "credits_300",
      productId: process.env.CREEM_PRODUCT_300_ID || "prod_xkzSkuNeiQuP1QVNV6NbL",
      credits: 300,
      expectedAmountCents: 799,
      currency: "USD"
    },
    credits_650: {
      key: "credits_650",
      productId: process.env.CREEM_PRODUCT_650_ID || "prod_43UaxI9MUzfbPcGZtBbvQD",
      credits: 650,
      expectedAmountCents: 1499,
      currency: "USD"
    }
  };
}

export function findPackByProductId(productId: string) {
  return Object.values(getCreditPacks()).find((pack) => pack.productId === productId) || null;
}
