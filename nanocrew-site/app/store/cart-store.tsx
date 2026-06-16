'use client';

import { createContext, useContext, useEffect, useState } from 'react';

// A tiny localStorage cart — no backend state. Each line is one variant; price is captured for
// display only (the POS re-prices from the DB at checkout, so the cart can never set the price).
export type CartLine = {
  variantId: string;
  productSlug: string;
  name: string;
  color: string | null;
  size: string | null;
  priceCents: number;
  image: string | null;
  quantity: number;
};

type CartCtx = {
  lines: CartLine[];
  count: number;
  add: (line: Omit<CartLine, 'quantity'>, qty?: number) => void;
  setQuantity: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);
const KEY = 'nanocrew-cart-v1';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines, hydrated]);

  const add: CartCtx['add'] = (line, qty = 1) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.variantId === line.variantId);
      if (i === -1) return [...prev, { ...line, quantity: qty }];
      const next = [...prev];
      next[i] = { ...next[i], quantity: Math.min(10, next[i].quantity + qty) };
      return next;
    });
  };

  const setQuantity: CartCtx['setQuantity'] = (variantId, qty) =>
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.variantId !== variantId)
        : prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(10, qty) } : l)),
    );

  const remove: CartCtx['remove'] = (variantId) =>
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));

  const clear = () => setLines([]);

  const count = lines.reduce((n, l) => n + l.quantity, 0);

  return <Ctx.Provider value={{ lines, count, add, setQuantity, remove, clear }}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
