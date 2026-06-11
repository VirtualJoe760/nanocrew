import { SectionScreen } from '@/components/section-screen';

export default function MarketScreen() {
  return (
    <SectionScreen
      eyebrow="Marketplace"
      title="Market"
      description="Browse other creators' products and visit their stores."
      points={[
        'Browse creator storefronts',
        'Featured drops & new brands',
        "Tap through to any store's standalone site",
      ]}
    />
  );
}
