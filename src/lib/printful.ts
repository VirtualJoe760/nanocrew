// Server-side Printful client (used only by API routes — never import from the app).
const API_BASE = 'https://api.printful.com';

async function pfRequest<T>(path: string): Promise<T> {
  const apiKey = process.env.PRINTFUL_API_KEY;
  if (!apiKey) throw new Error('PRINTFUL_API_KEY not configured');
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  const storeId = process.env.PRINTFUL_STORE_ID;
  if (storeId) headers['X-PF-Store-Id'] = storeId;

  const res = await fetch(API_BASE + path, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`Printful ${res.status}: ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as { result: T };
  return json.result;
}

interface PrintfulCatalogListProduct {
  id: number;
  main_category_id: number;
  type_name: string;
  title: string;
  image: string;
  is_discontinued: boolean;
}
interface PrintfulCategory {
  id: number;
  parent_id: number;
  title: string;
}

interface PrintfulVariant {
  id: number;
  color: string | null;
  color_code: string | null;
  image: string;
}

export interface BlankColor {
  color: string;
  colorCode: string;
  image: string; // product photo in this color
}

// Unique colors (with a representative product photo) for one catalog product.
export async function getBlankColors(id: number | string): Promise<BlankColor[]> {
  const result = await pfRequest<{ variants?: PrintfulVariant[] }>(`/products/${id}`);
  const seen = new Set<string>();
  const colors: BlankColor[] = [];
  for (const v of result.variants ?? []) {
    const name = v.color?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    colors.push({ color: name, colorCode: v.color_code ?? '#cccccc', image: v.image });
  }
  return colors;
}

export interface BlankPlacement {
  key: string;
  label: string;
  allOver: boolean;
}

// Available print placements for a catalog product (front/back/sleeves/labels…).
export async function getBlankPlacements(id: number | string): Promise<BlankPlacement[]> {
  const result = await pfRequest<{ available_placements?: Record<string, string> }>(
    `/mockup-generator/printfiles/${id}`,
  );
  const entries = Object.entries(result.available_placements ?? {});
  return entries.map(([key, label]) => ({
    key,
    label,
    allOver: /dtfabric|all[_-]?over/i.test(key) || /all[_-]?over/i.test(label),
  }));
}

export interface PrintArea {
  placement: string;
  label: string;
  areaWidth: number; // print-file pixels
  areaHeight: number;
}

// A product's primary print technique (DTG, KNITWEAR, CUT-SEW, EMBROIDERY…) plus default
// product options. Knitwear REQUIRES both on mockup tasks (e.g. trim_color).
const productMetaCache = new Map<
  string,
  { technique: string | null; defaultOptions: Record<string, string | string[]> }
>();
export async function getProductMeta(
  id: number | string,
): Promise<{ technique: string | null; defaultOptions: Record<string, string | string[]> }> {
  const key = String(id);
  const cached = productMetaCache.get(key);
  if (cached) return cached;
  const result = await pfRequest<{
    product?: {
      techniques?: { key: string }[];
      options?: { id: string; type?: string; values?: Record<string, string> }[];
    };
  }>(`/products/${id}`);
  const technique = result.product?.techniques?.[0]?.key ?? null;
  const defaultOptions: Record<string, string | string[]> = {};
  for (const opt of result.product?.options ?? []) {
    const values = Object.keys(opt.values ?? {});
    if (!values.length) continue;
    // multi_select options (e.g. knitwear yarn_colors) expect arrays — give the knit a
    // small versatile palette by default.
    defaultOptions[opt.id] = opt.type === 'multi_select' ? values.slice(0, 4) : values[0];
  }
  const meta = { technique, defaultOptions };
  productMetaCache.set(key, meta);
  return meta;
}

export async function getProductTechnique(id: number | string): Promise<string | null> {
  return (await getProductMeta(id)).technique;
}

// Per-placement print-area pixel dimensions + a representative variant id (needed by the
// mockup generator). Mirrors stephen-lawyer's /blank/[id]/printareas.
export async function getBlankPrintareas(
  id: number | string,
): Promise<{ areas: PrintArea[]; variantId: number | null }> {
  const result = await pfRequest<{
    available_placements?: Record<string, string>;
    printfiles?: { printfile_id: number; width: number; height: number }[];
    variant_printfiles?: { variant_id: number; placements: Record<string, number> }[];
  }>(`/mockup-generator/printfiles/${id}`);

  const labels = result.available_placements ?? {};
  const byId = new Map((result.printfiles ?? []).map((p) => [p.printfile_id, p]));
  const vp = result.variant_printfiles?.[0];
  const areas: PrintArea[] = [];
  for (const [placement, printfileId] of Object.entries(vp?.placements ?? {})) {
    const pf = byId.get(printfileId);
    if (!pf) continue;
    areas.push({
      placement,
      label: labels[placement] ?? placement,
      areaWidth: pf.width,
      areaHeight: pf.height,
    });
  }
  return { areas, variantId: vp?.variant_id ?? null };
}

export interface MockupPosition {
  area_width: number;
  area_height: number;
  width: number;
  height: number;
  top: number;
  left: number;
  limit_to_print_area?: boolean; // false → art may bleed past the print area
}

export interface MockupFile {
  placement: string;
  image_url: string;
  position?: MockupPosition;
}

async function pfPost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = process.env.PRINTFUL_API_KEY;
  if (!apiKey) throw new Error('PRINTFUL_API_KEY not configured');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const storeId = process.env.PRINTFUL_STORE_ID;
  if (storeId) headers['X-PF-Store-Id'] = storeId;
  const res = await fetch(API_BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Printful ${res.status}: ${await res.text().catch(() => '')}`);
  return ((await res.json()) as { result: T }).result;
}

