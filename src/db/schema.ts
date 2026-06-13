import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Multi-tenant schema per docs/DATABASE_PLAN.md — every content/commerce row is scoped
// to a store. Auth itself lives in Supabase Auth (auth.users); `creators.id` mirrors the
// Supabase user id.

// ---------- Enums ----------

export const storeStatus = pgEnum('store_status', ['draft', 'building', 'live', 'suspended']);

export const compositionStatus = pgEnum('composition_status', [
  'generating',
  'draft',
  'approved',
  'published',
  'failed',
]);

export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'submitted_to_printful',
  'in_production',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

export const subscriptionPlan = pgEnum('subscription_plan', ['free', 'pro']);

export const subscriptionStatus = pgEnum('subscription_status', [
  'active',
  'trialing',
  'past_due',
  'canceled',
]);

// ---------- Tenancy & identity ----------

export const creators = pgTable('creators', {
  id: uuid('id').primaryKey(), // = Supabase auth.users.id
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const stores = pgTable(
  'stores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(), // subdomain
    customDomain: text('custom_domain').unique(),
    status: storeStatus('status').notNull().default('draft'),
    // The Studio brand interview output — identity + character data (movie lines, etc.).
    brandProfile: jsonb('brand_profile'),
    // Generated design system: palette / typography / texture / motion language.
    designSystem: jsonb('design_system'),
    logoUrl: text('logo_url'),
    faviconUrl: text('favicon_url'),
    ogImageUrl: text('og_image_url'),
    tagline: text('tagline'),
    descriptionMd: text('description_md'),
    printfulStoreId: text('printful_store_id'),
    deploymentUrl: text('deployment_url'),
    isPublic: boolean('is_public').notNull().default(false), // marketplace visibility
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (s) => ({
    creatorIdx: index('stores_creator_idx').on(s.creatorId),
    publicIdx: index('stores_public_idx').on(s.isPublic, s.status),
  }),
);

// ---------- Design generator (mirrors stephen-lawyer + store scoping) ----------

export const catalogues = pgTable(
  'catalogues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    // A catalogue IS a collection/drop. season tags the preset for storefront grouping.
    season: text('season'), // spring | summer | fall | winter | drop | null
    coverImageUrl: text('cover_image_url'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (c) => ({
    storeIdx: index('catalogues_store_idx').on(c.storeId),
    slugIdx: uniqueIndex('catalogues_store_slug_idx').on(c.storeId, c.slug),
  }),
);

export const designs = pgTable(
  'designs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    catalogueId: uuid('catalogue_id')
      .notNull()
      .references(() => catalogues.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    cloudinaryPublicId: text('cloudinary_public_id'),
    url: text('url').notNull(),
    thumbUrl: text('thumb_url'),
    createdBy: uuid('created_by').references(() => creators.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (d) => ({ catalogueIdx: index('designs_catalogue_idx').on(d.catalogueId) }),
);

type PrintPosition = {
  areaWidth: number;
  areaHeight: number;
  width: number;
  height: number;
  top: number;
  left: number;
  limitToPrintArea?: boolean; // false → art may bleed past the print area
};

export const compositions = pgTable(
  'compositions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    catalogueId: uuid('catalogue_id')
      .notNull()
      .references(() => catalogues.id, { onDelete: 'cascade' }),
    designId: uuid('design_id')
      .notNull()
      .references(() => designs.id, { onDelete: 'cascade' }),
    templateKey: text('template_key').notNull(), // Printful catalog product id
    placement: text('placement').notNull().default('front'),
    position: jsonb('position').$type<PrintPosition>(), // null = Printful auto-fit
    // Multi-design source of truth (front/back/sleeves). Overrides single design/placement.
    placements: jsonb('placements').$type<
      Array<{ placement: string; designId: string; position: PrintPosition | null }>
    >(),
    previewUrl: text('preview_url'),
    status: compositionStatus('status').notNull().default('generating'),
    printfulSyncProductId: text('printful_sync_product_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (c) => ({ catalogueIdx: index('compositions_catalogue_idx').on(c.catalogueId) }),
);

export const canvasNodes = pgTable(
  'canvas_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    catalogueId: uuid('catalogue_id')
      .notNull()
      .references(() => catalogues.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // design | template | composition | group
    refId: text('ref_id').notNull(),
    groupId: text('group_id'),
    x: integer('x').notNull().default(0),
    y: integer('y').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    scale: integer('scale').notNull().default(100), // percent
    zIndex: integer('z_index').notNull().default(0),
    // Template nodes: chosen colourway.
    colorImage: text('color_image'),
    selectedColor: text('selected_color'),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (n) => ({ catalogueIdx: index('canvas_nodes_catalogue_idx').on(n.catalogueId) }),
);

// ---------- Commerce (per store) ----------

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    // Which collection/drop this product belongs to (for storefront grouping).
    catalogueId: uuid('catalogue_id').references(() => catalogues.id, { onDelete: 'set null' }),
    printfulSyncProductId: text('printful_sync_product_id').unique(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    descriptionMd: text('description_md'),
    category: text('category'), // free text — full Printful catalog is broad
    imageUrl: text('image_url'),
    videoUrl: text('video_url'), // Veo-generated product video for the feed
    isPublished: boolean('is_published').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (p) => ({
    storeIdx: index('products_store_idx').on(p.storeId),
    slugIdx: uniqueIndex('products_store_slug_idx').on(p.storeId, p.slug),
    publishedIdx: index('products_published_idx').on(p.isPublished),
  }),
);

export const variants = pgTable(
  'variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    printfulSyncVariantId: text('printful_sync_variant_id').unique(),
    sku: text('sku').notNull(),
    color: text('color'),
    size: text('size'),
    retailPriceCents: integer('retail_price_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    inStock: boolean('in_stock').notNull().default(true),
    imageUrl: text('image_url'),
  },
  (v) => ({ skuIdx: uniqueIndex('variants_sku_idx').on(v.sku) }),
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerEmail: text('customer_email').notNull(),
    stripeSessionId: text('stripe_session_id').unique(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    printfulOrderId: text('printful_order_id'),
    status: orderStatus('status').notNull().default('pending_payment'),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    applicationFeeCents: integer('application_fee_cents').notNull().default(0), // platform cut
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    shippingAddress: jsonb('shipping_address_json'),
    trackingUrl: text('tracking_url'),
    trackingNumber: text('tracking_number'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (o) => ({
    storeIdx: index('orders_store_idx').on(o.storeId),
    statusIdx: index('orders_status_idx').on(o.status),
  }),
);

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => variants.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  nameSnapshot: text('name_snapshot').notNull(),
  variantSnapshot: text('variant_snapshot').notNull(),
});

// ---------- Traffic (brand-site beacon) ----------

export const pageViews = pgTable(
  'page_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    day: text('day').notNull(), // YYYY-MM-DD — daily counter granularity
    views: integer('views').notNull().default(0),
  },
  (v) => ({ storeDayIdx: uniqueIndex('page_views_store_day_idx').on(v.storeId, v.day) }),
);

// ---------- Blog / journal (DB-backed, authored from site /admin AND Studio) ----------
// Posts live here, not in the repo, so publishing is instant and free — no forge run,
// no redeploy. Templates fetch via the public API and fall back to content/blog/*.md.

export const storePosts = pgTable(
  'store_posts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    bodyMd: text('body_md').notNull().default(''),
    coverImageUrl: text('cover_image_url'),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (p) => ({
    storeSlugIdx: uniqueIndex('store_posts_store_slug_idx').on(p.storeId, p.slug),
    publishedIdx: index('store_posts_published_idx').on(p.storeId, p.isPublished),
  }),
);

export const storePostsRelations = relations(storePosts, ({ one }) => ({
  store: one(stores, { fields: [storePosts.storeId], references: [stores.id] }),
}));

// ---------- Site revisions (the visual editing loop) ----------
// A creator's requested change is applied on a WORKING BRANCH (never main), which
// Vercel deploys as a preview. The creator reviews the preview, then approves — only
// then does the branch merge to main and go to production.

export const revisionStatus = pgEnum('revision_status', [
  'building', // forge is applying the change on the branch
  'ready', // branch pushed, preview deployed, awaiting creator review
  'approved', // merged to main → production
  'failed',
]);

export const storeRevisions = pgTable(
  'store_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    requestMd: text('request_md').notNull(), // the change request as markdown
    screenshots: jsonb('screenshots'), // annotated screenshot URLs the creator/Venus marked up
    status: revisionStatus('status').notNull().default('building'),
    branch: text('branch').notNull(),
    previewUrl: text('preview_url'),
    errorMsg: text('error_msg'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (r) => ({ storeIdx: index('store_revisions_store_idx').on(r.storeId, r.status) }),
);

export const storeRevisionsRelations = relations(storeRevisions, ({ one }) => ({
  store: one(stores, { fields: [storeRevisions.storeId], references: [stores.id] }),
}));

// ---------- Creator billing (web portal) ----------

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => creators.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  plan: subscriptionPlan('plan').notNull().default('free'),
  status: subscriptionStatus('status').notNull().default('active'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const connectedAccounts = pgTable('connected_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => creators.id, { onDelete: 'cascade' })
    .unique(),
  stripeAccountId: text('stripe_account_id').notNull().unique(),
  chargesEnabled: boolean('charges_enabled').notNull().default(false),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  detailsSubmitted: boolean('details_submitted').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------- Relations ----------

export const creatorsRelations = relations(creators, ({ many, one }) => ({
  stores: many(stores),
  subscription: one(subscriptions),
  connectedAccount: one(connectedAccounts),
}));

export const storesRelations = relations(stores, ({ one, many }) => ({
  creator: one(creators, { fields: [stores.creatorId], references: [creators.id] }),
  catalogues: many(catalogues),
  products: many(products),
  orders: many(orders),
  posts: many(storePosts),
}));

export const cataloguesRelations = relations(catalogues, ({ one, many }) => ({
  store: one(stores, { fields: [catalogues.storeId], references: [stores.id] }),
  designs: many(designs),
  compositions: many(compositions),
  canvasNodes: many(canvasNodes),
}));

export const designsRelations = relations(designs, ({ one, many }) => ({
  catalogue: one(catalogues, { fields: [designs.catalogueId], references: [catalogues.id] }),
  compositions: many(compositions),
}));

export const compositionsRelations = relations(compositions, ({ one }) => ({
  catalogue: one(catalogues, { fields: [compositions.catalogueId], references: [catalogues.id] }),
  design: one(designs, { fields: [compositions.designId], references: [designs.id] }),
}));

export const canvasNodesRelations = relations(canvasNodes, ({ one }) => ({
  catalogue: one(catalogues, { fields: [canvasNodes.catalogueId], references: [catalogues.id] }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  store: one(stores, { fields: [products.storeId], references: [stores.id] }),
  variants: many(variants),
}));

export const variantsRelations = relations(variants, ({ one }) => ({
  product: one(products, { fields: [variants.productId], references: [products.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  store: one(stores, { fields: [orders.storeId], references: [stores.id] }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(variants, { fields: [orderItems.variantId], references: [variants.id] }),
}));

// ---------- Type exports ----------

export type Creator = typeof creators.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Catalogue = typeof catalogues.$inferSelect;
export type DesignRow = typeof designs.$inferSelect;
export type Composition = typeof compositions.$inferSelect;
export type CanvasNodeRow = typeof canvasNodes.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Variant = typeof variants.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type StorePost = typeof storePosts.$inferSelect;
export type StoreRevision = typeof storeRevisions.$inferSelect;
