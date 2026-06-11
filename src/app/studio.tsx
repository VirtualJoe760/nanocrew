import { SectionScreen } from '@/components/section-screen';

export default function StudioScreen() {
  return (
    <SectionScreen
      eyebrow="Your store"
      title="Studio"
      description="Describe your brand and Nanocrew builds the store for you."
      points={[
        'Brand interview with AI',
        'Auto-generated logo, OG image & favicon',
        'Publish to your own domain',
      ]}
    />
  );
}