// Render real Printful mockups for a set of placement files. Creates a generator task and
// polls it to completion (~5-20s).
export async function renderMockups(
  productId: number | string,
  variantId: number,
  files: MockupFile[],
  technique?: string | null,
  productOptions?: Record<string, string | string[]>,
): Promise<Record<string, string>> {
  const task = await pfPost<{ task_key: string }>(`/mockup-generator/create-task/${productId}`, {
    variant_ids: [variantId],
    format: 'png',
    files,
    ...(technique && technique !== 'DTG' ? { technique } : {}),
    ...(productOptions && Object.keys(productOptions).length ? { product_options: productOptions } : {}),
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await pfRequest<{
      status: string;
      error?: string;
      mockups?: { placement: string; mockup_url: string; extra?: { url: string; option: string }[] }[];
    }>(`/mockup-generator/task?task_key=${encodeURIComponent(task.task_key)}`);
    if (status.status === 'completed') {
      const out: Record<string, string> = {};
      for (const m of status.mockups ?? []) {
        if (!out[m.placement]) out[m.placement] = m.mockup_url;
      }
      return out;
    }
    if (status.status === 'failed') throw new Error(status.error || 'Mockup task failed');
  }
  throw new Error('Mockup task timed out');
}

export interface CatalogVariant {
  id: number;
  size: string;
  color: string;
  colorCode: string;
  priceCents: number; // Printful base cost
  image: string;
}

// All purchasable variants of a catalog product (for the finalize screen).
export async function getCatalogVariants(id: number | string): Promise<CatalogVariant[]> {
  const result = await pfRequest<{
    variants?: {
      id: number;
      size: string | null;
      color: string | null;
      color_code: string | null;
      price: string;
      image: string;
    }[];
  }>(`/products/${id}`);
  return (result.variants ?? []).map((v) => ({
    id: v.id,
    size: v.size ?? 'One size',
    color: v.color ?? 'Default',
    colorCode: v.color_code ?? '#cccccc',
    priceCents: Math.round(parseFloat(v.price || '0') * 100),
    image: v.image,
  }));
}

export interface SyncProductInput {
  sync_product: { name: string; thumbnail?: string };
  sync_variants: {
    variant_id: number;
    retail_price: string; // "29.99"
    files: { type: string; url: string; position?: MockupPosition }[];
  }[];
}

// Create the live sync product on the store. Idempotency key = composition id (Printful
// dedupes retries).
export async function createSyncProduct(
  input: SyncProductInput,
  idempotencyKey: string,
): Promise<{ id: number }> {
  const apiKey = process.env.PRINTFUL_API_KEY;
  if (!apiKey) throw new Error('PRINTFUL_API_KEY not configured');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  const storeId = process.env.PRINTFUL_STORE_ID;
  if (storeId) headers['X-PF-Store-Id'] = storeId;
  const res = await fetch(`${API_BASE}/store/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Printful ${res.status}: ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as { result: { id: number } };
  return json.result;
}

// Print files must be high-res — rescale Cloudinary-hosted designs to ~4500px wide.
export function upscaleForPrint(url: string): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace('/upload/', '/upload/c_scale,w_4500/');
}

export type BlankCategory = 'men' | 'women' | 'kids' | 'accessories';
export interface CatalogBlank {
  id: number;
  name: string;
  image: string;
  category: BlankCategory; // gender / age bucket
  type: string; // second-level type, e.g. "T-shirts", "Hoodies"
}

const ROOT_TO_BUCKET: Record<string, BlankCategory> = {
  "Men's clothing": 'men',
  "Women's clothing": 'women',
  "Kids' & youth clothing": 'kids',
  Accessories: 'accessories',
  Hats: 'accessories',
};

let cache: { at: number; blanks: CatalogBlank[] } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function getCatalogBlanks(): Promise<CatalogBlank[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.blanks;

  const [products, catResult] = await Promise.all([
    pfRequest<PrintfulCatalogListProduct[]>('/products'),
    pfRequest<{ categories: PrintfulCategory[] }>('/categories'),
  ]);
  const categories = catResult.categories ?? [];
  const byId = new Map(categories.map((c) => [c.id, c]));

  // Walk a category id up to its root: [leaf, ..., root].
  const chainToRoot = (cid: number): PrintfulCategory[] => {
    const out: PrintfulCategory[] = [];
    let c = byId.get(cid);
    let guard = 0;
    while (c && guard++ < 20) {
      out.push(c);
      if (!c.parent_id || c.parent_id === 0) break;
      c = byId.get(c.parent_id);
    }
    return out;
  };

  const blanks: CatalogBlank[] = [];
  for (const p of products) {
    if (p.is_discontinued) continue;
    const chain = chainToRoot(p.main_category_id);
    const root = chain[chain.length - 1];
    const bucket = root ? ROOT_TO_BUCKET[root.title] : undefined;
    if (!bucket) continue; // skip Home & living etc.
    const type = chain.length >= 2 ? chain[chain.length - 2].title : 'Other';
    blanks.push({ id: p.id, name: p.title, image: p.image, category: bucket, type });
  }
  blanks.sort((a, b) => a.name.localeCompare(b.name));

  cache = { at: Date.now(), blanks };
  return blanks;
}
